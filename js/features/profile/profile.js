// ============================================================================
// プロフィール管理
// ============================================================================

import { profileIndexerRelay } from '../../core/relay.js';
import { truncateName, escapeHtml, replaceBadgeEmoji } from '../../utils/utils.js';

import { getNip19 as getNip19Compat } from '../../core/nostr-compat.js';

const PROFILE_CACHE_KEY = 'nostr_profiles_cache';
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; //24時間

// リレー過負荷を避けるためプロフィール取得の同時実行数を制限
const MAX_CONCURRENT_PROFILE_LOADS = 3;
let _profileLoadActive = 0;
const _profileLoadQueue = [];
function _enqueueProfileLoad(fn) {
  return new Promise((resolve, reject) => {
    _profileLoadQueue.push({ fn, resolve, reject });
    _dequeueProfileLoad();
  });
}
function _dequeueProfileLoad() {
  if (_profileLoadActive >= MAX_CONCURRENT_PROFILE_LOADS) return;
  const item = _profileLoadQueue.shift();
  if (!item) return;
  _profileLoadActive++;
  (async () => {
    try {
      const res = await item.fn();
      _profileLoadActive--;
      item.resolve(res);
    } catch (err) {
      _profileLoadActive--;
      item.reject(err);
    } finally {
      // 深い再帰を避けるため次ティックで再実行
      try { setTimeout(_dequeueProfileLoad, 0); } catch (e) { _dequeueProfileLoad(); }
    }
  })();
}

/**
 * localStorageからプロフィールキャッシュを読み込む
 */
function loadProfileCache() {
  try {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!cached) return new Map();

    const data = JSON.parse(cached);
    const profiles = new Map();

    // 有効期限切れを除外
    const now = Date.now();
    for (const [pubkey, entry] of Object.entries(data)) {
      if (entry.cachedAt && (now - entry.cachedAt) < CACHE_EXPIRY_MS) {
        profiles.set(pubkey, entry);
      }
    }

    return profiles;
  } catch (e) {
    console.warn('[Profile] プロフィールキャッシュの読み込み失敗:', e);
    return new Map();
  }
}

/**
 * プロフィールをキャッシュに保存
 */
function saveProfileToCache(pubkey, profile) {
  try {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY);
    const data = cached ? JSON.parse(cached) : {};

    data[pubkey] = {
      ...profile,
      cachedAt: Date.now()
    };

    // キャッシュサイズ上限1000件
    const entries = Object.entries(data);
    if (entries.length > 1000) {
      // cachedAtでソートし新しい1000件のみ保持
      entries.sort((a, b) => (b[1].cachedAt || 0) - (a[1].cachedAt || 0));
      const limited = Object.fromEntries(entries.slice(0, 1000));
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(limited));
    } else {
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(data));
    }
  } catch (e) {
    console.warn('[Profile] プロフィールキャッシュ保存失敗:', e);
    // localStorageがいっぱいなら古いデータをクリア
    try {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    } catch { }
  }
}

/**
 * stateにプロフィールキャッシュを初期化
 */
export function initializeProfileCache(state) {
  const cached = loadProfileCache();

  // キャッシュをstateにマージ
  for (const [pubkey, profile] of cached.entries()) {
    if (!state.profiles.has(pubkey)) {
      state.profiles.set(pubkey, {
        ...profile,
        loaded: true,
        loading: false,
        fromCache: true
      });
    }
  }

  try {
    if (typeof window !== 'undefined' && window.__nokakoiDebug) {
      console.debug('[Profile] キャッシュから', cached.size, '件のプロフィールを読み込みました');
    }
  } catch (e) { }
}

/**
 * プロフィールメタデータから名前取得
 */
export function nameFromMeta(meta) {
  if (!meta) return '';
  const dn = meta.display_name;
  const nm = meta.name;
  return (dn && dn.trim()) || (nm && nm.trim()) || '';
}

/**
 * プロフィールメタデータから表示名・ユーザー名取得
 * { displayName: string, username: string } を返す
 */
