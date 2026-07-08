// ============================================================================
// カスタム絵文字ショートコードサジェスト（投稿窓・リアクション入力共通）
// ============================================================================

import {
  allocateTextShortcode,
  getMyPubkey,
  isOwnEmojiAddress,
  iterCustomEmojiVariants,
  registerTextShortcodeVariant
} from './custom-emoji-store.js';

const INCOMPLETE_SHORTCODE_RE = /^:([a-zA-Z0-9_+-]{2,})$/;
const DEFAULT_MAX_RESULTS = 1000;
const REFRESH_DEBOUNCE_MS = 80;

/**
 * カーソル直前の未完了ショートコードクエリを取得
 * @param {string} text
 * @param {number} cursor
 * @returns {{ query: string, colonIndex: number } | null}
 */
export function getActiveShortcodeQuery(text, cursor) {
  if (typeof text !== 'string' || cursor == null || cursor < 0) return null;
  const before = text.slice(0, cursor);
  let colonIndex = before.lastIndexOf(':');
  while (colonIndex >= 0) {
    const segment = before.slice(colonIndex);
    const match = segment.match(INCOMPLETE_SHORTCODE_RE);
    if (match) {
      return { query: match[1], colonIndex };
    }
    const prev = colonIndex - 1;
    if (prev < 0) break;
    const next = before.lastIndexOf(':', prev);
    if (next === colonIndex) break;
    colonIndex = next;
  }
  return null;
}

function suggestDedupeKey(row) {
  return row.baseShortcode + '\0' + row.url;
}

function preferSuggestRow(current, candidate, myPubkey) {
  if (!current) return candidate;
  const ownCurrent = isOwnEmojiAddress(current.address, myPubkey);
  const ownCandidate = isOwnEmojiAddress(candidate.address, myPubkey);
  if (ownCandidate && !ownCurrent) return candidate;
  return current;
}

function dedupeSuggestRows(rows, myPubkey) {
  const byKey = new Map();
  for (const row of rows) {
    const key = suggestDedupeKey(row);
    byKey.set(key, preferSuggestRow(byKey.get(key), row, myPubkey));
  }
  return Array.from(byKey.values());
}

/**
 * ショートコードに query が含まれるカスタム絵文字を検索（先頭一致を優先）
 * @param {string} query
 * @param {number} limit
 * @returns {Array<{ baseShortcode: string, shortcode: string, url: string, address: string }>}
 */
export function findMatchingEmojis(query, limit = DEFAULT_MAX_RESULTS) {
  if (!query || query.length < 2) return [];
  const customEmojis = (typeof window !== 'undefined' && window.__customEmojis instanceof Map)
    ? window.__customEmojis
    : null;
  if (!customEmojis || customEmojis.size === 0) return [];

  const prefixMatches = [];
  const substringMatches = [];
  for (const item of iterCustomEmojiVariants(customEmojis)) {
    const base = item.baseShortcode;
    const index = base.indexOf(query);
    if (index === -1) continue;
    const row = {
      baseShortcode: base,
      shortcode: base,
      url: item.url,
      address: item.address || ''
    };
    if (index === 0) {
      prefixMatches.push(row);
    } else {
      substringMatches.push(row);
    }
  }

  const myPubkey = getMyPubkey();
  const dedupedPrefix = dedupeSuggestRows(prefixMatches, myPubkey);
  const dedupedSubstring = dedupeSuggestRows(substringMatches, myPubkey);

  dedupedPrefix.sort((a, b) => {
    const c = a.baseShortcode.localeCompare(b.baseShortcode);
    if (c !== 0) return c;
    return a.address.localeCompare(b.address);
  });
  dedupedSubstring.sort((a, b) => {
    const c = a.baseShortcode.localeCompare(b.baseShortcode);
    if (c !== 0) return c;
    return a.address.localeCompare(b.address);
  });
  return dedupedPrefix.concat(dedupedSubstring).slice(0, limit);
}

function insertShortcode(textarea, colonIndex, textShortcode) {
  const value = textarea.value || '';
  const cursor = textarea.selectionStart != null ? textarea.selectionStart : value.length;
  const before = value.slice(0, colonIndex);
  const after = value.slice(cursor);
  const inserted = ':' + textShortcode + ':';
  textarea.value = before + inserted + after;
  const newCursor = before.length + inserted.length;
  if (typeof textarea.setSelectionRange === 'function') {
    textarea.setSelectionRange(newCursor, newCursor);
  }
  textarea.focus();
}

