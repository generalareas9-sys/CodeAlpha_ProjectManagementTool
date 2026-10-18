const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
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

module.exports = router;
