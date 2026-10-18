// Taskora Auth Controller

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.initialized = false;
    }

    async init() {
        try {
            const data = await window.api.get('/auth/me');
            if (data.success && data.user) {
                this.currentUser = data.user;
                if (data.user.theme) {
                    window.theme.applyTheme(data.user.theme);
                }
            }
        } catch (e) {
            this.currentUser = null;
        } finally {
            this.initialized = true;
            this.updateAuthUI();
        }
    }

    async login(identifier, password) {
        try {
            const data = await window.api.post('/auth/login', { identifier, password });
            if (data.success && data.user) {
                this.currentUser = data.user;
                if (data.user.theme) {
                    window.theme.applyTheme(data.user.theme);
                }
                this.updateAuthUI();
                window.app.showToast('success', 'Welcome back!', `Signed in as ${data.user.display_name}`);
                window.app.navigate('dashboard');
                return data;
            }
        } catch (err) {
            window.app.showToast('error', 'Login Failed', err.message);
            throw err;
        }
    }

    async register(username, email, password, display_name) {
        try {
            const data = await window.api.post('/auth/register', { username, email, password, display_name });
            if (data.success && data.user) {
                this.currentUser = data.user;
                this.updateAuthUI();
                window.app.showToast('success', 'Account Created!', `Welcome to Taskora, ${data.user.display_name}!`);
                window.app.navigate('dashboard');
                return data;
            }
        } catch (err) {
            window.app.showToast('error', 'Registration Failed', err.message);
            throw err;
        }
    }

    async logout() {
        try {
            await window.api.post('/auth/logout');
        } catch (e) {
            // Ignore error on logout
        } finally {
            this.currentUser = null;
            this.updateAuthUI();
            window.app.showToast('info', 'Logged Out', 'You have been safely signed out.');
            window.app.navigate('landing');
        }
    }

    handleUnauthorized() {
        if (this.currentUser) {
            this.currentUser = null;
            this.updateAuthUI();
            window.app.showToast('warning', 'Session Expired', 'Please log in again.');
            window.app.navigate('auth');
        }
    }

    async demoLogin(username = 'alex_owner') {
        const password = 'Password123!';
        return this.login(username, password);
    }

    updateAuthUI() {
        const loggedIn = !!this.currentUser;
        
        // Hide/show navbar search for logged-out visitors (requirement)
        const searchContainer = document.getElementById('navbar-search-container');
        if (searchContainer) {
            searchContainer.style.display = loggedIn ? 'block' : 'none';
        }

        // Navbar right side (notifications bell + avatar menu vs Sign In button)
        const userNavSection = document.getElementById('navbar-user-section');
        const guestNavSection = document.getElementById('navbar-guest-section');
        const sidebar = document.getElementById('app-sidebar');
        const mobileTabs = document.getElementById('mobile-tab-bar');

        if (loggedIn) {
            if (userNavSection) userNavSection.style.display = 'flex';
            if (guestNavSection) guestNavSection.style.display = 'none';
            if (sidebar) sidebar.style.display = 'flex';
            if (mobileTabs) mobileTabs.style.display = 'flex';

            // Load projects into sidebar
            if (window.projects) {
                window.projects.loadProjects();
            }

            // Update user avatar
            const avatarEl = document.getElementById('user-avatar-display');
            if (avatarEl) {
                avatarEl.style.backgroundColor = this.currentUser.avatar_color || 'var(--brand-primary)';
                avatarEl.textContent = (this.currentUser.display_name || this.currentUser.username || 'U')[0].toUpperCase();
            }

            // Update user dropdown info
            const nameEl = document.getElementById('dropdown-user-name');
            const emailEl = document.getElementById('dropdown-user-email');
            if (nameEl) nameEl.textContent = this.currentUser.display_name || this.currentUser.username;
            if (emailEl) emailEl.textContent = this.currentUser.email;
        } else {
            if (userNavSection) userNavSection.style.display = 'none';
            if (guestNavSection) guestNavSection.style.display = 'flex';
            if (sidebar) sidebar.style.display = 'none';
            if (mobileTabs) mobileTabs.style.display = 'none';
        }
    }
}

window.auth = new AuthManager();
