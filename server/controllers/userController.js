const bcrypt = require('bcryptjs');
const db = require('../db/database');

/**
 * Search users by username, email, or display name (for member invitation)
 */
exports.searchUsers = (req, res) => {
    try {
        const query = req.query.search ? req.query.search.trim() : '';
        if (!query || query.length < 2) {
            return res.json({ success: true, users: [] });
        }

        const searchTerm = `%${query}%`;
        const users = db.prepare(`
            SELECT id, username, email, display_name, avatar_color, avatar_url
            FROM users
            WHERE (username LIKE ? OR email LIKE ? OR display_name LIKE ?)
            LIMIT 20
        `).all(searchTerm, searchTerm, searchTerm);

        return res.json({ success: true, users });
    } catch (err) {
        console.error('Search users error:', err);
        return res.status(500).json({ success: false, error: 'Failed to search users.' });
    }
};

/**
 * Update authenticated user profile
 */
exports.updateProfile = (req, res) => {
    try {
        const { display_name, avatar_color, avatar_url, theme } = req.body;
        const userId = req.user.id;

        const updates = [];
        const params = [];

        if (display_name !== undefined) {
            const trimmed = display_name.trim();
            if (trimmed.length > 0 && trimmed.length <= 50) {
                updates.push('display_name = ?');
                params.push(trimmed);
            }
        }

        if (avatar_color !== undefined) {
            updates.push('avatar_color = ?');
            params.push(avatar_color);
        }

        if (avatar_url !== undefined) {
            updates.push('avatar_url = ?');
            params.push(avatar_url ? avatar_url.trim() : null);
        }

        if (theme && ['light', 'dark', 'system'].includes(theme)) {
            updates.push('theme = ?');
            params.push(theme);
        }

        if (updates.length === 0) {
            return res.json({ success: true, user: req.user });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(userId);

        db.prepare(`
            UPDATE users SET ${updates.join(', ')} WHERE id = ?
        `).run(...params);

        const updatedUser = db.prepare(`
            SELECT id, username, email, display_name, avatar_color, avatar_url, theme, created_at
            FROM users WHERE id = ?
        `).get(userId);

        return res.json({
            success: true,
            user: updatedUser,
            message: 'Profile updated successfully.'
        });
    } catch (err) {
        console.error('Update profile error:', err);
        return res.status(500).json({ success: false, error: 'Failed to update profile.' });
    }
};

/**
 * Change password
 */
exports.changePassword = async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        const userId = req.user.id;

        if (!current_password || !new_password) {
            return res.status(400).json({
                success: false,
                error: 'Both current password and new password are required.'
            });
        }

        if (new_password.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'New password must be at least 8 characters long.'
            });
        }

        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
        const match = await bcrypt.compare(current_password, user.password_hash);
        if (!match) {
            return res.status(400).json({ success: false, error: 'Current password is incorrect.' });
        }

        const newHash = await bcrypt.hash(new_password, 10);
        db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newHash, userId);

        return res.json({
            success: true,
            message: 'Password changed successfully.'
        });
    } catch (err) {
        console.error('Change password error:', err);
        return res.status(500).json({ success: false, error: 'Failed to change password.' });
    }
};
