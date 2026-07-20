import { _settingsManagerRef } from './display-settings.js';

export function applyTheme(theme) {
  try {
    if (theme === 'light') document.body.classList.add('theme-light');
    else document.body.classList.remove('theme-light');
    updateMetaThemeColor();
  } catch (e) { }
}

export function applyColorTheme(colorTheme) {
  try {
    const list = [
      'color-theme-pink',
      'color-theme-blue',
      'color-theme-purple',
      'color-theme-green',
      'color-theme-orange',
      'color-theme-gray'
    ];
    list.forEach(c => document.body.classList.remove(c));
    document.body.classList.add(`color-theme-${colorTheme || 'pink'}`);
    updateMetaThemeColor();
  } catch (e) { }
}

export function updateMetaThemeColor() {
  try {
    const isLight = document.body.classList.contains('theme-light');
    const colorTheme = _settingsManagerRef ? (_settingsManagerRef.get('colorTheme') || 'pink') : 'pink';
    let themeColor = '#16181f';

    if (isLight) {
      const lightColors = {
        pink: '#ffeaf5',
        blue: '#e0f2fe',
        purple: '#ede9fe',
        green: '#d1fae5',
        orange: '#ffedd5',
        gray: '#e2e8f0'
      };
      themeColor = lightColors[colorTheme] || '#ffffff';
    } else {
      themeColor = '#16181f';
    }

    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = themeColor;
  } catch (e) { }
}
