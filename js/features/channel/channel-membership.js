// ============================================================================
// チャンネル参加状態（手動追加 + kind:10005 ローカル除外）
// ============================================================================

const CUSTOM_JOINED_KEY = 'custom_joined_channels';
const EXCLUSIONS_KEY = 'channel_10005_exclusions_v1';

function normalizeRootId(rootId) {
  if (!rootId || typeof rootId !== 'string') return null;
  const id = rootId.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(id) ? id : null;
}

function readIdList(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const out = [];
    const seen = new Set();
    for (const item of parsed) {
      const id = normalizeRootId(item);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  } catch (_e) {
    return [];
  }
}

function writeIdList(key, ids) {
  try {
    const normalized = [];
    const seen = new Set();
    for (const item of ids || []) {
      const id = normalizeRootId(item);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      normalized.push(id);
    }
    localStorage.setItem(key, JSON.stringify(normalized));
    return normalized;
  } catch (_e) {
    return [];
  }
}

export function getCustomJoinedChannels() {
  return readIdList(CUSTOM_JOINED_KEY);
}

export function addCustomJoinedChannel(rootId) {
  const id = normalizeRootId(rootId);
  if (!id) return getCustomJoinedChannels();
  const list = getCustomJoinedChannels();
  if (!list.includes(id)) list.push(id);
  return writeIdList(CUSTOM_JOINED_KEY, list);
}

export function removeCustomJoinedChannel(rootId) {
  const id = normalizeRootId(rootId);
  if (!id) return getCustomJoinedChannels();
  return writeIdList(CUSTOM_JOINED_KEY, getCustomJoinedChannels().filter(x => x !== id));
}

export function getExcludedPublicChatIds() {
  return readIdList(EXCLUSIONS_KEY);
}

export function addExcludedPublicChatId(rootId) {
  const id = normalizeRootId(rootId);
  if (!id) return getExcludedPublicChatIds();
  const list = getExcludedPublicChatIds();
  if (!list.includes(id)) list.push(id);
  return writeIdList(EXCLUSIONS_KEY, list);
}

export function removeExcludedPublicChatId(rootId) {
  const id = normalizeRootId(rootId);
  if (!id) return getExcludedPublicChatIds();
  return writeIdList(EXCLUSIONS_KEY, getExcludedPublicChatIds().filter(x => x !== id));
}

/**
 * kind:10005 再取得後: もうリストに無い除外 ID だけ刈り取る
 * @param {string[]} currentPublicRootIds
 * @param {{ allowEmpty?: boolean }} [options] allowEmpty=false（既定）のとき空配列では何もしない
 */
export function pruneExcludedPublicChatIds(currentPublicRootIds, options = {}) {
  const ids = Array.isArray(currentPublicRootIds) ? currentPublicRootIds : [];
  // 取得失敗・未発行と「空の 10005」を区別できない場合に除外を誤消去しない
  if (!ids.length && options.allowEmpty !== true) {
    return getExcludedPublicChatIds();
  }
  const alive = new Set(ids.map(normalizeRootId).filter(Boolean));
  const next = getExcludedPublicChatIds().filter(id => alive.has(id));
  return writeIdList(EXCLUSIONS_KEY, next);
}

/**
 * kind:10005 書き込み成功時に呼ぶ（正本へ同期したので除外は不要）
 */
export function clearExcludedPublicChatIds() {
  return writeIdList(EXCLUSIONS_KEY, []);
}

/**
 * 参加追加: 除外を解除し、10005 に無い場合は手動リストへ
 */
export function joinChannelLocally(rootId, options = {}) {
  const id = normalizeRootId(rootId);
  if (!id) return { ok: false, rootId: null };
  removeExcludedPublicChatId(id);
  const publicIds = new Set(
    (options.publicRootIds || [])
      .map(normalizeRootId)
      .filter(Boolean)
  );
  if (!publicIds.has(id)) {
    addCustomJoinedChannel(id);
  }
  return { ok: true, rootId: id };
}

/**
 * リストから削除:
 * - 手動追加 → custom から除去
 * - kind:10005 由来 → 除外リストへ（再取得でも隠れ、将来の 10005 更新まで維持）
 */
export function leaveChannelLocally(rootId, options = {}) {
  const id = normalizeRootId(rootId);
  if (!id) return { ok: false, rootId: null };
  const publicIds = new Set(
    (options.publicRootIds || [])
      .map(normalizeRootId)
      .filter(Boolean)
  );
  removeCustomJoinedChannel(id);
  if (publicIds.has(id)) {
    addExcludedPublicChatId(id);
  }
  return { ok: true, rootId: id };
}

/**
 * 表示用に 10005 entries + custom をマージ（除外適用済み）
 */
export function mergeChannelMembership(publicEntries) {
  const exclusions = new Set(getExcludedPublicChatIds());
  const merged = new Map();

  (publicEntries || []).forEach((entry) => {
    const id = normalizeRootId(entry && entry.rootId);
    if (!id || exclusions.has(id)) return;
    merged.set(id, {
      ...entry,
      rootId: id,
      source: 'public',
    });
  });

  getCustomJoinedChannels().forEach((rootId) => {
    if (merged.has(rootId)) return;
    if (exclusions.has(rootId)) return;
    merged.set(rootId, {
      rootId,
      relayHint: null,
      isPrivate: false,
      source: 'custom',
    });
  });

  return Array.from(merged.values());
}
