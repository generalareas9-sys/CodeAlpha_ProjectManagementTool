const db = require('../db/database');

/**
 * Get comments for a task
 */
exports.getComments = (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const userId = req.user.id;

        const task = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found.' });

        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, userId);
        if (!member) return res.status(403).json({ success: false, error: 'Access denied.' });

        const comments = db.prepare(`
            SELECT 
                c.*,
                u.username,
                u.display_name,
                u.avatar_color,
                u.avatar_url
            FROM comments c
            JOIN users u ON u.id = c.user_id
            WHERE c.task_id = ?
            ORDER BY c.created_at ASC
        `).all(taskId);

        return res.json({ success: true, comments });
    } catch (err) {
        console.error('Get comments error:', err);
        return res.status(500).json({ success: false, error: 'Failed to load comments.' });
    }
};

/**
 * Add a comment to a task
 */
exports.addComment = (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const { content } = req.body;
        const userId = req.user.id;

        if (!content || typeof content !== 'string' || !content.trim()) {
            return res.status(400).json({ success: false, error: 'Comment content is required.' });
        }

        const task = db.prepare('SELECT project_id, title FROM tasks WHERE id = ?').get(taskId);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found.' });

        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, userId);
        if (!member || member.role === 'Viewer') {
            return res.status(403).json({ success: false, error: 'Viewers cannot add comments.' });
        }

        const trimmed = content.trim().slice(0, 5000);

        const insert = db.prepare(`
            INSERT INTO comments (task_id, user_id, content)
            VALUES (?, ?, ?)
        `).run(taskId, userId, trimmed);

        // Activity log
        db.prepare(`
            INSERT INTO activity_log (project_id, task_id, user_id, action, details)
            VALUES (?, ?, ?, 'comment_added', ?)
        `).run(task.project_id, taskId, userId, `${req.user.display_name} commented on "${task.title}"`);

        const newComment = db.prepare(`
            SELECT c.*, u.username, u.display_name, u.avatar_color, u.avatar_url
            FROM comments c
            JOIN users u ON u.id = c.user_id
            WHERE c.id = ?
        `).get(insert.lastInsertRowid);

        // Parse @mentions and create notifications
        const mentionRegex = /@(\w+)/g;
        let match;
        while ((match = mentionRegex.exec(trimmed)) !== null) {
            const mentionedUsername = match[1];
            const mentionedUser = db.prepare('SELECT id FROM users WHERE username = ?').get(mentionedUsername);
            if (mentionedUser && mentionedUser.id !== userId) {
                db.prepare(`
                    INSERT INTO notifications (user_id, type, title, message, link)
                    VALUES (?, 'mention', ?, ?, ?)
                `).run(
                    mentionedUser.id,
                    'Mentioned in Comment',
                    `${req.user.display_name} mentioned you in "${task.title}"`,
                    `/projects/${task.project_id}`
                );

                const io = req.app.get('io');
                if (io) {
                    io.to(`user:${mentionedUser.id}`).emit('notification:new', {
                        title: 'Mentioned in Comment',
                        message: `${req.user.display_name} mentioned you in "${task.title}"`
                    });
                }
            }
        }

        // Real-time broadcast
        const io = req.app.get('io');
        if (io) {
            io.to(`project:${task.project_id}`).emit('comment:added', {
                taskId,
                comment: newComment
            });
        }

        return res.status(201).json({ success: true, comment: newComment });
    } catch (err) {
        console.error('Add comment error:', err);
        return res.status(500).json({ success: false, error: 'Failed to add comment.' });
    }
};

/**
 * Edit a comment (only the author)
 */
exports.updateComment = (req, res) => {
    try {
        const commentId = parseInt(req.params.id, 10);
        const { content } = req.body;
        const userId = req.user.id;

        if (!content || typeof content !== 'string' || !content.trim()) {
            return res.status(400).json({ success: false, error: 'Comment content is required.' });
        }

        const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
        if (!comment) return res.status(404).json({ success: false, error: 'Comment not found.' });

        if (comment.user_id !== userId) {
            return res.status(403).json({ success: false, error: 'You can only edit your own comments.' });
        }

        const trimmed = content.trim().slice(0, 5000);
        db.prepare('UPDATE comments SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(trimmed, commentId);

        const updated = db.prepare(`
            SELECT c.*, u.username, u.display_name, u.avatar_color, u.avatar_url
            FROM comments c
            JOIN users u ON u.id = c.user_id
            WHERE c.id = ?
        `).get(commentId);

        return res.json({ success: true, comment: updated });
    } catch (err) {
        console.error('Update comment error:', err);
        return res.status(500).json({ success: false, error: 'Failed to update comment.' });
    }
};

/**
 * Delete a comment (author or Admin/Owner)
 */
exports.deleteComment = (req, res) => {
    try {
        const commentId = parseInt(req.params.id, 10);
        const userId = req.user.id;

        const comment = db.prepare('SELECT c.*, t.project_id FROM comments c JOIN tasks t ON t.id = c.task_id WHERE c.id = ?').get(commentId);
        if (!comment) return res.status(404).json({ success: false, error: 'Comment not found.' });

        // Author can always delete their own; Admin/Owner can delete any
        if (comment.user_id !== userId) {
            const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(comment.project_id, userId);
            if (!member || (member.role !== 'Owner' && member.role !== 'Admin')) {
                return res.status(403).json({ success: false, error: 'Permission denied.' });
            }
        }

        db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);

        return res.json({ success: true, message: 'Comment deleted.' });
    } catch (err) {
        console.error('Delete comment error:', err);
        return res.status(500).json({ success: false, error: 'Failed to delete comment.' });
    }
};

