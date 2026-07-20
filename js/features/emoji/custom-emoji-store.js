// ============================================================================
// NIP-30 カスタム絵文字ストア（同名 shortcode 複数 variant + suffix 対応）
// ============================================================================

export const EMOJI_SHORTCODE_CHARS = 'a-zA-Z0-9_+\\-';
export const EMOJI_SHORTCODE_PATTERN = `[${EMOJI_SHORTCODE_CHARS}]+`;
const SUFFIX_RE = /^(.+)_(\d+)$/;

function normalizeVariant(variant) {
  if (!variant) return null;
  const url = (variant && typeof variant === 'object' && variant.url) ? String(variant.url) : String(variant || '');
  if (!url) return null;
  const address = (variant && typeof variant === 'object' && variant.address) ? String(variant.address) : '';
  return { url, address };
}

function variantKey(variant) {
  const v = normalizeVariant(variant);
  if (!v) return '';
  return v.url + '\0' + v.address;
}

export function getMyPubkey() {
  try {
    return localStorage.getItem('pubkey') || '';
  } catch (e) {
    return '';
  }
}

function parseEmojiListAddress(address) {
  const s = String(address || '');
  if (!s.startsWith('10030:') && !s.startsWith('30030:')) return null;
  const first = s.indexOf(':');
  const second = s.indexOf(':', first + 1);
  if (second < 0) return null;
  const pubkey = s.slice(first + 1, second);
  const identifier = s.slice(second + 1);
  if (!pubkey) return null;
  return { pubkey, identifier };
}

export function isOwnEmojiAddress(address, myPubkey) {
  if (!address || !myPubkey) return false;
  const parsed = parseEmojiListAddress(address);
  if (!parsed) return false;
  return parsed.pubkey === String(myPubkey);
}

export function getEmojiAddressLabel(address) {
  if (!address) return '';
  const parsed = parseEmojiListAddress(address);
  if (!parsed) return String(address);
  const { pubkey, identifier } = parsed;
  const pkHint = pubkey.length >= 4 ? pubkey.slice(-4) : pubkey;
  if (identifier) return identifier + ' #' + pkHint;
  return '#' + pkHint;
}

/**
 * smile_2 → { base: 'smile', suffix: 2 } / smile → { base: 'smile', suffix: 0 }
 */
export function parseShortcodeSuffix(textShortcode) {
  const sc = String(textShortcode || '');
  const m = sc.match(SUFFIX_RE);
  if (!m) return { base: sc, suffix: 0 };
  const suffix = parseInt(m[2], 10);
  if (!Number.isFinite(suffix) || suffix < 2) return { base: sc, suffix: 0 };
  return { base: m[1], suffix };
}

function ensureVariantArray(map, baseShortcode) {
  const key = String(baseShortcode);
  let arr = map.get(key);
  if (!Array.isArray(arr)) {
    arr = [];
    map.set(key, arr);
  }
  return arr;
}

/**
 * @param {Map} map baseShortcode -> Array<{url, address}>
 */
export function addCustomEmojiVariant(map, baseShortcode, variant) {
  if (!(map instanceof Map) || !baseShortcode) return false;
  const normalized = normalizeVariant(variant);
  if (!normalized) return false;
  const arr = ensureVariantArray(map, baseShortcode);
  const key = variantKey(normalized);
  if (arr.some(v => variantKey(v) === key)) return false;
  arr.push(normalized);
  return true;
}

export function getCustomEmojiVariants(map, baseShortcode) {
  if (!(map instanceof Map) || !baseShortcode) return [];
  const arr = map.get(String(baseShortcode));
  return Array.isArray(arr) ? arr.slice() : [];
}

export function* iterCustomEmojiVariants(map) {
  if (!(map instanceof Map)) return;
  for (const [baseShortcode, arr] of map.entries()) {
    if (!Array.isArray(arr)) continue;
    for (const variant of arr) {
      const normalized = normalizeVariant(variant);
      if (!normalized) continue;
      yield { baseShortcode: String(baseShortcode), ...normalized };
    }
  }
}

function getTextShortcodeRegistry() {
  if (typeof window === 'undefined') return null;
  if (!(window.__customEmojiByTextShortcode instanceof Map)) {
    window.__customEmojiByTextShortcode = new Map();
  }
  return window.__customEmojiByTextShortcode;
}

export function clearTextShortcodeRegistry() {
  const reg = getTextShortcodeRegistry();
  if (reg) reg.clear();
}

export function registerTextShortcodeVariant(textShortcode, variant, baseShortcode) {
  const reg = getTextShortcodeRegistry();
  const normalized = normalizeVariant(variant);
  if (!reg || !textShortcode || !normalized) return;
  reg.set(String(textShortcode), {
    ...normalized,
    baseShortcode: baseShortcode ? String(baseShortcode) : parseShortcodeSuffix(textShortcode).base
  });
}

export function getRegisteredTextShortcodeVariant(textShortcode) {
  const reg = getTextShortcodeRegistry();
  if (!reg || !textShortcode) return null;
  return reg.get(String(textShortcode)) || null;
}

/**
 * 本文中の base に属する text shortcode を列挙
 * @returns {Array<{ textShortcode: string, suffix: number }>}
 */
