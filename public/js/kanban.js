// Taskora Kanban Board & Drag-and-Drop Manager

class KanbanManager {
    constructor() {
        this.projectId = null;
        this.project = null;
        this.columns = [];
        this.tasks = [];
        this.onlineUsers = [];
        this.filters = {
            search: '',
            priority: 'all',
            assignee: 'all',
            label: 'all'
        };
        this.draggedTaskId = null;
        this.draggedSourceColId = null;
        this.socket = null;
    }

    async initSocket(projectId) {
        if (!window.io) return;

        if (!this.socket) {
            this.socket = window.io();
        }

        // Join project room
        this.socket.emit('project:join', { projectId });

        // Listen for live presence updates
        this.socket.off('presence:update');
        this.socket.on('presence:update', ({ projectId: pId, users }) => {
            if (pId === this.projectId) {
                this.onlineUsers = users || [];
                this.renderPresence();
            }
        });

        // Listen for live task events
        this.socket.off('task:created');
        this.socket.on('task:created', (task) => {
            if (task.project_id === this.projectId && !this.tasks.some(t => t.id === task.id)) {
                this.tasks.push(task);
                this.renderColumnsAndCards();
            }
        });

        this.socket.off('task:moved');
        this.socket.on('task:moved', ({ taskId, targetColumnId, newPosition }) => {
            const task = this.tasks.find(t => t.id === taskId);
            if (task) {
                task.column_id = targetColumnId;
                task.position = newPosition;
                this.renderColumnsAndCards();
            }
        });

        this.socket.off('task:updated');
        this.socket.on('task:updated', (updated) => {
            const index = this.tasks.findIndex(t => t.id === updated.id);
            if (index !== -1) {
                this.tasks[index] = { ...this.tasks[index], ...updated };
                this.renderColumnsAndCards();
            }
        });

        this.socket.off('task:deleted');
        this.socket.on('task:deleted', ({ taskId }) => {
            this.tasks = this.tasks.filter(t => t.id !== taskId);
            this.renderColumnsAndCards();
        });

        // Listen for column changes
        this.socket.off('column:created');
        this.socket.on('column:created', (column) => {
            if (column.project_id === this.projectId && !this.columns.some(c => c.id === column.id)) {
                this.columns.push(column);
                this.columns.sort((a, b) => a.position - b.position);
                this.renderColumnsAndCards();
            }
        });

        this.socket.off('column:updated');
        this.socket.on('column:updated', (updated) => {
            const idx = this.columns.findIndex(c => c.id === updated.id);
            if (idx !== -1) {
                this.columns[idx] = { ...this.columns[idx], ...updated };
                this.renderColumnsAndCards();
            }
        });

        this.socket.off('column:deleted');
        this.socket.on('column:deleted', ({ columnId }) => {
            this.columns = this.columns.filter(c => c.id !== columnId);
            this.renderColumnsAndCards();
        });
    }

    async renderBoardView(container, projectId) {
        this.projectId = parseInt(projectId, 10);
        this.initSocket(this.projectId);

        container.innerHTML = `
            <div class="board-container">
                <!-- Board Header Skeleton -->
                <div class="board-header">
                    <div class="board-header-top">
                        <div class="board-title-section">
                            <div class="skeleton" style="width: 44px; height: 44px; border-radius: var(--radius-md);"></div>
                            <div>
                                <div class="skeleton" style="width: 240px; height: 28px; margin-bottom: 6px;"></div>
                                <div class="skeleton" style="width: 140px; height: 16px;"></div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Board Columns Skeleton -->
                <div class="kanban-board">
                    <div class="skeleton" style="width: 310px; height: 450px; border-radius: var(--radius-xl);"></div>
                    <div class="skeleton" style="width: 310px; height: 450px; border-radius: var(--radius-xl);"></div>
                    <div class="skeleton" style="width: 310px; height: 450px; border-radius: var(--radius-xl);"></div>
                </div>
            </div>
        `;

        await this.loadBoardData();
        this.renderFullBoard(container);
    }

