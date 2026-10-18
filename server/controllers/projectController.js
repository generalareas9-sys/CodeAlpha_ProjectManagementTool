const db = require('../db/database');
const { ROLE_RANKS } = require('../middleware/auth');

/**
 * Get all projects where the authenticated user is a member
 */
exports.getProjects = (req, res) => {
    try {
        const userId = req.user.id;

        const projects = db.prepare(`
            SELECT 
                p.id,
                p.name,
                p.description,
                p.color,
                p.icon,
                p.owner_id,
                p.is_archived,
                p.created_at,
                p.updated_at,
                pm.role,
                (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) AS member_count,
                (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND is_archived = 0) AS task_count,
                (SELECT COUNT(*) FROM tasks t 
                 JOIN columns c ON c.id = t.column_id 
                 WHERE t.project_id = p.id AND t.is_archived = 0 AND LOWER(c.name) = 'done') AS completed_task_count
            FROM projects p
            JOIN project_members pm ON pm.project_id = p.id
            WHERE pm.user_id = ?
            ORDER BY p.updated_at DESC
        `).all(userId);

        // Fetch top 4 members avatars for each project
        const projectIds = projects.map(p => p.id);
        const membersByProject = {};

        if (projectIds.length > 0) {
            const placeholders = projectIds.map(() => '?').join(',');
            const members = db.prepare(`
                SELECT 
                    pm.project_id,
                    u.id AS user_id,
                    u.username,
                    u.display_name,
                    u.avatar_color,
                    u.avatar_url,
                    pm.role
                FROM project_members pm
                JOIN users u ON u.id = pm.user_id
                WHERE pm.project_id IN (${placeholders})
                ORDER BY pm.joined_at ASC
            `).all(...projectIds);

            for (const m of members) {
                if (!membersByProject[m.project_id]) {
                    membersByProject[m.project_id] = [];
                }
                if (membersByProject[m.project_id].length < 4) {
                    membersByProject[m.project_id].push(m);
                }
            }
        }

        const enriched = projects.map(p => ({
            ...p,
            members: membersByProject[p.id] || []
        }));

        return res.json({ success: true, projects: enriched });
    } catch (err) {
        console.error('Get projects error:', err);
        return res.status(500).json({ success: false, error: 'Failed to retrieve projects.' });
    }
};

/**
 * Create a new project
 */
exports.createProject = (req, res) => {
    try {
        const { name, description, color, icon } = req.body;
        const userId = req.user.id;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Project name is required.' });
        }

        const projectName = name.trim().slice(0, 100);
        const projectDesc = (description && typeof description === 'string') ? description.trim() : '';
        const projectColor = color || '#6366F1';
        const projectIcon = icon || 'folder';

        // Transaction to ensure atomicity
        const createTx = db.transaction(() => {
            // 1. Insert Project
            const insertProject = db.prepare(`
                INSERT INTO projects (name, description, color, icon, owner_id)
                VALUES (?, ?, ?, ?, ?)
            `).run(projectName, projectDesc, projectColor, projectIcon, userId);

            const projectId = insertProject.lastInsertRowid;

            // 2. Add creator as Owner in project_members
            db.prepare(`
                INSERT INTO project_members (project_id, user_id, role)
                VALUES (?, ?, 'Owner')
            `).run(projectId, userId);

            // 3. Create default Kanban columns: To Do, In Progress, In Review, Done
            const defaultCols = ['To Do', 'In Progress', 'In Review', 'Done'];
            const insertCol = db.prepare(`
                INSERT INTO columns (project_id, name, position)
                VALUES (?, ?, ?)
            `);
            defaultCols.forEach((colName, index) => {
                insertCol.run(projectId, colName, index);
            });

            // 4. Create default labels
            const defaultLabels = [
                { name: 'Feature', color: '#6366F1' },
                { name: 'Bug', color: '#EF4444' },
                { name: 'Design', color: '#EC4899' },
                { name: 'Backend', color: '#10B981' },
                { name: 'Urgent', color: '#F97316' }
            ];
            const insertLabel = db.prepare(`
                INSERT INTO labels (project_id, name, color)
                VALUES (?, ?, ?)
            `);
            defaultLabels.forEach(lbl => {
                insertLabel.run(projectId, lbl.name, lbl.color);
            });

            // 5. Activity log
            db.prepare(`
                INSERT INTO activity_log (project_id, user_id, action, details)
                VALUES (?, ?, 'project_created', ?)
            `).run(projectId, userId, `Created project "${projectName}"`);

            return projectId;
        });

        const newProjectId = createTx();

        const createdProject = db.prepare(`
            SELECT 
                p.*,
                'Owner' AS role,
                1 AS member_count,
                0 AS task_count,
                0 AS completed_task_count
            FROM projects p WHERE p.id = ?
        `).get(newProjectId);

        return res.status(201).json({
            success: true,
            project: createdProject,
            message: 'Project created successfully!'
        });
    } catch (err) {
        console.error('Create project error:', err);
        return res.status(500).json({ success: false, error: 'Failed to create project.' });
    }
};

