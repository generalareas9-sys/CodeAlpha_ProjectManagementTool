const { db } = require('../db/connection');

function notificationJson(row) {
  return { id: row.id, userId: row.user_id, projectId: row.project_id, taskId: row.task_id, type: row.type, title: row.title, body: row.body, readAt: row.read_at, createdAt: row.created_at };
}
function createNotification({ io, userId, projectId = null, taskId = null, type, title, body = '' }) {
  const result = db.prepare('INSERT INTO notifications (user_id, project_id, task_id, type, title, body) VALUES (?, ?, ?, ?, ?, ?)').run(userId, projectId, taskId, type, title, body);
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(result.lastInsertRowid);
  const notification = notificationJson(row);
  if (io) io.to(`user:${userId}`).emit('notification:new', notification);
  return notification;
}
function notifyUsers({ io, userIds, projectId = null, taskId = null, type, title, body = '', excludeUserId = null }) {
  return [...new Set(userIds.map(Number))].filter((id) => id > 0 && id !== Number(excludeUserId)).map((userId) => createNotification({ io, userId, projectId, taskId, type, title, body }));
}
function projectMemberIds(projectId) { return db.prepare('SELECT user_id FROM project_members WHERE project_id = ?').all(projectId).map((row) => row.user_id); }
function notifyProjectMembers(options) { return notifyUsers({ ...options, userIds: projectMemberIds(options.projectId) }); }
function mentionedMemberIds(projectId, text) {
  const usernames = [...new Set(String(text || '').match(/@[a-zA-Z0-9_.-]+/g)?.map((mention) => mention.slice(1).toLowerCase()) || [])];
  if (!usernames.length) return [];
  const placeholders = usernames.map(() => '?').join(',');
  return db.prepare(`SELECT pm.user_id FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? AND lower(u.username) IN (${placeholders})`).all(projectId, ...usernames).map((row) => row.user_id);
}
function notifyDueSoon(io) {
  const rows = db.prepare(`SELECT DISTINCT ta.user_id, t.id AS task_id, t.project_id, t.title, t.due_date, p.name AS project_name FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id JOIN projects p ON p.id = t.project_id WHERE t.archived = 0 AND t.due_date IS NOT NULL AND date(t.due_date) BETWEEN date('now') AND date('now', '+1 day')`).all();
  rows.forEach((row) => {
    const existing = db.prepare("SELECT id FROM notifications WHERE user_id = ? AND task_id = ? AND type = 'due_soon' AND date(created_at) = date('now') LIMIT 1").get(row.user_id, row.task_id);
    if (!existing) createNotification({ io, userId: row.user_id, projectId: row.project_id, taskId: row.task_id, type: 'due_soon', title: 'Task due soon', body: `${row.title} in ${row.project_name} is due ${row.due_date}.` });
  });
}
module.exports = { notificationJson, createNotification, notifyUsers, notifyProjectMembers, mentionedMemberIds, notifyDueSoon };
