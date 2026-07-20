import { escapeHtml } from '../../utils/utils.js';
import {
  pickChannelRootId,
  getChannelLabelFromCache,
  formatChannelLabelText,
} from '../../features/channel/channel.js';


/**
 * kind:42 チャンネル投稿のコンテキスト行を描画
 */
export function renderChannelContext(state, ev) {
  if (!ev || ev.kind !== 42) return '';
  const rootId = pickChannelRootId(ev);
  const knownName = getChannelLabelFromCache(state, rootId);
  const labelText = formatChannelLabelText(knownName, rootId);
  const rootAttr = rootId ? ' data-channel-root-id="' + escapeHtml(rootId) + '"' : '';
  return '<div class="reply-to channel">' +
    '<span class="reply-marker">#</span>' +
    '<span class="channel-label"' + rootAttr + '>' + escapeHtml(labelText) + '</span>' +
    '</div>';
}
