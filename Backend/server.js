const { createPool } = require('./src/db');
const { migrate } = require('./src/migrate');
const { buildApp } = require('./src/app');

async function start() {
  const pool = createPool();
  const app = buildApp({ pool, logger: true });
  try {
    const applied = await migrate(pool);
    if (applied.length) app.log.info({ migrations: applied }, 'Migraciones aplicadas');
    await app.listen({ port: Number(process.env.PORT || 3000), host: process.env.HOST || '127.0.0.1' });
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exitCode = 1;
  }
  const shutdown = async () => { await app.close(); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
start();
