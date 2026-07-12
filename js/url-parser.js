// ============================================================================
// URLパーサーとリンク化処理
// ============================================================================

import { escapeHtml, truncateName, replaceBadgeEmoji } from './utils.js';
import { showMediaViewer } from './media-viewer.js';
import { t } from './i18n.js';
import { MAX_PREVIEW_LENGTH, MAX_PREVIEW_LINES } from './constants.js';
import { findEventById, cacheEvent } from './state.js';
import { getNip19 as getNip19Compat } from './nostr-compat.js';
import { getReadRelays } from './relay.js';

/**
 * URL検出用の正規表現
 * http/httpsプロトコルのURLにマッチ
 */
const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;

/**
 * Nostr URI用の正規表現
 * nostr:npub1..., nostr:note1..., nostr:nevent1... などにマッチ
 */
const NOSTR_URI_REGEX = /(nostr:(npub|note|nprofile|nevent|naddr|nsec)[a-z0-9]+)/gi;

// :smile: のような絵文字ショートコード用正規表現
const EMOJI_SHORTCODE_REGEX = /:([a-zA-Z0-9_+-]+):/g;

// セクシー餃子で使用する Unicode Tag characters（隠し文字）
const HIDDEN_TAG_CHARS_RE = /[\u{E0100}-\u{E01EF}]+/gu;
const NOSTR_QUOTE_RECURSION_MAX_DEPTH = 2;

let __graphemeSegmenter = null;

function getGraphemeLengthAt(text, index) {
  if (index >= text.length) return 0;
  const cp = text.codePointAt(index);
  return (cp && cp > 0xFFFF) ? 2 : 1;
}