/**
 * Get project details by ID with members, columns, labels
 */
exports.getProjectById = (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const userId = req.user.id;

        // Check membership
        const membership = db.prepare(`
            SELECT role FROM project_members 
            WHERE project_id = ? AND user_id = ?
        `).get(projectId, userId);

        if (!membership) {
            return res.status(403).json({
                success: false,
                error: 'Access denied: You are not a member of this project.'
            });
        }

        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found.' });
        }

        // Get all members
        const members = db.prepare(`
            SELECT 
                pm.id AS member_id,
                pm.role,
                pm.joined_at,
                u.id AS user_id,
                u.username,
                u.email,
                u.display_name,
                u.avatar_color,
                u.avatar_url
            FROM project_members pm
            JOIN users u ON u.id = pm.user_id
            WHERE pm.project_id = ?
            ORDER BY 
                CASE pm.role 
                    WHEN 'Owner' THEN 1 
                    WHEN 'Admin' THEN 2 
                    WHEN 'Member' THEN 3 
                    WHEN 'Viewer' THEN 4 
                    ELSE 5 
                END,
                pm.joined_at ASC
        `).all(projectId);

        // Get columns
        const columns = db.prepare(`
            SELECT * FROM columns 
            WHERE project_id = ? 
            ORDER BY position ASC
        `).all(projectId);

        // Get labels
        const labels = db.prepare(`
            SELECT * FROM labels 
            WHERE project_id = ? 
            ORDER BY name ASC
        `).all(projectId);

        // Stats
        const stats = db.prepare(`
            SELECT 
                COUNT(*) AS total_tasks,
                SUM(CASE WHEN LOWER(c.name) = 'done' THEN 1 ELSE 0 END) AS completed_tasks,
                SUM(CASE WHEN t.priority = 'Urgent' AND LOWER(c.name) != 'done' THEN 1 ELSE 0 END) AS urgent_tasks
            FROM tasks t
            JOIN columns c ON c.id = t.column_id
            WHERE t.project_id = ? AND t.is_archived = 0
        `).get(projectId);

        return res.json({
            success: true,
            project: {
                ...project,
                user_role: membership.role,
                members,
                columns,
                labels,
                stats: {
                    total_tasks: stats.total_tasks || 0,
                    completed_tasks: stats.completed_tasks || 0,
                    urgent_tasks: stats.urgent_tasks || 0
                }
            }
        });
    } catch (err) {
        console.error('Get project by id error:', err);
        return res.status(500).json({ success: false, error: 'Failed to retrieve project details.' });
    }
};

/**
 * Update project (Admin or Owner)
 */
exports.updateProject = (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const { name, description, color, icon, is_archived } = req.body;
        const userId = req.user.id;

        const updates = [];
        const params = [];

        if (name !== undefined) {
            const trimmed = name.trim();
            if (trimmed.length > 0) {
                updates.push('name = ?');
                params.push(trimmed.slice(0, 100));
            }
        }

        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description ? description.trim() : '');
        }

        if (color !== undefined) {
            updates.push('color = ?');
            params.push(color);
        }

        if (icon !== undefined) {
            updates.push('icon = ?');
            params.push(icon);
        }

        if (is_archived !== undefined) {
            updates.push('is_archived = ?');
            params.push(is_archived ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.json({ success: true, message: 'No changes provided.' });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(projectId);

        db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);

        // Activity log
        db.prepare(`
            INSERT INTO activity_log (project_id, user_id, action, details)
            VALUES (?, ?, 'project_updated', 'Updated project settings')
        `).run(projectId, userId);

        // Real-time broadcast
        const io = req.app.get('io');
        if (io) {
            io.to(`project:${projectId}`).emit('project:updated', updated);
        }

        return res.json({
            success: true,
            project: updated,
            message: 'Project updated successfully.'
        });
    } catch (err) {
        console.error('Update project error:', err);
        return res.status(500).json({ success: false, error: 'Failed to update project.' });
    }
};

