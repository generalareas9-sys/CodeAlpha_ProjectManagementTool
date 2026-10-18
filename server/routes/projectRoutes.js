const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const columnController = require('../controllers/columnController');
const taskController = require('../controllers/taskController');
const cc = require('../controllers/commentController');
const { authenticateToken, requireProjectRole } = require('../middleware/auth');

// All project routes require authentication
router.use(authenticateToken);

// Project list & creation
router.get('/', projectController.getProjects);
router.post('/', projectController.createProject);

// Project specific endpoints
router.get('/:id', requireProjectRole('Viewer'), projectController.getProjectById);
router.put('/:id', requireProjectRole('Admin'), projectController.updateProject);
router.delete('/:id', requireProjectRole('Owner'), projectController.deleteProject);

// Project members endpoints
router.post('/:id/members', requireProjectRole('Admin'), projectController.addMember);
router.put('/:id/members/:userId', requireProjectRole('Admin'), projectController.updateMemberRole);
router.delete('/:id/members/:userId', requireProjectRole('Viewer'), projectController.removeMember);

// Project columns endpoints
router.post('/:id/columns', requireProjectRole('Admin'), columnController.createColumn);
router.put('/:id/columns/reorder', requireProjectRole('Admin'), columnController.reorderColumns);

// Project tasks endpoints
router.get('/:id/tasks', requireProjectRole('Viewer'), taskController.getProjectTasks);
router.post('/:id/tasks', requireProjectRole('Member'), taskController.createTask);

// Project labels endpoints
router.post('/:id/labels', requireProjectRole('Admin'), cc.createLabel);
router.delete('/:id/labels/:labelId', requireProjectRole('Admin'), cc.deleteLabel);

module.exports = router;
