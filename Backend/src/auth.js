const { randomBytes, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const deriveKey = promisify(scrypt);
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const tokenHash = token => createHash('sha256').update(token).digest('hex');
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await deriveKey(password, salt, 64);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [, salt, hash] = stored.split(':');
  const actual = await deriveKey(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function readToken(request) {
  const match = (request.headers.cookie || '').match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1];
}
function setCookie(reply, token, maxAge = SESSION_SECONDS) {
  reply.header('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
async function newSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  await db.query('DELETE FROM sessions WHERE expires_at <= now()');
  await db.query(`INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '7 days')`, [tokenHash(token), userId]);
  return token;
}
function httpError(statusCode, message) { return Object.assign(new Error(message), { statusCode }); }
module.exports = { hashPassword, verifyPassword, readToken, setCookie, newSession, tokenHash, httpError };
