const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createPool, transaction } = require('./db');
async function migrate(pool) {
  const directory = path.join(__dirname, '..', 'migrations');
  const files = (await fs.readdir(directory)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  return transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(74291305)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const applied = new Map((await client.query('SELECT version, checksum FROM schema_migrations')).rows.map(row => [row.version, row.checksum]));
    const executed = [];
    for (const file of files) {
      const sql = await fs.readFile(path.join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (applied.has(file)) {
        if (applied.get(file) !== checksum) throw new Error(`La migración ${file} ya fue aplicada y no debe modificarse.`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [file, checksum]);
      executed.push(file);
    }
    return executed;
  });
}
if (require.main === module) {
  const pool = createPool();
  migrate(pool).then(files => console.log(files.length ? `Migraciones aplicadas: ${files.join(', ')}` : 'Base de datos actualizada.'))
    .catch(error => { console.error('No se pudieron aplicar las migraciones:', error.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
module.exports = { migrate };
