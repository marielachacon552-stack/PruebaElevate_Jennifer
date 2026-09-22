// Browser smoke test using only Node.js and an installed Chromium browser.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { createPool } = require('../src/db');
const { migrate } = require('../src/migrate');
const { buildApp } = require('../src/app');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const admin = createPool();
  const schema = `test_browser_${randomUUID().replaceAll('-', '')}`;
  const artifacts = path.resolve(__dirname, '../../artifacts');
  let pool, app, browser, socket, send, sessionId;
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  try {
    await fs.access(path.resolve(__dirname, '../../Frontend/dist/index.html'));
    const candidates = [process.env.BROWSER_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
    let executable;
    for (const candidate of candidates) { try { await fs.access(candidate); executable = candidate; break; } catch {} }
    if (!executable) throw new Error('Define BROWSER_PATH con la ruta de Chrome o Edge.');
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ ...admin.options, password: process.env.DB_PASSWORD, options: `-c search_path=${schema}` });
    await migrate(pool);
    app = buildApp({ pool, closePool: false });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const registerPerson = async (name, email) => {
      const response = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'x-requested-with': 'Elevate' }, payload: { name, email, password: 'PruebaSegura123!' } });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().user;
    };
    const colleague = await registerPerson('Ana Colaboradora', 'ana-ui@example.test');
    const teammate = await registerPerson('María Colaboradora', 'maria-ui@example.test');
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'elevate-browser-'));
    browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      let buffer = '';
      const timeout = setTimeout(() => reject(new Error('El navegador no inició en 20 segundos.')), 20000);
      browser.once('error', error => { clearTimeout(timeout); reject(error); });
      browser.stderr.on('data', data => { buffer += data; const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const data = JSON.parse(event.data);
      if (data.id && pending.has(data.id)) { const request = pending.get(data.id); pending.delete(data.id); clearTimeout(request.timeout); data.error ? request.reject(new Error(data.error.message)) : request.resolve(data.result); }
      if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    });
    send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 10000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
    const target = await send('Target.createTarget', { url: 'about:blank' });
    sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    await send('Runtime.enable'); await send('Page.enable');
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async expression => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) { if (await evaluate(expression)) return; await delay(100); }
      throw new Error(`No se cumplió: ${expression}. Pantalla: ${await evaluate('document.body.innerText')}`);
    };
    const click = text => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('Botón no encontrado'); button.click(); })()`);
    const fill = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Campo no encontrado'); const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const submit = () => evaluate("document.querySelector('dialog[open] form, form').requestSubmit()");
    const screenshot = async name => { await fs.mkdir(artifacts, { recursive: true }); const result = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(artifacts, name), Buffer.from(result.data, 'base64')); };
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: address });
    await waitFor("!!document.querySelector('input[name=email]') && !!document.querySelector('input[name=password]')");
    await screenshot('login-desktop.png');
    await click('Crear cuenta');
    await fill('[name="name"]', 'Jennifer Prueba');
    await fill('[name="email"]', 'jennifer-ui@example.test');
    await fill('[name="password"]', 'PruebaSegura123!');
    await submit();
    await waitFor("document.body.innerText.includes('Hola, Jennifer')");
    console.log('OK: registro e inicio de sesión desde el navegador');
    await click('Nuevo proyecto');
    await fill('dialog [name="name"]', 'Lanzamiento Elevate');
    await fill('dialog [name="description"]', 'Un espacio para organizar nuestras ideas y construir la próxima experiencia del equipo.');
    await submit();
    await waitFor("document.querySelector('main h1')?.textContent === 'Lanzamiento Elevate'");
    await click('Nueva tarea');
    await fill('dialog [name="title"]', 'Diseñar la experiencia del equipo');
    await fill('dialog [name="description"]', 'Definir los primeros pasos y compartir una propuesta con el equipo.');
    await fill('dialog [name="priority"]', 'alta');
    await fill('dialog [name="due_date"]', '2026-12-20');
    await waitFor("document.querySelector('dialog [name=assignee_id]')?.disabled === false");
    await fill('dialog [name="assignee_id"]', String(colleague.id));
    await waitFor("document.querySelector('#assignee-help').textContent.includes('Ana Colaboradora se añadirá')");
    await submit();
    await waitFor("document.querySelector('.task-title')?.textContent === 'Diseñar la experiencia del equipo' && !document.querySelector('dialog[open]')");
    await waitFor("document.querySelector('.task-item .assignee')?.textContent.includes('Ana Colaboradora') && document.querySelector('.team-button').textContent.includes('2 miembros')");
    assert.equal(await evaluate("!!document.querySelector('.task-table')"), true, 'Las tareas abren en lista');
    assert.equal(await evaluate("!!document.querySelector('button[title=\"Eliminar proyecto\"]')"), false, 'Eliminar queda fuera de la vista de tareas');
    await evaluate("document.querySelector('.team-button').click()");
    await waitFor("document.querySelector('.team-panel [name=member_email]')?.disabled === false");
    await fill('.team-panel [name="member_email"]', teammate.email);
    await click('Añadir al proyecto');
    await waitFor("document.querySelectorAll('.team-panel .member').length === 3 && document.querySelector('.team-panel form button')?.textContent.includes('Añadir al proyecto')");
    await screenshot('team-desktop.png');
    await evaluate("document.querySelector('#project-tab-settings').click()");
    await waitFor("!!document.querySelector('.settings-panel')");
    await screenshot('settings-desktop.png');
    await click('Editar proyecto');
    await fill('dialog [name="description"]', 'Organizamos las tareas, las personas y los avances del lanzamiento en un solo lugar.');
    await submit();
    await waitFor("!document.querySelector('dialog[open]') && document.querySelector('.settings-card dd:last-child')?.textContent.includes('Organizamos las tareas')");
    await click('Eliminar proyecto');
    await waitFor("document.querySelector('dialog h2')?.textContent === '¿Eliminar este proyecto?'");
    await click('Cancelar');
    await evaluate("document.querySelector('#project-tab-tasks').click()");
    await click('Tablero');
    await fill('.status-select', 'doing');
    await waitFor("document.querySelector('.board-column.doing .task-title') !== null");
    await click('Diseñar la experiencia del equipo');
    await waitFor("document.querySelector('#comment-body') && !document.body.innerText.includes('Cargando comentarios…')");
    await fill('#comment-body', 'La propuesta está lista para revisar en equipo.');
    await click('Publicar comentario');
    await waitFor("document.querySelector('.comment p')?.textContent === 'La propuesta está lista para revisar en equipo.'");
    await screenshot('task-comments.png');
    await evaluate("document.querySelector('dialog button[aria-label=Cerrar]').click()");
    await waitFor("!document.querySelector('dialog[open]')");
    await click('Filtros');
    await fill('[aria-label="Filtrar por prioridad"]', 'baja');
    await waitFor("document.body.innerText.includes('Sin tareas con estos filtros')");
    await click('Limpiar');
    await waitFor("document.querySelector('.task-card') && !document.body.innerText.includes('Cargando tareas…')");
    await click('Filtros');
    await click('Asignadas a mí');
    await waitFor("document.body.innerText.includes('Sin tareas con estos filtros')");
    await click('Limpiar');
    await waitFor("document.querySelector('.task-card') && !document.body.innerText.includes('Cargando tareas…')");
    for (const fixture of [
      { title: 'Preparar los contenidos de lanzamiento', status: 'todo', priority: 'alta', assignee: String(teammate.id), date: '2026-12-22' },
      { title: 'Revisar la propuesta visual', status: 'todo', priority: 'media', assignee: String(colleague.id), date: '2026-12-23' },
      { title: 'Definir los objetivos del proyecto', status: 'done', priority: 'media', assignee: String(teammate.id), date: '2026-12-15' },
    ]) {
      await click('Nueva tarea');
      await fill('dialog [name="title"]', fixture.title);
      await fill('dialog [name="status"]', fixture.status);
      await fill('dialog [name="priority"]', fixture.priority);
      await fill('dialog [name="due_date"]', fixture.date);
      await waitFor("document.querySelector('dialog [name=assignee_id]')?.disabled === false");
      await fill('dialog [name="assignee_id"]', fixture.assignee);
      await submit();
      await waitFor(`!document.querySelector('dialog[open]') && [...document.querySelectorAll('.task-title')].some(el => el.textContent === ${JSON.stringify(fixture.title)})`);
    }
    await screenshot('project-desktop.png');
    await click('Lista');
    assert.equal(await evaluate("document.querySelectorAll('.task-table tbody tr').length"), 4);
    await screenshot('tasks-list-desktop.png');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Sin desbordamiento horizontal en escritorio');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(200);
    await screenshot('project-mobile.png');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Sin desbordamiento horizontal en móvil');
    await evaluate("document.querySelector('#project-tab-team').click()");
    await waitFor("document.querySelectorAll('.team-panel .member').length === 3");
    await screenshot('team-mobile.png');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Equipo sin desbordamiento en móvil');
    await evaluate("document.querySelector('#project-tab-settings').click()");
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Ajustes sin desbordamiento en móvil');
    await evaluate("document.querySelector('#project-tab-tasks').click()");
    await click('Tablero');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Tablero sin desbordamiento en móvil');
    console.log('OK: proyecto, tarea, asignación, cambio de estado, comentario, filtros y tamaños escritorio/móvil');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await click('Todos los proyectos');
    await waitFor("document.querySelector('.project-card h3')?.textContent === 'Lanzamiento Elevate'");
    await screenshot('projects-desktop.png');
    await fill('[aria-label="Buscar proyectos"]', 'Sin coincidencia');
    await waitFor("document.body.innerText.includes('No hay proyectos con estos filtros')");
    await click('Ver todos los proyectos');
    await click('Soy miembro');
    await waitFor("document.body.innerText.includes('No hay proyectos con estos filtros')");
    await click('Todos');
    await waitFor("!!document.querySelector('.project-card')");
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await screenshot('projects-mobile.png');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Proyectos sin desbordamiento en móvil');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.reload');
    await waitFor("document.querySelector('.project-card h3')?.textContent === 'Lanzamiento Elevate'");
    await evaluate("document.querySelector('button[title=\"Cerrar sesión\"]').click()");
    await waitFor("!!document.querySelector('input[name=email]') && !!document.querySelector('input[name=password]')");
    await fill('[name="email"]', 'jennifer-ui@example.test');
    await fill('[name="password"]', 'PruebaSegura123!');
    await submit();
    await waitFor("document.querySelector('.project-card h3')?.textContent === 'Lanzamiento Elevate'");
    console.log('OK: persistencia tras recargar y cerrar/reabrir sesión');
    await click('Nuevo proyecto');
    await fill('dialog [name="name"]', 'Segundo proyecto de equipo');
    await submit();
    await waitFor("document.querySelector('main h1')?.textContent === 'Segundo proyecto de equipo'");
    await click('Nueva tarea');
    await fill('dialog [name="title"]', 'Colaborar en otro proyecto');
    await waitFor("document.querySelector('dialog [name=assignee_id]')?.disabled === false");
    await fill('dialog [name="assignee_id"]', String(colleague.id));
    await submit();
    await waitFor("document.querySelector('.task-item .assignee')?.textContent.includes('Ana Colaboradora') && !document.querySelector('dialog[open]')");
    const memberships = await pool.query('SELECT count(*)::integer AS total FROM project_members WHERE user_id = $1', [colleague.id]);
    assert.equal(memberships.rows[0].total, 2);
    console.log('OK: otros usuarios visibles, alta de miembros desde selector y misma persona asignada en dos proyectos');
    console.log('OK: lista/tablero, navegación Tareas/Equipo/Ajustes, edición del proyecto, cancelación de eliminación, búsqueda y filtros por rol');
    assert.deepEqual(errors, [], 'Sin excepciones JavaScript en el navegador');
    console.log(`Capturas disponibles en ${artifacts}`);
  } finally {
    if (send && socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close', {}, null); } catch {} }
    socket?.close(); browser?.kill();
    for (const request of pending.values()) clearTimeout(request.timeout);
    if (app) await app.close();
    if (pool) await pool.end();
    assert.match(schema, /^test_browser_[a-f0-9]{32}$/);
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
