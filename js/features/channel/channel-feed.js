// ============================================================================
// チャンネルタイムライン・通信モジュール (NIP-28 kind:42)
// ============================================================================

import { getReadRelays, getWriteRelays } from '../../core/relay.js';
import { cacheEvent } from '../../core/state.js';
import { fetchChannelMetadata, pickChannelRootRelayHints } from './channel.js';
import { getClientAttachInfo, signEventWithMode, reactToEvent, replyToEvent, repostEvent } from '../post/actions.js';
import { renderEvent } from '../../ui/renderers/post-renderer.js';
import { getNip19 } from '../../core/nostr-compat.js';
import { awaitAny } from '../../utils/utils.js';

import { EVENTS_FETCH_LIMIT } from '../../config/constants.js';
import { t } from '../../utils/i18n.js';

const _channelSubs = new Map(); // rootId -> sub/unsub object
const _observedLoadMoreBtns = new WeakMap(); // containerEl -> loadMoreBtn

/**
 * 特定チャンネルのメッセージ (kind:42) をサブスクライブしてタイムライン描画
 */
export async function subscribeChannelFeed(rootId, state, containerEl, settingsManager = null) {
  if (!rootId || !containerEl) return;

  // 既存のサブスクリプションがあれば一旦クリア
  unsubscribeChannelFeed(rootId);
  unobserveLoadMore(containerEl);

  containerEl.innerHTML = '<div class="muted p-12 text-center">メッセージを取得中...</div>';

  // メインの Read Relays + チャンネルの推奨リレーを取得
  const mainRelays = (state && state.relays) ? getReadRelays(state.relays) : [];
  let metaRelays = [];
  try {
    const meta = await fetchChannelMetadata(state, rootId);
    if (meta && meta.metaEvent) {
      const hints = pickChannelRootRelayHints(meta.metaEvent, rootId);
      if (hints.length) metaRelays = hints;
    }
  } catch (_e) {}

  const targetRelays = Array.from(new Set([...mainRelays, ...metaRelays])).slice(0, 10);
  if (!targetRelays.length) {
    containerEl.innerHTML = '<div class="text-danger p-12 text-center">接続可能なリレーがありません</div>';
    return;
  }

  const eventsMap = new Map();
  let isLoadingMore = false;
  let noMoreEvents = false;

  async function loadMoreHistory() {
    if (isLoadingMore || noMoreEvents) return;
    const sorted = Array.from(eventsMap.values()).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    if (!sorted.length) return;
    const oldest = sorted[sorted.length - 1];
    const until = (oldest.created_at || Math.floor(Date.now() / 1000)) - 1;
    if (until <= 0) return;

    isLoadingMore = true;
    renderEvents();

    try {
      const loadFilter = { kinds: [42], '#e': [rootId], limit: EVENTS_FETCH_LIMIT, until };
      let fetchedCount = 0;
      if (state && state.pool && typeof state.pool.subscribeMany === 'function') {
        const sub = state.pool.subscribeMany(targetRelays, [loadFilter], {
          onevent(ev) {
            if (!ev || ev.kind !== 42) return;
            cacheEvent(state, ev);
            if (!eventsMap.has(ev.id)) {
              eventsMap.set(ev.id, ev);
              fetchedCount++;
            }
          },
          oneose() {
            try { if (typeof sub.close === 'function') sub.close(); } catch (_e) {}
            isLoadingMore = false;
            if (fetchedCount === 0) noMoreEvents = true;
            renderEvents();
          },
          eoseTimeout: 4000,
        });
      } else {
        isLoadingMore = false;
        renderEvents();
      }
    } catch (_e) {
      isLoadingMore = false;
      renderEvents();
    }
  }

  function renderEvents() {
    if (!containerEl) return;
    unobserveLoadMore(containerEl);

    // 最新が上になるよう降順 (新しい順) でソート
    const sorted = Array.from(eventsMap.values()).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

    if (!sorted.length) {
      containerEl.innerHTML = '<div class="muted p-12 text-center">まだメッセージはありません。</div>';
      return;
    }

    containerEl.innerHTML = '';
    sorted.forEach(ev => {
      const msgEl = createChannelMessageElement(ev, state, settingsManager);
      containerEl.appendChild(msgEl);
    });

    // 「もっと読む」ボタンの描画
    if (!noMoreEvents) {
      const loadMoreBtn = document.createElement('button');
      loadMoreBtn.type = 'button';
      loadMoreBtn.className = 'feed-bar feed-bar-bottom accent-center load-more-btn' + (isLoadingMore ? ' is-loading-auto' : '');
      loadMoreBtn.style.marginTop = '12px';
      loadMoreBtn.style.width = '100%';
      loadMoreBtn.textContent = isLoadingMore ? (t('loading') || '読み込み中...') : (t('feed.load_more') || 'もっと読む');
      loadMoreBtn.onclick = () => {
        if (isLoadingMore) return;
        loadMoreHistory();
      };
      containerEl.appendChild(loadMoreBtn);

      try {
        if (typeof window !== 'undefined' && window.__infiniteScrollObserver) {
          window.__infiniteScrollObserver.observe(loadMoreBtn);
          _observedLoadMoreBtns.set(containerEl, loadMoreBtn);
        }
      } catch (_e) {}
    }
  }

  // リレー通信 (Simple Pool Subscription - 他タブ同等件数 EVENTS_FETCH_LIMIT)
  if (state && state.pool && typeof state.pool.subscribeMany === 'function') {
    try {
      const filter = { kinds: [42], '#e': [rootId], limit: EVENTS_FETCH_LIMIT };
      const sub = state.pool.subscribeMany(targetRelays, [filter], {
        onevent(ev) {
          if (!ev || ev.kind !== 42) return;
          cacheEvent(state, ev);
          if (!eventsMap.has(ev.id)) {
            eventsMap.set(ev.id, ev);
            renderEvents();
          }
        },
        oneose() {
          if (!eventsMap.size) renderEvents();
        },
        eoseTimeout: 5000,
      });

      _channelSubs.set(rootId, sub);
    } catch (e) {
      console.error('[channel-feed] Subscription failed', e);
      containerEl.innerHTML = '<div class="text-danger p-12 text-center">メッセージの取得に失敗しました</div>';
    }
  } else {
    containerEl.innerHTML = '<div class="muted p-12 text-center">リレープールが利用できません</div>';
  }
}

