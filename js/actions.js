// ============================================================================
// 認証・イベントアクション
// ============================================================================

import { getPublicKey as getPublicKeyFn, getFinalizeEvent, getKinds, getNip19 } from './nostr-compat.js';
import { awaitAny, buildReactionEmojiTags, getReactionContent, getReactionEmojiTags } from './utils.js';
import { extractEmojiTagsFromText } from './custom-emoji-store.js';
import { authenticateWithPasskey, decryptNsecWithPasskey, isWebAuthnSupported } from './webauthn.js';
import { bytesToHex, randomBytes } from './crypto.js';
import { t } from './i18n.js';
import { DEFAULT_OMOCHAT_RELAYS } from './constants.js';

/**
 * サインイン順序を解決（署名モードに応じて）
 */
export function resolveLoginOrder(state) {
  if (state.signer === 'nip07') return ['nip07'];
  if (state.signer === 'nsec') return ['nsec'];
  if (state.signer === 'nip46') return ['nip46'];
  // autoモード: nip07→nsec→nip46の優先順
  return ['nip07', 'nsec', 'nip46'];
}

/**
 * 本文中の nostr:npub1... や nostr:nprofile1... から pubkey を抽出し、p タグを追加
 */
function addMentionTags(draft) {
  if (!draft || !draft.content) return;
  if (draft.kind !== 1 && draft.kind !== 42) return;

  try {
    const nip19 = getNip19();
    if (!nip19) return;

    // nostr:(npub|nprofile) にマッチする正規表現
    const regex = /nostr:(npub1[a-z0-9]+|nprofile1[a-z0-9]+)/gi;
    let match;
    const foundPubkeys = new Set();

    while ((match = regex.exec(draft.content)) !== null) {
      try {
        const bech32 = match[1];
        const decoded = nip19.decode(bech32);
        let pubkey = null;
        if (decoded.type === 'npub') {
          pubkey = decoded.data;
        } else if (decoded.type === 'nprofile') {
          pubkey = decoded.data.pubkey;
        }

        if (pubkey && !foundPubkeys.has(pubkey)) {
          foundPubkeys.add(pubkey);
          if (!draft.tags) draft.tags = [];
          const alreadyExists = draft.tags.some(t => Array.isArray(t) && t[0] === 'p' && t[1] === pubkey);
          if (!alreadyExists) {
            draft.tags.push(['p', pubkey]);
          }
        }
      } catch (e) {
        console.warn('[Actions] メンションタグの解析に失敗:', match[0], e);
      }
    }
  } catch (e) {
    console.warn('[Actions] メンションタグ抽出処理全体でエラー:', e);
  }
}

/**
 * 現在の署名モードでイベントに署名
 */
