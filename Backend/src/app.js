const Fastify = require('fastify');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { transaction } = require('./db');
const { hashPassword, verifyPassword, readToken, setCookie, newSession, tokenHash, httpError } = require('./auth');
const s = require('./schemas');

function buildApp({ pool, logger = false, authLimit = 30, closePool = true }) {
  const app = Fastify({ logger, bodyLimit: 32768, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  app.decorateRequest('user', null);
  const attempts = new Map();
  const cleanup = setInterval(() => {
    for (const [ip, value] of attempts) if (value.until < Date.now()) attempts.delete(ip);
  }, 60000);
  cleanup.unref();
  app.addHook('onClose', async () => { clearInterval(cleanup); if (closePool) await pool.end(); });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers['x-requested-with'] !== 'Elevate') {
        throw httpError(403, 'Solicitud no permitida.');
      }
    }
  });
  app.setErrorHandler((error, request, reply) => {
    let status = error.statusCode || 500;
    let message = error.message;
    if (error.validation) {
      status = 400;
      message = 'Revisa los campos: hay datos faltantes o inválidos.';
    } else if (error.code === '23505') { status = 409; message = 'El registro ya existe (correo o miembro duplicado).'; }
    else if (['23503', '23514', '22003', '22007', '22008'].includes(error.code)) { status = 400; message = 'Los datos o sus relaciones no son válidos.'; }
    if (status >= 500) { request.log.error(error); message = 'No se pudo completar la operación. Inténtalo nuevamente.'; }
    reply.code(status).send({ error: { message, ...(error.validation ? { fields: error.validation.map(e => ({ field: e.instancePath || e.params.missingProperty, message: e.message })) } : {}) } });
  });

  async function authenticate(request) {
    const token = readToken(request);
    if (!token) throw httpError(401, 'Inicia sesión para continuar.');
    const { rows } = await pool.query(`SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash(token)]);
    if (!rows[0]) throw httpError(401, 'Tu sesión ha vencido. Inicia sesión nuevamente.');
    request.user = rows[0];
  }
  async function authThrottle(request, reply) {
    const now = Date.now();
    let entry = attempts.get(request.ip);
    if (!entry || entry.until <= now) { entry = { count: 0, until: now + 15 * 60000 }; attempts.set(request.ip, entry); }
    if (++entry.count > authLimit) {
      reply.header('Retry-After', Math.ceil((entry.until - now) / 1000));
      throw httpError(429, 'Demasiados intentos. Espera unos minutos.');
    }
  }
  async function projectAccess(db, projectId, userId, owner = false, lock = false) {
    const { rows } = await db.query(`SELECT p.* FROM projects p JOIN project_members m ON m.project_id = p.id
      WHERE p.id = $1 AND m.user_id = $2 ${lock ? 'FOR UPDATE OF p' : ''}`, [projectId, userId]);
    if (!rows[0]) throw httpError(404, 'Proyecto no encontrado.');
    if (owner && rows[0].owner_id !== userId) throw httpError(403, 'Solo el propietario puede administrar este proyecto.');
    return rows[0];
  }
  async function taskAccess(db, projectId, taskId) {
    const { rows } = await db.query('SELECT * FROM tasks WHERE id = $1 AND project_id = $2', [taskId, projectId]);
    if (!rows[0]) throw httpError(404, 'Tarea no encontrada.');
    return rows[0];
  }
  async function ensureAssignee(db, project, userId, assigneeId) {
    if (assigneeId == null) return;
    const membership = await db.query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2', [project.id, assigneeId]);
    if (membership.rowCount) return;
    if (project.owner_id !== userId) throw httpError(403, 'Solo el propietario puede incorporar personas al proyecto. Selecciona un miembro del equipo.');
    const person = await db.query('SELECT id FROM users WHERE id = $1', [assigneeId]);
    if (!person.rowCount) throw httpError(400, 'La persona seleccionada no existe.');
    await db.query('INSERT INTO project_members(project_id, user_id) VALUES ($1, $2)', [project.id, assigneeId]);
  }
  // Mutations lock the project so membership changes and task writes are serialized.
  const withProject = (request, owner, work) => transaction(pool, async db => {
    const project = await projectAccess(db, request.params.projectId, request.user.id, owner, true);
    return work(db, project);
  });
  const protectedRoute = schema => ({ onRequest: authenticate, schema });

  app.get('/api/test-db', async () => {
    const { rows } = await pool.query('SELECT now() AS time');
    return { status: 'success', message: 'Conexión exitosa con PostgreSQL.', time: rows[0].time };
  });
  app.post('/api/auth/register', { onRequest: authThrottle, schema: { body: s.object({ name: s.text(100, 1), email: s.email, password: s.password }, ['name', 'email', 'password']) } }, async (request, reply) => {
    const { name, email, password } = request.body;
    const passwordHash = await hashPassword(password);
    const { user, token } = await transaction(pool, async db => {
      const { rows } = await db.query('INSERT INTO users(name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email', [name.trim(), email.toLowerCase(), passwordHash]);
      return { user: rows[0], token: await newSession(db, rows[0].id) };
    });
    setCookie(reply, token);
    return reply.code(201).send({ user });
  });
  app.post('/api/auth/login', { onRequest: authThrottle, schema: { body: s.object({ email: s.email, password: s.password }, ['email', 'password']) } }, async (request, reply) => {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [request.body.email.toLowerCase()]);
    const user = rows[0];
    // Run scrypt even for unknown addresses to reduce account timing disclosure.
    const valid = await verifyPassword(request.body.password, user?.password_hash || `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if (!user || !valid) throw httpError(401, 'Correo o contraseña incorrectos.');
    const token = await transaction(pool, async db => {
      const previous = readToken(request);
      if (previous) await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(previous)]);
      return newSession(db, user.id);
    });
    setCookie(reply, token);
    return { user: { id: user.id, name: user.name, email: user.email } };
  });
  app.get('/api/auth/me', protectedRoute({}), request => ({ user: request.user }));
  app.post('/api/auth/logout', async (request, reply) => {
    const token = readToken(request);
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
    setCookie(reply, '', 0);
    return reply.code(204).send();
  });

  app.get('/api/projects', protectedRoute({}), async request => {
    const { rows } = await pool.query(`SELECT p.*,
      (SELECT count(*)::int FROM project_members m2 WHERE m2.project_id = p.id) AS member_count,
      (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id) AS task_count,
      (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count
      FROM projects p JOIN project_members m ON m.project_id = p.id WHERE m.user_id = $1 ORDER BY p.created_at DESC`, [request.user.id]);
    return { projects: rows };
  });
  app.post('/api/projects', protectedRoute({ body: s.project }), async (request, reply) => {
    const project = await transaction(pool, async db => {
      const { rows } = await db.query('INSERT INTO projects(name, description, owner_id) VALUES ($1, $2, $3) RETURNING *', [request.body.name.trim(), request.body.description || '', request.user.id]);
      await db.query('INSERT INTO project_members(project_id, user_id) VALUES ($1, $2)', [rows[0].id, request.user.id]);
      return rows[0];
    });
    return reply.code(201).send({ project });
  });
  app.get('/api/projects/:projectId', protectedRoute({ params: s.params('projectId') }), async request => ({ project: await projectAccess(pool, request.params.projectId, request.user.id) }));
  app.patch('/api/projects/:projectId', protectedRoute({ params: s.params('projectId'), body: s.project }), async request => ({ project: await withProject(request, true, async db => {
    const { rows } = await db.query('UPDATE projects SET name = $1, description = COALESCE($2, description), updated_at = now() WHERE id = $3 RETURNING *', [request.body.name.trim(), request.body.description, request.params.projectId]);
    return rows[0];
  }) }));
  app.delete('/api/projects/:projectId', protectedRoute({ params: s.params('projectId') }), async (request, reply) => {
    await withProject(request, true, db => db.query('DELETE FROM projects WHERE id = $1', [request.params.projectId]));
    return reply.code(204).send();
  });
  app.get('/api/projects/:projectId/members', protectedRoute({ params: s.params('projectId') }), async request => {
    await projectAccess(pool, request.params.projectId, request.user.id);
    const { rows } = await pool.query(`SELECT u.id, u.name, u.email, m.joined_at FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY m.joined_at, u.name`, [request.params.projectId]);
    return { members: rows };
  });
  app.get('/api/projects/:projectId/assignees', protectedRoute({ params: s.params('projectId') }), async request => {
    const project = await projectAccess(pool, request.params.projectId, request.user.id);
    const { rows: members } = await pool.query(`SELECT u.id, u.name, u.email FROM project_members m
      JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY u.name, u.id`, [project.id]);
    let candidates = [];
    if (project.owner_id === request.user.id) {
      const result = await pool.query(`SELECT u.id, u.name, u.email FROM users u WHERE NOT EXISTS
        (SELECT 1 FROM project_members m WHERE m.project_id = $1 AND m.user_id = u.id) ORDER BY u.name, u.id`, [project.id]);
      candidates = result.rows;
    }
    return { members, candidates };
  });
  app.post('/api/projects/:projectId/members', protectedRoute({ params: s.params('projectId'), body: s.object({ email: s.email }, ['email']) }), async (request, reply) => {
    const member = await withProject(request, true, async db => {
      const { rows } = await db.query('SELECT id, name, email FROM users WHERE email = $1', [request.body.email.toLowerCase()]);
      if (!rows[0]) throw httpError(404, 'No existe una cuenta con ese correo. La persona debe registrarse primero.');
      await db.query('INSERT INTO project_members(project_id, user_id) VALUES ($1, $2)', [request.params.projectId, rows[0].id]);
      return rows[0];
    });
    return reply.code(201).send({ member });
  });
  app.delete('/api/projects/:projectId/members/:userId', protectedRoute({ params: s.params('projectId', 'userId') }), async (request, reply) => {
    await withProject(request, true, async (db, project) => {
      if (Number(request.params.userId) === project.owner_id) throw httpError(400, 'No puedes quitar al propietario del proyecto.');
      await db.query('UPDATE tasks SET assignee_id = NULL, updated_at = now() WHERE project_id = $1 AND assignee_id = $2', [project.id, request.params.userId]);
      const result = await db.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [project.id, request.params.userId]);
      if (!result.rowCount) throw httpError(404, 'Miembro no encontrado.');
    });
    return reply.code(204).send();
  });

  const taskSelect = `SELECT t.*, u.name AS assignee_name,
    (SELECT count(*)::int FROM comments c WHERE c.task_id = t.id) AS comment_count
    FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id`;
  app.get('/api/projects/:projectId/tasks', protectedRoute({ params: s.params('projectId'), querystring: s.object({ status: s.taskFields.status, priority: s.taskFields.priority, assignee_id: { anyOf: [s.urlId, { const: 'unassigned', type: 'string' }] }, search: s.text(180) }) }), async request => {
    await projectAccess(pool, request.params.projectId, request.user.id);
    const values = [request.params.projectId];
    const clauses = ['t.project_id = $1'];
    for (const key of ['status', 'priority', 'assignee_id']) {
      if (request.query[key]) {
        if (key === 'assignee_id' && request.query[key] === 'unassigned') clauses.push('t.assignee_id IS NULL');
        else { values.push(request.query[key]); clauses.push(`t.${key} = $${values.length}`); }
      }
    }
    if (request.query.search) {
      values.push(request.query.search);
      clauses.push(`strpos(lower(t.title || ' ' || t.description), lower($${values.length})) > 0`);
    }
    const { rows } = await pool.query(`${taskSelect} WHERE ${clauses.join(' AND ')} ORDER BY t.created_at DESC, t.id`, values);
    return { tasks: rows };
  });
  app.post('/api/projects/:projectId/tasks', protectedRoute({ params: s.params('projectId'), body: s.object(s.taskFields, ['title']) }), async (request, reply) => {
    const task = await withProject(request, false, async (db, project) => {
      const b = request.body;
      await ensureAssignee(db, project, request.user.id, b.assignee_id);
      const { rows } = await db.query(`INSERT INTO tasks(project_id, title, description, status, priority, assignee_id, due_date, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [request.params.projectId, b.title.trim(), b.description || '', b.status || 'todo', b.priority || 'media', b.assignee_id || null, b.due_date || null, request.user.id]);
      return rows[0];
    });
    return reply.code(201).send({ task });
  });
  app.get('/api/projects/:projectId/tasks/:taskId', protectedRoute({ params: s.params('projectId', 'taskId') }), async request => {
    await projectAccess(pool, request.params.projectId, request.user.id);
    return { task: await taskAccess(pool, request.params.projectId, request.params.taskId) };
  });
  app.patch('/api/projects/:projectId/tasks/:taskId', protectedRoute({ params: s.params('projectId', 'taskId'), body: { ...s.object(s.taskFields), minProperties: 1 } }), async request => ({ task: await withProject(request, false, async (db, project) => {
    await taskAccess(db, request.params.projectId, request.params.taskId);
    await ensureAssignee(db, project, request.user.id, request.body.assignee_id);
    const entries = Object.entries(request.body);
    const values = entries.map(([key, value]) => key === 'title' ? value.trim() : value);
    const assignments = entries.map(([key], i) => `${key} = $${i + 1}`);
    values.push(request.params.taskId, request.params.projectId);
    const { rows } = await db.query(`UPDATE tasks SET ${assignments.join(', ')}, updated_at = now() WHERE id = $${values.length - 1} AND project_id = $${values.length} RETURNING *`, values);
    return rows[0];
  }) }));
  app.delete('/api/projects/:projectId/tasks/:taskId', protectedRoute({ params: s.params('projectId', 'taskId') }), async (request, reply) => {
    await withProject(request, false, async db => {
      await taskAccess(db, request.params.projectId, request.params.taskId);
      await db.query('DELETE FROM tasks WHERE id = $1 AND project_id = $2', [request.params.taskId, request.params.projectId]);
    });
    return reply.code(204).send();
  });
  app.get('/api/projects/:projectId/tasks/:taskId/comments', protectedRoute({ params: s.params('projectId', 'taskId') }), async request => {
    await projectAccess(pool, request.params.projectId, request.user.id);
    await taskAccess(pool, request.params.projectId, request.params.taskId);
    const { rows } = await pool.query(`SELECT c.*, u.name AS author_name FROM comments c JOIN users u ON u.id = c.author_id WHERE c.task_id = $1 ORDER BY c.created_at, c.id`, [request.params.taskId]);
    return { comments: rows };
  });
  app.post('/api/projects/:projectId/tasks/:taskId/comments', protectedRoute({ params: s.params('projectId', 'taskId'), body: s.object({ body: s.text(5000, 1) }, ['body']) }), async (request, reply) => {
    const comment = await withProject(request, false, async db => {
      await taskAccess(db, request.params.projectId, request.params.taskId);
      const { rows } = await db.query('INSERT INTO comments(id, task_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING *', [randomUUID(), request.params.taskId, request.user.id, request.body.body.trim()]);
      return { ...rows[0], author_name: request.user.name };
    });
    return reply.code(201).send({ comment });
  });

  // Serve the Vite build with Node.js, without an additional static-file dependency.
  const dist = path.resolve(__dirname, '../../Frontend/dist');
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.split('?')[0].startsWith('/api/') || !['GET', 'HEAD'].includes(request.method)) throw httpError(404, 'Ruta no encontrada.');
    let url;
    try { url = decodeURIComponent(request.url.split('?')[0]); } catch { throw httpError(400, 'Ruta inválida.'); }
    const target = path.resolve(dist, `.${url === '/' ? '/index.html' : url}`);
    if (!target.startsWith(dist + path.sep)) throw httpError(404, 'Ruta no encontrada.');
    try {
      const data = await fs.readFile(target);
      reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      return reply.type(mime[path.extname(target)] || 'application/octet-stream').send(data);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') throw httpError(404, 'Recurso no encontrado. Para usar la interfaz, ejecuta npm run build en Frontend.');
      throw error;
    }
  });
  return app;
}
module.exports = { buildApp };