function unobserveLoadMore(containerEl) {
  if (!containerEl) return;
  try {
    const prev = _observedLoadMoreBtns.get(containerEl);
    if (prev && typeof window !== 'undefined' && window.__infiniteScrollObserver) {
      window.__infiniteScrollObserver.unobserve(prev);
    }
  } catch (_e) {}
  try { _observedLoadMoreBtns.delete(containerEl); } catch (_e) {}
}

/**
 * チャンネルサブスクリプションの解除
 */
export function unsubscribeChannelFeed(rootId) {
  if (!rootId) return;
  const sub = _channelSubs.get(rootId);
  if (sub) {
    try {
      if (typeof sub.close === 'function') sub.close();
      else if (typeof sub.unsub === 'function') sub.unsub();
    } catch (_e) {}
    _channelSubs.delete(rootId);
  }
}

/**
 * チャンネルメッセージ要素の標準レンダラーによる生成 (petname, 画像, 引用等を共通化)
 */
function createChannelMessageElement(ev, state, settingsManager) {
  const nip19 = getNip19 ? getNip19() : null;
  const settings = (settingsManager && typeof settingsManager.getAll === 'function') ? settingsManager.getAll() : {};

  try {
    const cardEl = renderEvent(
      state,
      ev,
      nip19,
      settings,
      settingsManager,
      reactToEvent,
      replyToEvent,
      repostEvent,
      'channels'
    );
    return cardEl;
  } catch (err) {
    console.warn('[channel-feed] Standard renderEvent failed, using fallback', err);
    const fallback = document.createElement('div');
    fallback.className = 'event';
    fallback.textContent = ev.content || '';
    return fallback;
  }
}

export async function sendChannelMessage(rootId, content, state, options = {}) {
  if (!rootId || !content) throw new Error('メッセージ内容またはチャンネルIDがありません');

  const writeRelays = (state && state.relays) ? getWriteRelays(state.relays) : [];
  const readRelays = (state && state.relays) ? getReadRelays(state.relays) : [];
  const optionRelays = Array.isArray(options.relays) ? options.relays.filter(r => typeof r === 'string' && r.trim()) : [];
  const relayHint = (writeRelays[0] || readRelays[0] || optionRelays[0] || 'wss://yabu.me/');

  const tags = [
    ['e', rootId, relayHint, 'root']
  ];

  // 返信対象メッセージがある場合
  if (options.replyToEvent && options.replyToEvent.id) {
    tags.push(['e', options.replyToEvent.id, relayHint, 'reply']);
    if (options.replyToEvent.pubkey) {
      tags.push(['p', options.replyToEvent.pubkey]);
    }
  }

  // 引用対象メッセージがある場合 (NIP-18 qタグ)
  if (options.isQuote && options.replyToEvent && options.replyToEvent.id) {
    tags.push(['q', options.replyToEvent.id, relayHint]);
  }

  // 設定有効時のみ client タグ付与
  try {
    const ci = getClientAttachInfo();
    if (ci.attach && ci.name) {
      const third = ci.handlerEventId || '';
      const fourth = ci.relay || '';
      tags.push(['client', ci.name, third, fourth]);
    }
  } catch (_e) { }

  let finalContent = content;
  // 引用の場合で、本文に nostr: リンクがまだ含まれていなければ自動アペンド
  if (options.isQuote && options.replyToEvent) {
    try {
      const nip19 = getNip19();
      if (nip19 && typeof nip19.neventEncode === 'function') {
        const nevent = nip19.neventEncode({ id: options.replyToEvent.id, author: options.replyToEvent.pubkey });
        if (nevent && !content.includes(nevent)) {
          finalContent = content + '\n\nnostr:' + nevent;
        }
      }
    } catch (_e) {}
  }

  const unsignedEv = {
    kind: 42,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: finalContent,
    pubkey: (state && state.pubkey) || localStorage.getItem('pubkey') || ''
  };

  // イベントの署名 (NIP-07 / NIP-46 / nsec 共通モード)
  const signedEv = await signEventWithMode(state, unsignedEv);

  if (!signedEv) throw new Error('署名イベントの生成に失敗しました');

  const targetRelays = Array.from(new Set([...writeRelays, ...optionRelays]));
  if (!targetRelays.length) {
    throw new Error('書き込み可能なリレーがありません');
  }

  // リレーへパブリッシュし、少なくとも1件の受理を待つ
  if (state && state.pool && typeof state.pool.publish === 'function') {
    const pubs = await state.pool.publish(targetRelays, signedEv);
    await awaitAny(pubs);
  } else {
    throw new Error('リレープールが利用できません');
  }

  cacheEvent(state, signedEv);
  return signedEv;
}