export async function signEventWithMode(state, draft) {
  const getPublicKey = getPublicKeyFn();
  const finalizeEvent = getFinalizeEvent();

  // 実効署名者を決定（local sk があれば nsec 署名を優先）
  const effectiveSigner = (state && state.sk) ? 'nsec' : (state && state.signer) || 'auto';

  // デバッグ: 署名者選択と利用可否を追跡
  try {
    console.debug('[signEventWithMode] 設定署名者:', state && state.signer);
    console.debug('[signEventWithMode] 実効署名者:', effectiveSigner);
    console.debug('[signEventWithMode] state.sk の有無:', !!(state && state.sk));
    console.debug('[signEventWithMode] window.nostr 利用可否:', !!(window && window.nostr));
    console.debug('[signEventWithMode] window.nostr.signEvent 利用可否:', !!(window && window.nostr && window.nostr.signEvent));
    console.debug('[signEventWithMode] finalizeEvent 利用可否:', !!finalizeEvent);
    console.debug('[signEventWithMode] getPublicKey 利用可否:', !!getPublicKey);
    console.debug('[signEventWithMode] nip46 client 利用可否:', !!(state && state.nip46 && state.nip46.client));
  } catch (e) {
    // ログ出力エラーを無視
  }

  // NIP-46 署名（リモート署名者）
  // state.nip46.connected がずれる可能性があるため client.connected を直接確認
  if (state.signer === 'nip46' && state.nip46 && state.nip46.client) {
    const client = state.nip46.client;
    if (client.connected && client.remotePubkey) {
      return await client.signEvent(draft);
    } else {
      console.warn('[signEventWithMode] NIP-46 client が未接続または不完全です, client.connected:', client.connected);
    }
  }

  // local 秘密鍵がある場合は拡張依存を避けるため local 署名を優先
  if (effectiveSigner === 'nsec' && state.sk && finalizeEvent) {
    return finalizeEvent(draft, state.sk);
  }

  // NIP-07 明示指定
  if ((state.signer === 'nip07' || effectiveSigner === 'nip07') && window.nostr && window.nostr.signEvent) {
    return await window.nostr.signEvent(draft);
  }

  // フォールバック: 拡張が利用可能なら試す
  if (window.nostr && window.nostr.signEvent) {
    return await window.nostr.signEvent(draft);
  }

  // 補足: 投稿/リアクション/返信ごとに認証プロンプトが出ないよう、
  // ここでの都度パスキー復号は廃止。
  // パスキー復号は autoLogin または明示ログイン時のみ行い、
  // state.sk をログアウトまでメモリ保持する。

  // 最後の手段として、local sk があれば finalizeEvent を再試行
  if (state.sk && finalizeEvent) {
    return finalizeEvent(draft, state.sk);
  }

  throw new Error('署名者が利用できません');
}

// 署名済みイベントが id と sig を持つか検証
function ensureSignedEvent(ev) {
  if (!ev || typeof ev !== 'object') return false;
  if (!ev.id) return false;
  // 実装によって 'sig' または 'signature' を使う
  if (!ev.sig && !ev.signature) return false;
  return true;
}

// 重複トリガー防止のための簡易ランタイムロック（重複ハンドラ対策）
if (typeof window !== 'undefined') {
  window.__nokakoiActionLocks = window.__nokakoiActionLocks || {};
}

function acquireLock(name, ttl = 2000) {
  try {
    if (typeof window === 'undefined') return false;
    const locks = window.__nokakoiActionLocks || (window.__nokakoiActionLocks = {});
    const now = Date.now();
    if (locks[name] && (now - locks[name]) < ttl) return false;
    locks[name] = now;
    return true;
  } catch (e) {
    return true;
  }
}

function releaseLock(name) {
  try {
    if (typeof window === 'undefined') return;
    const locks = window.__nokakoiActionLocks || (window.__nokakoiActionLocks = {});
    delete locks[name];
  } catch (e) { }
}

// client タグ付与設定を localStorage/appSettings から取得するヘルパー
function getClientAttachInfo() {
  try {
    const appSettings = JSON.parse(localStorage.getItem('appSettings') || '{}');
    const attach = (appSettings.attachClientName !== undefined) ? appSettings.attachClientName : true;
    const name = appSettings.clientName || 'nokakoi';

    // 指定どおり固定の handler event id と relay を使用
    const handlerEventId = '31990:21ac29561b5de90cdc21995fc0707525cd78c8a52d87721ab681d3d609d1e2df:1760607697586';
    const relay = 'wss://yabu.me/';

    return { attach, name, handlerEventId, relay };
  } catch (e) {
    return { attach: true, name: 'nokakoi', handlerEventId: '31990:21ac29561b5de90cdc21995fc0707525cd78c8a52d87721ab681d3d609d1e2df:1760607697586', relay: 'wss://yabu.me/' };
  }
}

/**
 * ノート投稿
 * @param {object} options - { kind, relays, tags }
 */
