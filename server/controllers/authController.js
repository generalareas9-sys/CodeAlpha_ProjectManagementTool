const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { JWT_SECRET } = require('../middleware/auth');

const AVATAR_COLORS = [
    '#6366F1', '#8B5CF6', '#EC4899', '#3B82F6',
    '#10B981', '#F59E0B', '#F97316', '#06B6D4'
];

function getRandomColor() {
    return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function setTokenCookie(res, token) {
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
}

/**
 * Register new user
 */
exports.register = async (req, res) => {
    try {
        const { username, email, password, display_name } = req.body;

        // Validations
        if (!username || typeof username !== 'string') {
            return res.status(400).json({ success: false, error: 'Username is required.' });
        }
        const trimmedUsername = username.trim();
        if (!/^[a-zA-Z0-9_]{3,30}$/.test(trimmedUsername)) {
            return res.status(400).json({
                success: false,
                error: 'Username must be between 3 and 30 characters and contain only letters, numbers, and underscores.'
            });
        }

        if (!email || typeof email !== 'string') {
            return res.status(400).json({ success: false, error: 'Email is required.' });
        }
        const trimmedEmail = email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmedEmail)) {
            return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
        }

        if (!password || typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 8 characters long.'
            });
        }

        const displayName = (display_name && display_name.trim()) 
            ? display_name.trim().slice(0, 50) 
            : trimmedUsername;

        // Check uniqueness
        const existingUser = db.prepare('SELECT id, username, email FROM users WHERE username = ? OR email = ?').get(trimmedUsername, trimmedEmail);
        if (existingUser) {
            if (existingUser.username.toLowerCase() === trimmedUsername.toLowerCase()) {
                return res.status(400).json({ success: false, error: 'Username is already taken.' });
            }
            return res.status(400).json({ success: false, error: 'Email is already registered.' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);
        const avatarColor = getRandomColor();

        const insert = db.prepare(`
            INSERT INTO users (username, email, password_hash, display_name, avatar_color, theme)
            VALUES (?, ?, ?, ?, ?, 'light')
        `).run(trimmedUsername, trimmedEmail, passwordHash, displayName, avatarColor);

        const newUser = db.prepare('SELECT id, username, email, display_name, avatar_color, avatar_url, theme, created_at FROM users WHERE id = ?').get(insert.lastInsertRowid);

        const token = jwt.sign(
            { id: newUser.id, username: newUser.username, email: newUser.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        setTokenCookie(res, token);

        return res.status(201).json({
            success: true,
            user: newUser,
            message: 'Account created successfully!'
        });
    } catch (err) {
        console.error('Register error:', err);
        return res.status(500).json({ success: false, error: 'Server error during registration.' });
    }
};

/**
 * Login user
 */
exports.login = async (req, res) => {
    try {
        const { identifier, password } = req.body;

        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                error: 'Please provide both username/email and password.'
            });
        }

        const trimmedIdentifier = identifier.trim();

        const user = db.prepare(`
            SELECT * FROM users 
            WHERE username = ? OR email = ? COLLATE NOCASE
        `).get(trimmedIdentifier, trimmedIdentifier);

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid username/email or password.'
            });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                error: 'Invalid username/email or password.'
            });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        setTokenCookie(res, token);

        const safeUser = {
            id: user.id,
            username: user.username,
            email: user.email,
            display_name: user.display_name,
            avatar_color: user.avatar_color,
            avatar_url: user.avatar_url,
            theme: user.theme,
            created_at: user.created_at
        };

        return res.json({
            success: true,
            user: safeUser,
            message: 'Logged in successfully!'
        });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ success: false, error: 'Server error during login.' });
    }
};

/**
 * Logout user
 */
exports.logout = (req, res) => {
    res.clearCookie('token', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
    });
    return res.json({
        success: true,
        message: 'Logged out successfully.'
    });
};

/**
 * Get current authenticated user
 */
exports.me = (req, res) => {
    return res.json({
        success: true,
        user: req.user
    });
};
