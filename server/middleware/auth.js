const jwt = require('jsonwebtoken');
const db = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'taskora_jwt_secret_dev_key_2026_super_secure';

/**
 * Middleware to authenticate requests using JWT from httpOnly cookie or Authorization header
 */
function authenticateToken(req, res, next) {
    let token = null;

    if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required. Please log in.'
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Fetch current user from database to ensure user still exists and get up-to-date data
        const user = db.prepare('SELECT id, username, email, display_name, avatar_color, avatar_url, theme, created_at FROM users WHERE id = ?').get(decoded.id);
        
        if (!user) {
            res.clearCookie('token');
            return res.status(401).json({
                success: false,
                error: 'User account no longer exists.'
            });
        }

        req.user = user;
        next();
    } catch (err) {
        res.clearCookie('token');
        return res.status(401).json({
            success: false,
            error: 'Invalid or expired session. Please log in again.'
        });
    }
}

/**
 * Optional authentication: attaches user if token exists, but doesn't reject if not
 */
function optionalAuth(req, res, next) {
    let token = null;
    if (req.cookies && req.cookies.token) {
        token = req.cookies.token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = db.prepare('SELECT id, username, email, display_name, avatar_color, avatar_url, theme, created_at FROM users WHERE id = ?').get(decoded.id);
            if (user) req.user = user;
        } catch (e) {
            // Ignore invalid token in optional auth
        }
    }
    next();
}

/**
 * Role-based permission check for a project
 * Roles hierarchy: Owner (4) > Admin (3) > Member (2) > Viewer (1)
 * requiredRole: 'Viewer' | 'Member' | 'Admin' | 'Owner'
 */
const ROLE_RANKS = {
    'Viewer': 1,
    'Member': 2,
    'Admin': 3,
    'Owner': 4
};

function requireProjectRole(requiredRole) {
    return (req, res, next) => {
        const projectId = req.params.projectId || req.params.id || req.body.project_id;
        if (!projectId) {
            return res.status(400).json({ success: false, error: 'Project ID is required.' });
        }

        const member = db.prepare(`
            SELECT pm.role, p.owner_id 
            FROM project_members pm
            JOIN projects p ON p.id = pm.project_id
            WHERE pm.project_id = ? AND pm.user_id = ?
        `).get(projectId, req.user.id);

        if (!member) {
            return res.status(403).json({
                success: false,
                error: 'Access denied: You are not a member of this project.'
            });
        }

        const userRank = ROLE_RANKS[member.role] || 0;
        const requiredRank = ROLE_RANKS[requiredRole] || 1;

        if (userRank < requiredRank) {
            return res.status(403).json({
                success: false,
                error: `Permission denied: Requires at least ${requiredRole} permissions.`
            });
        }

        req.projectMember = member;
        next();
    };
}

module.exports = {
    authenticateToken,
    optionalAuth,
    requireProjectRole,
    JWT_SECRET,
    ROLE_RANKS
};
