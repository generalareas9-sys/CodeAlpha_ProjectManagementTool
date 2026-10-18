const db = require('../db/database');

/**
 * Add a new column to a project (Admin or Owner)
 */
exports.createColumn = (req, res) => {
    try {
        const projectId = parseInt(req.params.id || req.body.project_id, 10);
        const { name } = req.body;
        const userId = req.user.id;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Column name is required.' });
        }

        const trimmedName = name.trim().slice(0, 50);

        // Find current max position
        const maxPosRow = db.prepare('SELECT MAX(position) as max_pos FROM columns WHERE project_id = ?').get(projectId);
        const nextPos = (maxPosRow && maxPosRow.max_pos !== null) ? maxPosRow.max_pos + 1 : 0;

        const insert = db.prepare(`
            INSERT INTO columns (project_id, name, position)
            VALUES (?, ?, ?)
        `).run(projectId, trimmedName, nextPos);

        const newColumn = {
            id: insert.lastInsertRowid,
            project_id: projectId,
            name: trimmedName,
            position: nextPos
        };

        // Activity log
        db.prepare(`
            INSERT INTO activity_log (project_id, user_id, action, details)
            VALUES (?, ?, 'column_created', ?)
        `).run(projectId, userId, `Created column "${trimmedName}"`);

        // Real-time broadcast
        const io = req.app.get('io');
        if (io) {
            io.to(`project:${projectId}`).emit('column:created', newColumn);
        }

        return res.status(201).json({
            success: true,
            column: newColumn,
            message: 'Column created successfully.'
        });
    } catch (err) {
        console.error('Create column error:', err);
        return res.status(500).json({ success: false, error: 'Failed to create column.' });
    }
};

/**
 * Rename column (Admin or Owner)
 */
exports.updateColumn = (req, res) => {
    try {
        const columnId = parseInt(req.params.id, 10);
        const { name } = req.body;
        const userId = req.user.id;

        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Column name is required.' });
        }

        const column = db.prepare('SELECT * FROM columns WHERE id = ?').get(columnId);
        if (!column) {
            return res.status(404).json({ success: false, error: 'Column not found.' });
        }

        // Verify user permission on column's project
        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(column.project_id, userId);
        if (!member || (member.role !== 'Owner' && member.role !== 'Admin')) {
            return res.status(403).json({ success: false, error: 'Permission denied: Requires Admin or Owner role.' });
        }

        const trimmedName = name.trim().slice(0, 50);
        db.prepare('UPDATE columns SET name = ? WHERE id = ?').run(trimmedName, columnId);

        const updated = { ...column, name: trimmedName };

        const io = req.app.get('io');
        if (io) {
            io.to(`project:${column.project_id}`).emit('column:updated', updated);
        }

        return res.json({
            success: true,
            column: updated,
            message: 'Column updated successfully.'
        });
    } catch (err) {
        console.error('Update column error:', err);
        return res.status(500).json({ success: false, error: 'Failed to update column.' });
    }
};

/**
 * Reorder columns within a project (Admin or Owner)
 */
exports.reorderColumns = (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const { columnOrder } = req.body; // Array of column IDs: [3, 1, 2, 4]
        const userId = req.user.id;

        if (!Array.isArray(columnOrder) || columnOrder.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid columnOrder array.' });
        }

        const reorderTx = db.transaction(() => {
            const updateStmt = db.prepare('UPDATE columns SET position = ? WHERE id = ? AND project_id = ?');
            columnOrder.forEach((colId, index) => {
                updateStmt.run(index, colId, projectId);
            });
        });

        reorderTx();

        const updatedColumns = db.prepare('SELECT * FROM columns WHERE project_id = ? ORDER BY position ASC').all(projectId);

        const io = req.app.get('io');
        if (io) {
            io.to(`project:${projectId}`).emit('columns:reordered', { projectId, columns: updatedColumns });
        }

        return res.json({
            success: true,
            columns: updatedColumns,
            message: 'Columns reordered successfully.'
        });
    } catch (err) {
        console.error('Reorder columns error:', err);
        return res.status(500).json({ success: false, error: 'Failed to reorder columns.' });
    }
};

/**
 * Delete column (Admin or Owner)
 */
exports.deleteColumn = (req, res) => {
    try {
        const columnId = parseInt(req.params.id, 10);
        const userId = req.user.id;

        const column = db.prepare('SELECT * FROM columns WHERE id = ?').get(columnId);
        if (!column) {
            return res.status(404).json({ success: false, error: 'Column not found.' });
        }

        // Verify permission
        const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(column.project_id, userId);
        if (!member || (member.role !== 'Owner' && member.role !== 'Admin')) {
            return res.status(403).json({ success: false, error: 'Permission denied: Requires Admin or Owner role.' });
        }

        // Don't allow deleting the last column in a project
        const totalCols = db.prepare('SELECT COUNT(*) as count FROM columns WHERE project_id = ?').get(column.project_id);
        if (totalCols.count <= 1) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete the only column in a project board.'
            });
        }

        // Deleting column will cascade-delete its tasks (or we can move tasks to the first available column)
        const deleteTx = db.transaction(() => {
            // Find another column to preserve tasks if desired, or let CASCADE delete.
            // Let's move tasks to the first other column so users don't accidentally lose tasks!
            const fallbackCol = db.prepare('SELECT id FROM columns WHERE project_id = ? AND id != ? ORDER BY position ASC LIMIT 1').get(column.project_id, columnId);
            if (fallbackCol) {
                db.prepare('UPDATE tasks SET column_id = ? WHERE column_id = ?').run(fallbackCol.id, columnId);
            }
            db.prepare('DELETE FROM columns WHERE id = ?').run(columnId);
        });

        deleteTx();

        const io = req.app.get('io');
        if (io) {
            io.to(`project:${column.project_id}`).emit('column:deleted', {
                projectId: column.project_id,
                columnId
            });
        }

        return res.json({
            success: true,
            message: `Column "${column.name}" was removed.`
        });
    } catch (err) {
        console.error('Delete column error:', err);
        return res.status(500).json({ success: false, error: 'Failed to delete column.' });
    }
};
