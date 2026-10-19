const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('./src/db/connection');
const { hashPassword, comparePassword, signSession, verifySession, COOKIE_NAME } = require('./src/lib/auth');
const { io: socketClient } = require('socket.io-client');

test('SQLite enables foreign keys and WAL mode', () => {
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.pragma('journal_mode', { simple: true }).toLowerCase(), 'wal');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'projects', 'tasks', 'notifications') ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ['notifications', 'projects', 'tasks', 'users']);
});

test('password helpers hash and verify without exposing the password', () => {
  const hash = hashPassword('Password123!');
  assert.notEqual(hash, 'Password123!');
  assert.equal(comparePassword('Password123!', hash), true);
  assert.equal(comparePassword('wrong-password', hash), false);
});

test('sessions use the Preview-compatible cookie name and verify', () => {
  const token = signSession({ id: 7, username: 'demo' });
  const payload = verifySession(token);
  assert.equal(COOKIE_NAME, 'webdev_app_session');
  assert.equal(payload.sub, '7');
});

const { server } = require('./server');

test('project APIs enforce membership roles and owner lifecycle rules', async () => {
  const suffix = Date.now();
  const userIds = [];
  const createUser = (label) => {
    const username = `test_${label}_${suffix}`;
    const result = db.prepare('INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)').run(username, `${username}@example.com`, hashPassword('PhaseTwoPass123!'), `Test ${label}`);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    userIds.push(user.id);
    return { user, token: signSession(user) };
  };
  const owner = createUser('owner');
  const admin = createUser('admin');
  const member = createUser('member');
  const viewer = createUser('viewer');
  const outsider = createUser('outsider');
  const address = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (token, path, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(options.headers || {}) },
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
    });
    return { status: response.status, payload: await response.json() };
  };
  let projectId;
  try {
    let response = await request(owner.token, '/api/projects', { method: 'POST', body: { name: 'Test Project', description: 'Permission test', color: '#6366F1', icon: 'layers' } });
    assert.equal(response.status, 201);
    projectId = response.payload.data.project.id;
    assert.equal(response.payload.data.project.columns.length, 4);
    assert.equal(response.payload.data.project.role, 'Owner');
    response = await request(owner.token, `/api/projects/${projectId}/members`, { method: 'POST', body: { identifier: admin.user.username, role: 'Admin' } });
    assert.equal(response.status, 201);
    response = await request(owner.token, `/api/projects/${projectId}/members`, { method: 'POST', body: { identifier: member.user.email, role: 'Member' } });
    assert.equal(response.status, 201);
    response = await request(owner.token, `/api/projects/${projectId}/members`, { method: 'POST', body: { identifier: viewer.user.username, role: 'Viewer' } });
    assert.equal(response.status, 201);
    response = await request(admin.token, `/api/projects/${projectId}`, { method: 'PUT', body: { name: 'Updated Test Project' } });
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.project.role, 'Admin');
    response = await request(admin.token, `/api/projects/${projectId}/members`, { method: 'POST', body: { identifier: outsider.user.username, role: 'Admin' } });
    assert.equal(response.status, 403);
    response = await request(viewer.token, `/api/projects/${projectId}`, { method: 'PUT', body: { name: 'Viewer Cannot Edit' } });
    assert.equal(response.status, 403);
    response = await request(outsider.token, `/api/projects/${projectId}`);
    assert.equal(response.status, 403);
    response = await request(member.token, `/api/projects/${projectId}/members/me`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    response = await request(owner.token, `/api/projects/${projectId}/members/${viewer.user.id}`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    response = await request(owner.token, `/api/projects/${projectId}`, { method: 'DELETE' });
    assert.equal(response.status, 200);
  } finally {
    if (projectId) db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    db.prepare(`DELETE FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`).run(...userIds);
    await new Promise((resolve) => server.close(resolve));
  }
});


