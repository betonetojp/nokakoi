// js/features/post/share-text.js

const SHARE_TEXT_PARAM_KEYS = ['text', 'content'];
const SHARE_TEXT_STORAGE_KEY = 'pendingShareText';
const SHARE_TEXT_MAX_LENGTH = 2000;

let shareTextCacheInitialized = false;
let shareTextCache = null;

/**
 * 候補文字列を無害化する
 */
export function sanitizeShareTextCandidate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let normalized = raw.replace(/\+/g, ' ');
  try { normalized = decodeURIComponent(normalized); } catch (e) { }
  // 制御文字の削除
  // eslint-disable-next-line no-control-regex
  normalized = normalized.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!normalized) return null;
  if (normalized.length > SHARE_TEXT_MAX_LENGTH) normalized = normalized.slice(0, SHARE_TEXT_MAX_LENGTH);
  return normalized;
}

/**
 * クエリパラメータからシェアテキストを抽出する
 */
export function extractShareTextFromQuery() {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search || '');
    for (const key of SHARE_TEXT_PARAM_KEYS) {
      const value = params.get(key);
      if (!value) continue;
      const sanitized = sanitizeShareTextCandidate(value);
      if (sanitized) return sanitized;
    }
  } catch (e) { }
  return null;
}

/**
 * URLからシェアパラメータを削除する
 */
export function scrubShareTextParamsFromUrl() {
  if (typeof window === 'undefined' || !window.history || !window.location) return;
  try {
    const url = new URL(window.location.href);
    let touched = false;
    SHARE_TEXT_PARAM_KEYS.forEach(key => {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        touched = true;
      }
    });
    if (touched) {
      const search = url.searchParams.toString();
      const next = url.pathname + (search ? '?' + search : '') + url.hash;
      window.history.replaceState({}, document.title, next);
    }
  } catch (e) { }
}

/**
 * キャッシュが存在するか確認し、なければ初期化する
 */
export function ensureShareTextCache() {
  if (shareTextCacheInitialized) return;
  shareTextCacheInitialized = true;
  const fromQuery = extractShareTextFromQuery();
  if (fromQuery) {
    shareTextCache = fromQuery;
    try { localStorage.setItem(SHARE_TEXT_STORAGE_KEY, fromQuery); } catch (e) { }
    scrubShareTextParamsFromUrl();
    return;
  }
  try {
    const stored = localStorage.getItem(SHARE_TEXT_STORAGE_KEY);
    shareTextCache = stored ? sanitizeShareTextCandidate(stored) : null;
  } catch (e) {
    shareTextCache = null;
  }
}

/**
 * シェアテキストを消費し、キャッシュをクリアして値を返す
 */
export function consumeShareText() {
  ensureShareTextCache();
  const text = shareTextCache;
  shareTextCache = null;
  try { localStorage.removeItem(SHARE_TEXT_STORAGE_KEY); } catch (e) { }
  return text;
}
