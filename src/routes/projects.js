const express = require('express');
const { body, validationResult } = require('express-validator');
const { db, transaction } = require('../db/connection');
const { requireAuth } = require('../middleware/auth');
const { loadProjectContext, requireProjectAdmin, requireProjectOwner } = require('../middleware/projects');
const { sendError, sendOk } = require('../lib/response');
const { createNotification } = require('../lib/notifications');
const { emitProject } = require('../lib/realtime');

const router = express.Router();
router.use(requireAuth);

const projectFields = [
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Project name must be 2–80 characters.'),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 500 }).withMessage('Description must be 500 characters or fewer.'),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Color must be a hex value.'),
  body('icon').optional().trim().isLength({ min: 2, max: 32 }).withMessage('Icon must be 2–32 characters.')
];

const projectUpdateFields = [
  body('name').optional().trim().isLength({ min: 2, max: 80 }).withMessage('Project name must be 2–80 characters.'),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 500 }).withMessage('Description must be 500 characters or fewer.'),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Color must be a hex value.'),
  body('icon').optional().trim().isLength({ min: 2, max: 32 }).withMessage('Icon must be 2–32 characters.')
];

function errors(req) {
  const result = validationResult(req);
  return result.isEmpty() ? null : result.array().map((item) => item.msg);
}

function projectSummary(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    ownerId: row.owner_id,
    archived: Boolean(row.archived),
    role: row.role,
    memberCount: Number(row.member_count || 0),
    taskCount: Number(row.task_count || 0),
    completedTaskCount: Number(row.completed_task_count || 0),
    progress: Number(row.task_count) ? Math.round((Number(row.completed_task_count || 0) / Number(row.task_count)) * 100) : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function memberJson(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_url,
    role: row.role,
    joinedAt: row.joined_at
  };
}

function getProjectDetails(projectId, userId) {
  const project = db.prepare(`
    SELECT p.*,
      (SELECT role FROM project_members WHERE project_id = p.id AND user_id = ?) AS role,
      (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) AS member_count,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND archived = 0) AS task_count,
      (SELECT COUNT(*) FROM tasks t JOIN "columns" c ON c.id = t.column_id WHERE t.project_id = p.id AND t.archived = 0 AND lower(c.name) = 'done') AS completed_task_count
    FROM projects p WHERE p.id = ?
  `).get(userId, projectId);
  if (!project) return null;
  const members = db.prepare(`SELECT u.id, u.username, u.email, u.display_name, u.avatar_color, u.avatar_url, pm.role, pm.joined_at FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY CASE pm.role WHEN 'Owner' THEN 0 WHEN 'Admin' THEN 1 WHEN 'Member' THEN 2 ELSE 3 END, u.display_name`).all(projectId).map(memberJson);
  const columns = db.prepare('SELECT id, name, color, position FROM "columns" WHERE project_id = ? ORDER BY position, id').all(projectId);
  return { ...projectSummary(project), members, columns };
}

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, pm.role,
      (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) AS member_count,
      (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND archived = 0) AS task_count,
      (SELECT COUNT(*) FROM tasks t JOIN "columns" c ON c.id = t.column_id WHERE t.project_id = p.id AND t.archived = 0 AND lower(c.name) = 'done') AS completed_task_count
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
    WHERE p.archived = 0
    ORDER BY p.updated_at DESC, p.id DESC
  `).all(req.user.id);
  return sendOk(res, { projects: rows.map(projectSummary) });
});

router.post('/', projectFields, (req, res) => {
  const problems = errors(req);
  if (problems) return sendError(res, 422, problems[0], 'VALIDATION_ERROR', problems);
  const name = req.body.name.trim();
  const description = (req.body.description || '').trim();
  const color = req.body.color || '#6366F1';
  const icon = req.body.icon || 'folder-kanban';
  const projectId = transaction(() => {
    const result = db.prepare('INSERT INTO projects (name, description, color, icon, owner_id) VALUES (?, ?, ?, ?, ?)').run(name, description, color, icon, req.user.id);
    const id = Number(result.lastInsertRowid);
    db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'Owner')").run(id, req.user.id);
    const defaults = [['To Do', '#6366F1'], ['In Progress', '#F59E0B'], ['In Review', '#8B5CF6'], ['Done', '#22C55E']];
    const insertColumn = db.prepare('INSERT INTO "columns" (project_id, name, color, position) VALUES (?, ?, ?, ?)');
    defaults.forEach(([columnName, columnColor], index) => insertColumn.run(id, columnName, columnColor, index));
    db.prepare("INSERT INTO activity_log (project_id, actor_id, action, metadata) VALUES (?, ?, 'created the project', ?)").run(id, req.user.id, JSON.stringify({ projectName: name }));
    return id;
  });
  return res.status(201).json({ data: { project: getProjectDetails(projectId, req.user.id) } });
});

router.get('/:id', loadProjectContext, (req, res) => sendOk(res, { project: getProjectDetails(req.projectId, req.user.id) }));

router.put('/:id', loadProjectContext, requireProjectAdmin, projectUpdateFields, (req, res) => {
  const problems = errors(req);
  if (problems) return sendError(res, 422, problems[0], 'VALIDATION_ERROR', problems);
  const updates = [];
  const values = [];
  for (const [column, input] of [['name', req.body.name], ['description', req.body.description], ['color', req.body.color], ['icon', req.body.icon]]) {
    if (input !== undefined) { updates.push(`${column} = ?`); values.push(typeof input === 'string' ? input.trim() : input); }
  }
  if (!updates.length) return sendError(res, 400, 'Provide at least one project field to update.', 'NO_CHANGES');
  values.push(req.projectId);
  db.prepare(`UPDATE projects SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);
  db.prepare("INSERT INTO activity_log (project_id, actor_id, action, metadata) VALUES (?, ?, 'updated project settings', ?)").run(req.projectId, req.user.id, JSON.stringify({ fields: updates.map((item) => item.split(' ')[0]) }));
  return sendOk(res, { project: getProjectDetails(req.projectId, req.user.id) });
});