test('columns and tasks persist board order and respect read-only roles', async () => {
  const suffix = Date.now();
  const userIds = [];
  const createUser = (label) => {
    const username = `board_${label}_${suffix}`;
    const result = db.prepare('INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)').run(username, `${username}@example.com`, hashPassword('PhaseThreePass123!'), `Board ${label}`);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    userIds.push(user.id);
    return { user, token: signSession(user) };
  };
  const owner = createUser('owner');
  const member = createUser('member');
  const viewer = createUser('viewer');
  const address = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (token, path, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(options.headers || {}) },
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
    });
    return { status: response.status, payload: await response.json() };
  };
  let projectId;
  try {
    let response = await request(owner.token, '/api/projects', { method: 'POST', body: { name: 'Board Test', description: 'Kanban coverage' } });
    assert.equal(response.status, 201);
    projectId = response.payload.data.project.id;
    const columns = response.payload.data.project.columns;
    assert.equal(columns.length, 4);
    response = await request(owner.token, `/api/projects/${projectId}/members`, { method: 'POST', body: { identifier: member.user.username, role: 'Member' } });
    assert.equal(response.status, 201);
    response = await request(owner.token, `/api/projects/${projectId}/members`, { method: 'POST', body: { identifier: viewer.user.username, role: 'Viewer' } });
    assert.equal(response.status, 201);
    response = await request(owner.token, `/api/projects/${projectId}/tasks`, { method: 'POST', body: { title: 'First board task', priority: 'High', columnId: columns[0].id } });
    assert.equal(response.status, 201);
    const firstTask = response.payload.data.task;
    response = await request(owner.token, `/api/projects/${projectId}/tasks`, { method: 'POST', body: { title: 'Second board task', priority: 'Urgent', dueDate: '2099-12-31', columnId: columns[0].id } });
    assert.equal(response.status, 201);
    const secondTask = response.payload.data.task;
    response = await request(owner.token, `/api/tasks/${secondTask.id}/move`, { method: 'PUT', body: { columnId: columns[1].id, position: 0 } });
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.task.columnId, columns[1].id);
    response = await request(member.token, `/api/tasks/${firstTask.id}`, { method: 'PUT', body: { title: 'Updated board task', priority: 'Low' } });
    assert.equal(response.status, 200);
    response = await request(viewer.token, `/api/projects/${projectId}/tasks`, { method: 'POST', body: { title: 'Viewer cannot create' } });
    assert.equal(response.status, 403);
    response = await request(viewer.token, `/api/tasks/${secondTask.id}/move`, { method: 'PUT', body: { columnId: columns[2].id, position: 0 } });
    assert.equal(response.status, 403);
    response = await request(owner.token, `/api/projects/${projectId}/columns`, { method: 'POST', body: { name: 'QA Review', color: '#EC4899' } });
    assert.equal(response.status, 201);
    const addedColumn = response.payload.data.column;
    response = await request(owner.token, `/api/columns/${addedColumn.id}`, { method: 'PUT', body: { name: 'Quality Review' } });
    assert.equal(response.status, 200);
    response = await request(owner.token, `/api/projects/${projectId}/columns/reorder`, { method: 'PUT', body: { columnIds: [columns[3].id, columns[0].id, columns[1].id, columns[2].id, addedColumn.id] } });
    assert.equal(response.status, 200);
    response = await request(owner.token, `/api/columns/${columns[0].id}`, { method: 'DELETE' });
    assert.equal(response.status, 409);
    response = await request(owner.token, `/api/columns/${addedColumn.id}`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    response = await request(owner.token, `/api/projects/${projectId}/tasks`);
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.tasks.length, 2);
    assert.equal(response.payload.data.tasks.find((task) => task.id === firstTask.id).priority, 'Low');
    assert.equal(response.payload.data.tasks.find((task) => task.id === secondTask.id).columnId, columns[1].id);
    response = await request(owner.token, `/api/projects/${projectId}`, { method: 'DELETE' });
    assert.equal(response.status, 200);
  } finally {
    if (projectId) db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    db.prepare(`DELETE FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`).run(...userIds);
    await new Promise((resolve) => server.close(resolve));
  }
});


