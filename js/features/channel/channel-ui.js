import { fetchPublicChatsEntries } from './public-chats.js';
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
import { escapeHtml, replaceBadgeEmoji } from '../../utils/utils.js';
import { sanitizeUrlCandidate } from '../../utils/sanitize-url.js';
import { showMediaViewer } from '../../ui/media-viewer.js';
import { displayNameWithUsername, loadProfile } from '../profile/profile.js';
import { getNip19 } from '../../core/nostr-compat.js';
import { linkifyText } from '../../utils/content/linkifier.js';

const CHANNEL_LIST_CACHE_KEY = 'nokakoi_public_chats_cache_v1';
const LAST_ACTIVE_CHANNEL_KEY = 'last_active_channel_root_id';

function normalizePubkey(pubkey) {
  return pubkey ? String(pubkey).trim().toLowerCase() : '';
}

function scopedUiKey(base, pubkey = getPubkey()) {
  const pk = normalizePubkey(pubkey);
  return pk ? `${base}.${pk}` : base;
}

function migrateUnscopedUiKey(base, pubkey = getPubkey()) {
  const pk = normalizePubkey(pubkey);
  if (!pk) return;
  const scoped = `${base}.${pk}`;
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
let _activeRootEvent = null;
let _stateRef = null;
let _containerEl = null;
let _settingsManagerRef = null;
let _ehagakiBound = false;
let _feedPaused = false;
let _lastPublicRootIds = [];
let _searchSeq = 0;
let _channelListLoadGen = 0;
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
            <button type="button" id="channelCreateBtn" class="secondary small" title="${t('channel.create_title') || 'チャンネル新規作成'}">${t('channel.create') || '新規作成'}</button>
            <button type="button" id="channelEditListBtn" class="secondary small" title="${t('channel.edit_list') || '参加リストを編集'}">${t('channel.edit_list_btn') || 'リスト編集'}</button>
          </div>
        </div>
        <div class="channel-list-status-row">
          <div class="channel-list-status muted text-sm" id="channelListStatus">${t('channel.loading') || '読み込み中...'}</div>
          <button type="button" id="channelRefreshBtn" class="secondary micro-btn" title="${t('channel.fetch') || '再読込'}">${t('channel.fetch') || '再読込'}</button>
        </div>
        <div class="channel-list" id="channelList"></div>
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
      </div>
      <div class="channel-main-view" id="channelMainView">
        <div class="channel-empty-state" id="channelEmptyState">
          <p class="muted">${t('channel.empty_hint') || 'チャンネルを選択するか、検索して参加してください。'}</p>
        </div>
        <div class="channel-chat-container d-none" id="channelChatContainer">
          <div class="channel-chat-header">
            <button type="button" id="channelBackToListBtn" class="secondary small channel-back-btn">${t('channel.back_to_list') || t('channel.back') || '一覧'}</button>
            <div class="channel-header-info">
              <div class="channel-title-row">
                <h4 id="channelTitle">${t('tabs.channels') || 'チャンネル'}</h4>
                <div class="channel-title-actions">
                  <button type="button" id="channelMetaEditBtn" class="secondary micro-btn d-none" title="${t('channel.meta.edit') || '編集'}">${t('channel.meta.edit') || '編集'}</button>
                  <button type="button" id="channelInfoBtn" class="secondary micro-btn" title="${t('channel.info.open') || '情報'}">${t('channel.info.open') || '情報'}</button>
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
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      clearChannelSearchResults();
      loadChannelList();
    };
  }

  const createBtn = container.querySelector('#channelCreateBtn');
  if (createBtn) {
    createBtn.onclick = () => {
      const st = getState();
      if (!st || !getPubkey()) return;
      import('./channel-creator.js').then((mod) => {
        if (mod && typeof mod.openChannelCreateModal === 'function') {
          mod.openChannelCreateModal(st, {
            onCreated: async ({ rootId }) => {
              joinChannelLocally(rootId, { publicRootIds: _lastPublicRootIds });
              await selectChannel(rootId);
              loadChannelList().catch(() => {});
            },
          });
        }
      }).catch((err) => {
        console.warn('[channel-ui] channel-creator load failed', err);
      });
    };
  }

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

function openCreatorProfileModal(pubkey) {
  if (!pubkey) return;
  try {
    if (typeof window !== 'undefined' && typeof window.showProfileModalProxy === 'function') {
      window.showProfileModalProxy(pubkey);
    } else {
      import('../profile/profile-modal.js').then((mod) => {
        if (mod && typeof mod.showProfileModal === 'function') {
          mod.showProfileModal(getState(), pubkey, getNip19());
        }
      }).catch(() => {});
    }
  } catch (_e) {}
}

