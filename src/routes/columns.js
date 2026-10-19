const express = require('express');
const { body, validationResult } = require('express-validator');
const { db, transaction } = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { loadProjectContext, requireProjectAdmin } = require('../middleware/projects');
const { loadColumnContext, validId } = require('../middleware/workspace');
const { sendError, sendOk } = require('../lib/response');

const router = express.Router();
router.use(requireAuth);
const columnFields = [
  body('name').trim().isLength({ min: 1, max: 40 }).withMessage('Column name must be 1–40 characters.'),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Column color must be a hex value.')
];
const updateFields = [
  body('name').optional().trim().isLength({ min: 1, max: 40 }).withMessage('Column name must be 1–40 characters.'),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Column color must be a hex value.')
];
function validationErrors(req) { const result = validationResult(req); return result.isEmpty() ? null : result.array().map((item) => item.msg); }
function columnJson(row) { return { id: row.id, projectId: row.project_id, name: row.name, color: row.color, position: Number(row.position) }; }

router.post('/projects/:id/columns', loadProjectContext, requireProjectAdmin, columnFields, (req, res) => {
  const problems = validationErrors(req);
  if (problems) return sendError(res, 422, problems[0], 'VALIDATION_ERROR', problems);
  const name = req.body.name.trim();
  const exists = db.prepare('SELECT id FROM "columns" WHERE project_id = ? AND name = ? COLLATE NOCASE').get(req.projectId, name);
  if (exists) return sendError(res, 409, 'A column with that name already exists.', 'COLUMN_EXISTS');
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM "columns" WHERE project_id = ?').get(req.projectId).position;
  const result = db.prepare('INSERT INTO "columns" (project_id, name, color, position) VALUES (?, ?, ?, ?)').run(req.projectId, name, req.body.color || '#6366F1', position);
  db.prepare("INSERT INTO activity_log (project_id, actor_id, action, metadata) VALUES (?, ?, 'created a column', ?)").run(req.projectId, req.user.id, JSON.stringify({ columnId: result.lastInsertRowid, name }));
  const column = db.prepare('SELECT * FROM "columns" WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json({ data: { column: columnJson(column) } });
});

router.put('/columns/:id', loadColumnContext, requireProjectAdmin, updateFields, (req, res) => {
  const problems = validationErrors(req);
  if (problems) return sendError(res, 422, problems[0], 'VALIDATION_ERROR', problems);
  const updates = [];
  const values = [];
  if (req.body.name !== undefined) { const name = req.body.name.trim(); const exists = db.prepare('SELECT id FROM "columns" WHERE project_id = ? AND name = ? COLLATE NOCASE AND id != ?').get(req.projectId, name, req.column.id); if (exists) return sendError(res, 409, 'A column with that name already exists.', 'COLUMN_EXISTS'); updates.push('name = ?'); values.push(name); }
  if (req.body.color !== undefined) { updates.push('color = ?'); values.push(req.body.color); }
  if (!updates.length) return sendError(res, 400, 'Provide a column name or color to update.', 'NO_CHANGES');
  values.push(req.column.id);
  db.prepare(`UPDATE "columns" SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  db.prepare("INSERT INTO activity_log (project_id, actor_id, action, metadata) VALUES (?, ?, 'updated a column', ?)").run(req.projectId, req.user.id, JSON.stringify({ columnId: req.column.id }));
  return sendOk(res, { column: columnJson(db.prepare('SELECT * FROM "columns" WHERE id = ?').get(req.column.id)) });
});

router.put('/projects/:id/columns/reorder', loadProjectContext, requireProjectAdmin, (req, res) => {
  const ids = req.body.columnIds;
  if (!Array.isArray(ids) || !ids.length || ids.some((id) => !validId(id))) return sendError(res, 422, 'columnIds must be a non-empty array of ids.', 'VALIDATION_ERROR');
  const columns = db.prepare('SELECT id FROM "columns" WHERE project_id = ? ORDER BY id').all(req.projectId).map((row) => row.id).sort((a, b) => a - b);
  const requested = ids.map(Number).sort((a, b) => a - b);
  if (columns.length !== requested.length || columns.some((id, index) => id !== requested[index])) return sendError(res, 422, 'columnIds must include every project column exactly once.', 'INVALID_COLUMN_ORDER');
  transaction(() => { const update = db.prepare('UPDATE "columns" SET position = ? WHERE id = ?'); ids.forEach((id, index) => update.run(index, Number(id))); db.prepare("INSERT INTO activity_log (project_id, actor_id, action, metadata) VALUES (?, ?, 'reordered columns', ?)").run(req.projectId, req.user.id, JSON.stringify({ columnIds: ids })); });
  return sendOk(res, { columns: db.prepare('SELECT id, project_id, name, color, position FROM "columns" WHERE project_id = ? ORDER BY position, id').all(req.projectId).map(columnJson) });
});

router.delete('/columns/:id', loadColumnContext, requireProjectAdmin, (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM "columns" WHERE project_id = ?').get(req.projectId).count;
  if (count <= 1) return sendError(res, 409, 'A project must keep at least one column.', 'LAST_COLUMN');
  const taskCount = db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE column_id = ? AND archived = 0').get(req.column.id).count;
  if (taskCount) return sendError(res, 409, 'Move or archive the tasks in this column before deleting it.', 'COLUMN_HAS_TASKS');
  db.prepare('DELETE FROM "columns" WHERE id = ?').run(req.column.id);
  db.prepare("INSERT INTO activity_log (project_id, actor_id, action, metadata) VALUES (?, ?, 'deleted a column', ?)").run(req.projectId, req.user.id, JSON.stringify({ columnId: req.column.id, name: req.column.name }));
  return sendOk(res, { deleted: true, columnId: req.column.id });
});

module.exports = router;
