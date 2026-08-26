import { EVENTS_FETCH_LIMIT } from '../../config/constants.js';

/**
 * 自分が送った Zap レシート (kind:9735 の P タグ)。
 * フィード表示用ではなく Zap 済み判定用。addToFeed 側でタイムラインへは入れない。
 */
export function buildOutgoingZapReceiptFilter(pubkey, extra = {}) {
  if (!pubkey) return null;
  return Object.assign({ kinds: [9735], '#P': [pubkey] }, extra);
}

/**
 * グローバルマージが有効な場合のホーム追加取得用フィルターを構築する
 */
export function buildHomeLoadMoreFiltersForGlobalMerge(state, until) {
  try {
    const followsForMore = (state.feeds['home'] && state.feeds['home'].follows) || [];
    if (!followsForMore.length) return [];
    return [{ kinds: [1, 6, 1111], authors: followsForMore, limit: EVENTS_FETCH_LIMIT, until }];
  } catch (e) {
    return [];
  }
}

/**
 * フィードのデフォルトベースフィルターを構築して返す
 */
export function getFeedBaseFilters(state, settingsManager, feedId) {
  try {
    if (feedId === 'home') {
      const pubkey = localStorage.getItem('pubkey');
      const followsForMore = (state && state.feeds && state.feeds['home'] && state.feeds['home'].follows) || [];
      if (!followsForMore.length) return [];
      const optionalHomeFollowKinds = [];
      if (settingsManager && settingsManager.get('showHomeReactions') === true) optionalHomeFollowKinds.push(7);
      if (settingsManager && settingsManager.get('showHomeChannel') === true) optionalHomeFollowKinds.push(42);
      if (settingsManager && settingsManager.get('showHomeRepost16') === true) optionalHomeFollowKinds.push(16);

      return [
        { kinds: [1, 6, 1111, ...optionalHomeFollowKinds], authors: followsForMore, limit: EVENTS_FETCH_LIMIT },
        { kinds: [1, 6, 7, 1111, 9735], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT },
        buildOutgoingZapReceiptFilter(pubkey, { limit: EVENTS_FETCH_LIMIT }),
        { kinds: [7, 42, 16], authors: [pubkey], limit: EVENTS_FETCH_LIMIT }
      ].filter(Boolean);
    } else if (feedId === 'mentions') {
      const pubkey = localStorage.getItem('pubkey');
      return [
        { kinds: [1, 6, 7, 42, 1111, 9735], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT },
        { kinds: [1111], '#P': [pubkey], limit: EVENTS_FETCH_LIMIT }
      ];
    } else if (feedId === 'me') {
      const pubkey = localStorage.getItem('pubkey');
      return [{ kinds: [1, 6, 7, 42, 16, 1111], authors: [pubkey], limit: EVENTS_FETCH_LIMIT }];
    } else if (feedId === 'bitchat') {
      return [{ kinds: [20000], limit: EVENTS_FETCH_LIMIT }];
    } else if (feedId === 'global') {
      return [{ kinds: [1, 6, 1111], limit: EVENTS_FETCH_LIMIT }];
    }
  } catch (e) { }
  return [{ kinds: [1, 6, 1111], limit: EVENTS_FETCH_LIMIT }];
}

/**
 * ホームタイムラインの追加取得用フィルターを構築する
 */
export function buildHomeLoadMoreFilters(state, settingsManager, until) {
  try {
    const pubkey = localStorage.getItem('pubkey');
    const followsForMore = (state.feeds['home'] && state.feeds['home'].follows) || [];
    if (!followsForMore.length) return [];
    const baseFilters = [
      { kinds: [1, 6, 1111], authors: followsForMore, limit: EVENTS_FETCH_LIMIT },
      { kinds: [1, 6, 7, 1111, 9735], '#p': [pubkey], limit: EVENTS_FETCH_LIMIT },
      buildOutgoingZapReceiptFilter(pubkey, { limit: EVENTS_FETCH_LIMIT }),
      { kinds: [7, 42, 16], authors: [pubkey], limit: EVENTS_FETCH_LIMIT }
    ].filter(Boolean);
    const optionalHomeFollowKinds = [];
    if (settingsManager.get('showHomeReactions') === true) optionalHomeFollowKinds.push(7);
    if (settingsManager.get('showHomeChannel') === true) optionalHomeFollowKinds.push(42);
    if (settingsManager.get('showHomeRepost16') === true) optionalHomeFollowKinds.push(16);
    if (optionalHomeFollowKinds.length > 0) {
      baseFilters.push({ kinds: optionalHomeFollowKinds, authors: followsForMore, limit: EVENTS_FETCH_LIMIT });
    }
    return baseFilters.map(f => Object.assign({}, f, { until }));
  } catch (e) {
    return [];
  }
}

