import { escapeHtml, fmtTime, truncateName, truncateByGraphemeVisible, processHiddenTagChars, buildReactionEmojiTags, getReactionContent, getReactionEmojiTags, replaceBadgeEmoji } from './utils.js';
import { findEventById } from './state.js';
import { displayName, displayNameWithUsername, loadUserStatus } from './profile.js';
import { showReactionModal, showConfirmModal } from './modals.js';
import { linkifyText, updateNostrNpubLinks, updateNostrNoteLinks, fitCustomEmoji, getPreviewWithFullLinksAndEmojis, getEffectiveTextLength } from './url-parser.js';
import { parseMarkdownSafe } from './markdown.js';
import { setReplyTarget, setGeohashTarget, setQuoteTarget } from './composer.js';
import { showJsonModal } from './json-modal.js';
import { showEventModal } from './event-modal.js';
import { showMediaViewer } from './media-viewer.js';
import { t, applyTranslations } from './i18n.js';
import { replyToEvent as apiReplyToEvent } from './actions.js';
import { MAX_PREVIEW_LENGTH, MAX_PREVIEW_LINES } from './constants.js';
import { VERSION } from './version.js';
import {
  pickChannelRootId,
  getChannelLabelFromCache,
  formatChannelLabelText,
  scheduleChannelLabelUpdate,
} from './channel.js';

/**
 * イベントタグから最適な e タグのイベントIDを選ぶ。
 * kind:7 は末尾の e タグを優先。
 */
function pickETagEventId(ev) {
  if (!ev || !Array.isArray(ev.tags)) return null;
  const eTags = (ev.tags || []).filter(t => t && t[0] === 'e' && t[1]);
  if (!eTags || eTags.length === 0) return null;

  // kind:7（リアクション）は常に末尾の e タグを参照
  if (ev.kind === 7) {
    return eTags[eTags.length - 1][1];
  }

  // まず明示的な reply マーカー（4要素目）を優先
  for (const t of eTags) {
    try {
      if ((t[3] || '').toString().toLowerCase() === 'reply') return t[1];
    } catch (e) { }
  }

  // root マーカーがあっても、無印 e タグ（末尾）を優先する場合がある
  let rootId = null;
  const unmarked = [];
  for (const t of eTags) {
    try {
      const marker = (t[3] || '').toString().toLowerCase();
      if (marker === 'root') rootId = t[1];
      if (!marker) unmarked.push(t[1]);
    } catch (e) { }
  }

  // root があり無印 e タグもある場合は、末尾の無印を返信先として採用
  if (rootId && unmarked.length > 0) return unmarked[unmarked.length - 1];

  // それ以外は root を優先
  if (rootId) return rootId;

  // フォールバック: 最後の e タグを採用（マーカーなしで末尾に追加するクライアント対策）
  return eTags[eTags.length - 1][1];
}

function pickLastETagEventId(ev) {
  if (!ev || !Array.isArray(ev.tags)) return null;
  const eTags = (ev.tags || []).filter(t => t && t[0] === 'e' && t[1]);
  if (!eTags || eTags.length === 0) return null;
  return eTags[eTags.length - 1][1];
}

/**
 * kind:42 チャンネル投稿のコンテキスト行を描画
 */
export function renderChannelContext(state, ev) {
  if (!ev || ev.kind !== 42) return '';
  const rootId = pickChannelRootId(ev);
  const knownName = getChannelLabelFromCache(state, rootId);
  const labelText = formatChannelLabelText(knownName, rootId);
  const rootAttr = rootId ? ' data-channel-root-id="' + escapeHtml(rootId) + '"' : '';
  return '<div class="reply-to channel">' +
    '<span class="reply-marker">#</span>' +
    '<span class="channel-label"' + rootAttr + '>' + escapeHtml(labelText) + '</span>' +
    '</div>';
}

// clients.json のマッピングをキャッシュ読み込み
let __clientsMap = null;
let __clientsMapPromise = null;
async function loadClientsMap() {
  if (__clientsMap) return __clientsMap;
  if (__clientsMapPromise) return __clientsMapPromise;
  __clientsMapPromise = fetch(new URL('../clients.json', import.meta.url).toString())
    .then(r => r.ok ? r.json() : [])
    .then(list => {
      const m = new Map();
      if (Array.isArray(list)) {
        for (const it of list) {
          try {
            if (it && it.Name) m.set(it.Name, it.ColorCode || null);
          } catch (e) { }
        }
      }
      __clientsMap = m;
      return m;
    }).catch(e => {
      __clientsMap = new Map();
      return __clientsMap;
    });
  return __clientsMapPromise;
}


function applyMutedToneToEvent(div) {
  try {
    if (!div) return;
    if (div.classList && div.classList.contains('muted-event-dim')) return;
    div.classList.add('muted-event-dim');
  } catch (e) { }
}

function evaluateMuteState(state, pk, content) {
  const result = {
    isMuted: false,
    mutedType: null,
    matchedWord: null,
    muteApply: (localStorage.getItem('mute_apply') || '1') === '1',
    muteDisplayMode: localStorage.getItem('mute_display_mode') || 'collapse'
  };

  try {
    const muteList = (window.__nokakoiMuteList)
      ? window.__nokakoiMuteList
      : (localStorage.getItem('muteList_expanded') ? JSON.parse(localStorage.getItem('muteList_expanded')) : null);
    if (!muteList) return result;

    const pubkeysPublic = (muteList.pubkeys && Array.isArray(muteList.pubkeys.public)) ? muteList.pubkeys.public : [];
    const pubkeysPrivate = (muteList.pubkeys && Array.isArray(muteList.pubkeys.private)) ? muteList.pubkeys.private : [];
    const allMutedPubkeys = pubkeysPublic.concat(pubkeysPrivate || []);
    if (allMutedPubkeys.includes(pk)) {
      result.isMuted = true;
      result.mutedType = 'user';
      return result;
    }

    if (muteList.words) {
      const wordsPublic = (muteList.words.public && Array.isArray(muteList.words.public)) ? muteList.words.public : [];
      const wordsPrivate = (muteList.words.private && Array.isArray(muteList.words.private)) ? muteList.words.private : [];
      const allWords = wordsPublic.concat(wordsPrivate || []);
      const txt = (content || '').toLowerCase();

      const applyKind0 = (localStorage.getItem('mute_apply_kind0') || '0') === '1';
      let profileText = '';
      try {
        if (applyKind0 && state && state.profiles && state.profiles.get) {
          const prof = state.profiles.get(pk) || {};
          const nameParts = [];
          if (prof.display_name) nameParts.push(prof.display_name);
          if (prof.name && prof.name !== prof.display_name) nameParts.push(prof.name);
          const namesCombined = nameParts.join(' ');
          profileText = (namesCombined + ' ' + (prof.about || '')).toLowerCase();
        }
      } catch (e) { profileText = ''; }

      const combinedText = (txt + ' ' + profileText).toLowerCase();
      for (const w of allWords) {
        if (!w) continue;
        try {
          const lw = String(w).toLowerCase();
          if (combinedText.indexOf(lw) !== -1) {
            result.isMuted = true;
            result.mutedType = 'word';
            result.matchedWord = w;
            break;
          }
        } catch (e) { }
      }
    }
  } catch (e) {
    if (window.__nokakoiDebug) console.warn('[Renderer] ミュート判定に失敗', e);
  }

  return result;
}

// リアクション表示用フォーマット
function formatReaction(reaction, emojiTags = []) {
  const reactionContent = getReactionContent(reaction);
  const effectiveEmojiTags = getReactionEmojiTags(reaction).concat(emojiTags || []);
  if (reactionContent === '+') {
    return '⭐';
  } else if (typeof reactionContent === 'string' && reactionContent.startsWith(':') && reactionContent.endsWith(':')) {
    const shortcode = reactionContent.slice(1, -1);
    const emojiTag = effectiveEmojiTags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);
    if (emojiTag && emojiTag[2]) {
      return '<img src="' + escapeHtml(emojiTag[2]) + '" alt="' + escapeHtml(reactionContent) + '" class="custom-emoji" style="max-width: 100%; max-height: 18px; width: auto; height: auto; vertical-align: middle;">';
    }
    return escapeHtml(reactionContent);
  } else if (reactionContent) {
    return escapeHtml(reactionContent);
  } else {
    return '';
  }
}

