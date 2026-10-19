const { db } = require('../db/connection');
const { sendError } = require('../lib/response');

function loadProjectContext(req, res, next) {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId < 1) return sendError(res, 400, 'Project id must be a positive integer.', 'INVALID_PROJECT_ID');
  const context = db.prepare(`
    SELECT p.*, pm.role, pm.joined_at
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
    WHERE p.id = ?
  `).get(req.user.id, projectId);
  if (!context) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) return sendError(res, 404, 'Project not found.', 'PROJECT_NOT_FOUND');
    return sendError(res, 403, 'You are not a member of this project.', 'PROJECT_ACCESS_DENIED');
  }
  req.project = context;
  req.projectId = projectId;
  next();
}

function requireProjectRole(...roles) {
  return (req, res, next) => {
    if (!req.project || !roles.includes(req.project.role)) return sendError(res, 403, 'You do not have permission to perform that action.', 'PROJECT_ROLE_REQUIRED');
    next();
  };
}

function requireProjectAdmin(req, res, next) {
  return requireProjectRole('Owner', 'Admin')(req, res, next);
}

function requireProjectOwner(req, res, next) {
  return requireProjectRole('Owner')(req, res, next);
}

module.exports = { loadProjectContext, requireProjectRole, requireProjectAdmin, requireProjectOwner };