export function getNamesFromMeta(meta) {
  if (!meta) return { displayName: '', username: '' };

  const dn = (meta.display_name || '').trim();
  const nm = (meta.name || '').trim();

  // 両方あれば両方返す（同じでも）
  if (dn && nm) {
    return { displayName: dn, username: nm };
  }
  // どちらかのみならdisplayNameとして返す
  return { displayName: dn || nm, username: '' };
}

/**
 * pubkeyをnpub形式にエンコード
 */
export function npubEncode(pk, nip19) {
  try {
    return (nip19 && nip19.npubEncode) ? nip19.npubEncode(pk) : pk;
  } catch (e) {
    return pk;
  }
}

/**
 * npubの短縮表示
 */
export function npubShort(pk, nip19) {
  const np = npubEncode(pk, nip19) || '';
  return (np.length > 12) ? np.slice(0, 12) + '…' : np;
}

/**
 * リレーからプロフィールをロード
 */
export async function loadProfile(state, pubkey) {
  // pubkeyが未指定ならlocalStorageから取得
  if (!pubkey) pubkey = localStorage.getItem('pubkey');
  if (!pubkey) return null;
  const cached = state.profiles.get(pubkey);

  // 新鮮なキャッシュ（localStorage由来でない）は再ロードしない
  if (cached && cached.loaded && !cached.fromCache) return cached;
  // ロード中なら再ロードしない
  if (cached && cached.loading) return null;
  if (!state.pool) return null;

  // ロード中マーク
  state.profiles.set(pubkey, Object.assign({}, cached || {}, {
    loading: true,
    lastAttempt: Date.now()
  }));

  // getReadRelaysをimport
  const { getReadRelays } = await import('../../core/relay.js');
  const readRelays = getReadRelays(state.relays);

  // キュー投入できるようネットワーク取得処理を関数化
  const doFetch = async () => {
    try {
      // インデクサ・通常リレーを並列で取得（タイムアウト短め）
      // const indexerPromise = state.pool.get([profileIndexerRelay], {
      //   kinds: [0],
      //   authors: [pubkey]
      // });
      // const regularPromise = state.pool.get(readRelays, {
      //   kinds: [0],
      //   authors: [pubkey]
      // });

      // const ev = await Promise.race([
      //   Promise.race([indexerPromise, regularPromise]),
      //   new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')),800))
      // ]);

      // 複数リレーへの重複要求による過負荷を避けるため
      // プロフィール取得は中央インデクサのみを使用
      const indexerPromise = state.pool.get([profileIndexerRelay], {
        kinds: [0],
        authors: [pubkey]
      });

      // 短いタイムアウト付きでインデクサ応答待機。タイムアウト時は未検出扱い
      const ev = await Promise.race([
        indexerPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 800))
      ]);

      if (ev && ev.content) {
        try {
          const meta = JSON.parse(ev.content);
          const profile = Object.assign({}, meta, {
            loaded: true,
            loading: false,
            fromCache: false,
            lastAttempt: Date.now()
          });

          state.profiles.set(pubkey, profile);
          // キャッシュ保存
          saveProfileToCache(pubkey, meta);
          // DOM更新
          updateNameDom(state, pubkey, getNip19());
          return profile;
        } catch (e) {
          state.profiles.set(pubkey, {
            loaded: true,
            loading: false,
            fromCache: false,
            lastAttempt: Date.now()
          });
        }
      } else {
        state.profiles.set(pubkey, {
          loaded: true,
          loading: false,
          fromCache: false,
          lastAttempt: Date.now()
        });
      }
    } catch (e) {
      // サイレント失敗（キャッシュがあれば保持）
      if (cached && cached.fromCache) {
        state.profiles.set(pubkey, Object.assign({}, cached, {
          loading: false,
          lastAttempt: Date.now()
        }));
      } else {
        state.profiles.set(pubkey, {
          loaded: true,
          loading: false,
          lastAttempt: Date.now()
        });
      }
    }

    return state.profiles.get(pubkey);
  };

  try {
    // バースト集中を避けるためキュー投入前にランダム遅延（0-200ms）
    const jitter = Math.floor(Math.random() * 201);
    await new Promise(resolve => setTimeout(resolve, jitter));
    // 同時要求を抑えるためキュー経由で実行
    const res = await _enqueueProfileLoad(doFetch);
    return res;
  } catch (e) {
    // 失敗時も state の整合性を保ち、キャッシュまたはプレースホルダを返す
    try {
      if (cached && cached.fromCache) {
        state.profiles.set(pubkey, Object.assign({}, cached, { loading: false, lastAttempt: Date.now() }));
      } else {
        state.profiles.set(pubkey, { loaded: true, loading: false, lastAttempt: Date.now() });
      }
    } catch (ee) { }
    return state.profiles.get(pubkey);
  }
}

