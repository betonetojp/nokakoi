import { fetchPublicChatsEntries } from './public-chats.js';
import { fetchChannelMetadata, extractChannelProfileFields, encodeChannelNevent, buildChannelEmbedContext, shortenChannelEventId } from './channel.js';
import { subscribeChannelFeed, unsubscribeChannelFeed } from './channel-feed.js';
import { openEhagakiWithChannel } from '../post/postlink.js';
import { setChannelTarget, hideComposerForUnselectedChannel, revealComposerForSelectedChannel } from '../post/composer.js';
import { getNip19 } from '../../core/nostr-compat.js';
import { t } from '../../utils/i18n.js';

const CHANNEL_LIST_CACHE_KEY = 'nokakoi_public_chats_cache_v1';

let _activeRootId = null;
let _activeChannelContext = null;
let _stateRef = null;
let _containerEl = null;
let _settingsManagerRef = null;
let _ehagakiBound = false;
let _feedPaused = false;

/**
 * チャンネルビューの初期化
 */
export function initChannelView(container, state, settingsManager = null) {
  if (!container) return;
  _containerEl = container;
  _stateRef = state;
  _settingsManagerRef = settingsManager;

  // コンテナの基本レイアウト設定
  container.innerHTML = `
    <div class="channel-portal-wrapper">
      <div class="channel-sidebar" id="channelSidebar">
        <div class="channel-sidebar-header">
          <h3>💬 ${t('tabs.channels') || 'チャンネル'}</h3>
          <button type="button" id="channelRefreshBtn" class="secondary small" title="更新">🔄</button>
        </div>
        <div class="channel-join-box">
          <input type="text" id="channelIdInput" placeholder="チャンネルID (hex/nevent) で参加" class="channel-id-input">
          <button type="button" id="channelJoinBtn" class="secondary small">追加</button>
        </div>
        <div class="channel-list-status muted text-sm" id="channelListStatus">読み込み中...</div>
        <div class="channel-list" id="channelList"></div>
      </div>
      <div class="channel-main-view" id="channelMainView">
        <div class="channel-empty-state" id="channelEmptyState">
          <p class="muted">左側のリストからチャンネルを選択するか、チャンネルIDを入力して参加してください。</p>
        </div>
        <div class="channel-chat-container d-none" id="channelChatContainer">
          <div class="channel-chat-header">
            <button type="button" id="channelBackToListBtn" class="secondary small d-mobile-only">← 一覧</button>
            <div class="channel-header-info">
              <div class="channel-title-row">
                <h4 id="channelTitle">チャンネル名</h4>
                <button type="button" id="channelCopyIdBtn" class="secondary micro-btn" title="チャンネルID(nevent)をコピー">📋 ID</button>
              </div>
              <div class="channel-sub-info muted text-xs" id="channelSubInfo"></div>
              <div class="channel-relays-list text-xs muted" id="channelRelaysList"></div>
            </div>
          </div>
          <div class="channel-messages" id="channelMessages"></div>
        </div>
      </div>
    </div>
  `;

  bindEhagakiButtonIntegration();

  // イベントバインド
  const refreshBtn = container.querySelector('#channelRefreshBtn');
  if (refreshBtn) refreshBtn.onclick = () => loadChannelList();

  const joinBtn = container.querySelector('#channelJoinBtn');
  if (joinBtn) joinBtn.onclick = handleJoinChannel;

  const backBtn = container.querySelector('#channelBackToListBtn');
  if (backBtn) {
    backBtn.onclick = () => {
      const wrapper = container.querySelector('.channel-portal-wrapper');
      if (wrapper) wrapper.classList.remove('show-chat-mobile');
    };
  }

  // チャンネルリスト取得
  loadChannelList();
}

function getState() {
  return _stateRef || (typeof window !== 'undefined' ? window.__nostrState : null);
}

function getPubkey() {
  const state = getState();
  return (state && state.pubkey) || (typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : null);
}

