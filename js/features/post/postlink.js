import { t } from '../../utils/i18n.js';
import { addAutoCloseCheckbox, waitForEhagakiPublish } from '../../ui/ehagaki-autoclose.js';
import { getReplyTarget, getQuoteMode } from './composer.js';
import { clearTextShortcodeRegistry } from '../emoji/custom-emoji-store.js';
import { getNip19 } from '../../core/nostr-compat.js';
import { signEventWithMode } from './actions.js';
import { POSTLINK_DEFAULT_TITLE, POSTLINK_DEFAULT_URL } from '../../config/constants.js';
import { debounce } from '../../utils/utils.js';
import { sanitizeUrlCandidate } from '../../utils/sanitize-url.js';
import { getEventSeenOn, getReadRelays } from '../../core/relay.js';
import { findEventById } from '../../core/state.js';

const DEFAULT_TITLE = POSTLINK_DEFAULT_TITLE;
const DEFAULT_URL = POSTLINK_DEFAULT_URL;
const EMBED_STORAGE_PREFIX = 'ehagaki.embed.storage.v1:';

/** setupPostLinkUI 内で代入。チャンネル名クリックから eHagaki を開く */
let __openEhagakiWithChannel = null;
/** setupPostLinkUI 内で代入。開いていれば setContext のみ */
let __applyEhagakiChannelContext = null;

function isValidChannelContext(channelContext) {
  return !!(channelContext && typeof channelContext === 'object'
    && typeof channelContext.reference === 'string' && channelContext.reference.trim());
}

/**
 * チャンネル context を載せて eHagaki を開く（モーダル or 新規タブ）
 * @param {{ reference: string, relays?: string[], name?: string, about?: string, picture?: string }} channelContext
 */
export async function openEhagakiWithChannel(channelContext) {
  if (!isValidChannelContext(channelContext)) return false;
  if (typeof __openEhagakiWithChannel !== 'function') {
    console.warn('[PostLink] openEhagakiWithChannel: UI 未初期化');
    return false;
  }
  try {
    return await __openEhagakiWithChannel(channelContext);
  } catch (e) {
    console.warn('[PostLink] openEhagakiWithChannel に失敗', e);
    return false;
  }
}

/**
 * 既に eHagaki モーダルが開いていれば iframe 再読込なしで channel を渡す。
 * 閉じていれば openEhagakiWithChannel にフォールバック。
 */
