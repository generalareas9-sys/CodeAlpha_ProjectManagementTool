const express = require('express');
const { body, validationResult } = require('express-validator');
const { db, transaction } = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { loadProjectContext, requireProjectRole } = require('../middleware/projects');
const { loadTaskContext, validId } = require('../middleware/workspace');
const { sendError, sendOk } = require('../lib/response');
const { emitProject } = require('../lib/realtime');
const { notifyProjectMembers, notifyUsers } = require('../lib/notifications');

const router = express.Router();
router.use(requireAuth);
const taskCreateFields = [
  body('title').trim().isLength({ min: 1, max: 140 }).withMessage('Task title must be 1–140 characters.'),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 5000 }).withMessage('Task description must be 5,000 characters or fewer.'),
  body('priority').optional().isIn(['Low', 'Medium', 'High', 'Urgent']).withMessage('Priority must be Low, Medium, High, or Urgent.'),
  body('dueDate').optional({ values: 'falsy' }).isISO8601().withMessage('Due date must be a valid date.'),
  body('columnId').optional().isInt({ min: 1 }).withMessage('Column id must be valid.')
];
const taskUpdateFields = [
  body('title').optional().trim().isLength({ min: 1, max: 140 }).withMessage('Task title must be 1–140 characters.'),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 5000 }).withMessage('Task description must be 5,000 characters or fewer.'),
  body('priority').optional().isIn(['Low', 'Medium', 'High', 'Urgent']).withMessage('Priority must be Low, Medium, High, or Urgent.'),
  body('dueDate').optional({ values: 'falsy' }).isISO8601().withMessage('Due date must be a valid date.')
];
function validationErrors(req) { const result = validationResult(req); return result.isEmpty() ? null : result.array().map((item) => item.msg); }
function taskJson(row) {
  const assignees = db.prepare(`SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url FROM task_assignees ta JOIN users u ON u.id = ta.user_id WHERE ta.task_id = ? ORDER BY u.display_name`).all(row.id).map((user) => ({ id: user.id, username: user.username, displayName: user.display_name, avatarColor: user.avatar_color, avatarUrl: user.avatar_url }));
  const taskLabels = db.prepare('SELECT l.id, l.name, l.color FROM task_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.task_id = ? ORDER BY l.name').all(row.id);
  const checklistStats = db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(completed), 0) AS completed FROM checklist_items WHERE task_id = ?').get(row.id);
  return { id: row.id, projectId: row.project_id, columnId: row.column_id, columnName: row.column_name, title: row.title, description: row.description, priority: row.priority, dueDate: row.due_date, position: Number(row.position), archived: Boolean(row.archived), createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, assignees, labels: taskLabels, checklistCount: Number(checklistStats.total), checklistCompleted: Number(checklistStats.completed), checklistProgress: Number(checklistStats.total) ? Math.round((Number(checklistStats.completed) / Number(checklistStats.total)) * 100) : 0 };
}
function getTask(taskId) { return db.prepare(`SELECT t.*, c.name AS column_name FROM tasks t JOIN "columns" c ON c.id = t.column_id WHERE t.id = ?`).get(taskId); }
function ensureColumn(projectId, columnId) { return db.prepare('SELECT id, name FROM "columns" WHERE id = ? AND project_id = ?').get(columnId, projectId); }
function reorderAfterMove(taskId, projectId, sourceColumnId, targetColumnId, requestedPosition) {
  const sourceIds = db.prepare('SELECT id FROM tasks WHERE project_id = ? AND column_id = ? AND archived = 0 AND id != ? ORDER BY position, id').all(projectId, sourceColumnId, taskId).map((row) => row.id);
  const targetIds = sourceColumnId === targetColumnId ? sourceIds : db.prepare('SELECT id FROM tasks WHERE project_id = ? AND column_id = ? AND archived = 0 AND id != ? ORDER BY position, id').all(projectId, targetColumnId, taskId).map((row) => row.id);
  const position = Math.max(0, Math.min(Number.isFinite(Number(requestedPosition)) ? Number(requestedPosition) : targetIds.length, targetIds.length));
  targetIds.splice(position, 0, taskId);
  const update = db.prepare('UPDATE tasks SET column_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  if (sourceColumnId !== targetColumnId) sourceIds.forEach((id, index) => update.run(sourceColumnId, index, id));
  targetIds.forEach((id, index) => update.run(targetColumnId, index, id));
}

router.get('/projects/:id/tasks', loadProjectContext, (req, res) => {
  const search = String(req.query.search || '').trim();
  const columnId = req.query.columnId ? validId(req.query.columnId) : null;
  const assigneeId = req.query.assigneeId === 'me' ? req.user.id : (req.query.assigneeId ? validId(req.query.assigneeId) : null);
  const priority = ['Low', 'Medium', 'High', 'Urgent'].includes(req.query.priority) ? req.query.priority : null;
  const labelId = req.query.labelId ? validId(req.query.labelId) : null;
  const due = ['today', 'week', 'overdue'].includes(req.query.due) ? req.query.due : null;
  const params = [req.projectId];
  let where = 't.project_id = ? AND t.archived = 0';
  if (columnId) { where += ' AND t.column_id = ?'; params.push(columnId); }
  if (assigneeId) { where += ' AND EXISTS (SELECT 1 FROM task_assignees filter_ta WHERE filter_ta.task_id = t.id AND filter_ta.user_id = ?)'; params.push(assigneeId); }
  if (priority) { where += ' AND t.priority = ?'; params.push(priority); }
  if (labelId) { where += ' AND EXISTS (SELECT 1 FROM task_labels filter_tl WHERE filter_tl.task_id = t.id AND filter_tl.label_id = ?)'; params.push(labelId); }
  if (due === 'today') where += " AND date(t.due_date) = date('now')";
  if (due === 'week') where += " AND date(t.due_date) BETWEEN date('now') AND date('now', '+7 day')";
  if (due === 'overdue') where += " AND date(t.due_date) < date('now')";
  if (search) { where += ' AND (t.title LIKE ? OR t.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  const rows = db.prepare(`SELECT t.*, c.name AS column_name FROM tasks t JOIN "columns" c ON c.id = t.column_id WHERE ${where} ORDER BY t.column_id, t.position, t.id`).all(...params);
  return sendOk(res, { tasks: rows.map(taskJson) });
});

router.post('/projects/:id/tasks', loadProjectContext, requireProjectRole('Owner', 'Admin', 'Member'), taskCreateFields, (req, res) => {
  const problems = validationErrors(req);
  if (problems) return sendError(res, 422, problems[0], 'VALIDATION_ERROR', problems);
  const requestedColumn = req.body.columnId ? validId(req.body.columnId) : null;
  const column = requestedColumn ? ensureColumn(req.projectId, requestedColumn) : db.prepare('SELECT id, name FROM "columns" WHERE project_id = ? ORDER BY position, id LIMIT 1').get(req.projectId);
  if (!column) return sendError(res, 422, 'Choose a valid project column.', 'INVALID_COLUMN');
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE project_id = ? AND column_id = ? AND archived = 0').get(req.projectId, column.id).position;
  const taskId = transaction(() => {
    const result = db.prepare('INSERT INTO tasks (project_id, column_id, title, description, priority, due_date, position, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(req.projectId, column.id, req.body.title.trim(), (req.body.description || '').trim(), req.body.priority || 'Medium', req.body.dueDate || null, position, req.user.id);
    db.prepare("INSERT INTO activity_log (project_id, task_id, actor_id, action, metadata) VALUES (?, ?, ?, 'created a task', ?)").run(req.projectId, result.lastInsertRowid, req.user.id, JSON.stringify({ title: req.body.title.trim() }));
    return Number(result.lastInsertRowid);
  });
  const task = taskJson(getTask(taskId));
  emitProject(req, 'task:created', { task });
  notifyProjectMembers({ io: req.app.locals.io, projectId: req.projectId, taskId, type: 'task_created', title: 'New task created', body: `${task.title} was added to the project.`, excludeUserId: req.user.id });
  return res.status(201).json({ data: { task } });
});

router.get('/tasks/:id', loadTaskContext, (req, res) => sendOk(res, { task: taskJson(req.task) }));

router.put('/tasks/:id', loadTaskContext, requireProjectRole('Owner', 'Admin', 'Member'), taskUpdateFields, (req, res) => {
  const problems = validationErrors(req);
  if (problems) return sendError(res, 422, problems[0], 'VALIDATION_ERROR', problems);
  const updates = [];
  const values = [];
  for (const [column, input] of [['title', req.body.title], ['description', req.body.description], ['priority', req.body.priority], ['due_date', req.body.dueDate]]) {
    if (input !== undefined) { updates.push(`${column} = ?`); values.push(input === '' && column === 'due_date' ? null : typeof input === 'string' ? input.trim() : input); }
  }
  if (!updates.length) return sendError(res, 400, 'Provide at least one task field to update.', 'NO_CHANGES');
  values.push(req.task.id);
  db.prepare(`UPDATE tasks SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);
  const changedFields = updates.map((item) => item.split(' ')[0]);
  const actionByField = { priority: 'changed priority', due_date: 'changed due date', title: 'updated task title', description: 'updated task description' };
  const insertActivity = db.prepare('INSERT INTO activity_log (project_id, task_id, actor_id, action, metadata) VALUES (?, ?, ?, ?, ?)');
  changedFields.forEach((field) => insertActivity.run(req.projectId, req.task.id, req.user.id, actionByField[field] || 'updated a task', JSON.stringify({ field })));
  const task = taskJson(getTask(req.task.id));
  emitProject(req, 'task:updated', { task });
  const assigneeIds = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(req.task.id).map((row) => row.user_id);
  notifyUsers({ io: req.app.locals.io, userIds: assigneeIds, projectId: req.projectId, taskId: req.task.id, type: 'task_updated', title: 'Assigned task updated', body: `${task.title} was updated.`, excludeUserId: req.user.id });
  return sendOk(res, { task });
});

router.put('/tasks/:id/move', loadTaskContext, requireProjectRole('Owner', 'Admin', 'Member'), [body('columnId').isInt({ min: 1 }).withMessage('Column id must be valid.'), body('position').optional().isFloat({ min: 0 }).withMessage('Position must be zero or greater.')], (req, res) => {
  const problems = validationErrors(req);
  if (problems) return sendError(res, 422, problems[0], 'VALIDATION_ERROR', problems);
  const targetColumnId = validId(req.body.columnId);
  const targetColumn = ensureColumn(req.projectId, targetColumnId);
  if (!targetColumn) return sendError(res, 422, 'Choose a column in this project.', 'INVALID_COLUMN');
  transaction(() => reorderAfterMove(req.task.id, req.projectId, req.task.column_id, targetColumnId, req.body.position));
  db.prepare("INSERT INTO activity_log (project_id, task_id, actor_id, action, metadata) VALUES (?, ?, ?, 'moved a task', ?)").run(req.projectId, req.task.id, req.user.id, JSON.stringify({ fromColumnId: req.task.column_id, toColumnId: targetColumnId }));
  const task = taskJson(getTask(req.task.id));
  emitProject(req, 'task:moved', { task, fromColumnId: req.task.column_id, toColumnId: targetColumnId });
  const assigneeIds = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(req.task.id).map((row) => row.user_id);
  notifyUsers({ io: req.app.locals.io, userIds: assigneeIds, projectId: req.projectId, taskId: req.task.id, type: 'task_moved', title: 'Task moved', body: `${task.title} moved to ${task.columnName}.`, excludeUserId: req.user.id });
  return sendOk(res, { task });
});

router.delete('/tasks/:id', loadTaskContext, requireProjectRole('Owner', 'Admin'), (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.task.id);
  db.prepare("INSERT INTO activity_log (project_id, actor_id, action, metadata) VALUES (?, ?, 'deleted a task', ?)").run(req.projectId, req.user.id, JSON.stringify({ taskId: req.task.id, title: req.task.title }));
  emitProject(req, 'task:deleted', { taskId: req.task.id, projectId: req.projectId });
  return sendOk(res, { deleted: true, taskId: req.task.id });
});

module.exports = router;
