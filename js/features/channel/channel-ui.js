import { fetchPublicChatsEntries, togglePublicChatMembership } from './public-chats.js';
import { fetchChannelMetadata, extractChannelProfileFields, buildChannelEmbedContext, shortenChannelEventId } from './channel.js';
import { subscribeChannelFeed, unsubscribeChannelFeed, unsubscribeAllChannelFeeds } from './channel-feed.js';
import {
  mergeChannelMembership,
  joinChannelLocally,
  leaveChannelLocally,
  pruneExcludedPublicChatIds,
  getCustomJoinedChannels,
} from './channel-membership.js';
import { searchChannels, resolveChannelRootIdInput } from './channel-search.js';
import { openEhagakiWithChannel } from '../post/postlink.js';
import { setChannelTarget, hideComposerForUnselectedChannel, revealComposerForSelectedChannel } from '../post/composer.js';
import { showConfirmModal } from '../../ui/modals/modals.js';
import { t } from '../../utils/i18n.js';

const CHANNEL_LIST_CACHE_KEY = 'nokakoi_public_chats_cache_v1';
const LAST_ACTIVE_CHANNEL_KEY = 'last_active_channel_root_id';

function scopedUiKey(base) {
  const pk = getPubkey();
  return pk ? `${base}.${String(pk).toLowerCase()}` : base;
}

function migrateUnscopedUiKey(base) {
  const pk = getPubkey();
  if (!pk) return;
  const scoped = `${base}.${String(pk).toLowerCase()}`;
  try {
    if (localStorage.getItem(scoped) != null) return;
    const legacy = localStorage.getItem(base);
    if (legacy == null) return;
    localStorage.setItem(scoped, legacy);
  } catch (_e) { }
}

let _activeRootId = null;
let _activeChannelContext = null;
let _activeChannelProfile = null;
let _stateRef = null;
let _containerEl = null;
let _settingsManagerRef = null;
let _ehagakiBound = false;
let _feedPaused = false;
let _lastPublicRootIds = [];
let _searchSeq = 0;
let _publicChatsListenerBound = false;

/**
 * チャンネルビューの初期化
 */