test('task detail collaboration features persist relations and enforce roles', async () => {
  const suffix = Date.now();
  const userIds = [];
  const createUser = (label) => {
    const username = `detail_${label}_${suffix}`;
    const result = db.prepare('INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)').run(username, `${username}@example.com`, hashPassword('PhaseFourPass123!'), `Detail ${label}`);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    userIds.push(user.id);
    return { user, token: signSession(user) };
  };
  const owner = createUser('owner');
  const member = createUser('member');
  const viewer = createUser('viewer');
  const address = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (token, path, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(options.headers || {}) },
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
    });
    return { status: response.status, payload: await response.json() };
  };
  let projectId;
  try {
    let response = await request(owner.token, '/api/projects', { method: 'POST', body: { name: 'Detail Test', description: 'Collaboration coverage' } });
    assert.equal(response.status, 201);
    projectId = response.payload.data.project.id;
    const columnId = response.payload.data.project.columns[0].id;
    response = await request(owner.token, `/api/projects/${projectId}/members`, { method: 'POST', body: { identifier: member.user.username, role: 'Member' } });
    assert.equal(response.status, 201);
    response = await request(owner.token, `/api/projects/${projectId}/members`, { method: 'POST', body: { identifier: viewer.user.username, role: 'Viewer' } });
    assert.equal(response.status, 201);
    response = await request(owner.token, `/api/projects/${projectId}/tasks`, { method: 'POST', body: { title: 'Detailed task', description: 'Task context', priority: 'High', columnId } });
    assert.equal(response.status, 201);
    const taskId = response.payload.data.task.id;
    response = await request(owner.token, `/api/tasks/${taskId}/assignees`, { method: 'PUT', body: { userIds: [member.user.id] } });
    assert.equal(response.status, 200);
    response = await request(owner.token, `/api/projects/${projectId}/labels`, { method: 'POST', body: { name: 'Design', color: '#EC4899' } });
    assert.equal(response.status, 201);
    const labelId = response.payload.data.label.id;
    response = await request(member.token, `/api/tasks/${taskId}/labels`, { method: 'PUT', body: { labelIds: [labelId] } });
    assert.equal(response.status, 200);
    response = await request(member.token, `/api/tasks/${taskId}/checklist`, { method: 'POST', body: { title: 'Review final copy' } });
    assert.equal(response.status, 201);
    const checklistId = response.payload.data.task.checklist[0].id;
    response = await request(member.token, `/api/checklist/${checklistId}`, { method: 'PUT', body: { completed: true } });
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.task.checklistProgress, 100);
    response = await request(member.token, `/api/tasks/${taskId}/comments`, { method: 'POST', body: { body: 'Looks ready for @review.' } });
    assert.equal(response.status, 201);
    const commentId = response.payload.data.task.comments[0].id;
    response = await request(member.token, `/api/comments/${commentId}`, { method: 'PUT', body: { body: 'Looks ready for @review and @owner.' } });
    assert.equal(response.status, 200);
    response = await request(member.token, `/api/projects/${projectId}/tasks?assigneeId=me`);
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.tasks.length, 1);
    response = await request(viewer.token, `/api/tasks/${taskId}/comments`, { method: 'POST', body: { body: 'Viewer cannot comment.' } });
    assert.equal(response.status, 403);
    response = await request(viewer.token, `/api/tasks/${taskId}/assignees`, { method: 'PUT', body: { userIds: [] } });
    assert.equal(response.status, 403);
    response = await request(owner.token, `/api/tasks/${taskId}/detail`);
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.task.assignees[0].id, member.user.id);
    assert.equal(response.payload.data.task.labels[0].id, labelId);
    assert.equal(response.payload.data.task.comments.length, 1);
    assert.ok(response.payload.data.task.activity.length >= 4);
    response = await request(member.token, `/api/tasks/${taskId}/duplicate`, { method: 'POST' });
    assert.equal(response.status, 201);
    const duplicateId = response.payload.data.task.id;
    assert.equal(response.payload.data.task.labels[0].id, labelId);
    assert.equal(response.payload.data.task.checklist.length, 1);
    response = await request(member.token, `/api/tasks/${taskId}/archive`, { method: 'POST' });
    assert.equal(response.status, 200);
    response = await request(owner.token, `/api/projects/${projectId}/tasks`);
    assert.equal(response.payload.data.tasks.some((task) => task.id === taskId), false);
    response = await request(owner.token, `/api/labels/${labelId}`, { method: 'PUT', body: { name: 'Brand Design' } });
    assert.equal(response.status, 200);
    response = await request(owner.token, `/api/labels/${labelId}` , { method: 'DELETE' });
    assert.equal(response.status, 200);
    response = await request(owner.token, `/api/projects/${projectId}`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    assert.ok(duplicateId);
  } finally {
    if (projectId) db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    db.prepare(`DELETE FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`).run(...userIds);
    await new Promise((resolve) => server.close(resolve));
  }
});