    async loadBoardData() {
        try {
            const [projData, taskData] = await Promise.all([
                window.api.get(`/projects/${this.projectId}`),
                window.api.get(`/projects/${this.projectId}/tasks`)
            ]);

            if (projData.success) {
                this.project = projData.project;
                this.columns = (projData.project.columns || []).sort((a, b) => a.position - b.position);
            }
            if (taskData.success) {
                this.tasks = taskData.tasks || [];
            }
        } catch (err) {
            console.error('Failed to load board data:', err);
            window.app.showToast('error', 'Board Error', err.message);
        }
    }

    renderFullBoard(container) {
        if (!this.project) return;
        const p = this.project;
        const userRole = p.user_role;
        const canManageColumns = (userRole === 'Owner' || userRole === 'Admin');
        const canEditTasks = (userRole !== 'Viewer');

        container.innerHTML = `
            <div class="board-container">
                <!-- Board Header -->
                <div class="board-header">
                    <div class="board-header-top">
                        <div class="board-title-section">
                            <div class="board-project-icon" style="background-color: ${p.color || '#6366F1'};">
                                ${window.icon(p.icon || 'folder', 22)}
                            </div>
                            <div>
                                <h1 class="board-title">
                                    ${this.escapeHtml(p.name)}
                                    <span class="badge ${userRole === 'Owner' ? 'badge-urgent' : userRole === 'Admin' ? 'badge-high' : 'badge-low'}">
                                        ${userRole}
                                    </span>
                                </h1>
                                <p style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 2px;">
                                    ${this.escapeHtml(p.description || 'Sprint board')}
                                </p>
                            </div>
                        </div>

                        <!-- Header Right Controls -->
                        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <!-- Online Presence Avatars -->
                            <div class="board-presence-container" id="board-presence-container" title="Active collaborators on this board">
                                <!-- Populated dynamically by renderPresence() -->
                            </div>

                            <!-- View Mode Tabs -->
                            <div class="view-mode-tabs">
                                <button class="view-mode-btn active" onclick="window.kanban.switchView('board')">
                                    ${window.icon('kanban', 14)} Board
                                </button>
                                <button class="view-mode-btn" onclick="window.app.navigate('list', { projectId: ${p.id} })">
                                    ${window.icon('list', 14)} List
                                </button>
                                <button class="view-mode-btn" onclick="window.app.navigate('calendar', { projectId: ${p.id} })">
                                    ${window.icon('calendar', 14)} Calendar
                                </button>
                            </div>

                            ${canEditTasks ? `
                                <button class="btn btn-primary" onclick="window.kanban.openAddTaskModal()">
                                    ${window.icon('plus', 16)} Add Task
                                </button>
                            ` : ''}

                            <button class="btn btn-secondary btn-icon" onclick="window.projects.openSettingsModal(${p.id})" title="Project Settings & Members">
                                ${window.icon('settings', 18)}
                            </button>
                        </div>
                    </div>

                    <!-- Filter & Search Toolbar -->
                    <div class="board-toolbar">
                        <div class="board-filters-left">
                            <!-- Search -->
                            <div class="board-search-input-wrap">
                                <span class="board-search-icon">${window.icon('search', 16)}</span>
                                <input type="text" id="board-search-input" class="form-control" placeholder="Filter tasks by text..." value="${this.escapeHtml(this.filters.search)}">
                            </div>

                            <!-- Priority Filter -->
                            <select id="board-priority-filter" class="board-filter-select">
                                <option value="all">All Priorities</option>
                                <option value="Urgent">Urgent</option>
                                <option value="High">High</option>
                                <option value="Medium">Medium</option>
                                <option value="Low">Low</option>
                            </select>

                            <!-- Assignee Filter -->
                            <select id="board-assignee-filter" class="board-filter-select">
                                <option value="all">All Assignees</option>
                                <option value="me">Assigned to Me</option>
                                ${(p.members || []).map(m => `
                                    <option value="${m.user_id}">${this.escapeHtml(m.display_name)}</option>
                                `).join('')}
                            </select>

                            <!-- Reset Filters Button -->
                            <button class="btn btn-ghost btn-sm" onclick="window.kanban.resetFilters()" id="board-clear-filters-btn" style="display: none;">
                                ${window.icon('x', 14)} Clear
                            </button>
                        </div>

                        <div style="font-size: 0.8125rem; color: var(--text-muted);" id="board-task-counter">
                            <!-- Populated dynamically -->
                        </div>
                    </div>
                </div>

                <!-- Kanban Columns Track -->
                <div class="kanban-board" id="kanban-columns-track">
                    <!-- Columns rendered here -->
                </div>
            </div>
        `;

        this.renderPresence();
        this.renderColumnsAndCards();
        this.setupFilterListeners();
    }

