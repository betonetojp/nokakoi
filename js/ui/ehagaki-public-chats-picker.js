// ============================================================================
// eHagaki モーダル右下: kind:10005 Public chats ピッカー
// ============================================================================

import { t } from '../utils/i18n.js';
import { escapeHtml } from '../utils/utils.js';
import { fetchPublicChatsEntries } from '../features/channel/public-chats.js';
import { applyEhagakiChannelContext } from '../features/post/postlink.js';

let __pickerInstalled = false;
let __listLoadedForPubkey = null;
let __loadPromise = null;

function getNostrState() {
  try { return window.__nostrState || null; } catch (e) { return null; }
}

function getLoggedInPubkey() {
  try {
    const pk = localStorage.getItem('pubkey');
    return (typeof pk === 'string' && pk.trim()) ? pk.trim() : null;
  } catch (e) {
    return null;
  }
}

function setPanelStatus(panelEl, message) {
  if (!panelEl) return;
  const statusEl = panelEl.querySelector('.ehagaki-public-chats-status');
  const listEl = panelEl.querySelector('.ehagaki-public-chats-list');
  if (statusEl) {
    statusEl.hidden = !message;
    statusEl.textContent = message || '';
  }
  if (listEl && message) {
    listEl.innerHTML = '';
  }
}

function setPanelNotice(panelEl, message) {
  if (!panelEl) return;
  let noticeEl = panelEl.querySelector('.ehagaki-public-chats-notice');
  if (!noticeEl) {
    noticeEl = document.createElement('div');
    noticeEl.className = 'ehagaki-public-chats-notice muted';
    const listEl = panelEl.querySelector('.ehagaki-public-chats-list');
    if (listEl) panelEl.insertBefore(noticeEl, listEl);
    else panelEl.appendChild(noticeEl);
  }
  if (message) {
    noticeEl.hidden = false;
    noticeEl.textContent = message;
  } else {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
  }
}

function renderEntries(panelEl, entries) {
  const listEl = panelEl.querySelector('.ehagaki-public-chats-list');
  const statusEl = panelEl.querySelector('.ehagaki-public-chats-status');
  if (!listEl) return;

  if (statusEl) {
    statusEl.hidden = true;
    statusEl.textContent = '';
  }

  if (!entries || entries.length === 0) {
    setPanelStatus(panelEl, t('ehagaki.public_chats.empty') || '参加チャンネルがありません');
    return;
  }

  const privateMark = escapeHtml(t('ehagaki.public_chats.private_mark') || '非公開');
  listEl.innerHTML = entries.map((entry) => {
    const label = escapeHtml(entry.label || entry.rootId);
    const rootId = escapeHtml(entry.rootId);
    const priv = entry.isPrivate
      ? '<span class="ehagaki-public-chats-private-badge">' + privateMark + '</span>'
      : '';
    return '<button type="button" class="ehagaki-public-chats-item' + (entry.isPrivate ? ' is-private' : '') + '" data-root-id="' + rootId + '">' +
      '<span class="ehagaki-public-chats-item-label">' + label + '</span>' +
      priv +
      '</button>';
  }).join('');

  entries.forEach((entry) => {
    const btn = listEl.querySelector('.ehagaki-public-chats-item[data-root-id="' + entry.rootId + '"]');
    if (!btn) return;
    btn._channelContext = entry.channel;
  });
}