/**
 * pubkeyの表示名取得
 */
export function displayName(state, pubkey, nip19) {
  // follow一覧に petname があれば優先表示
  try {
    if (state && state.followPetnames && state.followPetnames.has(pubkey)) {
      const pet = state.followPetnames.get(pubkey);
      if (pet) return '\u200B📛' + pet;
    }
  } catch (e) { }

  const prof = state.profiles.get(pubkey);
  const name = nameFromMeta(prof);

  // 名前がなくロード中でなければプロフィールロード
  if (!name && (!prof || (!prof.loading && !prof.loaded))) {
    loadProfile(state, pubkey);
  }
  // キャッシュ由来ならバックグラウンドで再ロード
  if (prof && prof.fromCache && !prof.loading) {
    const now = Date.now();
    const lastAttempt = prof.lastAttempt || 0;
    //5秒以上経過で再ロード
    if (now - lastAttempt > 5000) {
      loadProfile(state, pubkey);
    }
  }
  // プロフィールはあるが名前なし、かつしばらく経過なら再試行
  if (!name && prof && prof.loaded && !prof.loading && !prof.fromCache) {
    const now = Date.now();
    const lastAttempt = prof.lastAttempt || 0;
    //60秒以上経過で再試行
    if (now - lastAttempt > 60000) {
      state.profiles.set(pubkey, Object.assign({}, prof, {
        lastAttempt: now,
        loaded: false
      }));
      loadProfile(state, pubkey);
    }
  }
  return name || npubShort(pubkey, nip19);
}

/**
 * pubkeyの名前をDOMに反映
 */
export function updateNameDom(state, pubkey, nip19) {
  const nodes = document.querySelectorAll('.name[data-pubkey="' + pubkey + '"]');
  const names = displayNameWithUsername(state, pubkey, nip19, { noTruncate: true });

  nodes.forEach(function (el) {
    // kind:20000(omochat) は nタグ/ハッシュ表示を優先するため、
    // プロフィール由来の updateNameDom で上書きしない
    const eventEl = el.closest('.event[data-kind]');
    if (eventEl && String(eventEl.dataset.kind || '') === '20000') {
      return;
    }

    // メイン名更新
    if (names.main && names.main.includes('\u200B📛')) {
      el.innerHTML = replaceBadgeEmoji(escapeHtml(names.main));
    } else {
      el.textContent = names.main;
    }
    // ユーザー名更新または追加
    let usernameSpan = el.nextElementSibling;
    if (usernameSpan && usernameSpan.classList.contains('username')) {
      if (names.sub) {
        usernameSpan.textContent = '@' + names.sub;
      } else {
        usernameSpan.remove();
      }
    } else if (names.sub) {
      usernameSpan = document.createElement('span');
      usernameSpan.className = 'username';
      usernameSpan.textContent = '@' + names.sub;
      el.parentNode.insertBefore(usernameSpan, el.nextSibling);
    }
  });
}

