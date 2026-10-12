// ============================================================================
// JSONビューアモーダル
// ============================================================================

import { $ } from '../../utils/utils.js';
import { t, applyTranslations } from '../../utils/i18n.js';
import { getEventSeenOn, getReadRelays } from '../../core/relay.js';
import { getNip19 as getNip19Compat } from '../../core/nostr-compat.js';

/**
 * イベントオブジェクトから nevent1... 形式の識別子を生成
 * @param {object} event
 * @param {object} [state]
 * @param {object} [nip19]
 * @returns {string|null}
 */
export function encodeEventToNevent(event, state = null, nip19 = null) {
  if (!event || typeof event !== 'object' || !event.id) return null;
  const nip19Local = nip19 || (typeof window !== 'undefined' && window.__nip19) || getNip19Compat() || null;
  if (!nip19Local) return null;

  try {
    const relays = [];
    try {
      const stateObj = state || (typeof window !== 'undefined' ? window.__nostrState : null);
      const seen = getEventSeenOn ? getEventSeenOn(stateObj, event) : [];
      for (const r of (seen || [])) {
        if (typeof r === 'string' && /^wss?:\/\//i.test(r) && !relays.includes(r)) relays.push(r);
      }
      if (relays.length === 0 && getReadRelays && stateObj && stateObj.relays) {
        for (const r of getReadRelays(stateObj.relays).slice(0, 3)) {
          if (typeof r === 'string' && /^wss?:\/\//i.test(r) && !relays.includes(r)) relays.push(r);
        }
      }
    } catch (_err) { }

    const payload = {
      id: event.id,
      relays: relays.slice(0, 3)
    };
    if (event.pubkey && typeof event.pubkey === 'string') {
      payload.author = event.pubkey;
    }
    if (typeof event.kind === 'number') {
      payload.kind = event.kind;
    }

    if (typeof nip19Local.neventEncode === 'function') {
      return nip19Local.neventEncode(payload);
    }
    if (nip19Local.nevent && typeof nip19Local.nevent.encode === 'function') {
      return nip19Local.nevent.encode(payload);
    }
  } catch (err) {
    console.warn('[json-modal] Failed to encode nevent:', err);
  }
  return null;
}

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
  const neventEl = $('#jsonNevent');
  const copyNeventBtn = $('#jsonCopyNevent');

  if (!modal || !content) return;

  // モーダルの静的ラベルに翻訳を適用
  try { if (typeof applyTranslations === 'function') applyTranslations(modal, true); } catch (e) { }

  // nevent の生成と表示
  const state = (typeof window !== 'undefined' && window.__nostrState) ? window.__nostrState : null;
  const nevent = encodeEventToNevent(event, state);

  if (neventEl) {
    if (nevent) {
      neventEl.textContent = nevent;
      neventEl.title = t('json.copy_nevent') || 'クリックしてコピー';
      neventEl.classList.remove('d-none');
    } else {
      neventEl.textContent = '';
      neventEl.removeAttribute('title');
      neventEl.classList.add('d-none');
    }
  }

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

  // nevent コピーハンドラー
  const handleCopyNevent = async function () {
    if (!nevent) return;
    try {
      await navigator.clipboard.writeText(nevent);
      if (copyStatus) {
        copyStatus.textContent = t('json.copy_nevent.done') || 'neventをコピーしました';
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

  if (copyNeventBtn) {
    copyNeventBtn.classList.toggle('d-none', !nevent);
    copyNeventBtn.onclick = handleCopyNevent;
  }
  if (neventEl) {
    neventEl.onclick = handleCopyNevent;
  }

  // JSONコピー機能セットアップ
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