// ---------- TASK ASSIGNEES ----------

/**
 * Add assignee to task
 */
exports.addAssignee = (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const { user_id } = req.body;
        const currentUserId = req.user.id;

        if (!user_id) return res.status(400).json({ success: false, error: 'user_id is required.' });

        const task = db.prepare('SELECT project_id, title FROM tasks WHERE id = ?').get(taskId);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found.' });

        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, currentUserId);
        if (!member || member.role === 'Viewer') return res.status(403).json({ success: false, error: 'Permission denied.' });

        // Verify target user is a project member
        const targetMember = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, user_id);
        if (!targetMember) return res.status(400).json({ success: false, error: 'User is not a member of this project.' });

        // Check if already assigned
        const existing = db.prepare('SELECT id FROM task_assignees WHERE task_id = ? AND user_id = ?').get(taskId, user_id);
        if (existing) return res.status(400).json({ success: false, error: 'User is already assigned to this task.' });

        db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(taskId, user_id);

        // Activity log
        const targetUser = db.prepare('SELECT display_name FROM users WHERE id = ?').get(user_id);
        db.prepare(`
            INSERT INTO activity_log (project_id, task_id, user_id, action, details)
            VALUES (?, ?, ?, 'assignee_added', ?)
        `).run(task.project_id, taskId, currentUserId, `Assigned ${targetUser?.display_name || 'user'} to "${task.title}"`);

        // Notification
        if (user_id !== currentUserId) {
            db.prepare(`
                INSERT INTO notifications (user_id, type, title, message, link)
                VALUES (?, 'task_assigned', ?, ?, ?)
            `).run(user_id, 'Assigned to Task', `${req.user.display_name} assigned you to "${task.title}"`, `/projects/${task.project_id}`);

            const io = req.app.get('io');
            if (io) {
                io.to(`user:${user_id}`).emit('notification:new', {
                    title: 'Assigned to Task',
                    message: `${req.user.display_name} assigned you to "${task.title}"`
                });
            }
        }

        const assignee = db.prepare('SELECT id, username, display_name, avatar_color, avatar_url FROM users WHERE id = ?').get(user_id);

        return res.status(201).json({ success: true, assignee, message: 'Assignee added.' });
    } catch (err) {
        console.error('Add assignee error:', err);
        return res.status(500).json({ success: false, error: 'Failed to add assignee.' });
    }
};

/**
 * Remove assignee from task
 */
exports.removeAssignee = (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const targetUserId = parseInt(req.params.userId, 10);
        const currentUserId = req.user.id;

        const task = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found.' });

        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, currentUserId);
        if (!member || member.role === 'Viewer') return res.status(403).json({ success: false, error: 'Permission denied.' });

        db.prepare('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?').run(taskId, targetUserId);

        return res.json({ success: true, message: 'Assignee removed.' });
    } catch (err) {
        console.error('Remove assignee error:', err);
        return res.status(500).json({ success: false, error: 'Failed to remove assignee.' });
    }
};

// ---------- TASK LABELS ----------

/**
 * Add label to task
 */
exports.addTaskLabel = (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const { label_id } = req.body;
        const userId = req.user.id;

        if (!label_id) return res.status(400).json({ success: false, error: 'label_id is required.' });

        const task = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found.' });

        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, userId);
        if (!member || member.role === 'Viewer') return res.status(403).json({ success: false, error: 'Permission denied.' });

        const existing = db.prepare('SELECT id FROM task_labels WHERE task_id = ? AND label_id = ?').get(taskId, label_id);
        if (existing) return res.status(400).json({ success: false, error: 'Label already applied.' });

        db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)').run(taskId, label_id);

        const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(label_id);
        return res.status(201).json({ success: true, label });
    } catch (err) {
        console.error('Add task label error:', err);
        return res.status(500).json({ success: false, error: 'Failed to add label.' });
    }
};

/**
 * Remove label from task
 */
exports.removeTaskLabel = (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const labelId = parseInt(req.params.labelId, 10);
        const userId = req.user.id;

        const task = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found.' });

        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, userId);
        if (!member || member.role === 'Viewer') return res.status(403).json({ success: false, error: 'Permission denied.' });

        db.prepare('DELETE FROM task_labels WHERE task_id = ? AND label_id = ?').run(taskId, labelId);
        return res.json({ success: true, message: 'Label removed.' });
    } catch (err) {
        console.error('Remove task label error:', err);
        return res.status(500).json({ success: false, error: 'Failed to remove label.' });
    }
};

