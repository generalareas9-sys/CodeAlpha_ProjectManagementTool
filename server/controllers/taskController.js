const db = require('../db/database');

/**
 * Get all tasks for a project with filters, assignees, labels, and checklist counts
 */
exports.getProjectTasks = (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const { search, priority, assigneeId, labelId, dueDate, is_archived } = req.query;
        const currentUserId = req.user.id;

        let query = `
            SELECT 
                t.*,
                c.name AS column_name,
                u.display_name AS creator_name,
                (SELECT COUNT(*) FROM checklist_items WHERE task_id = t.id) AS checklist_total,
                (SELECT COUNT(*) FROM checklist_items WHERE task_id = t.id AND is_completed = 1) AS checklist_completed,
                (SELECT COUNT(*) FROM comments WHERE task_id = t.id) AS comment_count
            FROM tasks t
            JOIN columns c ON c.id = t.column_id
            JOIN users u ON u.id = t.created_by
            WHERE t.project_id = ?
        `;

        const params = [projectId];

        // Archive filter (default: non-archived)
        if (is_archived === '1' || is_archived === 'true') {
            query += ' AND t.is_archived = 1';
        } else {
            query += ' AND t.is_archived = 0';
        }

        // Search filter (title or description)
        if (search && search.trim()) {
            query += ' AND (t.title LIKE ? OR t.description LIKE ?)';
            const term = `%${search.trim()}%`;
            params.push(term, term);
        }

        // Priority filter
        if (priority && ['Low', 'Medium', 'High', 'Urgent'].includes(priority)) {
            query += ' AND t.priority = ?';
            params.push(priority);
        }

        // Assignee filter
        if (assigneeId) {
            if (assigneeId === 'me') {
                query += ' AND t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)';
                params.push(currentUserId);
            } else {
                const aId = parseInt(assigneeId, 10);
                if (aId) {
                    query += ' AND t.id IN (SELECT task_id FROM task_assignees WHERE user_id = ?)';
                    params.push(aId);
                }
            }
        }

        // Label filter
        if (labelId) {
            const lId = parseInt(labelId, 10);
            if (lId) {
                query += ' AND t.id IN (SELECT task_id FROM task_labels WHERE label_id = ?)';
                params.push(lId);
            }
        }

        // Due date filter
        if (dueDate) {
            const today = new Date().toISOString().split('T')[0];
            if (dueDate === 'overdue') {
                query += ' AND t.due_date IS NOT NULL AND t.due_date < ? AND LOWER(c.name) != "done"';
                params.push(today);
            } else if (dueDate === 'today') {
                query += ' AND t.due_date = ?';
                params.push(today);
            }
        }

        query += ' ORDER BY t.column_id ASC, t.position ASC';

        const tasks = db.prepare(query).all(...params);

        if (tasks.length === 0) {
            return res.json({ success: true, tasks: [] });
        }

        // Batch fetch assignees and labels for these tasks
        const taskIds = tasks.map(t => t.id);
        const placeholders = taskIds.map(() => '?').join(',');

        const assignees = db.prepare(`
            SELECT 
                ta.task_id,
                u.id,
                u.username,
                u.display_name,
                u.avatar_color,
                u.avatar_url
            FROM task_assignees ta
            JOIN users u ON u.id = ta.user_id
            WHERE ta.task_id IN (${placeholders})
        `).all(...taskIds);

        const labels = db.prepare(`
            SELECT 
                tl.task_id,
                l.id,
                l.name,
                l.color
            FROM task_labels tl
            JOIN labels l ON l.id = tl.label_id
            WHERE tl.task_id IN (${placeholders})
        `).all(...taskIds);

        // Group assignees and labels by task_id
        const assigneesMap = {};
        const labelsMap = {};

        assignees.forEach(a => {
            if (!assigneesMap[a.task_id]) assigneesMap[a.task_id] = [];
            assigneesMap[a.task_id].push(a);
        });

        labels.forEach(l => {
            if (!labelsMap[l.task_id]) labelsMap[l.task_id] = [];
            labelsMap[l.task_id].push(l);
        });

        const enriched = tasks.map(t => ({
            ...t,
            assignees: assigneesMap[t.id] || [],
            labels: labelsMap[t.id] || []
        }));

        return res.json({ success: true, tasks: enriched });
    } catch (err) {
        console.error('Get project tasks error:', err);
        return res.status(500).json({ success: false, error: 'Failed to retrieve tasks.' });
    }
};

