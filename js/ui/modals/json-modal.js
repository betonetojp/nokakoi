// ============================================================================
// JSONビューアモーダル
// ============================================================================

import { $ } from '../../utils/utils.js';
import { t, applyTranslations } from '../../utils/i18n.js';
import { getEventSeenOn } from '../../core/relay.js';

function eventForJsonDisplay(event) {
  if (!event || typeof event !== 'object') return event;
  const { __receivedAt, seenOn, ...rest } = event;
  return rest;
}

function renderSeenOnList(event) {
  const listEl = $('#jsonSeenOnList');
  if (!listEl) return;

  listEl.textContent = '';
  const state = (typeof window !== 'undefined' && window.__nostrState) ? window.__nostrState : null;
  const relays = getEventSeenOn(state, event);

  if (!relays.length) {
    const li = document.createElement('li');
    li.className = 'json-seen-on-none muted';
    li.textContent = t('json.relays_seen_on.none');
    listEl.appendChild(li);
    return;
  }

  for (const relay of relays) {
    const li = document.createElement('li');
    li.textContent = relay;
    listEl.appendChild(li);
  }
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
  renderSeenOnList(event);

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