// ---------- CHECKLIST ITEMS ----------

/**
 * Add checklist item
 */
exports.addChecklistItem = (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const { title } = req.body;
        const userId = req.user.id;

        if (!title || typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ success: false, error: 'Checklist item title is required.' });
        }

        const task = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId);
        if (!task) return res.status(404).json({ success: false, error: 'Task not found.' });

        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, userId);
        if (!member || member.role === 'Viewer') return res.status(403).json({ success: false, error: 'Permission denied.' });

        const maxPos = db.prepare('SELECT MAX(position) as max_pos FROM checklist_items WHERE task_id = ?').get(taskId);
        const pos = (maxPos && maxPos.max_pos !== null) ? maxPos.max_pos + 1 : 0;

        const insert = db.prepare('INSERT INTO checklist_items (task_id, title, position) VALUES (?, ?, ?)').run(taskId, title.trim().slice(0, 300), pos);

        const item = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(insert.lastInsertRowid);
        return res.status(201).json({ success: true, item });
    } catch (err) {
        console.error('Add checklist item error:', err);
        return res.status(500).json({ success: false, error: 'Failed to add checklist item.' });
    }
};

/**
 * Toggle checklist item completion
 */
exports.toggleChecklistItem = (req, res) => {
    try {
        const itemId = parseInt(req.params.itemId, 10);
        const userId = req.user.id;

        const item = db.prepare(`
            SELECT ci.*, t.project_id 
            FROM checklist_items ci 
            JOIN tasks t ON t.id = ci.task_id 
            WHERE ci.id = ?
        `).get(itemId);
        if (!item) return res.status(404).json({ success: false, error: 'Checklist item not found.' });

        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(item.project_id, userId);
        if (!member || member.role === 'Viewer') return res.status(403).json({ success: false, error: 'Permission denied.' });

        const newState = item.is_completed ? 0 : 1;
        db.prepare('UPDATE checklist_items SET is_completed = ? WHERE id = ?').run(newState, itemId);

        return res.json({ success: true, item: { ...item, is_completed: newState } });
    } catch (err) {
        console.error('Toggle checklist error:', err);
        return res.status(500).json({ success: false, error: 'Failed to toggle checklist item.' });
    }
};

/**
 * Delete checklist item
 */
exports.deleteChecklistItem = (req, res) => {
    try {
        const itemId = parseInt(req.params.itemId, 10);
        const userId = req.user.id;

        const item = db.prepare(`
            SELECT ci.*, t.project_id 
            FROM checklist_items ci 
            JOIN tasks t ON t.id = ci.task_id 
            WHERE ci.id = ?
        `).get(itemId);
        if (!item) return res.status(404).json({ success: false, error: 'Checklist item not found.' });

        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(item.project_id, userId);
        if (!member || member.role === 'Viewer') return res.status(403).json({ success: false, error: 'Permission denied.' });

        db.prepare('DELETE FROM checklist_items WHERE id = ?').run(itemId);
        return res.json({ success: true, message: 'Checklist item removed.' });
    } catch (err) {
        console.error('Delete checklist item error:', err);
        return res.status(500).json({ success: false, error: 'Failed to delete checklist item.' });
    }
};

// ---------- PROJECT LABELS MANAGEMENT ----------

/**
 * Create a project label
 */
exports.createLabel = (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const { name, color } = req.body;
        const userId = req.user.id;

        if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Label name is required.' });

        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId);
        if (!member || (member.role !== 'Owner' && member.role !== 'Admin')) {
            return res.status(403).json({ success: false, error: 'Permission denied.' });
        }

        const insert = db.prepare('INSERT INTO labels (project_id, name, color) VALUES (?, ?, ?)').run(projectId, name.trim().slice(0, 50), color || '#6366F1');
        const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(insert.lastInsertRowid);

        return res.status(201).json({ success: true, label });
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE')) {
            return res.status(400).json({ success: false, error: 'A label with this name already exists in this project.' });
        }
        console.error('Create label error:', err);
        return res.status(500).json({ success: false, error: 'Failed to create label.' });
    }
};

/**
 * Delete a project label
 */
exports.deleteLabel = (req, res) => {
    try {
        const labelId = parseInt(req.params.labelId, 10);
        const userId = req.user.id;

        const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(labelId);
        if (!label) return res.status(404).json({ success: false, error: 'Label not found.' });

        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(label.project_id, userId);
        if (!member || (member.role !== 'Owner' && member.role !== 'Admin')) {
            return res.status(403).json({ success: false, error: 'Permission denied.' });
        }

        db.prepare('DELETE FROM labels WHERE id = ?').run(labelId);
        return res.json({ success: true, message: 'Label deleted.' });
    } catch (err) {
        console.error('Delete label error:', err);
        return res.status(500).json({ success: false, error: 'Failed to delete label.' });
    }
};
