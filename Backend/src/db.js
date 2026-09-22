const path = require('node:path');
const { Pool, types } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
types.setTypeParser(1082, value => value);
function createPool() {
  return new Pool({ user: process.env.DB_USER, host: process.env.DB_HOST,
    database: process.env.DB_NAME, password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 5432), connectionTimeoutMillis: 5000, max: 10 });
}
async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
module.exports = { createPool, transaction };