export function initChannelView(container, state, settingsManager = null) {
  if (!container) return;
  _containerEl = container;
  _stateRef = state;
  _settingsManagerRef = settingsManager;

  container.innerHTML = `
    <div class="channel-portal-wrapper">
      <div class="channel-sidebar" id="channelSidebar">
        <div class="channel-sidebar-header">
          <h3>${t('tabs.channels') || 'チャンネル'}</h3>
          <div class="channel-sidebar-actions">
            <button type="button" id="channelEditListBtn" class="secondary small" title="${t('channel.edit_list') || '参加リストを編集'}">${t('channel.edit') || '編集'}</button>
            <button type="button" id="channelRefreshBtn" class="secondary small" title="${t('channel.fetch') || '取得'}">${t('channel.fetch') || '取得'}</button>
          </div>
        </div>
        <div class="channel-join-box">
          <input type="text" id="channelSearchInput" placeholder="${t('channel.search_placeholder') || 'キーワードで検索（空で直近一覧）'}" class="channel-id-input" autocomplete="off">
          <button type="button" id="channelSearchBtn" class="secondary small">${t('channel.search') || '検索'}</button>
        </div>
        <div class="channel-search-results d-none" id="channelSearchResults"></div>
        <details class="channel-id-advanced">
          <summary>${t('channel.add_by_id') || 'IDで追加'}</summary>
          <div class="channel-join-box channel-join-box-nested">
            <input type="text" id="channelIdInput" placeholder="${t('channel.id_placeholder') || 'hex / nevent'}" class="channel-id-input" autocomplete="off">
            <button type="button" id="channelJoinBtn" class="secondary small">${t('channel.add') || '追加'}</button>
          </div>
        </details>
        <div class="channel-list-status muted text-sm" id="channelListStatus">${t('channel.loading') || '読み込み中...'}</div>
        <div class="channel-list" id="channelList"></div>
      </div>
      <div class="channel-main-view" id="channelMainView">
        <div class="channel-empty-state" id="channelEmptyState">
          <p class="muted">${t('channel.empty_hint') || 'チャンネルを選択するか、検索して参加してください。'}</p>
        </div>
        <div class="channel-chat-container d-none" id="channelChatContainer">
          <div class="channel-chat-header">
            <button type="button" id="channelBackToListBtn" class="secondary small channel-back-btn">${t('channel.back') || '戻る'}</button>
            <div class="channel-header-info">
              <div class="channel-title-row">
                <h4 id="channelTitle">${t('tabs.channels') || 'チャンネル'}</h4>
                <div class="channel-title-actions">
                  <button type="button" id="channelInfoBtn" class="secondary micro-btn" title="${t('channel.info.open') || '情報'}">ℹ</button>
                  <button type="button" id="channelMetaEditBtn" class="secondary micro-btn d-none" title="${t('channel.meta.edit') || '編集'}">${t('channel.meta.edit') || '編集'}</button>
                </div>
              </div>
            </div>
          </div>
          <div class="channel-messages" id="channelMessages"></div>
        </div>
      </div>
    </div>
  `;

  bindEhagakiButtonIntegration();
  bindPublicChatsUpdatedListener();

  const refreshBtn = container.querySelector('#channelRefreshBtn');
  if (refreshBtn) refreshBtn.onclick = () => loadChannelList();

  const editListBtn = container.querySelector('#channelEditListBtn');
  if (editListBtn) {
    editListBtn.onclick = () => {
      const st = getState();
      if (!st || !getPubkey()) return;
      import('./public-chats-editor.js').then((mod) => {
        if (mod && typeof mod.openPublicChatsEditor === 'function') {
          mod.openPublicChatsEditor(st, {
            onSaved: () => { loadChannelList(); },
          });
        }
      }).catch((err) => {
        console.warn('[channel-ui] public-chats-editor load failed', err);
      });
    };
  }

  const metaEditBtn = container.querySelector('#channelMetaEditBtn');
  if (metaEditBtn) {
    metaEditBtn.onclick = () => {
      if (!_activeRootId) return;
      const st = getState();
      if (!st || !getPubkey()) return;
      import('./channel-meta-editor.js').then((mod) => {
        if (mod && typeof mod.openChannelMetaEditor === 'function') {
          mod.openChannelMetaEditor(st, _activeRootId, {
            onSaved: ({ rootId, profile }) => {
              if (_activeRootId !== rootId) return;
              _activeChannelProfile = profile || null;
              const titleEl = _containerEl && _containerEl.querySelector('#channelTitle');
              const name = (profile && profile.name) || shortenChannelEventId(rootId);
              if (titleEl) titleEl.textContent = `# ${name}`;
              applyChannelComposerTarget(rootId, { name, relays: profile && profile.relays });
              loadChannelList();
            },
          });
        }
      }).catch((err) => {
        console.warn('[channel-ui] channel-meta-editor load failed', err);
      });
    };
  }

  const infoBtn = container.querySelector('#channelInfoBtn');
  if (infoBtn) {
    infoBtn.onclick = () => openChannelInfoModal();
  }

  bindChannelInfoModal();

  const searchBtn = container.querySelector('#channelSearchBtn');
  const searchInput = container.querySelector('#channelSearchInput');
  if (searchBtn) searchBtn.onclick = () => handleChannelSearch();
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleChannelSearch();
      }
    });
  }

  const joinBtn = container.querySelector('#channelJoinBtn');
  if (joinBtn) joinBtn.onclick = handleJoinChannelById;

  loadChannelList();
}

function bindChannelInfoModal() {
  const modal = document.getElementById('channelInfoModal');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';
  const close = () => { modal.hidden = true; };
  const closeBtn = document.getElementById('channelInfoClose');
  const okBtn = document.getElementById('channelInfoOkBtn');
  if (closeBtn) closeBtn.onclick = close;
  if (okBtn) okBtn.onclick = close;
  modal.onclick = (e) => {
    if (e.target === modal) close();
  };
}