test('notifications and authenticated Socket.io rooms deliver live events', async () => {
  const suffix = Date.now();
  const userIds = [];
  const createUser = (label) => {
    const username = `realtime_${label}_${suffix}`;
    const result = db.prepare('INSERT INTO users (username, email, password_hash, display_name) VALUES (?, ?, ?, ?)').run(username, `${username}@example.com`, hashPassword('PhaseFivePass123!'), `Realtime ${label}`);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    userIds.push(user.id);
    return { user, token: signSession(user) };
  };
  const owner = createUser('owner');
  const member = createUser('member');
  const address = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (token, path, options = {}) => {
    const response = await fetch(`${base}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(options.headers || {}) },
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
    });
    return { status: response.status, payload: await response.json() };
  };
  const waitForEvent = (socket, event, predicate = () => true, timeout = 2500) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Timed out waiting for ${event}`)); }, timeout);
    const handler = (payload) => { if (!predicate(payload)) return; clearTimeout(timer); socket.off(event, handler); resolve(payload); };
    socket.on(event, handler);
  });
  let projectId;
  let ownerSocket;
  let memberSocket;
  try {
    let response = await request(owner.token, '/api/projects', { method: 'POST', body: { name: 'Realtime Test' } });
    assert.equal(response.status, 201);
    projectId = response.payload.data.project.id;
    const columnId = response.payload.data.project.columns[0].id;
    response = await request(owner.token, `/api/projects/${projectId}/members`, { method: 'POST', body: { identifier: member.user.username, role: 'Member' } });
    assert.equal(response.status, 201);
    ownerSocket = socketClient(base, { extraHeaders: { Cookie: `${COOKIE_NAME}=${owner.token}` }, transports: ['websocket'] });
    memberSocket = socketClient(base, { extraHeaders: { Cookie: `${COOKIE_NAME}=${member.token}` }, transports: ['websocket'] });
    await Promise.all([new Promise((resolve, reject) => { ownerSocket.once('connect', resolve); ownerSocket.once('connect_error', reject); }), new Promise((resolve, reject) => { memberSocket.once('connect', resolve); memberSocket.once('connect_error', reject); })]);
    const ownerJoin = await new Promise((resolve) => ownerSocket.emit('project:join', { projectId }, resolve));
    const memberJoin = await new Promise((resolve) => memberSocket.emit('project:join', { projectId }, resolve));
    assert.deepEqual(ownerJoin, { ok: true, projectId });
    assert.deepEqual(memberJoin, { ok: true, projectId });
    const createdEvent = waitForEvent(ownerSocket, 'task:created', (payload) => payload.task?.projectId === projectId);
    response = await request(owner.token, `/api/projects/${projectId}/tasks`, { method: 'POST', body: { title: 'Live task', columnId } });
    assert.equal(response.status, 201);
    const createdTask = await createdEvent;
    assert.equal(createdTask.task.title, 'Live task');
    const notificationEvent = waitForEvent(memberSocket, 'notification:new', (payload) => payload.type === 'assignment');
    const updatedEvent = waitForEvent(ownerSocket, 'task:updated', (payload) => payload.task?.id === response.payload.data.task.id);
    response = await request(owner.token, `/api/tasks/${response.payload.data.task.id}/assignees`, { method: 'PUT', body: { userIds: [member.user.id] } });
    assert.equal(response.status, 200);
    const notification = await notificationEvent;
    assert.equal(notification.userId, member.user.id);
    assert.equal((await updatedEvent).task.assignees[0].id, member.user.id);
    const typingEvent = waitForEvent(memberSocket, 'typing:start', (payload) => payload.projectId === projectId);
    ownerSocket.emit('typing:start', { projectId, taskId: response.payload.data.task.id });
    assert.equal((await typingEvent).user.id, owner.user.id);
    const stopEvent = waitForEvent(memberSocket, 'typing:stop', (payload) => payload.projectId === projectId);
    ownerSocket.emit('typing:stop', { projectId, taskId: response.payload.data.task.id });
    await stopEvent;
    response = await request(member.token, '/api/notifications');
    assert.equal(response.status, 200);
    assert.ok(response.payload.data.notifications.some((item) => item.type === 'assignment'));
    assert.ok(response.payload.data.unreadCount >= 1);
    const notificationId = response.payload.data.notifications[0].id;
    response = await request(member.token, `/api/notifications/${notificationId}/read`, { method: 'POST' });
    assert.equal(response.status, 200);
    response = await request(member.token, '/api/notifications/read-all', { method: 'POST' });
    assert.equal(response.status, 200);
    response = await request(member.token, '/api/notifications');
    assert.equal(response.payload.data.unreadCount, 0);
  } finally {
    ownerSocket?.disconnect();
    memberSocket?.disconnect();
    if (projectId) db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    db.prepare(`DELETE FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`).run(...userIds);
    await new Promise((resolve) => server.close(resolve));
  }
});


