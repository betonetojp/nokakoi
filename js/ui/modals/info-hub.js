// ============================================================================
// 情報ハブ (クッションモーダル)
// ============================================================================

import { VERSION } from '../../config/version.js';
import { applyTranslations, t } from '../../utils/i18n.js';
import { showToast } from '../../utils/utils.js';
import { getBuildInfo } from '../../core/app-context.js';

export function setupInfoHubModal() {
  const brand = document.querySelector('.brand');
  const infoHubModal = document.getElementById('infoHubModal');
  const infoHubClose = document.getElementById('infoHubClose');
  const infoHubVersion = document.getElementById('infoHubVersion');
  const openDebugBtn = document.getElementById('openDebugFromInfoHubBtn');
  const fullReloadBtn = document.getElementById('fullReloadFromInfoHubBtn');

  if (!brand || !infoHubModal) return;

  // ロゴクリックでクッションモーダル表示
  brand.onclick = function (e) {
    if (e) e.preventDefault();

    if (infoHubVersion) {
      const buildInfo = getBuildInfo() || `v${VERSION}`;
      infoHubVersion.textContent = buildInfo;
    }

    try {
      applyTranslations(infoHubModal);
    } catch (e) { }

    infoHubModal.hidden = false;
  };

  if (infoHubClose) {
    infoHubClose.onclick = function () {
      infoHubModal.hidden = true;
    };
  }

  infoHubModal.onclick = function (e) {
    if (e.target === infoHubModal) {
      infoHubModal.hidden = true;
    }
  };

  if (openDebugBtn) {
    openDebugBtn.onclick = function () {
      infoHubModal.hidden = true;
      const debugModal = document.getElementById('debugModal');
      if (debugModal) {
        debugModal.hidden = false;
      }
    };
  }

  if (fullReloadBtn) {
    fullReloadBtn.onclick = function () {
      try {
        showToast(t('reload.full_reload') || 'アプリを完全再読み込みします...', { type: 'info', duration: 1500 });
      } catch (e) { }
      setTimeout(() => {
        try { window.location.reload(); } catch (err) { window.location.replace(window.location.href); }
      }, 300);
    };
  }
}
