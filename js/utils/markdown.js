import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { sanitizeUrlCandidate } from './sanitize-url.js';
import { EMOJI_SHORTCODE_REGEX } from './content/text-preview.js';
import { t } from './i18n.js';

/**
 * 実行や危険な動作・レイアウト破壊を防止したいHTMLタグを開始・終了ともにエスケープし、
 * タグを消去せずテキストとしてそのまま読めるようにする
 */
export function escapeDisallowedHtmlTags(mdText) {
  if (!mdText) return '';
  return mdText.replace(/<\/?(marquee|blink|script|style|iframe|object|embed|applet|font|base|form|input|button)\b([^>]*)>/gi, (match) => {
    return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });
}

/**
 * Pandoc/GFMスタイルの上付き文字 (^text^) と下付き文字 (~text~) の marked 拡張
 * 空白を含まない文字列を対象とし、取り消し線 (~~strike~~) との衝突を防止する
 */
const supExtension = {
  name: 'sup',
  level: 'inline',
  start(src) {
    return src.indexOf('^');
  },
  tokenizer(src) {
    const match = /^\^([^\s^]+)\^/.exec(src);
    if (match) {
      return {
        type: 'sup',
        raw: match[0],
        text: match[1],
        tokens: this.lexer.inlineTokens(match[1])
      };
    }
  },
  renderer(token) {
    return `<sup>${this.parser.parseInline(token.tokens)}</sup>`;
  }
};

const subExtension = {
  name: 'sub',
  level: 'inline',
  start(src) {
    return src.indexOf('~');
  },
  tokenizer(src) {
    if (src.startsWith('~~')) return;
    const match = /^~([^\s~]+)~/.exec(src);
    if (match) {
      return {
        type: 'sub',
        raw: match[0],
        text: match[1],
        tokens: this.lexer.inlineTokens(match[1])
      };
    }
  },
  renderer(token) {
    return `<sub>${this.parser.parseInline(token.tokens)}</sub>`;
  }
};

const markExtension = {
  name: 'mark',
  level: 'inline',
  start(src) {
    return src.indexOf('==');
  },
  tokenizer(src) {
    const match = /^==([^\s=][^=\n]*[^\s=]|[^=\s])==/.exec(src);
    if (match) {
      return {
        type: 'mark',
        raw: match[0],
        text: match[1],
        tokens: this.lexer.inlineTokens(match[1])
      };
    }
  },
  renderer(token) {
    return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
  }
};

marked.use({
  extensions: [supExtension, subExtension, markExtension],
  renderer: {
    // 生HTMLトークン（ブロック/インライン）のみ禁止タグをエスケープする。
    // コードブロック・インラインコードは marked 側で既にエスケープされるため対象外（二重エスケープ防止）
    html(token) {
      return escapeDisallowedHtmlTags(token && typeof token.text === 'string' ? token.text : '');
    }
  }
});

/**
 * DOMPurify でタスクリスト用チェックボックス (<input type="checkbox" disabled>) のみを安全に許可するフック。
 * グローバル登録すると他の DOMPurify.sanitize 呼び出しにも影響するため、
 * parseMarkdownSafeSync の実行中のみ登録する。
 */
function taskListCheckboxHook(node, data) {
  if (data.tagName === 'input') {
    if (node.getAttribute('type') === 'checkbox') {
      node.setAttribute('disabled', '');
    } else {
      node.remove();
    }
  }
}

/**
 * DOMPurify 用: inlineMedia が false の場合に通常画像を安全なリンクへ変換するフック
 */
function createMediaFallbackHook() {
  const label = typeof t === 'function' ? t('media.image') : '';
  const imageLabel = (label && label !== 'media.image') ? label : '画像';
  return function mediaFallbackHook(node, data) {
    if (data.tagName === 'img') {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      const doc = node.ownerDocument;
      if (!doc) return;
      const a = doc.createElement('a');
      a.setAttribute('href', src);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      a.className = 'article-image-fallback';
      a.textContent = alt ? `[${imageLabel}: ${alt}]` : `[${imageLabel}]`;
      if (node.parentNode) {
        node.parentNode.replaceChild(a, node);
      }
    }
  };
}

/**
 * marked のブロックトークン列を、Markdown構文（コードブロック・表・リスト・引用等）や
 * 参照リンク定義（def）を壊さないようブロック境界で安全に切り詰める。
 *
 * @param {Array} tokens marked.lexer(md) で得られたトークン配列
 * @param {number} maxChars 切り詰めの目標文字数（デフォルト 1500）
 * @returns {Array} 切り詰められたトークン配列（tokens.links を継承）
 */