export async function publishNote(state, content, statusEl, options) {
  // 重複トリガー防止
  if (!acquireLock('publishNote')) {
    console.warn('[publishNote] 重複トリガーを無視');
    return false;
  }


  // race/stale state 回避のため、可能ならグローバル state を使用
  const effectiveState = (typeof window !== 'undefined' && window.__nostrState) ? window.__nostrState : state;

  window.__nokakoiLastAction = {
    type: 'publishNote',
    time: new Date().toISOString(),
    state: {
      signer: effectiveState.signer,
      sk: effectiveState.sk,
      pubkey: localStorage.getItem('pubkey')
    },
    content,
    status: statusEl ? statusEl.textContent : undefined
  };

  try {
    if (!content || !content.trim()) return false;

    // 署名者チェック（skがnullならエラー）
    if (effectiveState.signer === 'nsec' && !effectiveState.sk) {
      if (statusEl) statusEl.textContent = t('publish.nsec_error');
      return false;
    }

    if (!effectiveState.pool) {
      if (statusEl) statusEl.textContent = t('publish.no_lib');
      return false;
    }

    const { getWriteRelays } = await import('./relay.js');
    const writeRelays = (options && options.relays && Array.isArray(options.relays) && options.relays.length > 0)
      ? options.relays
      : getWriteRelays(effectiveState.relays);

    if (!writeRelays.length) {
      if (statusEl) statusEl.textContent = t('publish.no_write_relays');
      return false;
    }

    const kinds = getKinds();
    const draft = {
      kind: (options && options.kind) ? options.kind : ((kinds && kinds.Text) || 1),
      created_at: Math.floor(Date.now() / 1000),
      tags: (options && options.tags) ? options.tags : [],
      content: content.trim(),
      pubkey: localStorage.getItem('pubkey') || ''
    };

    // NIP-30: カスタム絵文字タグを自動追加（kind:1, 7 など対応種別）
    try {
      const supportedKinds = [1, 6, 7, 42, 16, 20000]; // kind:1 投稿、repost、reaction など
      if (supportedKinds.includes(draft.kind)) {
        const customEmojis = (typeof window !== 'undefined' && window.__customEmojis instanceof Map)
          ? window.__customEmojis
          : null;
        if (customEmojis) {
          const emojiTags = extractEmojiTagsFromText(draft.content, customEmojis);
          for (const emojiTag of emojiTags) {
            const textShortcode = emojiTag[1];
            const alreadyExists = draft.tags.some(t =>
              Array.isArray(t) && t[0] === 'emoji' && t[1] === textShortcode
            );
            if (!alreadyExists) {
              draft.tags.push(emojiTag.slice(0, 4));
            }
          }
        }
      }
    } catch (e) {
      console.warn('[Actions] カスタム絵文字タグ追加に失敗:', e);
    }

    // bitchat（kind 20000）専用処理
    if (draft.kind === 20000) {
      if (!draft.tags.some(t => t[0] === 'g')) {
        let geohash = 'xn';
        try { const s = JSON.parse(localStorage.getItem('appSettings')); if(s && s.omochatGeohash) geohash = s.omochatGeohash; } catch(e){}
        draft.tags.push(['g', geohash]);
      }
      if (!draft.tags.some(t => t[0] === 'n')) {
        let name = 'Guest';
        try {
          const pk = draft.pubkey;
          const profiles = effectiveState.profiles;
          if (profiles && profiles.get) {
             const p = profiles.get(pk);
             if (p) {
               name = p.display_name || p.name || 'Guest';
             }
          }
        } catch(e) {}
        draft.tags.push(['n', name]);
      }
    }

    // 設定有効時のみ client タグ付与
    try {
      const ci = getClientAttachInfo();
      if (ci.attach && ci.name) {
        const third = ci.handlerEventId || '';
        const fourth = ci.relay || '';
        draft.tags.push(['client', ci.name, third, fourth]);
      }
    } catch (e) { }

    // 署名者に応じたメッセージ表示
    if (effectiveState.signer === 'nip07') {
      if (statusEl) statusEl.textContent = t('publish.signed_ext');
    } else {
      if (statusEl) statusEl.textContent = t('publish.signed');
    }

    addMentionTags(draft);

    const ev = await signEventWithMode(effectiveState, draft);

    // 返却イベントが適切に署名済みか検証
    if (!ensureSignedEvent(ev)) {
      throw new Error(t('publish.failed', { msg: '署名に失敗しました' }));
    }

    const pubs = await effectiveState.pool.publish(writeRelays, ev);

    if (statusEl) statusEl.textContent = t('publish.sending');
    await awaitAny(pubs);

    if (statusEl) statusEl.textContent = t('publish.posted');
    return true;
  } catch (e) {
    if (statusEl) statusEl.textContent = t('publish.failed', { msg: ((e && e.message) || e) });
    return false;
  } finally {
    // 重複イベント駆動を吸収するため少し遅延してロック解放
    setTimeout(() => releaseLock('publishNote'), 500);
  }
}

