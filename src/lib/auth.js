const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'webdev_app_session';
const JWT_SECRET = process.env.JWT_SECRET || process.env.MANUS_JWT_SECRET || 'taskora-local-development-secret-change-me';
const SESSION_DAYS = 7;

function cookieOptions() {
  const hosted = Boolean(process.env.MANUS_PROJECT_ID) || process.env.COOKIE_SECURE === 'true';
  return {
    httpOnly: true,
    secure: hosted,
    sameSite: hosted ? 'none' : 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
  };
}

function signSession(user) {
  return jwt.sign({ sub: String(user.id), username: user.username }, JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
}

function verifySession(token) {
  return jwt.verify(token, JWT_SECRET);
}

function setSessionCookie(res, user) {
  res.cookie(COOKIE_NAME, signSession(user), cookieOptions());
}

function clearSessionCookie(res) {
  const options = cookieOptions();
  delete options.maxAge;
  res.clearCookie(COOKIE_NAME, options);
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 12);
}

function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.display_name,
    avatarColor: user.avatar_color,
    avatarUrl: user.avatar_url,
    theme: user.theme,
    createdAt: user.created_at
  };
}

module.exports = {
  COOKIE_NAME,
  cookieOptions,
  signSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  hashPassword,
  comparePassword,
  publicUser
};
