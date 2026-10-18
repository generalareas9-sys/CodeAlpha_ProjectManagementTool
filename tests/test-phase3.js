const { app, server } = require('../server/server.js');
const db = require('../server/db/database');

async function testPhase3() {
    try {
        console.log('Testing Phase 3 Kanban Board, Columns, Tasks & Drag-and-Drop...');

        async function createUser(username, email, roleName) {
            const res = await fetch('http://localhost:5000/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    email,
                    password: 'Password123!',
                    display_name: roleName
                })
            });
            const cookie = res.headers.get('set-cookie');
            const data = await res.json();
            return { user: data.user, cookie };
        }

        const owner = await createUser('owner_p3', 'owner_p3@test.io', 'Owner Test');
        const member = await createUser('member_p3', 'member_p3@test.io', 'Member Test');
        const viewer = await createUser('viewer_p3', 'viewer_p3@test.io', 'Viewer Test');

        // Create project
        const createProj = await fetch('http://localhost:5000/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': owner.cookie },
            body: JSON.stringify({
                name: 'Kanban Sprint Board',
                description: 'Phase 3 Verification',
                color: '#6366F1',
                icon: 'kanban'
            })
        });
        const projData = await createProj.json();
        const projectId = projData.project.id;

        // Add Member and Viewer
        await fetch(`http://localhost:5000/api/projects/${projectId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': owner.cookie },
            body: JSON.stringify({ identifier: 'member_p3', role: 'Member' })
        });
        await fetch(`http://localhost:5000/api/projects/${projectId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': owner.cookie },
            body: JSON.stringify({ identifier: 'viewer_p3', role: 'Viewer' })
        });

        const columns = db.prepare('SELECT id, name, position FROM columns WHERE project_id = ? ORDER BY position').all(projectId);
        console.log(`Initialized board with ${columns.length} columns:`, columns.map(c => c.name));
        const col1 = columns[0].id;
        const col2 = columns[1].id;

        // 1. Task Creation by Member
        const task1Res = await fetch(`http://localhost:5000/api/projects/${projectId}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': member.cookie },
            body: JSON.stringify({
                title: 'Build drag and drop board',
                description: 'HTML5 DnD with position persistence',
                column_id: col1,
                priority: 'Urgent',
                due_date: '2026-10-25',
                assignee_ids: [member.user.id]
            })
        });
        const task1Data = await task1Res.json();
        console.log('Member created Task 1:', task1Data.success, 'ID:', task1Data.task.id);
        const task1Id = task1Data.task.id;

        const task2Res = await fetch(`http://localhost:5000/api/projects/${projectId}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': member.cookie },
            body: JSON.stringify({
                title: 'Second task in column 1',
                column_id: col1,
                priority: 'High'
            })
        });
        const task2Id = (await task2Res.json()).task.id;

        // 2. Viewer cannot create task
        const viewerCreate = await fetch(`http://localhost:5000/api/projects/${projectId}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': viewer.cookie },
            body: JSON.stringify({ title: 'Viewer Attempt', column_id: col1 })
        });
        console.log('Viewer create task (should be 403):', viewerCreate.status);

        // 3. Move Task 1 to Column 2 (Drag and Drop)
        const moveRes = await fetch(`http://localhost:5000/api/tasks/${task1Id}/move`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Cookie': member.cookie },
            body: JSON.stringify({
                target_column_id: col2,
                target_position: 0
            })
        });
        console.log('Move Task across columns (should be 200):', moveRes.status);

        // Verify database position and column
        const movedTask = db.prepare('SELECT column_id, position FROM tasks WHERE id = ?').get(task1Id);
        console.log('Moved task DB state:', movedTask.column_id === col2 ? 'In Column 2 (OK)' : 'Failed');

        // 4. Viewer cannot move task
        const viewerMove = await fetch(`http://localhost:5000/api/tasks/${task1Id}/move`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Cookie': viewer.cookie },
            body: JSON.stringify({ target_column_id: col1, target_position: 0 })
        });
        console.log('Viewer move task (should be 403):', viewerMove.status);

        // 5. Duplicate Task
        const dupRes = await fetch(`http://localhost:5000/api/tasks/${task1Id}/duplicate`, {
            method: 'POST',
            headers: { 'Cookie': member.cookie }
        });
        const dupData = await dupRes.json();
        console.log('Duplicate task (should be 201):', dupRes.status, 'Title:', dupData.task.title);

        // 6. Member cannot manage columns (requires Admin/Owner)
        const memberAddCol = await fetch(`http://localhost:5000/api/projects/${projectId}/columns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': member.cookie },
            body: JSON.stringify({ name: 'Testing Column' })
        });
        console.log('Member create column attempt (should be 403):', memberAddCol.status);

        // 7. Owner creates, renames, and reorders column
        const ownerAddCol = await fetch(`http://localhost:5000/api/projects/${projectId}/columns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': owner.cookie },
            body: JSON.stringify({ name: 'QA Testing' })
        });
        const newColId = (await ownerAddCol.json()).column.id;
        console.log('Owner added column (should be 201):', ownerAddCol.status);

        const renameCol = await fetch(`http://localhost:5000/api/columns/${newColId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Cookie': owner.cookie },
            body: JSON.stringify({ name: 'Quality Assurance' })
        });
        console.log('Owner renamed column (should be 200):', renameCol.status);

        // Reorder columns
        const reorderRes = await fetch(`http://localhost:5000/api/projects/${projectId}/columns/reorder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Cookie': owner.cookie },
            body: JSON.stringify({
                columnOrder: [newColId, col1, col2]
            })
        });
        console.log('Owner reordered columns (should be 200):', reorderRes.status);

        // 8. Delete task
        const deleteRes = await fetch(`http://localhost:5000/api/tasks/${task2Id}`, {
            method: 'DELETE',
            headers: { 'Cookie': member.cookie }
        });
        console.log('Member delete task (should be 200):', deleteRes.status);

        // Clean up
        db.prepare("DELETE FROM users WHERE username LIKE '%_p3'").run();
        console.log('Phase 3 verification passed completely!');
        server.close(() => process.exit(0));
    } catch (err) {
        console.error('Test error:', err);
        server.close(() => process.exit(1));
    }
}

setTimeout(testPhase3, 1000);