function isLocalOnlyChannel(rootId) {
  const id = rootId ? String(rootId).toLowerCase() : '';
  if (!id) return false;
  if (_lastPublicRootIds.includes(id)) return false;
  return getCustomJoinedChannels().includes(id);
}

function openChannelInfoModal() {
  const modal = document.getElementById('channelInfoModal');
  const contentEl = document.getElementById('channelInfoContent');
  const titleEl = document.getElementById('channelInfoTitle');
  if (!modal || !contentEl || !_activeRootId) return;

  const profile = _activeChannelProfile || {};
  const name = profile.name || shortenChannelEventId(_activeRootId);
  if (titleEl) titleEl.textContent = `# ${name}`;

  const about = (profile.about && String(profile.about).trim()) || '';
  const picture = (profile.picture && String(profile.picture).trim()) || '';
  const relays = Array.isArray(profile.relays) ? profile.relays : [];
  const localOnly = isLocalOnlyChannel(_activeRootId);

  contentEl.innerHTML = `
    <div class="channel-info-section">
      <div class="muted text-sm mb-4">${t('channel.info.id') || 'チャンネルID'}</div>
      <div class="channel-info-id-row">
        <code class="channel-info-id" id="channelInfoIdText">${escapeText(_activeRootId)}</code>
        <button type="button" class="secondary small" id="channelInfoCopyIdBtn">${t('channel.info.copy_id') || 'コピー'}</button>
      </div>
      ${localOnly ? `<div class="channel-info-local-notice muted">${t('channel.info.local_notice') || 'kind:10005 に未反映（この端末のみの参加です）'}</div>` : ''}
    </div>
    <div class="channel-info-section mt-16">
      <div class="muted text-sm mb-4">${t('channel.meta.about') || '説明'}</div>
      <div class="text-sm">${about ? escapeText(about) : `<span class="muted">${t('channel.info.empty_about') || '説明はありません'}</span>`}</div>
    </div>
    ${picture ? `
    <div class="channel-info-section mt-16">
      <div class="muted text-sm mb-4">${t('channel.meta.picture') || '画像URL'}</div>
      <div class="text-sm" style="word-break:break-all"><a href="${escapeText(picture)}" target="_blank" rel="noopener noreferrer">${escapeText(picture)}</a></div>
    </div>` : ''}
    <div class="channel-info-section mt-16">
      <div class="muted text-sm mb-4">${t('channel.meta.relays') || 'リレー'}</div>
      ${relays.length
        ? `<div class="channel-relays-list">${relays.map((r) => `<span class="channel-relay-badge">📡 ${escapeText(r)}</span>`).join(' ')}</div>`
        : `<div class="muted text-sm">${t('channel.info.empty_relays') || 'リレー指定はありません'}</div>`}
    </div>
  `;

  const copyBtn = contentEl.querySelector('#channelInfoCopyIdBtn');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(_activeRootId);
        copyBtn.textContent = t('channel.info.copied') || 'コピーしました';
        setTimeout(() => {
          if (copyBtn.isConnected) copyBtn.textContent = t('channel.info.copy_id') || 'コピー';
        }, 1500);
      } catch (_e) {
        // フォールバック: 選択状態にする
        const idEl = contentEl.querySelector('#channelInfoIdText');
        if (idEl && window.getSelection) {
          const range = document.createRange();
          range.selectNodeContents(idEl);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    };
  }

  modal.hidden = false;
}

function bindPublicChatsUpdatedListener() {
  if (_publicChatsListenerBound || typeof window === 'undefined') return;
  _publicChatsListenerBound = true;
  window.addEventListener('publicChatsUpdated', () => {
    loadChannelList();
  });
}

function getState() {
  return _stateRef || (typeof window !== 'undefined' ? window.__nostrState : null);
}

function getPubkey() {
  const state = getState();
  return (state && state.pubkey) || (typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : null);
}

function notifyLocalFallback() {
  try {
    const statusEl = _containerEl && _containerEl.querySelector('#channelListStatus');
    if (statusEl) {
      statusEl.textContent = t('channel.publish_failed_local') || 'リレーへの同期に失敗したため、端末内のみ反映しました';
    }
  } catch (_e) { }
}