export function truncateMarkdownTokens(tokens, maxChars = 1500) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  const selected = [];
  let accumulatedChars = 0;
  let hasContentToken = false;

  for (const token of tokens) {
    if (!token) continue;

    // def トークン（[1]: https://...）はリンク解決用。HTML描画は持たないためそのまま保持
    if (token.type === 'def') {
      selected.push(token);
      continue;
    }

    if (token.type === 'space') {
      if (hasContentToken) selected.push(token);
      continue;
    }

    // 既にコンテンツが 1 つ以上あり、累積文字数が maxChars を超えている場合は打ち切り
    if (hasContentToken && accumulatedChars >= maxChars) {
      break;
    }

    // 巨大なコードブロックの保護（構文を壊さずテキスト部分のみ安全に切り詰める）
    if (token.type === 'code' && token.text && token.text.length > maxChars) {
      const truncatedText = token.text.slice(0, maxChars) + '\n...';
      selected.push({ ...token, text: truncatedText, raw: truncatedText });
      break;
    }

    selected.push(token);
    accumulatedChars += (token.raw ? token.raw.length : 0);
    hasContentToken = true;
  }

  if (tokens.links) {
    selected.links = tokens.links;
  }
  return selected;
}

/**
 * 許可するURIスキーム: http, https, nostr, mailto, 安全なdata:image
 * ftp, ftps, javascript, vbscript, data:text/html 等は無効化（href/src除去）される
 */
export const ALLOWED_URI_REGEXP = /^(?:(?:https?|nostr|mailto|data:image\/(?:png|jpeg|jpg|webp|gif|avif)):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

export function parseMarkdownSafeSync(mdText, options = {}) {
  const inlineMedia = options && options.inlineMedia === false ? false : true;
  // 禁止タグのエスケープは marked の html レンダラー内で生HTMLトークンに対してのみ行う
  const html = marked.parse(mdText || '');
  const canHook = typeof DOMPurify.addHook === 'function' && typeof DOMPurify.removeHook === 'function';
  const mediaHook = !inlineMedia ? createMediaFallbackHook() : null;

  if (canHook) {
    DOMPurify.addHook('uponSanitizeElement', taskListCheckboxHook);
    if (mediaHook) DOMPurify.addHook('uponSanitizeElement', mediaHook);
  }
  try {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ALLOWED_URI_REGEXP,
      ADD_DATA_URI_TAGS: inlineMedia ? ['img'] : [],
      ADD_TAGS: ['input'],
      ADD_ATTR: ['type', 'checked', 'disabled'],
      FORBID_TAGS: ['marquee', 'blink'],
      // position:fixed 等による画面全体の覆い被せ・クリックジャッキングやレイアウト破壊を防ぐ
      FORBID_ATTR: ['style']
    });
  } finally {
    if (canHook) {
      DOMPurify.removeHook('uponSanitizeElement', taskListCheckboxHook);
      if (mediaHook) DOMPurify.removeHook('uponSanitizeElement', mediaHook);
    }
  }
}

export async function parseMarkdownSafe(mdText, options = {}) {
  return parseMarkdownSafeSync(mdText, options);
}

/**
 * 指定された DOM 要素内のテキストノードを走査し、
 * Nostr tags に含まれるカスタム絵文字ショートコードを <img> タグに置換する。
 * code, pre, script, style, textarea, input 内は対象外とする。
 */