export function scanTextShortcodes(text, baseShortcode) {
  if (!text || !baseShortcode) return [];
  const base = String(baseShortcode);
  const re = new RegExp(':(' + EMOJI_SHORTCODE_PATTERN + '):', 'g');
  const out = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    const textShortcode = match[1];
    const parsed = parseShortcodeSuffix(textShortcode);
    if (parsed.base !== base) continue;
    out.push({ textShortcode, suffix: parsed.suffix });
  }
  return out;
}

function resolveVariantForTextShortcode(map, textShortcode, options = {}) {
  const registered = getRegisteredTextShortcodeVariant(textShortcode);
  if (registered && registered.url) {
    return {
      url: registered.url,
      address: registered.address || '',
      baseShortcode: registered.baseShortcode || parseShortcodeSuffix(textShortcode).base
    };
  }
  return resolveCustomEmoji(map, textShortcode, options);
}

/**
 * base shortcode から1 variant を解決（自分セット優先）
 */
export function resolveCustomEmoji(map, textShortcode, options = {}) {
  if (!(map instanceof Map) || !textShortcode) return null;
  const { base } = parseShortcodeSuffix(textShortcode);
  const variants = getCustomEmojiVariants(map, base);
  if (!variants.length) return null;

  const myPubkey = options.myPubkey != null ? String(options.myPubkey) : getMyPubkey();
  const selectedAddress = options.selectedAddress ? String(options.selectedAddress) : '';

  if (selectedAddress) {
    const hit = variants.find(v => v.address === selectedAddress);
    if (hit) return { ...hit, baseShortcode: base };
  }

  const own = variants.find(v => isOwnEmojiAddress(v.address, myPubkey));
  if (own) return { ...own, baseShortcode: base };

  return { ...variants[0], baseShortcode: base };
}

/**
 * サジェスト選択時に挿入する text shortcode を決定
 */
export function allocateTextShortcode(text, baseShortcode, variant, options = {}) {
  const base = String(baseShortcode || '');
  const normalized = normalizeVariant(variant);
  if (!base || !normalized) return base;

  if (options.allowSuffix === false) {
    return base;
  }

  const vKey = variantKey(normalized);
  const used = scanTextShortcodes(text || '', base);
  const registry = getTextShortcodeRegistry();

  for (const entry of used) {
    let regVariant = registry ? registry.get(entry.textShortcode) : null;
    if (!regVariant) {
      const resolved = resolveCustomEmoji(
        (typeof window !== 'undefined' && window.__customEmojis instanceof Map) ? window.__customEmojis : new Map(),
        entry.textShortcode
      );
      if (resolved) regVariant = resolved;
    }
    if (regVariant && variantKey(regVariant) === vKey) {
      return entry.textShortcode;
    }
  }

  if (used.length === 0) {
    return base;
  }

  const usedSuffixes = new Set();
  for (const entry of used) {
    if (entry.suffix === 0) continue;
    usedSuffixes.add(entry.suffix);
  }

  let n = 2;
  while (usedSuffixes.has(n)) n++;
  return base + '_' + n;
}

export function buildEmojiTag(textShortcode, variant) {
  const normalized = normalizeVariant(variant);
  if (!normalized) return null;
  const tag = ['emoji', String(textShortcode), normalized.url];
  if (normalized.address) tag.push(normalized.address);
  return tag;
}

/**
 * 本文から NIP-30 emoji タグ配列を構築
 */
export function extractEmojiTagsFromText(text, map) {
  if (!text) return [];
  const emojiMap = (map instanceof Map) ? map : (
    (typeof window !== 'undefined' && window.__customEmojis instanceof Map) ? window.__customEmojis : new Map()
  );
  const re = new RegExp(':(' + EMOJI_SHORTCODE_PATTERN + '):', 'g');
  const tags = [];
  const seen = new Set();
  let match;
  while ((match = re.exec(text)) !== null) {
    const textShortcode = match[1];
    if (seen.has(textShortcode)) continue;
    const resolved = resolveVariantForTextShortcode(emojiMap, textShortcode);
    if (!resolved || !resolved.url) continue;
    const tag = buildEmojiTag(textShortcode, resolved);
    if (tag) {
      tags.push(tag);
      seen.add(textShortcode);
    }
  }
  return tags;
}

/**
 * text shortcode → URL（プレビュー・linkify 用）
 */
export function buildEmojiUrlMapFromText(text, map) {
  const emojiMap = (map instanceof Map) ? map : (
    (typeof window !== 'undefined' && window.__customEmojis instanceof Map) ? window.__customEmojis : new Map()
  );
  const urlMap = new Map();
  if (!text) return urlMap;
  const re = new RegExp(':(' + EMOJI_SHORTCODE_PATTERN + '):', 'g');
  let match;
  while ((match = re.exec(text)) !== null) {
    const textShortcode = match[1];
    if (urlMap.has(textShortcode)) continue;
    const resolved = resolveVariantForTextShortcode(emojiMap, textShortcode);
    if (resolved && resolved.url) {
      urlMap.set(textShortcode, resolved.url);
    }
  }
  return urlMap;
}

/**
 * グローバル表示用: base shortcode ごとに自分セット優先で1 URL
 */
export function buildDefaultEmojiUrlMap(map) {
  const urlMap = new Map();
  if (!(map instanceof Map)) return urlMap;
  const myPubkey = getMyPubkey();
  for (const baseShortcode of map.keys()) {
    const resolved = resolveCustomEmoji(map, baseShortcode, { myPubkey });
    if (resolved && resolved.url) {
      urlMap.set(String(baseShortcode), resolved.url);
    }
  }
  return urlMap;
}
