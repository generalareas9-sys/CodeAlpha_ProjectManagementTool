const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.get('/', userController.searchUsers);
router.put('/me', userController.updateProfile);
router.put('/me/password', userController.changePassword);

module.exports = router;
