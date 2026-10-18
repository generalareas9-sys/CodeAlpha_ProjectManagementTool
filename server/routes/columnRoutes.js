const express = require('express');
const router = express.Router();
const columnController = require('../controllers/columnController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.put('/:id', columnController.updateColumn);
router.delete('/:id', columnController.deleteColumn);

module.exports = router;
