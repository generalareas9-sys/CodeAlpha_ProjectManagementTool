const express = require('express');
const { db } = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { sendOk } = require('../lib/response');

const router = express.Router();
router.use(requireAuth);
function taskSummary(row) { return { id: row.id, projectId: row.project_id, projectName: row.project_name, title: row.title, priority: row.priority, dueDate: row.due_date, columnName: row.column_name, color: row.color }; }
router.get('/', (req, res) => {
  const projectCount = db.prepare('SELECT COUNT(*) AS count FROM project_members WHERE user_id = ?').get(req.user.id).count;
  const assignedCount = db.prepare('SELECT COUNT(*) AS count FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id WHERE ta.user_id = ? AND t.archived = 0').get(req.user.id).count;
  const completedCount = db.prepare(`SELECT COUNT(*) AS count FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id JOIN "columns" c ON c.id = t.column_id WHERE ta.user_id = ? AND t.archived = 0 AND lower(c.name) = 'done'`).get(req.user.id).count;
  const overdueCount = db.prepare(`SELECT COUNT(*) AS count FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id WHERE ta.user_id = ? AND t.due_date IS NOT NULL AND date(t.due_date) < date('now') AND t.archived = 0`).get(req.user.id).count;
  const baseTasks = `SELECT DISTINCT t.id, t.project_id, p.name AS project_name, p.color, t.title, t.priority, t.due_date, c.name AS column_name FROM tasks t JOIN task_assignees ta ON ta.task_id = t.id JOIN projects p ON p.id = t.project_id JOIN "columns" c ON c.id = t.column_id WHERE ta.user_id = ? AND t.archived = 0`;
  const dueToday = db.prepare(`${baseTasks} AND date(t.due_date) = date('now') ORDER BY t.due_date, t.position`).all(req.user.id).map(taskSummary);
  const dueThisWeek = db.prepare(`${baseTasks} AND date(t.due_date) BETWEEN date('now') AND date('now', '+7 day') ORDER BY t.due_date, t.position`).all(req.user.id).map(taskSummary);
  const overdueTasks = db.prepare(`${baseTasks} AND date(t.due_date) < date('now') ORDER BY t.due_date, t.position`).all(req.user.id).map(taskSummary);
  const projectProgress = db.prepare(`SELECT p.id, p.name, p.color, COUNT(DISTINCT t.id) AS task_count, COUNT(DISTINCT CASE WHEN lower(c.name) = 'done' THEN t.id END) AS completed_count FROM projects p JOIN project_members pm ON pm.project_id = p.id LEFT JOIN tasks t ON t.project_id = p.id AND t.archived = 0 LEFT JOIN "columns" c ON c.id = t.column_id WHERE pm.user_id = ? GROUP BY p.id ORDER BY p.updated_at DESC, p.id DESC`).all(req.user.id).map((row) => ({ id: row.id, name: row.name, color: row.color, taskCount: Number(row.task_count), completedCount: Number(row.completed_count), progress: Number(row.task_count) ? Math.round((Number(row.completed_count) / Number(row.task_count)) * 100) : 0 }));
  const recentActivity = db.prepare(`SELECT al.id, al.action, al.created_at AS createdAt, p.name AS projectName, u.display_name AS actorName FROM activity_log al JOIN projects p ON p.id = al.project_id JOIN users u ON u.id = al.actor_id JOIN project_members pm ON pm.project_id = p.id WHERE pm.user_id = ? ORDER BY al.created_at DESC LIMIT 8`).all(req.user.id);
  const workload = db.prepare(`SELECT u.id, u.display_name AS display_name, u.username, u.avatar_color, COUNT(DISTINCT CASE WHEN t.archived = 0 AND lower(c.name) <> 'done' THEN t.id END) AS open_tasks FROM project_members pm JOIN users u ON u.id = pm.user_id LEFT JOIN task_assignees ta ON ta.user_id = u.id LEFT JOIN tasks t ON t.id = ta.task_id AND t.project_id = pm.project_id LEFT JOIN "columns" c ON c.id = t.column_id WHERE pm.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?) GROUP BY u.id ORDER BY open_tasks DESC, u.display_name LIMIT 8`).all(req.user.id).map((row) => ({ id: row.id, displayName: row.display_name, username: row.username, avatarColor: row.avatar_color, openTasks: Number(row.open_tasks) }));
  return sendOk(res, { stats: { projectCount: Number(projectCount), assignedCount: Number(assignedCount), completedCount: Number(completedCount), overdueCount: Number(overdueCount) }, dueToday, dueThisWeek, overdueTasks, projectProgress, recentActivity, workload });
});
module.exports = router;