export function displayNameWithUsername(state, pubkey, nip19, options = {}) {
  const prof = state.profiles.get(pubkey);
  const names = getNamesFromMeta(prof);
  const usePetname = options.usePetname !== false;
  const noTruncate = options.noTruncate === true;

  // 名前がなくロード中でなければプロフィールロード
  if (!names.displayName && (!prof || (!prof.loading && !prof.loaded))) {
    loadProfile(state, pubkey);
  }
  // キャッシュ由来ならバックグラウンドで再ロード
  if (prof && prof.fromCache && !prof.loading) {
    const now = Date.now();
    const lastAttempt = prof.lastAttempt || 0;
    //5秒以上経過で再ロード
    if (now - lastAttempt > 5000) {
      loadProfile(state, pubkey);
    }
  }
  // プロフィールはあるが名前なし、かつしばらく経過なら再試行
  if (!names.displayName && prof && prof.loaded && !prof.loading && !prof.fromCache) {
    const now = Date.now();
    const lastAttempt = prof.lastAttempt || 0;
    //60秒以上経過で再試行
    if (now - lastAttempt > 60000) {
      state.profiles.set(pubkey, Object.assign({}, prof, {
        lastAttempt: now,
        loaded: false
      }));
      loadProfile(state, pubkey);
    }
  }

  // follow一覧に petname があれば優先表示
  if (usePetname) {
    try {
      if (state && state.followPetnames && state.followPetnames.has(pubkey)) {
        const pet = state.followPetnames.get(pubkey);
        if (pet) {
          // 特殊マーカー付きで petname を表示
          const displayPet = noTruncate ? pet : truncateName(pet);
          return { main: '\u200B📛' + displayPet, sub: '' };
        }
      }
    } catch (e) { }
  }

  const fallback = npubShort(pubkey, nip19);
  if (names.displayName && names.username) {
    return {
      main: noTruncate ? names.displayName : truncateName(names.displayName),
      sub: noTruncate ? names.username : truncateName(names.username)
    };
  } else if (names.displayName) {
    return {
      main: noTruncate ? names.displayName : truncateName(names.displayName),
      sub: ''
    };
  } else {
    return {
      main: noTruncate ? fallback : truncateName(fallback),
      sub: ''
    };
  }
}

/**
 * nip19インスタンス取得
 */
function getNip19() {
  try {
    return getNip19Compat() || null;
  } catch (e) { }
  return null;
}

/**
 * ユーザーステータス (kind: 30315) をロード
 * ※現在はLive更新（main.jsの購読）のみに依存するため、ここでの能動的なFetchは行いません。
 */
export async function loadUserStatus(state, pubkey) {
  // musicステータスはLive購読でのみ取得するため、ここでは何もしない
  return null;
}

/**
 * ユーザーステータスをDOMに反映
 */
export function updateUserStatusDom(state, pubkey) {
  // 設定チェック: showMusicStatusがfalseなら表示しない
  let show = true;
  // 設定マネージャへのアクセス手段がない場合があるので、localStorageを直接見るか、
  // stateにsettingsが含まれていればそれを使う。
  // main.jsなどで設定はグローバル管理されているが、ここでは簡易的にlocalStorageを見る。
  try {
     const saved = localStorage.getItem('appSettings');
     if (saved) {
       const s = JSON.parse(saved);
       if (s.showMusicStatus === false) show = false;
     }
  } catch(e) {}

  const nodes = document.querySelectorAll('.user-status[data-pubkey="' + pubkey + '"]');
  const status = state.userStatuses.get(pubkey);

  if (!show || !status || !status.content) {
    // ステータスがない、または削除された、あるいは設定でOFFの場合は非表示に
    nodes.forEach(el => {
      el.style.display = 'none';
      el.textContent = '';
      el.removeAttribute('title');
    });
    return;
  }

  const displayContent = '♫ ' + (status.content || '');

  nodes.forEach(el => {
    if (el.textContent !== displayContent) {
      el.textContent = displayContent;
      el.style.display = 'block';
      el.title = status.content;
    } else {
      // 内容が同じでも非表示だった場合は表示
      if (el.style.display === 'none') el.style.display = 'block';
    }
  });
}
