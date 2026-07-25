// ============================================================================
// 情報ハブ (クッションモーダル)
// ============================================================================

import { VERSION } from '../../config/version.js';
import { applyTranslations } from '../../utils/i18n.js';

export function setupInfoHubModal(state, settings) {
  const brand = document.querySelector('.brand');
  const infoHubModal = document.getElementById('infoHubModal');
  const infoHubClose = document.getElementById('infoHubClose');
  const infoHubVersion = document.getElementById('infoHubVersion');
  const openDebugBtn = document.getElementById('openDebugFromInfoHubBtn');

  if (!brand || !infoHubModal) return;

  // ロゴクリックでクッションモーダル表示
  brand.onclick = function (e) {
    if (e) e.preventDefault();

    if (infoHubVersion) {
      const buildInfo = window.__buildInfo || `v${VERSION}`;
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
}