function collectMergedSkipRanges(text) {
  const skipRanges = [];
  let match;

  const urlRegex = new RegExp(URL_REGEX.source, URL_REGEX.flags);
  while ((match = urlRegex.exec(text)) !== null) {
    skipRanges.push({ start: match.index, end: match.index + match[0].length });
  }
  const nostrRegex = new RegExp(NOSTR_URI_REGEX.source, NOSTR_URI_REGEX.flags);
  while ((match = nostrRegex.exec(text)) !== null) {
    skipRanges.push({ start: match.index, end: match.index + match[0].length });
  }
  const emojiRegex = new RegExp(EMOJI_SHORTCODE_REGEX.source, EMOJI_SHORTCODE_REGEX.flags);
  while ((match = emojiRegex.exec(text)) !== null) {
    skipRanges.push({ start: match.index, end: match.index + match[0].length });
  }
  const hiddenTagRegex = new RegExp(HIDDEN_TAG_CHARS_RE.source, HIDDEN_TAG_CHARS_RE.flags);
  while ((match = hiddenTagRegex.exec(text)) !== null) {
    skipRanges.push({ start: match.index, end: match.index + match[0].length });
  }

  skipRanges.sort((a, b) => a.start - b.start);

  const merged = [];
  for (const r of skipRanges) {
    if (merged.length > 0 && r.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }

  return merged;
}

let _anchorMaintainObserver = null;
let _anchorMaintainTimer = null;

function resolveActiveFeed(container) {
  try {
    if (!container) return null;
    if (container.classList && container.classList.contains('feed') && container.classList.contains('active')) {
      return container;
    }
    if (container.closest && (container.closest('#profileEvents') || container.closest('#eventModal'))) {
      return null;
    }
    return container.closest ? container.closest('.feed.active') : null;
  } catch (e) {
    return null;
  }
}

function findTimelineAnchorElement(anchor, container) {
  try {
    if (!anchor || !anchor.eventId) return null;
    const feed = resolveActiveFeed(container) || document.querySelector('.feed.active');
    if (!feed) return null;
    return feed.querySelector('.event[data-event-id="' + anchor.eventId + '"]');
  } catch (e) {
    return null;
  }
}

function clearAnchorMaintenance() {
  try {
    if (_anchorMaintainObserver) {
      _anchorMaintainObserver.disconnect();
      _anchorMaintainObserver = null;
    }
    if (_anchorMaintainTimer) {
      clearTimeout(_anchorMaintainTimer);
      _anchorMaintainTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.__nokakoiScrollAnchor = null;
      window.__nokakoiProgrammaticScroll = false;
    }
  } catch (e) { }
}

function applyTimelineAnchorDrift(anchor, container) {
  try {
    if (!anchor || typeof window === 'undefined' || typeof anchor.top !== 'number') return false;
    const anchorEl = findTimelineAnchorElement(anchor, container);
    if (!anchorEl) return false;
    const drift = anchorEl.getBoundingClientRect().top - anchor.top;
    if (Math.abs(drift) <= 1) return false;
    window.__nokakoiProgrammaticScroll = true;
    window.scrollTo(0, window.scrollY + drift);
    return true;
  } catch (e) {
    return false;
  }
}

function captureTimelineAnchor(container) {
  try {
    if (!container || typeof window === 'undefined') return null;
    const feed = resolveActiveFeed(container);
    if (!feed) return null;

    const prevScrollY = window.scrollY || 0;
    if (prevScrollY <= 0) return null;

    const tabsBar = document.querySelector('.tabs');
    const tabsBarHeight = tabsBar ? tabsBar.getBoundingClientRect().height : 0;
    const feedRect = feed.getBoundingClientRect();
    const tabTopPos = Math.max(0, Math.round(feedRect.top + prevScrollY - tabsBarHeight));
    if (prevScrollY <= tabTopPos) return null;

    const events = feed.querySelectorAll('.event[data-event-id]');
    for (const ev of events) {
      const rect = ev.getBoundingClientRect();
      if (rect.bottom > 0) {
        return {
          eventId: ev.dataset.eventId,
          top: rect.top
        };
      }
    }
  } catch (e) { }
  return null;
}

function restoreTimelineAnchor(anchor, container, options) {
  try {
    if (!anchor || typeof window === 'undefined') return;
    const maintainMs = (options && typeof options.maintainMs === 'number') ? options.maintainMs : 800;

    clearAnchorMaintenance();
    window.__nokakoiScrollAnchor = anchor;
    window.__nokakoiProgrammaticScroll = true;

    const runApply = () => {
      try { applyTimelineAnchorDrift(anchor, container); } catch (e) { }
    };

    requestAnimationFrame(() => requestAnimationFrame(runApply));

    if (maintainMs > 0 && typeof ResizeObserver !== 'undefined') {
      const anchorEl = findTimelineAnchorElement(anchor, container);
      if (anchorEl) {
        _anchorMaintainObserver = new ResizeObserver(() => {
          try { applyTimelineAnchorDrift(anchor, container); } catch (e) { }
        });
        _anchorMaintainObserver.observe(anchorEl);
        const feed = anchorEl.closest('.feed');
        if (feed && feed !== anchorEl) {
          _anchorMaintainObserver.observe(feed);
        }
      }
      _anchorMaintainTimer = setTimeout(() => {
        clearAnchorMaintenance();
      }, maintainMs);
    } else {
      setTimeout(() => {
        try { window.__nokakoiProgrammaticScroll = false; } catch (e) { }
        try { window.__nokakoiScrollAnchor = null; } catch (e) { }
      }, Math.max(maintainMs, 100));
    }
  } catch (e) { }
}

function followUpTimelineAnchor(container) {
  try {
    const anchor = (typeof window !== 'undefined') ? window.__nokakoiScrollAnchor : null;
    if (!anchor) return;
    applyTimelineAnchorDrift(anchor, container);
  } catch (e) { }
}

/**
 * URLが画像かどうか判定
 */
function isImageUrl(url) {
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i;
  return imageExtensions.test(url);
}

/**
 * URLが動画かどうか判定
 */
function isVideoUrl(url) {
  const videoExtensions = /\.(mp4|webm|ogg|mov)(\?.*)?$/i;
  return videoExtensions.test(url);
}

/**
 * nip19インスタンス取得
 */
function getNip19() {
  try {
    return getNip19Compat() || null;
  } catch (e) { }
  return null;
}

/**
 * Nostr URIをパースしてリンク化
 */
function linkifyNostrUri(uri) {
  const nip19 = getNip19();
  if (!nip19) return escapeHtml(uri);

  try {
    // 'nostr:'プレフィックスを除去
    const bech32 = uri.replace(/^nostr:/, '');
    const decoded = nip19.decode(bech32);

    let label = '';
    let link = '';

    switch (decoded.type) {
      case 'npub':
        // ユーザープロフィール（後で名前に置換される）
        label = `@${bech32.substring(0, 12)}...`;
        link = `#npub:${bech32}`;
        return '<a href="' + escapeHtml(link) + '" class="nostr-link nostr-npub" data-uri="' +
          escapeHtml(uri) + '" data-pubkey="' + escapeHtml(decoded.data) +
          '" title="' + escapeHtml(bech32) + '">' +
          escapeHtml(label) + '</a>';
      case 'nprofile':
        // リレー情報付きプロフィール（後で名前に置換される）
        label = `@${bech32.substring(0, 12)}...`;
        link = `#nprofile:${bech32}`;
        return '<a href="' + escapeHtml(link) + '" class="nostr-link nostr-npub" data-uri="' +
          escapeHtml(uri) + '" data-pubkey="' + escapeHtml(decoded.data.pubkey) +
          '" title="' + escapeHtml(bech32) + '">' +
          escapeHtml(label) + '</a>';
      case 'note':
        // ノート（イベント）引用表示（neventと同じ）
        label = t('quote.placeholder', '引用');
        return '<span class="nostr-quote" data-uri="' +
          escapeHtml(uri) + '" data-event-id="' + escapeHtml(decoded.data) +
          '" data-relays="[]" title="' + escapeHtml(bech32) + '">' +
          escapeHtml(label) + '</span>';
      case 'nevent':
        // リレー情報付きイベント（kind 1は引用表示）
        label = t('quote.placeholder', '引用');
        return '<span class="nostr-quote" data-uri="' +
          escapeHtml(uri) + '" data-event-id="' + escapeHtml(decoded.data.id) +
          '" data-relays="' + escapeHtml(JSON.stringify(decoded.data.relays || [])) +
          '" title="' + escapeHtml(bech32) + '">' +
          escapeHtml(label) + '</span>';
      case 'naddr':
        // アドレス（パラメータ付き置換可能イベント）
        label = `addr:${bech32.substring(0, 12)}...`;
        return '<span class="nostr-quote" data-uri="' +
          escapeHtml(uri) + '" data-naddr-kind="' + escapeHtml(String(decoded.data.kind)) +
          '" data-naddr-pubkey="' + escapeHtml(decoded.data.pubkey) +
          '" data-naddr-identifier="' + escapeHtml(decoded.data.identifier) +
          '" data-relays="' + escapeHtml(JSON.stringify(decoded.data.relays || [])) +
          '" title="' + escapeHtml(bech32) + '">' +
          escapeHtml(label) + '</span>';
      default:
        return escapeHtml(uri);
    }
  } catch (e) {
    console.warn('[UrlParser] Nostr URIのパースに失敗:', e.message || e);
    return escapeHtml(uri);
  }
}

/**
 * テキストをパースしてURLをクリック可能なリンクに変換
 * 画像・動画はメディアビューアで開き、それ以外は新しいタブで開く
 * Nostr URIもリンク化
 *
 * 追加: `emojiTags`（event.tags 由来）の emoji タグのみで
 * ['emoji', shortcode, url] に対応する :shortcode: を <img> へ置換する（NIP-30 準拠）。
 */
function linkifyText(text, emojiTags = [], options = {}) {
  if (!text) return '';
  const inlineMedia = options.inlineMedia !== false;
  // カスタム絵文字表示設定を取得
  const showCustomEmoji = (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('showCustomEmoji') === '0') ? false : true;

  // イベント自身の emoji タグのみで shortcode → URL を解決
  const emojiMap = new Map();
  try {
    if (Array.isArray(emojiTags)) {
      for (const tag of emojiTags) {
        try {
          if (Array.isArray(tag) && tag[0] === 'emoji' && tag[1]) {
            // タグ形式: ['emoji', 'shortcode', 'url', <optional-address>]
            emojiMap.set(String(tag[1]), tag[2] || null);
          }
        } catch (e) { }
      }
    }
  } catch (e) { }

  const lines = text.split('\n');
  const result = [];
  const isBlock = []; // parallel array indicating if item is a block-level emoji-line

  for (let line of lines) {
    let lastIndex = 0;
    const lineParts = [];
    const matches = [];

    // 絵文字ショートコードのみの行かを簡易判定（空白は許容）
    const emojiOnly = /^\s*(?::[A-Za-z0-9_+-]+:\s*)+$/.test(line);

    // URLをすべて検出
    const urlRegex = new RegExp(URL_REGEX.source, URL_REGEX.flags);
    let match;
    while ((match = urlRegex.exec(line)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        text: match[0],
        type: 'url'
      });
    }

    // Nostr URIをすべて検出
    const nostrRegex = new RegExp(NOSTR_URI_REGEX.source, NOSTR_URI_REGEX.flags);
    while ((match = nostrRegex.exec(line)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        text: match[0],
        type: 'nostr'
      });
    }

    // 絵文字ショートコードをすべて検出（例: :smile:）
    const emojiRegex = new RegExp(EMOJI_SHORTCODE_REGEX.source, EMOJI_SHORTCODE_REGEX.flags);
    while ((match = emojiRegex.exec(line)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        text: match[0],
        type: 'emoji'
      });
    }

    // インデックス順にソート
    matches.sort((a, b) => a.index - b.index);

    // 重複・重なりを除去
    const filteredMatches = [];
    let lastEnd = 0;
    for (const m of matches) {
      if (m.index >= lastEnd) {
        filteredMatches.push(m);
        lastEnd = m.index + m.length;
      }
    }

    // マッチ部分を処理
    let emojiSeq = [];
    for (const m of filteredMatches) {
      // マッチ前のテキストを追加
      if (m.index > lastIndex) {
        // 文字追加前に保留中の絵文字シーケンスを確定
        if (emojiSeq.length > 0) {
          lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>');
          emojiSeq = [];
        }
        // mixed-lineで扱えるよう通常テキストをラップ
        lineParts.push('<span class="plain-text">' + escapeHtml(line.substring(lastIndex, m.index)) + '</span>');
      }

      if (m.type === 'url') {
        // 保留中の絵文字シーケンスを確定
        if (emojiSeq.length > 0) { lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>'); emojiSeq = []; }
        const url = m.text;
        const isImage = isImageUrl(url);
        const isVideo = isVideoUrl(url);

        if (isImage || isVideo) {
          const type = isImage ? 'image' : 'video';
          const label = isImage ? t('media.open_image') : t('media.open_video');
          const safeUrl = escapeHtml(url);
          if (inlineMedia) {
            if (isImage) {
              lineParts.push(
                '<span class="media-inline media-link" data-url="' + safeUrl + '" data-type="' + type + '" title="' + safeUrl + '">' +
                '<img src="' + safeUrl + '" alt="' + escapeHtml(t('media.image')) + '" loading="lazy">' +
                '</span>'
              );
            } else {
              lineParts.push(
                '<span class="media-inline media-link media-inline-video" data-url="' + safeUrl + '" data-type="' + type + '" title="' + safeUrl + '">' +
                '<video src="' + safeUrl + '" muted playsinline preload="metadata"></video>' +
                '<span class="media-inline-overlay">' + escapeHtml(t('media.video')) + '</span>' +
                '</span>'
              );
            }
          } else {
            lineParts.push(
              '<button type="button" class="open-media" data-url="' + safeUrl +
              '" data-type="' + type + '" title="' + safeUrl + '">' + escapeHtml(label) + '</button>'
            );
          }
        } else {
          // 通常リンクは新しいタブで開く
          lineParts.push(
            '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" title="' +
            escapeHtml(url) + '">' + escapeHtml(url) + '</a>'
          );
        }
      } else if (m.type === 'nostr') {
        // 保留中の絵文字シーケンスを確定
        if (emojiSeq.length > 0) { lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>'); emojiSeq = []; }
        lineParts.push(linkifyNostrUri(m.text));
      } else if (m.type === 'emoji') {
        // m.text は ':shortcode:' 形式
        try {
          const sc = m.text.slice(1, -1);
          const url = emojiMap.get(sc);
          // カスタム絵文字が無効なら通常テキストとして扱う
          const show = (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('showCustomEmoji') === '0') ? false : true;
          if (!show) {
            if (emojiSeq.length > 0) { lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>'); emojiSeq = []; }
            lineParts.push('<span class="plain-text">' + escapeHtml(m.text) + '</span>');
            lastIndex = m.index + m.length;
            continue;
          }
          if (url) {
            // 後段JSでサイズ調整できるようラップ付きで画像化
            const imgHtml = '<span class="emoji-wrap" style="display:inline-block;line-height:1;margin:0;padding:0;vertical-align:middle;max-width:100%;">' +
              '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(m.text) + '" class="custom-emoji" style="max-width:100%;"/>' +
              '</span>';
            // 隣接絵文字をまとめるため、即追加せずシーケンスへ蓄積
            emojiSeq.push(imgHtml);
          } else {
            // emojiタグがなければシーケンス確定後、エスケープ済み文字列へフォールバック
            if (emojiSeq.length > 0) { lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>'); emojiSeq = []; }
            lineParts.push('<span class="plain-text">' + escapeHtml(m.text) + '</span>');
          }
        } catch (e) {
          if (emojiSeq.length > 0) { lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>'); emojiSeq = []; }
          lineParts.push('<span class="plain-text">' + escapeHtml(m.text) + '</span>');
        }
      }

      lastIndex = m.index + m.length;
    }

    // 残りのテキストを追加 (重要: plain text 行が消えるのを防ぐ)
    if (lastIndex < line.length) {
      // 末尾テキスト追加前に保留中シーケンスを確定
      if (emojiSeq.length > 0) {
        lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>');
        emojiSeq = [];
      }
      lineParts.push('<span class="plain-text">' + escapeHtml(line.substring(lastIndex)) + '</span>');
    }

    // 末尾テキストがない場合に残りの絵文字シーケンスを確定
    if (emojiSeq.length > 0) { lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>'); emojiSeq = []; }

    const inner = lineParts.join('');

    // mixed-line判定: カスタム絵文字画像と通常テキストが同居しているか
    const hasEmojiImg = inner.indexOf('class="custom-emoji"') >= 0;
    const plainText = inner.replace(/<[^>]+>/g, '').trim();
    const isMixedLine = !emojiOnly && hasEmojiImg && plainText.length > 0;

    if (emojiOnly && showCustomEmoji) {
      // CSSで縦積み制御しやすいよう block-level の emoji-line として描画
      result.push('<div class="emoji-line">' + inner + '</div>');
      isBlock.push(true);
    } else if (isMixedLine) {
      // この行だけ line-height を調整できるよう inline span でラップ
      result.push('<span class="mixed-line">' + inner + '</span>');
      isBlock.push(false);
    } else {
      result.push(inner);
      isBlock.push(false);
    }
  }

  // <br>で結合。ただし block-level emoji-line が連続する間は <br> を入れない
  let out = '';
  for (let i = 0; i < result.length; i++) {
    out += result[i];
    if (i < result.length - 1) {
      if (isBlock[i] || isBlock[i + 1]) {
        // block 要素（emoji-line）の前後では <br> を入れない
        // block 自体が改行を作るため、ここで足すと二重改行になって隙間が出る
      } else {
        out += '<br>';
      }
    }
  }

  return out;
}

/**
 * メディアリンクのイベント委譲をセットアップ
 * アプリ初期化時に一度呼び出すこと
 */
function setupMediaLinkHandlers(container) {
  container.addEventListener('click', function (e) {
    const target = e.target;
    // open-mediaボタン対応
    const btn = target.classList.contains('open-media') ? target : target.closest('.open-media');
    if (btn) {
      e.preventDefault();
      const url = btn.dataset.url;
      const type = btn.dataset.type || 'auto';
      if (url) {
        showMediaViewer(url, type);
      }
      return false;
    }
    // クリックされた要素または親がメディアリンクか判定
    const link = target.classList.contains('media-link') ?
      target : target.closest('.media-link');
    if (link) {
      e.preventDefault();
      const url = link.dataset.url;
      const type = link.dataset.type || 'auto';
      if (url) {
        showMediaViewer(url, type);
      }
      return false;
    }

    // クリックされた要素がNostrノートリンクか判定（neventは除外）
    const nostrLink = target.classList.contains('nostr-link') ?
      target : target.closest('.nostr-link');

    if (nostrLink && nostrLink.classList.contains('nostr-note')) {
      // ノートリンクのみ処理（neventは引用表示のみ）
//       e.preventDefault();
      const uri = nostrLink.dataset.uri;
      if (uri) {
        handleNostrUri(uri);
      }
      return false;
    }

    // クリックされた要素がNostr npubリンクか判定
    const npubLink = target.classList.contains('nostr-npub') ?
      target : target.closest('.nostr-npub');

    if (npubLink) {
      e.preventDefault();
      const uri = npubLink.dataset.uri;
      if (uri) {
        handleNostrUri(uri);
      }
      return false;
    }
  });
}

/**
 * Nostr URIクリック時の処理
 */
async function handleNostrUri(uri) {
  const nip19 = getNip19();
  if (!nip19) {
    alert(t('nostrtools.not_loaded'));
    return;
  }

  try {
    const bech32 = uri.replace(/^nostr:/, '');
    const decoded = nip19.decode(bech32);

    const state = window.__nostrState;

    switch (decoded.type) {
      case 'npub':
        if (state) {
          if (typeof window !== 'undefined' && typeof window.showProfileModalProxy === 'function') {
            window.showProfileModalProxy(decoded.data);
          } else {
            try {
              const mod = await import('./main.js');
              if (mod && mod.showProfileModalProxy) {
                mod.showProfileModalProxy(decoded.data);
              }
            } catch (e) { }
          }
        }
        break;
      case 'nprofile':
        if (state) {
          if (typeof window !== 'undefined' && typeof window.showProfileModalProxy === 'function') {
            window.showProfileModalProxy(decoded.data.pubkey);
          } else {
            try {
              const mod = await import('./main.js');
              if (mod && mod.showProfileModalProxy) {
                mod.showProfileModalProxy(decoded.data.pubkey);
              }
            } catch (e) { }
          }
        }
        break;
      case 'note':
        // イベント取得して表示
        if (state && state.pool) {
          try {
            const eventId = decoded.type === 'note' ? decoded.data : decoded.data.id;
            const { findEventById, cacheEvent } = await import('./state.js');
            const { getReadRelays } = await import('./relay.js');
            const { showJsonModal } = await import('./json-modal.js');

            // まずキャッシュを確認
            let event = findEventById(state, eventId);

            // キャッシュになければ取得
            if (!event) {
              const rawRelays = decoded.type === 'nevent' && decoded.data.relays && decoded.data.relays.length > 0
                ? decoded.data.relays
                : getReadRelays(state.relays);
              const relays = sanitizeRelays(rawRelays);

              if (relays && relays.length > 0) {
                event = await fetchQuoteEventById(state, relays, eventId);
              }
            }

            if (event) {
              // イベントのJSONモーダル表示
              showJsonModal(event);
            } else {
              alert(t('error.event_not_found'));
            }
          } catch (e) {
            console.error('[UrlParser] イベント取得に失敗:', e);
            alert(t('error.event_fetch_failed', { msg: (e && e.message) }));
          }
        }
        break;
      case 'naddr': {
        // naddrのJSONモーダル表示
        // 補足: 実際のイベント取得も可能なら行う
        const { showJsonModal } = await import('./json-modal.js');
        showJsonModal(decoded.data);
        break;
      }
    }
  } catch (e) {
    console.error('[UrlParser] Nostr URIの処理に失敗:', e);
    alert(t('error.nostr_uri_failed', { msg: (e && e.message) }));
  }
}

/**
 * Nostr npubリンクの表示名を更新
 */
async function updateNostrNpubLinks(container) {
  if (!container) return;

  const state = window.__nostrState;
  if (!state) return;

  const npubLinks = container.querySelectorAll('.nostr-npub[data-pubkey]');

  for (const link of npubLinks) {
    const pubkey = link.dataset.pubkey;
    if (!pubkey) continue;

    // プロフィール取得
    const profile = state.profiles.get(pubkey);
    if (profile) {
      const displayName = (profile.display_name || profile.name || '').trim();
      if (displayName) {
        link.textContent = '@' + displayName;
      }
    } else {
      // バックグラウンドでプロフィール取得
      try {
        const { loadProfile } = await import('./profile.js');
        loadProfile(state, pubkey).then(() => {
          const prof = state.profiles.get(pubkey);
          if (prof) {
            const displayName = (prof.display_name || prof.name || '').trim();
            if (displayName) {
              link.textContent = '@' + displayName;
            }
          }
        });
      } catch (e) {
        console.warn('[UrlParser] npubリンクのプロフィール取得に失敗:', e);
      }
    }
  }
}

/**
 * Nostrノートリンクの内容プレビューとnevent引用表示を更新
 */
const _quoteFetchInflight = new Map();
const QUOTE_BATCH_TIMEOUT_MS = 4000;

function relaySetKey(relays) {
  return (relays || []).slice().sort().join('\0');
}

function resolveQuoteRelays(quoteEl, state) {
  const defaultRelays = sanitizeRelays(getReadRelays(state.relays));
  if (quoteEl && quoteEl.dataset && quoteEl.dataset.relays) {
    try {
      const relayHints = JSON.parse(quoteEl.dataset.relays);
      if (Array.isArray(relayHints) && relayHints.length > 0) {
        const sanitizedHints = sanitizeRelays(relayHints);
        if (sanitizedHints.length > 0) return sanitizedHints;
      }
    } catch (e) { }
  }
  return defaultRelays;
}

function eventFetchKey(eventId, relays) {
  return `id:${eventId}:${relaySetKey(relays)}`;
}

function naddrFetchKey(kind, pubkey, identifier, relays) {
  return `naddr:${kind}:${pubkey}:${identifier}:${relaySetKey(relays)}`;
}

async function fetchQuoteEventById(state, relays, eventId) {
  if (!eventId || !state?.pool || !relays?.length) return null;
  const cached = findEventById(state, eventId);
  if (cached) return cached;

  const key = eventFetchKey(eventId, relays);
  if (_quoteFetchInflight.has(key)) return _quoteFetchInflight.get(key);

  const promise = state.pool.get(relays, { ids: [eventId] })
    .then((ev) => {
      if (ev) cacheEvent(state, ev);
      return ev || null;
    })
    .catch(() => null)
    .finally(() => {
      _quoteFetchInflight.delete(key);
    });

  _quoteFetchInflight.set(key, promise);
  return promise;
}

async function fetchQuoteEventByNaddr(state, relays, kind, pubkey, identifier) {
  if (!state?.pool || !relays?.length || isNaN(kind) || !pubkey || identifier === undefined) return null;

  const key = naddrFetchKey(kind, pubkey, identifier, relays);
  if (_quoteFetchInflight.has(key)) return _quoteFetchInflight.get(key);

  const promise = state.pool.get(relays, { authors: [pubkey], kinds: [kind], '#d': [identifier] })
    .then((ev) => {
      if (ev) cacheEvent(state, ev);
      return ev || null;
    })
    .catch(() => null)
    .finally(() => {
      _quoteFetchInflight.delete(key);
    });

  _quoteFetchInflight.set(key, promise);
  return promise;
}

async function prefetchQuoteEventIds(state, relays, eventIds) {
  const uniqueIds = [...new Set(eventIds)].filter(Boolean);
  const missing = uniqueIds.filter((id) => {
    if (findEventById(state, id)) return false;
    if (_quoteFetchInflight.has(eventFetchKey(id, relays))) return false;
    return true;
  });

  if (!missing.length) {
    await Promise.all(uniqueIds.map((id) => {
      const inflight = _quoteFetchInflight.get(eventFetchKey(id, relays));
      return inflight || Promise.resolve();
    }));
    return;
  }

  if (missing.length === 1) {
    await fetchQuoteEventById(state, relays, missing[0]);
    return;
  }

  const batchKey = `batch:${relaySetKey(relays)}:${missing.slice().sort().join(',')}`;
  if (_quoteFetchInflight.has(batchKey)) {
    await _quoteFetchInflight.get(batchKey);
    return;
  }

  let finishBatch;
  const batchPromise = new Promise((resolve) => { finishBatch = resolve; });
  _quoteFetchInflight.set(batchKey, batchPromise);

  for (const id of missing) {
    const ikey = eventFetchKey(id, relays);
    if (_quoteFetchInflight.has(ikey)) continue;
    const tracked = batchPromise
      .then(() => findEventById(state, id) || null)
      .finally(() => { _quoteFetchInflight.delete(ikey); });
    _quoteFetchInflight.set(ikey, tracked);
  }

  const pending = new Set(missing);
  let unsub = null;
  const timer = setTimeout(done, QUOTE_BATCH_TIMEOUT_MS);
  function done() {
    clearTimeout(timer);
    try { if (typeof unsub === 'function') unsub(); } catch (e) { }
    finishBatch();
    _quoteFetchInflight.delete(batchKey);
  }

  try {
    unsub = state.pool.subscribeMany(relays, [{ ids: missing }], {
      onevent(ev) {
        if (!ev?.id || !pending.has(ev.id)) return;
        pending.delete(ev.id);
        cacheEvent(state, ev);
        if (pending.size === 0) done();
      },
      oneose: done
    });
  } catch (e) {
    done();
  }

  await batchPromise;
}

async function prefetchQuotesForElements(state, quoteElements) {
  const prefetchByRelay = new Map();

  for (const quoteEl of quoteElements) {
    const eventId = quoteEl.dataset.eventId;
    const naddrKind = quoteEl.dataset.naddrKind;
    const ownerEventEl = quoteEl.closest && quoteEl.closest('.event[data-event-id]');
    const ownerEventId = ownerEventEl && ownerEventEl.dataset ? ownerEventEl.dataset.eventId : null;
    if (eventId && ownerEventId && ownerEventId === eventId) continue;
    if (!eventId && !naddrKind) continue;

    const relays = resolveQuoteRelays(quoteEl, state);
    if (!relays.length) continue;
    const rk = relaySetKey(relays);
    if (!prefetchByRelay.has(rk)) {
      prefetchByRelay.set(rk, { relays, ids: [], naddrs: [] });
    }
    const group = prefetchByRelay.get(rk);

    if (eventId) {
      group.ids.push(eventId);
    } else if (naddrKind) {
      const kind = parseInt(naddrKind, 10);
      const pubkey = quoteEl.dataset.naddrPubkey;
      const identifier = quoteEl.dataset.naddrIdentifier;
      if (!isNaN(kind) && pubkey && identifier !== undefined) {
        group.naddrs.push({ kind, pubkey, identifier });
      }
    }
  }

  const tasks = [];
  for (const { relays, ids, naddrs } of prefetchByRelay.values()) {
    if (ids.length) tasks.push(prefetchQuoteEventIds(state, relays, ids));
    for (const na of naddrs) {
      tasks.push(fetchQuoteEventByNaddr(state, relays, na.kind, na.pubkey, na.identifier));
    }
  }
  if (tasks.length) await Promise.all(tasks);
}

async function updateNostrNoteLinks(container, showEventModal, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager, recursionState = null) {
  if (!container) return;
  const globalState = window.__nostrState;
  if (!state) state = globalState;
  if (!state || !state.pool) return;
  if (!nip19) nip19 = getNip19();
  const depth = recursionState && typeof recursionState.depth === 'number' ? recursionState.depth : 0;
  const maxDepth = recursionState && typeof recursionState.maxDepth === 'number'
    ? recursionState.maxDepth
    : NOSTR_QUOTE_RECURSION_MAX_DEPTH;
  if (depth > maxDepth) return;

  // noteリンクと引用要素（note1, nevent1, naddr1）を処理
  const quoteElements = Array.from(container.querySelectorAll('.nostr-quote'));
  await prefetchQuotesForElements(state, quoteElements);

  for (const quoteEl of quoteElements) {
    const eventId = quoteEl.dataset.eventId;
    const naddrKind = quoteEl.dataset.naddrKind;
    const ownerEventEl = quoteEl.closest && quoteEl.closest('.event[data-event-id]');
    const ownerEventId = ownerEventEl && ownerEventEl.dataset ? ownerEventEl.dataset.eventId : null;

    // 自己参照の再帰置換ループを防ぐ
    if (eventId && ownerEventId && ownerEventId === eventId) continue;

    if (!eventId && !naddrKind) continue;

    const resolved = await resolveAndRenderQuote(
      quoteEl, container, showEventModal, state, nip19,
      reactToEvent, replyToEvent, repostEvent, settings, settingsManager,
      depth, maxDepth
    );
    if (!resolved) {
      attachQuoteRetryHandler(
        quoteEl, container, showEventModal, state, nip19,
        reactToEvent, replyToEvent, repostEvent, settings, settingsManager,
        depth, maxDepth
      );
    }
  }
}

/**
 * 単一の .nostr-quote 要素についてイベントを解決し、引用カード等へ置き換える。
 * 取得・描画に成功した場合は true、イベントが最終的に取得できなかった場合は false を返す。
 */
async function resolveAndRenderQuote(quoteEl, container, showEventModal, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager, depth, maxDepth) {
  const eventId = quoteEl.dataset.eventId;
  const naddrKind = quoteEl.dataset.naddrKind;

  try {
    const nip19local = getNip19();

    let event = null;
    if (eventId) {
      event = findEventById(state, eventId);
    }

    // イベントキャッシュがない場合、リレーから取得（in-flight dedup / batch 済み）
    if (!event) {
      const relays = resolveQuoteRelays(quoteEl, state);
      if (relays.length > 0) {
        if (eventId) {
          event = await fetchQuoteEventById(state, relays, eventId);
        } else if (naddrKind) {
          const kind = parseInt(naddrKind, 10);
          const pubkey = quoteEl.dataset.naddrPubkey;
          const identifier = quoteEl.dataset.naddrIdentifier;
          if (!isNaN(kind) && pubkey && identifier !== undefined) {
            event = await fetchQuoteEventByNaddr(state, relays, kind, pubkey, identifier);
          }
        }
      }
    }

    // kind 1 (Note), kind 42 (Chat), kind 30023 (Long-form) などを引用表示
    // naddrの場合はコンテンツがあれば表示するようにする
    if (event && (event.kind === 1 || event.kind === 42 || event.kind === 30023 || (naddrKind && event.content))) {
      const quoteHtml = await renderEventQuote(state, event, nip19local, settings);
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = quoteHtml;
      const quoteDiv = tempDiv.firstChild;
      if (quoteDiv) {
        const anchor = captureTimelineAnchor(container);
        quoteEl.parentNode.replaceChild(quoteDiv, quoteEl);
        restoreTimelineAnchor(anchor, container);
        try { updateNostrNpubLinks(quoteDiv); } catch (e) { }
        if (depth < maxDepth) {
          try {
            await updateNostrNoteLinks(
              quoteDiv,
              showEventModal,
              state,
              nip19,
              reactToEvent,
              replyToEvent,
              repostEvent,
              settings,
              settingsManager,
              { depth: depth + 1, maxDepth }
            );
          } catch (e) { }
        }
        // 置換後引用内のカスタム絵文字画像を隙間なく並ぶサイズへ調整
        try { if (typeof fitCustomEmoji === 'function') fitCustomEmoji(quoteDiv, 18); } catch (e) { }
        // ここでクリックイベントを追加（複数対応）
        const labelEls = quoteDiv.querySelectorAll('.event-quote-label[data-pubkey]');
        labelEls.forEach(labelEl => {
          labelEl.onclick = function () {
            const pubkey = labelEl.getAttribute('data-pubkey');
            if (pubkey) {
              import('./main.js').then(mod => {
                if (mod.showProfileModalProxy) mod.showProfileModalProxy(pubkey);
              });
            }
          };
        });
        // 引用本文クリックで詳細モーダル。ただし本文内の「画像を開く」やメディアリンクはメディアビューアを優先
        const contentEl = quoteDiv.querySelector('.event-quote-content');
        if (contentEl && typeof showEventModal === 'function') {
          contentEl.onclick = function (e) {
            try {
              // open-media ボタンならイベントモーダルではなくメディアビューアを開く
              const btn = e.target.classList.contains('open-media') ? e.target : e.target.closest('.open-media');
              if (btn) {
                e.preventDefault();
                const url = btn.dataset.url;
                const type = btn.dataset.type || 'auto';
                if (url) {
                  showMediaViewer(url, type);
                }
                return false;
              }

              // media-link クリック時もメディアビューアを優先
              const link = e.target.classList.contains('media-link') ? e.target : e.target.closest('.media-link');
              if (link) {
                e.preventDefault();
                const url = link.dataset.url;
                const type = link.dataset.type || 'auto';
                if (url) showMediaViewer(url, type);
                return false;
              }
            } catch (err) {
              // 失敗時は無視してイベントモーダル表示へフォールバック
            }
            e.stopPropagation();
            showEventModal(event, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
          };
        }
      }
      return true;
    } else if (event && (event.kind === 6 || event.kind === 7 || event.kind === 16)) {
      const { renderReplyContext } = await import('./renderer.js');
      const referenceHtml = (typeof renderReplyContext === 'function')
        ? renderReplyContext(state, event, nip19local, { isModal: false, showTimelineMedia: false, settingsManager })
        : '';
      if (referenceHtml) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = referenceHtml;
        const referenceDiv = tempDiv.firstChild;
        if (referenceDiv) {
          const { showEventModal: showEventModalLocal } = await import('./event-modal.js');
          const clickableRefs = referenceDiv.querySelectorAll('.reply-to-author[data-event-id], .reply-to-content[data-event-id]');
          clickableRefs.forEach((el) => {
            const refEventId = el.getAttribute('data-event-id');
            if (!refEventId) return;
            const referencedEvent = findEventById(state, refEventId);
            if (!referencedEvent) return;
            el.style.cursor = 'pointer';
            el.onclick = function (e) {
              try {
                e.preventDefault();
                e.stopPropagation();
              } catch (_) { }
              showEventModalLocal(referencedEvent, state, nip19local, null, null, null, settings, settingsManager);
            };
          });

          const anchor = captureTimelineAnchor(container);
          quoteEl.parentNode.replaceChild(referenceDiv, quoteEl);
          restoreTimelineAnchor(anchor, container);
          try { updateNostrNpubLinks(referenceDiv); } catch (e) { }
          if (depth < maxDepth) {
            try {
              await updateNostrNoteLinks(
                referenceDiv,
                showEventModal,
                state,
                nip19,
                reactToEvent,
                replyToEvent,
                repostEvent,
                settings,
                settingsManager,
                { depth: depth + 1, maxDepth }
              );
            } catch (e) { }
          }
        }
      } else {
        const { showJsonModal } = await import('./json-modal.js');
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'nostr-link nostr-event-json';
        link.textContent = `[kind ${event.kind} event]`;
        link.style.cssText = 'color: #fbbf24; text-decoration: none; border-bottom: 1px solid transparent; font-size: 0.9em;';
        link.onclick = function (e) {
          e.preventDefault();
          showJsonModal(event);
          return false;
        };
        quoteEl.parentNode.replaceChild(link, quoteEl);
      }
      return true;
    } else if (event) {
      const { showJsonModal } = await import('./json-modal.js');
      const link = document.createElement('a');
      link.href = '#';
      link.className = 'nostr-link nostr-event-json';
      link.textContent = `[kind ${event.kind} event]`;
      link.style.cssText = 'color: #fbbf24; text-decoration: none; border-bottom: 1px solid transparent; font-size: 0.9em;';
      link.onclick = function (e) {
        e.preventDefault();
        showJsonModal(event);
        return false;
      };
      quoteEl.parentNode.replaceChild(link, quoteEl);
      return true;
    }

    return false;
  } catch (e) {
    console.warn('[UrlParser] 引用イベント取得に失敗:', e);
    return false;
  }
}

/**
 * 取得に失敗した .nostr-quote 要素をクリック/キーボード操作可能にし、
 * アクティブ化時に再取得を試みる（V キー操作からは refEl.click() 経由で流用される）
 */
function attachQuoteRetryHandler(quoteEl, container, showEventModal, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager, depth, maxDepth) {
  if (!quoteEl || quoteEl.dataset.retryHandlerInstalled === '1') return;
  quoteEl.dataset.retryHandlerInstalled = '1';
  quoteEl.classList.add('nostr-quote-clickable');
  quoteEl.setAttribute('role', 'button');
  quoteEl.tabIndex = 0;

  const placeholderText = quoteEl.textContent;

  const handleActivate = async (e) => {
    try { e.stopPropagation(); } catch (_) { }
    if (quoteEl.dataset.retryLoading === '1') return;
    if (!quoteEl.isConnected) return;
    quoteEl.dataset.retryLoading = '1';
    quoteEl.textContent = t('quote.loading', '取得中...');
    let resolved = false;
    try {
      resolved = await resolveAndRenderQuote(
        quoteEl, container, showEventModal, state, nip19,
        reactToEvent, replyToEvent, repostEvent, settings, settingsManager,
        depth, maxDepth
      );
    } catch (e) { resolved = false; }
    if (!resolved && quoteEl.isConnected) {
      quoteEl.textContent = placeholderText;
      delete quoteEl.dataset.retryLoading;
    }
  };

  quoteEl.addEventListener('click', handleActivate);
  quoteEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      handleActivate(e);
    }
  });
}

/**
 * イベントを引用ブロックとしてレンダリング
 */
async function renderEventQuote(state, event, nip19, settings = {}) {
  const { displayName } = await import('./profile.js');
  // kind:20000 ならnタグか#xxxxを即時採用し、displayName()結果を無視
  let author;
  if (event && event.kind === 20000) {
    const pk = event.pubkey || '';
    const hash = (pk && pk.length >= 4) ? '#' + pk.slice(-4) : '';
    const nTag = Array.isArray(event.tags) ? event.tags.find(t => t && t[0] === 'n') : null;
    const nName = (nTag && nTag[1]) ? String(nTag[1]).trim() : '';
    author = truncateName(nName || hash);
  } else {
    author = truncateName(displayName(state, event.pubkey, nip19));
  }
  const content = event.content || '';
  let quoteContentHtml = '';
  // ユーザー設定値を優先
  let previewMaxLength = MAX_PREVIEW_LENGTH;
  try {
    const sm = (typeof window !== 'undefined' && window.settingsManager) ? window.settingsManager : null;
    if (sm && typeof sm.get === 'function') {
      const v = sm.get('previewMaxLength');
      if (v && !isNaN(v)) previewMaxLength = parseInt(v, 10);
    }
  } catch {}
  if (getEffectiveTextLength(content) > previewMaxLength || content.split('\n').length > MAX_PREVIEW_LINES) {
    const previewText = getPreviewWithFullLinksAndEmojis(content, previewMaxLength, MAX_PREVIEW_LINES);
    quoteContentHtml = `<span class="reply-preview-text">${linkifyText(previewText, event.tags || [], { inlineMedia: false })}</span>`;
    if (previewText.length < content.length) {
      quoteContentHtml += `<button type="button" class="read-more-btn secondary quote-read-more">${t('see_detail','省略されています')}</button>`;
    }
  } else {
    quoteContentHtml = `<span class="reply-preview-text">${linkifyText(content, event.tags || [], { inlineMedia: false })}</span>`;
  }
  const quotedLabel = replaceBadgeEmoji(t('quote.label', { author: escapeHtml(author) }));
  return '<div class="event-quote">' +
    '<div class="event-quote-header">' +
    '<span class="reply-marker"><img src="icon/note.png" alt="' + escapeHtml(t('quote.icon_alt') || '引用') + '" class="icon"/></span>' +
    '<span class="event-quote-label" data-pubkey="' + event.pubkey + '">' + quotedLabel + '</span>' +
    '</div>' +
    `<div class="event-quote-content" data-event-id="${event.id || ''}">${quoteContentHtml}</div>` +
    '</div>';
}

/**
 * カスタム絵文字画像の短辺を `shortSidePx` に合わせ、アスペクト比を維持して調整する。
 * 絵文字を隙間なく敷き詰めるため、DOM挿入後に呼び出す。
 */
function fitCustomEmoji(container, shortSidePx = 28) {
  if (!container) return;
  try {
    // 指定値をそのまま使用（以前の2倍化で発生していた過剰拡大を回避）
    const effectiveShort = Math.max(1, Math.round(shortSidePx || 0));
    // mixed-line の inline 絵文字は拡大しない（28px で最適化済み）
    const inlineEnlargeFactor = 1.0; // no enlargement needed
    const inlineShort = Math.max(1, Math.round(effectiveShort * inlineEnlargeFactor));

    const imgs = container.querySelectorAll('img.custom-emoji');
    imgs.forEach(img => {
      try {
        // ラッパー要素を確保し、高さ調整で隙間を防ぐ
        const wrap = img.closest('.emoji-wrap') || img.parentElement;
        const applySizing = () => {
          try {
            // inline group 内の絵文字は短辺基準（px）でサイズ調整
            const inlineGroup = img.closest('.emoji-inline-group');
            const emojiLineAncestor = img.closest('.emoji-line');
            const isReaction = img.closest('.reply-marker') || img.closest('.btn-react') || img.closest('.event-actions-react');
            if (isReaction) {
              img.style.height = 'auto';
              img.style.maxHeight = '18px';
              img.style.width = 'auto';
              img.style.maxWidth = '100%';
              img.style.display = 'inline-block';
              img.style.verticalAlign = '-0.15em';
              img.style.margin = '0';
              img.style.padding = '0';
              img.style.lineHeight = '1';
            } else if (inlineGroup) {
              const targetShort = inlineShort;
              img.style.height = 'auto';
              img.style.maxHeight = targetShort + 'px';
              img.style.width = 'auto';
              img.style.maxWidth = '100%';
              img.style.display = 'inline-block';
              img.style.verticalAlign = 'middle';
              img.style.margin = '0';
              img.style.padding = '0';
              img.style.lineHeight = '1';
              if (wrap) {
                wrap.style.maxWidth = '100%';
                wrap.style.display = 'inline-block';
                wrap.style.margin = '0';
                wrap.style.padding = '0';
                wrap.style.lineHeight = '1';
                wrap.style.verticalAlign = 'middle';
              }
            } else if (emojiLineAncestor) {
              const nw = img.naturalWidth || img.width || 0;
              const nh = img.naturalHeight || img.height || 0;
              if (!nw || !nh) {
                img.style.height = 'auto';
                img.style.maxHeight = effectiveShort + 'px';
                img.style.width = 'auto';
                if (wrap) wrap.style.height = img.getBoundingClientRect().height + 'px';
              } else if (nw <= nh) {
                img.style.width = effectiveShort + 'px';
                img.style.height = 'auto';
              } else {
                img.style.height = 'auto';
                img.style.maxHeight = effectiveShort + 'px';
                img.style.width = 'auto';
              }
              img.style.display = 'block';
              img.style.margin = '0';
              img.style.padding = '0';
              img.style.lineHeight = '1';
              img.style.objectFit = 'contain';
              img.style.maxWidth = '100%';
              if (wrap) {
                wrap.style.maxWidth = '100%';
                const rect = img.getBoundingClientRect();
                if (rect && rect.height) {
                  wrap.style.height = rect.height + 'px';
                  wrap.style.display = 'inline-block';
                  wrap.style.margin = '0';
                  wrap.style.padding = '0';
                  wrap.style.verticalAlign = 'top';
                }
              }
            } else {
              const maxEmH = 3.6;
              const nw = img.naturalWidth || img.width || 0;
              const nh = img.naturalHeight || img.height || 0;
              if (!nw || !nh) {
                img.style.height = 'auto';
                img.style.maxHeight = (effectiveShort * 1.0) + 'px';
                img.style.width = 'auto';
                if (wrap) wrap.style.height = img.getBoundingClientRect().height + 'px';
              } else if (nw <= nh) {
                img.style.width = effectiveShort + 'px';
                img.style.height = 'auto';
                img.style.maxHeight = maxEmH + 'em';
              } else {
                img.style.height = 'auto';
                img.style.maxHeight = effectiveShort + 'px';
                img.style.width = 'auto';
              }
              img.style.display = 'block';
              img.style.objectFit = 'contain';
              img.style.maxWidth = '100%';
              if (wrap) {
                wrap.style.maxWidth = '100%';
                const rect = img.getBoundingClientRect();
                if (rect && rect.height) {
                  wrap.style.height = rect.height + 'px';
                  wrap.style.display = 'inline-block';
                  wrap.style.verticalAlign = 'top';
                }
              }
            }
          } catch (e) { }
          try { followUpTimelineAnchor(container); } catch (e) { }
        };

        if (img.complete && (img.naturalWidth || img.naturalHeight)) {
          applySizing();
        } else {
          img.addEventListener('load', applySizing, { once: true });
          // 保険として短時間後にも再試行
          setTimeout(applySizing, 300);
        }
      } catch (e) { }
    });
  } catch (e) { }
}

/**
 * URL・nostr: URI・カスタム絵文字を除外した実効テキスト文字数を返す
 */
export function getEffectiveTextLength(text) {
  if (!text) return 0;
  const merged = collectMergedSkipRanges(text);

  let visibleCount = 0;
  let pos = 0;
  let si = 0;

  while (pos < text.length) {
    while (si < merged.length && pos >= merged[si].end) si++;
    if (si < merged.length && pos >= merged[si].start && pos < merged[si].end) {
      pos = merged[si].end;
      continue;
    }

    const step = getGraphemeLengthAt(text, pos) || 1;
    pos += step;
    visibleCount++;
  }

  return visibleCount;
}

/**
 * プレビュー用テキストを生成
 * URL・nostr: URI・カスタム絵文字は文字数カウントから除外し、置換後の表示を基準に省略する
 * maxLines > 0 の場合、行数制限も適用する
 */
export function getPreviewWithFullLinksAndEmojis(text, maxLength, maxLines = 0) {
  // スキップ範囲（全URL・nostr: URI・カスタム絵文字・隠しタグ文字）を収集
  const merged = collectMergedSkipRanges(text);

  // 実効文字数を計算（書記素クラスタ単位）
  const effectiveLength = getEffectiveTextLength(text);

  // 行数制限位置を計算
  let lineLimit = text.length;
  if (maxLines > 0) {
    let newlineCount = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        newlineCount++;
        if (newlineCount === maxLines) {
          lineLimit = i;
          break;
        }
      }
    }
  }

  const needsCharTruncation = effectiveLength > maxLength;
  const needsLineTruncation = maxLines > 0 && lineLimit < text.length;

  if (!needsCharTruncation && !needsLineTruncation) return text;

  // テキストを走査し、スキップ範囲はカウントせずに含める
  let visibleCount = 0;
  let pos = 0;
  let si = 0;
  const charLimit = needsCharTruncation ? maxLength : Infinity;

  while (pos < text.length && visibleCount < charLimit && pos < lineLimit) {
    while (si < merged.length && pos >= merged[si].end) si++;
    if (si < merged.length && pos >= merged[si].start && pos < merged[si].end) {
      pos = Math.min(merged[si].end, lineLimit);
      continue;
    }

    const nextSkipStart = si < merged.length ? merged[si].start : text.length;
    const nextBound = Math.min(nextSkipStart, lineLimit);
    if (pos >= nextBound) {
      pos = nextBound;
      continue;
    }

    const step = getGraphemeLengthAt(text, pos) || 1;
    pos += Math.min(step, nextBound - pos);
    visibleCount++;
  }

  return text.slice(0, pos);
}

function sanitizeRelays(relays) {
  if (!Array.isArray(relays)) return [];
  return relays.filter(r => {
    try {
      if (typeof r !== 'string') return false;
      const trimmed = r.trim();
      if (!trimmed) return false;
      const u = new URL(trimmed);
      return u.protocol === 'ws:' || u.protocol === 'wss:';
    } catch (e) {
      return false;
    }
  });
}

// export重複問題を避けるためエクスポートを1か所に集約
export {
  linkifyText,
  setupMediaLinkHandlers,
  linkifyNostrUri,
  updateNostrNpubLinks,
  updateNostrNoteLinks,
  fitCustomEmoji,
  getNip19,
  captureTimelineAnchor,
  restoreTimelineAnchor,
  followUpTimelineAnchor
};
// getEffectiveTextLength と getPreviewWithFullLinksAndEmojis は上で inline export 済み