// リアクションボタン表示を安全に更新（画像はノード生成で即時読込）
function setReactionDisplay(btn, reaction, emojiTags = []) {
  try {
    if (!btn) return;
    const reactionContent = getReactionContent(reaction);
    const effectiveEmojiTags = getReactionEmojiTags(reaction).concat(emojiTags || []);
    // 既存表示をクリア
    while (btn.firstChild) btn.removeChild(btn.firstChild);
    if (!reactionContent) return;
    if (reactionContent === '+') {
      btn.appendChild(document.createTextNode('⭐'));
      return;
    }
    // 汎用ショートコード処理: emoji タグを優先
    if (typeof reactionContent === 'string' && reactionContent.startsWith(':') && reactionContent.endsWith(':')) {
      const shortcode = reactionContent.slice(1, -1);
      const emojiTag = effectiveEmojiTags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);
      if (emojiTag && emojiTag[2]) {
        const img = document.createElement('img');
        img.src = emojiTag[2];
        img.alt = reactionContent;
        img.className = 'custom-emoji';
        img.onerror = function () { try { img.classList.add('d-none'); } catch (e) { } };
        btn.appendChild(img);
        try { if (typeof fitCustomEmoji === 'function') fitCustomEmoji(btn, 18); } catch (e) { }
        return;
      }
      // フォールバック: テキストとして表示
      btn.appendChild(document.createTextNode(reactionContent));
      return;
    }
    // 既定: そのまま表示
    btn.appendChild(document.createTextNode(reactionContent || ''));
  } catch (e) { try { btn.textContent = getReactionContent(reaction) || ''; } catch (ee) { } }
}

// リアクション表示更新の公開API
export function applyReactionToButton(btn, reaction, emojiTags = []) {
  try {
    setReactionDisplay(btn, reaction, emojiTags);
    if (!btn) return;
    try { btn.dataset.reacted = reaction ? 'true' : 'false'; } catch (e) { }
    try {
      const lbl = getReactionLabel(reaction, emojiTags);
      try { btn.dataset.reactionDisplay = lbl; } catch (e) { }
      try { btn.title = t('reaction.button.title_with_default', { display: lbl }); } catch (e) { }
    } catch (e) { }
  } catch (e) { }
}

// title/tooltip 向けのプレーンテキストラベルを返す
function getReactionLabel(reaction, emojiTags = []) {
  try {
    const reactionContent = getReactionContent(reaction);
    if (reactionContent === '+') return '⭐';
    if (reactionContent === ':nokakoi:') return formatReactionForTitle(reaction);
    if (typeof reactionContent === 'string' && reactionContent.startsWith(':') && reactionContent.endsWith(':')) {
      // :smile: のようなショートコードをそのまま表示
      return reactionContent;
    }
    if (reactionContent && reactionContent.length > 2) return reactionContent.slice(0, 2);
    return reactionContent || '';
  } catch (e) {
    return getReactionContent(reaction) || '';
  }
}

export async function applyClientBadgeToContainer(container) {
  try {
    if (!container) return;
    const badges = container.querySelectorAll('.client-badge[data-client]');
    if (!badges || !badges.length) return;
    const map = await loadClientsMap();
    badges.forEach(b => {
      try {
        const name = b.dataset.client || '';
        const color = (map && map.get && map.get(name)) || '#9ca3af';
        b.style.color = color;
        b.style.borderColor = color;
        // kindボタンがあれば高さを合わせる
        try {
          const kindBtn = container.querySelector('.btn-kind');
          if (kindBtn) {
            const rect = (kindBtn.getBoundingClientRect && kindBtn.getBoundingClientRect()) || {};
            const h = Math.round(rect.height) || kindBtn.offsetHeight || 20;
            b.style.height = h + 'px';
            b.style.lineHeight = (h - 2) + 'px';
            // フォントサイズも kind ボタンに合わせる
            try { b.style.fontSize = window.getComputedStyle(kindBtn).fontSize || b.style.fontSize; } catch (e) { }
          }
        } catch (e) { }
        b.textContent = name;
      } catch (e) { }
    });
  } catch (e) { }
}

/**
 * ユーザー設定または既定値からプレビュー最大文字数を取得
 */
function resolvePreviewMaxLength(settings) {
  const sm = (settings && settings.settingsManager) ||
    (typeof window !== 'undefined' && window.settingsManager) ||
    null;
  if (sm && typeof sm.get === 'function') {
    const v = sm.get('previewMaxLength');
    if (v && !isNaN(v)) return parseInt(v, 10);
  }
  return MAX_PREVIEW_LENGTH;
}

/**
 * 返信元イベント情報を描画（親イベント表示）'data-i18n="repost"'
 */
export function renderReplyContext(state, ev, nip19, settings) {
  const isModal = !!settings && settings.isModal === true;
  const inlineMedia = settings && settings.showTimelineMedia !== false;
  if (ev.kind !== 1 && ev.kind !== 7 && ev.kind !== 6 && ev.kind !== 16) return '';

  const eTags = (ev.tags || []).filter(t => t && t[0] === 'e' && t[1]);
  if (eTags.length === 0) return '';

  const replyToEventId = pickETagEventId(ev);
  const effectiveReplyToEventId = replyToEventId;
  const replyToEvent = findEventById(state, effectiveReplyToEventId);

  if (!replyToEvent) {
    // キャッシュにない場合のフォールバック
    if (ev.kind === 7) {
      const reactionDisplay = formatReaction(ev.content, ev.tags || []);
      // 対象不明時は生IDではなく短い操作ラベルを表示
      const label = t('reaction.button.title');
      return '<div class="reply-to reaction"><span class="reply-marker">' + reactionDisplay + '</span><span class="reply-to-author" data-event-id="' + replyToEventId + '"><span>' + label + '</span></span></div>';
    } else if (ev.kind === 6 || ev.kind === 16) {
      // 対象不明時の短いラベル
      const label = t('repost');
      return '<div class="reply-to repost"><span class="reply-marker"><img src="icon/repost.png" alt="' + escapeHtml(t('repost')) + '" class="icon"/></span><span class="reply-to-author" data-event-id="' + replyToEventId + '"><span>' + label + '</span></span></div>';
    } else {
      // 対象不明時の短いラベル
      const label = t('reply');
      return '<div class="reply-to"><span class="reply-marker"><img src="icon/reply.png" alt="' + escapeHtml(t('reply')) + '" class="icon"/></span><span class="reply-to-author" data-event-id="' + replyToEventId + '"><span>' + label + '</span></span></div>';
    }
  }

  const replyToAuthor = truncateName(displayName(state, replyToEvent.pubkey, nip19));
  const replyToContent = replyToEvent.content || '';
  const replyToPubkey = replyToEvent.pubkey;

  // 判読しづらい著者ID（hex pubkeyや過度に長い表示名）を判定
  // 表示名がない場合、または表示名がhex pubkeyそのものの場合のみ opaque 扱い
  const isOpaqueAuthor = (function (a, pk) {
    try {
      if (!a) return true; // missing display name => opaque
      if (pk && typeof pk === 'string' && /^[0-9a-f]{64}$/i.test(pk) && typeof a === 'string' && a.toLowerCase() === pk.toLowerCase()) return true;
      if (typeof a === 'string' && /^[0-9a-f]{64}$/i.test(a) && (!pk || a.toLowerCase() === pk.toLowerCase())) return true;
      return false;
    } catch (e) { return false; }
  })(replyToAuthor, replyToPubkey);

  // MAX_PREVIEW_LENGTH適用
  let replyContentHtml = '';
  if (isModal) {
    // モーダルは従来通り全文HTML化
    replyContentHtml = linkifyText(replyToContent, replyToEvent && replyToEvent.tags ? replyToEvent.tags : [], { inlineMedia });
  } else {
    const tags = replyToEvent && replyToEvent.tags ? replyToEvent.tags : [];
    const previewMaxLength = resolvePreviewMaxLength(settings);
    if (getEffectiveTextLength(replyToContent) > previewMaxLength || replyToContent.split('\n').length > MAX_PREVIEW_LINES) {
      const previewText = getPreviewWithFullLinksAndEmojis(replyToContent, previewMaxLength, MAX_PREVIEW_LINES);
      replyContentHtml = `<span class="reply-preview-text">${linkifyText(previewText, tags, { inlineMedia: false })}</span>`;
      if (previewText.length < replyToContent.length) {
        replyContentHtml += `<button type="button" class="read-more-btn secondary reply-read-more">${t('see_detail','省略されています')}</button>`;
      }
    } else {
      replyContentHtml = `<span class="reply-preview-text">${linkifyText(replyToContent, tags, { inlineMedia: false })}</span>`;
    }
  }

  if (ev.kind === 7) {
    const reactionDisplay = formatReaction(ev.content, ev.tags || []);
    const isReferenceReaction = replyToEvent && (replyToEvent.kind === 6 || replyToEvent.kind === 16 || replyToEvent.kind === 7);
    const repostReferenceHtml = isReferenceReaction
      ? renderReplyContext(state, replyToEvent, nip19, settings)
      : '';
    const reactionContentHtml = repostReferenceHtml || replyContentHtml;
    const reactionContentEventId = (replyToEvent && replyToEvent.id) ? replyToEvent.id : '';
    if (isOpaqueAuthor) {
      const label = t('reaction.button.title');
      return '<div class="reply-to reaction"><span class="reply-marker">' + reactionDisplay + '</span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + label + '</span></span><div class="reply-to-content" data-event-id="' + reactionContentEventId + '">' + reactionContentHtml + '</div></div>';
    }
    const label = t('reaction.label', { author: escapeHtml(replyToAuthor) });
    return '<div class="reply-to reaction"><span class="reply-marker">' + reactionDisplay + '</span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + replaceBadgeEmoji(label) + '</span></span><div class="reply-to-content" data-event-id="' + reactionContentEventId + '">' + reactionContentHtml + '</div></div>';
  } else if (ev.kind === 6 || ev.kind === 16) {
    if (isOpaqueAuthor) {
      const label = t('repost');
      return '<div class="reply-to repost"><span class="reply-marker"><img src="icon/repost.png" alt="' + escapeHtml(t('repost')) + '" class="icon"/></span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + label + '</span></span><div class="reply-to-content" data-event-id="' + (replyToEvent.id || '') + '">' + replyContentHtml + '</div></div>';
    }
    const label = t('repost.label', { author: escapeHtml(replyToAuthor) });
    return '<div class="reply-to repost"><span class="reply-marker"><img src="icon/repost.png" alt="' + escapeHtml(t('repost')) + '" class="icon"/></span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + replaceBadgeEmoji(label) + '</span></span><div class="reply-to-content" data-event-id="' + (replyToEvent.id || '') + '">' + replyContentHtml + '</div></div>';
  } else {
    if (isOpaqueAuthor) {
      const label = t('reply');
      return '<div class="reply-to"><span class="reply-marker"><img src="icon/reply.png" alt="' + escapeHtml(t('reply')) + '" class="icon"/></span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + label + '</span></span><div class="reply-to-content" data-event-id="' + (replyToEvent.id || '') + '">' + replyContentHtml + '</div></div>';
    }
    const label = t('reply.label', { author: escapeHtml(replyToAuthor) });
    return '<div class="reply-to"><span class="reply-marker"><img src="icon/reply.png" alt="' + escapeHtml(t('reply')) + '" class="icon"/></span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + replaceBadgeEmoji(label) + '</span></span><div class="reply-to-content" data-event-id="' + (replyToEvent.id || '') + '">' + replyContentHtml + '</div></div>';
  }
}

