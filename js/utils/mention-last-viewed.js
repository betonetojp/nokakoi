const LAST_VIEWED_AT_KEY = 'mentions_last_viewed_at';
const LAST_VIEWED_ID_KEY = 'mentions_last_viewed_id';
const LEGACY_MIGRATION_KEY = 'mentions_last_viewed_migrated_v1';

export function normalizeMentionAccountPubkey(pubkey) {
  return pubkey ? String(pubkey).trim().toLowerCase() : '';
}

export function getMentionLastViewedKeys(pubkey = localStorage.getItem('pubkey')) {
  const normalizedPubkey = normalizeMentionAccountPubkey(pubkey);
  if (!normalizedPubkey) return null;
  return {
    at: `${LAST_VIEWED_AT_KEY}.${normalizedPubkey}`,
    id: `${LAST_VIEWED_ID_KEY}.${normalizedPubkey}`,
  };
}

function migrateLegacyMentionLastViewed(pubkey) {
  const keys = getMentionLastViewedKeys(pubkey);
  if (!keys) return;

  try {
    if (localStorage.getItem(LEGACY_MIGRATION_KEY) != null) return;

    const legacyAt = localStorage.getItem(LAST_VIEWED_AT_KEY);
    const legacyId = localStorage.getItem(LAST_VIEWED_ID_KEY);
    if (legacyAt != null && localStorage.getItem(keys.at) == null) {
      localStorage.setItem(keys.at, legacyAt);
    }
    if (legacyId != null && localStorage.getItem(keys.id) == null) {
      localStorage.setItem(keys.id, legacyId);
    }

    // Claim the legacy values before removing them so another account can never
    // inherit the same last-viewed position, even if removal is interrupted.
    localStorage.setItem(LEGACY_MIGRATION_KEY, normalizeMentionAccountPubkey(pubkey));
    localStorage.removeItem(LAST_VIEWED_AT_KEY);
    localStorage.removeItem(LAST_VIEWED_ID_KEY);
  } catch (_e) { }
}

export function readMentionLastViewed(pubkey = localStorage.getItem('pubkey')) {
  const keys = getMentionLastViewedKeys(pubkey);
  if (!keys) return { at: 0, id: '' };
  migrateLegacyMentionLastViewed(pubkey);
  try {
    return {
      at: parseInt(localStorage.getItem(keys.at) || '0', 10) || 0,
      id: localStorage.getItem(keys.id) || '',
    };
  } catch (_e) {
    return { at: 0, id: '' };
  }
}

export function writeMentionLastViewed(
  { at, id = '' },
  pubkey = localStorage.getItem('pubkey')
) {
  const keys = getMentionLastViewedKeys(pubkey);
  if (!keys) return false;
  migrateLegacyMentionLastViewed(pubkey);
  try {
    localStorage.setItem(keys.at, String(at));
    localStorage.setItem(keys.id, String(id || ''));
    return true;
  } catch (_e) {
    return false;
  }
}

export function initializeMentionLastViewed(
  pubkey = localStorage.getItem('pubkey'),
  now = Math.floor(Date.now() / 1000)
) {
  const keys = getMentionLastViewedKeys(pubkey);
  if (!keys) return { at: 0, id: '' };
  migrateLegacyMentionLastViewed(pubkey);
  const current = readMentionLastViewed(pubkey);
  if (current.at > 0) return current;
  writeMentionLastViewed({ at: now, id: current.id }, pubkey);
  return { at: now, id: current.id };
}
