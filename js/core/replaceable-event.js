import { getReadRelays, getWriteRelays } from './relay.js';
import { signEventWithMode } from '../features/post/actions.js';
import { awaitAny } from '../utils/utils.js';

/**
 * 全 read リレーから指定 kind の最新イベントを取得。
 * subscribeMany で全リレーに問い合わせ、created_at が最大のものを返す。
 */
export async function fetchLatestEvent(state, kind, pubkey, options = {}) {
  try {
    const timeoutMs = options.timeout || 4000;
    
    if (!state || !state.pool || !pubkey) {
      return null;
    }

    const readRelays = getReadRelays(state.relays);
    if (!readRelays || readRelays.length === 0) {
      return null;
    }

    return new Promise((resolve) => {
      let latestEvent = null;
      const events = [];

      const sub = state.pool.subscribeMany(
        readRelays,
        [{ kinds: [kind], authors: [pubkey], limit: 10 }],
        {
          onevent(event) {
            events.push(event);
          },
          oneose() {
            sub.close();
            resolve(findLatest());
          }
        }
      );

      const timeout = setTimeout(() => {
        sub.close();
        resolve(findLatest());
      }, timeoutMs);

      function findLatest() {
        clearTimeout(timeout);
        if (events.length === 0) return null;
        latestEvent = events[0];
        for (const ev of events) {
          if (ev.created_at > latestEvent.created_at) {
            latestEvent = ev;
          }
        }
        return latestEvent;
      }
    });
  } catch (e) {
    console.error('Failed to fetch latest event:', e);
    return null;
  }
}

/**
 * バックアップを localStorage に保存
 */
export function backupEvent(kind, event) {
  try {
    if (!event) return;
    const pubkey = localStorage.getItem('pubkey');
    const key = pubkey ? `backup_kind${kind}.${pubkey.toLowerCase()}` : `backup_kind${kind}`;
    const data = {
      event,
      timestamp: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to backup event:', e);
  }
}

/**
 * バックアップを復元
 */
export function restoreBackup(kind) {
  try {
    const pubkey = localStorage.getItem('pubkey');
    const key = pubkey ? `backup_kind${kind}.${pubkey.toLowerCase()}` : `backup_kind${kind}`;
    const dataStr = localStorage.getItem(key);
    if (!dataStr) return null;
    
    const data = JSON.parse(dataStr);
    return data.event || null;
  } catch (e) {
    console.error('Failed to restore backup:', e);
    return null;
  }
}

/**
 * 署名済みイベントを全 write リレーへ発行し、少なくとも1つの OK を待つ
 */
export async function publishReplaceableEvent(state, draft) {
  try {
    const signedEvent = await signEventWithMode(state, draft);
    
    if (!signedEvent || !signedEvent.id || (!signedEvent.sig && !signedEvent.signature)) {
      return { ok: false, error: 'Sign failed' };
    }

    const writeRelays = getWriteRelays(state.relays);
    if (!writeRelays || writeRelays.length === 0) {
      return { ok: false, error: 'No write relays' };
    }

    const pubs = state.pool.publish(writeRelays, signedEvent);
    
    try {
      await awaitAny(pubs);
      return { ok: true, event: signedEvent };
    } catch (publishError) {
      return { ok: false, error: publishError.message || 'Publish failed on all relays' };
    }
  } catch (e) {
    console.error('Failed to publish replaceable event:', e);
    return { ok: false, error: e.message || 'Unknown error' };
  }
}

/**
 * バックアップを自動で読み込み、最新としてリレーへ再発行する
 */
export async function restoreAndPublishBackup(kind) {
  try {
    const ev = restoreBackup(kind);
    if (!ev) {
      console.warn(`[ReplaceableEvent] Backup for kind:${kind} not found`);
      return { ok: false, error: 'Backup not found' };
    }
    const state = (typeof window !== 'undefined' && window.__nostrState) ? window.__nostrState : null;
    if (!state) {
      console.warn('[ReplaceableEvent] Global state window.__nostrState not found');
      return { ok: false, error: 'State not found' };
    }
    const draft = {
      kind: ev.kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: ev.tags || [],
      content: ev.content || '',
      pubkey: ev.pubkey || localStorage.getItem('pubkey') || ''
    };
    console.log(`[ReplaceableEvent] Restoring backup kind:${kind}...`, draft);
    const res = await publishReplaceableEvent(state, draft);
    if (res && res.ok) {
      console.log(`[ReplaceableEvent] Successfully restored & published kind:${kind}`);
    } else {
      console.error(`[ReplaceableEvent] Failed to publish restored backup:`, res && res.error);
    }
    return res;
  } catch (e) {
    console.error(`[ReplaceableEvent] Error restoring backup kind:${kind}:`, e);
    return { ok: false, error: e.message || e };
  }
}

function normalizeNip65RelayUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();
  if (!url.startsWith('wss://') && !url.startsWith('ws://')) return '';
  try {
    const parsed = new URL(url);
    let pathname = parsed.pathname.replace(/\/+/g, '/');
    if (!pathname || pathname === '') {
      pathname = '/';
    } else if (!pathname.endsWith('/')) {
      pathname = pathname + '/';
    }
    parsed.pathname = pathname;
    return parsed.toString();
  } catch (e) {
    if (!url.endsWith('/')) {
      url += '/';
    }
    return url;
  }
}

