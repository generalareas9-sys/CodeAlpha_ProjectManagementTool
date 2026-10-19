const { db } = require('../db/connection');
const { sendError } = require('../lib/response');

function validId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function loadColumnContext(req, res, next) {
  const columnId = validId(req.params.id);
  if (!columnId) return sendError(res, 400, 'Column id must be a positive integer.', 'INVALID_COLUMN_ID');
  const row = db.prepare(`
    SELECT c.*, p.name AS project_name, p.owner_id, pm.role
    FROM "columns" c
    JOIN projects p ON p.id = c.project_id
    JOIN project_members pm ON pm.project_id = c.project_id AND pm.user_id = ?
    WHERE c.id = ?
  `).get(req.user.id, columnId);
  if (!row) {
    const exists = db.prepare('SELECT id FROM "columns" WHERE id = ?').get(columnId);
    return sendError(res, exists ? 403 : 404, exists ? 'You are not a member of this project.' : 'Column not found.', exists ? 'PROJECT_ACCESS_DENIED' : 'COLUMN_NOT_FOUND');
  }
  req.column = row;
  req.projectId = row.project_id;
  req.project = { id: row.project_id, name: row.project_name, owner_id: row.owner_id, role: row.role };
  next();
}

function loadTaskContext(req, res, next) {
  const taskId = validId(req.params.id);
  if (!taskId) return sendError(res, 400, 'Task id must be a positive integer.', 'INVALID_TASK_ID');
  const row = db.prepare(`
    SELECT t.*, c.name AS column_name, p.name AS project_name, p.owner_id, pm.role
    FROM tasks t
    JOIN "columns" c ON c.id = t.column_id
    JOIN projects p ON p.id = t.project_id
    JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = ?
    WHERE t.id = ?
  `).get(req.user.id, taskId);
  if (!row) {
    const exists = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    return sendError(res, exists ? 403 : 404, exists ? 'You are not a member of this project.' : 'Task not found.', exists ? 'PROJECT_ACCESS_DENIED' : 'TASK_NOT_FOUND');
  }
  req.task = row;
  req.projectId = row.project_id;
  req.project = { id: row.project_id, name: row.project_name, owner_id: row.owner_id, role: row.role };
  next();
}

module.exports = { loadColumnContext, loadTaskContext, validId };