/**
 * Delete project (Owner only)
 */
exports.deleteProject = (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const userId = req.user.id;

        const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found.' });
        }

        if (project.owner_id !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Permission denied: Only the project Owner can delete the project.'
            });
        }

        // Real-time notification before deletion
        const io = req.app.get('io');
        if (io) {
            io.to(`project:${projectId}`).emit('project:deleted', { projectId });
        }

        // Delete project (SQLite cascading delete handles all child records)
        db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

        return res.json({
            success: true,
            message: `Project "${project.name}" has been permanently deleted.`
        });
    } catch (err) {
        console.error('Delete project error:', err);
        return res.status(500).json({ success: false, error: 'Failed to delete project.' });
    }
};

/**
 * Add / Invite a member to the project (Admin or Owner)
 */
exports.addMember = (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const { identifier, role } = req.body;
        const inviter = req.user;

        if (!identifier || typeof identifier !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Please provide a username or email to invite.'
            });
        }

        const memberRole = ['Admin', 'Member', 'Viewer'].includes(role) ? role : 'Member';

        // Find target user
        const targetUser = db.prepare(`
            SELECT id, username, email, display_name, avatar_color, avatar_url
            FROM users 
            WHERE username = ? OR email = ? COLLATE NOCASE
        `).get(identifier.trim(), identifier.trim());

        if (!targetUser) {
            return res.status(404).json({
                success: false,
                error: `User "${identifier}" was not found. Make sure they have a Taskora account.`
            });
        }

        // Check if already a member
        const existing = db.prepare(`
            SELECT role FROM project_members 
            WHERE project_id = ? AND user_id = ?
        `).get(projectId, targetUser.id);

        if (existing) {
            return res.status(400).json({
                success: false,
                error: `"${targetUser.display_name}" is already a member (${existing.role}) of this project.`
            });
        }

        // Insert member
        const insert = db.prepare(`
            INSERT INTO project_members (project_id, user_id, role)
            VALUES (?, ?, ?)
        `).run(projectId, targetUser.id, memberRole);

        // Project info for notification
        const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);

        // Create notification for target user
        db.prepare(`
            INSERT INTO notifications (user_id, type, title, message, link)
            VALUES (?, 'project_invite', ?, ?, ?)
        `).run(
            targetUser.id,
            'Project Invitation',
            `${inviter.display_name} added you to "${project.name}" as a ${memberRole}.`,
            `/projects`
        );

        // Activity log
        db.prepare(`
            INSERT INTO activity_log (project_id, user_id, action, details)
            VALUES (?, ?, 'member_added', ?)
        `).run(projectId, inviter.id, `Added ${targetUser.display_name} as ${memberRole}`);

        const newMember = {
            member_id: insert.lastInsertRowid,
            project_id: projectId,
            user_id: targetUser.id,
            username: targetUser.username,
            email: targetUser.email,
            display_name: targetUser.display_name,
            avatar_color: targetUser.avatar_color,
            avatar_url: targetUser.avatar_url,
            role: memberRole,
            joined_at: new Date().toISOString()
        };

        // Real-time broadcast
        const io = req.app.get('io');
        if (io) {
            io.to(`project:${projectId}`).emit('member:joined', newMember);
            io.to(`user:${targetUser.id}`).emit('notification:new', {
                title: 'Project Invitation',
                message: `${inviter.display_name} added you to "${project.name}".`
            });
        }

        return res.status(201).json({
            success: true,
            member: newMember,
            message: `${targetUser.display_name} has been added to the project.`
        });
    } catch (err) {
        console.error('Add member error:', err);
        return res.status(500).json({ success: false, error: 'Failed to add member to project.' });
    }
};

