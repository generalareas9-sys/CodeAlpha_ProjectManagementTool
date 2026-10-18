// Taskora Projects & Team Members Manager

class ProjectsManager {
    constructor() {
        this.projects = [];
        this.currentProject = null;
    }

    async loadProjects() {
        try {
            const data = await window.api.get('/projects');
            if (data.success) {
                this.projects = data.projects || [];
                this.renderSidebarProjects();
                return this.projects;
            }
        } catch (err) {
            console.error('Error loading projects:', err);
            return [];
        }
    }

    renderSidebarProjects() {
        const list = document.getElementById('sidebar-projects-list');
        if (!list) return;

        if (this.projects.length === 0) {
            list.innerHTML = `
                <li style="padding: 8px 12px; font-size: 0.8125rem; color: var(--text-subtle);">
                    No projects yet.
                </li>
            `;
            return;
        }

        list.innerHTML = this.projects.map(p => `
            <li class="sidebar-nav-item ${this.currentProject && this.currentProject.id === p.id ? 'active' : ''}" 
                data-project-id="${p.id}"
                onclick="window.projects.selectProject(${p.id})">
                <span class="project-color-dot" style="background-color: ${p.color || 'var(--brand-primary)'};"></span>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                    ${this.escapeHtml(p.name)}
                </span>
                <span class="badge-count" title="${p.task_count || 0} active tasks">${p.task_count || 0}</span>
            </li>
        `).join('');
    }

    selectProject(projectId) {
        const project = this.projects.find(p => p.id === projectId);
        if (project) {
            this.currentProject = project;
            this.renderSidebarProjects();
            // In Phase 3, this will navigate directly to the project's Kanban board!
            window.app.navigate('board', { projectId });
        }
    }

    async renderProjectsView(container) {
        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; flex-wrap: wrap; gap: 16px;">
                <div>
                    <h1 style="font-size: 1.875rem; margin-bottom: 6px;">Team Projects</h1>
                    <p style="color: var(--text-muted); font-size: 0.875rem;">
                        Manage your active workspace projects, team members, and role permissions.
                    </p>
                </div>
                <button class="btn btn-primary" onclick="window.projects.openCreateModal()">
                    ${window.icon('plus', 18)} New Project
                </button>
            </div>

            <!-- Projects Grid Container -->
            <div id="projects-grid" class="projects-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px;">
                <!-- Skeleton loader -->
                <div class="skeleton skeleton-card"></div>
                <div class="skeleton skeleton-card"></div>
                <div class="skeleton skeleton-card"></div>
            </div>
        `;

        await this.loadProjects();

        const grid = document.getElementById('projects-grid');
        if (!grid) return;

        if (this.projects.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <div class="empty-state-svg">${window.icon('folder', 64)}</div>
                    <h2 class="empty-state-title">No projects yet</h2>
                    <p class="empty-state-desc">Create your first group project to start organizing tasks, inviting team members, and collaborating on boards.</p>
                    <button class="btn btn-primary" onclick="window.projects.openCreateModal()">
                        ${window.icon('plus', 18)} Create Your First Project
                    </button>
                </div>
            `;
            return;
        }

