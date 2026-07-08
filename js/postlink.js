import { t } from './i18n.js';
import { addAutoCloseCheckbox, waitForEhagakiPublish } from './ehagaki-autoclose.js';
import { getReplyTarget, getQuoteMode } from './composer.js';
import { clearTextShortcodeRegistry } from './custom-emoji-store.js';
import { getNip19 } from './nostr-compat.js';
import { signEventWithMode } from './actions.js';
import { POSTLINK_DEFAULT_TITLE, POSTLINK_DEFAULT_URL } from './constants.js';
import { debounce } from './utils.js';

const DEFAULT_TITLE = POSTLINK_DEFAULT_TITLE;
const DEFAULT_URL = POSTLINK_DEFAULT_URL;
const EMBED_STORAGE_PREFIX = 'ehagaki.embed.storage.v1:';
const EMBED_ALLOWED_STORAGE_KEYS = new Set([
  'locale',
  'themeMode',
  'darkMode',
  'uploadEndpoint',
  'clientTagEnabled',
  'quoteNotificationEnabled',
  'imageQualityLevel',
  'videoQualityLevel',
  'imageCompressionLevel',
  'videoCompressionLevel',
  'mediaFreePlacement',
  'showMascot',
  'showFlavorText',
  'settingsPreferenceMetadata',
  'firstVisit',
  'sharedMediaProcessed',
]);

// ヘルパー: URL候補をサニタイズして正規化
// 許可スキームは http/https のみ。正規化済み絶対URL文字列または null を返す。
function sanitizeUrlCandidate(u) {
  try {
    if (!u || typeof u !== 'string') return null;
    const trimmed = u.trim();
    if (!trimmed) return null;
    // 異常に長い入力は拒否
    if (trimmed.length > 2048) return null;
    let urlObj;
    try {
      urlObj = new URL(trimmed);
    } catch (e) {
      // 現在URL基準の相対URLとして再試行
      try { urlObj = new URL(trimmed, window.location.href); } catch (ee) { return null; }
    }
    const proto = (urlObj.protocol || '').toLowerCase();
    if (proto === 'http:' || proto === 'https:') return urlObj.toString();
  } catch (e) { }
  return null;
}