/**
 * textarea にショートコードサジェスト UI を紐付け
 * @param {HTMLTextAreaElement} textarea
 * @param {{ onAfterInsert?: () => void, maxResults?: number, allowSuffix?: boolean }} options
 * @returns {{ destroy: () => void, hide: () => void, refresh: () => void }}
 */
export function attachEmojiShortcodeSuggest(textarea, options = {}) {
  const maxResults = options.maxResults || DEFAULT_MAX_RESULTS;
  const allowSuffix = options.allowSuffix !== false;
  const onAfterInsert = typeof options.onAfterInsert === 'function' ? options.onAfterInsert : null;

  let suggestEl = null;
  let activeQuery = null;
  let activeColonIndex = null;
  let refreshTimer = null;

  function ensureSuggestEl() {
    if (suggestEl && suggestEl.isConnected) return suggestEl;
    suggestEl = document.createElement('div');
    suggestEl.className = 'emoji-shortcode-suggest';
    suggestEl.hidden = true;
    suggestEl.setAttribute('role', 'listbox');
    suggestEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    if (textarea.parentNode) {
      textarea.parentNode.insertBefore(suggestEl, textarea);
    }
    return suggestEl;
  }

  function hideSuggest() {
    if (refreshTimer != null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    activeQuery = null;
    activeColonIndex = null;
    if (suggestEl) {
      suggestEl.hidden = true;
      suggestEl.innerHTML = '';
    }
  }

  function renderSuggest(matches) {
    const el = ensureSuggestEl();
    el.innerHTML = '';
    if (!matches.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;

    for (const item of matches) {
      const shortcodeLabel = ':' + item.baseShortcode + ':';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-shortcode-suggest-item';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-label', shortcodeLabel);
      btn.title = shortcodeLabel;
      btn.dataset.baseShortcode = item.baseShortcode;
      btn.dataset.address = item.address || '';

      const img = document.createElement('img');
      img.src = item.url;
      img.alt = shortcodeLabel;
      img.className = 'custom-emoji';
      img.loading = 'lazy';

      btn.appendChild(img);

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeColonIndex == null) return;

        const variant = { url: item.url, address: item.address };
        const textShortcode = allocateTextShortcode(
          textarea.value || '',
          item.baseShortcode,
          variant,
          { allowSuffix }
        );
        registerTextShortcodeVariant(textShortcode, variant, item.baseShortcode);
        insertShortcode(textarea, activeColonIndex, textShortcode);
        hideSuggest();
        try { textarea.dispatchEvent(new Event('input', { bubbles: true })); } catch (err) { }
        if (onAfterInsert) onAfterInsert();
      });
      el.appendChild(btn);
    }
  }

  function refreshNow() {
    const value = textarea.value || '';
    const cursor = textarea.selectionStart != null ? textarea.selectionStart : value.length;
    const active = getActiveShortcodeQuery(value, cursor);
    if (!active) {
      hideSuggest();
      return;
    }
    activeQuery = active.query;
    activeColonIndex = active.colonIndex;
    const matches = findMatchingEmojis(activeQuery, maxResults);
    renderSuggest(matches);
  }

  function refresh() {
    if (refreshTimer != null) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshNow();
    }, REFRESH_DEBOUNCE_MS);
  }

  function handleInput() {
    refresh();
  }

  function handleEmojiUpdated() {
    if (activeQuery != null) refresh();
  }

  textarea.addEventListener('input', handleInput);
  textarea.addEventListener('keyup', handleInput);
  textarea.addEventListener('click', handleInput);
  if (typeof window !== 'undefined') {
    window.addEventListener('customEmoji:updated', handleEmojiUpdated);
  }

  return {
    hide: hideSuggest,
    refresh: refreshNow,
    destroy() {
      if (refreshTimer != null) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      hideSuggest();
      textarea.removeEventListener('input', handleInput);
      textarea.removeEventListener('keyup', handleInput);
      textarea.removeEventListener('click', handleInput);
      if (typeof window !== 'undefined') {
        window.removeEventListener('customEmoji:updated', handleEmojiUpdated);
      }
      if (suggestEl && suggestEl.parentNode) {
        suggestEl.parentNode.removeChild(suggestEl);
      }
      suggestEl = null;
    }
  };
}