/**
 * Update member role (Admin or Owner)
 */
exports.updateMemberRole = (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const targetUserId = parseInt(req.params.userId, 10);
        const { role } = req.body;
        const currentUserId = req.user.id;

        if (!['Admin', 'Member', 'Viewer'].includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid role. Must be Admin, Member, or Viewer.'
            });
        }

        const project = db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(projectId);
        if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });

        if (targetUserId === project.owner_id) {
            return res.status(400).json({
                success: false,
                error: 'The project Owner\'s role cannot be modified.'
            });
        }

        // Requester rank check
        const requesterMember = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, currentUserId);
        const targetMember = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, targetUserId);

        if (!targetMember) {
            return res.status(404).json({ success: false, error: 'Member not found in project.' });
        }

        // If requester is Admin (not Owner), they cannot edit another Admin's role
        if (requesterMember.role === 'Admin' && targetMember.role === 'Admin') {
            return res.status(403).json({
                success: false,
                error: 'Admins cannot modify other Admins. Only the Owner can do this.'
            });
        }

        db.prepare('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?').run(role, projectId, targetUserId);

        // Activity log
        db.prepare(`
            INSERT INTO activity_log (project_id, user_id, action, details)
            VALUES (?, ?, 'role_updated', ?)
        `).run(projectId, currentUserId, `Changed role of user #${targetUserId} to ${role}`);

        const io = req.app.get('io');
        if (io) {
            io.to(`project:${projectId}`).emit('member:updated', {
                projectId,
                userId: targetUserId,
                role
            });
        }

        return res.json({
            success: true,
            message: `Member role updated to ${role}.`
        });
    } catch (err) {
        console.error('Update member role error:', err);
        return res.status(500).json({ success: false, error: 'Failed to update member role.' });
    }
};

/**
 * Remove a member from project OR member leaves voluntarily
 */
exports.removeMember = (req, res) => {
    try {
        const projectId = parseInt(req.params.id, 10);
        const targetUserId = parseInt(req.params.userId, 10);
        const currentUserId = req.user.id;

        const project = db.prepare('SELECT owner_id, name FROM projects WHERE id = ?').get(projectId);
        if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });

        if (targetUserId === project.owner_id) {
            return res.status(400).json({
                success: false,
                error: 'The project Owner cannot leave or be removed. Transfer ownership or delete the project instead.'
            });
        }

        const isLeavingVoluntarily = (currentUserId === targetUserId);

        if (!isLeavingVoluntarily) {
            // Requester must be Owner or Admin
            const requesterMember = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, currentUserId);
            const targetMember = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, targetUserId);

            if (!requesterMember || (requesterMember.role !== 'Owner' && requesterMember.role !== 'Admin')) {
                return res.status(403).json({ success: false, error: 'Permission denied.' });
            }

            if (requesterMember.role === 'Admin' && targetMember && targetMember.role === 'Admin') {
                return res.status(403).json({
                    success: false,
                    error: 'Admins cannot remove other Admins. Only the Owner can do this.'
                });
            }
        }

        // Delete from project_members
        db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, targetUserId);

        // Remove from task assignments in this project
        db.prepare(`
            DELETE FROM task_assignees 
            WHERE user_id = ? AND task_id IN (SELECT id FROM tasks WHERE project_id = ?)
        `).run(targetUserId, projectId);

        // Activity log
        const actionDetails = isLeavingVoluntarily ? 'Member left the project' : `Removed member #${targetUserId} from project`;
        db.prepare(`
            INSERT INTO activity_log (project_id, user_id, action, details)
            VALUES (?, ?, 'member_removed', ?)
        `).run(projectId, currentUserId, actionDetails);

        const io = req.app.get('io');
        if (io) {
            io.to(`project:${projectId}`).emit('member:left', { projectId, userId: targetUserId });
        }

        return res.json({
            success: true,
            message: isLeavingVoluntarily ? 'You have left the project.' : 'Member removed from project.'
        });
    } catch (err) {
        console.error('Remove member error:', err);
        return res.status(500).json({ success: false, error: 'Failed to remove member.' });
    }
};