function renderChannelCreatorHtml(creatorPubkey, state) {
  const headerHtml = `<div class="muted text-sm mb-4">${t('channel.info.creator') || '作成者'}</div>`;
  if (!creatorPubkey) {
    return `
      ${headerHtml}
      <div class="muted text-sm" id="channelInfoCreatorStatus">${t('channel.info.loading_creator') || '読み込み中...'}</div>
    `;
  }

  const nip19 = getNip19();
  const names = state
    ? displayNameWithUsername(state, creatorPubkey, nip19, { noTruncate: true })
    : { main: shortenChannelEventId(creatorPubkey), sub: '' };

  let avatarUrl = '';
  if (state && state.profiles) {
    const prof = state.profiles.get(creatorPubkey);
    if (prof && prof.picture) {
      avatarUrl = sanitizeUrlCandidate(prof.picture) || '';
    }
  }

  const avatarHtml = avatarUrl
    ? `<img src="${escapeHtml(avatarUrl)}" alt="avatar" class="channel-info-creator-avatar" loading="lazy" />`
    : `<div class="channel-info-creator-avatar" style="display:flex;align-items:center;justify-content:center;background:var(--border);color:var(--muted);font-size:16px;">👤</div>`;

  const mainName = replaceBadgeEmoji(escapeHtml(names.main || shortenChannelEventId(creatorPubkey)));
  const subName = names.sub ? `@${escapeHtml(names.sub)}` : '';

  return `
    ${headerHtml}
    <div class="channel-info-creator-row" id="channelInfoCreatorRow" data-pubkey="${escapeHtml(creatorPubkey)}">
      ${avatarHtml}
      <div class="channel-info-creator-names">
        <span class="channel-info-creator-main">${mainName}</span>
        ${subName ? `<span class="channel-info-creator-sub">${subName}</span>` : ''}
      </div>
    </div>
  `;
}

