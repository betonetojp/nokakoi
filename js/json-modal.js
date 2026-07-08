// ============================================================================
// JSONビューアモーダル
// ============================================================================

import { $ } from './utils.js';
import { t, applyTranslations } from './i18n.js';

function eventForJsonDisplay(event) {
  if (!event || typeof event !== 'object') return event;
  const { __receivedAt, ...rest } = event;
  return rest;
}

/**
 * JSONビューアモーダルを表示
 */
export function showJsonModal(event) {
  const modal = $('#jsonModal');
  const closeBtn = $('#jsonClose');
  const content = $('#jsonContent');
  const copyBtn = $('#jsonCopy');
  const copyStatus = $('#jsonCopyStatus');

  if (!modal || !content) return;

  // モーダルの静的ラベルに翻訳を適用
  try { if (typeof applyTranslations === 'function') applyTranslations(modal, true); } catch (e) { }

  // JSONを整形して表示（クライアント専用フィールドは除外）
  const jsonText = JSON.stringify(eventForJsonDisplay(event), null, 2);
  content.textContent = jsonText;

  // モーダル表示
  modal.hidden = false;

  // 閉じるボタンセットアップ
  if (closeBtn) {
    closeBtn.onclick = function () {
      modal.hidden = true;
    };
  }

  // コピー機能セットアップ
  if (copyBtn) {
    copyBtn.onclick = async function () {
      try {
        await navigator.clipboard.writeText(jsonText);
        if (copyStatus) {
          copyStatus.textContent = t('json.copy.done');
          setTimeout(() => {
            copyStatus.textContent = '';
          }, 2000);
        }
      } catch (e) {
        if (copyStatus) {
          copyStatus.textContent = t('json.copy.failed');
          setTimeout(() => {
            copyStatus.textContent = '';
          }, 2000);
        }
      }
    };
  }

  // 背景クリックで閉じる
  modal.onclick = function (e) {
    if (e.target === modal) {
      modal.hidden = true;
    }
  };
}

/**
 * JSONモーダルの閉じるボタンセットアップ
 */
export function setupJsonModalClose() {
  const modal = $('#jsonModal');
  const closeBtn = $('#jsonClose');

  if (closeBtn && modal) {
    closeBtn.onclick = function () {
      modal.hidden = true;
    };
  }
}
