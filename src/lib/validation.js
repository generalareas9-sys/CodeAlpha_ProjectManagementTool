const { body } = require('express-validator');

const registrationRules = [
  body('username').trim().isLength({ min: 3, max: 24 }).withMessage('Username must be 3–24 characters.').matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can use letters, numbers, and underscores.'),
  body('email').trim().isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
  body('password').isLength({ min: 8, max: 72 }).withMessage('Password must be at least 8 characters.'),
  body('displayName').optional({ values: 'falsy' }).trim().isLength({ min: 2, max: 60 }).withMessage('Display name must be 2–60 characters.')
];

const loginRules = [
  body('identifier').trim().notEmpty().withMessage('Enter your username or email.'),
  body('password').notEmpty().withMessage('Enter your password.')
];

module.exports = { registrationRules, loginRules };