test('auth endpoints, dashboard summaries, and task filters work end to end', async () => {
  const suffix = Date.now();
  const username = `auth_${suffix}`;
  const email = `${username}@example.com`;
  const address = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
  const base = `http://127.0.0.1:${address.port}`;
  const request = async (path, options = {}, cookie = '') => {
    const response = await fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(options.headers || {}) }, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
    return { status: response.status, headers: response.headers, payload: await response.json() };
  };
  let userId;
  let projectId;
  try {
    let response = await request('/api/auth/register', { method: 'POST', body: { username, email, password: 'AuthPass123!', displayName: 'Auth Tester' } });
    assert.equal(response.status, 201);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    userId = response.payload.data.user.id;
    response = await request('/api/auth/me', {}, cookie);
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.user.username, username);
    response = await request('/api/projects', { method: 'POST', body: { name: `Auth Project ${suffix}` } }, cookie);
    assert.equal(response.status, 201);
    projectId = response.payload.data.project.id;
    const columnId = response.payload.data.project.columns[0].id;
    response = await request(`/api/projects/${projectId}/tasks`, { method: 'POST', body: { title: 'Filtered urgent task', priority: 'Urgent', dueDate: new Date().toISOString().slice(0, 10), columnId } }, cookie);
    assert.equal(response.status, 201);
    response = await request(`/api/projects/${projectId}/tasks?priority=Urgent&due=today`, {}, cookie);
    assert.equal(response.status, 200);
    assert.equal(response.payload.data.tasks.length, 1);
    response = await request('/api/dashboard', {}, cookie);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.payload.data.projectProgress));
    assert.ok(Array.isArray(response.payload.data.dueToday));
    response = await request('/api/auth/logout', { method: 'POST' }, cookie);
    assert.equal(response.status, 200);
    response = await request('/api/auth/me');
    assert.equal(response.status, 401);
  } finally {
    if (projectId) db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    if (userId) db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    await new Promise((resolve) => server.close(resolve));
  }
});
