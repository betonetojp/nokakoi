// ============================================================================
// ユーティリティ関数
// ============================================================================

import { t } from './i18n.js';
import {
  getRegisteredTextShortcodeVariant,
  resolveCustomEmoji
} from './custom-emoji-store.js';

/**
 * DOMクエリショートカット
 */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const REACTION_SHORTCODE_ONLY_RE = /^:([a-zA-Z0-9_+-]+):$/;

export function getReactionContent(reaction) {
  if (reaction && typeof reaction === 'object' && typeof reaction.content === 'string') {
    return reaction.content;
  }
  return (typeof reaction === 'string') ? reaction : '';
}

export function getReactionEmojiTags(reaction) {
  if (!reaction || typeof reaction !== 'object' || !Array.isArray(reaction.emojiTags)) return [];
  return reaction.emojiTags.filter(tag => Array.isArray(tag) && tag[0] === 'emoji' && tag[1] && tag[2]);
}

export function isReactionShortcodeOnly(reaction) {
  return REACTION_SHORTCODE_ONLY_RE.test(getReactionContent(reaction));
}

export function resolveReactionCustomEmoji(reaction) {
  const content = getReactionContent(reaction);
  const match = content.match(REACTION_SHORTCODE_ONLY_RE);
  if (!match) return null;

  const shortcode = match[1];
  const storedTag = getReactionEmojiTags(reaction).find(tag => tag[1] === shortcode && tag[2]);
  if (storedTag) {
    return {
      shortcode,
      url: String(storedTag[2]),
      address: storedTag[3] ? String(storedTag[3]) : ''
    };
  }

  try {
    const registered = getRegisteredTextShortcodeVariant(shortcode);
    if (registered && registered.url) {
      return {
        shortcode,
        url: String(registered.url),
        address: registered.address ? String(registered.address) : ''
      };
    }
  } catch (e) { logWarn('[Utils] getRegisteredTextShortcodeVariant 失敗:', e); }

  try {
    const customEmojis = (typeof window !== 'undefined' && window.__customEmojis instanceof Map) ? window.__customEmojis : null;
    if (customEmojis) {
      const resolved = resolveCustomEmoji(customEmojis, shortcode);
      if (resolved && resolved.url) {
        return {
          shortcode,
          url: String(resolved.url),
          address: resolved.address ? String(resolved.address) : ''
        };
      }
    }
  } catch (e) { logWarn('[Utils] resolveCustomEmoji 失敗:', e); }

  if (shortcode === 'nokakoi') {
    let iconUrl = 'icon/nokakoi.png';
    return { shortcode, url: iconUrl, address: '' };
  }

  return null;
}

export function buildReactionEmojiTags(reaction) {
  const resolved = resolveReactionCustomEmoji(reaction);
  if (!resolved || !resolved.url) return [];
  const tag = ['emoji', resolved.shortcode, resolved.url];
  if (resolved.address) tag.push(resolved.address);
  return [tag];
}

export function buildStoredReactionValue(reaction) {
  const content = (getReactionContent(reaction) || '').trim();
  if (!content) return '';

  const emojiTags = getReactionEmojiTags(reaction);
  if (emojiTags.length) {
    return { content, emojiTags };
  }

  const resolvedEmojiTags = buildReactionEmojiTags(content);
  if (resolvedEmojiTags.length) {
    return { content, emojiTags: resolvedEmojiTags };
  }

  return content;
}

/**
 * 要素にステータスメッセージをセット
 */
export function setStatus(el, msg) {
  if (el) el.textContent = msg;
}

/**
 * HTMLエスケープ（XSS防止）
 */
export function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * システムペットネームのマーカー（\u200B📛）を badge.png 画像タグに置換
 */
export function replaceBadgeEmoji(html) {
  if (typeof html !== 'string') return html;
  return html.replace(/\u200B📛/g, '<span class="icon petname-badge" role="img" aria-label="📛"></span>');
}


/**
 * タイムスタンプをローカル時刻文字列に変換
 */
export function fmtTime(ts) {
  const d = new Date(ts * 1000);
  try {
    const now = new Date();
    // 同じローカル日付（年・月・日）なら時刻のみ（秒付き）を表示
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    // それ以外は年を省略し、月/日 時:分を表示
    return d.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return d.toLocaleString();
  }
}

