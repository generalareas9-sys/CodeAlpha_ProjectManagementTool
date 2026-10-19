const express = require('express');
const { validationResult } = require('express-validator');
const { db } = require('../db/connection');
const { registrationRules, loginRules } = require('../lib/validation');
const { comparePassword, hashPassword, setSessionCookie, clearSessionCookie, publicUser } = require('../lib/auth');
const { sendError, sendOk } = require('../lib/response');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function validationErrors(req) {
  const result = validationResult(req);
  return result.isEmpty() ? null : result.array().map((item) => item.msg);
}

router.post('/register', registrationRules, (req, res) => {
  const errors = validationErrors(req);
  if (errors) return sendError(res, 422, errors[0], 'VALIDATION_ERROR', errors);

  const username = req.body.username.trim();
  const email = req.body.email.trim().toLowerCase();
  const displayName = (req.body.displayName || username).trim();
  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(username, email);
  if (existing) return sendError(res, 409, 'That username or email is already in use.', 'IDENTITY_TAKEN');

  const result = db.prepare('INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)').run(username, email, hashPassword(req.body.password), displayName);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  setSessionCookie(res, user);
  return res.status(201).json({ data: { user: publicUser(user) } });
});

router.post('/login', loginRules, (req, res) => {
  const errors = validationErrors(req);
  if (errors) return sendError(res, 422, errors[0], 'VALIDATION_ERROR', errors);

  const identifier = req.body.identifier.trim();
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(identifier, identifier.toLowerCase());
  if (!user || !comparePassword(req.body.password, user.password_hash)) return sendError(res, 401, 'Your login details are incorrect.', 'INVALID_CREDENTIALS');

  setSessionCookie(res, user);
  return sendOk(res, { user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  return sendOk(res, { loggedOut: true });
});

router.get('/me', requireAuth, (req, res) => sendOk(res, { user: req.user.public }));

module.exports = router;