/**
 * kind:10005 へ即時同期。失敗時はローカル join/leave にフォールバック
 */
async function syncMembershipToPublicChats(rootId, join) {
  const state = getState();
  const pubkey = getPubkey();
  if (!state || !pubkey) {
    if (join) joinChannelLocally(rootId, { publicRootIds: _lastPublicRootIds });
    else leaveChannelLocally(rootId, { publicRootIds: _lastPublicRootIds });
    return { ok: false, localOnly: true };
  }

  try {
    const res = await togglePublicChatMembership(state, rootId, { join: !!join });
    if (res && res.ok) {
      if (join) {
        // 既に 10005 にある場合も除外解除・custom 整理
        joinChannelLocally(rootId, { publicRootIds: [..._lastPublicRootIds, rootId] });
      } else {
        leaveChannelLocally(rootId, { publicRootIds: [] });
      }
      return { ok: true, localOnly: false };
    }
  } catch (err) {
    console.warn('[channel-ui] togglePublicChatMembership failed', err);
  }

  if (join) joinChannelLocally(rootId, { publicRootIds: _lastPublicRootIds });
  else leaveChannelLocally(rootId, { publicRootIds: _lastPublicRootIds });
  notifyLocalFallback();
  return { ok: false, localOnly: true };
}

function getCachedChannelEntries() {
  try {
    migrateUnscopedUiKey(CHANNEL_LIST_CACHE_KEY);
    const raw = localStorage.getItem(scopedUiKey(CHANNEL_LIST_CACHE_KEY));
    return raw ? JSON.parse(raw) : null;
  } catch (_e) { return null; }
}

function saveCachedChannelEntries(entries) {
  try {
    localStorage.setItem(scopedUiKey(CHANNEL_LIST_CACHE_KEY), JSON.stringify(entries));
  } catch (_e) {}
}

function rememberPublicRootIds(entries, options = {}) {
  _lastPublicRootIds = (entries || [])
    .map(e => (e && e.rootId ? String(e.rootId).toLowerCase() : null))
    .filter(Boolean);
  if (options.prune) {
    pruneExcludedPublicChatIds(_lastPublicRootIds, { allowEmpty: options.allowEmpty === true });
  }
}

/**
 * チャンネルリスト項目の描画ヘルパー
 */
function renderChannelListItems(listEl, statusEl, publicEntries, options = {}) {
  if (!listEl) return;
  rememberPublicRootIds(publicEntries, options);
  const items = mergeChannelMembership(publicEntries);

  if (statusEl) {
    statusEl.textContent = items.length
      ? (t('channel.joined_count') || '参加中: {count}件').replace('{count}', String(items.length))
      : (t('channel.none_joined') || '参加中のチャンネルがありません');
  }

  listEl.innerHTML = '';
  items.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'channel-list-item-row';

    const itemBtn = document.createElement('button');
    itemBtn.type = 'button';
    itemBtn.className = 'channel-list-item';
    if (_activeRootId === entry.rootId) itemBtn.classList.add('active');
    itemBtn.dataset.rootId = entry.rootId;

    const label = entry.label || shortenChannelEventId(entry.rootId);
    const localBadge = entry.source === 'custom'
      ? `<span class="channel-item-badge channel-item-badge--local" title="${t('channel.info.local_notice') || ''}">${t('channel.local_only') || '端末のみ'}</span>`
      : '';
    itemBtn.innerHTML = `
      <span class="channel-item-name"># ${label}</span>
      <span class="channel-item-badges">
        ${entry.isPrivate ? '<span class="channel-item-badge">🔒</span>' : ''}
        ${localBadge}
      </span>
    `;
    itemBtn.onclick = () => selectChannel(entry.rootId);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'channel-list-remove secondary micro-btn';
    removeBtn.title = t('channel.leave') || 'リストから削除';
    removeBtn.setAttribute('aria-label', t('channel.leave') || 'リストから削除');
    removeBtn.textContent = '×';
    removeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleLeaveChannel(entry.rootId);
    };

    row.appendChild(itemBtn);
    row.appendChild(removeBtn);
    listEl.appendChild(row);

    if (!entry.label) {
      fetchChannelMetadata(_stateRef, entry.rootId).then(meta => {
        if (meta && meta.label) {
          const nameSpan = itemBtn.querySelector('.channel-item-name');
          if (nameSpan) nameSpan.textContent = `# ${meta.label}`;
        }
      }).catch(() => {});
    }
  });

  if (_activeRootId && !items.some(i => i.rootId === _activeRootId)) {
    returnToChannelList({ forgetLast: true });
  } else if (!_activeRootId) {
    hideComposerForUnselectedChannel();
  }
}

