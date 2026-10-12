import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { sanitizeUrlCandidate } from './sanitize-url.js';
import { EMOJI_SHORTCODE_REGEX } from './content/text-preview.js';

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

marked.use({ extensions: [supExtension, subExtension, markExtension] });

// DOMPurify でタスクリスト用チェックボックス (<input type="checkbox" disabled>) のみを安全に許可
if (typeof DOMPurify.addHook === 'function') {
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'input') {
      if (node.getAttribute('type') === 'checkbox') {
        node.setAttribute('disabled', '');
      } else {
        node.remove();
      }
    }
  });
}

/**
 * 許可するURIスキーム: http, https, nostr, mailto, 安全なdata:image
 * ftp, ftps, javascript, vbscript, data:text/html 等は無効化（href/src除去）される
 */
export const ALLOWED_URI_REGEXP = /^(?:(?:https?|nostr|mailto|data:image\/(?:png|jpeg|jpg|webp|gif|avif)):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;

export function parseMarkdownSafeSync(mdText) {
  const preprocessed = escapeDisallowedHtmlTags(mdText || '');
  const html = marked.parse(preprocessed);
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP,
    ADD_DATA_URI_TAGS: ['img'],
    ADD_TAGS: ['input'],
    ADD_ATTR: ['type', 'checked', 'disabled'],
    FORBID_TAGS: ['marquee', 'blink']
  });
}

export async function parseMarkdownSafe(mdText) {
  return parseMarkdownSafeSync(mdText);
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
 * Markdown をパースし、タグに定義されたカスタム絵文字をインライン画像へ置換した安全な HTML を同期的に返す
 */
export function renderMarkdownWithCustomEmojisSync(mdText, emojiTags = []) {
  const html = parseMarkdownSafeSync(mdText || '');
  if (typeof document === 'undefined') return html;
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  replaceCustomEmojiInDom(tempDiv, emojiTags);
  return tempDiv.innerHTML;
}

/**
 * Markdown をパースし、タグに定義されたカスタム絵文字をインライン画像へ置換した安全な HTML を返す
 */
export async function renderMarkdownWithCustomEmojis(mdText, emojiTags = []) {
  return renderMarkdownWithCustomEmojisSync(mdText, emojiTags);
}