export async function applyEhagakiChannelContext(channelContext) {
  if (!isValidChannelContext(channelContext)) return false;
  if (typeof __applyEhagakiChannelContext === 'function') {
    try {
      return await __applyEhagakiChannelContext(channelContext);
    } catch (e) {
      console.warn('[PostLink] applyEhagakiChannelContext に失敗', e);
      return false;
    }
  }
  return openEhagakiWithChannel(channelContext);
}
const EMBED_ALLOWED_STORAGE_KEYS = new Set([
  'locale',
  'themeMode',
  'darkMode',
  'uploadEndpoint',
  'clientTagEnabled',
  'quoteNotificationEnabled',
  'replyNotificationEnabled',
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

// 信頼できる静的ホワイトリスト（自身のオリジン）
const STATIC_EHAGAKI_WHITELIST = new Set([
  window.location.origin
]);

function isTrustedEhagakiOrigin(origin) {
  if (!origin) return false;
  if (STATIC_EHAGAKI_WHITELIST.has(origin)) return true;

  // ローカル開発環境のチェック (localhost, 127.0.0.1)
  try {
    const url = new URL(origin);
    if (['localhost', '127.0.0.1'].includes(url.hostname)) {
      return true;
    }
  } catch (e) { }

  // localStorageのユーザー許可済みホワイトリストのチェック
  try {
    const rawList = localStorage.getItem('ehagaki_user_whitelist');
    const userWhitelist = rawList ? JSON.parse(rawList) : [];
    if (Array.isArray(userWhitelist) && userWhitelist.includes(origin)) {
      return true;
    }
  } catch (e) { }

  return false;
}

function addToEhagakiUserWhitelist(origin) {
  if (!origin) return;
  try {
    const rawList = localStorage.getItem('ehagaki_user_whitelist');
    const userWhitelist = rawList ? JSON.parse(rawList) : [];
    if (Array.isArray(userWhitelist)) {
      if (!userWhitelist.includes(origin)) {
        userWhitelist.push(origin);
        localStorage.setItem('ehagaki_user_whitelist', JSON.stringify(userWhitelist));
      }
    }
  } catch (e) { }
}

function promptEhagakiSignature(origin, eventDraft) {
  return new Promise((resolve) => {
    const modal = document.getElementById('ehagakiConfirmModal');
    const originEl = document.getElementById('ehagakiConfirmOrigin');
    const contentEl = document.getElementById('ehagakiConfirmContent');
    const trustCheck = document.getElementById('ehagakiTrustDomainCheck');
    const yesBtn = document.getElementById('ehagakiConfirmYes');
    const noBtn = document.getElementById('ehagakiConfirmNo');

    if (!modal || !originEl || !contentEl || !yesBtn || !noBtn) {
      resolve(false);
      return;
    }

    // 表示内容設定
    originEl.textContent = origin;
    contentEl.textContent = eventDraft.content || '';
    if (trustCheck) trustCheck.checked = false;

    const cleanUp = () => {
      modal.hidden = true;
      try { modal.style.zIndex = ''; } catch (e) { }
      yesBtn.onclick = null;
      noBtn.onclick = null;
    };

    yesBtn.onclick = () => {
      const alwaysTrust = trustCheck ? trustCheck.checked : false;
      if (alwaysTrust) {
        addToEhagakiUserWhitelist(origin);
      }
      cleanUp();
      resolve(true);
    };

    noBtn.onclick = () => {
      cleanUp();
      resolve(false);
    };

    modal.hidden = false;
    try {
      if (typeof window.bringModalToFront === 'function') {
        window.bringModalToFront(modal);
      } else {
        modal.style.zIndex = '9999';
      }
    } catch (e) {
      try { modal.style.zIndex = '9999'; } catch (ee) { }
    }
  });
}

// URL サニタイズは utils/sanitize-url.js を利用

function clearComposerNoteInput(noteEl) {
  if (!noteEl) return;
  noteEl.value = '';
  clearTextShortcodeRegistry();
  try {
    noteEl.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (e) { }
}

/**
 * PostLink 用 URL サニタイズ。
 * content / reply / quote 付き URL は 2048 超になり得るため、
 * フル URL が弾かれた場合は base のみ検証してクエリを再付与する。
 */
function sanitizePostLinkTarget(targetUrl) {
  const safe = sanitizeUrlCandidate(targetUrl);
  if (safe) return safe;
  try {
    if (!targetUrl || typeof targetUrl !== 'string') return null;
    const u = new URL(targetUrl.trim(), typeof window !== 'undefined' ? window.location.href : undefined);
    const proto = (u.protocol || '').toLowerCase();
    if (proto !== 'http:' && proto !== 'https:') return null;
    const baseSafe = sanitizeUrlCandidate(u.origin + u.pathname);
    if (!baseSafe) return null;
    const out = new URL(baseSafe);
    out.search = u.search;
    out.hash = '';
    return out.toString();
  } catch (e) {
    return null;
  }
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
    let pendingComposerContextPayload = null;
    let composerContextSyncTimers = [];
    let clearDelayedAuthSync = () => {
      try {
        if (delayedAuthSyncTimer) clearInterval(delayedAuthSyncTimer);
      } catch (e) { }
      delayedAuthSyncTimer = null;
    };
    let startDelayedAuthAndSettingsSync = () => { };

    function clearComposerContextSyncTimers() {
      for (const timerId of composerContextSyncTimers) {
        try { clearTimeout(timerId); } catch (e) { }
      }
      composerContextSyncTimers = [];
    }

    function queueSettingsAfterAuth() {
      pendingSettingsAfterAuth = true;
    }

    function flushSettingsAfterAuth() {
      if (!pendingSettingsAfterAuth) return;
      try { postEmbedSettings(); } catch (e) { }
      pendingSettingsAfterAuth = false;
      // URL 起動時の参照イベント取得は auth/relay 復元前に走り失敗しやすい。
      // 認証後に composer.setContext で再ハイドレートして content を取る。
      try { scheduleComposerContextSync(); } catch (e) { }
    }

    let iframeTeardownTimer = null;
    function clearEhagakiModalZIndex() {
      try { if (modal) modal.style.zIndex = ''; } catch (e) { }
    }
    function bringEhagakiModalToFront() {
      if (!modal) return;
      try {
        if (typeof window.bringModalToFront === 'function') {
          window.bringModalToFront(modal);
        } else {
          modal.style.zIndex = '9999';
        }
      } catch (e) {
        try { modal.style.zIndex = '9999'; } catch (ee) { }
      }
    }
    function closePublicChatsPanel() {
      try {
        const panelEl = document.getElementById('ehagakiPublicChatsPanel');
        const fabBtn = document.getElementById('ehagakiPublicChatsBtn');
        if (panelEl) panelEl.hidden = true;
        if (fabBtn) fabBtn.setAttribute('aria-expanded', 'false');
      } catch (e) { }
    }
    function teardownEhagakiIframe(delayMs = 240) {
      try { clearDelayedAuthSync(); } catch (e) { }
      try { clearComposerContextSyncTimers(); } catch (e) { }
      embedAuthEstablished = false;
      pendingSettingsAfterAuth = false;
      pendingComposerContextPayload = null;
      clearEhagakiModalZIndex();
      closePublicChatsPanel();
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

    const clearWhitelistBtn = document.getElementById('clearEhagakiWhitelistBtn');
    const clearWhitelistStatus = document.getElementById('clearEhagakiWhitelistStatus');
    if (clearWhitelistBtn) {
      clearWhitelistBtn.addEventListener('click', () => {
        try {
          localStorage.removeItem('ehagaki_user_whitelist');
          if (clearWhitelistStatus) {
            clearWhitelistStatus.textContent = t('ehagaki.whitelist_cleared');
            setTimeout(() => {
              try {
                if (clearWhitelistStatus && clearWhitelistStatus.textContent === t('ehagaki.whitelist_cleared')) {
                  clearWhitelistStatus.textContent = '';
                }
              } catch (e) { }
            }, 2000);
          }
        } catch (e) {
          console.warn('[PostLink] eHagaki whitelistクリアに失敗', e);
        }
      });
    }

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

    function collectRelayHintsForEvent(ev) {
      const hints = [];
      const seen = new Set();
      const add = (url) => {
        if (typeof url !== 'string') return;
        const trimmed = url.trim();
        if (!trimmed) return;
        if (!/^wss?:\/\//i.test(trimmed)) return;
        const key = trimmed.replace(/\/+$/, '').toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        hints.push(trimmed);
      };

      try {
        const state = getNostrState();
        if (state && ev) {
          for (const r of getEventSeenOn(state, ev)) add(r);
        }
      } catch (e) { }

      if (hints.length === 0) {
        try {
          const state = getNostrState();
          if (state && state.relays) {
            for (const r of getReadRelays(state.relays)) add(r);
          }
        } catch (e) { }
      }

      return hints.slice(0, 3);
    }

    function encodeNeventForEmbed(eventId, options = {}) {
      let nevent = null;
      const relays = Array.isArray(options.relays) ? options.relays : [];
      const payload = { id: eventId, relays };
      if (options.author && typeof options.author === 'string') payload.author = options.author;
      try {
        const nip19local = getNip19 && getNip19();
        if (nip19local) {
          try {
            if (nip19local.nevent && typeof nip19local.nevent.encode === 'function') {
              nevent = nip19local.nevent.encode(payload);
            }
          } catch (e) { }
          try {
            if (!nevent && typeof nip19local.neventEncode === 'function') {
              nevent = nip19local.neventEncode(payload);
            }
          } catch (e) { }
        }
      } catch (e) { }
      if (!nevent) nevent = 'nevent1' + eventId;
      return String(nevent).replace(/^nostr:/i, '');
    }

    function encodeTargetNevent(rt) {
      const targetId = rt && (rt.id || rt.eventId) ? (rt.id || rt.eventId) : null;
      if (!targetId) return null;
      return encodeNeventForEmbed(targetId, {
        relays: collectRelayHintsForEvent(rt),
        author: (rt && typeof rt.pubkey === 'string') ? rt.pubkey : undefined,
      });
    }

    function buildComposerContextPayload(extractedQuoteRefs, content) {
      const payload = {};
      if (typeof content === 'string') payload.content = content;

      try {
        const isQuoteMode = (typeof getQuoteMode === 'function') && getQuoteMode();
        const rt = (typeof getReplyTarget === 'function') ? getReplyTarget() : null;

        if (isQuoteMode) {
          const nevent = encodeTargetNevent(rt);
          if (nevent) {
            payload.quotes = [nevent];
          } else if (extractedQuoteRefs && extractedQuoteRefs.length > 0) {
            payload.quotes = extractedQuoteRefs.map((ref) => enrichQuoteRef(ref));
          }
          return payload;
        }

        const replyNevent = encodeTargetNevent(rt);
        if (replyNevent) payload.reply = replyNevent;
      } catch (e) { }

      return payload;
    }

    function hasChannelContext(payload) {
      return !!(payload && payload.channel && typeof payload.channel === 'object'
        && typeof payload.channel.reference === 'string' && payload.channel.reference.trim());
    }

    function postEmbedComposerContext(payload, reason) {
      if (!payload || typeof payload !== 'object') return;
      const hasQuotes = Array.isArray(payload.quotes) && payload.quotes.length > 0;
      if (payload.reply == null && !hasQuotes && typeof payload.content !== 'string' && !hasChannelContext(payload)) {
        return;
      }
      const requestId = 'composer-sync-' + String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
      try {
        console.info('[PostLink] composer.setContext', reason || '', {
          requestId,
          reply: payload.reply || null,
          quotes: Array.isArray(payload.quotes) ? payload.quotes.length : 0,
          hasContent: typeof payload.content === 'string',
          channel: hasChannelContext(payload) ? payload.channel.reference : null,
        });
      } catch (e) { }
      postToEhagakiIframe({
        namespace: EMBED_NS,
        version: 1,
        type: 'composer.setContext',
        requestId,
        payload,
      });
    }

    function scheduleComposerContextSync() {
      clearComposerContextSyncTimers();
      if (!pendingComposerContextPayload) return;
      // auth 直後・リレー復元後に再送（URL 起動時の早すぎる取得失敗をリカバリ）
      [0, 900, 2200].forEach((delay) => {
        const timerId = setTimeout(() => {
          try {
            if (!pendingComposerContextPayload) return;
            const modalEl = document.getElementById('ehagakiModal');
            if (!modalEl || modalEl.hidden) return;
            postEmbedComposerContext(pendingComposerContextPayload, 'hydrate@' + delay + 'ms');
          } catch (e) { }
        }, delay);
        composerContextSyncTimers.push(timerId);
      });
    }

    function applyReplyQuoteParams(urlObj, extractedQuoteRefs) {
      try {
        const isQuoteMode = (typeof getQuoteMode === 'function') && getQuoteMode();
        const rt = (typeof getReplyTarget === 'function') ? getReplyTarget() : null;

        if (isQuoteMode) {
          // 引用: composer 内の nevent は hint 無しのことが多いので、
          // setQuoteTarget で保持しているイベントから hint 付きで再エンコードする
          const nevent = encodeTargetNevent(rt);
          if (nevent) {
            try { urlObj.searchParams.append('quote', nevent); } catch (e) { }
            return;
          }
          if (extractedQuoteRefs && extractedQuoteRefs.length > 0) {
            for (const ref of extractedQuoteRefs) {
              try { urlObj.searchParams.append('quote', enrichQuoteRef(ref)); } catch (e) { }
            }
          }
          return;
        }

        const replyNevent = encodeTargetNevent(rt);
        if (replyNevent) {
          try { urlObj.searchParams.set('reply', replyNevent); } catch (e) { }
        }
      } catch (e) { }
    }

    function applyChannelParams(urlObj, channel) {
      if (!urlObj || !channel || typeof channel !== 'object') return;
      try {
        if (typeof channel.reference === 'string' && channel.reference.trim()) {
          urlObj.searchParams.set('channel', channel.reference.trim());
        }
        if (Array.isArray(channel.relays) && channel.relays.length) {
          const relays = channel.relays
            .filter((r) => typeof r === 'string' && /^wss?:\/\//i.test(r.trim()))
            .map((r) => r.trim());
          if (relays.length) urlObj.searchParams.set('channelRelays', relays.join(','));
        }
        if (typeof channel.name === 'string' && channel.name.trim()) {
          urlObj.searchParams.set('channelName', channel.name.trim());
        }
        if (typeof channel.about === 'string' && channel.about.trim()) {
          urlObj.searchParams.set('channelAbout', channel.about.trim());
        }
        if (typeof channel.picture === 'string' && channel.picture.trim()) {
          urlObj.searchParams.set('channelPicture', channel.picture.trim());
        }
      } catch (e) { }
    }

    function enrichQuoteRef(ref) {
      try {
        const raw = String(ref || '').replace(/^nostr:/i, '');
        if (!raw) return ref;
        const nip19local = getNip19 && getNip19();
        if (!nip19local || typeof nip19local.decode !== 'function') return raw;
        const decoded = nip19local.decode(raw);
        if (!decoded) return raw;

        let eventId = null;
        let author = undefined;
        let existingRelays = [];
        if (decoded.type === 'nevent' && decoded.data) {
          eventId = decoded.data.id;
          author = decoded.data.author;
          existingRelays = Array.isArray(decoded.data.relays) ? decoded.data.relays.filter(Boolean) : [];
        } else if (decoded.type === 'note') {
          eventId = typeof decoded.data === 'string' ? decoded.data : (decoded.data && decoded.data.id);
        }
        if (!eventId) return raw;
        if (existingRelays.length > 0) return raw;

        const state = getNostrState();
        let ev = null;
        try { if (state) ev = findEventById(state, eventId); } catch (e) { }
        const relays = collectRelayHintsForEvent(ev || { id: eventId });
        if (!author && ev && typeof ev.pubkey === 'string') author = ev.pubkey;
        return encodeNeventForEmbed(eventId, { relays, author });
      } catch (e) {
        return String(ref || '').replace(/^nostr:/i, '');
      }
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

      const replyNotificationEnabled = parseStoredBool(readDelegatedSetting('replyNotificationEnabled'));
      if (replyNotificationEnabled !== null) payload.replyNotificationEnabled = replyNotificationEnabled;

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

          // レガシー自動クローズ（namespace なし）— origin/source を検証
          if (typeof data === 'object' && (data.type === 'posted' || data.type === 'POST_SUCCESS')) {
            const iframeEl = document.getElementById('ehagakiFrame');
            if (iframeEl && iframeEl.src) {
              try {
                const expectedOrigin = new URL(iframeEl.src).origin;
                if (e.origin !== expectedOrigin) return;
              } catch (ee) { return; }
            } else {
              return;
            }
            if (iframeEl && e.source !== iframeEl.contentWindow) return;

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
              // URL 起動の参照イベント取得が auth 前に失敗しても、ready 時点で setContext を送っておく
              // （pending auth 中は eHagaki 側で queue → auth 後に flush される）
              try {
                if (pendingComposerContextPayload) {
                  postEmbedComposerContext(pendingComposerContextPayload, 'ready');
                }
              } catch (e) { }
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

                // 送信元オリジンの検証
                const senderOrigin = e.origin;
                const isTrusted = isTrustedEhagakiOrigin(senderOrigin);

                if (!isTrusted) {
                  // 信頼されていない場合、モーダルを出して確認
                  const approved = await promptEhagakiSignature(senderOrigin, eventDraft);
                  if (!approved) {
                    throw new Error('User rejected the signature request.');
                  }
                }

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

    // eHagaki 起動（ボタン / チャンネル名クリック共通）
    let overlayClickHandler = null;

    function resolveOpenInNewTab() {
      try {
        const chk = document.getElementById('postLinkOpenNewTabCheck');
        if (chk) return !!chk.checked;
        if (btn && btn.dataset && btn.dataset.postlinkNewTab) return btn.dataset.postlinkNewTab === '1';
        return !!settingsManager.get('postLinkOpenInNewTab');
      } catch (e) {
        return false;
      }
    }

    function resolvePostLinkBaseStr() {
      return ((urlInput && typeof urlInput.value === 'string' && urlInput.value.trim())
        ? urlInput.value
        : (settingsManager.get('postLinkUrl') || DEFAULT_URL));
    }

    async function launchEhagakiAt(targetUrl) {
      const openInNewTab = resolveOpenInNewTab();

      if (openInNewTab) {
        pendingComposerContextPayload = null;
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
          try { window.open(targetUrl, '_blank', 'noopener'); } catch (e2) { try { window.location.href = targetUrl; } catch (ee) { } }
        }
        return;
      }

      if (modal) {
        modal.hidden = false;
        bringEhagakiModalToFront();
      }

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
        try { clearComposerContextSyncTimers(); } catch (e) { }
        queueSettingsAfterAuth();
        let safeTarget = sanitizePostLinkTarget(targetUrl) || DEFAULT_URL;
        try {
          const u = new URL(safeTarget, window.location.href);

          if (!u.searchParams.has('parentOrigin')) {
            try { u.searchParams.set('parentOrigin', window.location.origin); } catch (e) { }
          }
          try {
            const themeForEmbed = resolveEmbedTheme();
            try { u.searchParams.set('embedTheme', themeForEmbed); } catch (e) { }
          } catch (e) { }

          try {
            const localeForEmbed = resolveEmbedLocale();
            try { u.searchParams.set('embedLocale', localeForEmbed); } catch (e) { }
          } catch (e) { }

          try {
            const uploadEndpointForEmbed = readDelegatedSetting('uploadEndpoint');
            if (typeof uploadEndpointForEmbed === 'string' && uploadEndpointForEmbed) {
              try { u.searchParams.set('embedUploadEndpoint', uploadEndpointForEmbed); } catch (e) { }
            }
          } catch (e) { }

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
            const replyNotificationEnabled = parseStoredBool(readDelegatedSetting('replyNotificationEnabled'));
            if (replyNotificationEnabled !== null) {
              try { u.searchParams.set('embedReplyNotification', replyNotificationEnabled ? 'true' : 'false'); } catch (e) { }
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
        } catch (e) { /* URL操作エラーは無視 */ }
        iframe.src = safeTarget;
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
        let startSince = Math.floor(Date.now() / 1000);
        let autoCloseCancel = null;
        function startAutoClose() {
          if (autoCloseStarted) return;
          if (!modal) return;
          if (modal.dataset && modal.dataset.ehagakiAutoCloseDisabled === '1') return;
          startSince = Math.floor(Date.now() / 1000);
          autoCloseStarted = true;
          const timeout = settingsManager.get('postLinkAutoCloseTimeout');
          const timeoutMs = (typeof timeout === 'number') ? timeout : 0;
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
            if (autoCloseController && typeof autoCloseController.isChecked === 'function' && autoCloseController.isChecked()) { setTimeout(() => { try { startAutoClose(); } catch (e) { } }, 150); }
          }
        } catch (e) { }

        try {
          const chk3 = modal && modal.querySelector && modal.querySelector('#ehagakiAutoCloseCheckbox');
          if (chk3 && chk3.checked) { setTimeout(() => { try { startAutoClose(); } catch (e) { } }, 50); }
        } catch (e) { }

      } catch (e) { }
    }

    function isEhagakiModalActive() {
      try {
        if (!modal || modal.hidden) return false;
        if (!iframe || !iframe.contentWindow) return false;
        const src = iframe.getAttribute('src') || '';
        return !!src;
      } catch (e) {
        return false;
      }
    }

    __openEhagakiWithChannel = async function (channelContext) {
      const baseStr = resolvePostLinkBaseStr();
      let targetUrl;
      try {
        const safeBase = sanitizeUrlCandidate(baseStr) || DEFAULT_URL;
        let urlObj = null;
        try { urlObj = new URL(safeBase); } catch (e) { urlObj = new URL(safeBase, window.location.href); }
        applyChannelParams(urlObj, channelContext);
        targetUrl = urlObj.toString();
      } catch (e) {
        const base = (sanitizeUrlCandidate(baseStr) || DEFAULT_URL).replace(/\?.*$/, '');
        const urlObj = new URL(base, window.location.href);
        applyChannelParams(urlObj, channelContext);
        targetUrl = urlObj.toString();
      }

      // reply/quote は明示クリア（patch で前回の context が残らないようにする）
      pendingComposerContextPayload = {
        channel: channelContext,
        reply: null,
        quotes: [],
      };

      await launchEhagakiAt(targetUrl);
      return true;
    };

    __applyEhagakiChannelContext = async function (channelContext) {
      if (!isEhagakiModalActive()) {
        return __openEhagakiWithChannel(channelContext);
      }

      pendingComposerContextPayload = {
        channel: channelContext,
        reply: null,
        quotes: [],
      };
      try {
        postEmbedComposerContext(pendingComposerContextPayload, 'public-chats-pick');
        scheduleComposerContextSync();
      } catch (e) {
        console.warn('[PostLink] channel setContext に失敗', e);
        return false;
      }
      return true;
    };

    if (btn) {
      btn.onclick = async function () {
        try {
          const baseStr = resolvePostLinkBaseStr();
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
            applyReplyQuoteParams(urlObj, extractedQuoteRefs);
            targetUrl = urlObj.toString();
            pendingComposerContextPayload = buildComposerContextPayload(extractedQuoteRefs, composerText);
          } catch (e) {
            try {
              const base = (sanitizeUrlCandidate(baseStr) || DEFAULT_URL).replace(/\?.*$/, '');
              const urlObj = new URL(base, window.location.href);
              urlObj.searchParams.set('content', composerText);
              applyReplyQuoteParams(urlObj, extractedQuoteRefs);
              targetUrl = urlObj.toString();
              pendingComposerContextPayload = buildComposerContextPayload(extractedQuoteRefs, composerText);
            } catch (ee) {
              const base = (sanitizeUrlCandidate(baseStr) || DEFAULT_URL).replace(/\?.*$/, '');
              targetUrl = base + '?content=' + encodeURIComponent(composerText);
              pendingComposerContextPayload = buildComposerContextPayload(extractedQuoteRefs, composerText);
            }
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

          await launchEhagakiAt(targetUrl);
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