/**
 * 一覧画面へ戻る。投稿先チャンネルはクリアし、投稿窓は出さない。
 */
function returnToChannelList(options = {}) {
  unsubscribeAllChannelFeeds();
  _activeRootId = null;
  _activeChannelContext = null;
  _activeChannelProfile = null;
  if (options.forgetLast) {
    try { localStorage.removeItem(scopedUiKey(LAST_ACTIVE_CHANNEL_KEY)); } catch (_e) {}
  }

  if (!_containerEl) {
    hideComposerForUnselectedChannel();
    return;
  }

  const wrapper = _containerEl.querySelector('.channel-portal-wrapper');
  if (wrapper) wrapper.classList.remove('show-chat');
  const emptyState = _containerEl.querySelector('#channelEmptyState');
  const chatContainer = _containerEl.querySelector('#channelChatContainer');
  const msgsEl = _containerEl.querySelector('#channelMessages');
  if (emptyState) emptyState.classList.remove('d-none');
  if (chatContainer) chatContainer.classList.add('d-none');
  if (msgsEl) {
    msgsEl.dataset.channelRootId = '';
    msgsEl.__channelFeedGen = (msgsEl.__channelFeedGen || 0) + 1;
    msgsEl.innerHTML = '';
  }

  const items = _containerEl.querySelectorAll('.channel-list-item');
  items.forEach(it => it.classList.remove('active'));

  hideComposerForUnselectedChannel();
}

function clearActiveChannelView() {
  returnToChannelList({ forgetLast: true });
}

/**
 * アカウント切替・フルリロード時に前アカウントの一覧／フィードを捨てて再読込
 */
export function resetChannelViewForAccount(state = null) {
  if (state) _stateRef = state;
  _searchSeq += 1;
  _lastPublicRootIds = [];
  returnToChannelList({ forgetLast: false });
  if (_containerEl) {
    const resultsEl = _containerEl.querySelector('#channelSearchResults');
    if (resultsEl) {
      resultsEl.classList.add('d-none');
      resultsEl.innerHTML = '';
    }
    loadChannelList();
  }
}

if (typeof window !== 'undefined' && !window.__nokakoiChannelBackBound) {
  window.__nokakoiChannelBackBound = true;
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('#channelBackToListBtn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    returnToChannelList();
  }, true);
}

function isChannelsTabActive() {
  try {
    const activeTabBtn = document.querySelector('.tabs .tab.active');
    return !!(activeTabBtn && activeTabBtn.dataset.tab === 'channels');
  } catch (_e) {
    return false;
  }
}

function applyChannelComposerTarget(rootId, info = {}) {
  if (!rootId || _feedPaused || _activeRootId !== rootId || !isChannelsTabActive()) return;
  const wrapper = _containerEl && _containerEl.querySelector('.channel-portal-wrapper');
  if (!wrapper || !wrapper.classList.contains('show-chat')) return;
  setChannelTarget({ rootId, name: info.name || shortenChannelEventId(rootId), relays: info.relays });
  revealComposerForSelectedChannel();
}

/**
 * チャンネルタブがアクティブになった際の投稿窓状態同期
 */
export function syncChannelComposerState() {
  if (!isChannelsTabActive()) return;
  const rootId = _activeRootId;
  if (rootId) {
    fetchChannelMetadata(getState(), rootId).then(meta => {
      const profile = extractChannelProfileFields(meta.rootEvent, meta.metaEvent);
      const name = profile.name || meta.label || shortenChannelEventId(rootId);
      applyChannelComposerTarget(rootId, { name, relays: profile.relays });
    }).catch(() => {
      applyChannelComposerTarget(rootId, { name: shortenChannelEventId(rootId) });
    });
  } else {
    hideComposerForUnselectedChannel();
  }
}