/**
 * イベントにリアクション
 */
export async function reactToEvent(state, targetEv, sym = '+') {
  const effectiveState = (typeof window !== 'undefined' && window.__nostrState) ? window.__nostrState : state;
  const reactionContent = getReactionContent(sym) || '+';
  const reactionEmojiTags = getReactionEmojiTags(sym).length ? getReactionEmojiTags(sym) : buildReactionEmojiTags(sym);
  window.__nokakoiLastAction = {
    type: 'reactToEvent',
    time: new Date().toISOString(),
    state: {
      signer: effectiveState.signer,
      sk: effectiveState.sk,
      pubkey: localStorage.getItem('pubkey')
    },
    targetEv,
    sym
  };
  try {
    if (!effectiveState.pool) return false;
    // 署名者チェック（skがnullならエラー）
    if (effectiveState.signer === 'nsec' && !effectiveState.sk) {
      alert(t('publish.nsec_error'));
      return false;
    }

    const { getWriteRelays } = await import('./relay.js');
    const writeRelays = getWriteRelays(effectiveState.relays);

    if (!writeRelays.length) {
      alert(t('publish.no_write_relays'));
      return false;
    }

    const tags = [['e', targetEv.id], ['p', targetEv.pubkey]];

    // 対象イベントの kind を表す 'k' タグを追加（取得不可時は付与しない）
    try {
      if (targetEv && typeof targetEv.kind !== 'undefined' && targetEv.kind !== null) {
        tags.push(['k', String(targetEv.kind)]);
      }
    } catch (e) { }

    // NIP-30: カスタム絵文字の場合emojiタグ追加
    for (const emojiTag of reactionEmojiTags) {
      if (Array.isArray(emojiTag) && emojiTag[0] === 'emoji' && emojiTag[1] && emojiTag[2]) {
        tags.push(emojiTag.slice(0, 4));
      }
    }
    // 設定有効時のみ client タグ付与
    try {
      const ci = getClientAttachInfo();
      if (ci.attach && ci.name) {
        const third = ci.handlerEventId || ci.handlerEventId || '';
        const fourth = ci.relay || '';
        tags.push(['client', ci.name, third, fourth]);
      }
    } catch (e) { }

    const draft = {
      kind: 7,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: reactionContent,
      pubkey: localStorage.getItem('pubkey') || ''
    };

    const ev = await signEventWithMode(effectiveState, draft);

    if (!ensureSignedEvent(ev)) {
      throw new Error('署名に失敗しました');
    }

    const pubs = await effectiveState.pool.publish(writeRelays, ev);
    await awaitAny(pubs);
    return true;
  } catch (e) {
    console.warn('[Actions] リアクション送信失敗', e);
    alert(t('publish.failed', { msg: ((e && e.message) || e) }));
    return false;
  }
}

/**
 * イベントに返信
 */