/**
 * バイト数で文字列を切り詰め（半角=1・全角=2、サロゲートペア対応）
 */
export function truncateByBytes(str, maxBytes) {
  if (!str) return '';
  let bytes = 0;
  let i = 0;
  while (i < str.length) {
    const c = str.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
      // サロゲートペア: 全角1文字として扱い2つのcode unitをまとめてスキップ
      bytes += 2;
      if (bytes > maxBytes) break;
      i += 2;
    } else {
      bytes += (c <= 0x7F) ? 1 : 2;
      if (bytes > maxBytes) break;
      i++;
    }
  }
  return i < str.length ? str.slice(0, i) + '...' : str;
}

/**
 * 名前の省略（表示幅16超で切り詰め）
 */
export function truncateName(str) {
  return truncateByGraphemeVisible(str, 16);
}

const HIDDEN_TAG_CHARS_RE = /[\u{E0100}-\u{E01EF}]+/u;

/**
 * 表示幅寄りのルールで文字列を切り詰める。
 * 半角=1、非ASCII=2、サロゲートペア=2。
 * Unicode Tag characters は文字数にカウントしない（セクシー餃子用）。
 */
export function truncateByGraphemeVisible(str, maxVisibleChars) {
  if (!str || !Number.isFinite(maxVisibleChars) || maxVisibleChars <= 0) return '';

  let pos = 0;
  let visible = 0;
  let cutPos = str.length;

  while (pos < str.length) {
    const tail = str.slice(pos);
    const hidden = HIDDEN_TAG_CHARS_RE.exec(tail);
    if (hidden && hidden.index === 0) {
      pos += hidden[0].length;
      continue;
    }

    if (visible >= maxVisibleChars) {
      cutPos = pos;
      break;
    }

    const c = str.charCodeAt(pos);
    let step = 1;
    let width;
    if (c >= 0xD800 && c <= 0xDBFF && pos + 1 < str.length) {
      step = 2;
      width = 2;
    } else {
      width = (c <= 0x7F) ? 1 : 2;
    }

    if (visible + width > maxVisibleChars) {
      cutPos = pos;
      break;
    }

    pos += step;
    visible += width;
  }

  if (cutPos === str.length && pos >= str.length) return str;

  // 直前に採用した可視文字へ付く隠しタグ列は維持する
  let end = cutPos;
  while (end < str.length) {
    const hidden = HIDDEN_TAG_CHARS_RE.exec(str.slice(end));
    if (!(hidden && hidden.index === 0)) break;
    end += hidden[0].length;
  }

  return str.slice(0, end) + '...';
}

/**
 * Promise.anyのフォールバック（古いブラウザ用）
 */
export async function awaitAny(promises) {
  if (typeof Promise.any === 'function') return Promise.any(promises);
  return Promise.race(promises);
}

/**
 * リレーリストの重複除去（URL正規化）
 */