export function replaceCustomEmojiInDom(container, emojiTags = []) {
  if (!container) return;
  const showCustomEmoji = (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('showCustomEmoji') === '0') ? false : true;
  if (!showCustomEmoji) return;

  const emojiMap = new Map();
  if (Array.isArray(emojiTags)) {
    for (const tag of emojiTags) {
      if (Array.isArray(tag) && tag[0] === 'emoji' && tag[1] && tag[2]) {
        const safeUrl = sanitizeUrlCandidate(tag[2]);
        if (safeUrl) {
          emojiMap.set(String(tag[1]), safeUrl);
        }
      }
    }
  }
  if (emojiMap.size === 0) return;

  const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return;

  const whatToShow = (typeof NodeFilter !== 'undefined' && NodeFilter.SHOW_TEXT) ? NodeFilter.SHOW_TEXT : 4;

  const walker = doc.createTreeWalker(
    container,
    whatToShow,
    {
      acceptNode(node) {
        let parent = node.parentElement;
        while (parent && parent !== container) {
          const tag = parent.tagName ? parent.tagName.toUpperCase() : '';
          if (tag === 'PRE' || tag === 'CODE' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT') {
            return (typeof NodeFilter !== 'undefined' && NodeFilter.FILTER_REJECT) ? NodeFilter.FILTER_REJECT : 2;
          }
          parent = parent.parentElement;
        }
        return (typeof NodeFilter !== 'undefined' && NodeFilter.FILTER_ACCEPT) ? NodeFilter.FILTER_ACCEPT : 1;
      }
    }
  );

  const nodesToProcess = [];
  let currentNode;
  while ((currentNode = walker.nextNode())) {
    if (currentNode.nodeValue && currentNode.nodeValue.includes(':')) {
      nodesToProcess.push(currentNode);
    }
  }

  const shortcodeRegex = new RegExp(EMOJI_SHORTCODE_REGEX.source, EMOJI_SHORTCODE_REGEX.flags);
  for (const textNode of nodesToProcess) {
    const text = textNode.nodeValue;
    if (!text) continue;
    shortcodeRegex.lastIndex = 0;
    if (!shortcodeRegex.test(text)) continue;

    shortcodeRegex.lastIndex = 0;
    const parent = textNode.parentNode;
    if (!parent) continue;

    const frag = doc.createDocumentFragment();
    let lastIdx = 0;
    let match;
    let hasReplaced = false;

    while ((match = shortcodeRegex.exec(text)) !== null) {
      const code = match[1];
      const url = emojiMap.get(code);
      if (url) {
        if (match.index > lastIdx) {
          frag.appendChild(doc.createTextNode(text.slice(lastIdx, match.index)));
        }
        const span = doc.createElement('span');
        span.className = 'emoji-wrap';
        span.style.cssText = 'display:inline-block;line-height:1;margin:0;padding:0;vertical-align:middle;max-width:100%;';
        const img = doc.createElement('img');
        img.src = url;
        img.alt = match[0];
        img.className = 'custom-emoji';
        img.style.maxWidth = '100%';
        img.loading = 'lazy';
        span.appendChild(img);
        frag.appendChild(span);

        lastIdx = match.index + match[0].length;
        hasReplaced = true;
      }
    }

    if (hasReplaced) {
      if (lastIdx < text.length) {
        frag.appendChild(doc.createTextNode(text.slice(lastIdx)));
      }
      parent.replaceChild(frag, textNode);
    }
  }
}

/**
 * 記事カード等のプレビュー向けに、Markdownをブロック単位で安全に切り詰め、
 * カスタム絵文字およびメディア表示設定を反映してレンダリングする
 *
 * @param {string} mdText
 * @param {Array} emojiTags
 * @param {Object} options
 * @param {number} [options.maxChars=1500]
 * @param {boolean} [options.inlineMedia=true]
 * @returns {string}
 */
export function renderArticleMarkdownPreviewSync(mdText, emojiTags = [], options = {}) {
  const maxChars = typeof options.maxChars === 'number' ? options.maxChars : 1500;
  const inlineMedia = options.inlineMedia !== false;

  const rawText = mdText || '';
  const tokens = marked.lexer(rawText);
  const truncatedTokens = truncateMarkdownTokens(tokens, maxChars);
  const html = marked.parser(truncatedTokens);

  const canHook = typeof DOMPurify.addHook === 'function' && typeof DOMPurify.removeHook === 'function';
  const mediaHook = !inlineMedia ? createMediaFallbackHook() : null;

  if (canHook) {
    DOMPurify.addHook('uponSanitizeElement', taskListCheckboxHook);
    if (mediaHook) DOMPurify.addHook('uponSanitizeElement', mediaHook);
  }

  let sanitizedHtml;
  try {
    sanitizedHtml = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ALLOWED_URI_REGEXP,
      ADD_DATA_URI_TAGS: inlineMedia ? ['img'] : [],
      ADD_TAGS: ['input'],
      ADD_ATTR: ['type', 'checked', 'disabled'],
      FORBID_TAGS: ['marquee', 'blink'],
      FORBID_ATTR: ['style']
    });
  } finally {
    if (canHook) {
      DOMPurify.removeHook('uponSanitizeElement', taskListCheckboxHook);
      if (mediaHook) DOMPurify.removeHook('uponSanitizeElement', mediaHook);
    }
  }

  if (typeof document === 'undefined') return sanitizedHtml;
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = sanitizedHtml;
  replaceCustomEmojiInDom(tempDiv, emojiTags);
  return tempDiv.innerHTML;
}

/**
 * Markdown をパースし、タグに定義されたカスタム絵文字をインライン画像へ置換した安全な HTML を同期的に返す
 */
export function renderMarkdownWithCustomEmojisSync(mdText, emojiTags = [], options = {}) {
  const html = parseMarkdownSafeSync(mdText || '', options);
  if (typeof document === 'undefined') return html;
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  replaceCustomEmojiInDom(tempDiv, emojiTags);
  return tempDiv.innerHTML;
}

/**
 * Markdown をパースし、タグに定義されたカスタム絵文字をインライン画像へ置換した安全な HTML を返す
 */
export async function renderMarkdownWithCustomEmojis(mdText, emojiTags = [], options = {}) {
  return renderMarkdownWithCustomEmojisSync(mdText, emojiTags, options);
}