export async function replyToEvent(state, targetEv, text) {
  const effectiveState = (typeof window !== 'undefined' && window.__nostrState) ? window.__nostrState : state;
  window.__nokakoiLastAction = {
    type: 'replyToEvent',
    time: new Date().toISOString(),
    state: {
      signer: effectiveState.signer,
      sk: effectiveState.sk,
      pubkey: localStorage.getItem('pubkey')
    },
    text,
    targetEv,
  };

  try {
    if (!text || !text.trim()) return false;
    if (!effectiveState.pool) return false;

    const { getWriteRelays } = await import('./relay.js');

    // 署名者チェック（skがnullならエラー）
    if (effectiveState.signer === 'nsec' && !effectiveState.sk) {
      alert(t('publish.nsec_error'));
      return false;
    }

    const kinds = getKinds();
    let tags = [];
    let replyKind = (kinds && kinds.Text) || 1;

    if (targetEv.kind === 20000) {
      // kind:20000 omochat の返信は e/p タグを使用しない
      replyKind = 20000;
      tags = [];

      // 対象イベントの g タグを継承
      const targetG = (targetEv.tags || []).find(t => t[0] === 'g');
      if (targetG && targetG[1]) {
        tags.push(['g', targetG[1]]);
      }

      if (!tags.some(t => t[0] === 'g')) {
        let geohash = 'xn';
        try { const s = JSON.parse(localStorage.getItem('appSettings')); if(s && s.omochatGeohash) geohash = s.omochatGeohash; } catch(e){}
        tags.push(['g', geohash]);
      }

      if (!tags.some(t => t[0] === 'n')) {
        let name = 'Guest';
        try {
          const pk = localStorage.getItem('pubkey');
          const profiles = effectiveState.profiles;
          if (profiles && profiles.get && pk) {
             const p = profiles.get(pk);
             if (p) {
               name = p.display_name || p.name || 'Guest';
             }
          }
        } catch(e) {}
        tags.push(['n', name]);
      }
    } else {
      // 既定は e タグ返信。quote モード時は NIP-18 に従い q タグを使用
      try {
        const { getBestRelayHint } = await import('./relay.js');
        const { findEventById } = await import('./state.js');
        const targetRelayHint = getBestRelayHint(effectiveState, targetEv);

        const quoteMode = window && window.getQuoteMode ? window.getQuoteMode() : (window.__nokakoiQuoteMode || false);
        if (quoteMode) {
          // q タグ: 第3要素はリレーヒント、第4要素は対象イベントの pubkey
          tags = [['q', targetEv.id, targetRelayHint, targetEv.pubkey]];
        } else {
          const parentETags = (targetEv.tags || []).filter(t => t && t[0] === 'e' && t[1]);
          let rootId = null;
          if (parentETags.length > 0) {
            const rootTag = parentETags.find(t => t[3] === 'root');
            if (rootTag) {
              rootId = rootTag[1];
            } else {
              rootId = parentETags[0][1];
            }
          }

          if (rootId) {
            const rootEv = findEventById(effectiveState, rootId);
            const rootRelayHint = rootEv ? getBestRelayHint(effectiveState, rootEv) : targetRelayHint;
            tags = [
              ['e', rootId, rootRelayHint, 'root'],
              ['e', targetEv.id, targetRelayHint, 'reply'],
              ['p', targetEv.pubkey]
            ];
          } else {
            tags = [
              ['e', targetEv.id, targetRelayHint, 'root'],
              ['p', targetEv.pubkey]
            ];
          }
        }
      } catch (e) {
        tags = [
          ['e', targetEv.id, '', 'root'],
          ['p', targetEv.pubkey]
        ];
      }
    }

    // 投稿先リレーを決定: kind:20000 は omochat リレー、その他は通常 write リレー
    let writeRelays;
    if (replyKind === 20000) {
      try {
        const s = JSON.parse(localStorage.getItem('appSettings') || '{}');
        writeRelays = (s && Array.isArray(s.omochatRelays) && s.omochatRelays.length > 0)
          ? s.omochatRelays
          : DEFAULT_OMOCHAT_RELAYS.slice();
      } catch (e) {
        writeRelays = DEFAULT_OMOCHAT_RELAYS.slice();
      }
    } else {
      writeRelays = getWriteRelays(effectiveState.relays);
    }

    if (!writeRelays.length) {
      alert(t('publish.no_write_relays'));
      return false;
    }

    try {
      const ci = getClientAttachInfo();
      if (ci.attach && ci.name) {
        const third = ci.handlerEventId || '';
        const fourth = ci.relay || '';
        tags.push(['client', ci.name, third, fourth]);
      }
    } catch (e) { }
    const draft = {
      kind: replyKind,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: text.trim(),
      pubkey: localStorage.getItem('pubkey') || ''
    };

    // デバッグ: 署名前の signer 状態を記録
    try {
      console.debug('[replyToEvent] 署名前状態: state.signer=', effectiveState.signer, 'state.sk の有無=', !!effectiveState.sk, 'pubkey=', localStorage.getItem('pubkey'));
    } catch (dbe) {
      // エラーを無視
    }

    addMentionTags(draft);

    const ev = await signEventWithMode(effectiveState, draft);

    if (!ensureSignedEvent(ev)) {
      throw new Error('署名に失敗しました');
    }

    const pubs = await effectiveState.pool.publish(writeRelays, ev);
    await awaitAny(pubs);
    return true;
  } catch (e) {
    // signer 利用可否の障害解析向け追加ログ
    try {
      console.error('[replyToEvent] 送信失敗時のstate:', {
        signer: effectiveState && effectiveState.signer,
        hasSk: !!(effectiveState && effectiveState.sk),
        skPreview: effectiveState && effectiveState.sk ? (effectiveState.sk.slice ? effectiveState.sk.slice(0, 8) + '...' : '(set)') : null,
        pubkey: localStorage.getItem('pubkey'),
        lastAction: window.__nokakoiLastAction
      });
    } catch (logErr) {
      console.error('[replyToEvent] デバッグログ出力に失敗', logErr);
    }

    console.warn('[Actions] 返信送信失敗', e);
    alert(t('publish.failed', { msg: ((e && e.message) || e) }));
    return false;
  }
}