function openChannelInfoModal() {
  const modal = document.getElementById('channelInfoModal');
  const contentEl = document.getElementById('channelInfoContent');
  const titleEl = document.getElementById('channelInfoTitle');
  if (!modal || !contentEl || !_activeRootId) return;

  const rootId = _activeRootId;
  const state = getState();
  const profile = _activeChannelProfile || {};
  const name = profile.name || shortenChannelEventId(rootId);
  if (titleEl) titleEl.textContent = `# ${name}`;

  const renderModal = (curProfile, rootEv) => {
    if (_activeRootId !== rootId) return;
    const about = (curProfile.about && String(curProfile.about).trim()) || '';
    const rawPicture = (curProfile.picture && String(curProfile.picture).trim()) || '';
    const safePicture = rawPicture ? sanitizeUrlCandidate(rawPicture) : null;
    const relays = Array.isArray(curProfile.relays) ? curProfile.relays : [];
    const localOnly = isLocalOnlyChannel(rootId);
    const creatorPubkey = (rootEv && typeof rootEv.pubkey === 'string') ? rootEv.pubkey : null;

    const aboutHtml = about
      ? linkifyText(about, [], { inlineMedia: false })
      : `<span class="muted">${t('channel.info.empty_about') || '説明はありません'}</span>`;

    contentEl.innerHTML = `
      <div class="channel-info-section">
        <div class="muted text-sm mb-4">${t('channel.info.id') || 'チャンネルID'}</div>
        <div class="channel-info-id-row">
          <code class="channel-info-id" id="channelInfoIdText">${escapeText(rootId)}</code>
        </div>
        ${localOnly ? `<div class="channel-info-local-notice muted">${t('channel.info.local_notice') || 'kind:10005 に未反映（この端末のみの参加です）'}</div>` : ''}
      </div>
      <div class="channel-info-section mt-16">
        <div class="muted text-sm mb-4">${t('channel.meta.about') || '説明'}</div>
        <div class="text-sm channel-info-about" id="channelInfoAbout">${aboutHtml}</div>
      </div>
      <div class="channel-info-section mt-16" id="channelInfoCreatorSection">
        ${renderChannelCreatorHtml(creatorPubkey, state)}
      </div>
      ${safePicture ? `
      <div class="channel-info-section mt-16">
        <div class="muted text-sm mb-4">${t('channel.info.picture') || t('channel.meta.picture') || '画像'}</div>
        <div class="channel-info-picture-wrap">
          <img src="${escapeHtml(safePicture)}" alt="Channel picture" class="channel-info-picture" loading="lazy" />
        </div>
      </div>` : ''}
      <div class="channel-info-section mt-16">
        <div class="muted text-sm mb-4">${t('channel.meta.relays') || 'リレー'}</div>
        ${relays.length
          ? `<div class="channel-relays-list">${relays.map((r) => `<span class="channel-relay-badge">📡 ${escapeText(r)}</span>`).join(' ')}</div>`
          : `<div class="muted text-sm">${t('channel.info.empty_relays') || 'リレー指定はありません'}</div>`}
      </div>
    `;

    const creatorRow = contentEl.querySelector('#channelInfoCreatorRow');
    if (creatorRow) {
      const pk = creatorRow.getAttribute('data-pubkey');
      if (pk) {
        creatorRow.onclick = () => openCreatorProfileModal(pk);
      }
    }

    const imgEl = contentEl.querySelector('.channel-info-picture');
    if (imgEl && safePicture) {
      imgEl.onclick = () => {
        try {
          showMediaViewer(safePicture, 'image');
        } catch (_e) {}
      };
    }

    if (creatorPubkey && state) {
      const prof = state.profiles ? state.profiles.get(creatorPubkey) : null;
      if (!prof || (!prof.loaded && !prof.loading)) {
        loadProfile(state, creatorPubkey).then(() => {
          if (_activeRootId === rootId && !modal.hidden) {
            const creatorSection = contentEl.querySelector('#channelInfoCreatorSection');
            if (creatorSection) {
              creatorSection.innerHTML = renderChannelCreatorHtml(creatorPubkey, state);
              const newCreatorRow = creatorSection.querySelector('#channelInfoCreatorRow');
              if (newCreatorRow) {
                newCreatorRow.onclick = () => openCreatorProfileModal(creatorPubkey);
              }
            }
          }
        }).catch(() => {});
      }
    }
  };

  renderModal(profile, _activeRootEvent);
  modal.hidden = false;

  fetchChannelMetadata(state, rootId).then((meta) => {
    if (_activeRootId !== rootId) return;
    if (meta && meta.rootEvent) {
      _activeRootEvent = meta.rootEvent;
      const latestProfile = extractChannelProfileFields(meta.rootEvent, meta.metaEvent);
      _activeChannelProfile = latestProfile;
      const curName = latestProfile.name || meta.label || shortenChannelEventId(rootId);
      if (titleEl) titleEl.textContent = `# ${curName}`;
      renderModal(latestProfile, meta.rootEvent);
    } else if (!_activeRootEvent) {
      const creatorSection = contentEl.querySelector('#channelInfoCreatorSection');
      if (creatorSection) {
        creatorSection.innerHTML = `
          <div class="muted text-sm mb-4">${t('channel.info.creator') || '作成者'}</div>
          <div class="muted text-sm">${t('channel.info.unknown_creator') || '作成者不明'}</div>
        `;
      }
    }
  }).catch(() => {
    if (_activeRootId === rootId && !_activeRootEvent) {
      const creatorSection = contentEl.querySelector('#channelInfoCreatorSection');
      if (creatorSection) {
        creatorSection.innerHTML = `
          <div class="muted text-sm mb-4">${t('channel.info.creator') || '作成者'}</div>
          <div class="muted text-sm">${t('channel.info.unknown_creator') || '作成者不明'}</div>
        `;
      }
    }
  });
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

function getCachedChannelEntries(pubkey) {
  try {
    migrateUnscopedUiKey(CHANNEL_LIST_CACHE_KEY, pubkey);
    const raw = localStorage.getItem(scopedUiKey(CHANNEL_LIST_CACHE_KEY, pubkey));
    return raw ? JSON.parse(raw) : null;
  } catch (_e) { return null; }
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
  if (!listEl) return [];
  rememberPublicRootIds(publicEntries, options);
  const items = mergeChannelMembership(publicEntries);

  if (statusEl && options.updateStatus !== false) {
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

  if (!_activeRootId) {
    hideComposerForUnselectedChannel();
  }
  return items;
}

/**
 * 一覧画面へ戻る。投稿先チャンネルはクリアし、投稿窓は出さない。
 */
function returnToChannelList(options = {}) {
  unsubscribeAllChannelFeeds();
  _activeRootId = null;
  _activeChannelContext = null;
  _activeChannelProfile = null;
  _activeRootEvent = null;
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

function clearChannelSearchResults() {
  _searchSeq += 1;
  if (!_containerEl) return;
  const searchInput = _containerEl.querySelector('#channelSearchInput');
  const resultsEl = _containerEl.querySelector('#channelSearchResults');
  if (searchInput) searchInput.value = '';
  if (resultsEl) {
    resultsEl.classList.add('d-none');
    resultsEl.innerHTML = '';
  }
}

/**
 * チャンネルビューのリロード（リレー再接続・ソフトリロード時など）
 * 開いているチャンネルがあれば一覧に戻さずフィードを再取得する
 */
export function reloadChannelView(state = null) {
  if (state) _stateRef = state;
  if (!_containerEl) return;

  clearChannelSearchResults();

  const wrapper = _containerEl.querySelector('.channel-portal-wrapper');
  const isChatOpen = wrapper && wrapper.classList.contains('show-chat') && _activeRootId;

  if (isChatOpen) {
    refreshActiveChannelFeed();
    loadChannelList().catch(() => {});
  } else {
    _channelListLoadGen += 1;
    loadChannelList().catch(() => {});
  }
}

/**
 * アクティブなチャンネルのフィードを再取得
 */
export function refreshActiveChannelFeed() {
  if (!_activeRootId || !_containerEl) return;
  const msgsEl = _containerEl.querySelector('#channelMessages');
  if (!msgsEl) return;
  msgsEl.dataset.channelRootId = _activeRootId;
  msgsEl.__channelFeedGen = (msgsEl.__channelFeedGen || 0) + 1;
  msgsEl.innerHTML = `<div class="muted p-12 text-center">${t('channel.loading_messages') || 'メッセージを読み込み中...'}</div>`;
  if (!_feedPaused) {
    subscribeChannelFeed(_activeRootId, getState(), msgsEl, _settingsManagerRef);
  }
}

/**
 * アカウント切替時に前アカウントの一覧／フィードを捨てて再読込
 */
export function resetChannelViewForAccount(state = null) {
  if (state) _stateRef = state;
  _channelListLoadGen += 1;
  _lastPublicRootIds = [];
  returnToChannelList({ forgetLast: false });
  clearChannelSearchResults();
  if (_containerEl) {
    const listEl = _containerEl.querySelector('#channelList');
    const statusEl = _containerEl.querySelector('#channelListStatus');
    if (listEl) listEl.innerHTML = '';
    if (statusEl) statusEl.textContent = t('channel.loading_list') || 'チャンネル一覧を読み込み中...';
    loadChannelList().catch(() => {});
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

  const pubkey = normalizePubkey(getPubkey());
  const loadGen = ++_channelListLoadGen;
  const isCurrentLoad = () => (
    loadGen === _channelListLoadGen
    && normalizePubkey(getPubkey()) === pubkey
  );
  const cacheKey = scopedUiKey(CHANNEL_LIST_CACHE_KEY, pubkey);
  const cached = getCachedChannelEntries(pubkey);
  if (statusEl) statusEl.textContent = t('channel.loading_list') || 'チャンネル一覧を読み込み中...';

  const usableEntryCount = (cached && Array.isArray(cached) && cached.length)
    ? renderChannelListItems(listEl, statusEl, cached, {
      prune: false,
      updateStatus: false,
    }).length
    : renderChannelListItems(listEl, statusEl, [], {
      prune: false,
      updateStatus: false,
    }).length;

  try {
    const state = getState();
    if (state && pubkey) {
      const result = await fetchPublicChatsEntries(state, pubkey, { maxEntries: 40 });
      if (!isCurrentLoad()) return;
      if (result && Array.isArray(result.entries)) {
        // The key is captured with the load so a later account switch cannot redirect this write.
        try {
          localStorage.setItem(cacheKey, JSON.stringify(result.entries));
        } catch (_e) {}
        // event があるときだけ除外を prune（空の 10005 なら allowEmpty で刈り取り可）
        renderChannelListItems(listEl, statusEl, result.entries, {
          prune: !!result.event,
          allowEmpty: !!result.event,
        });
      } else {
        throw new Error('Invalid public chats response');
      }
    }
  } catch (err) {
    if (!isCurrentLoad()) return;
    console.warn('[channel-ui] fetchPublicChatsEntries error', err);
    if (statusEl) statusEl.textContent = t('channel.load_failed') || 'チャンネル一覧の取得に失敗しました';
    if (!usableEntryCount) listEl.innerHTML = '';
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
        <div class="muted text-xs channel-search-result-about">${escapeText(item.about || shortenChannelEventId(item.rootId))}</div>
      `;

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'secondary small';
      addBtn.textContent = t('channel.add') || '追加';
      addBtn.onclick = async () => {
        addBtn.disabled = true;
        try {
          joinChannelLocally(item.rootId, { publicRootIds: _lastPublicRootIds });
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
  _activeRootEvent = null;
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
    _activeRootEvent = meta.rootEvent || null;
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
  joinChannelLocally(rootId, { publicRootIds: _lastPublicRootIds });
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
    leaveChannelLocally(rootId, { publicRootIds: _lastPublicRootIds });
    if (_activeRootId === rootId) {
      clearActiveChannelView();
    }
    await loadChannelList();
  });
}