export function uniqueRelays(list) {
  const seen = new Set();
  const out = [];
  for (const r of list) {
    // rが文字列か確認してreplace
    if (typeof r !== 'string') continue;
    const key = r.replace(/\/$/, '');
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * 背景色文字列（hex または rgb/rgba）に対して読みやすい文字色（'#000' または '#fff'）を返す。
 */
function contrastColorForBg(color) {
  try {
    if (!color) return '#fff';
    let r, g, b;
    const s = String(color).trim();
    // rgb または rgba
    const mRgb = s.match(/^rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (mRgb) {
      r = parseInt(mRgb[1], 10);
      g = parseInt(mRgb[2], 10);
      b = parseInt(mRgb[3], 10);
    } else {
      // 16進表現
      const hex = s.replace('#', '');
      if (!/^[0-9a-fA-F]+$/.test(hex)) return '#fff';
      const full = (hex.length === 3) ? hex.split('').map(c => c + c).join('') : hex;
      const intval = parseInt(full, 16);
      r = (intval >> 16) & 255;
      g = (intval >> 8) & 255;
      b = intval & 255;
    }
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 180 ? '#000' : '#fff';
  } catch (e) { return '#fff'; }
}

/**
 * ドキュメントからテーマのボタン色を解決。primary（非 secondary）を優先し、なければ CSS 変数へフォールバック。
 */
function resolveThemeButtonBg(type) {
  try {
    // 可能なら primary の Publish ボタンを優先し、その色に合わせる
    let sample = null;
    try { sample = document.getElementById('publishBtn'); } catch (e) { sample = null; }
    // フォールバック順: 非 secondary ボタン -> secondary ボタン -> 任意ボタン
    if (!sample) sample = document.querySelector('button:not(.secondary)');
    if (!sample) sample = document.querySelector('button.secondary') || document.querySelector('button');
    if (sample) {
      try {
        const cs = window.getComputedStyle(sample);
        // background-color を優先し、透明なら color を使う
        const bg = (cs && cs.backgroundColor) ? cs.backgroundColor : (cs && cs.color) ? cs.color : null;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
      } catch (e) { }
    }
    // アクセント/ボタン色で一般的な CSS カスタムプロパティを試す
    try {
      const root = window.getComputedStyle(document.documentElement);
      const candidates = ['--button-bg', '--button-background', '--accent', '--accent-color', '--brand', '--button-primary'];
      for (const v of candidates) {
        try {
          const val = root.getPropertyValue(v);
          if (val && val.trim()) return val.trim();
        } catch (e) { }
      }
    } catch (e) { }
    // type ごとのフォールバック
    if (type === 'error') return 'rgba(140,20,20,0.98)';
    if (type === 'success') return 'rgba(20,110,30,0.95)';
    return 'rgba(20,20,28,0.98)';
  } catch (e) {
    if (type === 'error') return 'rgba(140,20,20,0.98)';
    if (type === 'success') return 'rgba(20,110,30,0.95)';
    return 'rgba(20,20,28,0.98)';
  }
}

/**
 * 一時的なトーストメッセージを表示。Options: { duration: ms, type: 'info'|'error'|'success' }
 */
export function showToast(message, options = {}) {
  try {
    if (!message) return;
    const duration = (options && typeof options.duration === 'number') ? options.duration : 4500; // 既定表示時間を延長
    const type = (options && options.type) ? options.type : 'info';

    // 必要ならコンテナを作成
    let container = document.getElementById('nokakoi-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'nokakoi-toast-container';
      container.style.position = 'fixed';
      container.style.bottom = '24px';
      container.style.left = '50%';
      container.style.transform = 'translateX(-50%)';
      container.style.zIndex = '99999';
      container.style.display = 'flex';
      container.style.flexDirection = 'column';
      container.style.alignItems = 'center';
      container.style.gap = '8px';
      container.style.pointerEvents = 'none';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'nokakoi-toast ' + ('nokakoi-toast-' + type);
    toast.textContent = message;
    // 基本スタイル
    toast.style.pointerEvents = 'auto';
    toast.style.padding = '8px 12px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 6px 18px rgba(0,0,0,0.45)';
    toast.style.fontSize = '0.95em';
    toast.style.maxWidth = '80vw';
    toast.style.wordBreak = 'break-word';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 180ms ease, transform 180ms ease';
    toast.style.transform = 'translateY(8px)';

    // テーマのボタン色から背景色を決定
    const bg = resolveThemeButtonBg(type);
    toast.style.background = bg;

    // 可能なら Publish ボタンの文字色を優先、なければコントラストで決定
    let textColor = null;
    try {
      const pubBtn = document.getElementById('publishBtn');
      if (pubBtn) {
        const cs = window.getComputedStyle(pubBtn);
        if (cs && cs.color) textColor = cs.color;
      }
    } catch (e) { textColor = null; }
    if (!textColor) textColor = contrastColorForBg(bg);
    toast.style.color = textColor;

    container.appendChild(toast);

    // フェードイン
    requestAnimationFrame(() => {
      try { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; } catch (e) { }
    });

    // duration 経過後に削除
    const to = setTimeout(() => {
      try {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        setTimeout(() => { try { toast.parentNode && toast.parentNode.removeChild(toast); } catch (e) { } }, 220);
      } catch (e) { }
    }, duration);

    // クリックで閉じられるようにする
    toast.addEventListener('click', () => {
      try { clearTimeout(to); toast.style.opacity = '0'; toast.style.transform = 'translateY(8px)'; setTimeout(() => { try { toast.parentNode && toast.parentNode.removeChild(toast); } catch (e) { } }, 220); } catch (e) { }
    });
  } catch (e) { console.warn('[Utils] showToast に失敗', e); }
}
/**
 * Amethyst 等のステガノグラフィ投稿に含まれる Unicode Tags ブロック (U+E0000–U+E00FF) の
 * 隠し文字を検出し、クリックで表示できるよう DOM 要素を加工する。
 * 隠し文字を持つ絵文字には視覚的インジケータを付与する。
 */
export function processHiddenTagChars(el) {
  if (!el) return;
  const TAG_RE = /[\u{E0100}-\u{E01EF}]/u;

  function decodeTagChars(tagStr) {
    try {
      const bytes = [];
      for (const ch of tagStr) {
        const cp = ch.codePointAt(0);
        if (cp >= 0xE0100 && cp <= 0xE01EF) bytes.push(cp - 0xE00F0);
      }
      if (bytes.length === 0) return null;
      return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
    } catch (e) { return null; }
  }

  // テキストノードを先に収集してから DOM を変更する
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (TAG_RE.test(node.textContent)) textNodes.push(node);
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent;
    // 「書記素クラスタ + 1つ以上のタグ文字」のパターンを探す
    // 複雑な絵文字（修飾子付き、ZWJシーケンス、地域フラグ）に対応
    // フォールバック: \p{Emoji_Presentation}/\p{Extended_Pictographic} に含まれない文字（✹ など）にも対応
    const PATTERN = /([\u{1F1E6}-\u{1F1FF}]{2}|[\p{Emoji_Presentation}\p{Extended_Pictographic}](?:[\u{FE0E}\u{FE0F}]?(?:\u200D[\p{Emoji_Presentation}\p{Extended_Pictographic}][\u{FE0E}\u{FE0F}]?)*)(?:[\u{1F3FB}-\u{1F3FF}])?|[^\u{E0000}-\u{E01FF}\s])([\u{E0100}-\u{E01EF}]+)/gu;
    let match;
    let lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let found = false;

    while ((match = PATTERN.exec(text)) !== null) {
      found = true;
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const visibleEmoji = match[1];
      const decoded = decodeTagChars(match[2]);
      if (decoded) {
        const span = document.createElement('span');
        span.className = 'steganography-emoji';
        span.dataset.hidden = decoded;
        span.title = t('steganography.click_to_reveal');
        span.textContent = visibleEmoji;
        span.addEventListener('click', function (e) {
          e.stopPropagation();
          const existing = span.querySelector('.steganography-revealed');
          if (existing) {
            existing.remove();
            span.classList.remove('steganography-open');
          } else {
            const popup = document.createElement('span');
            popup.className = 'steganography-revealed';
            popup.textContent = decoded;
            // 表示したテキスト内にも隠し文字付き絵文字があれば再帰的に展開可能にする
            processHiddenTagChars(popup);
            span.appendChild(popup);
            span.classList.add('steganography-open');
          }
        });
        fragment.appendChild(span);
      } else {
        fragment.appendChild(document.createTextNode(visibleEmoji));
      }
      lastIndex = match.index + match[0].length;
    }

    if (found) {
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  }
}

/**
 * 文字列の最初の書記素クラスタの終端位置を取得する。
 * Intl.Segmenterを使用（対応ブラウザ）、フォールバック：複雑な絵文字パターンを検出。
 * @param {string} text - 対象テキスト
 * @returns {number} クラスタの終端位置
 */
function getGraphemeClusterEnd(text) {
  if (!text) return 0;

  // 書記素クラスタ分割をサポートするブラウザの場合
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      for (const segment of segmenter.segment(text)) {
        return segment.index + segment.segment.length;
      }
    } catch (e) {
      // フォールバック: 下記の正規表現で処理
    }
  }

  // フォールバック：複雑な絵文字パターンをマッチング
  // - 地域フラグ記号（🇯🇵など、連続する地域インジケーター）
  // - ZWJシーケンス（👨‍👩‍👧‍👦など）
  // - Variation Selector付き絵文字（☀️など）
  // - 修飾子付き絵文字（👍🏻など）
  // 優先順：地域フラグ > 基本絵文字シーケンス > 単一文字

  // 地域フラグ記号（Regional Indicator のペア）
  const regionalFlagPattern = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
  const flagMatch = regionalFlagPattern.exec(text);
  if (flagMatch && flagMatch.index === 0) {
    return flagMatch[0].length;
  }

  // 複雑な絵文字シーケンス
  // パターン詳細：
  //   (?:[\p{Emoji_Presentation}\p{Extended_Pictographic}])           基本絵文字
  //   (?:\u{FE0E}|\u{FE0F})?                                         Variation Selector
  //   (?:\u200D(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}](?:\u{FE0E}|\u{FE0F})?))*  ZWJ + 追加要素
  //   (?:[\u{1F3FB}-\u{1F3FF}])?                                    肌色修飾子
  const emojiPattern = /(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}](?:\u{FE0E}|\u{FE0F})?(?:\u200D[\p{Emoji_Presentation}\p{Extended_Pictographic}](?:\u{FE0E}|\u{FE0F})?)*)(?:[\u{1F3FB}-\u{1F3FF}])?/u;
  const match = emojiPattern.exec(text);
  if (match) {
    return match[0].length;
  }

  // どちらにも該当しなければ最初の1文字を返す
  return text.length > 0 ? 1 : 0;
}