async function loadPublicChats(panelEl, force = false) {
  const pubkey = getLoggedInPubkey();
  if (!pubkey) {
    setPanelStatus(panelEl, t('ehagaki.public_chats.login_required') || 'ログインが必要です');
    setPanelNotice(panelEl, '');
    return;
  }

  if (!force && __listLoadedForPubkey === pubkey && panelEl.querySelector('.ehagaki-public-chats-item')) {
    return;
  }

  if (__loadPromise) {
    await __loadPromise;
    return;
  }

  setPanelStatus(panelEl, t('ehagaki.public_chats.loading') || '読み込み中…');
  setPanelNotice(panelEl, '');

  __loadPromise = (async () => {
    try {
      const state = getNostrState();
      if (!state) {
        setPanelStatus(panelEl, t('ehagaki.public_chats.fetch_failed') || '取得に失敗しました');
        return;
      }
      const result = await fetchPublicChatsEntries(state, pubkey);
      __listLoadedForPubkey = pubkey;
      renderEntries(panelEl, result.entries || []);
      if (result.privateDecryptAttempted && !result.privateDecryptOk) {
        setPanelNotice(
          panelEl,
          t('ehagaki.public_chats.decrypt_failed') || '非公開リストの復号に失敗しました（公開分のみ表示）',
        );
      } else {
        setPanelNotice(panelEl, '');
      }
    } catch (e) {
      console.warn('[PublicChats] 取得に失敗', e);
      setPanelStatus(panelEl, t('ehagaki.public_chats.fetch_failed') || '取得に失敗しました');
    } finally {
      __loadPromise = null;
    }
  })();

  await __loadPromise;
}

function closePanel(fabBtn, panelEl) {
  if (panelEl) panelEl.hidden = true;
  if (fabBtn) fabBtn.setAttribute('aria-expanded', 'false');
}

function openPanel(fabBtn, panelEl) {
  if (panelEl) panelEl.hidden = false;
  if (fabBtn) fabBtn.setAttribute('aria-expanded', 'true');
  loadPublicChats(panelEl, false);
}

/**
 * eHagaki モーダル内の Public chats FAB / パネルを初期化
 */
export function setupEhagakiPublicChatsPicker() {
  const modal = document.getElementById('ehagakiModal');
  const fabBtn = document.getElementById('ehagakiPublicChatsBtn');
  const panelEl = document.getElementById('ehagakiPublicChatsPanel');
  if (!modal || !fabBtn || !panelEl) return;

  const refreshLabels = () => {
    try {
      const btnText = t('ehagaki.public_chats.button') || 'チャンネル';
      const headingText = t('ehagaki.public_chats.heading') || '参加チャンネル';
      fabBtn.textContent = btnText;
      fabBtn.setAttribute('aria-label', headingText);
      fabBtn.setAttribute('title', headingText);
      const heading = panelEl.querySelector('.ehagaki-public-chats-heading');
      if (heading) heading.textContent = headingText;
    } catch (e) { }
  };
  refreshLabels();

  if (__pickerInstalled) return;
  __pickerInstalled = true;

  fabBtn.addEventListener('click', (e) => {
    try { e.stopPropagation(); } catch (err) { }
    const pubkey = getLoggedInPubkey();
    if (!pubkey) {
      openPanel(fabBtn, panelEl);
      setPanelStatus(panelEl, t('ehagaki.public_chats.login_required') || 'ログインが必要です');
      return;
    }
    if (panelEl.hidden) openPanel(fabBtn, panelEl);
    else closePanel(fabBtn, panelEl);
  });

  panelEl.addEventListener('click', async (e) => {
    try { e.stopPropagation(); } catch (err) { }
    const item = e.target && e.target.closest ? e.target.closest('.ehagaki-public-chats-item') : null;
    if (!item) return;
    const channel = item._channelContext;
    if (!channel) return;
    item.classList.add('is-busy');
    try {
      closePanel(fabBtn, panelEl);
      await applyEhagakiChannelContext(channel);
    } catch (err) {
      console.warn('[PublicChats] eHagaki への受け渡しに失敗', err);
    } finally {
      try { item.classList.remove('is-busy'); } catch (err) { }
    }
  });

  const refreshBtn = panelEl.querySelector('.ehagaki-public-chats-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', (e) => {
      try { e.stopPropagation(); } catch (err) { }
      loadPublicChats(panelEl, true);
    });
  }

  // モーダル外側クリックでパネルだけ閉じる（モーダル自体の閉じ処理は既存）
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closePanel(fabBtn, panelEl);
  });

  try {
    window.addEventListener('i18n:updated', refreshLabels);
  } catch (e) { }

  // ログイン状態変化でキャッシュを捨てる
  try {
    window.addEventListener('storage', (ev) => {
      if (ev && ev.key === 'pubkey') {
        __listLoadedForPubkey = null;
        closePanel(fabBtn, panelEl);
      }
    });
  } catch (e) { }
}