    renderPresence() {
        const container = document.getElementById('board-presence-container');
        if (!container) return;

        if (this.onlineUsers.length === 0) {
            container.innerHTML = `
                <span class="online-pulse-dot" title="Real-time connected"></span>
                <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">Live sync</span>
            `;
            return;
        }

        const avatars = this.onlineUsers.slice(0, 4).map(u => `
            <div class="avatar avatar-sm" style="background:${u.avatar_color || '#6366F1'};" title="${this.escapeHtml(u.display_name)} is online">
                ${(u.display_name || u.username)[0].toUpperCase()}
            </div>
        `).join('');

        container.innerHTML = `
            <span class="online-pulse-dot" title="Real-time active"></span>
            <div class="avatar-stack">
                ${avatars}
                ${this.onlineUsers.length > 4 ? `
                    <div class="avatar avatar-sm" style="background:var(--surface-2); color:var(--text-muted); font-size:0.625rem;">
                        +${this.onlineUsers.length - 4}
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderColumnsAndCards() {
        const track = document.getElementById('kanban-columns-track');
        if (!track) return;

        const filteredTasks = this.getFilteredTasks();

        // Update task counter
        const counterEl = document.getElementById('board-task-counter');
        if (counterEl) {
            const count = filteredTasks.length;
            counterEl.textContent = count === 1 ? '1 task shown' : `${count} tasks shown`;
        }

        const canManageColumns = (this.project?.user_role === 'Owner' || this.project?.user_role === 'Admin');
        const canEditTasks = (this.project?.user_role !== 'Viewer');

        const columnsHtml = this.columns.map((col, colIdx) => {
            const colTasks = filteredTasks.filter(t => t.column_id === col.id);

            const taskCardsHtml = colTasks.map(t => this.createTaskCardHtml(t, colIdx)).join('');

            return `
                <div class="kanban-column" data-column-id="${col.id}" ondragover="window.kanban.handleDragOver(event)" ondragleave="window.kanban.handleDragLeave(event)" ondrop="window.kanban.handleDrop(event, ${col.id})">
                    <!-- Column Header -->
                    <div class="column-header">
                        <div class="column-header-left">
                            <span class="column-title">${this.escapeHtml(col.name)}</span>
                            <span class="column-count-badge">${colTasks.length}</span>
                        </div>
                        ${canManageColumns ? `
                            <div style="position: relative;">
                                <button class="btn btn-icon btn-sm" onclick="window.kanban.toggleColumnMenu(event, ${col.id})" aria-label="Column actions">
                                    ${window.icon('more-horizontal', 16)}
                                </button>
                                <div class="dropdown-menu" id="col-menu-${col.id}" style="right: 0; min-width: 140px;">
                                    <div class="dropdown-item" onclick="window.kanban.promptRenameColumn(${col.id}, '${this.escapeHtml(col.name)}')">
                                        ${window.icon('edit-2', 14)} Rename
                                    </div>
                                    <div class="dropdown-item text-danger" onclick="window.kanban.promptDeleteColumn(${col.id}, '${this.escapeHtml(col.name)}')">
                                        ${window.icon('trash-2', 14)} Delete
                                    </div>
                                </div>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Column Tasks Container -->
                    <div class="column-tasks-container" id="col-tasks-${col.id}">
                        ${taskCardsHtml}
                    </div>

                    <!-- Column Footer Add Button -->
                    ${canEditTasks ? `
                        <button class="column-add-task-btn" onclick="window.kanban.openAddTaskModal(${col.id})">
                            ${window.icon('plus', 16)} Add a task
                        </button>
                    ` : ''}
                </div>
            `;
        }).join('');

        // "+ Add Column" card at the end
        const addColumnCardHtml = canManageColumns ? `
            <div class="kanban-add-column-card" onclick="window.kanban.promptAddColumn()">
                <div style="margin-bottom: 8px;">${window.icon('plus', 24)}</div>
                <div style="font-weight: 700; font-size: 0.9375rem;">Add Column</div>
                <div style="font-size: 0.75rem;">Expand your workflow</div>
            </div>
        ` : '';

        track.innerHTML = columnsHtml + addColumnCardHtml;
    }

    createTaskCardHtml(task, colIdx) {
        const canDrag = (this.project?.user_role !== 'Viewer');
        const isOverdue = task.due_date && (new Date(task.due_date) < new Date().setHours(0,0,0,0)) && task.column_name?.toLowerCase() !== 'done';
        const isToday = task.due_date && (new Date(task.due_date).toDateString() === new Date().toDateString());

        const priorityBadgeClass = {
            'Urgent': 'badge-urgent',
            'High': 'badge-high',
            'Medium': 'badge-medium',
            'Low': 'badge-low'
        }[task.priority] || 'badge-low';

        // Labels
        const labelsHtml = (task.labels || []).map(l => `
            <span class="task-label-chip" style="background-color: ${l.color || '#6366F1'};">
                ${this.escapeHtml(l.name)}
            </span>
        `).join('');

        // Assignee avatars
        const assigneesHtml = (task.assignees || []).map(a => `
            <div class="avatar avatar-sm" style="background-color: ${a.avatar_color || '#6366F1'};" title="${this.escapeHtml(a.display_name)}">
                ${(a.display_name || a.username || 'U')[0].toUpperCase()}
            </div>
        `).join('');

        const canMoveLeft = colIdx > 0;
        const canMoveRight = colIdx < this.columns.length - 1;

        return `
            <div class="task-card" 
                 id="task-card-${task.id}"
                 data-task-id="${task.id}"
                 draggable="${canDrag ? 'true' : 'false'}"
                 ondragstart="window.kanban.handleDragStart(event, ${task.id}, ${task.column_id})"
                 ondragend="window.kanban.handleDragEnd(event)"
                 onclick="window.kanban.onCardClick(event, ${task.id})">
                
                <!-- Card Labels & Priority -->
                <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
                    <div class="task-card-labels">
                        ${labelsHtml}
                    </div>
                    <span class="badge ${priorityBadgeClass}">${task.priority}</span>
                </div>

                <!-- Title -->
                <div class="task-card-title">${this.escapeHtml(task.title)}</div>

                <!-- Meta Badges (Due date, subtasks, comments) -->
                <div class="task-card-meta">
                    ${task.due_date ? `
                        <span class="task-due-badge ${isOverdue ? 'overdue' : isToday ? 'due-today' : ''}" title="${isOverdue ? 'Overdue!' : 'Due date'}">
                            ${window.icon('clock', 12)}
                            ${this.formatDueDate(task.due_date)}
                        </span>
                    ` : ''}

                    ${task.checklist_total > 0 ? `
                        <span class="task-meta-item" title="${task.checklist_completed} of ${task.checklist_total} subtasks completed">
                            ${window.icon('check-square', 13)}
                            ${task.checklist_completed}/${task.checklist_total}
                        </span>
                    ` : ''}

                    ${task.comment_count > 0 ? `
                        <span class="task-meta-item" title="${task.comment_count} comments">
                            ${window.icon('message-square', 13)}
                            ${task.comment_count}
                        </span>
                    ` : ''}
                </div>

                <!-- Card Footer (Avatars + Mobile Move Buttons) -->
                <div class="task-card-footer">
                    <div class="avatar-stack">
                        ${assigneesHtml}
                    </div>

                    ${canDrag ? `
                        <div class="task-mobile-move-buttons" onclick="event.stopPropagation()">
                            ${canMoveLeft ? `
                                <button class="task-move-btn" onclick="window.kanban.moveTaskStep(${task.id}, -1)" title="Move left">
                                    ${window.icon('chevron-left', 14)}
                                </button>
                            ` : ''}
                            ${canMoveRight ? `
                                <button class="task-move-btn" onclick="window.kanban.moveTaskStep(${task.id}, 1)" title="Move right">
                                    ${window.icon('chevron-right', 14)}
                                </button>
                            ` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    getFilteredTasks() {
        let list = [...this.tasks];

        if (this.filters.search.trim()) {
            const query = this.filters.search.toLowerCase().trim();
            list = list.filter(t => 
                (t.title && t.title.toLowerCase().includes(query)) ||
                (t.description && t.description.toLowerCase().includes(query))
            );
        }

        if (this.filters.priority !== 'all') {
            list = list.filter(t => t.priority === this.filters.priority);
        }

        if (this.filters.assignee !== 'all') {
            if (this.filters.assignee === 'me') {
                const myId = window.auth.currentUser?.id;
                list = list.filter(t => (t.assignees || []).some(a => a.id === myId));
            } else {
                const targetId = parseInt(this.filters.assignee, 10);
                list = list.filter(t => (t.assignees || []).some(a => a.id === targetId));
            }
        }

        return list;
    }

    setupFilterListeners() {
        const searchInput = document.getElementById('board-search-input');
        const prioSelect = document.getElementById('board-priority-filter');
        const assigneeSelect = document.getElementById('board-assignee-filter');
        const clearBtn = document.getElementById('board-clear-filters-btn');

        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.filters.search = searchInput.value;
                this.toggleClearFiltersBtn();
                this.renderColumnsAndCards();
            });
        }

        if (prioSelect) {
            prioSelect.addEventListener('change', () => {
                this.filters.priority = prioSelect.value;
                this.toggleClearFiltersBtn();
                this.renderColumnsAndCards();
            });
        }

        if (assigneeSelect) {
            assigneeSelect.addEventListener('change', () => {
                this.filters.assignee = assigneeSelect.value;
                this.toggleClearFiltersBtn();
                this.renderColumnsAndCards();
            });
        }
    }

    toggleClearFiltersBtn() {
        const btn = document.getElementById('board-clear-filters-btn');
        if (!btn) return;
        const hasFilters = (this.filters.search || this.filters.priority !== 'all' || this.filters.assignee !== 'all');
        btn.style.display = hasFilters ? 'inline-flex' : 'none';
    }

    resetFilters() {
        this.filters = { search: '', priority: 'all', assignee: 'all', label: 'all' };
        const s = document.getElementById('board-search-input');
        const p = document.getElementById('board-priority-filter');
        const a = document.getElementById('board-assignee-filter');
        if (s) s.value = '';
        if (p) p.value = 'all';
        if (a) a.value = 'all';
        this.toggleClearFiltersBtn();
        this.renderColumnsAndCards();
    }

    // HTML5 Drag and Drop handlers
    handleDragStart(e, taskId, sourceColId) {
        this.draggedTaskId = taskId;
        this.draggedSourceColId = sourceColId;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(taskId));
        
        setTimeout(() => {
            const el = document.getElementById(`task-card-${taskId}`);
            if (el) el.classList.add('dragging');
        }, 0);
    }

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const col = e.currentTarget;
        if (!col.classList.contains('drag-over')) {
            col.classList.add('drag-over');
        }
    }

    handleDragLeave(e) {
        const col = e.currentTarget;
        // Check if leaving the column element itself
        if (!col.contains(e.relatedTarget)) {
            col.classList.remove('drag-over');
        }
    }

    async handleDrop(e, targetColId) {
        e.preventDefault();
        const col = e.currentTarget;
        col.classList.remove('drag-over');

        const taskId = this.draggedTaskId;
        if (!taskId) return;

        // Calculate insertion position based on cursor relative to cards in column
        const tasksContainer = col.querySelector('.column-tasks-container');
        const taskCards = Array.from(tasksContainer.querySelectorAll('.task-card:not(.dragging)'));
        
        let newPos = taskCards.length;
        for (let i = 0; i < taskCards.length; i++) {
            const rect = taskCards[i].getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            if (e.clientY < midpoint) {
                newPos = i;
                break;
            }
        }

        // Optimistic UI update
        const task = this.tasks.find(t => t.id === taskId);
        if (task) {
            task.column_id = targetColId;
            task.position = newPos;
            this.renderColumnsAndCards();
        }

        // Call backend API
        try {
            await window.api.put(`/tasks/${taskId}/move`, {
                target_column_id: targetColId,
                target_position: newPos
            });
        } catch (err) {
            console.error('Failed to move task:', err);
            window.app.showToast('error', 'Move Failed', err.message);
            await this.loadBoardData();
            this.renderColumnsAndCards();
        } finally {
            this.draggedTaskId = null;
            this.draggedSourceColId = null;
        }
    }

    handleDragEnd(e) {
        document.querySelectorAll('.task-card.dragging').forEach(el => el.classList.remove('dragging'));
        document.querySelectorAll('.kanban-column.drag-over').forEach(el => el.classList.remove('drag-over'));
        this.draggedTaskId = null;
        this.draggedSourceColId = null;
    }

    // Mobile move step (shift 1 column left or right)
    async moveTaskStep(taskId, direction) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        const currentIdx = this.columns.findIndex(c => c.id === task.column_id);
        const nextIdx = currentIdx + direction;

        if (nextIdx < 0 || nextIdx >= this.columns.length) return;

        const targetColumn = this.columns[nextIdx];
        task.column_id = targetColumn.id;
        task.position = 0; // Move to top of target column
        this.renderColumnsAndCards();

        try {
            await window.api.put(`/tasks/${taskId}/move`, {
                target_column_id: targetColumn.id,
                target_position: 0
            });
            window.app.showToast('info', 'Task Moved', `Moved to ${targetColumn.name}`);
        } catch (err) {
            window.app.showToast('error', 'Move Failed', err.message);
            await this.loadBoardData();
            this.renderColumnsAndCards();
        }
    }

    openAddTaskModal(defaultColId = null) {
        const p = this.project;
        if (!p) return;

        const modalHtml = `
            <div class="modal-card">
                <div class="modal-header">
                    <h3 class="modal-title">Create New Task</h3>
                    <button class="btn btn-icon btn-sm" onclick="window.app.closeAllModals()">${window.icon('x', 18)}</button>
                </div>
                <form id="create-task-form">
                    <div class="modal-body">
                        <div class="form-group">
                            <label class="form-label" for="task-title-input">Task Title *</label>
                            <input type="text" id="task-title-input" class="form-control" placeholder="e.g. Design modern dark mode dashboard" required autofocus>
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="task-desc-input">Description</label>
                            <textarea id="task-desc-input" class="form-control" rows="3" placeholder="Context, details, requirements..."></textarea>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                            <div class="form-group">
                                <label class="form-label" for="task-col-select">Column</label>
                                <select id="task-col-select" class="form-control">
                                    ${this.columns.map(c => `
                                        <option value="${c.id}" ${c.id === defaultColId ? 'selected' : ''}>${this.escapeHtml(c.name)}</option>
                                    `).join('')}
                                </select>
                            </div>

                            <div class="form-group">
                                <label class="form-label" for="task-prio-select">Priority</label>
                                <select id="task-prio-select" class="form-control">
                                    <option value="Medium" selected>Medium</option>
                                    <option value="Low">Low</option>
                                    <option value="High">High</option>
                                    <option value="Urgent">Urgent</option>
                                </select>
                            </div>
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="task-due-input">Due Date</label>
                            <input type="date" id="task-due-input" class="form-control">
                        </div>

                        <!-- Assignees Selector -->
                        <div class="form-group">
                            <label class="form-label">Assign Members</label>
                            <div style="display: flex; gap: 8px; flex-wrap: wrap;" id="task-assignees-picker">
                                ${(p.members || []).map(m => `
                                    <label class="btn btn-secondary btn-sm" style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                                        <input type="checkbox" name="task_assignee" value="${m.user_id}">
                                        <span class="avatar avatar-sm" style="background:${m.avatar_color || '#6366F1'}; width:20px; height:20px; font-size:0.625rem;">
                                            ${(m.display_name || m.username)[0].toUpperCase()}
                                        </span>
                                        <span>${this.escapeHtml(m.display_name)}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>

                        <!-- Labels Selector -->
                        <div class="form-group">
                            <label class="form-label">Labels</label>
                            <div style="display: flex; gap: 8px; flex-wrap: wrap;" id="task-labels-picker">
                                ${(p.labels || []).map(l => `
                                    <label class="btn btn-secondary btn-sm" style="cursor: pointer; display: flex; align-items: center; gap: 6px;">
                                        <input type="checkbox" name="task_label" value="${l.id}">
                                        <span style="width:8px; height:8px; border-radius:50%; background:${l.color};"></span>
                                        <span>${this.escapeHtml(l.name)}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="window.app.closeAllModals()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Create Task</button>
                    </div>
                </form>
            </div>
        `;

        window.projects.showModal(modalHtml);

        const form = document.getElementById('create-task-form');
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                const title = document.getElementById('task-title-input').value.trim();
                const description = document.getElementById('task-desc-input').value.trim();
                const column_id = document.getElementById('task-col-select').value;
                const priority = document.getElementById('task-prio-select').value;
                const due_date = document.getElementById('task-due-input').value || null;

                const assignee_ids = Array.from(document.querySelectorAll('input[name="task_assignee"]:checked')).map(el => parseInt(el.value, 10));
                const label_ids = Array.from(document.querySelectorAll('input[name="task_label"]:checked')).map(el => parseInt(el.value, 10));

                try {
                    const res = await window.api.post(`/projects/${p.id}/tasks`, {
                        title,
                        description,
                        column_id,
                        priority,
                        due_date,
                        assignee_ids,
                        label_ids
                    });

                    if (res.success) {
                        window.app.closeAllModals();
                        window.app.showToast('success', 'Task Created', `"${res.task.title}" added.`);
                        if (!this.tasks.some(t => t.id === res.task.id)) {
                            this.tasks.push(res.task);
                            this.renderColumnsAndCards();
                        }
                    }
                } catch (err) {
                    window.app.showToast('error', 'Creation Failed', err.message);
                }
            };
        }
    }

    onCardClick(e, taskId) {
        // In Phase 4, this opens the comprehensive task detail drawer with comments, checklists, etc.!
        if (window.taskDrawer && window.taskDrawer.openDrawer) {
            window.taskDrawer.openDrawer(taskId);
        } else {
            const task = this.tasks.find(t => t.id === taskId);
            window.app.showToast('info', task ? task.title : 'Task', 'Task details drawer opens here in Phase 4.');
        }
    }

    toggleColumnMenu(e, colId) {
        e.stopPropagation();
        document.querySelectorAll('.dropdown-menu').forEach(el => {
            if (el.id !== `col-menu-${colId}`) el.classList.remove('open');
        });
        const menu = document.getElementById(`col-menu-${colId}`);
        if (menu) menu.classList.toggle('open');
    }

    async promptAddColumn() {
        const name = prompt('Enter new column name (e.g. "Testing", "Deployment"):');
        if (!name || !name.trim()) return;

        try {
            const res = await window.api.post(`/projects/${this.projectId}/columns`, { name: name.trim() });
            if (res.success) {
                window.app.showToast('success', 'Column Added', `"${res.column.name}" column created.`);
                this.columns.push(res.column);
                this.renderColumnsAndCards();
            }
        } catch (err) {
            window.app.showToast('error', 'Error', err.message);
        }
    }

    async promptRenameColumn(colId, currentName) {
        const name = prompt(`Rename column "${currentName}":`, currentName);
        if (!name || !name.trim() || name.trim() === currentName) return;

        try {
            const res = await window.api.put(`/columns/${colId}`, { name: name.trim() });
            if (res.success) {
                window.app.showToast('success', 'Column Renamed', `Renamed to "${res.column.name}".`);
                const col = this.columns.find(c => c.id === colId);
                if (col) col.name = res.column.name;
                this.renderColumnsAndCards();
            }
        } catch (err) {
            window.app.showToast('error', 'Error', err.message);
        }
    }

    async promptDeleteColumn(colId, name) {
        if (!confirm(`Are you sure you want to delete column "${name}"?\nAny tasks inside will be moved to the first column.`)) return;

        try {
            const res = await window.api.delete(`/columns/${colId}`);
            if (res.success) {
                window.app.showToast('info', 'Column Deleted', res.message);
                this.columns = this.columns.filter(c => c.id !== colId);
                await this.loadBoardData();
                this.renderColumnsAndCards();
            }
        } catch (err) {
            window.app.showToast('error', 'Error', err.message);
        }
    }

    formatDueDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

window.kanban = new KanbanManager();
