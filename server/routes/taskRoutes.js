const express = require('express');
const router = express.Router();
const cc = require('../controllers/commentController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// Comments on tasks
router.get('/:id/comments', cc.getComments);
router.post('/:id/comments', cc.addComment);

// Assignees on tasks
router.post('/:id/assignees', cc.addAssignee);
router.delete('/:id/assignees/:userId', cc.removeAssignee);

// Labels on tasks
router.post('/:id/labels', cc.addTaskLabel);
router.delete('/:id/labels/:labelId', cc.removeTaskLabel);

// Checklist items on tasks
router.post('/:id/checklist', cc.addChecklistItem);
router.put('/checklist/:itemId/toggle', cc.toggleChecklistItem);
router.delete('/checklist/:itemId', cc.deleteChecklistItem);

module.exports = router;