/**
 * デフォルトまたは現在の設定リレーから NIP-65 (kind:10002) リレーリストイベントを生成して発行
 * @param {Object} state - アプリ状態
 */
export async function publishDefaultNip65RelayList(state) {
  try {
    if (!state || !state.pubkey) return { ok: false, error: 'No active pubkey' };

    const relays = state.relays || [];
    const tags = [];
    if (Array.isArray(relays) && relays.length > 0) {
      relays.forEach(r => {
        let rawUrl = '';
        let read = true;
        let write = true;
        if (typeof r === 'string') {
          rawUrl = r;
        } else if (r && r.url) {
          rawUrl = r.url;
          read = !!r.read;
          write = !!r.write;
        }
        const normUrl = normalizeNip65RelayUrl(rawUrl);
        if (normUrl) {
          const modeTag = ['r', normUrl];
          if (read && !write) modeTag.push('read');
          else if (!read && write) modeTag.push('write');
          tags.push(modeTag);
        }
      });
    } else {
      tags.push(['r', 'wss://nos.lol/']);
      tags.push(['r', 'wss://relay-jp.nostr.wirednet.jp/']);
      tags.push(['r', 'wss://yabu.me/']);
    }

    const draft = {
      kind: 10002,
      created_at: Math.floor(Date.now() / 1000),
      tags: tags,
      content: '',
      pubkey: state.pubkey
    };

    console.log('[NIP-65] 新規アカウントの kind:10002 リレーリストを発行中...', draft);
    const res = await publishReplaceableEvent(state, draft);
    if (res && res.ok) {
      console.log('[NIP-65] kind:10002 リレーリストの発行に成功しました！');
      backupEvent(10002, res.event || draft);
    }
    return res;
  } catch (e) {
    console.error('[NIP-65] kind:10002 発行例外:', e);
    return { ok: false, error: e.message || e };
  }
}

// デベロッパーコンソールから呼び出せるように window にバインド
try {
  if (typeof window !== 'undefined') {
    window.restoreBackup = restoreBackup;
    window.backupEvent = backupEvent;
    window.fetchLatestEvent = (kind, pubkey, options) => fetchLatestEvent(window.__nostrState, kind, pubkey || localStorage.getItem('pubkey'), options);
    window.publishReplaceableEvent = (draft) => publishReplaceableEvent(window.__nostrState, draft);
    window.restoreAndPublishBackup = restoreAndPublishBackup;
  }
} catch (e) { }

