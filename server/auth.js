const crypto = require('node:crypto');
const { db, tx } = require('./db');

const STARTING_USD = 100_000;
const COOKIE = 'dsx_session';

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createUser({ email, name, password }) {
  email = String(email || '').trim().toLowerCase();
  name = String(name || '').trim();
  password = String(password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Enter a valid email address.');
  if (name.length < 2 || name.length > 40) throw httpError(400, 'Name must be 2–40 characters.');
  if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw httpError(409, 'An account with this email already exists.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  return tx(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (email, name, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(email, name, hashPassword(password, salt), salt, Date.now());
    const id = Number(lastInsertRowid);
    db.prepare('INSERT INTO balances (user_id, asset, amount) VALUES (?, ?, ?)').run(id, 'USD', STARTING_USD);
    return id;
  });
}

function verifyLogin(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  if (!user) throw httpError(401, 'Wrong email or password.');
  const attempt = Buffer.from(hashPassword(String(password || ''), user.salt), 'hex');
  const stored = Buffer.from(user.pass_hash, 'hex');
  if (attempt.length !== stored.length || !crypto.timingSafeEqual(attempt, stored)) {
    throw httpError(401, 'Wrong email or password.');
  }
  return user.id;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, Date.now());
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function userFromToken(token) {
  if (!token) return null;
  return db
    .prepare('SELECT u.id, u.email, u.name, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
    .get(token) || null;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function tokenFromRequest(req) {
  return parseCookies(req.headers.cookie)[COOKIE] || null;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

/** Express middleware: attaches req.user or responds 401. */
function requireUser(req, res, next) {
  const user = userFromToken(tokenFromRequest(req));
  if (!user) return res.status(401).json({ error: 'Please log in.' });
  req.user = user;
  next();
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = {
  STARTING_USD,
  createUser,
  verifyLogin,
  createSession,
  destroySession,
  userFromToken,
  tokenFromRequest,
  setSessionCookie,
  clearSessionCookie,
  requireUser,
  httpError,
};