function clearComposerNoteInput(noteEl) {
  if (!noteEl) return;
  noteEl.value = '';
  clearTextShortcodeRegistry();
  try {
    noteEl.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (e) { }
}

export function updatePostLinkButtonAndModal(title, url, openInNewTab = false) {
  try {
    const btn = document.getElementById('ehagakiBtn');
    const iframe = document.getElementById('ehagakiFrame');
    const external = document.getElementById('ehagakiOpenExternal');

    // ボタンラベル
    if (btn) {
      if (typeof title === 'string' && title === '') {
        btn.textContent = t('postlink.btn_external');
      } else {
        const ttitle = (title && typeof title === 'string' && title.trim()) ? title : DEFAULT_TITLE;
        btn.textContent = t('postlink.btn_with_title', { title: ttitle });
      }
      try { btn.dataset.postlinkNewTab = openInNewTab ? '1' : '0'; } catch (e) { }
    }

    // iframe/src や anchor へ代入する前にURLをサニタイズ
    const candidate = (url && typeof url === 'string' && url.trim()) ? url : DEFAULT_URL;
    const safe = sanitizeUrlCandidate(candidate) || DEFAULT_URL;
    if (iframe) iframe.dataset.src = safe;
    if (external) external.href = safe;
  } catch (e) {
    console.warn('[PostLink] updatePostLinkButtonAndModal に失敗', e);
  }
}


export async function setupPostLinkUI(settingsManager) {
  try {
    const titleInput = document.getElementById('postLinkTitleInput');
    const urlInput = document.getElementById('postLinkUrlInput');
    const saveStatus = document.getElementById('postLinkSaveStatus');
    // HTML側のチェックボックスIDは 'postLinkOpenNewTabCheck'
    const openNewTabCheck = document.getElementById('postLinkOpenNewTabCheck');
    const btn = document.getElementById('ehagakiBtn');
    const modal = document.getElementById('ehagakiModal');
    const iframe = document.getElementById('ehagakiFrame');
    const external = document.getElementById('ehagakiOpenExternal');
    const close = document.getElementById('ehagakiClose');

    let delayedAuthSyncTimer = null;
    let embedAuthEstablished = false;
    let pendingSettingsAfterAuth = false;
    let clearDelayedAuthSync = () => {
      try {
        if (delayedAuthSyncTimer) clearInterval(delayedAuthSyncTimer);
      } catch (e) { }
      delayedAuthSyncTimer = null;
    };
    let startDelayedAuthAndSettingsSync = () => { };

    function queueSettingsAfterAuth() {
      pendingSettingsAfterAuth = true;
    }

    function flushSettingsAfterAuth() {
      if (!pendingSettingsAfterAuth) return;
      try { postEmbedSettings(); } catch (e) { }
      pendingSettingsAfterAuth = false;
    }

    let iframeTeardownTimer = null;
    function teardownEhagakiIframe(delayMs = 240) {
      try { clearDelayedAuthSync(); } catch (e) { }
      embedAuthEstablished = false;
      pendingSettingsAfterAuth = false;
      try {
        if (iframeTeardownTimer) clearTimeout(iframeTeardownTimer);
      } catch (e) { }
      iframeTeardownTimer = setTimeout(() => {
        try { if (iframe) iframe.src = ''; } catch (e) { }
      }, delayMs);
    }

    // 生の保存値（未保存時は null）
    const rawTitle = (typeof settingsManager.getRaw === 'function') ? settingsManager.getRaw('postLinkTitle') : null;
    const rawUrl = (typeof settingsManager.getRaw === 'function') ? settingsManager.getRaw('postLinkUrl') : null;
    const rawOpenNewTab = (typeof settingsManager.getRaw === 'function') ? settingsManager.getRaw('postLinkOpenInNewTab') : null;

    // 実効値（settingsManager.get は既定値込み）
    const effectiveTitle = (rawTitle === null || typeof rawTitle === 'undefined') ? (settingsManager.get('postLinkTitle') || DEFAULT_TITLE) : rawTitle;
    const effectiveUrl = (rawUrl === null || typeof rawUrl === 'undefined') ? (settingsManager.get('postLinkUrl') || DEFAULT_URL) : rawUrl;
    const effectiveOpenNewTab = (rawOpenNewTab === null || typeof rawOpenNewTab === 'undefined') ? !!settingsManager.get('postLinkOpenInNewTab') : !!rawOpenNewTab;

    // 入力欄反映: 生値未保存なら実効値を初期入力。生値があれば（空文字含む）そのまま表示。
    if (titleInput) {
      titleInput.value = (rawTitle === null || typeof rawTitle === 'undefined') ? effectiveTitle : rawTitle;
    }
    if (urlInput) {
      urlInput.value = (rawUrl === null || typeof rawUrl === 'undefined') ? effectiveUrl : rawUrl;
    }
    if (openNewTabCheck) {
      openNewTabCheck.checked = !!effectiveOpenNewTab;
      openNewTabCheck.addEventListener('change', () => {
        try {
          const nv = !!openNewTabCheck.checked;
          try { settingsManager.set('postLinkOpenInNewTab', nv); } catch (e) { }
          // ボタン表示状態を更新
          try { updatePostLinkButtonAndModal((titleInput ? titleInput.value : effectiveTitle), (urlInput ? urlInput.value : effectiveUrl), nv); } catch (e) { }
        } catch (e) { }
      });
    }

    // 初期表示更新（effectiveUrl をサニタイズして反映）
    updatePostLinkButtonAndModal(effectiveTitle, effectiveUrl, effectiveOpenNewTab);

    const persist = debounce(() => {
      try {
        const tval = (titleInput && typeof titleInput.value !== 'undefined') ? titleInput.value : '';
        const uval = (urlInput && typeof urlInput.value !== 'undefined') ? urlInput.value : '';
        const nv = openNewTabCheck ? !!openNewTabCheck.checked : false;

        settingsManager.set('postLinkTitle', tval);
        settingsManager.set('postLinkUrl', uval);
        try { settingsManager.set('postLinkOpenInNewTab', nv); } catch (e) { }

        const titleForDisplay = (typeof tval === 'string' && tval.trim().length ===0) ? '' : tval;
        const safeUrlForDisplay = sanitizeUrlCandidate((uval && uval.trim()) ? uval : DEFAULT_URL) || DEFAULT_URL;
        updatePostLinkButtonAndModal(titleForDisplay, safeUrlForDisplay, nv);

        if (saveStatus) {
          saveStatus.textContent = t('postlink.saved');
          setTimeout(() => {
            try { if (saveStatus && saveStatus.textContent === t('postlink.saved')) saveStatus.textContent = ''; } catch (e) { }
          },1200);
        }
      } catch (e) {
        console.warn('[PostLink] post link 設定の保存に失敗', e);
      }
    },400);

    if (titleInput) titleInput.addEventListener('input', persist);
    if (urlInput) urlInput.addEventListener('input', persist);

    const EMBED_NS = 'ehagaki.embed';

    function postToEhagakiIframe(message) {
      try {
        const iframeEl = document.getElementById('ehagakiFrame');
        if (iframeEl && iframeEl.contentWindow) {
          const targetOrigin = iframeEl.src ? new URL(iframeEl.src).origin : '*';
          iframeEl.contentWindow.postMessage(message, targetOrigin);
        }
      } catch (e) { console.warn('[PostLink] postToEhagakiIframe に失敗', e); }
    }

    function getNostrState() {
      try { return window.__nostrState || null; } catch (e) { return null; }
    }

    function resolveEmbedTheme() {
      let themeForEmbed = 'system';
      try {
        const themeSetting = (settingsManager && typeof settingsManager.get === 'function') ? settingsManager.get('theme') : null;
        if (themeSetting === 'light' || themeSetting === 'dark' || themeSetting === 'system') {
          themeForEmbed = themeSetting;
        }
      } catch (e) { }
      return themeForEmbed;
    }

    function resolveVisualThemeForEmbed() {
      try {
        const mode = resolveEmbedTheme();
        if (mode === 'light' || mode === 'dark') return mode;
        const prefersDark = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        return prefersDark ? 'dark' : 'light';
      } catch (e) { }
      return 'light';
    }

    function resolveEmbedLocale() {
      try {
        const stored = localStorage.getItem('lang');
        if (stored === 'ja' || stored === 'en') return stored;
      } catch (e) { }
      try {
        const nav = (navigator.languages && navigator.languages.length) ? navigator.languages[0] : navigator.language;
        const code = String(nav || '').toLowerCase();
        if (code.startsWith('ja')) return 'ja';
      } catch (e) { }
      return 'en';
    }

    function postEmbedLocaleSetting() {
      try {
        postToEhagakiIframe({
          namespace: EMBED_NS,
          version: 1,
          type: 'settings.set',
          requestId: 'settings-locale-' + String(Date.now()),
          payload: {
            locale: resolveEmbedLocale(),
          },
        });
      } catch (e) { }
    }

    function readDelegatedSetting(key) {
      try { return localStorage.getItem(EMBED_STORAGE_PREFIX + key); } catch (e) { return null; }
    }

    function parseStoredBool(value) {
      if (value === 'true') return true;
      if (value === 'false') return false;
      return null;
    }

    function buildEmbedSettingsPayload() {
      const payload = {
        locale: resolveEmbedLocale(),
        themeMode: resolveEmbedTheme(),
      };

      const uploadEndpoint = readDelegatedSetting('uploadEndpoint');
      if (typeof uploadEndpoint === 'string' && uploadEndpoint) payload.uploadEndpoint = uploadEndpoint;

      const imageQualityLevel = readDelegatedSetting('imageQualityLevel');
      if (typeof imageQualityLevel === 'string' && imageQualityLevel) payload.imageQualityLevel = imageQualityLevel;

      const videoQualityLevel = readDelegatedSetting('videoQualityLevel');
      if (typeof videoQualityLevel === 'string' && videoQualityLevel) payload.videoQualityLevel = videoQualityLevel;

      const clientTagEnabled = parseStoredBool(readDelegatedSetting('clientTagEnabled'));
      if (clientTagEnabled !== null) payload.clientTagEnabled = clientTagEnabled;

      const quoteNotificationEnabled = parseStoredBool(readDelegatedSetting('quoteNotificationEnabled'));
      if (quoteNotificationEnabled !== null) payload.quoteNotificationEnabled = quoteNotificationEnabled;

      const mediaFreePlacement = parseStoredBool(readDelegatedSetting('mediaFreePlacement'));
      if (mediaFreePlacement !== null) payload.mediaFreePlacement = mediaFreePlacement;

      const showMascot = parseStoredBool(readDelegatedSetting('showMascot'));
      if (showMascot !== null) payload.showMascot = showMascot;

      const showFlavorText = parseStoredBool(readDelegatedSetting('showFlavorText'));
      if (showFlavorText !== null) payload.showFlavorText = showFlavorText;

      return payload;
    }

    function postEmbedSettings() {
      try {
        postToEhagakiIframe({
          namespace: EMBED_NS,
          version: 1,
          type: 'settings.set',
          requestId: 'settings-sync-' + String(Date.now()),
          payload: buildEmbedSettingsPayload(),
        });
      } catch (e) { }
    }

    function buildStorageError(requestId, message) {
      return {
        namespace: EMBED_NS,
        version: 1,
        type: 'storage.error',
        requestId,
        payload: {
          timestamp: Date.now(),
          code: 'storage_parent_failed',
          message: message || 'storage_parent_failed',
        },
      };
    }

    function buildIdbError(requestId, code, message) {
      return {
        namespace: EMBED_NS,
        version: 1,
        type: 'idb.error',
        requestId,
        payload: {
          timestamp: Date.now(),
          code: code || 'idb_parent_failed',
          message: message || code || 'idb_parent_failed',
        },
      };
    }

    function handleIndexedDBDelegation(data) {
      const requestId = (typeof data.requestId === 'string') ? data.requestId.trim() : '';
      if (!requestId) return;

      const idbStoragePrefix = 'ehagaki.embed.idb.v1:';
      // eHagaki 仕様では uploadDestinations のみが委譲対象（下書き等は親保存対象外）
      const IDB_ALLOWED_STORES = new Set(['uploadDestinations']);

      try {
        console.info('[PostLink][idb] request', {
          type: data.type,
          requestId,
          payload: data.payload,
        });

        // idb.getSnapshot: parent IndexedDB から snapshot を読み込み
        if (data.type === 'idb.getSnapshot') {
          const store = (typeof data.payload?.store === 'string') ? data.payload.store : '';
          const scopeKey = (typeof data.payload?.scopeKey === 'string') ? data.payload.scopeKey : '';

          if (!store || !scopeKey || !IDB_ALLOWED_STORES.has(store)) {
            const errorMessage = !IDB_ALLOWED_STORES.has(store) ? 'unsupported_store' : 'invalid_idb_getSnapshot_payload';
            console.warn('[PostLink][idb] error', { type: data.type, requestId, store, message: errorMessage });
            postToEhagakiIframe(buildIdbError(requestId, 'invalid_payload', errorMessage));
            return;
          }

          try {
            const storageKey = idbStoragePrefix + store + ':' + scopeKey;
            const serialized = localStorage.getItem(storageKey);
            const records = serialized ? JSON.parse(serialized) : [];

            console.info('[PostLink][idb] result', { type: data.type, requestId, store, scopeKey, recordCount: records.length });
            postToEhagakiIframe({
              namespace: EMBED_NS,
              version: 1,
              type: 'idb.result',
              requestId,
              payload: {
                timestamp: Date.now(),
                store,
                scopeKey,
                records: records,
              },
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'parse_failed';
            console.warn('[PostLink][idb] getSnapshot error', { requestId, message, error: err });
            postToEhagakiIframe(buildIdbError(requestId, 'parse_failed', message));
          }
          return;
        }

        // idb.setSnapshot: parent IndexedDB に snapshot を保存
        if (data.type === 'idb.setSnapshot') {
          const store = (typeof data.payload?.store === 'string') ? data.payload.store : '';
          const scopeKey = (typeof data.payload?.scopeKey === 'string') ? data.payload.scopeKey : '';
          const records = (Array.isArray(data.payload?.records)) ? data.payload.records : null;

          if (!store || !scopeKey || records === null || !IDB_ALLOWED_STORES.has(store)) {
            const errorMessage = !IDB_ALLOWED_STORES.has(store) ? 'unsupported_store' : 'invalid_idb_setSnapshot_payload';
            console.warn('[PostLink][idb] error', { type: data.type, requestId, store, message: errorMessage });
            postToEhagakiIframe(buildIdbError(requestId, 'invalid_payload', errorMessage));
            return;
          }

          try {
            const storageKey = idbStoragePrefix + store + ':' + scopeKey;
            const serialized = JSON.stringify(records);
            localStorage.setItem(storageKey, serialized);

            console.info('[PostLink][idb] result', { type: data.type, requestId, store, scopeKey, recordCount: records.length });
            postToEhagakiIframe({
              namespace: EMBED_NS,
              version: 1,
              type: 'idb.result',
              requestId,
              payload: {
                timestamp: Date.now(),
                store,
                scopeKey,
              },
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'save_failed';
            console.warn('[PostLink][idb] setSnapshot error', { requestId, message, error: err });
            postToEhagakiIframe(buildIdbError(requestId, 'save_failed', message));
          }
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'idb_parent_failed';
        console.warn('[PostLink][idb] exception', { type: data.type, requestId, message, error: err });
        postToEhagakiIframe(buildIdbError(requestId, 'idb_parent_failed', message));
      }
    }

    function handleStorageDelegation(data) {
      const requestId = (typeof data.requestId === 'string') ? data.requestId.trim() : '';
      if (!requestId) return;

      try {
        console.info('[PostLink][storage] request', {
          type: data.type,
          requestId,
          payload: data.payload,
        });

        if (data.type === 'storage.get') {
          const keys = (data && data.payload && Array.isArray(data.payload.keys)) ? data.payload.keys : null;
          if (!keys) {
            const errorMessage = 'invalid_storage_get_payload';
            console.warn('[PostLink][storage] error', { type: data.type, requestId, message: errorMessage });
            postToEhagakiIframe(buildStorageError(requestId, errorMessage));
            return;
          }

          const values = {};
          for (const key of keys) {
            if (typeof key !== 'string' || !EMBED_ALLOWED_STORAGE_KEYS.has(key)) {
              const errorMessage = 'invalid_storage_key';
              console.warn('[PostLink][storage] error', { type: data.type, requestId, key, message: errorMessage });
              postToEhagakiIframe(buildStorageError(requestId, errorMessage));
              return;
            }
            values[key] = localStorage.getItem(EMBED_STORAGE_PREFIX + key);
          }

          console.info('[PostLink][storage] result', { type: data.type, requestId, values });
          postToEhagakiIframe({
            namespace: EMBED_NS,
            version: 1,
            type: 'storage.result',
            requestId,
            payload: { timestamp: Date.now(), values },
          });
          return;
        }

        if (data.type === 'storage.set') {
          const incomingValues = (data && data.payload && data.payload.values && typeof data.payload.values === 'object') ? data.payload.values : null;
          if (!incomingValues) {
            const errorMessage = 'invalid_storage_set_payload';
            console.warn('[PostLink][storage] error', { type: data.type, requestId, message: errorMessage });
            postToEhagakiIframe(buildStorageError(requestId, errorMessage));
            return;
          }

          const applied = [];
          for (const [key, value] of Object.entries(incomingValues)) {
            if (typeof key !== 'string' || !EMBED_ALLOWED_STORAGE_KEYS.has(key) || typeof value !== 'string') {
              const errorMessage = 'invalid_storage_value';
              console.warn('[PostLink][storage] error', { type: data.type, requestId, key, valueType: typeof value, message: errorMessage });
              postToEhagakiIframe(buildStorageError(requestId, errorMessage));
              return;
            }
            localStorage.setItem(EMBED_STORAGE_PREFIX + key, value);
            applied.push(key);
          }

          console.info('[PostLink][storage] result', { type: data.type, requestId, applied });
          postToEhagakiIframe({
            namespace: EMBED_NS,
            version: 1,
            type: 'storage.result',
            requestId,
            payload: { timestamp: Date.now(), applied },
          });
          return;
        }

        if (data.type === 'storage.remove') {
          const keys = (data && data.payload && Array.isArray(data.payload.keys)) ? data.payload.keys : null;
          if (!keys) {
            const errorMessage = 'invalid_storage_remove_payload';
            console.warn('[PostLink][storage] error', { type: data.type, requestId, message: errorMessage });
            postToEhagakiIframe(buildStorageError(requestId, errorMessage));
            return;
          }

          const removed = [];
          for (const key of keys) {
            if (typeof key !== 'string' || !EMBED_ALLOWED_STORAGE_KEYS.has(key)) {
              const errorMessage = 'invalid_storage_key';
              console.warn('[PostLink][storage] error', { type: data.type, requestId, key, message: errorMessage });
              postToEhagakiIframe(buildStorageError(requestId, errorMessage));
              return;
            }
            localStorage.removeItem(EMBED_STORAGE_PREFIX + key);
            removed.push(key);
          }

          console.info('[PostLink][storage] result', { type: data.type, requestId, removed });
          postToEhagakiIframe({
            namespace: EMBED_NS,
            version: 1,
            type: 'storage.result',
            requestId,
            payload: { timestamp: Date.now(), removed },
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'storage_parent_failed';
        console.warn('[PostLink][storage] exception', { type: data.type, requestId, message, error: err });
        postToEhagakiIframe(buildStorageError(requestId, message));
      }
    }

    async function getCurrentPubkey() {
      const state = getNostrState();
      if (state && state.pubkey) return state.pubkey;
      if (window.nostr && window.nostr.getPublicKey) return await window.nostr.getPublicKey();
      return null;
    }

    startDelayedAuthAndSettingsSync = function () {
      clearDelayedAuthSync();
      let attempts = 0;
      const maxAttempts = 15; // 15s 程度、親ログイン初期化の遅延を待つ
      delayedAuthSyncTimer = setInterval(async () => {
        attempts += 1;
        try {
          const iframeEl = document.getElementById('ehagakiFrame');
          if (!iframeEl || !iframeEl.contentWindow || !iframeEl.src) {
            clearDelayedAuthSync();
            return;
          }
          const modalEl = document.getElementById('ehagakiModal');
          if (!modalEl || modalEl.hidden) {
            clearDelayedAuthSync();
            return;
          }

          if (embedAuthEstablished) {
            flushSettingsAfterAuth();
            clearDelayedAuthSync();
            return;
          }

          const pubkeyHex = await getCurrentPubkey().catch(() => null);
          if (pubkeyHex) {
            postToEhagakiIframe({
              namespace: EMBED_NS,
              version: 1,
              type: 'auth.login',
              payload: { pubkeyHex },
            });
          }
        } catch (e) { }

        if (attempts >= maxAttempts) {
          // 親ログインが成立しない環境向けフォールバック（匿名利用時）
          flushSettingsAfterAuth();
          clearDelayedAuthSync();
        }
      }, 1000);
    };

    // iframe postMessage 受信ハンドラ（自動クローズ + 親クライアント連携ログイン）
    if (window && !window.__ehagakiPostMessageListenerInstalled) {
      window.addEventListener('message', async function (e) {
        try {
          if (!e || !e.data) return;
          const data = e.data;

          // レガシー自動クローズ（namespace なし）
          if (typeof data === 'object' && (data.type === 'posted' || data.type === 'POST_SUCCESS')) {
            const modalEl = document.getElementById('ehagakiModal');
            const iframeEl = document.getElementById('ehagakiFrame');
            const chk = modalEl && modalEl.querySelector && modalEl.querySelector('#ehagakiAutoCloseCheckbox');
            const autoClose = chk ? chk.checked : (localStorage.getItem('ehagaki_auto_close') !== '0');
            if (autoClose) {
              if (modalEl) {
                modalEl.hidden = true;
                try { if (modalEl._overlayClickHandler) { modalEl.removeEventListener('click', modalEl._overlayClickHandler); delete modalEl._overlayClickHandler; } } catch (ee) { }
              }
              teardownEhagakiIframe();
            }
          }

          // ehagaki.embed プロトコル
          if (typeof data !== 'object' || data.namespace !== EMBED_NS || data.version !== 1) return;

          const iframeEl = document.getElementById('ehagakiFrame');
          // origin と source の検証
          if (iframeEl && iframeEl.src) {
            try {
              const expectedOrigin = new URL(iframeEl.src).origin;
              if (e.origin !== expectedOrigin) return;
            } catch (ee) { }
          }
          if (iframeEl && e.source !== iframeEl.contentWindow) return;

          if (data.type === 'storage.get' || data.type === 'storage.set' || data.type === 'storage.remove') {
            handleStorageDelegation(data);
            return;
          }

          if (data.type === 'idb.getSnapshot' || data.type === 'idb.setSnapshot') {
            handleIndexedDBDelegation(data);
            return;
          }

          // post.success / post.error（自動クローズ）
          if (data.type === 'post.success') {
            const modalEl = document.getElementById('ehagakiModal');
            const chk = modalEl && modalEl.querySelector && modalEl.querySelector('#ehagakiAutoCloseCheckbox');
            const autoClose = chk ? chk.checked : (localStorage.getItem('ehagaki_auto_close') !== '0');
            if (autoClose) {
              if (modalEl) {
                modalEl.hidden = true;
                try { if (modalEl._overlayClickHandler) { modalEl.removeEventListener('click', modalEl._overlayClickHandler); delete modalEl._overlayClickHandler; } } catch (ee) { }
              }
              teardownEhagakiIframe();
            }
            return;
          }

          // ready: ログイン済みなら auth.login を送信
          if (data.type === 'ready') {
            try {
              embedAuthEstablished = false;
              queueSettingsAfterAuth();
              const pubkeyHex = await getCurrentPubkey();
              if (pubkeyHex) {
                postToEhagakiIframe({
                  namespace: EMBED_NS,
                  version: 1,
                  type: 'auth.login',
                  payload: { pubkeyHex },
                });
              }
              // 親ページのテーマを iframe に通知（受け取って適用するかは iframe 側次第）
              try {
                const themeForEmbed = resolveVisualThemeForEmbed();
                postToEhagakiIframe({ namespace: 'ehagaki.embed', version: 1, type: 'embed.theme', payload: { theme: themeForEmbed } });
              } catch (e) { }
              // 都度生成 iframe パターンでは ready 受信後に settings.set を再送する
              try { postEmbedSettings(); } catch (e) { }
              // iPhone PWA などで親ログイン初期化が遅れる場合に備えて後追い同期
              startDelayedAuthAndSettingsSync();
            } catch (ee) { console.warn('[PostLink] ready 処理に失敗', ee); }
            return;
          }

          // auth.request: 認証要求への応答
          if (data.type === 'auth.request') {
            try {
              const pubkeyHex = await getCurrentPubkey();
              if (pubkeyHex) {
                postToEhagakiIframe({
                  namespace: EMBED_NS,
                  version: 1,
                  type: 'auth.result',
                  requestId: data.requestId,
                  payload: {
                    pubkeyHex,
                    capabilities: ['signEvent'],
                  },
                });
                embedAuthEstablished = true;
                flushSettingsAfterAuth();
                // 念のため短時間後にもう1回だけ再送
                setTimeout(() => {
                  try {
                    if (!embedAuthEstablished) return;
                    queueSettingsAfterAuth();
                    flushSettingsAfterAuth();
                  } catch (e) { }
                }, 500);
              } else {
                postToEhagakiIframe({
                  namespace: EMBED_NS,
                  version: 1,
                  type: 'auth.error',
                  requestId: data.requestId,
                  payload: {
                    code: 'parent_client_not_logged_in',
                    message: 'parent_client_not_logged_in',
                  },
                });
              }
            } catch (ee) {
              postToEhagakiIframe({
                namespace: EMBED_NS,
                version: 1,
                type: 'auth.error',
                requestId: data.requestId,
                payload: {
                  code: 'parent_client_not_logged_in',
                  message: ee instanceof Error ? ee.message : 'parent_client_not_logged_in',
                },
              });
            }
            return;
          }

          // rpc.request: 署名リクエスト等
          if (data.type === 'rpc.request') {
            const method = data.payload && data.payload.method;
            if (method === 'signEvent') {
              try {
                const state = getNostrState();
                const eventDraft = data.payload.params && data.payload.params.event;
                if (!state || !eventDraft) throw new Error('state or event not available');
                const signed = await signEventWithMode(state, eventDraft);
                postToEhagakiIframe({
                  namespace: EMBED_NS,
                  version: 1,
                  type: 'rpc.result',
                  requestId: data.requestId,
                  payload: { result: signed },
                });
              } catch (ee) {
                postToEhagakiIframe({
                  namespace: EMBED_NS,
                  version: 1,
                  type: 'rpc.error',
                  requestId: data.requestId,
                  payload: {
                    code: 'rpc_failed',
                    message: ee instanceof Error ? ee.message : 'sign failed',
                  },
                });
              }
            } else {
              postToEhagakiIframe({
                namespace: EMBED_NS,
                version: 1,
                type: 'rpc.error',
                requestId: data.requestId,
                payload: {
                  code: 'unsupported_method',
                  message: 'unsupported method: ' + String(method),
                },
              });
            }
            return;
          }

        } catch (ee) { }
      });
      window.__ehagakiPostMessageListenerInstalled = true;
    }

    // ボタンクリック時の挙動
    if (btn) {
      let overlayClickHandler = null;
      btn.onclick = async function () {
        try {
          // クリック時点の新規タブ設定を決定: checkbox > dataset > settings
          let openInNewTab = false;
          try {
            // HTML側のチェックボックスIDは 'postLinkOpenNewTabCheck'
            const chk = document.getElementById('postLinkOpenNewTabCheck');
            if (chk) openInNewTab = !!chk.checked;
            else if (btn && btn.dataset && btn.dataset.postlinkNewTab) openInNewTab = btn.dataset.postlinkNewTab === '1';
            else openInNewTab = !!settingsManager.get('postLinkOpenInNewTab');
          } catch (e) { }

          // 末尾スラッシュ/既存クエリを保持できるよう、サニタイズ済み base から target URL を構築
          const baseStr = ((urlInput && typeof urlInput.value === 'string' && urlInput.value.trim()) ? urlInput.value : (settingsManager.get('postLinkUrl') || DEFAULT_URL));
          const noteEl = document.getElementById('noteInput');
          const rawComposerText = noteEl ? (noteEl.value || '') : '';

          // 引用モード時: content 内の nostr:nevent1.../nostr:note1... 参照を抽出して quote パラメータに分離
          let composerText = rawComposerText;
          let extractedQuoteRefs = [];
          try {
            const isQuoteMode = (typeof getQuoteMode === 'function') && getQuoteMode();
            if (isQuoteMode) {
              const nostrRefPattern = /nostr:(nevent1[a-z0-9]+|note1[a-z0-9]+)/gi;
              const matches = rawComposerText.match(nostrRefPattern);
              if (matches) {
                extractedQuoteRefs = matches.map(m => m.replace(/^nostr:/i, ''));
                composerText = rawComposerText.replace(nostrRefPattern, '').replace(/^\s+|\s+$/g, '');
              }
            }
          } catch (e) { }

          let targetUrl;
          try {
            const safeBase = sanitizeUrlCandidate(baseStr) || DEFAULT_URL;
            let urlObj = null;
            try { urlObj = new URL(safeBase); } catch (e) { urlObj = new URL(safeBase, window.location.href); }
            urlObj.searchParams.set('content', composerText);
            targetUrl = urlObj.toString();
          } catch (e) {
            // フォールバック: safe base + エンコード済み content の単純結合
            const base = (sanitizeUrlCandidate(baseStr) || DEFAULT_URL).replace(/\?.*$/, '');
            targetUrl = base + '?content=' + encodeURIComponent(composerText);
          }

          // composer テキストをクリップボードへコピー後、入力欄をクリア
          try {
            if (composerText) {
              try {
                await navigator.clipboard.writeText(composerText);
                clearComposerNoteInput(noteEl);
                const publishResult = document.getElementById('publishResult');
                if (publishResult) {
                  publishResult.textContent = t('postlink.copy.copied');
                  setTimeout(() => { if (publishResult.textContent === t('postlink.copy.copied')) publishResult.textContent = ''; }, 1500);
                }
              } catch (e) {
                if (noteEl) { noteEl.focus(); noteEl.select(); }
              }
            }
          } catch (e) { }

          if (openInNewTab) {
            // リダイレクト時のクエリ保持性を高めるため、プログラム生成 anchor で開く
            try {
              const a = document.createElement('a');
              a.href = targetUrl;
              a.target = '_blank';
              a.rel = 'noopener';
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              setTimeout(() => { try { document.body.removeChild(a); } catch (e) { } }, 1000);
            } catch (e) {
              try { window.open(targetUrl, '_blank', 'noopener'); } catch (e) { try { window.location.href = targetUrl; } catch (ee) { } }
            }
            return;
          }

          // モーダルを開いて iframe を設定
          if (modal) modal.hidden = false;

          try {
            if (modal) {
              overlayClickHandler = function (ev) {
                try {
                  if (ev.target === modal) {
                    modal.hidden = true;
                    teardownEhagakiIframe();
                    try { modal.removeEventListener('click', overlayClickHandler); delete modal._overlayClickHandler; } catch (e) { }
                  }
                } catch (e) { }
              };
              modal.addEventListener('click', overlayClickHandler);
              try { modal._overlayClickHandler = overlayClickHandler; } catch (e) { }
            }
          } catch (e) { }

          if (iframe) {
            embedAuthEstablished = false;
            queueSettingsAfterAuth();
            // iframe src にはサニタイズ済みURLのみ設定
            let safeTarget = sanitizeUrlCandidate(targetUrl) || DEFAULT_URL;
            try {
              // eHagaki 側が parentOrigin を期待するため、親の origin をクエリに付与して渡す
              // 既に parentOrigin が指定されていなければ追加する
              const u = new URL(safeTarget, window.location.href);

              // 引用モード: extractedQuoteRefs を quote パラメータとして付与
              // 返信モード: nevent 形式で reply クエリを付与
              try {
                const isQuoteMode = (typeof getQuoteMode === 'function') && getQuoteMode();
                if (isQuoteMode && extractedQuoteRefs.length > 0) {
                  for (const ref of extractedQuoteRefs) {
                    try { u.searchParams.append('quote', ref); } catch (e) { }
                  }
                } else {
                  const rt = (typeof getReplyTarget === 'function') ? getReplyTarget() : null;
                  const replyId = rt && (rt.id || rt.eventId) ? (rt.id || rt.eventId) : null;
                  if (replyId && !isQuoteMode) {
                    let nevent = null;
                    try {
                      const nip19local = getNip19 && getNip19();
                      if (nip19local) {
                        try {
                          if (nip19local.nevent && typeof nip19local.nevent.encode === 'function') nevent = nip19local.nevent.encode({ id: replyId, relays: [] });
                        } catch (e) { }
                        try {
                          if (!nevent && typeof nip19local.neventEncode === 'function') nevent = nip19local.neventEncode({ id: replyId, relays: [] });
                        } catch (e) { }
                      }
                    } catch (e) { }
                    if (!nevent) nevent = 'nevent1' + replyId;
                    nevent = String(nevent).replace(/^nostr:/i, '');
                    try { u.searchParams.set('reply', nevent); } catch (e) { }
                  }
                }
              } catch (e) { }

              if (!u.searchParams.has('parentOrigin')) {
                try { u.searchParams.set('parentOrigin', window.location.origin); } catch (e) { }
              }
              // embedTheme: eHagaki の埋め込みテーマ指定（system|light|dark）を親の設定から注入
              try {
                const themeForEmbed = resolveEmbedTheme();
                try { u.searchParams.set('embedTheme', themeForEmbed); } catch (e) { }
              } catch (e) { }

              // embedLocale: eHagaki の埋め込み言語指定（ja|en）を親の設定から注入
              try {
                const localeForEmbed = resolveEmbedLocale();
                try { u.searchParams.set('embedLocale', localeForEmbed); } catch (e) { }
              } catch (e) { }

              // embedUploadEndpoint: アップロード先を起動時に強制適用
              try {
                const uploadEndpointForEmbed = readDelegatedSetting('uploadEndpoint');
                if (typeof uploadEndpointForEmbed === 'string' && uploadEndpointForEmbed) {
                  try { u.searchParams.set('embedUploadEndpoint', uploadEndpointForEmbed); } catch (e) { }
                }
              } catch (e) { }

              // embedImageQuality / embedVideoQuality: 圧縮設定を注入
              try {
                const imageQualityLevel = readDelegatedSetting('imageQualityLevel');
                if (typeof imageQualityLevel === 'string' && imageQualityLevel) {
                  try { u.searchParams.set('embedImageQuality', imageQualityLevel); } catch (e) { }
                }
              } catch (e) { }
              try {
                const videoQualityLevel = readDelegatedSetting('videoQualityLevel');
                if (typeof videoQualityLevel === 'string' && videoQualityLevel) {
                  try { u.searchParams.set('embedVideoQuality', videoQualityLevel); } catch (e) { }
                }
              } catch (e) { }

              // embed boolean settings: postMessage 前でも初回描画に反映させる
              try {
                const clientTagEnabled = parseStoredBool(readDelegatedSetting('clientTagEnabled'));
                if (clientTagEnabled !== null) {
                  try { u.searchParams.set('embedClientTag', clientTagEnabled ? 'true' : 'false'); } catch (e) { }
                }
              } catch (e) { }
              try {
                const quoteNotificationEnabled = parseStoredBool(readDelegatedSetting('quoteNotificationEnabled'));
                if (quoteNotificationEnabled !== null) {
                  try { u.searchParams.set('embedQuoteNotification', quoteNotificationEnabled ? 'true' : 'false'); } catch (e) { }
                }
              } catch (e) { }
              try {
                const mediaFreePlacement = parseStoredBool(readDelegatedSetting('mediaFreePlacement'));
                if (mediaFreePlacement !== null) {
                  try { u.searchParams.set('embedMediaFreePlacement', mediaFreePlacement ? 'true' : 'false'); } catch (e) { }
                }
              } catch (e) { }
              try {
                const showMascot = parseStoredBool(readDelegatedSetting('showMascot'));
                if (showMascot !== null) {
                  try { u.searchParams.set('embedShowMascot', showMascot ? 'true' : 'false'); } catch (e) { }
                }
              } catch (e) { }
              try {
                const showFlavorText = parseStoredBool(readDelegatedSetting('showFlavorText'));
                if (showFlavorText !== null) {
                  try { u.searchParams.set('embedShowFlavorText', showFlavorText ? 'true' : 'false'); } catch (e) { }
                }
              } catch (e) { }
              safeTarget = u.toString();
            } catch (e) { /* ignore URL manipulation errors */ }
            iframe.src = safeTarget;
            // iframe 読み込み直後にテーマ通知のみ複数回実施（settings.set は ready 後の再送を正とする）
            try {
              [300, 900, 1600].forEach((delay) => {
                setTimeout(() => {
                  try {
                    if (!iframe || !iframe.contentWindow) return;
                    const themeForEmbed = resolveVisualThemeForEmbed();
                    postToEhagakiIframe({ namespace: 'ehagaki.embed', version: 1, type: 'embed.theme', payload: { theme: themeForEmbed } });
                  } catch (e) { }
                }, delay);
              });
            } catch (e) { }
          }

          // 自動クローズ用チェックボックスを追加
          let autoCloseController = null;
          try {
            if (modal) {
              autoCloseController = addAutoCloseCheckbox(modal);
              try { modal.dataset.ehagakiAutoCloseDisabled = (localStorage.getItem('ehagaki_auto_close') === '0') ? '1' : '0'; } catch (e) { }
              try {
                const chk = modal.querySelector('#ehagakiAutoCloseCheckbox');
                if (chk) chk.addEventListener('change', () => { try { modal.dataset.ehagakiAutoCloseDisabled = chk.checked ? '0' : '1'; } catch (e) { } });
              } catch (e) { }
            }
          } catch (e) { }

          // 自動クローズ監視を開始
          try {
            const expectedClientName = (titleInput && typeof titleInput.value === 'string') ? titleInput.value : settingsManager.get('postLinkTitle') || DEFAULT_TITLE;
            const closeFn = () => {
              try {
                if (modal) {
                  try {
                    const chk = modal.querySelector && modal.querySelector('#ehagakiAutoCloseCheckbox');
                    if (chk) { try { localStorage.setItem('ehagaki_auto_close', chk.checked ? '1' : '0'); } catch (e) { } }
                  } catch (e) { }
                  modal.hidden = true;
                  try { if (modal._overlayClickHandler) { modal.removeEventListener('click', modal._overlayClickHandler); delete modal._overlayClickHandler; } } catch (e) { }
                }
              } catch (e) { }
              teardownEhagakiIframe();
            };

            let autoCloseStarted = false;
            let startSince = Math.floor(Date.now() /1000);
            let autoCloseCancel = null;
            function startAutoClose() {
              if (autoCloseStarted) return;
              if (!modal) return;
              if (modal.dataset && modal.dataset.ehagakiAutoCloseDisabled === '1') return;
              startSince = Math.floor(Date.now() /1000);
              autoCloseStarted = true;
              const timeout = settingsManager.get('postLinkAutoCloseTimeout');
              const timeoutMs = (typeof timeout === 'number') ? timeout :0;
              let cancelled = false;
              autoCloseCancel = () => { cancelled = true; };
              waitForEhagakiPublish(() => { if (!cancelled) closeFn(); }, { timeoutMs, expectedClientName, modalEl: modal, startSince })
                .catch(() => { })
                .finally(() => { autoCloseStarted = false; });
            }

            try {
              if (modal) {
                const chk = modal.querySelector('#ehagakiAutoCloseCheckbox');
                if (chk) {
                  chk.addEventListener('change', () => {
                    try {
                      modal.dataset.ehagakiAutoCloseDisabled = chk.checked ? '0' : '1';
                      if (chk.checked) startAutoClose();
                      else { if (typeof autoCloseCancel === 'function') autoCloseCancel(); }
                    } catch (e) { }
                  });
                }
                if (autoCloseController && typeof autoCloseController.isChecked === 'function' && autoCloseController.isChecked()) { setTimeout(() => { try { startAutoClose(); } catch (e) { } },150); }
              }
            } catch (e) { }

            try {
              const chk3 = modal && modal.querySelector && modal.querySelector('#ehagakiAutoCloseCheckbox');
              if (chk3 && chk3.checked) { setTimeout(() => { try { startAutoClose(); } catch (e) { } },50); }
            } catch (e) { }

          } catch (e) { }

        } catch (e) { }
      };
    }

    if (close) close.onclick = function () {
      if (modal) {
        try { modal.dataset.ehagakiAutoCloseDisabled = '1'; } catch (e) { }
        try {
          const chk = modal.querySelector && modal.querySelector('#ehagakiAutoCloseCheckbox');
          if (chk) { try { localStorage.setItem('ehagaki_auto_close', chk.checked ? '1' : '0'); } catch (e) { } }
        } catch (e) { }
        try { if (modal._overlayClickHandler) { modal.removeEventListener('click', modal._overlayClickHandler); delete modal._overlayClickHandler; } } catch (e) { }
        modal.hidden = true;
      }
      teardownEhagakiIframe();
    };

    if (external) external.href = sanitizeUrlCandidate(effectiveUrl) || DEFAULT_URL;
  } catch (e) {
    console.warn('[PostLink] setupPostLinkUI に失敗', e);
  }
}
