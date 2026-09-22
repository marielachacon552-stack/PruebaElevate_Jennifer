const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { createPool } = require('../src/db');
const { migrate } = require('../src/migrate');

test('convertir UUID existentes conserva datos, relaciones y secuencias', async () => {
  const admin = createPool();
  const schema = `test_ids_${randomUUID().replaceAll('-', '')}`;
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ ...admin.options, password: process.env.DB_PASSWORD, options: `-c search_path=${schema}` });
    const original = await fs.readFile(path.join(__dirname, '../migrations/001_initial.sql'), 'utf8');
    await pool.query(original);
    await pool.query('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await pool.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', ['001_initial.sql', createHash('sha256').update(original).digest('hex')]);
    const owner = randomUUID(), member = randomUUID(), project = randomUUID(), assigned = randomUUID(), unassigned = randomUUID(), comment = randomUUID();
    await pool.query(`INSERT INTO users(id, name, email, password_hash, created_at) VALUES
      ($1, 'Propietaria', 'owner@example.test', 'hash-original-1', '2026-01-01'),
      ($2, 'Miembro', 'member@example.test', 'hash-original-2', '2026-01-02')`, [owner, member]);
    await pool.query("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')", ['a'.repeat(64), owner]);
    await pool.query("INSERT INTO projects(id, name, description, owner_id) VALUES ($1, 'Proyecto existente', 'Descripción original', $2)", [project, owner]);
    await pool.query('INSERT INTO project_members(project_id, user_id) VALUES ($1, $2), ($1, $3)', [project, owner, member]);
    await pool.query(`INSERT INTO tasks(id, project_id, title, assignee_id, created_by, created_at) VALUES
      ($1, $3, 'Asignada', $4, $5, '2026-01-01'), ($2, $3, 'Sin asignar', NULL, $5, '2026-01-02')`, [assigned, unassigned, project, member, owner]);
    await pool.query("INSERT INTO comments(id, task_id, author_id, body) VALUES ($1, $2, $3, 'Comentario original')", [comment, assigned, member]);

    assert.deepEqual(await migrate(pool), ['002_numeric_ids.sql']);
    assert.deepEqual(await migrate(pool), []);
    assert.deepEqual((await pool.query('SELECT id, name, password_hash FROM users ORDER BY id')).rows, [
      { id: 1, name: 'Propietaria', password_hash: 'hash-original-1' }, { id: 2, name: 'Miembro', password_hash: 'hash-original-2' },
    ]);
    assert.deepEqual((await pool.query('SELECT id, owner_id, description FROM projects')).rows, [{ id: 1, owner_id: 1, description: 'Descripción original' }]);
    assert.deepEqual((await pool.query('SELECT project_id, user_id FROM project_members ORDER BY user_id')).rows, [{ project_id: 1, user_id: 1 }, { project_id: 1, user_id: 2 }]);
    assert.deepEqual((await pool.query('SELECT id, project_id, assignee_id, created_by FROM tasks ORDER BY id')).rows, [
      { id: 1, project_id: 1, assignee_id: 2, created_by: 1 }, { id: 2, project_id: 1, assignee_id: null, created_by: 1 },
    ]);
    assert.deepEqual((await pool.query('SELECT id, task_id, author_id, body FROM comments')).rows, [{ id: comment, task_id: 1, author_id: 2, body: 'Comentario original' }]);
    assert.equal((await pool.query('SELECT user_id FROM sessions')).rows[0].user_id, 1);
    assert.equal((await pool.query("INSERT INTO users(name, email, password_hash) VALUES ('Nueva', 'new@example.test', 'hash') RETURNING id")).rows[0].id, 3);
    assert.equal((await pool.query("INSERT INTO projects(name, owner_id) VALUES ('Nuevo', 1) RETURNING id")).rows[0].id, 2);
    assert.equal((await pool.query("INSERT INTO tasks(project_id, title, created_by) VALUES (1, 'Nueva', 1) RETURNING id")).rows[0].id, 3);
    await assert.rejects(pool.query('UPDATE tasks SET assignee_id = 3 WHERE id = 1'), { code: '23503' });
  } finally {
    if (pool) await pool.end();
    assert.match(schema, /^test_ids_[a-f0-9]{32}$/);
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
