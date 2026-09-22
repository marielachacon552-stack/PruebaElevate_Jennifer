const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { createPool } = require('../src/db');
const { migrate } = require('../src/migrate');
const { buildApp } = require('../src/app');
const { tokenHash } = require('../src/auth');

test('API con PostgreSQL real: persistencia, permisos y validación', async t => {
  const admin = createPool();
  const schema = `test_elevate_${randomUUID().replaceAll('-', '')}`;
  let pool, app;
  // Only the uniquely named test schema is created/deleted; application data is untouched.
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ ...admin.options, password: process.env.DB_PASSWORD, options: `-c search_path=${schema}` });
    assert.deepEqual(await migrate(pool), ['001_initial.sql', '002_numeric_ids.sql']);
    app = buildApp({ pool, authLimit: 500, closePool: false });
    await app.ready();
    const call = (method, url, cookie, payload, extraHeaders = {}) => app.inject({ method, url: `/api${url}`, headers: { 'x-requested-with': 'Elevate', ...(cookie ? { cookie } : {}), ...extraHeaders }, ...(payload !== undefined ? { payload } : {}) });
    const register = async (name, email) => {
      const response = await call('POST', '/auth/register', null, { name, email, password: 'PruebaSegura123!' });
      assert.equal(response.statusCode, 201, response.body);
      return { ...response.json().user, cookie: response.headers['set-cookie'].split(';')[0] };
    };
    const owner = await register('Propietaria', 'owner@example.test');
    const member = await register('Colaboradora', 'member@example.test');
    const outsider = await register('Persona ajena', 'outsider@example.test');
    assert.deepEqual([owner.id, member.id, outsider.id], [1, 2, 3]);
    let project, task, secondProject;

    await t.test('migraciones idempotentes y contraseña protegida', async () => {
      assert.deepEqual(await migrate(pool), []);
      const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [owner.id]);
      assert.match(rows[0].password_hash, /^scrypt:/);
      assert.ok(!rows[0].password_hash.includes('PruebaSegura123!'));
      const { rows: sessions } = await pool.query('SELECT token_hash FROM sessions WHERE user_id = $1', [owner.id]);
      assert.notEqual(sessions[0].token_hash, owner.cookie.slice(8));
    });
    await t.test('autenticación, correo normalizado y duplicados', async () => {
      assert.equal((await call('GET', '/auth/me', owner.cookie)).json().user.id, owner.id);
      assert.equal((await call('GET', '/projects')).statusCode, 401);
      assert.equal((await call('POST', '/auth/login', null, { email: 'owner@example.test', password: 'Incorrecta123' })).statusCode, 401);
      assert.equal((await call('POST', '/auth/login', null, { email: 'unknown@example.test', password: 'Incorrecta123' })).statusCode, 401);
      const login = await call('POST', '/auth/login', owner.cookie, { email: 'OWNER@example.test', password: 'PruebaSegura123!' });
      assert.equal(login.statusCode, 200, login.body);
      assert.match(login.headers['set-cookie'], /HttpOnly; SameSite=Lax/);
      assert.equal((await call('GET', '/auth/me', owner.cookie)).statusCode, 401);
      owner.cookie = login.headers['set-cookie'].split(';')[0];
      assert.equal((await call('POST', '/auth/register', null, { name: 'Otro', email: 'OWNER@example.test', password: 'PruebaSegura123!' })).statusCode, 409);
    });
    await t.test('validación estricta y protección de solicitudes', async () => {
      assert.equal((await call('POST', '/projects', owner.cookie, { name: '   ' })).statusCode, 400);
      assert.equal((await call('POST', '/projects', owner.cookie, { name: 'Prueba', owner_id: outsider.id })).statusCode, 400);
      assert.equal((await call('GET', '/projects/no-es-uuid', owner.cookie)).statusCode, 400);
      for (const id of ['0', '-1', '1.5', '01', '2147483648', randomUUID()]) {
        assert.equal((await call('GET', `/projects/${id}`, owner.cookie)).statusCode, 400);
      }
      assert.equal((await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: owner.cookie }, payload: { name: 'CSRF' } })).statusCode, 403);
    });
    await t.test('crear proyectos y registrar al propietario como miembro', async () => {
      const response = await call('POST', '/projects', owner.cookie, { name: 'Proyecto real', description: 'Prueba de persistencia' });
      assert.equal(response.statusCode, 201, response.body); project = response.json().project;
      secondProject = (await call('POST', '/projects', owner.cookie, { name: 'Segundo proyecto' })).json().project;
      assert.deepEqual([project.id, secondProject.id], [1, 2]);
      const listing = (await call('GET', '/projects', owner.cookie)).json().projects;
      assert.equal(listing.length, 2);
      assert.equal(listing.find(p => p.id === project.id).member_count, 1);
      assert.equal((await call('GET', '/projects', outsider.cookie)).json().projects.length, 0);
      assert.equal((await call('GET', `/projects/${project.id}`, outsider.cookie)).statusCode, 404);
      assert.equal((await call('GET', `/projects/${project.id}/tasks`, outsider.cookie)).statusCode, 404);
    });
    await t.test('miembros muchos a muchos y administración exclusiva del propietario', async () => {
      assert.equal((await call('POST', `/projects/${project.id}/members`, owner.cookie, { email: member.email })).statusCode, 201);
      assert.equal((await call('POST', `/projects/${secondProject.id}/members`, owner.cookie, { email: member.email })).statusCode, 201);
      assert.equal((await call('GET', '/projects', member.cookie)).json().projects.length, 2);
      assert.equal((await call('POST', `/projects/${project.id}/members`, owner.cookie, { email: member.email })).statusCode, 409);
      assert.equal((await call('POST', `/projects/${project.id}/members`, member.cookie, { email: outsider.email })).statusCode, 403);
      assert.equal((await call('PATCH', `/projects/${project.id}`, member.cookie, { name: 'No permitido' })).statusCode, 403);
      assert.equal((await call('DELETE', `/projects/${project.id}`, member.cookie)).statusCode, 403);
      assert.equal((await call('DELETE', `/projects/${project.id}/members/${owner.id}`, owner.cookie)).statusCode, 400);
    });
    await t.test('crear tarea completa y comprobar registro SQL', async () => {
      const response = await call('POST', `/projects/${project.id}/tasks`, member.cookie, { title: 'Tarea persistida', description: 'Descripción de prueba', status: 'todo', priority: 'alta', assignee_id: member.id, due_date: '2026-12-20' });
      assert.equal(response.statusCode, 201, response.body); task = response.json().task;
      assert.equal(task.id, 1);
      const stored = (await pool.query('SELECT * FROM tasks WHERE id = $1', [task.id])).rows[0];
      assert.equal(stored.title, 'Tarea persistida'); assert.equal(stored.due_date, '2026-12-20');
      assert.equal(stored.assignee_id, member.id);
      assert.equal((await call('GET', `/projects/${project.id}/tasks/${task.id}`, owner.cookie)).statusCode, 200);
    });
    await t.test('validar estados, fechas, prioridades y asignaciones ajenas', async () => {
      for (const invalid of [{ status: 'other' }, { priority: 'urgente' }, { due_date: '2026-02-30' }, { assignee_id: 2147483647 }, { title: '   ' }, { id: randomUUID() }, {}]) {
        const response = await call('PATCH', `/projects/${project.id}/tasks/${task.id}`, owner.cookie, invalid);
        assert.equal(response.statusCode, 400, response.body);
      }
      assert.equal((await call('POST', `/projects/${project.id}/tasks`, outsider.cookie, { title: 'Ajena' })).statusCode, 404);
      assert.equal((await call('PATCH', `/projects/${project.id}/tasks/${task.id}`, outsider.cookie, { status: 'done' })).statusCode, 404);
      assert.equal((await call('GET', `/projects/${secondProject.id}/tasks/${task.id}`, owner.cookie)).statusCode, 404);
      assert.equal((await call('PATCH', `/projects/${secondProject.id}/tasks/${task.id}`, owner.cookie, { status: 'done' })).statusCode, 404);
    });
    await t.test('filtros individuales, combinados y búsqueda', async () => {
      for (const query of ['status=todo', 'priority=alta', `assignee_id=${member.id}`, `status=todo&priority=alta&assignee_id=${member.id}`, 'search=persistida']) {
        const response = await call('GET', `/projects/${project.id}/tasks?${query}`, member.cookie);
        assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().tasks.length, 1);
      }
      assert.equal((await call('GET', `/projects/${project.id}/tasks?status=done`, member.cookie)).json().tasks.length, 0);
      assert.equal((await call('GET', `/projects/${project.id}/tasks?status=invalid`, owner.cookie)).statusCode, 400);
      assert.equal((await call('GET', `/projects/${project.id}/tasks?assignee_id=0`, owner.cookie)).statusCode, 400);
      assert.equal((await call('PATCH', `/projects/${project.id}/tasks/${task.id}`, owner.cookie, { assignee_id: String(member.id) })).statusCode, 400);
      assert.equal((await call('GET', `/projects/${project.id}/tasks?search=%27%20OR%201%3D1--`, owner.cookie)).json().tasks.length, 0);
    });
    await t.test('comentarios colaborativos y aislamiento entre proyectos', async () => {
      const path = `/projects/${project.id}/tasks/${task.id}/comments`;
      assert.equal((await call('POST', path, member.cookie, { body: 'Actualización del equipo' })).statusCode, 201);
      const comments = (await call('GET', path, owner.cookie)).json().comments;
      assert.equal(comments.length, 1); assert.equal(comments[0].author_name, member.name);
      assert.equal((await call('POST', path, member.cookie, { body: '  ' })).statusCode, 400);
      assert.equal((await call('POST', path, outsider.cookie, { body: 'Ajeno' })).statusCode, 404);
      assert.equal((await call('GET', path, outsider.cookie)).statusCode, 404);
      assert.equal((await call('GET', `/projects/${secondProject.id}/tasks/${task.id}/comments`, owner.cookie)).statusCode, 404);
    });
    await t.test('editar, cambiar estado y actualizar resumen', async () => {
      assert.equal((await call('PATCH', `/projects/${project.id}/tasks/${task.id}`, member.cookie, { status: 'doing', title: 'Título nuevo' })).statusCode, 200);
      assert.equal((await call('PATCH', `/projects/${project.id}/tasks/${task.id}`, member.cookie, { status: 'done', due_date: null })).statusCode, 200);
      const summary = (await call('GET', '/projects', owner.cookie)).json().projects.find(p => p.id === project.id);
      assert.equal(summary.task_count, 1); assert.equal(summary.done_count, 1);
      assert.equal((await call('PATCH', `/projects/${project.id}`, owner.cookie, { name: 'Proyecto editado' })).json().project.name, 'Proyecto editado');
    });
    await t.test('persistencia después de recrear la aplicación', async () => {
      await app.close(); app = buildApp({ pool, authLimit: 500, closePool: false }); await app.ready();
      assert.equal((await call('GET', `/projects/${project.id}/tasks/${task.id}`, member.cookie)).json().task.title, 'Título nuevo');
      assert.equal((await call('GET', `/projects/${project.id}/tasks/${task.id}/comments`, member.cookie)).json().comments.length, 1);
    });
    await t.test('quitar miembro revoca el acceso y libera sus tareas', async () => {
      assert.equal((await call('DELETE', `/projects/${project.id}/members/${member.id}`, owner.cookie)).statusCode, 204);
      assert.equal((await call('GET', `/projects/${project.id}/tasks`, member.cookie)).statusCode, 404);
      assert.equal((await call('GET', `/projects/${project.id}/tasks?assignee_id=unassigned`, owner.cookie)).json().tasks.length, 1);
      assert.equal((await call('GET', `/projects/${project.id}/tasks/${task.id}`, owner.cookie)).json().task.assignee_id, null);
    });
    await t.test('eliminar tarea borra comentarios; eliminar proyecto borra relaciones', async () => {
      assert.equal((await call('DELETE', `/projects/${project.id}/tasks/${task.id}`, owner.cookie)).statusCode, 204);
      assert.equal((await pool.query('SELECT * FROM comments WHERE task_id = $1', [task.id])).rowCount, 0);
      assert.equal((await call('GET', `/projects/${project.id}/tasks/${task.id}`, owner.cookie)).statusCode, 404);
      await call('POST', `/projects/${secondProject.id}/tasks`, owner.cookie, { title: 'Tarea en cascada', assignee_id: member.id });
      const response = await call('DELETE', `/projects/${secondProject.id}`, owner.cookie);
      assert.equal(response.statusCode, 204, response.body);
      assert.equal((await pool.query('SELECT * FROM tasks WHERE project_id = $1', [secondProject.id])).rowCount, 0);
      assert.equal((await pool.query('SELECT * FROM project_members WHERE project_id = $1', [secondProject.id])).rowCount, 0);
    });
    await t.test('sesiones vencidas, cierre e invalidación de cookies', async () => {
      await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [tokenHash(outsider.cookie.slice('session='.length))]);
      assert.equal((await call('GET', '/auth/me', outsider.cookie)).statusCode, 401);
      const logout = await call('POST', '/auth/logout', owner.cookie);
      assert.equal(logout.statusCode, 204); assert.match(logout.headers['set-cookie'], /Max-Age=0/);
      assert.equal((await call('GET', '/auth/me', owner.cookie)).statusCode, 401);
    });
    await t.test('límite de intentos de autenticación', async () => {
      const limited = buildApp({ pool, authLimit: 1, closePool: false });
      try {
        const request = { method: 'POST', url: '/api/auth/login', headers: { 'x-requested-with': 'Elevate' }, payload: { email: 'nobody@example.test', password: 'Incorrecta123' } };
        assert.equal((await limited.inject(request)).statusCode, 401);
        const response = await limited.inject(request);
        assert.equal(response.statusCode, 429); assert.ok(response.headers['retry-after']);
      } finally { await limited.close(); }
    });
    await t.test('asignar usuarios registrados a varios proyectos y conservar los permisos', async () => {
      const manager = await register('Responsable', 'manager@example.test');
      const colleague = await register('Colaboradora nueva', 'colleague@example.test');
      const external = await register('Persona externa', 'external@example.test');
      const first = (await call('POST', '/projects', manager.cookie, { name: 'Equipo A' })).json().project;
      const second = (await call('POST', '/projects', manager.cookie, { name: 'Equipo B' })).json().project;
      const directory = (await call('GET', `/projects/${first.id}/assignees`, manager.cookie)).json();
      assert.deepEqual(directory.members.map(person => person.id), [manager.id]);
      assert.ok(directory.candidates.some(person => person.id === colleague.id));
      assert.ok(directory.candidates.every(person => Object.keys(person).sort().join(',') === 'email,id,name'));
      assert.equal((await call('GET', `/projects/${first.id}/assignees`, external.cookie)).statusCode, 404);
      assert.equal((await call('GET', `/projects/${first.id}/assignees`)).statusCode, 401);
      const created = await call('POST', `/projects/${first.id}/tasks`, manager.cookie, { title: 'Asignar e incorporar', assignee_id: colleague.id });
      assert.equal(created.statusCode, 201, created.body);
      assert.equal(created.json().task.assignee_id, colleague.id);
      const unassigned = (await call('POST', `/projects/${second.id}/tasks`, manager.cookie, { title: 'Asignación posterior' })).json().task;
      assert.equal((await call('PATCH', `/projects/${second.id}/tasks/${unassigned.id}`, manager.cookie, { assignee_id: colleague.id })).statusCode, 200);
      assert.deepEqual((await call('GET', '/projects', colleague.cookie)).json().projects.map(p => p.id).sort((a, b) => a - b), [first.id, second.id]);
      assert.equal((await call('GET', `/projects/${first.id}/tasks`, colleague.cookie)).statusCode, 200);
      const memberDirectory = (await call('GET', `/projects/${first.id}/assignees`, colleague.cookie)).json();
      assert.deepEqual(memberDirectory.candidates, []);
      assert.equal(memberDirectory.members.length, 2);
      const updatedDirectory = (await call('GET', `/projects/${first.id}/assignees`, manager.cookie)).json();
      assert.ok(!updatedDirectory.candidates.some(person => person.id === colleague.id));
      assert.equal((await call('POST', `/projects/${first.id}/tasks`, colleague.cookie, { title: 'No autorizado', assignee_id: external.id })).statusCode, 403);
      assert.equal((await call('PATCH', `/projects/${first.id}/tasks/${created.json().task.id}`, colleague.cookie, { assignee_id: external.id })).statusCode, 403);
      assert.equal((await call('PATCH', `/projects/${first.id}/tasks/2147483647`, manager.cookie, { assignee_id: external.id })).statusCode, 404);
      assert.equal((await call('GET', `/projects/${first.id}/tasks`, external.cookie)).statusCode, 404);
      const repeated = await call('POST', `/projects/${first.id}/tasks`, manager.cookie, { title: 'Otra tarea', assignee_id: colleague.id });
      assert.equal(repeated.statusCode, 201);
      assert.equal((await call('GET', `/projects/${first.id}/members`, manager.cookie)).json().members.length, 2);
      assert.equal((await call('DELETE', `/projects/${first.id}/members/${colleague.id}`, manager.cookie)).statusCode, 204);
      assert.equal((await call('GET', `/projects/${first.id}/tasks`, colleague.cookie)).statusCode, 404);
      assert.equal((await call('GET', `/projects/${second.id}/tasks`, colleague.cookie)).statusCode, 200);
    });
  } finally {
    if (app) await app.close();
    if (pool) await pool.end();
    // Identifier is internally generated, never an environment value or user input.
    assert.match(schema, /^test_elevate_[a-f0-9]{32}$/);
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