/**
 * リアクションボタンのセットアップ（タッチ・クリック対応）
 */
export function setupReactButton(div, ev, settings, settingsManager, reactToEvent) {
  const reactBtn = div.querySelector('.btn-react');
  if (!reactBtn) return;

  const resolveImmediateEmojiTags = function (reaction) {
    let emojiTags = getReactionEmojiTags(reaction);
    try {
      if (!emojiTags.length && typeof window !== 'undefined' && window.userKind7Memory && typeof window.userKind7Memory.get === 'function') {
        const mem = window.userKind7Memory.get(ev && ev.id);
        if (mem && typeof mem === 'object' && Array.isArray(mem.emojiTags)) {
          emojiTags = mem.emojiTags;
        }
      }
    } catch (e) { }
    if (!emojiTags.length && ev && Array.isArray(ev.tags)) {
      emojiTags = ev.tags;
    }

    try {
      const fallbackEmojiTags = buildReactionEmojiTags(reaction);
      for (const emojiTag of fallbackEmojiTags) {
        const hasEmojiTag = (emojiTags || []).some(tag => Array.isArray(tag) && tag[0] === 'emoji' && tag[1] === emojiTag[1] && tag[2]);
        if (!hasEmojiTag) {
          emojiTags = (emojiTags || []).concat([emojiTag]);
        }
      }
    } catch (e) { }

    return emojiTags;
  };

  const applyReactionUI = function (reaction) {
    const emojiTags = resolveImmediateEmojiTags(reaction);
    setReactionDisplay(reactBtn, reaction, emojiTags);
    reactBtn.dataset.reacted = reaction ? 'true' : 'false';
    try {
      const lbl = getReactionLabel(reaction, emojiTags);
      reactBtn.dataset.reactionDisplay = lbl;
      reactBtn.title = t('reaction.button.title_with_default', { display: lbl });
    } catch (e) { }
  };

  const restoreReactionUI = function () {
    const stored = settingsManager.getUserReaction(ev.id);
    if (stored) {
      applyReactionUI(stored);
      return;
    }
    reactBtn.innerHTML = '<img src="icon/star.png" alt="" class="icon-btn" data-i18n-alt="reaction.button.title">';
    try { reactBtn.dataset.reacted = 'false'; } catch (e) { }
    try { delete reactBtn.dataset.reactionDisplay; } catch (e) { }
    try { reactBtn.title = t('reaction.button.title'); } catch (e) { }
  };

  // デフォルト変更時にタイトルを更新できるよう、グローバルリスナーを1回だけ登録
  try { installReactionDefaultListener(settingsManager); } catch (e) { }

  const userReaction = settingsManager.getUserReaction(ev.id);
  if (userReaction) {
    applyReactionUI(userReaction);
  }

  const currentDefault = (settingsManager && typeof settingsManager.get === 'function') ? (settingsManager.get('reactionDefault') || settings.reactionDefault || '+') : (settings.reactionDefault || '+');
  const display = formatReactionForTitle(currentDefault);
  // 初期titleと i18n 再適用用に既定表示を保存
  try { reactBtn.dataset.reactionDisplay = reactBtn.dataset.reactionDisplay || display; } catch (e) { }
  reactBtn.title = t('reaction.button.title_with_default', { display: display });

  let lpTimer = null;
  let lpTriggered = false;
  let suppressClickUntil = 0;

  const openSetDefault = function () {
    lpTriggered = true;
    // モーダル表示時点のデフォルト値を渡す
    const nowDefault = (settingsManager && typeof settingsManager.get === 'function') ? (settingsManager.get('reactionDefault') || settings.reactionDefault || '+') : (settings.reactionDefault || '+');
    const runReactOnce = async (symbol) => {
      const ok = await reactToEvent(ev, symbol);
      if (!ok) {
        restoreReactionUI();
        throw new Error('react_failed');
      }
      settingsManager.saveUserReaction(ev.id, symbol);
      applyReactionUI(symbol);
    };
    showReactionModal(nowDefault, (symbol) => {
      settingsManager.set('reactionDefault', symbol);
      const display = formatReactionForTitle(symbol);
      reactBtn.title = t('reaction.button.title_with_default', { display: display });
    }, settingsManager, {
      showReactActions: true,
      onSaveAndReact: runReactOnce,
      onReactOnly: runReactOnce
    });
    suppressClickUntil = Date.now() + 700;
  };

  // 長押し（タッチ）でデフォルト設定
  reactBtn.addEventListener('touchstart', function (e) {
    lpTriggered = false;
    try { if (lpTimer) clearTimeout(lpTimer); } catch { }
    lpTimer = setTimeout(function () {
      try { e.preventDefault(); } catch { }
      openSetDefault();
    }, 600);
  }, { passive: false });

  const cancelLp = function () {
    try { if (lpTimer) clearTimeout(lpTimer); } catch { }
    lpTimer = null;
  };

  reactBtn.addEventListener('touchend', function (e) {
    cancelLp();
    if (lpTriggered) {
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch { }
      return false;
    }
  }, { passive: false });

  // touchmove/touchcancel は長押しタイマー解除のみなので passive 指定で警告を回避
  reactBtn.addEventListener('touchmove', cancelLp, { passive: true });
  reactBtn.addEventListener('touchcancel', cancelLp, { passive: true });

  // クリックでリアクション送信
  reactBtn.onclick = async function (e) {
    if (Date.now() < suppressClickUntil) return;

    if (e && (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey)) {
      // モーダルでカスタムリアクション
      // モーダルには現在のデフォルト値を渡す
      const nowDefault = (settingsManager && typeof settingsManager.get === 'function') ? (settingsManager.get('reactionDefault') || settings.reactionDefault || '+') : (settings.reactionDefault || '+');
      const runReactOnce = async (symbol) => {
        const ok = await reactToEvent(ev, symbol);
        if (!ok) {
          restoreReactionUI();
          throw new Error('react_failed');
        }
        settingsManager.saveUserReaction(ev.id, symbol);
        applyReactionUI(symbol);
      };

      showReactionModal(nowDefault, (symbol) => {
        settingsManager.set('reactionDefault', symbol);
        const display = formatReactionForTitle(symbol);
        reactBtn.title = t('reaction.button.title_with_default', { display: display });
      }, settingsManager, {
        showReactActions: true,
        onSaveAndReact: runReactOnce,
        onReactOnly: runReactOnce
      });
    } else {
      // デフォルトリアクション送信
      const reactionSym = (settingsManager && typeof settingsManager.get === 'function') ? (settingsManager.get('reactionDefault') || settings.reactionDefault || '+') : (settings.reactionDefault || '+');
      const ok = await reactToEvent(ev, reactionSym);
      if (!ok) {
        restoreReactionUI();
        return;
      }
      settingsManager.saveUserReaction(ev.id, reactionSym);
      applyReactionUI(reactionSym);
    }
  };

  // 右クリックでデフォルト設定
  reactBtn.oncontextmenu = function (e) {
    e.preventDefault();
    const nowDefault = (settingsManager && typeof settingsManager.get === 'function') ? (settingsManager.get('reactionDefault') || settings.reactionDefault || '+') : (settings.reactionDefault || '+');
    const runReactOnce = async (symbol) => {
      const ok = await reactToEvent(ev, symbol);
      if (!ok) throw new Error('react_failed');
      settingsManager.saveUserReaction(ev.id, symbol);
      applyReactionUI(symbol);
    };
    showReactionModal(nowDefault, (symbol) => {
      settingsManager.set('reactionDefault', symbol);
      const display = formatReactionForTitle(symbol);
      reactBtn.title = t('reaction.button.title_with_default', { display: display });
      try { reactBtn.dataset.reactionDisplay = display; } catch (e) { }
    }, settingsManager, {
      showReactActions: true,
      onSaveAndReact: runReactOnce,
      onReactOnly: runReactOnce
    });
    return false;
  };
  // このボタンに専用リスナーがあることを示す（委譲側でスキップ可能）
  try { reactBtn.dataset.listenerInstalled = '1'; } catch (e) { }
}

