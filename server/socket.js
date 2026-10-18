const jwt = require('jsonwebtoken');
const db = require('./db/database');
const { JWT_SECRET } = require('./middleware/auth');

function parseCookie(str) {
    if (!str) return {};
    return str.split(';').reduce((res, c) => {
        const [key, val] = c.trim().split('=');
        if (key && val) {
            try {
                res[key] = decodeURIComponent(val);
            } catch (e) {
                res[key] = val;
            }
        }
        return res;
    }, {});
}

// Track online users per project: { [projectId]: Map<userId, { user, socketIds: Set<string> }> }
const projectPresence = new Map();

function initSocket(io) {
    // Socket authentication middleware
    io.use((socket, next) => {
        try {
            let token = null;

            // 1. From handshake auth object
            if (socket.handshake.auth && socket.handshake.auth.token) {
                token = socket.handshake.auth.token;
            }
            // 2. From cookies
            else if (socket.handshake.headers.cookie) {
                const cookies = parseCookie(socket.handshake.headers.cookie);
                token = cookies.token;
            }

            if (!token) {
                return next(new Error('Authentication error: No token provided'));
            }

            const decoded = jwt.verify(token, JWT_SECRET);
            const user = db.prepare('SELECT id, username, email, display_name, avatar_color, avatar_url FROM users WHERE id = ?').get(decoded.id);

            if (!user) {
                return next(new Error('Authentication error: User not found'));
            }

            socket.user = user;
            next();
        } catch (err) {
            return next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        const user = socket.user;

        // Join user's personal notification room
        socket.join(`user:${user.id}`);

        // Join project board room with membership check
        socket.on('project:join', ({ projectId }) => {
            const pId = parseInt(projectId, 10);
            if (!pId) return;

            // Check if user is actually a member of this project
            const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(pId, user.id);
            if (!member) {
                socket.emit('error', { message: 'Not authorized for this project.' });
                return;
            }

            const roomName = `project:${pId}`;
            socket.join(roomName);
            socket.currentProjectId = pId;

            // Presence tracking
            if (!projectPresence.has(pId)) {
                projectPresence.set(pId, new Map());
            }
            const roomUsers = projectPresence.get(pId);
            if (!roomUsers.has(user.id)) {
                roomUsers.set(user.id, {
                    id: user.id,
                    username: user.username,
                    display_name: user.display_name,
                    avatar_color: user.avatar_color,
                    avatar_url: user.avatar_url,
                    role: member.role,
                    sockets: new Set([socket.id])
                });
            } else {
                roomUsers.get(user.id).sockets.add(socket.id);
            }

            // Emit current online users in this project
            const onlineList = Array.from(roomUsers.values()).map(u => ({
                id: u.id,
                username: u.username,
                display_name: u.display_name,
                avatar_color: u.avatar_color,
                avatar_url: u.avatar_url,
                role: u.role
            }));
            io.to(roomName).emit('presence:update', { projectId: pId, users: onlineList });
        });

        // Leave project room
        socket.on('project:leave', ({ projectId }) => {
            const pId = parseInt(projectId, 10);
            if (!pId) return;
            handleUserLeaveProject(socket, pId, io);
        });

        // Typing indicators in task comments
        socket.on('typing:start', ({ taskId, projectId }) => {
            if (projectId) {
                socket.to(`project:${projectId}`).emit('typing:start', {
                    taskId,
                    userId: user.id,
                    displayName: user.display_name
                });
            }
        });

        socket.on('typing:stop', ({ taskId, projectId }) => {
            if (projectId) {
                socket.to(`project:${projectId}`).emit('typing:stop', {
                    taskId,
                    userId: user.id
                });
            }
        });

        // Disconnect
        socket.on('disconnect', () => {
            if (socket.currentProjectId) {
                handleUserLeaveProject(socket, socket.currentProjectId, io);
            }
        });
    });

    return io;
}

function handleUserLeaveProject(socket, projectId, io) {
    socket.leave(`project:${projectId}`);
    const roomUsers = projectPresence.get(projectId);
    if (roomUsers && roomUsers.has(socket.user.id)) {
        const u = roomUsers.get(socket.user.id);
        u.sockets.delete(socket.id);
        if (u.sockets.size === 0) {
            roomUsers.delete(socket.user.id);
        }
        if (roomUsers.size === 0) {
            projectPresence.delete(projectId);
        }
        const onlineList = roomUsers ? Array.from(roomUsers.values()).map(u => ({
            id: u.id,
            username: u.username,
            display_name: u.display_name,
            avatar_color: u.avatar_color,
            avatar_url: u.avatar_url,
            role: u.role
        })) : [];
        io.to(`project:${projectId}`).emit('presence:update', { projectId, users: onlineList });
    }
}

module.exports = { initSocket };
