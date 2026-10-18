// Taskora Main Application & Router

class AppManager {
    constructor() {
        this.currentView = 'landing';
        this.viewParams = {};
        this.activeModal = null;
    }

    async init() {
        // Setup icons across static markup
        this.renderStaticIcons();

        // Initialize theme
        window.theme.updateThemeToggleUI ? window.theme.updateThemeToggleUI(document.documentElement.getAttribute('data-theme') || 'light') : null;

        // Initialize auth session
        await window.auth.init();

        // Setup global event listeners
        this.setupKeyboardShortcuts();
        this.setupDropdowns();
        this.setupAuthForms();

        // Determine initial route
        const path = window.location.pathname.replace(/^\//, '') || '';
        if (window.auth.currentUser) {
            this.navigate(path || 'dashboard');
        } else {
            if (path === 'login' || path === 'register' || path === 'auth') {
                this.navigate('auth', { tab: path === 'register' ? 'register' : 'login' });
            } else {
                this.navigate('landing');
            }
        }

        // Handle browser back/forward
        window.addEventListener('popstate', (e) => {
            if (e.state && e.state.view) {
                this.renderView(e.state.view, e.state.params, false);
            }
        });
    }

    renderStaticIcons() {
        // Replace elements with data-icon attribute
        document.querySelectorAll('[data-icon]').forEach(el => {
            const name = el.getAttribute('data-icon');
            const size = parseInt(el.getAttribute('data-icon-size') || '18', 10);
            el.innerHTML = window.icon(name, size);
        });
    }

    navigate(view, params = {}, pushState = true) {
        if (!window.auth.currentUser && view !== 'landing' && view !== 'auth') {
            view = 'landing';
        }

        this.currentView = view;
        this.viewParams = params;

        if (pushState) {
            const url = view === 'landing' ? '/' : `/${view}`;
            window.history.pushState({ view, params }, '', url);
        }

        this.renderView(view, params);
        this.updateNavHighlight(view);
    }

    renderView(view, params = {}) {
        const container = document.getElementById('view-container');
        if (!container) return;

        // Close any open modals
        this.closeAllModals();

        if (view === 'landing') {
            this.renderLandingView(container);
        } else if (view === 'auth') {
            this.renderAuthView(container, params.tab || 'login');
        } else if (view === 'dashboard') {
            this.renderDashboardPlaceholder(container);
        } else if (view === 'projects') {
            container.innerHTML = `<div class="empty-state">
                <div class="empty-state-svg">${window.icon('kanban', 64)}</div>
                <h2 class="empty-state-title">Projects Hub</h2>
                <p class="empty-state-desc">Projects module is coming in Phase 2!</p>
                <button class="btn btn-primary" onclick="window.app.navigate('dashboard')">Back to Dashboard</button>
            </div>`;
        } else if (view === 'settings') {
            container.innerHTML = `<div class="empty-state">
                <div class="empty-state-svg">${window.icon('settings', 64)}</div>
                <h2 class="empty-state-title">Settings</h2>
                <p class="empty-state-desc">Personal profile and team preferences are being configured.</p>
                <button class="btn btn-primary" onclick="window.app.navigate('dashboard')">Back to Dashboard</button>
            </div>`;
        } else {
            container.innerHTML = `<div class="empty-state">
                <div class="empty-state-svg">${window.icon('alert-circle', 64)}</div>
                <h2 class="empty-state-title">Page Not Found</h2>
                <p class="empty-state-desc">The requested page could not be located.</p>
                <button class="btn btn-primary" onclick="window.app.navigate('dashboard')">Go to Dashboard</button>
            </div>`;
        }
    }

    updateNavHighlight(view) {
        document.querySelectorAll('.sidebar-nav-item, .mobile-tab-btn').forEach(el => {
            const target = el.getAttribute('data-view');
            if (target === view) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        });
    }

    renderLandingView(container) {
        container.innerHTML = `
            <div class="landing-container">
                <div class="hero-badge">
                    ${window.icon('sparkles', 16)} Taskora 2.0 • CodeAlpha Full Stack
                </div>
                <h1 class="hero-title">
                    The modern workspace to <span class="gradient-text">Plan. Collaborate. Deliver.</span>
                </h1>
                <p class="hero-subtitle">
                    Organize projects, prioritize tasks, collaborate in real-time, and ship faster with high-performance Kanban boards, team permissions, and real-time activity tracking.
                </p>
                <div class="hero-actions">
                    <button class="btn btn-primary btn-lg" onclick="window.app.navigate('auth', { tab: 'register' })">
                        Get Started Free ${window.icon('arrow-right', 18)}
                    </button>
                    <button class="btn btn-secondary btn-lg" onclick="window.app.quickDemo()">
                        ${window.icon('sparkles', 18)} Explore Demo
                    </button>
                </div>
                <div class="hero-demo-notice">
                    ${window.icon('shield', 16)} No credit card required. Preloaded with realistic team data and 3 group projects.
                </div>

                <!-- Interactive Preview Showcase -->
                <div class="landing-preview-card">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--border)">
                        <div style="display:flex; align-items:center; gap:10px">
                            <span style="width:12px; height:12px; border-radius:50%; background:#EF4444"></span>
                            <span style="width:12px; height:12px; border-radius:50%; background:#F59E0B"></span>
                            <span style="width:12px; height:12px; border-radius:50%; background:#22C55E"></span>
                            <span style="font-weight:700; font-size:0.875rem; margin-left:8px">Website Redesign • Sprint Board</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px">
                            <span class="badge badge-urgent">Urgent</span>
                            <span class="badge badge-medium">4 Tasks in progress</span>
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:16px; text-align:left">
                        <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius-lg); padding:14px">
                            <div style="font-weight:700; font-size:0.8125rem; margin-bottom:10px; display:flex; justify-content:space-between">
                                <span>TO DO</span> <span class="badge" style="background:var(--surface)">3</span>
                            </div>
                            <div style="background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:12px; margin-bottom:8px; box-shadow:var(--shadow-sm)">
                                <span class="badge badge-high" style="margin-bottom:6px">High</span>
                                <div style="font-weight:600; font-size:0.875rem; margin-bottom:4px">Design brand icon set</div>
                                <div style="font-size:0.75rem; color:var(--text-muted)">Checklist: 3/4 done</div>
                            </div>
                        </div>
                        <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius-lg); padding:14px">
                            <div style="font-weight:700; font-size:0.8125rem; margin-bottom:10px; display:flex; justify-content:space-between">
                                <span>IN PROGRESS</span> <span class="badge" style="background:var(--surface)">2</span>
                            </div>
                            <div style="background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:12px; margin-bottom:8px; box-shadow:var(--shadow-sm)">
                                <span class="badge badge-urgent" style="margin-bottom:6px">Urgent</span>
                                <div style="font-weight:600; font-size:0.875rem; margin-bottom:4px">Setup Socket.io real-time board</div>
                                <div style="font-size:0.75rem; color:var(--text-muted)">Assigned to Alex</div>
                            </div>
                        </div>
                        <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius-lg); padding:14px">
                            <div style="font-weight:700; font-size:0.8125rem; margin-bottom:10px; display:flex; justify-content:space-between">
                                <span>DONE</span> <span class="badge" style="background:var(--surface)">5</span>
                            </div>
                            <div style="background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:12px; margin-bottom:8px; box-shadow:var(--shadow-sm)">
                                <span class="badge badge-low" style="margin-bottom:6px">Completed</span>
                                <div style="font-weight:600; font-size:0.875rem; margin-bottom:4px">SQLite schema with WAL mode</div>
                                <div style="font-size:0.75rem; color:var(--text-muted)">Reviewed by Team</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Feature Highlights -->
                <div class="features-grid">
                    <div class="feature-card">
                        <div class="feature-icon-wrapper">${window.icon('kanban', 24)}</div>
                        <h3 class="feature-title">Fluid Kanban Boards</h3>
                        <p class="feature-desc">Drag and drop cards seamlessly between customizable columns with instant position persistence and responsive touch support.</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon-wrapper">${window.icon('activity', 24)}</div>
                        <h3 class="feature-title">Socket.io Real-Time Sync</h3>
                        <p class="feature-desc">See task changes, moves, and comments the millisecond they happen. Live online avatars and typing indicators keep everyone in sync.</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon-wrapper">${window.icon('users', 24)}</div>
                        <h3 class="feature-title">Role-Based Team Control</h3>
                        <p class="feature-desc">Manage project members with strict Owner, Admin, Member, and Viewer permissions to safeguard critical workflows.</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon-wrapper">${window.icon('check-square', 24)}</div>
                        <h3 class="feature-title">Subtasks & Checklists</h3>
                        <p class="feature-desc">Break large initiatives into manageable checklist milestones with interactive progress bars and assignee tracking.</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon-wrapper">${window.icon('bell', 24)}</div>
                        <h3 class="feature-title">Smart Notifications</h3>
                        <p class="feature-desc">Stay informed when assigned to tasks, mentioned in discussions, or when upcoming deadlines approach.</p>
                    </div>
                    <div class="feature-card">
                        <div class="feature-icon-wrapper">${window.icon('moon', 24)}</div>
                        <h3 class="feature-title">Curated Dual Themes</h3>
                        <p class="feature-desc">Pixel-perfect Light and Dark themes engineered with WCAG AA contrast compliance and smooth micro-animations.</p>
                    </div>
                </div>
            </div>
        `;
    }

    renderAuthView(container, activeTab = 'login') {
        container.innerHTML = `
            <div class="auth-page-container">
                <!-- Left Brand Panel -->
                <div class="auth-brand-panel">
                    <div>
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:40px">
                            <img src="/logo.svg" alt="Taskora Logo" style="height:38px">
                        </div>
                        <h2 class="auth-panel-tagline">
                            Plan with clarity.<br>
                            Collaborate in sync.<br>
                            <span class="highlight">Deliver on time.</span>
                        </h2>
                        <p class="auth-panel-description">
                            Experience next-generation team task management with real-time updates, interactive boards, and granular permissions.
                        </p>
                    </div>
                    <ul class="auth-feature-list">
                        <li class="auth-feature-item">${window.icon('check-circle', 20)} Fast, responsive Kanban drag and drop</li>
                        <li class="auth-feature-item">${window.icon('check-circle', 20)} Instant live synchronization via Socket.io</li>
                        <li class="auth-feature-item">${window.icon('check-circle', 20)} Role-based security (Owner, Admin, Member, Viewer)</li>
                        <li class="auth-feature-item">${window.icon('check-circle', 20)} Dark & light themes with WCAG AA compliance</li>
                    </ul>
                    <div style="font-size:0.8125rem; color:#8489AB">
                        Taskora • CodeAlpha Full Stack Internship Task 3
                    </div>
                </div>

                <!-- Right Form Panel -->
                <div class="auth-form-panel">
                    <div class="auth-card">
                        <div class="auth-tabs">
                            <button class="auth-tab-btn ${activeTab === 'login' ? 'active' : ''}" id="tab-login-btn" onclick="window.app.switchAuthTab('login')">
                                Sign In
                            </button>
                            <button class="auth-tab-btn ${activeTab === 'register' ? 'active' : ''}" id="tab-register-btn" onclick="window.app.switchAuthTab('register')">
                                Create Account
                            </button>
                        </div>

                        <!-- Login Form -->
                        <form id="login-form" style="display: ${activeTab === 'login' ? 'block' : 'none'}">
                            <div class="form-group" id="login-identifier-group">
                                <label class="form-label" for="login-identifier">Username or Email</label>
                                <div class="input-with-icon">
                                    <span class="input-icon-left">${window.icon('user', 18)}</span>
                                    <input type="text" id="login-identifier" class="form-control" placeholder="Enter username or email" required autocomplete="username">
                                </div>
                                <span class="form-error-msg" id="login-identifier-error"></span>
                            </div>

                            <div class="form-group" id="login-password-group">
                                <label class="form-label" for="login-password">Password</label>
                                <div class="input-with-icon">
                                    <span class="input-icon-left">${window.icon('lock', 18)}</span>
                                    <input type="password" id="login-password" class="form-control" placeholder="••••••••" required autocomplete="current-password">
                                    <span class="input-password-toggle" onclick="window.app.togglePasswordVisibility('login-password')">
                                        ${window.icon('eye', 18)}
                                    </span>
                                </div>
                                <span class="form-error-msg" id="login-password-error"></span>
                            </div>

                            <button type="submit" class="btn btn-primary" style="width:100%; margin-top:8px">
                                Sign In ${window.icon('arrow-right', 18)}
                            </button>
                        </form>

                        <!-- Register Form -->
                        <form id="register-form" style="display: ${activeTab === 'register' ? 'block' : 'none'}">
                            <div class="form-group" id="reg-name-group">
                                <label class="form-label" for="reg-name">Full Name</label>
                                <div class="input-with-icon">
                                    <span class="input-icon-left">${window.icon('user', 18)}</span>
                                    <input type="text" id="reg-name" class="form-control" placeholder="e.g. Alex Morgan" required>
                                </div>
                            </div>

                            <div class="form-group" id="reg-username-group">
                                <label class="form-label" for="reg-username">Username</label>
                                <div class="input-with-icon">
                                    <span class="input-icon-left">@</span>
                                    <input type="text" id="reg-username" class="form-control" placeholder="alex_morgan" required autocomplete="username">
                                </div>
                                <span class="form-error-msg" id="reg-username-error"></span>
                            </div>

                            <div class="form-group" id="reg-email-group">
                                <label class="form-label" for="reg-email">Email Address</label>
                                <div class="input-with-icon">
                                    <span class="input-icon-left">${window.icon('mail', 18)}</span>
                                    <input type="email" id="reg-email" class="form-control" placeholder="alex@company.com" required autocomplete="email">
                                </div>
                                <span class="form-error-msg" id="reg-email-error"></span>
                            </div>

                            <div class="form-group" id="reg-password-group">
                                <label class="form-label" for="reg-password">Password (min 8 characters)</label>
                                <div class="input-with-icon">
                                    <span class="input-icon-left">${window.icon('lock', 18)}</span>
                                    <input type="password" id="reg-password" class="form-control" placeholder="••••••••" required minlength="8" autocomplete="new-password">
                                    <span class="input-password-toggle" onclick="window.app.togglePasswordVisibility('reg-password')">
                                        ${window.icon('eye', 18)}
                                    </span>
                                </div>
                                <span class="form-error-msg" id="reg-password-error"></span>
                            </div>

                            <button type="submit" class="btn btn-primary" style="width:100%; margin-top:8px">
                                Create Account ${window.icon('arrow-right', 18)}
                            </button>
                        </form>

                        <!-- Demo Login Box -->
                        <div class="demo-accounts-box">
                            <p>Try a preloaded demo account:</p>
                            <div class="demo-buttons-row">
                                <button type="button" class="btn btn-secondary btn-sm" onclick="window.auth.demoLogin('alex_owner')">
                                    ${window.icon('shield', 14)} Alex (Owner)
                                </button>
                                <button type="button" class="btn btn-secondary btn-sm" onclick="window.auth.demoLogin('sarah_dev')">
                                    ${window.icon('user', 14)} Sarah (Member)
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.setupAuthForms();
    }

    switchAuthTab(tab) {
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');
        const tabLoginBtn = document.getElementById('tab-login-btn');
        const tabRegBtn = document.getElementById('tab-register-btn');

        if (tab === 'login') {
            if (loginForm) loginForm.style.display = 'block';
            if (registerForm) registerForm.style.display = 'none';
            if (tabLoginBtn) tabLoginBtn.classList.add('active');
            if (tabRegBtn) tabRegBtn.classList.remove('active');
        } else {
            if (loginForm) loginForm.style.display = 'none';
            if (registerForm) registerForm.style.display = 'block';
            if (tabLoginBtn) tabLoginBtn.classList.remove('active');
            if (tabRegBtn) tabRegBtn.classList.add('active');
        }
    }

    togglePasswordVisibility(inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
    }

    setupAuthForms() {
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.onsubmit = async (e) => {
                e.preventDefault();
                const idEl = document.getElementById('login-identifier');
                const passEl = document.getElementById('login-password');
                if (!idEl || !passEl) return;
                try {
                    await window.auth.login(idEl.value.trim(), passEl.value);
                } catch (e) {
                    // Handled in auth manager toast
                }
            };
        }

        const regForm = document.getElementById('register-form');
        if (regForm) {
            regForm.onsubmit = async (e) => {
                e.preventDefault();
                const nameEl = document.getElementById('reg-name');
                const usernameEl = document.getElementById('reg-username');
                const emailEl = document.getElementById('reg-email');
                const passEl = document.getElementById('reg-password');

                if (!usernameEl || !emailEl || !passEl) return;

                if (passEl.value.length < 8) {
                    this.showToast('error', 'Weak Password', 'Password must be at least 8 characters long.');
                    return;
                }

                try {
                    await window.auth.register(
                        usernameEl.value.trim(),
                        emailEl.value.trim(),
                        passEl.value,
                        nameEl ? nameEl.value.trim() : ''
                    );
                } catch (e) {
                    // Handled in auth manager toast
                }
            };
        }
    }

    renderDashboardPlaceholder(container) {
        const user = window.auth.currentUser || { display_name: 'Explorer' };
        container.innerHTML = `
            <div style="margin-bottom:28px">
                <h1 style="font-size:1.875rem; margin-bottom:6px">Welcome, ${user.display_name}! 👋</h1>
                <p style="color:var(--text-muted)">Phase 1 complete: Database, JWT Auth, Design System & Layout are active.</p>
            </div>

            <!-- Stats Overview Cards -->
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:20px; margin-bottom:32px">
                <div style="background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg); padding:20px; box-shadow:var(--shadow-sm)">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
                        <span style="font-size:0.8125rem; font-weight:600; color:var(--text-muted)">Active Projects</span>
                        <div style="padding:6px; border-radius:var(--radius-sm); background:var(--brand-primary-light); color:var(--brand-primary)">${window.icon('folder', 18)}</div>
                    </div>
                    <div style="font-size:1.875rem; font-weight:800; font-family:var(--font-heading)" id="dash-projects-count">3</div>
                    <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px">Across 8 team members</div>
                </div>

                <div style="background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg); padding:20px; box-shadow:var(--shadow-sm)">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
                        <span style="font-size:0.8125rem; font-weight:600; color:var(--text-muted)">Tasks Due This Week</span>
                        <div style="padding:6px; border-radius:var(--radius-sm); background:var(--priority-medium-bg); color:var(--priority-medium-text)">${window.icon('clock', 18)}</div>
                    </div>
                    <div style="font-size:1.875rem; font-weight:800; font-family:var(--font-heading)">5 tasks</div>
                    <div style="font-size:0.75rem; color:var(--priority-medium-text); margin-top:4px">2 due today</div>
                </div>

                <div style="background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg); padding:20px; box-shadow:var(--shadow-sm)">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
                        <span style="font-size:0.8125rem; font-weight:600; color:var(--text-muted)">Completed Tasks</span>
                        <div style="padding:6px; border-radius:var(--radius-sm); background:var(--priority-low-bg); color:var(--priority-low-text)">${window.icon('check-circle', 18)}</div>
                    </div>
                    <div style="font-size:1.875rem; font-weight:800; font-family:var(--font-heading)">18 tasks</div>
                    <div style="font-size:0.75rem; color:var(--priority-low-text); margin-top:4px">76% sprint progress</div>
                </div>

                <div style="background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-lg); padding:20px; box-shadow:var(--shadow-sm)">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
                        <span style="font-size:0.8125rem; font-weight:600; color:var(--text-muted)">Real-time Status</span>
                        <div style="padding:6px; border-radius:var(--radius-sm); background:rgba(16,185,129,0.15); color:#10B981">${window.icon('activity', 18)}</div>
                    </div>
                    <div style="font-size:1.25rem; font-weight:700; color:#10B981; display:flex; align-items:center; gap:8px">
                        <span style="width:10px; height:10px; border-radius:50%; background:#10B981; display:inline-block"></span> Connected
                    </div>
                    <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px">Socket.io server listening</div>
                </div>
            </div>

            <!-- Ready for Phase 2 Banner -->
            <div style="background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-xl); padding:28px; box-shadow:var(--shadow-md)">
                <div style="display:flex; align-items:center; gap:16px; margin-bottom:16px">
                    <div style="width:44px; height:44px; border-radius:var(--radius-md); background:var(--brand-primary-light); color:var(--brand-primary); display:flex; align-items:center; justify-content:center">
                        ${window.icon('sparkles', 22)}
                    </div>
                    <div>
                        <h2 style="font-size:1.25rem; font-weight:700">Phase 1 Foundations Ready</h2>
                        <p style="color:var(--text-muted); font-size:0.875rem">Express backend, SQLite WAL schema, JWT authentication, and responsive dual-theme design system are operational.</p>
                    </div>
                </div>
                <div style="display:flex; gap:12px; flex-wrap:wrap">
                    <button class="btn btn-primary btn-sm" onclick="window.app.showToast('info', 'Phase 2 Next', 'Ready to implement Project CRUD, Members, and Roles.')">
                        ${window.icon('folder', 16)} Explore Projects
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="window.theme.toggleTheme()">
                        ${window.icon('moon', 16)} Toggle Theme
                    </button>
                </div>
            </div>
        `;
    }

    quickDemo() {
        this.navigate('auth', { tab: 'login' });
        setTimeout(() => {
            window.auth.demoLogin('alex_owner');
        }, 100);
    }

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            // Esc: close active modal or dropdown
            if (e.key === 'Escape') {
                this.closeAllModals();
                this.closeAllDropdowns();
            }

            // Avoid shortcuts if user is typing in an input
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
                return;
            }

            // '/': focus search input
            if (e.key === '/') {
                e.preventDefault();
                const searchInput = document.getElementById('navbar-search-input');
                if (searchInput && searchInput.offsetParent !== null) {
                    searchInput.focus();
                }
            }

            // 'N': new task shortcut
            if (e.key === 'n' || e.key === 'N') {
                if (window.auth.currentUser) {
                    this.showToast('info', 'Quick Task (N)', 'Task creation modal will open here once projects are loaded.');
                }
            }
        });
    }

    setupDropdowns() {
        const userMenuBtn = document.getElementById('user-menu-btn');
        const userDropdown = document.getElementById('user-dropdown-menu');

        if (userMenuBtn && userDropdown) {
            userMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                userDropdown.classList.toggle('open');
            });
        }

        // Close dropdown when clicking outside
        window.addEventListener('click', (e) => {
            if (userDropdown && !userDropdown.contains(e.target) && e.target !== userMenuBtn) {
                userDropdown.classList.remove('open');
            }
        });
    }

    closeAllDropdowns() {
        document.querySelectorAll('.dropdown-menu').forEach(el => el.classList.remove('open'));
    }

    closeAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('open'));
        this.activeModal = null;
    }

    showToast(type = 'info', title = '', message = '', duration = 4000) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const iconMap = {
            success: 'check-circle',
            error: 'alert-circle',
            warning: 'alert-circle',
            info: 'info'
        };

        toast.innerHTML = `
            <div class="toast-icon">${window.icon(iconMap[type] || 'info', 20)}</div>
            <div class="toast-content">
                ${title ? `<div class="toast-title">${title}</div>` : ''}
                <div>${message}</div>
            </div>
            <div class="toast-close" onclick="this.parentElement.remove()">${window.icon('x', 16)}</div>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(8px)';
                toast.style.transition = 'all 0.2s ease-out';
                setTimeout(() => toast.remove(), 200);
            }
        }, duration);
    }
}

window.app = new AppManager();
document.addEventListener('DOMContentLoaded', () => {
    window.app.init();
});