function getLastGraphemeClusterRange(text) {
  if (!text) return { start: 0, end: 0 };

  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      let lastSegment = null;
      for (const segment of segmenter.segment(text)) {
        lastSegment = segment;
      }
      if (lastSegment) {
        return {
          start: lastSegment.index,
          end: lastSegment.index + lastSegment.segment.length,
        };
      }
    } catch (e) {
      // フォールバック: 下記の反復処理で対応
    }
  }

  let start = 0;
  let end = 0;
  while (end < text.length) {
    start = end;
    const clusterLength = getGraphemeClusterEnd(text.slice(end));
    end += clusterLength || 1;
  }
  return { start, end };
}

/**
 * テキストをUnicode Tag characters (U+E0100–U+E01EF)に変換し、
 * 絵文字に埋め込む隠し文字を生成する。
 * 複数コードポイントで構成される絵文字（修飾子付き、ZWJシーケンス）に対応。
 * @param {string} emoji - 可視の絵文字
 * @param {string} hiddenText - 埋め込むテキスト（UTF-8）
 * @returns {string} emoji + 隠し文字
 */
export function encodeHiddenTagChars(emoji, hiddenText) {
  if (!emoji || !hiddenText) return emoji;
  try {
    // 末尾の書記素クラスタにタグ文字を付与する
    const { start, end } = getLastGraphemeClusterRange(emoji);
    const prefix = emoji.slice(0, start);
    const target = emoji.slice(start, end);
    const suffix = emoji.slice(end);

    // テキストを UTF-8 バイト配列に変換
    const encoder = new TextEncoder();
    const bytes = encoder.encode(hiddenText);

    // バイト値 → Unicode Tag character に変換（byte = cp - 0xE00F0）
    let encoded = prefix + target;
    for (const byte of bytes) {
      const cp = byte + 0xE00F0; // 0xE00F0 + 0-255 = 0xE00F0-0xE01EF
      encoded += String.fromCodePoint(cp);
    }
    return encoded + suffix;
  } catch (e) {
    console.warn('[Utils] encodeHiddenTagChars に失敗', e);
    return emoji;
  }
}

/**
 * デバッグモードが有効な場合のみ警告をコンソールに出力する
 */
export function logWarn(...args) {
  try {
    if (typeof window !== 'undefined' && window.__nokakoiDebug) {
      console.warn('[Debug]', ...args);
    }
  } catch (e) { }
}

/**
 * 指定したミリ秒数の遅延の後にのみ関数を実行するデバウンス関数
 */
export function debounce(fn, ms = 300) {
  let to = null;
  return function (...args) {
    if (to) clearTimeout(to);
    to = setTimeout(() => fn.apply(this, args), ms);
  };
}


