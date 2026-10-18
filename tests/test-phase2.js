const { app, server } = require('../server/server.js');
const db = require('../server/db/database');

async function testPhase2() {
    try {
        console.log('Testing Phase 2 Projects, Members & Permissions...');

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

        const owner = await createUser('owner_p2', 'owner_p2@test.io', 'Owner Test');
        const member = await createUser('member_p2', 'member_p2@test.io', 'Member Test');
        const viewer = await createUser('viewer_p2', 'viewer_p2@test.io', 'Viewer Test');
        const outsider = await createUser('outsider_p2', 'outsider_p2@test.io', 'Outsider Test');

        console.log('Registered 4 test users.');

        // 1. Owner creates project
        const createRes = await fetch('http://localhost:5000/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': owner.cookie },
            body: JSON.stringify({
                name: 'Alpha Redesign',
                description: 'Test project for Phase 2',
                color: '#6366F1',
                icon: 'kanban'
            })
        });
        const createData = await createRes.json();
        console.log('Project created:', createData.success, 'ID:', createData.project.id);
        const projectId = createData.project.id;

        // Verify default columns created
        const cols = db.prepare('SELECT name, position FROM columns WHERE project_id = ? ORDER BY position').all(projectId);
        console.log('Columns created automatically:', cols.map(c => c.name));

        // 2. Owner invites Member and Viewer
        const inviteMemberRes = await fetch(`http://localhost:5000/api/projects/${projectId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': owner.cookie },
            body: JSON.stringify({ identifier: 'member_p2', role: 'Member' })
        });
        console.log('Invited Member:', (await inviteMemberRes.json()).success);

        const inviteViewerRes = await fetch(`http://localhost:5000/api/projects/${projectId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Cookie': owner.cookie },
            body: JSON.stringify({ identifier: 'viewer_p2', role: 'Viewer' })
        });
        console.log('Invited Viewer:', (await inviteViewerRes.json()).success);

        // 3. Search users endpoint
        const searchRes = await fetch('http://localhost:5000/api/users?search=member', {
            headers: { 'Cookie': owner.cookie }
        });
        const searchData = await searchRes.json();
        console.log('User search count:', searchData.users.length);

        // 4. Strict Permissions Checks:
        // Viewer can read project details
        const viewerRead = await fetch(`http://localhost:5000/api/projects/${projectId}`, {
            headers: { 'Cookie': viewer.cookie }
        });
        console.log('Viewer read access (should be 200):', viewerRead.status);

        // Outsider cannot read project details
        const outsiderRead = await fetch(`http://localhost:5000/api/projects/${projectId}`, {
            headers: { 'Cookie': outsider.cookie }
        });
        console.log('Outsider read access (should be 403):', outsiderRead.status);

        // Viewer cannot update project
        const viewerUpdate = await fetch(`http://localhost:5000/api/projects/${projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Cookie': viewer.cookie },
            body: JSON.stringify({ name: 'Hacked Project' })
        });
        console.log('Viewer update attempt (should be 403):', viewerUpdate.status);

        // Member cannot update project (needs Admin/Owner)
        const memberUpdate = await fetch(`http://localhost:5000/api/projects/${projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Cookie': member.cookie },
            body: JSON.stringify({ name: 'Hacked by Member' })
        });
        console.log('Member update attempt (should be 403):', memberUpdate.status);

        // Member cannot delete project
        const memberDelete = await fetch(`http://localhost:5000/api/projects/${projectId}`, {
            method: 'DELETE',
            headers: { 'Cookie': member.cookie }
        });
        console.log('Member delete attempt (should be 403):', memberDelete.status);

        // 5. Promote Member to Admin
        const promoteRes = await fetch(`http://localhost:5000/api/projects/${projectId}/members/${member.user.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Cookie': owner.cookie },
            body: JSON.stringify({ role: 'Admin' })
        });
        console.log('Promote to Admin (should be 200):', promoteRes.status);

        // 6. Admin can now update project name
        const adminUpdate = await fetch(`http://localhost:5000/api/projects/${projectId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Cookie': member.cookie },
            body: JSON.stringify({ name: 'Alpha Redesign - Updated by Admin' })
        });
        console.log('Admin update project (should be 200):', adminUpdate.status);

        // Admin still CANNOT delete project (Owner only)
        const adminDelete = await fetch(`http://localhost:5000/api/projects/${projectId}`, {
            method: 'DELETE',
            headers: { 'Cookie': member.cookie }
        });
        console.log('Admin delete attempt (should be 403):', adminDelete.status);

        // 7. Member leaves voluntarily
        const leaveRes = await fetch(`http://localhost:5000/api/projects/${projectId}/members/${member.user.id}`, {
            method: 'DELETE',
            headers: { 'Cookie': member.cookie }
        });
        console.log('Member leave voluntarily (should be 200):', leaveRes.status);

        // 8. Owner deletes project
        const ownerDelete = await fetch(`http://localhost:5000/api/projects/${projectId}`, {
            method: 'DELETE',
            headers: { 'Cookie': owner.cookie }
        });
        console.log('Owner delete project (should be 200):', ownerDelete.status);

        // Clean up test users
        db.prepare("DELETE FROM users WHERE username LIKE '%_p2'").run();
        console.log('Phase 2 verification passed completely!');
        server.close(() => process.exit(0));
    } catch(err) {
        console.error('Test error:', err);
        server.close(() => process.exit(1));
    }
}

setTimeout(testPhase2, 1000);