/**
 * Create a new task (Member, Admin, Owner)
 */
exports.createTask = (req, res) => {
    try {
        const projectId = parseInt(req.params.id || req.body.project_id, 10);
        const { title, column_id, description, priority, due_date, assignee_ids, label_ids } = req.body;
        const userId = req.user.id;

        if (!title || typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ success: false, error: 'Task title is required.' });
        }

        const trimmedTitle = title.trim().slice(0, 200);
        const desc = (description && typeof description === 'string') ? description.trim() : '';
        const taskPriority = ['Low', 'Medium', 'High', 'Urgent'].includes(priority) ? priority : 'Medium';
        const dueDate = due_date ? String(due_date).trim() : null;

        // Verify column belongs to this project
        let targetColId = parseInt(column_id, 10);
        if (!targetColId) {
            // Default to first column in project
            const firstCol = db.prepare('SELECT id FROM columns WHERE project_id = ? ORDER BY position ASC LIMIT 1').get(projectId);
            if (!firstCol) {
                return res.status(400).json({ success: false, error: 'No columns available in this project.' });
            }
            targetColId = firstCol.id;
        }

        // Get max position in target column
        const maxPosRow = db.prepare('SELECT MAX(position) as max_pos FROM tasks WHERE column_id = ?').get(targetColId);
        const nextPos = (maxPosRow && maxPosRow.max_pos !== null) ? maxPosRow.max_pos + 1 : 0;

        const createTx = db.transaction(() => {
            const insert = db.prepare(`
                INSERT INTO tasks (project_id, column_id, title, description, priority, due_date, position, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(projectId, targetColId, trimmedTitle, desc, taskPriority, dueDate, nextPos, userId);

            const newTaskId = insert.lastInsertRowid;

            // Handle assignees
            if (Array.isArray(assignee_ids) && assignee_ids.length > 0) {
                const insertAssignee = db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)');
                assignee_ids.forEach(uId => {
                    const parsed = parseInt(uId, 10);
                    if (parsed) {
                        try { insertAssignee.run(newTaskId, parsed); } catch (e) {}
                    }
                });
            }

            // Handle labels
            if (Array.isArray(label_ids) && label_ids.length > 0) {
                const insertLabel = db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)');
                label_ids.forEach(lId => {
                    const parsed = parseInt(lId, 10);
                    if (parsed) {
                        try { insertLabel.run(newTaskId, parsed); } catch (e) {}
                    }
                });
            }

            // Activity log
            db.prepare(`
                INSERT INTO activity_log (project_id, task_id, user_id, action, details)
                VALUES (?, ?, ?, 'task_created', ?)
            `).run(projectId, newTaskId, userId, `Created task "${trimmedTitle}"`);

            return newTaskId;
        });

        const newTaskId = createTx();

        // Fetch complete created task object
        const createdTask = db.prepare(`
            SELECT 
                t.*,
                c.name AS column_name,
                u.display_name AS creator_name,
                0 AS checklist_total,
                0 AS checklist_completed,
                0 AS comment_count
            FROM tasks t
            JOIN columns c ON c.id = t.column_id
            JOIN users u ON u.id = t.created_by
            WHERE t.id = ?
        `).get(newTaskId);

        // Fetch assignees & labels
        createdTask.assignees = db.prepare(`
            SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url
            FROM task_assignees ta
            JOIN users u ON u.id = ta.user_id
            WHERE ta.task_id = ?
        `).all(newTaskId);

        createdTask.labels = db.prepare(`
            SELECT l.id, l.name, l.color
            FROM task_labels tl
            JOIN labels l ON l.id = tl.label_id
            WHERE tl.task_id = ?
        `).all(newTaskId);

        // Send notifications to assignees
        createdTask.assignees.forEach(assignee => {
            if (assignee.id !== userId) {
                db.prepare(`
                    INSERT INTO notifications (user_id, type, title, message, link)
                    VALUES (?, 'task_assigned', ?, ?, ?)
                `).run(
                    assignee.id,
                    'Assigned to Task',
                    `${req.user.display_name} assigned you to "${trimmedTitle}"`,
                    `/projects/${projectId}`
                );
            }
        });

        // Real-time broadcast
        const io = req.app.get('io');
        if (io) {
            io.to(`project:${projectId}`).emit('task:created', createdTask);
        }

        return res.status(201).json({
            success: true,
            task: createdTask,
            message: 'Task created successfully.'
        });
    } catch (err) {
        console.error('Create task error:', err);
        return res.status(500).json({ success: false, error: 'Failed to create task.' });
    }
};

/**
 * Get task details by ID
 */
exports.getTaskById = (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const userId = req.user.id;

        const task = db.prepare(`
            SELECT 
                t.*,
                c.name AS column_name,
                u.display_name AS creator_name
            FROM tasks t
            JOIN columns c ON c.id = t.column_id
            JOIN users u ON u.id = t.created_by
            WHERE t.id = ?
        `).get(taskId);

        if (!task) {
            return res.status(404).json({ success: false, error: 'Task not found.' });
        }

        // Check project membership
        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, userId);
        if (!member) {
            return res.status(403).json({ success: false, error: 'Access denied: You are not a member of this project.' });
        }

        // Assignees
        task.assignees = db.prepare(`
            SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url
            FROM task_assignees ta
            JOIN users u ON u.id = ta.user_id
            WHERE ta.task_id = ?
        `).all(taskId);

        // Labels
        task.labels = db.prepare(`
            SELECT l.id, l.name, l.color
            FROM task_labels tl
            JOIN labels l ON l.id = tl.label_id
            WHERE tl.task_id = ?
        `).all(taskId);

        // Checklist items
        task.checklist = db.prepare(`
            SELECT * FROM checklist_items
            WHERE task_id = ?
            ORDER BY position ASC
        `).all(taskId);

        // Recent Activity
        task.activity = db.prepare(`
            SELECT 
                al.*,
                u.display_name AS user_name,
                u.avatar_color,
                u.avatar_url
            FROM activity_log al
            JOIN users u ON u.id = al.user_id
            WHERE al.task_id = ?
            ORDER BY al.created_at DESC
            LIMIT 20
        `).all(taskId);

        return res.json({ success: true, task });
    } catch (err) {
        console.error('Get task by id error:', err);
        return res.status(500).json({ success: false, error: 'Failed to retrieve task.' });
    }
};

/**
 * Move / Drag-and-Drop Task between or within columns
 */
exports.moveTask = (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const { target_column_id, target_position } = req.body;
        const userId = req.user.id;

        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        if (!task) {
            return res.status(404).json({ success: false, error: 'Task not found.' });
        }

        // Permission check
        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, userId);
        if (!member || member.role === 'Viewer') {
            return res.status(403).json({ success: false, error: 'Permission denied: Viewers cannot move tasks.' });
        }

        const sourceColumnId = task.column_id;
        const targetColId = parseInt(target_column_id, 10);
        const targetPos = Math.max(0, parseInt(target_position, 10) || 0);

        // Verify target column belongs to the same project
        const targetCol = db.prepare('SELECT * FROM columns WHERE id = ? AND project_id = ?').get(targetColId, task.project_id);
        if (!targetCol) {
            return res.status(400).json({ success: false, error: 'Target column does not exist in this project.' });
        }

        // Transaction to re-index positions cleanly
        const moveTx = db.transaction(() => {
            if (sourceColumnId === targetColId) {
                // Moving within same column
                const colTasks = db.prepare('SELECT id FROM tasks WHERE column_id = ? AND id != ? ORDER BY position ASC').all(targetColId, taskId);
                colTasks.splice(targetPos, 0, { id: taskId });

                const updatePos = db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
                colTasks.forEach((t, idx) => {
                    updatePos.run(idx, t.id);
                });
            } else {
                // Moving across different columns
                // 1. Shift positions in target column to make room at targetPos
                db.prepare('UPDATE tasks SET position = position + 1 WHERE column_id = ? AND position >= ?').run(targetColId, targetPos);

                // 2. Move task to new column & position
                db.prepare('UPDATE tasks SET column_id = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(targetColId, targetPos, taskId);

                // 3. Compact source column positions
                const srcTasks = db.prepare('SELECT id FROM tasks WHERE column_id = ? ORDER BY position ASC').all(sourceColumnId);
                const updatePos = db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
                srcTasks.forEach((t, idx) => {
                    updatePos.run(idx, t.id);
                });

                // 4. Activity log
                const srcCol = db.prepare('SELECT name FROM columns WHERE id = ?').get(sourceColumnId);
                db.prepare(`
                    INSERT INTO activity_log (project_id, task_id, user_id, action, details)
                    VALUES (?, ?, ?, 'task_moved', ?)
                `).run(task.project_id, taskId, userId, `Moved task from "${srcCol?.name || 'Column'}" to "${targetCol.name}"`);
            }
        });

        moveTx();

        // Real-time broadcast
        const io = req.app.get('io');
        if (io) {
            io.to(`project:${task.project_id}`).emit('task:moved', {
                taskId,
                projectId: task.project_id,
                sourceColumnId,
                targetColumnId: targetColId,
                newPosition: targetPos
            });
        }

        return res.json({
            success: true,
            message: 'Task moved successfully.',
            task: { id: taskId, column_id: targetColId, position: targetPos }
        });
    } catch (err) {
        console.error('Move task error:', err);
        return res.status(500).json({ success: false, error: 'Failed to move task.' });
    }
};

/**
 * Update task details (title, description, priority, due date, is_archived)
 */
exports.updateTask = (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const { title, description, priority, due_date, is_archived, column_id } = req.body;
        const userId = req.user.id;

        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        if (!task) {
            return res.status(404).json({ success: false, error: 'Task not found.' });
        }

        // Permission check
        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, userId);
        if (!member || member.role === 'Viewer') {
            return res.status(403).json({ success: false, error: 'Permission denied: Viewers cannot edit tasks.' });
        }

        const updates = [];
        const params = [];
        let activityAction = 'task_updated';
        let activityDetails = 'Updated task';

        if (title !== undefined) {
            const trimmed = title.trim();
            if (trimmed) {
                updates.push('title = ?');
                params.push(trimmed.slice(0, 200));
            }
        }

        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description ? description.trim() : '');
        }

        if (priority !== undefined && ['Low', 'Medium', 'High', 'Urgent'].includes(priority)) {
            updates.push('priority = ?');
            params.push(priority);
            activityDetails = `Priority set to ${priority}`;
        }

        if (due_date !== undefined) {
            updates.push('due_date = ?');
            params.push(due_date ? String(due_date).trim() : null);
            activityDetails = due_date ? `Due date set to ${due_date}` : 'Due date cleared';
        }

        if (is_archived !== undefined) {
            updates.push('is_archived = ?');
            params.push(is_archived ? 1 : 0);
            activityDetails = is_archived ? 'Archived task' : 'Restored task';
        }

        if (column_id !== undefined) {
            const colId = parseInt(column_id, 10);
            if (colId) {
                updates.push('column_id = ?');
                params.push(colId);
            }
        }

        if (updates.length === 0) {
            return res.json({ success: true, task });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(taskId);

        db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        // Activity log
        db.prepare(`
            INSERT INTO activity_log (project_id, task_id, user_id, action, details)
            VALUES (?, ?, ?, ?, ?)
        `).run(task.project_id, taskId, userId, activityAction, activityDetails);

        const updated = db.prepare(`
            SELECT 
                t.*,
                c.name AS column_name,
                u.display_name AS creator_name,
                (SELECT COUNT(*) FROM checklist_items WHERE task_id = t.id) AS checklist_total,
                (SELECT COUNT(*) FROM checklist_items WHERE task_id = t.id AND is_completed = 1) AS checklist_completed,
                (SELECT COUNT(*) FROM comments WHERE task_id = t.id) AS comment_count
            FROM tasks t
            JOIN columns c ON c.id = t.column_id
            JOIN users u ON u.id = t.created_by
            WHERE t.id = ?
        `).get(taskId);

        // Assignees & labels
        updated.assignees = db.prepare(`
            SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url
            FROM task_assignees ta
            JOIN users u ON u.id = ta.user_id
            WHERE ta.task_id = ?
        `).all(taskId);

        updated.labels = db.prepare(`
            SELECT l.id, l.name, l.color
            FROM task_labels tl
            JOIN labels l ON l.id = tl.label_id
            WHERE tl.task_id = ?
        `).all(taskId);

        const io = req.app.get('io');
        if (io) {
            io.to(`project:${task.project_id}`).emit('task:updated', updated);
        }

        return res.json({ success: true, task: updated });
    } catch (err) {
        console.error('Update task error:', err);
        return res.status(500).json({ success: false, error: 'Failed to update task.' });
    }
};

/**
 * Duplicate a task
 */
exports.duplicateTask = (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const userId = req.user.id;

        const original = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        if (!original) {
            return res.status(404).json({ success: false, error: 'Task not found.' });
        }

        // Permission check
        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(original.project_id, userId);
        if (!member || member.role === 'Viewer') {
            return res.status(403).json({ success: false, error: 'Permission denied: Viewers cannot duplicate tasks.' });
        }

        const newTitle = `${original.title} (Copy)`.slice(0, 200);

        // Max position in column
        const maxPosRow = db.prepare('SELECT MAX(position) as max_pos FROM tasks WHERE column_id = ?').get(original.column_id);
        const nextPos = (maxPosRow && maxPosRow.max_pos !== null) ? maxPosRow.max_pos + 1 : 0;

        const dupTx = db.transaction(() => {
            const insert = db.prepare(`
                INSERT INTO tasks (project_id, column_id, title, description, priority, due_date, position, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(original.project_id, original.column_id, newTitle, original.description, original.priority, original.due_date, nextPos, userId);

            const newId = insert.lastInsertRowid;

            // Copy assignees
            const assignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(taskId);
            const insertAssignee = db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)');
            assignees.forEach(a => insertAssignee.run(newId, a.user_id));

            // Copy labels
            const labels = db.prepare('SELECT label_id FROM task_labels WHERE task_id = ?').all(taskId);
            const insertLabel = db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)');
            labels.forEach(l => insertLabel.run(newId, l.label_id));

            // Copy checklist items
            const checkItems = db.prepare('SELECT title, is_completed, position FROM checklist_items WHERE task_id = ?').all(taskId);
            const insertCheck = db.prepare('INSERT INTO checklist_items (task_id, title, is_completed, position) VALUES (?, ?, ?, ?)');
            checkItems.forEach(ci => insertCheck.run(newId, ci.title, ci.is_completed, ci.position));

            // Activity log
            db.prepare(`
                INSERT INTO activity_log (project_id, task_id, user_id, action, details)
                VALUES (?, ?, ?, 'task_duplicated', ?)
            `).run(original.project_id, newId, userId, `Duplicated from "${original.title}"`);

            return newId;
        });

        const newTaskId = dupTx();

        const duplicatedTask = db.prepare(`
            SELECT 
                t.*,
                c.name AS column_name,
                u.display_name AS creator_name,
                (SELECT COUNT(*) FROM checklist_items WHERE task_id = t.id) AS checklist_total,
                (SELECT COUNT(*) FROM checklist_items WHERE task_id = t.id AND is_completed = 1) AS checklist_completed,
                0 AS comment_count
            FROM tasks t
            JOIN columns c ON c.id = t.column_id
            JOIN users u ON u.id = t.created_by
            WHERE t.id = ?
        `).get(newTaskId);

        duplicatedTask.assignees = db.prepare(`
            SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url
            FROM task_assignees ta
            JOIN users u ON u.id = ta.user_id
            WHERE ta.task_id = ?
        `).all(newTaskId);

        duplicatedTask.labels = db.prepare(`
            SELECT l.id, l.name, l.color
            FROM task_labels tl
            JOIN labels l ON l.id = tl.label_id
            WHERE tl.task_id = ?
        `).all(newTaskId);

        const io = req.app.get('io');
        if (io) {
            io.to(`project:${original.project_id}`).emit('task:created', duplicatedTask);
        }

        return res.status(201).json({
            success: true,
            task: duplicatedTask,
            message: 'Task duplicated successfully.'
        });
    } catch (err) {
        console.error('Duplicate task error:', err);
        return res.status(500).json({ success: false, error: 'Failed to duplicate task.' });
    }
};

/**
 * Delete a task
 */
exports.deleteTask = (req, res) => {
    try {
        const taskId = parseInt(req.params.id, 10);
        const userId = req.user.id;

        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
        if (!task) {
            return res.status(404).json({ success: false, error: 'Task not found.' });
        }

        // Permission check: Member, Admin, Owner
        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(task.project_id, userId);
        if (!member || member.role === 'Viewer') {
            return res.status(403).json({ success: false, error: 'Permission denied: Viewers cannot delete tasks.' });
        }

        db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);

        const io = req.app.get('io');
        if (io) {
            io.to(`project:${task.project_id}`).emit('task:deleted', {
                taskId,
                projectId: task.project_id,
                columnId: task.column_id
            });
        }

        return res.json({
            success: true,
            message: `Task "${task.title}" was deleted.`
        });
    } catch (err) {
        console.error('Delete task error:', err);
        return res.status(500).json({ success: false, error: 'Failed to delete task.' });
    }
};