export function pauseChannelSubscriptions() {
  _feedPaused = true;
  if (_activeRootId) {
    unsubscribeChannelFeed(_activeRootId);
  }
}

export function resumeChannelSubscriptions() {
  _feedPaused = false;
  if (!_activeRootId || !_containerEl) return;
  const wrapper = _containerEl.querySelector('.channel-portal-wrapper');
  if (!wrapper || !wrapper.classList.contains('show-chat')) return;
  const msgsEl = _containerEl.querySelector('#channelMessages');
  if (msgsEl) {
    subscribeChannelFeed(_activeRootId, getState(), msgsEl, _settingsManagerRef);
  }
}

/**
 * NIP-51 Public chats (kind 10005) および追加されたチャンネルリストをロード
 */
export async function loadChannelList() {
  if (!_containerEl) return;
  const listEl = _containerEl.querySelector('#channelList');
  const statusEl = _containerEl.querySelector('#channelListStatus');
  if (!listEl) return;

  const cached = getCachedChannelEntries();
  if (cached && Array.isArray(cached) && cached.length) {
    renderChannelListItems(listEl, statusEl, cached, { prune: false });
  } else {
    if (statusEl) statusEl.textContent = t('channel.loading_list') || 'チャンネル一覧を読み込み中...';
    // キャッシュが空でも手動参加分は描画
    renderChannelListItems(listEl, statusEl, [], { prune: false });
  }

  try {
    const state = getState();
    const pubkey = getPubkey();
    if (state && pubkey) {
      const result = await fetchPublicChatsEntries(state, pubkey, { maxEntries: 40 });
      if (result && Array.isArray(result.entries)) {
        saveCachedChannelEntries(result.entries);
        // event があるときだけ除外を prune（空の 10005 なら allowEmpty で刈り取り可）
        renderChannelListItems(listEl, statusEl, result.entries, {
          prune: !!result.event,
          allowEmpty: !!result.event,
        });
      }
    }
  } catch (err) {
    console.warn('[channel-ui] fetchPublicChatsEntries error', err);
    if (!cached || !cached.length) {
      if (statusEl) statusEl.textContent = t('channel.load_failed') || 'チャンネル一覧の取得に失敗しました';
    }
  }
}

async function handleChannelSearch() {
  if (!_containerEl) return;
  const inputEl = _containerEl.querySelector('#channelSearchInput');
  const resultsEl = _containerEl.querySelector('#channelSearchResults');
  if (!inputEl || !resultsEl) return;

  const query = (inputEl.value || '').trim();
  const seq = ++_searchSeq;
  resultsEl.classList.remove('d-none');
  resultsEl.innerHTML = `<div class="muted text-sm p-8">${t('channel.searching') || '検索中...'}</div>`;

  try {
    const { results, mode } = await searchChannels(getState(), query, { limit: 20 });
    if (seq !== _searchSeq) return;

    if (!results.length) {
      const emptyMsg = mode === 'browse'
        ? (t('channel.browse_empty') || '直近のチャンネルを取得できませんでした。IDで追加するか、キーワードを変えてください。')
        : (t('channel.search_empty') || '該当するチャンネルが見つかりません');
      resultsEl.innerHTML = `<div class="muted text-sm p-8">${emptyMsg}</div>`;
      return;
    }

    const header = document.createElement('div');
    header.className = 'muted text-xs p-8 channel-search-header';
    header.textContent = mode === 'browse'
      ? (t('channel.browse_header') || '直近のチャンネル')
      : (t('channel.search_header') || '検索結果');

    resultsEl.innerHTML = '';
    resultsEl.appendChild(header);
    results.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'channel-search-result-item';

      const meta = document.createElement('div');
      meta.className = 'channel-search-result-meta';
      meta.innerHTML = `
        <div class="channel-search-result-name"># ${escapeText(item.name || shortenChannelEventId(item.rootId))}</div>
        <div class="muted text-xs">${escapeText(item.about || shortenChannelEventId(item.rootId))}</div>
      `;

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'secondary small';
      addBtn.textContent = t('channel.add') || '追加';
      addBtn.onclick = async () => {
        addBtn.disabled = true;
        try {
          await syncMembershipToPublicChats(item.rootId, true);
          resultsEl.classList.add('d-none');
          resultsEl.innerHTML = '';
          inputEl.value = '';
          await loadChannelList();
          selectChannel(item.rootId);
        } finally {
          addBtn.disabled = false;
        }
      };

      row.appendChild(meta);
      row.appendChild(addBtn);
      resultsEl.appendChild(row);
    });
  } catch (err) {
    if (seq !== _searchSeq) return;
    console.warn('[channel-ui] search failed', err);
    resultsEl.innerHTML = `<div class="text-danger text-sm p-8">${t('channel.search_failed') || '検索に失敗しました'}</div>`;
  }
}