/**
 * リアクションタイトル用フォーマット（HTMLなし）
 */
function formatReactionForTitle(reaction) {
  const reactionContent = getReactionContent(reaction);
  if (reactionContent === ':nokakoi:') {
    return '🖼️nokakoi';
  } else {
    return reactionContent;
  }
}

/**
 * 返信ボタンのセットアップ
 */
export function setupReplyButton(div, ev, replyToEvent) {
  const replyBtn = div.querySelector('.btn-reply');
  if (!replyBtn) return;

  replyBtn.onclick = function () {
    replyToEvent(ev);
  };
}

/**
 * リポストボタンのセットアップ
 */
export function setupRepostButton(div, ev, repostEvent) {
  const repostBtn = div.querySelector('.btn-repost');
  if (!repostBtn) return;

  repostBtn.onclick = async function () {
    // 確認モーダル表示
    showConfirmModal(
      t('repost.confirm.title'),
      t('repost.confirm.message'),
      async () => {
        try {
          repostBtn.disabled = true;
          repostBtn.innerHTML = '...';

          const success = await repostEvent(ev);
          if (success) {
            repostBtn.innerHTML = '✓';
            setTimeout(() => {
              repostBtn.innerHTML = '<img src="icon/repost.png" alt="' + t('repost') + '" class="icon-btn">';
              repostBtn.disabled = false;
            }, 2000);
          } else {
            repostBtn.innerHTML = '<img src="icon/repost.png" alt="' + t('repost') + '" class="icon-btn">';
            repostBtn.disabled = false;
          }
        } catch (e) {
          console.error(t('repost.failed'), e);
          repostBtn.innerHTML = '<img src="icon/repost.png" alt="' + t('repost') + '" class="icon-btn">';
          repostBtn.disabled = false;
        }
      }
    );
  };
}

/**
 * イベントをDOM要素として描画
 */
function buildEventContainer(ev) {
  const div = document.createElement('div');
  div.className = 'event';
  div.dataset.eventId = ev.id;
  div.dataset.kind = ev.kind;
  if (ev.kind === 42) div.classList.add('event-channel');
  return div;
}

function buildEventNameBlockHtml(state, ev, settings, names, statusHtml) {
  const pk = ev.pubkey;
  const showAvatars = settings.showAvatars !== false;
  let avatarHtml = '';
  if (showAvatars) {
    const profile = state.profiles.get(pk);
    const avatarUrl = (profile && profile.picture) || '';
    if (avatarUrl) {
      avatarHtml = '<img src="' + escapeHtml(avatarUrl) + '" alt="avatar" class="avatar" onerror="this.classList.add(\'d-none\')">';
    }
  }

  let namePrimaryHtml = '<span class="name" data-pubkey="' + pk + '">' + replaceBadgeEmoji(escapeHtml(names.main)) + '</span>';
  if (ev.kind === 20000) {
    const hash = (pk && pk.length >= 4) ? '#' + pk.slice(-4) : '';
    if (hash) {
      namePrimaryHtml += '<span class="username">' + escapeHtml(hash) + '</span>';
    }
    if (ev.tags) {
      const gTag = ev.tags.find(t => t[0] === 'g');
      if (gTag && gTag[1]) {
        namePrimaryHtml += '<span class="username omochat-geohash" data-geohash="' + escapeHtml(gTag[1]) + '" style="margin-left:4px; opacity:0.8; cursor:pointer;">📍' + escapeHtml(gTag[1]) + '</span>';
      }
    }
  } else if (names.sub) {
    namePrimaryHtml += '<span class="username">@' + escapeHtml(names.sub) + '</span>';
  }

  return (
    '<div class="event-name">' +
    avatarHtml +
    '<div class="event-name-text">' +
    '<div class="event-name-primary">' + namePrimaryHtml + '</div>' +
    statusHtml +
    '</div></div>'
  );
}

