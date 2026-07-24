import { _settingsManagerRef } from './display-settings.js';

export function getCurrentThemeMode() {
  try {
    return document.body.classList.contains('theme-light') ? 'light' : 'dark';
  } catch (e) {
    return 'dark';
  }
}

export function getBrightnessForCurrentTheme(settingsManager) {
  try {
    const mode = getCurrentThemeMode();
    const key = `bgBrightness_${mode}`;
    const sm = settingsManager || _settingsManagerRef;
    if (sm && sm.settings) {
      if (sm.settings[key] !== undefined) {
        return sm.settings[key];
      }
      if (sm.settings.bgBrightness !== undefined) {
        return sm.settings.bgBrightness;
      }
    }
  } catch (e) { }
  return 100;
}

export function applyTheme(theme) {
  try {
    if (theme === 'light') document.body.classList.add('theme-light');
    else document.body.classList.remove('theme-light');
    updateMetaThemeColor();

    // テーマ切り替え時に、現在のテーマ（light/dark）に対応する明るさを読み込んで適用＆UI同期
    const currentBrightness = getBrightnessForCurrentTheme(_settingsManagerRef);
    applyBgBrightness(currentBrightness);
    const input = document.getElementById('bgBrightnessInput');
    if (input) input.value = currentBrightness;
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

export function applyBgBrightness(brightness) {
  try {
    const val = typeof brightness === 'number' ? brightness : parseInt(brightness, 10);
    const safeVal = isNaN(val) ? 100 : Math.max(50, Math.min(150, val));
    const isLight = document.body.classList.contains('theme-light');
    
    let mixColor = '#000000';
    let mixAmount = 0;

    if (isLight) {
      // ライトテーマ用：背景色（白系）を暗く・落ち着かせる場合、文字視認性を壊さない柔らかいスレートグレーを適量ブレンド
      if (safeVal < 100) {
        mixColor = '#334155';
        mixAmount = Math.round((100 - safeVal) * 0.35); // 50%のとき約17.5%のソフトブレンド
      } else if (safeVal > 100) {
        mixColor = '#ffffff';
        mixAmount = Math.round((safeVal - 100) * 1.5); // より純白に近づける
      }
    } else {
      // ダークテーマ用
      if (safeVal < 100) {
        mixColor = '#000000';
        mixAmount = Math.round((100 - safeVal) * 1.5);
      } else if (safeVal > 100) {
        mixColor = '#ffffff';
        mixAmount = Math.round((safeVal - 100) * 1.0);
      }
    }

    document.documentElement.style.setProperty('--bg-mix-color', mixColor);
    document.documentElement.style.setProperty('--bg-mix-amount', `${mixAmount}%`);

    const valueEl = document.getElementById('bgBrightnessValue');
    if (valueEl) {
      valueEl.textContent = `${safeVal}%`;
    }
  } catch (e) { }
}