function escapeText(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bindEhagakiButtonIntegration() {
  if (_ehagakiBound) return;
  _ehagakiBound = true;
  const btn = document.getElementById('ehagakiBtn');
  if (!btn) return;
  btn.addEventListener('click', async (e) => {
    const activeTabBtn = document.querySelector('.tabs .tab.active');
    if (activeTabBtn && activeTabBtn.dataset.tab === 'channels' && _activeRootId) {
      try {
        let ctx = _activeChannelContext;
        if (!ctx) {
          ctx = await buildChannelEmbedContext(getState(), _activeRootId);
        }
        if (ctx) {
          e.preventDefault();
          e.stopPropagation();
          await openEhagakiWithChannel(ctx);
        }
      } catch (err) {
        console.warn('[channel-ui] Failed to open ehagaki with channel context', err);
      }
    }
  }, true);
}

function updateOwnerMetaEditButton(rootEvent) {
  if (!_containerEl) return;
  const btn = _containerEl.querySelector('#channelMetaEditBtn');
  if (!btn) return;
  const myPubkey = getPubkey();
  const isOwner = !!(
    myPubkey
    && rootEvent
    && typeof rootEvent.pubkey === 'string'
    && rootEvent.pubkey.toLowerCase() === myPubkey.toLowerCase()
  );
  btn.classList.toggle('d-none', !isOwner);
}

/**
 * フィード等の外部からチャンネルを開く（一覧に無ければ端末のみ参加として追加）
 */
export async function openChannelFromExternal(rootId, state = null) {
  const id = rootId ? String(rootId).trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(id)) return false;

  if (state) _stateRef = state;

  const feedChan = document.getElementById('feed-channels');
  if (!_containerEl && feedChan) {
    initChannelView(feedChan, getState(), _settingsManagerRef);
  }
  if (!_containerEl) return false;

  const alreadyListed = _lastPublicRootIds.includes(id)
    || getCustomJoinedChannels().includes(id);

  if (!alreadyListed) {
    joinChannelLocally(id, { publicRootIds: _lastPublicRootIds });
  }

  // タブ切替直後でもチャット面を出す
  await selectChannel(id);
  loadChannelList().catch(() => {});
  return true;
}

/**
 * チャンネルの選択・表示切替
 */
