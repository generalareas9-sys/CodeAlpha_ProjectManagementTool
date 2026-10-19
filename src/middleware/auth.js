const { db } = require('../db/connection');
const { COOKIE_NAME, verifySession, publicUser } = require('../lib/auth');
const { sendError } = require('../lib/response');

function tokenFromRequest(req) {
  const bearer = req.get('authorization');
  if (bearer && bearer.startsWith('Bearer ')) return bearer.slice(7);
  return req.cookies?.[COOKIE_NAME];
}

function getUserFromRequest(req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  try {
    const payload = verifySession(token);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(payload.sub));
    return user ? { ...user, public: publicUser(user) } : null;
  } catch {
    return null;
  }
}

function attachUser(req, _res, next) {
  req.user = getUserFromRequest(req);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return sendError(res, 401, 'Please log in to continue.', 'AUTH_REQUIRED');
  next();
}

module.exports = { attachUser, requireAuth, getUserFromRequest };
