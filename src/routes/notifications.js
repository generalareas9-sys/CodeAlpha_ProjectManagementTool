const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { db } = require('../db/connection');
const { notificationJson } = require('../lib/notifications');
const { sendError, sendOk } = require('../lib/response');

const router = express.Router();
router.use(requireAuth);
router.get('/', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(req.user.id, limit);
  const unreadCount = db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).count;
  return sendOk(res, { notifications: rows.map(notificationJson), unreadCount: Number(unreadCount) });
});
router.post('/:id/read', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return sendError(res, 400, 'Notification id must be valid.', 'INVALID_NOTIFICATION_ID');
  const result = db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ? AND user_id = ?').run(id, req.user.id);
  if (!result.changes) return sendError(res, 404, 'Notification not found.', 'NOTIFICATION_NOT_FOUND');
  return sendOk(res, { notificationId: id });
});
router.post('/read-all', (req, res) => { db.prepare('UPDATE notifications SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE user_id = ? AND read_at IS NULL').run(req.user.id); return sendOk(res, { readAll: true }); });
module.exports = router;
