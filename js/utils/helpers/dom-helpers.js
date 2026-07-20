import { t } from '../i18n.js';
import { resolveThemeButtonBg, contrastColorForBg } from './reaction-helpers.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

export function setStatus(el, msg) {
  if (el) el.textContent = msg || '';
}

export function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[&<>'"]/g, m => {
    switch (m) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case "'": return '&#39;';
      case '"': return '&quot;';
      default: return m;
    }
  });
}

export function showToast(message, options = {}) {
  try {
    if (!message) return;
    const duration = (options && typeof options.duration === 'number') ? options.duration : 4500;
    const type = (options && options.type) ? options.type : 'info';

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

    const bg = resolveThemeButtonBg(type);
    toast.style.background = bg;

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

    requestAnimationFrame(() => {
      try { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; } catch (e) { }
    });

    const to = setTimeout(() => {
      try {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(8px)';
        setTimeout(() => { try { toast.parentNode && toast.parentNode.removeChild(toast); } catch (e) { } }, 220);
      } catch (e) { }
    }, duration);

    toast.addEventListener('click', () => {
      try { clearTimeout(to); toast.style.opacity = '0'; toast.style.transform = 'translateY(8px)'; setTimeout(() => { try { toast.parentNode && toast.parentNode.removeChild(toast); } catch (e) { } }, 220); } catch (e) { }
    });
  } catch (e) { console.warn('[Utils] showToast に失敗', e); }
}

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

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (TAG_RE.test(node.textContent)) textNodes.push(node);
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent;
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
