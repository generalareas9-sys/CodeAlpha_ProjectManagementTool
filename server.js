require('dotenv').config();

const path = require('node:path');
const http = require('node:http');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const { attachUser } = require('./src/middleware/auth');
const { notFound, errorHandler } = require('./src/middleware/errors');
const authRoutes = require('./src/routes/auth');
const usersRoutes = require('./src/routes/users');
const dashboardRoutes = require('./src/routes/dashboard');
const projectsRoutes = require('./src/routes/projects');
const columnsRoutes = require('./src/routes/columns');
const tasksRoutes = require('./src/routes/tasks');
const taskDetailsRoutes = require('./src/routes/task-details');
const notificationsRoutes = require('./src/routes/notifications');
const { db } = require('./src/db/connection');
const { COOKIE_NAME, verifySession, publicUser } = require('./src/lib/auth');
const { notifyDueSoon } = require('./src/lib/notifications');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });
app.locals.io = io;
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 5000);

app.disable('x-powered-by');
app.use(helmet({ frameguard: false, contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(attachUser);

app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'taskora' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 80, standardHeaders: true, legacyHeaders: false }), authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api', columnsRoutes);
app.use('/api', tasksRoutes);
app.use('/api', taskDetailsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested API route was not found.' } }));

app.use(express.static(publicDir, { index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.use(notFound);
app.use(errorHandler);

function parseCookieHeader(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=')));
}
function isProjectMember(projectId, userId) { return Boolean(db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId)); }
const projectPresence = new Map();
function emitPresence(projectId) { const users = [...(projectPresence.get(Number(projectId))?.values() || [])]; io.to(`project:${projectId}`).emit('presence:update', { projectId: Number(projectId), online: users.length, users }); }
io.use((socket, next) => {
  try {
    const token = parseCookieHeader(socket.handshake.headers.cookie || '')[COOKIE_NAME];
    if (!token) return next(new Error('AUTH_REQUIRED'));
    const claims = verifySession(decodeURIComponent(token));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(claims.sub));
    if (!user) return next(new Error('AUTH_REQUIRED'));
    socket.user = publicUser(user);
    next();
  } catch { next(new Error('AUTH_REQUIRED')); }
});
io.on('connection', (socket) => {
  socket.join(`user:${socket.user.id}`);
  socket.projectRooms = new Set();
  socket.emit('presence:update', { online: 1 });
  socket.on('project:join', (payload = {}, acknowledge) => {
    const projectId = Number(payload.projectId);
    if (!Number.isInteger(projectId) || projectId < 1 || !isProjectMember(projectId, socket.user.id)) { if (acknowledge) acknowledge({ ok: false, error: 'PROJECT_ACCESS_DENIED' }); return; }
    socket.join(`project:${projectId}`);
    socket.projectRooms.add(projectId);
    if (!projectPresence.has(projectId)) projectPresence.set(projectId, new Map());
    projectPresence.get(projectId).set(socket.user.id, socket.user);
    emitPresence(projectId);
    if (acknowledge) acknowledge({ ok: true, projectId });
  });
  socket.on('project:leave', (payload = {}) => {
    const projectId = Number(payload.projectId);
    if (!socket.projectRooms.has(projectId)) return;
    socket.leave(`project:${projectId}`);
    socket.projectRooms.delete(projectId);
    projectPresence.get(projectId)?.delete(socket.user.id);
    if (projectPresence.get(projectId)?.size === 0) projectPresence.delete(projectId);
    emitPresence(projectId);
  });
  const typing = (event) => (payload = {}) => {
    const projectId = Number(payload.projectId);
    if (!socket.projectRooms.has(projectId)) return;
    socket.to(`project:${projectId}`).emit(event, { projectId, taskId: Number(payload.taskId) || null, user: socket.user });
  };
  socket.on('typing:start', typing('typing:start'));
  socket.on('typing:stop', typing('typing:stop'));
  socket.on('disconnect', () => socket.projectRooms.forEach((projectId) => { projectPresence.get(projectId)?.delete(socket.user.id); if (projectPresence.get(projectId)?.size === 0) projectPresence.delete(projectId); emitPresence(projectId); }));
});
const dueReminderTimer = setInterval(() => notifyDueSoon(io), 15 * 60 * 1000);
dueReminderTimer.unref();
notifyDueSoon(io);

if (require.main === module) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`Taskora listening on http://0.0.0.0:${port}`);
  });
}

module.exports = { app, server, io };
