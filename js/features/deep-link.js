const DEEP_LINK_PREFIX_RE = /^(nevent1|note1|npub1|nprofile1)/i;
const NSEC_PREFIX_RE = /^nsec1/i;
const NOSTR_PREFIX_RE = /^nostr:/i;

function sanitizeRelayHints(relays) {
  if (!Array.isArray(relays)) return [];
  return relays.filter((relay) => typeof relay === 'string' && /^wss?:\/\//i.test(relay));
}

/**
 * pathname 末尾からディープリンク用 bech32 を取り出す。
 * nsec / naddr / アセットパスは対象外。
 */
export function extractDeepLinkBech32(pathname) {
  if (!pathname || typeof pathname !== 'string') return null;
  let segment = pathname.replace(/\/+$/, '');
  const slash = segment.lastIndexOf('/');
  segment = slash >= 0 ? segment.slice(slash + 1) : segment;
  if (!segment) return null;
  try { segment = decodeURIComponent(segment); } catch (_e) { }
  segment = String(segment).trim();
  if (!segment) return null;
  if (NOSTR_PREFIX_RE.test(segment)) segment = segment.replace(NOSTR_PREFIX_RE, '');
  if (NSEC_PREFIX_RE.test(segment)) return null;
  if (!DEEP_LINK_PREFIX_RE.test(segment)) return null;
  return segment;
}

/**
 * bech32 をイベントまたはプロフィール参照に変換する。
 */
export function parseDeepLinkBech32(bech32, nip19) {
  if (!bech32 || typeof bech32 !== 'string') return null;
  if (NSEC_PREFIX_RE.test(bech32)) return null;
  if (!DEEP_LINK_PREFIX_RE.test(bech32)) return null;
  if (!nip19 || typeof nip19.decode !== 'function') return null;
  try {
    const decoded = nip19.decode(bech32);
    if (!decoded || !decoded.type) return null;
    if (decoded.type === 'nevent') {
      const eventId = decoded.data && decoded.data.id;
      if (!eventId) return null;
      return { kind: 'event', eventId, relays: sanitizeRelayHints(decoded.data.relays) };
    }
    if (decoded.type === 'note') {
      const eventId = typeof decoded.data === 'string'
        ? decoded.data
        : (decoded.data && decoded.data.id);
      if (!eventId) return null;
      return { kind: 'event', eventId, relays: [] };
    }
    if (decoded.type === 'npub') {
      const pubkey = typeof decoded.data === 'string' ? decoded.data : null;
      if (!pubkey) return null;
      return { kind: 'profile', pubkey, relays: [] };
    }
    if (decoded.type === 'nprofile') {
      const pubkey = decoded.data && decoded.data.pubkey;
      if (!pubkey) return null;
      return { kind: 'profile', pubkey, relays: sanitizeRelayHints(decoded.data.relays) };
    }
    return null;
  } catch (_e) {
    return null;
  }
}

export function parseDeepLinkFromPathname(pathname, nip19) {
  return parseDeepLinkBech32(extractDeepLinkBech32(pathname), nip19);
}

/**
 * ディープリンク付き pathname からアプリのルートパスを返す。
 * `/app/nevent1...` → `/app/` 、 `/nevent1...` → `/`
 */
export function appRootPathFromDeepLink(pathname) {
  if (!extractDeepLinkBech32(pathname)) return null;
  const trimmed = String(pathname).replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  if (slash <= 0) return '/';
  return trimmed.slice(0, slash + 1);
}

function isVisibleModal(id) {
  if (typeof document === 'undefined') return false;
  const el = document.getElementById(id);
  return !!(el && !el.hidden);
}

/**
 * イベント／プロフィールモーダルがどちらも閉じていれば、URL をアプリルートへ戻す。
 */
export function clearDeepLinkFromUrlIfIdle() {
  if (typeof window === 'undefined' || !window.location || !window.history) return false;
  const pathname = window.location.pathname || '';
  const root = appRootPathFromDeepLink(pathname);
  if (!root) return false;
  if (isVisibleModal('eventModal') || isVisibleModal('profileModal')) return false;
  try {
    const url = new URL(window.location.href);
    const next = root + url.search + url.hash;
    const current = url.pathname + url.search + url.hash;
    if (next === current) return false;
    window.history.replaceState({}, document.title, next);
    return true;
  } catch (_e) {
    return false;
  }
}

export function setupDeepLinkUrlCleanup() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const observer = new MutationObserver(() => {
    clearDeepLinkFromUrlIfIdle();
  });
  ['eventModal', 'profileModal'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    observer.observe(el, { attributes: true, attributeFilter: ['hidden'] });
  });
}

export async function fetchDeepLinkEvent(state, parsed) {
  if (!parsed || parsed.kind !== 'event' || !parsed.eventId || !state) return null;
  const { findEventById } = await import('../core/state.js');
  const cached = findEventById(state, parsed.eventId);
  if (cached) return cached;
  if (!state.pool || typeof state.pool.get !== 'function') return null;
  const { getReadRelays } = await import('../core/relay.js');
  const hintRelays = sanitizeRelayHints(parsed.relays);
  const readRelays = getReadRelays(state.relays) || [];
  const relays = [...new Set([...hintRelays, ...readRelays])];
  if (!relays.length) return null;
  try {
    const fetched = await state.pool.get(relays, { ids: [parsed.eventId] });
    return fetched || null;
  } catch (_e) {
    return null;
  }
}

/**
 * 現在の URL パスからイベント詳細またはプロフィールモーダルを開く。
 * @returns {Promise<boolean>} ディープリンクを処理したら true
 */
export async function openDeepLink(state, options = {}) {
  const pathname = options.pathname
    || (typeof window !== 'undefined' && window.location ? window.location.pathname : '');
  let nip19 = options.nip19;
  if (!nip19) {
    const { getNip19 } = await import('../core/nostr-compat.js');
    nip19 = getNip19();
  }
  const parsed = parseDeepLinkFromPathname(pathname, nip19);
  if (!parsed) return false;

  if (parsed.kind === 'profile') {
    if (typeof options.showProfileModal === 'function') {
      options.showProfileModal(parsed.pubkey);
    }
    return true;
  }

  const event = await fetchDeepLinkEvent(state, parsed);
  if (event) {
    if (typeof options.showEventModal === 'function') {
      options.showEventModal(event);
    }
    return true;
  }

  const [{ showToast }, { t }] = await Promise.all([
    import('../utils/utils.js'),
    import('../utils/i18n.js')
  ]);
  showToast(t('deeplink.event_not_found'));
  clearDeepLinkFromUrlIfIdle();
  return false;
}