function renderEventContent(state, ev, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent, contentEl, allowInlineMedia) {
  if (!contentEl) return;
  const content = ev.content || '';
  if (ev.kind !== 7 && ev.kind !== 6 && ev.kind !== 16) {
    const previewMaxLength = (settingsManager && typeof settingsManager.get === 'function' && settingsManager.get('previewMaxLength')) ? parseInt(settingsManager.get('previewMaxLength'), 10) : MAX_PREVIEW_LENGTH;
    if (getEffectiveTextLength(content) > previewMaxLength || content.split('\n').length > MAX_PREVIEW_LINES) {
      const previewText = getPreviewWithFullLinksAndEmojis(content, previewMaxLength, MAX_PREVIEW_LINES);
      contentEl.innerHTML = linkifyText(previewText, ev.tags || [], { inlineMedia: allowInlineMedia });
      if (previewText.length < content.length) {
        const seeDetailBtn = document.createElement('button');
        seeDetailBtn.type = 'button';
        seeDetailBtn.className = 'read-more-btn secondary';
        seeDetailBtn.textContent = t && typeof t === 'function' ? t('see_detail') : '省略されています';
        contentEl.appendChild(seeDetailBtn);
        seeDetailBtn.addEventListener('click', function() {
          showEventModal(ev, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
        });
      }
      updateNostrNpubLinks(contentEl);
      updateNostrNoteLinks(
        contentEl,
        showEventModal,
        state,
        nip19,
        reactToEvent,
        replyToEvent,
        repostEvent,
        settings,
        settingsManager
      );
      try { processHiddenTagChars(contentEl); } catch (e) { }
    } else {
      contentEl.innerHTML = linkifyText(content, ev.tags || [], { inlineMedia: allowInlineMedia });
      updateNostrNpubLinks(contentEl);
      updateNostrNoteLinks(
        contentEl,
        showEventModal,
        state,
        nip19,
        reactToEvent,
        replyToEvent,
        repostEvent,
        settings,
        settingsManager
      );
      try { processHiddenTagChars(contentEl); } catch (e) { }
    }
  } else {
    contentEl.classList.add('d-none');
  }
}

function setupContentWarning(div, ev, contentEl, isCwExpanded, markCwExpanded) {
  try {
    const cwTag = (ev.tags || []).find(t => t[0] === 'content-warning');
    if (cwTag) {
      div.dataset.hasCw = '1';
      const reason = cwTag[1] || '';

      if (!isCwExpanded) {
        if (contentEl) contentEl.classList.add('d-none');

        const foldBar = document.createElement('div');
        foldBar.className = 'muted-fold-bar muted-small cw-fold-bar';

        const left = document.createElement('div');
        left.className = 'cw-fold-bar-left';

        const cwLabel = document.createElement('span');
        cwLabel.className = 'cw-fold-bar-label';

        if (reason) {
          cwLabel.textContent = t('content_warning.reason', { reason: reason });
        } else {
          cwLabel.setAttribute('data-i18n', 'content_warning');
          cwLabel.textContent = t('content_warning');
        }
        left.appendChild(cwLabel);
        foldBar.appendChild(left);

        const expandBtn = document.createElement('button');
        expandBtn.type = 'button';
        expandBtn.className = 'secondary small cw-fold-bar-btn';
        expandBtn.setAttribute('data-i18n', 'fold.show');
        expandBtn.textContent = t('fold.show');

        foldBar.appendChild(expandBtn);

        if (contentEl && contentEl.parentNode) {
          contentEl.parentNode.insertBefore(foldBar, contentEl);
        }

        expandBtn.onclick = function (e) {
          try {
            if (contentEl) contentEl.classList.remove('d-none');
            try { if (markCwExpanded) markCwExpanded(ev.id, true); } catch (e) { }
            try { foldBar.parentNode && foldBar.parentNode.removeChild(foldBar); } catch (e) { }
          } catch (e) { }
        };
      } else if (contentEl) {
        contentEl.classList.remove('d-none');
      }
    }
  } catch (e) {
    console.warn('[Renderer] CW 処理に失敗', e);
  }
}

function setupMuteCollapse(div, ev, contentEl, muteState, isMutedExpanded, markMutedExpanded) {
  try {
    const isMuted = !!muteState.isMuted;
    const mutedType = muteState.mutedType;
    const muteApply = !!muteState.muteApply;
    const muteDisplayMode = muteState.muteDisplayMode || 'collapse';

    if (isMuted && !muteApply) {
      try {
        div.classList.add('muted-event-soft');
        applyMutedToneToEvent(div);
      } catch (e) { }
    }

    if (isMuted && muteApply) {
      applyMutedToneToEvent(div);
      if (muteDisplayMode === 'hide') {
        div.classList.add('muted-event', 'muted-hidden', 'd-none');
        return true;
      }

      div.dataset.muteCollapsible = '1';
      div.classList.add('muted-event');
      if (!isMutedExpanded) {
        try {
          if (contentEl) contentEl.classList.add('d-none');
          const actionReact = div.querySelector('.event-actions-react'); if (actionReact) actionReact.classList.add('d-none');
          const actionBottom = div.querySelector('.event-actions-bottom'); if (actionBottom) actionBottom.classList.add('d-none');
          const topRowEl = div.querySelector('.event-top-row');
          if (topRowEl) topRowEl.classList.add('d-none');

          const cwBar = div.querySelector('.cw-fold-bar');
          if (cwBar) cwBar.classList.add('d-none');
        } catch (e) { }

        const foldBar = document.createElement('div');
        foldBar.className = 'muted-fold-bar muted-small';

        const left = document.createElement('div');
        left.className = 'muted-fold-bar-left';

        try {
          const topRowEl = div.querySelector('.event-top-row');
          if (topRowEl) {
            const cloned = topRowEl.cloneNode(true);
            const clonedActions = cloned.querySelector('.event-actions-react');
            if (clonedActions) clonedActions.parentNode && clonedActions.parentNode.removeChild(clonedActions);
            const clonedBottom = cloned.querySelector('.event-actions-bottom');
            if (clonedBottom) clonedBottom.parentNode && clonedBottom.parentNode.removeChild(clonedBottom);

            const img = cloned.querySelector('img.avatar');
            if (img) {
              img.className = 'avatar muted-avatar';
            }
            const nameSpan = cloned.querySelector('.name');
            if (nameSpan) nameSpan.classList.add('muted-name');

            left.appendChild(cloned);

            const muteLabel = document.createElement('span');
            muteLabel.className = 'mute-event-label';
            try {
              if (mutedType === 'user') {
                muteLabel.textContent = t('muted.user');
              } else if (mutedType === 'word') {
                muteLabel.textContent = t('muted.word');
              } else {
                muteLabel.textContent = t('muted.generic');
              }
            } catch (e) {
              if (mutedType === 'user') muteLabel.setAttribute('data-i18n', 'muted.user');
              else if (mutedType === 'word') muteLabel.setAttribute('data-i18n', 'muted.word');
              else muteLabel.setAttribute('data-i18n', 'muted.generic');
            }

            const labelAndBtnWrap = document.createElement('div');
            labelAndBtnWrap.className = 'mute-label-wrap';
            labelAndBtnWrap.appendChild(muteLabel);
            left.appendChild(labelAndBtnWrap);
          } else {
            const lbl = mutedType === 'user' ? t('muted.user') : (mutedType === 'word' ? t('muted.word') : t('muted.generic'));
            left.innerHTML = '<span class="mute-event-label">' + lbl + '</span>';
          }
        } catch (e) {
          left.textContent = t('muted.generic');
        }

        const expandBtn = document.createElement('button');
        expandBtn.type = 'button';
        expandBtn.className = 'secondary small muted-fold-expand-btn';
        expandBtn.textContent = t('fold.show');

        try {
          const wrapper = left.querySelector('.mute-label-wrap');
          const muteSpan = wrapper && wrapper.querySelector('span');
          const muteColor = muteSpan ? (muteSpan.style.color || getComputedStyle(muteSpan).color) : null;
          if (muteColor) {
            expandBtn.style.color = muteColor;
            expandBtn.style.borderColor = muteColor;
          } else {
            expandBtn.style.color = 'var(--muted)';
            expandBtn.style.borderColor = 'var(--muted)';
          }
          if (wrapper) {
            expandBtn.style.marginLeft = '6px';
            wrapper.appendChild(expandBtn);
          }
        } catch (e) {
          expandBtn.style.color = 'var(--muted)';
          expandBtn.style.borderColor = 'var(--muted)';
        }

        foldBar.appendChild(left);

        const replyNode = div.querySelector('.reply-to');
        if (replyNode && replyNode.parentNode) replyNode.parentNode.insertBefore(foldBar, replyNode.nextSibling);
        else if (contentEl && contentEl.parentNode) contentEl.parentNode.insertBefore(foldBar, contentEl);
        else div.insertBefore(foldBar, div.firstChild);

        expandBtn.onclick = function (e) {
          try {
            const cwTag = (ev.tags || []).find(t => t[0] === 'content-warning');
            const cwBar = div.querySelector('.cw-fold-bar');

            if (cwTag && cwBar) {
              cwBar.classList.remove('d-none');
            } else {
              if (contentEl) contentEl.classList.remove('d-none');
            }

            const actionReact = div.querySelector('.event-actions-react'); if (actionReact) actionReact.classList.remove('d-none');
            const actionBottom = div.querySelector('.event-actions-bottom'); if (actionBottom) actionBottom.classList.remove('d-none');
            const topRowEl2 = div.querySelector('.event-top-row');
            if (topRowEl2) topRowEl2.classList.remove('d-none');
            try { if (markMutedExpanded) markMutedExpanded(ev.id, true); } catch (e) { }
            try { foldBar.parentNode && foldBar.parentNode.removeChild(foldBar); } catch (e) { }
          } catch (e) {
            console.warn('[Renderer] ミュートイベントの展開に失敗', e);
          }
        };
      } else {
        try {
          const actionReact = div.querySelector('.event-actions-react'); if (actionReact) actionReact.classList.remove('d-none');
          const actionBottom = div.querySelector('.event-actions-bottom'); if (actionBottom) actionBottom.classList.remove('d-none');
          const topRowEl = div.querySelector('.event-top-row'); if (topRowEl) topRowEl.classList.remove('d-none');
          if (contentEl) contentEl.classList.remove('d-none');
          const cwBar = div.querySelector('.cw-fold-bar');
          if (cwBar) cwBar.classList.remove('d-none');
        } catch (e) { }
      }
    }
  } catch (e) {
    if (window.__nokakoiDebug) console.warn('[Renderer] ミュートUI処理に失敗', e);
  }
  return false;
}

function bindProfileClickHandlers(div, ev, state, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent) {
  const pk = ev.pubkey;

  // プロフィール名クリックでプロフィールモーダル表示
  const nameEl = div.querySelector('.name');
  if (nameEl) {
    nameEl.onclick = function () {
      invokeShowProfileModalProxy(pk);
    };
  }

  // omochat geohash クリック
  const geohashEl = div.querySelector('.omochat-geohash');
  if (geohashEl) {
    geohashEl.onclick = function (e) {
      e.stopPropagation();
      const gh = geohashEl.dataset.geohash;
      if (gh) {
        setGeohashTarget(gh);
      }
    };
  }

  // 参照元の名前クリックでプロフィールモーダル表示 or イベント取得
  const replyToAuthorEl = div.querySelector('.reply-to-author[data-pubkey], .reply-to-author[data-event-id]');
  if (replyToAuthorEl) {
    if (replyToAuthorEl.hasAttribute('data-pubkey')) {
      replyToAuthorEl.onclick = function () {
        const pubkey = replyToAuthorEl.getAttribute('data-pubkey');
        if (pubkey) {
          invokeShowProfileModalProxy(pubkey);
        }
      };
    } else if (replyToAuthorEl.hasAttribute('data-event-id')) {
      replyToAuthorEl.onclick = async function () {
        const eventId = replyToAuthorEl.getAttribute('data-event-id');
        if (eventId && state && state.pool) {
          const { getReadRelays } = await import('./relay.js');
          const relays = getReadRelays(state.relays);
          let event = null;
          if (relays && relays.length > 0) {
            event = await state.pool.get(relays, { ids: [eventId] });
          }
          if (event) {
            showEventModal(event, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
          }
        }
      };
    }
  }

  // 引用の参照元の名前クリックでプロフィールモーダル表示（複数対応）
  const quoteLabelEls = div.querySelectorAll('.event-quote-label.name[data-pubkey]');
  quoteLabelEls.forEach(labelEl => {
    labelEl.onclick = function () {
      const pubkey = labelEl.getAttribute('data-pubkey');
      if (pubkey) {
        invokeShowProfileModalProxy(pubkey);
      }
    };
  });
}

function bindJsonButtonHandlers(div, ev, nip19) {
  // JSONボタンセットアップ
  const jsonBtns = div.querySelectorAll('.btn-json');
  jsonBtns.forEach(jsonBtn => {
    let longPressTimer = null;
    let longPressTriggered = false;
    let suppressClickUntil = 0;

    jsonBtn.addEventListener('touchstart', function (e) {
      longPressTriggered = false;
      try { if (longPressTimer) clearTimeout(longPressTimer); } catch { }

      longPressTimer = setTimeout(function () {
        longPressTriggered = true;
        try { e.preventDefault(); } catch { }

        showConfirmModal(
          '',
          t('lumilumi.confirm'),
          () => {
            try {
              let nevent = null;
              if (nip19) {
                try {
                  if (nip19.neventEncode && typeof nip19.neventEncode === 'function') {
                    nevent = nip19.neventEncode({ id: ev.id, relays: [] });
                  } else if (nip19.nevent && typeof nip19.nevent.encode === 'function') {
                    nevent = nip19.nevent.encode({ id: ev.id, relays: [] });
                  }
                } catch (ex) { }
              }
              if (!nevent) nevent = 'nevent1' + ev.id;
              window.open('https://lumilumi.app/' + nevent, '_blank', 'noopener,noreferrer');
            } catch (ex) { }
          }
        );

        suppressClickUntil = Date.now() + 700;
      }, 600);
    }, { passive: false });

    const cancelLongPress = function () {
      try { if (longPressTimer) clearTimeout(longPressTimer); } catch { }
      longPressTimer = null;
    };

    jsonBtn.addEventListener('touchend', function (e) {
      const wasTriggered = longPressTriggered;
      cancelLongPress();
      if (wasTriggered) {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch { }
        return false;
      }
    }, { passive: false });

    jsonBtn.addEventListener('touchmove', cancelLongPress, { passive: true });
    jsonBtn.addEventListener('touchcancel', cancelLongPress, { passive: true });

    jsonBtn.onclick = function () {
      if (Date.now() < suppressClickUntil) return;
      showJsonModal(ev);
    };

    jsonBtn.oncontextmenu = function (e) {
      e.preventDefault();
      showConfirmModal(
        '',
        t('lumilumi.confirm'),
        () => {
          try {
            let nevent = null;
            if (nip19) {
              try {
                if (nip19.neventEncode && typeof nip19.neventEncode === 'function') {
                  nevent = nip19.neventEncode({ id: ev.id, relays: [] });
                } else if (nip19.nevent && typeof nip19.nevent.encode === 'function') {
                  nevent = nip19.nevent.encode({ id: ev.id, relays: [] });
                }
              } catch (ex) { }
            }
            if (!nevent) nevent = 'nevent1' + ev.id;
            window.open('https://lumilumi.app/' + nevent, '_blank', 'noopener,noreferrer');
          } catch (ex) { }
        }
      );
      return false;
    };
  });
}

function bindQuoteButtonHandler(div, ev, state, nip19) {
  // Quoteボタン設定（non-omochat フィード）
  try {
    const quoteBtn = div.querySelector('.btn-quote');
    if (quoteBtn) {
      quoteBtn.onclick = function (e) {
        e.stopPropagation();
        const composer = document.getElementById('composer');
        if (composer) composer.hidden = false;
        const noteInput = document.getElementById('noteInput');
        if (noteInput) {
          import('./nostr-compat.js').then(mod => {
            try {
              const nip19local = mod.getNip19 && mod.getNip19();
              let nevent = null;
              if (nip19local) {
                try {
                  if (nip19local.nevent && typeof nip19local.nevent.encode === 'function') nevent = nip19local.nevent.encode({ id: ev.id, relays: [] });
                } catch (e) { }
                try {
                  if (!nevent && typeof nip19local.neventEncode === 'function') nevent = nip19local.neventEncode({ id: ev.id, relays: [] });
                } catch (e) { }
              }
              if (!nevent) nevent = 'nevent1' + ev.id;
              if (!/^nostr:/i.test(nevent)) nevent = 'nostr:' + nevent;
              noteInput.value = '\n' + nevent + '\n';
              noteInput.focus();
              noteInput.selectionStart = noteInput.selectionEnd = 0;
            } catch (e) {
              noteInput.value = '\nnostr:nevent1' + ev.id + '\n';
              noteInput.focus();
              noteInput.selectionStart = noteInput.selectionEnd = 0;
            }
          }).catch(() => {
            noteInput.value = '\nnostr:nevent1' + ev.id + '\n';
            noteInput.focus();
            noteInput.selectionStart = noteInput.selectionEnd = 0;
          });
        }
        try { setQuoteTarget(state, ev, nip19); window.__nokakoiQuoteMode = true; } catch (e) { }
      };
    }
  } catch (e) { }
}

function bindContentClickHandlers(div, ev, state, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent) {
  // 返信・リポスト・引用の本文クリックでイベント詳細モーダル表示
  const replyContentEls = div.querySelectorAll('.reply-to-content');
  replyContentEls.forEach(el => {
    el.onclick = function (e) {
      try {
        const a = e.target.closest('a');
        if (a) return;

        const btn = e.target.classList.contains('open-media') ? e.target : e.target.closest('.open-media');
        if (btn) {
          e.preventDefault();
          const url = btn.dataset.url;
          const type = btn.dataset.type || 'auto';
          if (url) { showMediaViewer(url, type); }
          return;
        }

        const link = e.target.classList.contains('media-link') ? e.target : e.target.closest('.media-link');
        if (link) {
          e.preventDefault();
          const url = link.dataset.url;
          const type = link.dataset.type || 'auto';
          if (url) { showMediaViewer(url, type); }
          return;
        }
      } catch (err) { }
      e.stopPropagation();
      const targetId = pickETagEventId(ev) || ev.id;
      showEventModal(findEventById(state, targetId) || ev, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
    };
  });

  const repostContentEls = div.querySelectorAll('.reply-to.repost .reply-to-content');
  repostContentEls.forEach(el => {
    if (el.dataset.repostListenerInstalled) return;
    el.onclick = function (e) {
      try {
        if (e.target.closest('.open-media')) {
          e.preventDefault();
          const btn = e.target.closest('.open-media');
          const url = btn && btn.dataset.url;
          const type = btn && (btn.dataset.type || 'auto');
          if (url) { showMediaViewer(url, type); }
          return;
        }
        if (e.target.closest('.media-link')) {
          e.preventDefault();
          const link = e.target.closest('.media-link');
          const url = link && link.dataset.url;
          const type = link && (link.dataset.type || 'auto');
          if (url) { showMediaViewer(url, type); }
          return;
        }
        if (e.target.closest('a')) return;
      } catch (err) { }
      e.stopPropagation();
      const targetId = pickETagEventId(ev) || ev.id;
      showEventModal(findEventById(state, targetId) || ev, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
    };
    el.dataset.repostListenerInstalled = '1';
  });

  const quoteContentEls = div.querySelectorAll('.event-quote-content');
  quoteContentEls.forEach(el => {
    el.onclick = function (e) {
      try {
        const a = e.target.closest('a');
        if (a) return;
        const btn = e.target.classList.contains('open-media') ? e.target : e.target.closest('.open-media');
        if (btn) {
          e.preventDefault();
          const url = btn.dataset.url;
          const type = btn.dataset.type || 'auto';
          if (url) { showMediaViewer(url, type); }
          return;
        }
        const link = e.target.classList.contains('media-link') ? e.target : e.target.closest('.media-link');
        if (link) {
          e.preventDefault();
          const url = link.dataset.url;
          const type = link.dataset.type || 'auto';
          if (url) { showMediaViewer(url, type); }
          return;
        }
      } catch (err) { }
      e.stopPropagation();
      let eventId = null;
      let parent = el.closest('.event-quote');
      if (parent) {
        eventId = parent.querySelector('.nostr-quote')?.dataset?.eventId;
      }
      if (!eventId && parent && parent.dataset.eventId) {
        eventId = parent.dataset.eventId;
      }
      let event = eventId ? findEventById(state, eventId) : null;
      showEventModal(event || ev, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
    };
  });
}

function bindOmochatHandlers(div, ev, state, nip19) {
  const hBtn = div.querySelector('.btn-omochat-h');
  const tBtn = div.querySelector('.btn-omochat-t');
  if (hBtn) {
    hBtn.onclick = async (e) => {
      e.stopPropagation();
      const myPub = localStorage.getItem('pubkey');
      let myName = 'Guest';
      if (myPub) {
        const p = state.profiles ? state.profiles.get(myPub) : null;
        if (p) myName = p.display_name || p.name || 'Guest';
      }
      const targetHash = (ev.pubkey && ev.pubkey.length >= 4) ? '#' + ev.pubkey.slice(-4) : '';
      let targetName = targetHash || 'Guest';
      if (ev.tags) {
        const n = ev.tags.find(t => t[0] === 'n');
        const nName = (n && n[1]) ? String(n[1]).trim() : '';
        if (nName) targetName = nName;
      }
      await apiReplyToEvent(state, ev, `* 🫂 ${myName} hugs ${targetName}${targetHash} *`);
    };
  }
  if (tBtn) {
    tBtn.onclick = async (e) => {
      e.stopPropagation();
      const myPub = localStorage.getItem('pubkey');
      let myName = 'Guest';
      if (myPub) {
        const p = state.profiles ? state.profiles.get(myPub) : null;
        if (p) myName = p.display_name || p.name || 'Guest';
      }
      const targetHash = (ev.pubkey && ev.pubkey.length >= 4) ? '#' + ev.pubkey.slice(-4) : '';
      let targetName = targetHash || 'Guest';
      if (ev.tags) {
        const n = ev.tags.find(t => t[0] === 'n');
        const nName = (n && n[1]) ? String(n[1]).trim() : '';
        if (nName) targetName = nName;
      }
      await apiReplyToEvent(state, ev, `* 🐟 ${myName} slaps ${targetName}${targetHash} around a bit with a large trout *`);
    };
  }
  const replyBtn = div.querySelector('.btn-reply');
  if (replyBtn) {
    replyBtn.title = t('reply');
    replyBtn.onclick = (e) => {
      e.stopPropagation();
      setReplyTarget(state, ev, nip19);

      const targetHash = (ev.pubkey && ev.pubkey.length >= 4) ? '#' + ev.pubkey.slice(-4) : '';
      let targetName = '';
      if (ev.tags) {
        const n = ev.tags.find(t => t[0] === 'n');
        const nName = (n && n[1]) ? String(n[1]).trim() : '';
        if (nName) {
          targetName = nName;
        }
      }
      const composer = document.getElementById('composer');
      if (composer) composer.hidden = false;

      const noteInput = document.getElementById('noteInput');
      if (noteInput) {
        noteInput.value = `@${targetName}${targetHash} `;
        noteInput.focus();
        noteInput.selectionStart = noteInput.selectionEnd = noteInput.value.length;
      }
    };
  }
}

function bindEventListeners(div, ev, state, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent) {
  bindProfileClickHandlers(div, ev, state, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent);
  bindJsonButtonHandlers(div, ev, nip19);
  bindQuoteButtonHandler(div, ev, state, nip19);
  bindContentClickHandlers(div, ev, state, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent);

  if (!localStorage.getItem('pubkey')) return;

  setupReactButton(div, ev, settings, settingsManager, reactToEvent);
  setupRepostButton(div, ev, repostEvent);
  setupReplyButton(div, ev, replyToEvent);

  if (ev.kind === 20000) {
    bindOmochatHandlers(div, ev, state, nip19);
  }
}

export function renderEvent(state, ev, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent, feedId = null) {
  const div = buildEventContainer(ev);

  const timelineUiState = settings && settings.__timelineUiState ? settings.__timelineUiState : null;
  const markMutedExpanded = settings && typeof settings.__timelineMarkMutedExpanded === 'function' ? settings.__timelineMarkMutedExpanded : null;
  const markCwExpanded = settings && typeof settings.__timelineMarkCwExpanded === 'function' ? settings.__timelineMarkCwExpanded : null;
  const isMutedExpanded = !!(timelineUiState && timelineUiState.expandedMutedEventIds && timelineUiState.expandedMutedEventIds.has && timelineUiState.expandedMutedEventIds.has(ev.id));
  const isCwExpanded = !!(timelineUiState && timelineUiState.expandedCwEventIds && timelineUiState.expandedCwEventIds.has && timelineUiState.expandedCwEventIds.has(ev.id));
  const content = ev.content || '';
  const pk = ev.pubkey;
  const muteState = evaluateMuteState(state, pk, content);
  const allowInlineMedia = (!settings || settings.showTimelineMedia !== false) && !muteState.isMuted;

  const replyToHtml = renderReplyContext(state, ev, nip19, { ...(settings || {}), settingsManager, isModal: false, showTimelineMedia: allowInlineMedia });
  const channelContextHtml = ev.kind === 42 ? renderChannelContext(state, ev) : '';

  let names;
  if (ev.kind === 20000) {
    if (settings && settings.omochatSubordinate) {
       const userGeohash = settings.omochatGeohash || 'xn';
       const gTag = ev.tags && ev.tags.find(t => t[0] === 'g');
       const evGeohash = gTag ? gTag[1] : '';
       if (evGeohash && evGeohash !== userGeohash && evGeohash.startsWith(userGeohash)) {
          div.style.opacity = '0.6';
       }
    }
    const hash = (pk && pk.length >= 4) ? '#' + pk.slice(-4) : '';
    const nTag = ev.tags && ev.tags.find(t => t[0] === 'n');
    const nName = (nTag && nTag[1]) ? String(nTag[1]).trim() : '';
    if (nName) {
      names = { main: nName, sub: hash };
    } else {
      names = { main: hash, sub: '' };
    }
  } else {
    names = displayNameWithUsername(state, pk, nip19, { noTruncate: true });
  }

  let statusHtml = '<span class="user-status event-name-status" data-pubkey="' + pk + '" style="display:none;"></span>';
  const showMusic = !settings || settings.showMusicStatus !== false;

  if (showMusic && state.userStatuses) {
    const us = state.userStatuses.get(pk);
    if (us && us.content) {
      statusHtml = '<span class="user-status event-name-status" data-pubkey="' + pk + '" title="' + escapeHtml(us.content) + '">♫ ' + escapeHtml(us.content) + '</span>';
    }
  }

  const nameBlockHtml = buildEventNameBlockHtml(state, ev, settings, names, statusHtml);

  const topRowHtml = '<div class="event-top-row">' +
    nameBlockHtml +
    (localStorage.getItem('pubkey') && ev.kind !== 20000 ?
      '<div class="event-actions-react">' +
      '<button class="btn-react" type="button" data-i18n-title="reaction.button.title"><img src="icon/star.png" alt="" class="icon-btn" data-i18n-alt="reaction.button.title"></button>' +
      '</div>' : '') +
    '</div>';

  const showReceivedDelta = feedId === 'global';
  const formatTimeForEvent = (eventObj) => {
    try {
      const base = fmtTime(eventObj.created_at);
      if (showReceivedDelta && eventObj && eventObj.__receivedAt) {
        const diffMs = (eventObj.created_at * 1000) - eventObj.__receivedAt;
        const absMs = Math.abs(diffMs);
        let delta = '';
        if (absMs < 1000) {
          delta = t('now');
        } else {
          const s = Math.round(absMs / 1000);
          if (s < 60) delta = (diffMs >= 0 ? '+' : '-') + s + 's';
          else {
            const m = Math.round(s / 60);
            delta = (diffMs >= 0 ? '+' : '-') + m + 'm';
          }
        }
        return base + ' [' + delta + ']';
      }
      return base;
    } catch (e) {
      return fmtTime(eventObj.created_at);
    }
  };

  let omochatButtons = '';
  if (ev.kind === 20000 && localStorage.getItem('pubkey')) {
    omochatButtons = '<button class="btn-omochat-h" type="button" title="( ⊃·ω·)⊃🫂">🫂</button>' +
                     '<button class="btn-omochat-t" type="button" title="( \'ω\' )в 🐟">🐟</button>';
  }

  const bottomRowHtml = '<div class="event-bottom-row">' +
    '<div class="event-time-kind">' +
    '<span class="time">' + formatTimeForEvent(ev) + '</span>' +
    '<button class="btn-json btn-kind" type="button" data-kind="' + ev.kind + '" data-i18n-title="showJson"> k:' + ev.kind + '</button>' +
    '</div>' +
    (localStorage.getItem('pubkey') ?
      '<div class="event-actions-bottom">' +
      omochatButtons +
      (ev.kind !== 20000 ? '<button class="btn-quote" type="button" data-i18n-title="quote"><img src="icon/note.png" alt="" class="icon-btn" data-i18n-alt="quote"></button>' : '') +
      (ev.kind !== 20000 ? '<button class="btn-repost" type="button" data-i18n-title="repost"><img src="icon/repost.png" alt="" class="icon-btn" data-i18n-alt="repost"></button>' : '') +
      (ev.kind === 1 || ev.kind === 20000 ? '<button class="btn-reply" type="button" data-i18n-title="reply"><img src="icon/reply.png" alt="" class="icon-btn" data-i18n-alt="reply"></button>' : '') +
      '</div>' : '') +
    '</div>';

  div.innerHTML = topRowHtml + channelContextHtml + replyToHtml + '<div class="content"></div>' + bottomRowHtml;

  const contentEl = div.querySelector('.content');
  renderEventContent(state, ev, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent, contentEl, allowInlineMedia);

  try {
    const replyBlock = div.querySelector('.reply-to');
    if (replyBlock) {
      try { updateNostrNpubLinks(replyBlock); } catch (e) { }
      try {
        updateNostrNoteLinks(
          replyBlock,
          showEventModal,
          state,
          nip19,
          reactToEvent,
          replyToEvent,
          repostEvent,
          settings,
          settingsManager
        );
      } catch (e) { }
      if (ev.kind === 7) {
        try { processHiddenTagChars(replyBlock); } catch (e) { }
      }
    }
  } catch (e) { }

  try { if (typeof fitCustomEmoji === 'function') fitCustomEmoji(div, 28); } catch (e) { }

  setupContentWarning(div, ev, contentEl, isCwExpanded, markCwExpanded);

  const isHidden = setupMuteCollapse(div, ev, contentEl, muteState, isMutedExpanded, markMutedExpanded);
  if (isHidden) return div;

  bindEventListeners(div, ev, state, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent);

  // クライアント名表示設定が有効かつイベントに client タグが存在する場合にバッジを生成
  try {
    const showClientName = !settings || settings.showClientName !== false;
    if (showClientName) {
      const clientTag = (ev.tags || []).find(t => t && t[0] === 'client' && t[1]);
      if (clientTag) {
        const clientName = clientTag[1];
        const kindBtnEl = div.querySelector('.btn-kind');
        if (kindBtnEl && kindBtnEl.parentNode) {
          const span = document.createElement('span');
          span.className = 'client-badge';
          span.setAttribute('data-client', clientName);
          kindBtnEl.parentNode.insertBefore(span, kindBtnEl.nextSibling);
        }
      }
    }
  } catch (e) { }

  try {
    const clientBadges = div.querySelectorAll('.client-badge[data-client]');
    if (clientBadges && clientBadges.length > 0) {
      applyClientBadgeToContainer(div);
    } else {
      const kindBtn = div.querySelector('.btn-kind');
      if (kindBtn) {
        kindBtn.style.marginRight = '4px';
      }
    }
  } catch (e) { }

  try {
    try {
      const btnJson = div.querySelector('.btn-json'); if (btnJson) { try { btnJson.title = t('showJson'); const img = btnJson.querySelector && btnJson.querySelector('img'); if (img) img.alt = t('showJson'); } catch (e) { } }
      const repostBtn = div.querySelector('.btn-repost'); if (repostBtn) { try { repostBtn.title = t('repost'); const img = repostBtn.querySelector && repostBtn.querySelector('img'); if (img) img.alt = t('repost'); } catch (e) { } }
      const quoteBtn = div.querySelector('.btn-quote'); if (quoteBtn) { try { quoteBtn.title = t('quote.icon_alt'); const img = quoteBtn.querySelector && quoteBtn.querySelector('img'); if (img) img.alt = t('quote.icon_alt'); } catch (e) { } }
      const replyBtn = div.querySelector('.btn-reply'); if (replyBtn) { try { replyBtn.title = t('reply'); const img = replyBtn.querySelector && replyBtn.querySelector('img'); if (img) img.alt = t('reply'); } catch (e) { } }
      const reactBtn = div.querySelector('.btn-react'); if (reactBtn) { try { const stored = reactBtn.dataset && reactBtn.dataset.reactionDisplay ? reactBtn.dataset.reactionDisplay : null; if (stored) reactBtn.title = t('reaction.button.title_with_default', { display: stored }); else reactBtn.title = t('reaction.button.title'); const img = reactBtn.querySelector && reactBtn.querySelector('img'); if (img) img.alt = t('reaction.button.title'); } catch (e) { } }
    } catch (e) { }
  } catch (e) { }

  if (ev.kind === 42) {
    const channelRootId = pickChannelRootId(ev);
    if (channelRootId) scheduleChannelLabelUpdate(state, channelRootId, div);
  }

  return div;
}

// 言語変更時に既存イベントUIを更新
try {
  if (typeof window !== 'undefined') {
    window.addEventListener('i18n:updated', () => {
      try {
        // kindボタンラベル更新
        document.querySelectorAll('.btn-kind').forEach(btn => {
          try {
            const kind = btn.dataset && btn.dataset.kind ? btn.dataset.kind : (btn.textContent || '').split(':').pop().trim();
            btn.textContent = t('kind') + ':' + kind;
            // title があれば更新
            try { btn.setAttribute('title', t('showJson')); } catch (e) { }
          } catch (e) { }
        });

        // reactボタンの title/alt を更新
        document.querySelectorAll('.btn-react').forEach(btn => {
          try {
            // 個別表示が保存されていれば title に優先表示
            const stored = btn.dataset && btn.dataset.reactionDisplay ? btn.dataset.reactionDisplay : null;
            if (stored) {
              btn.title = t('reaction.button.title_with_default', { display: stored });
            } else {
              btn.title = t('reaction.button.title');
            }
            const img = btn.querySelector && btn.querySelector('img');
            if (img) img.alt = t('reaction.button.title');
          } catch (e) { }
        });

        // repost/reply ボタンの title/alt を更新
        document.querySelectorAll('.btn-repost').forEach(b => { try { b.title = t('repost'); const img = b.querySelector && b.querySelector('img'); if (img) img.alt = t('repost'); } catch (e) { } });
        document.querySelectorAll('.btn-reply').forEach(b => { try { b.title = t('reply'); const img = b.querySelector && b.querySelector('img'); if (img) img.alt = t('reply'); } catch (e) { } });

        // ミュート折りたたみの展開ボタン文言を更新
        document.querySelectorAll('.muted-fold-bar button').forEach(b => { try { b.textContent = t('fold.show'); } catch (e) { } });

        // 操作語を含む reply-to 著者ラベルを更新
        document.querySelectorAll('.reply-to-author').forEach(el => {
          try {
            const nameEl = el.querySelector('.reply-author-name');
            const name = nameEl ? nameEl.textContent : el.textContent || '';
            const parent = el.closest('.reply-to');
            if (parent && parent.classList.contains('repost')) {
              el.innerHTML = '<span class="reply-author-name">' + replaceBadgeEmoji(escapeHtml(name)) + '</span> ' + '<span>' + t('repost') + '</span>';
            } else if (parent && parent.querySelector('.reply-marker') && parent.querySelector('.reply-marker').innerText.trim()) {
              // reaction の場合
              el.innerHTML = '<span class="reply-author-name">' + replaceBadgeEmoji(escapeHtml(name)) + '</span> ' + '<span>' + t('reaction.button.title') + '</span>';
            } else {
              el.innerHTML = '<span class="reply-author-name">' + replaceBadgeEmoji(escapeHtml(name)) + '</span> ' + '<span>' + t('reply') + '</span>';
            }
          } catch (e) { }
        });

        // イベント再dispatchなしで data-i18n 翻訳を再適用
        try { if (typeof applyTranslations === 'function') applyTranslations(document, true); } catch (e) { }
      } catch (e) { }
    });
  }
} catch (e) { }

async function invokeShowProfileModalProxy(pubkey) {
  try {
    if (typeof window !== 'undefined' && typeof window.showProfileModalProxy === 'function') {
      window.showProfileModalProxy(pubkey);
      return;
    }
    const mod = await import('./main.js');
    if (mod && typeof mod.showProfileModalProxy === 'function') {
      mod.showProfileModalProxy(pubkey);
      return;
    }
  } catch (e) {
    if (window.__nokakoiDebug) console.warn('invokeShowProfileModalProxy failed', e);
  }
}

let __reactionDefaultListenerInstalled = false;
function installReactionDefaultListener(settingsManager) {
  if (__reactionDefaultListenerInstalled) return;
  try {
    window.addEventListener('reactionDefaultChanged', () => {
      try {
        const newDefault = (settingsManager && typeof settingsManager.get === 'function') ? (settingsManager.get('reactionDefault') || '+') : '+';
        const display = formatReactionForTitle(newDefault);
        document.querySelectorAll('.btn-react').forEach(btn => {
          try { btn.title = t('reaction.button.title_with_default', { display: display }); } catch (e) {}
        });
      } catch (e) {}
    });
    __reactionDefaultListenerInstalled = true;
  } catch (e) {}
}

