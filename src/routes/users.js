const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../db/connection');
const { hashPassword, comparePassword, publicUser } = require('../lib/auth');
const { sendError, sendOk } = require('../lib/response');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/me', (req, res) => sendOk(res, { user: req.user.public }));

router.put('/me', [
  body('displayName').optional().trim().isLength({ min: 2, max: 60 }).withMessage('Display name must be 2–60 characters.'),
  body('avatarColor').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Avatar color must be a hex color.'),
  body('avatarUrl').optional({ values: 'falsy' }).isURL({ protocols: ['http', 'https'] }).withMessage('Avatar URL must be a valid URL.'),
  body('theme').optional().isIn(['light', 'dark', 'system']).withMessage('Theme must be light, dark, or system.')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, errors.array()[0].msg, 'VALIDATION_ERROR');
  const allowed = {
    display_name: req.body.displayName,
    avatar_color: req.body.avatarColor,
    avatar_url: req.body.avatarUrl,
    theme: req.body.theme
  };
  const updates = Object.entries(allowed).filter(([, value]) => value !== undefined);
  if (updates.length) {
    const set = updates.map(([key]) => `${key} = ?`).join(', ');
    db.prepare(`UPDATE users SET ${set}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...updates.map(([, value]) => value), req.user.id);
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  return sendOk(res, { user: publicUser(user) });
});

router.put('/me/password', [
  body('currentPassword').notEmpty().withMessage('Enter your current password.'),
  body('newPassword').isLength({ min: 8, max: 72 }).withMessage('New password must be at least 8 characters.')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return sendError(res, 422, errors.array()[0].msg, 'VALIDATION_ERROR');
  if (!comparePassword(req.body.currentPassword, req.user.password_hash)) return sendError(res, 401, 'Your current password is incorrect.', 'INVALID_PASSWORD');
  db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hashPassword(req.body.newPassword), req.user.id);
  return sendOk(res, { changed: true });
});

router.get('/', (req, res) => {
  const search = String(req.query.search || '').trim();
  const users = search ? db.prepare('SELECT id, username, email, display_name, avatar_color, avatar_url FROM users WHERE username LIKE ? OR email LIKE ? OR display_name LIKE ? ORDER BY display_name LIMIT 20').all(`%${search}%`, `%${search}%`, `%${search}%`) : [];
  return sendOk(res, { users });
});

module.exports = router;
