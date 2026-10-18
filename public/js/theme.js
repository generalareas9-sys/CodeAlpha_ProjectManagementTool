// Taskora Theme Controller (Light/Dark theme support)

const THEME_STORAGE_KEY = 'taskora_theme';

function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
        return saved;
    }
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }
    return 'light'; // Default light
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    updateThemeToggleUI(theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
}

function updateThemeToggleUI(theme) {
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
        btn.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
        btn.title = `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`;
        btn.innerHTML = theme === 'dark' 
            ? window.icon('sun', 20) 
            : window.icon('moon', 20);
    }
}

// Initialize immediately to prevent flash of wrong theme
const initialTheme = getPreferredTheme();
document.documentElement.setAttribute('data-theme', initialTheme);

// Listen to system preference changes if user hasn't explicitly set one
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_STORAGE_KEY)) {
        applyTheme(e.matches ? 'dark' : 'light');
    }
});

window.theme = {
    applyTheme,
    toggleTheme,
    getPreferredTheme
};
