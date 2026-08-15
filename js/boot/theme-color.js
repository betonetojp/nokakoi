// Keep these colors in sync with updateMetaThemeColor in theme-manager.js.
const LIGHT_COLORS = {
  pink: '#ffeaf5',
  blue: '#e0f2fe',
  purple: '#ede9fe',
  green: '#d1fae5',
  orange: '#ffedd5',
  gray: '#e2e8f0'
};
const DARK_COLOR = '#16181f';

function readSettings() {
  try {
    const raw = localStorage.getItem('appSettings');
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch {
    return {};
  }
}

function isLight(theme) {
  if (theme === 'light') return true;
  if (theme === 'dark') return false;
  try {
    return !(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch {
    return true;
  }
}

function updateThemeColor() {
  try {
    const settings = readSettings();
    if (settings.famicomMode && document.body) {
      document.body.classList.add('famicom-mode');
    }
    const theme = settings.theme || 'system';
    const colorTheme = settings.colorTheme || 'pink';
    const color = isLight(theme) ? (LIGHT_COLORS[colorTheme] || '#ffffff') : DARK_COLOR;
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = color;
  } catch {
    // Theme color is a progressive enhancement.
  }
}

updateThemeColor();

try {
  const colorScheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (colorScheme && typeof colorScheme.addEventListener === 'function') {
    colorScheme.addEventListener('change', updateThemeColor);
  } else if (colorScheme && typeof colorScheme.addListener === 'function') {
    colorScheme.addListener(updateThemeColor);
  }
} catch {
  // Older browsers may not expose matchMedia listeners.
}