export async function selectChannel(rootId) {
  if (!rootId || !_containerEl) return;

  unsubscribeAllChannelFeeds();

  _activeRootId = rootId;
  _feedPaused = false;
  _activeChannelContext = null;
  _activeChannelProfile = null;
  try { localStorage.setItem(scopedUiKey(LAST_ACTIVE_CHANNEL_KEY), rootId); } catch (_e) {}

  buildChannelEmbedContext(getState(), rootId).then(ctx => {
    _activeChannelContext = ctx;
  }).catch(() => { _activeChannelContext = null; });

  const items = _containerEl.querySelectorAll('.channel-list-item');
  items.forEach(it => it.classList.toggle('active', it.dataset.rootId === rootId));

  const wrapper = _containerEl.querySelector('.channel-portal-wrapper');
  if (wrapper) wrapper.classList.add('show-chat');

  const emptyState = _containerEl.querySelector('#channelEmptyState');
  const chatContainer = _containerEl.querySelector('#channelChatContainer');
  if (emptyState) emptyState.classList.add('d-none');
  if (chatContainer) chatContainer.classList.remove('d-none');

  const titleEl = _containerEl.querySelector('#channelTitle');
  const msgsEl = _containerEl.querySelector('#channelMessages');
  updateOwnerMetaEditButton(null);

  if (titleEl) titleEl.textContent = `# ${shortenChannelEventId(rootId)}`;
  if (msgsEl) {
    msgsEl.dataset.channelRootId = rootId;
    msgsEl.__channelFeedGen = (msgsEl.__channelFeedGen || 0) + 1;
    msgsEl.innerHTML = `<div class="muted p-12 text-center">${t('channel.loading_messages') || 'メッセージを読み込み中...'}</div>`;
  }

  applyChannelComposerTarget(rootId, { name: shortenChannelEventId(rootId) });

  fetchChannelMetadata(getState(), rootId).then(meta => {
    if (_activeRootId !== rootId) return;
    const profile = extractChannelProfileFields(meta.rootEvent, meta.metaEvent);
    _activeChannelProfile = profile;
    const name = profile.name || meta.label || shortenChannelEventId(rootId);
    if (titleEl) titleEl.textContent = `# ${name}`;
    updateOwnerMetaEditButton(meta.rootEvent);
    applyChannelComposerTarget(rootId, { name, relays: profile.relays });
  }).catch(() => {});

  if (!_feedPaused) {
    subscribeChannelFeed(rootId, getState(), msgsEl, _settingsManagerRef);
  }
}

async function handleJoinChannelById() {
  if (!_containerEl) return;
  const inputEl = _containerEl.querySelector('#channelIdInput');
  if (!inputEl) return;

  const raw = (inputEl.value || '').trim();
  if (!raw) return;

  const rootId = resolveChannelRootIdInput(raw);
  if (!rootId) {
    alert(t('channel.invalid_id') || '有効なチャンネル ID (64桁 hex / nevent) を入力してください');
    return;
  }

  inputEl.value = '';
  await syncMembershipToPublicChats(rootId, true);
  await loadChannelList();
  selectChannel(rootId);
}

function resolveChannelDisplayName(rootId) {
  if (!rootId || !_containerEl) return shortenChannelEventId(rootId);

  // リスト上の表示名
  try {
    const itemBtn = _containerEl.querySelector(`.channel-list-item[data-root-id="${rootId}"] .channel-item-name`);
    if (itemBtn) {
      const text = (itemBtn.textContent || '').replace(/^#\s*/, '').trim();
      if (text && text !== shortenChannelEventId(rootId)) return text;
      if (text) return text;
    }
  } catch (_e) {}

  // 選択中ヘッダのタイトル
  if (_activeRootId === rootId) {
    try {
      const titleEl = _containerEl.querySelector('#channelTitle');
      const text = (titleEl && titleEl.textContent || '').replace(/^#\s*/, '').trim();
      if (text) return text;
    } catch (_e) {}
  }

  return shortenChannelEventId(rootId);
}

async function handleLeaveChannel(rootId) {
  if (!rootId) return;

  let displayName = resolveChannelDisplayName(rootId);
  try {
    const meta = await fetchChannelMetadata(getState(), rootId);
    const profile = extractChannelProfileFields(meta && meta.rootEvent, meta && meta.metaEvent);
    displayName = (profile && profile.name) || (meta && meta.label) || displayName;
  } catch (_e) {}

  const title = t('channel.leave_title') || 'チャンネルを削除';
  const message = (t('channel.leave_confirm') || '「{name}」を参加リストから削除しますか？')
    .replace('{name}', displayName);

  showConfirmModal(title, message, async () => {
    await syncMembershipToPublicChats(rootId, false);
    if (_activeRootId === rootId) {
      clearActiveChannelView();
    }
    await loadChannelList();
  });
}