/**
 * イベントをリポスト（kind 6）
 */
export async function repostEvent(state, targetEv) {
  const effectiveState = (typeof window !== 'undefined' && window.__nostrState) ? window.__nostrState : state;
  window.__nokakoiLastAction = {
    type: 'repostEvent',
    time: new Date().toISOString(),
    state: {
      signer: effectiveState.signer,
      sk: effectiveState.sk,
      pubkey: localStorage.getItem('pubkey')
    },
    targetEv
  };
  try {
    if (!effectiveState.pool) {
      alert(t('mute.no_pool'));
      return false;
    }

    const { getWriteRelays, getBestRelayHint } = await import('./relay.js');
    const writeRelays = getWriteRelays(effectiveState.relays);

    if (!writeRelays.length) {
      alert(t('publish.no_write_relays'));
      return false;
    }

    const targetRelayHint = getBestRelayHint(effectiveState, targetEv);

    const kinds = getKinds();

    // kind:6 は kind:1 専用。それ以外は kind:16（Generic Repost）を使用
    let repostKind = 16;
    if (Number(targetEv && targetEv.kind) === 1) {
      repostKind = (kinds && kinds.Repost) || 6;
    }

    // NIP-18: リポスト（kind 6 / 16）
    // タグは'e'（イベントID）と'p'（投稿者pubkey）
    const tags = [
      ['e', targetEv.id, targetRelayHint],
      ['p', targetEv.pubkey]
    ];

    // kind:16（Generic Repost）では 'k' タグが必須
    if (repostKind === 16) {
      tags.push(['k', String(targetEv.kind)]);
    }

    try {
      const ci = getClientAttachInfo();
      if (ci.attach && ci.name) {
        const third = ci.handlerEventId || '';
        const fourth = ci.relay || '';
        tags.push(['client', ci.name, third, fourth]);
      }
    } catch (e) { }

    // contentは空文字にする
    const content = '';

    const draft = {
      kind: repostKind,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: content,
      pubkey: localStorage.getItem('pubkey') || ''
    };

    const ev = await signEventWithMode(effectiveState, draft);

    if (!ensureSignedEvent(ev)) {
      throw new Error('署名に失敗しました');
    }

    const pubs = await effectiveState.pool.publish(writeRelays, ev);
    await awaitAny(pubs);

    return true;
  } catch (e) {
    console.warn('[Actions] リポスト送信失敗', e);
    alert(t('publish.failed', { msg: ((e && e.message) || e) }));
    return false;
  }
}