router.delete('/:id', loadProjectContext, requireProjectOwner, (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.projectId);
  return sendOk(res, { deleted: true, projectId: req.projectId });
});

router.post('/:id/members', loadProjectContext, requireProjectAdmin, [
  body('identifier').trim().notEmpty().withMessage('Enter a username or email address.'),
  body('role').optional().isIn(['Admin', 'Member', 'Viewer']).withMessage('Role must be Admin, Member, or Viewer.')
], (req, res) => {
  const problems = errors(req);
  if (problems) return sendError(res, 422, problems[0], 'VALIDATION_ERROR', problems);
  const identifier = req.body.identifier.trim();
  const role = req.body.role || 'Member';
  if (req.project.role === 'Admin' && role === 'Admin') return sendError(res, 403, 'Only the project owner can invite admins.', 'OWNER_ROLE_REQUIRED');
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE').get(identifier, identifier.toLowerCase());
  if (!user) return sendError(res, 404, 'No Taskora user matches that username or email.', 'USER_NOT_FOUND');
  const existing = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(req.projectId, user.id);
  if (existing) return sendError(res, 409, 'That person is already a member of this project.', 'MEMBER_EXISTS');
  transaction(() => {
    db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)').run(req.projectId, user.id, role);
    createNotification({ io: req.app.locals.io, userId: user.id, projectId: req.projectId, type: 'project_invite', title: 'You joined a project', body: `${req.project.name} is now in your Taskora workspace.` });
    db.prepare("INSERT INTO activity_log (project_id, actor_id, action, metadata) VALUES (?, ?, 'added a project member', ?)").run(req.projectId, req.user.id, JSON.stringify({ userId: user.id, role }));
  });
  const member = db.prepare(`SELECT u.id, u.username, u.email, u.display_name, u.avatar_color, u.avatar_url, pm.role, pm.joined_at FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? AND pm.user_id = ?`).get(req.projectId, user.id);
  emitProject(req, 'member:joined', { projectId: req.projectId, member: memberJson(member) });
  return res.status(201).json({ data: { member: memberJson(member), project: getProjectDetails(req.projectId, req.user.id) } });
});

router.put('/:id/members/:userId', loadProjectContext, requireProjectAdmin, [body('role').isIn(['Admin', 'Member', 'Viewer']).withMessage('Role must be Admin, Member, or Viewer.')], (req, res) => {
  const problems = errors(req);
  if (problems) return sendError(res, 422, problems[0], 'VALIDATION_ERROR', problems);
  const userId = Number(req.params.userId);
  const target = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(req.projectId, userId);
  if (!target) return sendError(res, 404, 'Project member not found.', 'MEMBER_NOT_FOUND');
  if (target.role === 'Owner') return sendError(res, 400, 'The project owner role cannot be changed.', 'OWNER_ROLE_LOCKED');
  if (req.project.role === 'Admin' && req.body.role === 'Admin') return sendError(res, 403, 'Only the project owner can assign admins.', 'OWNER_ROLE_REQUIRED');
  db.prepare('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?').run(req.body.role, req.projectId, userId);
  db.prepare("INSERT INTO activity_log (project_id, actor_id, action, metadata) VALUES (?, ?, 'changed a member role', ?)").run(req.projectId, req.user.id, JSON.stringify({ userId, role: req.body.role }));
  return sendOk(res, { project: getProjectDetails(req.projectId, req.user.id) });
});

router.delete('/:id/members/:userId', loadProjectContext, (req, res) => {
  const requestedId = req.params.userId === 'me' ? req.user.id : Number(req.params.userId);
  if (!Number.isInteger(requestedId) || requestedId < 1) return sendError(res, 400, 'Member id must be valid.', 'INVALID_MEMBER_ID');
  const target = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(req.projectId, requestedId);
  if (!target) return sendError(res, 404, 'Project member not found.', 'MEMBER_NOT_FOUND');
  const leaving = requestedId === req.user.id;
  if (leaving && target.role === 'Owner') return sendError(res, 400, 'The project owner cannot leave. Transfer ownership or delete the project instead.', 'OWNER_CANNOT_LEAVE');
  if (!leaving && req.project.role !== 'Owner') return sendError(res, 403, 'Only the project owner can remove another member.', 'OWNER_ROLE_REQUIRED');
  db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(req.projectId, requestedId);
  db.prepare("INSERT INTO activity_log (project_id, actor_id, action, metadata) VALUES (?, ?, ?, ?)").run(req.projectId, req.user.id, leaving ? 'left the project' : 'removed a project member', JSON.stringify({ userId: requestedId }));
  return sendOk(res, { left: leaving, removedUserId: requestedId, project: getProjectDetails(req.projectId, req.user.id) });
});

module.exports = router;