        grid.innerHTML = this.projects.map(p => this.createProjectCardHtml(p)).join('');
    }

    createProjectCardHtml(p) {
        const total = p.task_count || 0;
        const completed = p.completed_task_count || 0;
        const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
        const memberCount = p.member_count || 1;
        const memberText = memberCount === 1 ? '1 member' : `${memberCount} members`;
        const taskText = total === 1 ? '1 task' : `${total} tasks`;

        const roleBadgeClass = {
            'Owner': 'badge-urgent',
            'Admin': 'badge-high',
            'Member': 'badge-medium',
            'Viewer': 'badge-low'
        }[p.role] || 'badge-low';

        // Member avatars stack
        const avatarsHtml = (p.members || []).map(m => `
            <div class="avatar avatar-sm" style="background-color: ${m.avatar_color || 'var(--brand-primary)'}" title="${this.escapeHtml(m.display_name)} (${m.role})">
                ${(m.display_name || m.username || 'U')[0].toUpperCase()}
            </div>
        `).join('');

        return `
            <div class="project-card" style="background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-xl); padding: 22px; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; justify-content: space-between; transition: all var(--transition-base); position: relative;">
                <div>
                    <!-- Card Top Header -->
                    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 42px; height: 42px; border-radius: var(--radius-md); background: ${p.color || '#6366F1'}; color: #FFFFFF; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px ${p.color}40">
                                ${window.icon(p.icon || 'folder', 22)}
                            </div>
                            <div>
                                <h3 style="font-size: 1.125rem; font-weight: 700; color: var(--text); cursor: pointer;" onclick="window.projects.selectProject(${p.id})">
                                    ${this.escapeHtml(p.name)}
                                </h3>
                                <div style="display: flex; align-items: center; gap: 8px; margin-top: 2px;">
                                    <span class="badge ${roleBadgeClass}">${p.role}</span>
                                    <span style="font-size: 0.75rem; color: var(--text-muted);">${memberText}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Card Dropdown Actions -->
                        <div style="position: relative;">
                            <button class="btn btn-icon btn-sm" onclick="event.stopPropagation(); window.projects.toggleCardMenu(${p.id})" aria-label="Project actions">
                                ${window.icon('more-vertical', 18)}
                            </button>
                            <div class="dropdown-menu card-action-menu" id="project-menu-${p.id}" style="right: 0; min-width: 180px;">
                                <div class="dropdown-item" onclick="window.projects.selectProject(${p.id})">
                                    ${window.icon('kanban', 16)} Open Board
                                </div>
                                <div class="dropdown-item" onclick="window.projects.openSettingsModal(${p.id})">
                                    ${window.icon('users', 16)} Team & Settings
                                </div>
                                <div class="dropdown-divider"></div>
                                ${p.role === 'Owner' ? `
                                    <div class="dropdown-item text-danger" onclick="window.projects.confirmDeleteProject(${p.id}, '${this.escapeHtml(p.name)}')">
                                        ${window.icon('trash-2', 16)} Delete Project
                                    </div>
                                ` : `
                                    <div class="dropdown-item text-danger" onclick="window.projects.confirmLeaveProject(${p.id}, '${this.escapeHtml(p.name)}')">
                                        ${window.icon('log-out', 16)} Leave Project
                                    </div>
                                `}
                            </div>
                        </div>
                    </div>

                    <!-- Description -->
                    <p style="color: var(--text-muted); font-size: 0.875rem; margin-bottom: 20px; line-height: 1.5; min-height: 42px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                        ${this.escapeHtml(p.description || 'No description provided.')}
                    </p>
                </div>

                <div>
                    <!-- Progress Bar -->
                    <div style="margin-bottom: 16px;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: 600; margin-bottom: 6px;">
                            <span style="color: var(--text-muted);">${completed} of ${taskText} completed</span>
                            <span style="color: var(--text);">${progressPct}%</span>
                        </div>
                        <div style="height: 6px; width: 100%; background: var(--surface-2); border-radius: var(--radius-full); overflow: hidden;">
                            <div style="height: 100%; width: ${progressPct}%; background: ${p.color || 'var(--brand-primary)'}; border-radius: var(--radius-full); transition: width 0.3s ease;"></div>
                        </div>
                    </div>

                    <!-- Card Footer: Avatars + Action Button -->
                    <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border); padding-top: 14px;">
                        <div class="avatar-stack">
                            ${avatarsHtml}
                            ${memberCount > (p.members || []).length ? `
                                <div class="avatar avatar-sm" style="background: var(--surface-hover); color: var(--text-muted); font-size: 0.6875rem;">
                                    +${memberCount - (p.members || []).length}
                                </div>
                            ` : ''}
                        </div>
                        <button class="btn btn-secondary btn-sm" onclick="window.projects.selectProject(${p.id})">
                            View Board ${window.icon('chevron-right', 14)}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    toggleCardMenu(projectId) {
        document.querySelectorAll('.card-action-menu').forEach(el => {
            if (el.id !== `project-menu-${projectId}`) el.classList.remove('open');
        });
        const menu = document.getElementById(`project-menu-${projectId}`);
        if (menu) menu.classList.toggle('open');
    }

    openCreateModal() {
        const modalHtml = `
            <div class="modal-card">
                <div class="modal-header">
                    <h3 class="modal-title">Create New Project</h3>
                    <button class="btn btn-icon btn-sm" onclick="window.app.closeAllModals()">
                        ${window.icon('x', 18)}
                    </button>
                </div>
                <form id="create-project-form">
                    <div class="modal-body">
                        <div class="form-group">
                            <label class="form-label" for="proj-name">Project Name *</label>
                            <input type="text" id="proj-name" class="form-control" placeholder="e.g. Mobile App Redesign" required maxlength="100">
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="proj-desc">Description</label>
                            <textarea id="proj-desc" class="form-control" rows="3" placeholder="Brief overview of project goals, deliverables, and timeline..."></textarea>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Theme Color</label>
                            <div style="display: flex; gap: 10px; flex-wrap: wrap;" id="proj-color-picker">
                                ${['#6366F1', '#8B5CF6', '#EC4899', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'].map((color, i) => `
                                    <label style="cursor: pointer;">
                                        <input type="radio" name="proj_color" value="${color}" ${i === 0 ? 'checked' : ''} style="display: none;">
                                        <span class="color-swatch" style="display: block; width: 32px; height: 32px; border-radius: 50%; background-color: ${color}; border: 3px solid transparent; transition: all 0.15s;"></span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>

                        <div class="form-group">
                            <label class="form-label">Icon</label>
                            <div style="display: flex; gap: 10px;" id="proj-icon-picker">
                                ${['folder', 'kanban', 'sparkles', 'activity', 'check-square', 'calendar'].map((ico, i) => `
                                    <label style="cursor: pointer;">
                                        <input type="radio" name="proj_icon" value="${ico}" ${i === 0 ? 'checked' : ''} style="display: none;">
                                        <span class="icon-swatch" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--surface-2); color: var(--text);">
                                            ${window.icon(ico, 18)}
                                        </span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="window.app.closeAllModals()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Create Project</button>
                    </div>
                </form>
            </div>
        `;

        this.showModal(modalHtml);
        this.setupColorAndIconPickers();

        const form = document.getElementById('create-project-form');
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                const name = document.getElementById('proj-name').value.trim();
                const description = document.getElementById('proj-desc').value.trim();
                const color = document.querySelector('input[name="proj_color"]:checked')?.value || '#6366F1';
                const icon = document.querySelector('input[name="proj_icon"]:checked')?.value || 'folder';

                try {
                    const res = await window.api.post('/projects', { name, description, color, icon });
                    if (res.success) {
                        window.app.closeAllModals();
                        window.app.showToast('success', 'Project Created', `"${res.project.name}" is ready.`);
                        await this.loadProjects();
                        if (window.app.currentView === 'projects') {
                            this.renderProjectsView(document.getElementById('view-container'));
                        }
                    }
                } catch (err) {
                    window.app.showToast('error', 'Error', err.message);
                }
            };
        }
    }

    setupColorAndIconPickers() {
        const updateSwatches = () => {
            document.querySelectorAll('#proj-color-picker label').forEach(label => {
                const radio = label.querySelector('input[type="radio"]');
                const swatch = label.querySelector('.color-swatch');
                if (radio && swatch) {
                    if (radio.checked) {
                        swatch.style.transform = 'scale(1.15)';
                        swatch.style.borderColor = 'var(--text)';
                        swatch.style.boxShadow = 'var(--shadow-md)';
                    } else {
                        swatch.style.transform = 'scale(1)';
                        swatch.style.borderColor = 'transparent';
                        swatch.style.boxShadow = 'none';
                    }
                }
            });

            document.querySelectorAll('#proj-icon-picker label').forEach(label => {
                const radio = label.querySelector('input[type="radio"]');
                const swatch = label.querySelector('.icon-swatch');
                if (radio && swatch) {
                    if (radio.checked) {
                        swatch.style.borderColor = 'var(--brand-primary)';
                        swatch.style.backgroundColor = 'var(--brand-primary-light)';
                        swatch.style.color = 'var(--brand-primary)';
                    } else {
                        swatch.style.borderColor = 'var(--border)';
                        swatch.style.backgroundColor = 'var(--surface-2)';
                        swatch.style.color = 'var(--text)';
                    }
                }
            });
        };

        updateSwatches();
        document.querySelectorAll('#proj-color-picker input, #proj-icon-picker input').forEach(input => {
            input.addEventListener('change', updateSwatches);
        });
    }

    async openSettingsModal(projectId) {
        try {
            const data = await window.api.get(`/projects/${projectId}`);
            if (!data.success || !data.project) return;

            const p = data.project;
            const userRole = p.user_role;
            const canManage = (userRole === 'Owner' || userRole === 'Admin');

            const modalHtml = `
                <div class="modal-card" style="max-width: 620px;">
                    <div class="modal-header">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 32px; height: 32px; border-radius: var(--radius-sm); background: ${p.color}; color: #fff; display: flex; align-items: center; justify-content: center;">
                                ${window.icon(p.icon || 'folder', 18)}
                            </div>
                            <h3 class="modal-title">${this.escapeHtml(p.name)} Settings</h3>
                        </div>
                        <button class="btn btn-icon btn-sm" onclick="window.app.closeAllModals()">${window.icon('x', 18)}</button>
                    </div>

                    <!-- Modal Tab Navigation -->
                    <div style="display: flex; border-bottom: 1px solid var(--border); padding: 0 24px; background: var(--surface);">
                        <button class="auth-tab-btn active" id="tab-members-btn" onclick="window.projects.switchSettingsTab('members')">
                            ${window.icon('users', 16)} Team Members (${(p.members || []).length})
                        </button>
                        ${canManage ? `
                            <button class="auth-tab-btn" id="tab-general-btn" onclick="window.projects.switchSettingsTab('general')">
                                ${window.icon('settings', 16)} General Settings
                            </button>
                        ` : ''}
                    </div>

                    <div class="modal-body">
                        <!-- Members Tab Pane -->
                        <div id="settings-pane-members">
                            ${canManage ? `
                                <!-- Invite Member Box -->
                                <div style="background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 24px;">
                                    <div style="font-weight: 700; font-size: 0.875rem; margin-bottom: 8px;">Invite Team Member</div>
                                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                        <div style="flex: 1; min-width: 200px; position: relative;">
                                            <input type="text" id="invite-user-input" class="form-control" placeholder="Search by username or email..." autocomplete="off">
                                            <div id="invite-autocomplete-dropdown" class="dropdown-menu" style="left:0; right:0; top:calc(100% + 4px); max-height: 200px; overflow-y: auto;"></div>
                                        </div>
                                        <select id="invite-role-select" class="form-control" style="width: 120px;">
                                            <option value="Member" selected>Member</option>
                                            <option value="Admin">Admin</option>
                                            <option value="Viewer">Viewer</option>
                                        </select>
                                        <button class="btn btn-primary" onclick="window.projects.inviteMember(${p.id})">
                                            ${window.icon('user-plus', 16)} Add
                                        </button>
                                    </div>
                                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 6px;">
                                        Viewer = read only • Member = create & edit tasks • Admin = manage team & columns
                                    </div>
                                </div>
                            ` : ''}

                            <!-- Members List -->
                            <div style="font-weight: 700; font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-subtle); margin-bottom: 12px;">
                                Current Members
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 8px;" id="project-members-list">
                                ${(p.members || []).map(m => `
                                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md);">
                                        <div style="display: flex; align-items: center; gap: 12px;">
                                            <div class="avatar" style="background-color: ${m.avatar_color || 'var(--brand-primary)'}">
                                                ${(m.display_name || m.username || 'U')[0].toUpperCase()}
                                            </div>
                                            <div>
                                                <div style="font-weight: 600; font-size: 0.875rem; color: var(--text);">
                                                    ${this.escapeHtml(m.display_name)}
                                                    ${m.user_id === window.auth.currentUser.id ? '<span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">(You)</span>' : ''}
                                                </div>
                                                <div style="font-size: 0.75rem; color: var(--text-muted);">
                                                    @${this.escapeHtml(m.username)} • ${this.escapeHtml(m.email)}
                                                </div>
                                            </div>
                                        </div>

                                        <div style="display: flex; align-items: center; gap: 8px;">
                                            ${canManage && m.role !== 'Owner' && m.user_id !== window.auth.currentUser.id ? `
                                                <select class="form-control" style="padding: 4px 8px; font-size: 0.75rem; width: 95px;" onchange="window.projects.updateMemberRole(${p.id}, ${m.user_id}, this.value)">
                                                    <option value="Admin" ${m.role === 'Admin' ? 'selected' : ''}>Admin</option>
                                                    <option value="Member" ${m.role === 'Member' ? 'selected' : ''}>Member</option>
                                                    <option value="Viewer" ${m.role === 'Viewer' ? 'selected' : ''}>Viewer</option>
                                                </select>
                                                <button class="btn btn-icon btn-sm text-danger" onclick="window.projects.removeMember(${p.id}, ${m.user_id}, '${this.escapeHtml(m.display_name)}')" title="Remove member">
                                                    ${window.icon('trash-2', 16)}
                                                </button>
                                            ` : `
                                                <span class="badge ${m.role === 'Owner' ? 'badge-urgent' : m.role === 'Admin' ? 'badge-high' : 'badge-medium'}">
                                                    ${m.role}
                                                </span>
                                            `}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>

                        ${canManage ? `
                            <!-- General Settings Tab Pane -->
                            <div id="settings-pane-general" style="display: none;">
                                <form id="edit-project-settings-form">
                                    <div class="form-group">
                                        <label class="form-label" for="edit-proj-name">Project Name</label>
                                        <input type="text" id="edit-proj-name" class="form-control" value="${this.escapeHtml(p.name)}" required>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="edit-proj-desc">Description</label>
                                        <textarea id="edit-proj-desc" class="form-control" rows="3">${this.escapeHtml(p.description || '')}</textarea>
                                    </div>
                                    <button type="button" class="btn btn-primary" onclick="window.projects.saveProjectSettings(${p.id})">
                                        Save Changes
                                    </button>
                                </form>

                                <!-- Danger Zone -->
                                <div style="margin-top: 36px; padding-top: 24px; border-top: 1px solid var(--border);">
                                    <h4 style="color: var(--danger); font-size: 0.9375rem; margin-bottom: 6px;">Danger Zone</h4>
                                    <p style="color: var(--text-muted); font-size: 0.8125rem; margin-bottom: 12px;">
                                        ${userRole === 'Owner' ? 'Permanently delete this project, all columns, tasks, and activity records.' : 'Leave this project. You will lose access until invited again.'}
                                    </p>
                                    ${userRole === 'Owner' ? `
                                        <button class="btn btn-danger btn-sm" onclick="window.projects.confirmDeleteProject(${p.id}, '${this.escapeHtml(p.name)}')">
                                            ${window.icon('trash-2', 16)} Delete Project Permanently
                                        </button>
                                    ` : `
                                        <button class="btn btn-danger btn-sm" onclick="window.projects.confirmLeaveProject(${p.id}, '${this.escapeHtml(p.name)}')">
                                            ${window.icon('log-out', 16)} Leave Project
                                        </button>
                                    `}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;

            this.showModal(modalHtml);
            this.setupUserAutocomplete(projectId);
        } catch (err) {
            window.app.showToast('error', 'Failed to load settings', err.message);
        }
    }

    switchSettingsTab(tab) {
        const paneMembers = document.getElementById('settings-pane-members');
        const paneGeneral = document.getElementById('settings-pane-general');
        const btnMembers = document.getElementById('tab-members-btn');
        const btnGeneral = document.getElementById('tab-general-btn');

        if (tab === 'members') {
            if (paneMembers) paneMembers.style.display = 'block';
            if (paneGeneral) paneGeneral.style.display = 'none';
            if (btnMembers) btnMembers.classList.add('active');
            if (btnGeneral) btnGeneral.classList.remove('active');
        } else {
            if (paneMembers) paneMembers.style.display = 'none';
            if (paneGeneral) paneGeneral.style.display = 'block';
            if (btnMembers) btnMembers.classList.remove('active');
            if (btnGeneral) btnGeneral.classList.add('active');
        }
    }

    setupUserAutocomplete(projectId) {
        const input = document.getElementById('invite-user-input');
        const dropdown = document.getElementById('invite-autocomplete-dropdown');
        if (!input || !dropdown) return;

        let debounceTimer;
        input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            const query = input.value.trim();
            if (query.length < 2) {
                dropdown.classList.remove('open');
                dropdown.innerHTML = '';
                return;
            }

            debounceTimer = setTimeout(async () => {
                try {
                    const data = await window.api.get(`/users?search=${encodeURIComponent(query)}`);
                    if (data.success && data.users && data.users.length > 0) {
                        dropdown.innerHTML = data.users.map(u => `
                            <div class="dropdown-item" onclick="window.projects.selectAutocompleteUser('${u.username}')" style="display:flex; align-items:center; gap:10px;">
                                <div class="avatar avatar-sm" style="background:${u.avatar_color || '#6366F1'}">
                                    ${(u.display_name || u.username)[0].toUpperCase()}
                                </div>
                                <div style="overflow:hidden;">
                                    <div style="font-weight:600; font-size:0.8125rem;">${this.escapeHtml(u.display_name)}</div>
                                    <div style="font-size:0.75rem; color:var(--text-muted);">@${this.escapeHtml(u.username)}</div>
                                </div>
                            </div>
                        `).join('');
                        dropdown.classList.add('open');
                    } else {
                        dropdown.innerHTML = `<div style="padding:10px; font-size:0.75rem; color:var(--text-muted);">No users found</div>`;
                        dropdown.classList.add('open');
                    }
                } catch (e) {
                    dropdown.classList.remove('open');
                }
            }, 250);
        });
    }

    selectAutocompleteUser(username) {
        const input = document.getElementById('invite-user-input');
        const dropdown = document.getElementById('invite-autocomplete-dropdown');
        if (input) input.value = username;
        if (dropdown) dropdown.classList.remove('open');
    }

    async inviteMember(projectId) {
        const input = document.getElementById('invite-user-input');
        const roleSelect = document.getElementById('invite-role-select');
        if (!input || !input.value.trim()) {
            window.app.showToast('warning', 'Input Required', 'Please enter a username or email to invite.');
            return;
        }

        try {
            const res = await window.api.post(`/projects/${projectId}/members`, {
                identifier: input.value.trim(),
                role: roleSelect ? roleSelect.value : 'Member'
            });

            if (res.success) {
                window.app.showToast('success', 'Member Added', res.message);
                this.openSettingsModal(projectId); // Refresh modal view
                await this.loadProjects();
            }
        } catch (err) {
            window.app.showToast('error', 'Invitation Failed', err.message);
        }
    }

    async updateMemberRole(projectId, userId, newRole) {
        try {
            const res = await window.api.put(`/projects/${projectId}/members/${userId}`, { role: newRole });
            if (res.success) {
                window.app.showToast('success', 'Role Updated', `Member role changed to ${newRole}`);
                await this.loadProjects();
            }
        } catch (err) {
            window.app.showToast('error', 'Failed to update role', err.message);
            this.openSettingsModal(projectId); // reload on error
        }
    }

    async removeMember(projectId, userId, displayName) {
        if (!confirm(`Are you sure you want to remove ${displayName} from this project?`)) return;

        try {
            const res = await window.api.delete(`/projects/${projectId}/members/${userId}`);
            if (res.success) {
                window.app.showToast('info', 'Member Removed', `${displayName} was removed from the project.`);
                this.openSettingsModal(projectId);
                await this.loadProjects();
            }
        } catch (err) {
            window.app.showToast('error', 'Action Failed', err.message);
        }
    }

    async saveProjectSettings(projectId) {
        const name = document.getElementById('edit-proj-name')?.value.trim();
        const description = document.getElementById('edit-proj-desc')?.value.trim();

        if (!name) {
            window.app.showToast('error', 'Name Required', 'Project name cannot be empty.');
            return;
        }

        try {
            const res = await window.api.put(`/projects/${projectId}`, { name, description });
            if (res.success) {
                window.app.showToast('success', 'Project Updated', 'Changes saved successfully.');
                window.app.closeAllModals();
                await this.loadProjects();
                if (window.app.currentView === 'projects') {
                    this.renderProjectsView(document.getElementById('view-container'));
                }
            }
        } catch (err) {
            window.app.showToast('error', 'Update Failed', err.message);
        }
    }

    async confirmDeleteProject(projectId, projectName) {
        const confirmation = prompt(`Are you sure you want to delete "${projectName}"?\nThis action CANNOT be undone. Type "DELETE" to confirm:`);
        if (confirmation !== 'DELETE') {
            if (confirmation !== null) window.app.showToast('info', 'Cancelled', 'Project deletion was cancelled.');
            return;
        }

        try {
            const res = await window.api.delete(`/projects/${projectId}`);
            if (res.success) {
                window.app.closeAllModals();
                window.app.showToast('info', 'Project Deleted', `"${projectName}" has been removed.`);
                await this.loadProjects();
                window.app.navigate('projects');
            }
        } catch (err) {
            window.app.showToast('error', 'Deletion Failed', err.message);
        }
    }

    async confirmLeaveProject(projectId, projectName) {
        if (!confirm(`Are you sure you want to leave "${projectName}"? You will lose access until another team member invites you.`)) return;

        try {
            const userId = window.auth.currentUser.id;
            const res = await window.api.delete(`/projects/${projectId}/members/${userId}`);
            if (res.success) {
                window.app.closeAllModals();
                window.app.showToast('info', 'Left Project', `You have left "${projectName}".`);
                await this.loadProjects();
                window.app.navigate('projects');
            }
        } catch (err) {
            window.app.showToast('error', 'Failed to leave project', err.message);
        }
    }

    showModal(contentHtml) {
        let overlay = document.getElementById('project-modal-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'project-modal-overlay';
            overlay.className = 'modal-overlay';
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = contentHtml;
        overlay.classList.add('open');

        // Close on background click
        overlay.onclick = (e) => {
            if (e.target === overlay) window.app.closeAllModals();
        };
    }

    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

window.projects = new ProjectsManager();