function getCachedChannelEntries() {
  try {
    const raw = localStorage.getItem(CHANNEL_LIST_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_e) { return null; }
}

function saveCachedChannelEntries(entries) {
  try {
    localStorage.setItem(CHANNEL_LIST_CACHE_KEY, JSON.stringify(entries));
  } catch (_e) {}
}

/**
 * チャンネルリスト項目の描画ヘルパー
 */
function renderChannelListItems(listEl, statusEl, entries) {
  if (!listEl) return;
  const customList = getCustomJoinedChannels();
  const mergedMap = new Map();

  (entries || []).forEach(e => {
    if (e && e.rootId) mergedMap.set(e.rootId, e);
  });

  customList.forEach(rootId => {
    if (!mergedMap.has(rootId)) {
      mergedMap.set(rootId, { rootId, relayHint: null, isPrivate: false });
    }
  });

  const items = Array.from(mergedMap.values());
  if (statusEl) {
    statusEl.textContent = items.length ? `参加中: ${items.length}件` : '参加中のチャンネルがありません';
  }

  listEl.innerHTML = '';
  items.forEach(entry => {
    const itemBtn = document.createElement('button');
    itemBtn.type = 'button';
    itemBtn.className = 'channel-list-item';
    if (_activeRootId === entry.rootId) itemBtn.classList.add('active');
    itemBtn.dataset.rootId = entry.rootId;

    itemBtn.innerHTML = `
      <span class="channel-item-name"># ${shortenChannelEventId(entry.rootId)}</span>
      ${entry.isPrivate ? '<span class="channel-item-badge">🔒</span>' : ''}
    `;

    itemBtn.onclick = () => selectChannel(entry.rootId);
    listEl.appendChild(itemBtn);

    // 非同期でメタデータ（表示名）解決
    fetchChannelMetadata(_stateRef, entry.rootId).then(meta => {
      if (meta && meta.label) {
        const nameSpan = itemBtn.querySelector('.channel-item-name');
        if (nameSpan) nameSpan.textContent = `# ${meta.label}`;
      }
    }).catch(() => {});
  });

  // 直近アクティブなチャンネルがあれば自動選択
  if (!_activeRootId && items.length > 0) {
    const savedLast = localStorage.getItem('last_active_channel_root_id');
    if (savedLast && mergedMap.has(savedLast)) {
      selectChannel(savedLast);
    } else {
      selectChannel(items[0].rootId);
    }
  } else if (!_activeRootId && items.length === 0) {
    hideComposerForUnselectedChannel();
  }
}

/**
 * チャンネルタブがアクティブになった際の投稿窓状態同期
 */
export function syncChannelComposerState() {
  if (_activeRootId) {
    fetchChannelMetadata(getState(), _activeRootId).then(meta => {
      const profile = extractChannelProfileFields(meta.rootEvent, meta.metaEvent);
      const name = profile.name || meta.label || shortenChannelEventId(_activeRootId);
      setChannelTarget({ rootId: _activeRootId, name, relays: profile.relays });
      revealComposerForSelectedChannel();
    }).catch(() => {
      setChannelTarget({ rootId: _activeRootId, name: shortenChannelEventId(_activeRootId) });
      revealComposerForSelectedChannel();
    });
  } else {
    hideComposerForUnselectedChannel();
  }
}

/**
 * 他タブへ離れたときに live 購読を停止
 */
export function pauseChannelSubscriptions() {
  _feedPaused = true;
  if (_activeRootId) {
    unsubscribeChannelFeed(_activeRootId);
  }
}

/**
 * チャンネルタブ復帰時に live 購読を再開
 */
export function resumeChannelSubscriptions() {
  _feedPaused = false;
  if (!_activeRootId || !_containerEl) return;
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

  // 1. キャッシュが存在すれば、即時 (0ms) 描画
  const cached = getCachedChannelEntries();
  if (cached && Array.isArray(cached) && cached.length) {
    renderChannelListItems(listEl, statusEl, cached);
  } else {
    if (statusEl) statusEl.textContent = 'チャンネル一覧を読み込み中...';
    listEl.innerHTML = '';
  }

  // 2. バックグラウンドで最新のチャンネルリストをリレーから取得 (SWR)
  try {
    const state = getState();
    const pubkey = getPubkey();
    if (state && pubkey) {
      const result = await fetchPublicChatsEntries(state, pubkey, { maxEntries: 40 });
      if (result && Array.isArray(result.entries)) {
        saveCachedChannelEntries(result.entries);
        renderChannelListItems(listEl, statusEl, result.entries);
      }
    }
  } catch (err) {
    console.warn('[channel-ui] fetchPublicChatsEntries error', err);
    if (!cached || !cached.length) {
      if (statusEl) statusEl.textContent = 'チャンネル一覧の取得に失敗しました';
    }
  }
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

/**
 * チャンネルの選択・表示切替
 */
export async function selectChannel(rootId) {
  if (!rootId || !_containerEl) return;

  // 旧チャンネルのサブスクリプション解除
  if (_activeRootId && _activeRootId !== rootId) {
    unsubscribeChannelFeed(_activeRootId);
  }

  _activeRootId = rootId;
  _feedPaused = false;
  _activeChannelContext = null;
  try { localStorage.setItem('last_active_channel_root_id', rootId); } catch (_e) {}

  // コンテキスト非同期ロード
  buildChannelEmbedContext(getState(), rootId).then(ctx => {
    _activeChannelContext = ctx;
  }).catch(() => { _activeChannelContext = null; });

  // UI状態更新
  const items = _containerEl.querySelectorAll('.channel-list-item');
  items.forEach(it => it.classList.toggle('active', it.dataset.rootId === rootId));

  const wrapper = _containerEl.querySelector('.channel-portal-wrapper');
  if (wrapper) wrapper.classList.add('show-chat-mobile');

  const emptyState = _containerEl.querySelector('#channelEmptyState');
  const chatContainer = _containerEl.querySelector('#channelChatContainer');
  if (emptyState) emptyState.classList.add('d-none');
  if (chatContainer) chatContainer.classList.remove('d-none');

  const titleEl = _containerEl.querySelector('#channelTitle');
  const infoEl = _containerEl.querySelector('#channelSubInfo');
  const relaysEl = _containerEl.querySelector('#channelRelaysList');
  const copyBtn = _containerEl.querySelector('#channelCopyIdBtn');
  const msgsEl = _containerEl.querySelector('#channelMessages');

  if (titleEl) titleEl.textContent = `# ${shortenChannelEventId(rootId)}`;
  if (infoEl) infoEl.textContent = `ID: ${shortenChannelEventId(rootId)}`;
  if (relaysEl) relaysEl.innerHTML = '';
  if (msgsEl) msgsEl.innerHTML = '<div class="muted p-12 text-center">メッセージを読み込み中...</div>';

  let currentNevent = null;
  try {
    currentNevent = encodeChannelNevent(rootId);
  } catch (_e) {}

  if (copyBtn) {
    copyBtn.onclick = () => {
      const textToCopy = currentNevent || rootId;
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(textToCopy).then(() => {
          const orig = copyBtn.textContent;
          copyBtn.textContent = '✅ コピー完了';
          setTimeout(() => { copyBtn.textContent = orig; }, 1800);
        }).catch(() => {
          alert('チャンネルID: ' + textToCopy);
        });
      } else {
        alert('チャンネルID: ' + textToCopy);
      }
    };
  }

  // 即時に共通投稿欄 (composer) にチャンネルターゲットを反映
  setChannelTarget({ rootId, name: shortenChannelEventId(rootId) });

  // メタデータ取得して表示更新
  fetchChannelMetadata(getState(), rootId).then(meta => {
    const profile = extractChannelProfileFields(meta.rootEvent, meta.metaEvent);
    const name = profile.name || meta.label || shortenChannelEventId(rootId);
    if (titleEl) {
      titleEl.textContent = `# ${name}`;
    }
    if (infoEl) {
      if (profile.about) {
        infoEl.textContent = profile.about;
      } else {
        infoEl.textContent = `ID: ${shortenChannelEventId(rootId)}`;
      }
    }
    if (relaysEl) {
      if (Array.isArray(profile.relays) && profile.relays.length) {
        relaysEl.innerHTML = profile.relays.map(r => `<span class="channel-relay-badge">📡 ${r}</span>`).join(' ');
      } else {
        relaysEl.innerHTML = '';
      }
    }

    // 正式なチャンネル名で共通投稿欄 (composer) を再更新
    setChannelTarget({ rootId, name, relays: profile.relays });
  }).catch(() => {});

  // サブスクライブ開始
  if (!_feedPaused) {
    subscribeChannelFeed(rootId, getState(), msgsEl, _settingsManagerRef);
  }
}

/**
 * hex / nevent / nostr:nevent 入力をチャンネル root ID に解決
 */
function resolveChannelRootIdInput(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase();

  let candidate = trimmed.replace(/^nostr:/i, '');
  try {
    const nip19 = getNip19();
    if (nip19 && typeof nip19.decode === 'function') {
      const decoded = nip19.decode(candidate);
      if (decoded && decoded.type === 'nevent') {
        const id = decoded.data && decoded.data.id;
        if (id && /^[0-9a-f]{64}$/i.test(id)) return id.toLowerCase();
      }
      if (decoded && decoded.type === 'note') {
        const id = typeof decoded.data === 'string' ? decoded.data : null;
        if (id && /^[0-9a-f]{64}$/i.test(id)) return id.toLowerCase();
      }
    }
  } catch (_e) {}

  return null;
}

/**
 * 手動でのチャンネルID入力による参加処理
 */
function handleJoinChannel() {
  if (!_containerEl) return;
  const inputEl = _containerEl.querySelector('#channelIdInput');
  if (!inputEl) return;

  const raw = (inputEl.value || '').trim();
  if (!raw) return;

  const rootId = resolveChannelRootIdInput(raw);
  if (!rootId) {
    alert('有効なチャンネル ID (64桁 hex / nevent) を入力してください');
    return;
  }

  saveCustomJoinedChannel(rootId);
  inputEl.value = '';
  loadChannelList();
  selectChannel(rootId);
}

// LocalStorage によるカスタム追加チャンネルの補完
function getCustomJoinedChannels() {
  try {
    const raw = localStorage.getItem('custom_joined_channels');
    return raw ? JSON.parse(raw) : [];
  } catch (_e) {
    return [];
  }
}

function saveCustomJoinedChannel(rootId) {
  try {
    const list = getCustomJoinedChannels();
    if (!list.includes(rootId)) {
      list.push(rootId);
      localStorage.setItem('custom_joined_channels', JSON.stringify(list));
    }
  } catch (_e) {}
}
