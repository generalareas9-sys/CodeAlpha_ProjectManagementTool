const express = require('express');
const router = express.Router();
const cc = require('../controllers/commentController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.put('/:id', cc.updateComment);
router.delete('/:id', cc.deleteComment);

module.exports = router;
