require('dotenv').config();
const { db, transaction } = require('../src/db/connection');
const { hashPassword } = require('../src/lib/auth');

const passwordHash = hashPassword('Password123!');
const users = [
  ['osman', 'osman@taskora.local', 'Osman Seid Ebrahim', '#6366F1'],
  ['maya', 'maya@taskora.local', 'Maya Chen', '#EC4899'],
  ['liam', 'liam@taskora.local', 'Liam Brooks', '#22C55E'],
  ['sofia', 'sofia@taskora.local', 'Sofia Patel', '#F59E0B'],
  ['noah', 'noah@taskora.local', 'Noah Williams', '#8B5CF6'],
  ['amira', 'amira@taskora.local', 'Amira Hassan', '#14B8A6'],
  ['ethan', 'ethan@taskora.local', 'Ethan Kim', '#F97316'],
  ['zoe', 'zoe@taskora.local', 'Zoe Martin', '#EF4444'],
  ['demo', 'demo@taskora.local', 'Demo Account', '#000000']
];
const projects = [
  { name: 'Website Redesign', description: 'A sharper marketing site that turns product clarity into momentum.', color: '#6366F1', icon: 'layout' },
  { name: 'Mobile App Launch', description: 'Coordinate the final release train for the Taskora companion app.', color: '#EC4899', icon: 'smartphone' },
  { name: 'Marketing Campaign', description: 'Plan the launch story, creative system, and campaign measurement.', color: '#F59E0B', icon: 'megaphone' }
];
const taskSets = [
  ['Audit current navigation', 'Draft new homepage copy', 'Create responsive wireframes', 'Review accessibility issues', 'Build landing page hero', 'QA tablet breakpoints', 'Prepare stakeholder demo', 'Publish redesign changelog', 'Retire legacy components'],
  ['Finalize onboarding flow', 'Connect analytics events', 'Resolve push notification edge cases', 'Run TestFlight regression', 'Prepare app store screenshots', 'Write release notes', 'Coordinate launch webinar', 'Monitor first-week crashes', 'Collect beta feedback'],
  ['Define campaign narrative', 'Approve visual direction', 'Draft email sequence', 'Build social launch kit', 'Configure attribution links', 'Schedule creator briefings', 'Review paid media plan', 'Publish launch report', 'Archive campaign assets']
];
function dateOffset(offset) { const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); }
function ensureUser([username, email, displayName, avatarColor]) { const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username); if (existing) return existing.id; return Number(db.prepare('INSERT INTO users (username, email, password_hash, display_name, avatar_color) VALUES (?, ?, ?, ?, ?)').run(username, email, passwordHash, displayName, avatarColor).lastInsertRowid); }
function ensureProject(project, ownerId) { const existing = db.prepare('SELECT id FROM projects WHERE name = ?').get(project.name); if (existing) return existing.id; const id = Number(db.prepare('INSERT INTO projects (name, description, color, icon, owner_id) VALUES (?, ?, ?, ?, ?)').run(project.name, project.description, project.color, project.icon, ownerId).lastInsertRowid); db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'Owner')").run(id, ownerId); [['To Do', '#6366F1'], ['In Progress', '#F59E0B'], ['In Review', '#8B5CF6'], ['Done', '#22C55E']].forEach(([name, color], index) => db.prepare('INSERT INTO "columns" (project_id, name, color, position) VALUES (?, ?, ?, ?)').run(id, name, color, index)); return id; }
function ensureMember(projectId, userId, role) { if (!db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId)) db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)').run(projectId, userId, role); }
function ensureLabel(projectId, name, color) { const existing = db.prepare('SELECT id FROM labels WHERE project_id = ? AND name = ?').get(projectId, name); return existing ? existing.id : Number(db.prepare('INSERT INTO labels (project_id, name, color) VALUES (?, ?, ?)').run(projectId, name, color).lastInsertRowid); }
transaction(() => {
  const userIds = users.map(ensureUser);
  const ownerId = userIds[0];
  const demoAccount = db.prepare("SELECT id FROM users WHERE username = 'demo'").get();
  const labelSets = [['Research', '#6366F1'], ['Design', '#EC4899'], ['Engineering', '#22C55E'], ['Launch', '#F59E0B'], ['Blocked', '#EF4444']];
  projects.forEach((project, projectIndex) => {
    const projectId = ensureProject(project, ownerId);
    userIds.forEach((userId, index) => ensureMember(projectId, userId, index === 1 ? 'Admin' : index === 7 ? 'Viewer' : 'Member'));
    if (demoAccount) ensureMember(projectId, demoAccount.id, 'Admin');
    const labels = labelSets.map(([name, color]) => ensureLabel(projectId, name, color));
    const columns = db.prepare('SELECT id FROM "columns" WHERE project_id = ? ORDER BY position, id').all(projectId);
    taskSets[projectIndex].forEach((title, taskIndex) => {
      let task = db.prepare('SELECT id FROM tasks WHERE project_id = ? AND title = ?').get(projectId, title);
      if (!task) {
        const column = columns[Math.min(Math.floor(taskIndex / 3), columns.length - 1)];
        const priority = ['High', 'Medium', 'Urgent', 'Low'][taskIndex % 4];
        const dueDate = [dateOffset(-6), dateOffset(-1), dateOffset(0), dateOffset(2), dateOffset(4), dateOffset(8), dateOffset(12), dateOffset(18), null][taskIndex];
        const result = db.prepare('INSERT INTO tasks (project_id, column_id, title, description, priority, due_date, position, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(projectId, column.id, `${title}`, `A realistic ${project.name.toLowerCase()} work item with a clear next step.`, priority, dueDate, taskIndex % 3, userIds[(taskIndex + projectIndex) % userIds.length]);
        task = { id: Number(result.lastInsertRowid) };
        const assigneeA = userIds[(taskIndex + projectIndex) % userIds.length];
        const assigneeB = userIds[(taskIndex + projectIndex + 1) % userIds.length];
        db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(task.id, assigneeA);
        if (taskIndex % 3 === 0) db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(task.id, assigneeB);
        if (demoAccount && taskIndex % 3 === 0) db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(task.id, demoAccount.id);
        db.prepare('INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)').run(task.id, labels[taskIndex % labels.length]);
        if (taskIndex % 2 === 0) db.prepare('INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)').run(task.id, labels[(taskIndex + 1) % labels.length]);
        for (let item = 0; item < (taskIndex % 3) + 1; item += 1) db.prepare('INSERT INTO checklist_items (task_id, title, completed, position) VALUES (?, ?, ?, ?)').run(task.id, ['Confirm owner', 'Share draft', 'Capture feedback'][item], item === 0 && taskIndex % 2 === 0 ? 1 : 0, item);
        db.prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)').run(task.id, assigneeA, taskIndex % 2 ? `Progress is moving. @${users[(taskIndex + 1) % users.length][0]} can review the next pass.` : 'Added context and a clear acceptance note for the team.');
        db.prepare("INSERT INTO activity_log (project_id, task_id, actor_id, action, metadata) VALUES (?, ?, ?, 'created a task', ?)").run(projectId, task.id, userIds[(taskIndex + projectIndex) % userIds.length], JSON.stringify({ seeded: true }));
      }
    });
    const notificationUser = userIds[(projectIndex + 1) % userIds.length];
    if (!db.prepare("SELECT id FROM notifications WHERE user_id = ? AND project_id = ? AND type = 'project_invite'").get(notificationUser, projectId)) db.prepare("INSERT INTO notifications (user_id, project_id, type, title, body) VALUES (?, ?, 'project_invite', 'You joined a project', ?)").run(notificationUser, projectId, `${project.name} is ready for collaboration.`);
    if (demoAccount && !db.prepare("SELECT id FROM notifications WHERE user_id = ? AND project_id = ? AND type = 'project_invite'").get(demoAccount.id, projectId)) db.prepare("INSERT INTO notifications (user_id, project_id, type, title, body) VALUES (?, ?, 'project_invite', 'Demo workspace ready', ?)").run(demoAccount.id, projectId, `${project.name} is ready for your review.`);
  });
});
console.log(`Seeded ${users.length} demo users, ${projects.length} projects, and ${projects.length * 9} tasks.`);
console.log('All demo accounts use password: Password123!');
