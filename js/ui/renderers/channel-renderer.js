import { escapeHtml } from '../../utils/utils.js';
import {
  pickChannelRootId,
  getChannelLabelFromCache,
  formatChannelLabelText,
  buildChannelEmbedContext,
} from '../../features/channel/channel.js';
import { openEhagakiWithChannel } from '../../features/post/postlink.js';


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

/**
 * チャンネル名クリックでチャンネルタブへ（タブ非表示時は eHagaki）
 * @param {ParentNode} root ラベルを含むコンテナ
 * @param {object} ev kind:42 イベント
 * @param {object} state
 */
export function bindChannelLabelClickHandler(root, ev, state) {
  if (!root || !ev || ev.kind !== 42) return;
  const labelEl = root.querySelector('.channel-label[data-channel-root-id]');
  if (!labelEl) return;

  labelEl.onclick = async function (e) {
    try {
      e.stopPropagation();
      e.preventDefault();
    } catch (err) { }

    const rootId = labelEl.getAttribute('data-channel-root-id') || pickChannelRootId(ev);
    if (!rootId) return;

    try {
      labelEl.classList.add('is-busy');

      const { activateTab, getSettingsManager } = await import('../setup/tab-manager.js').catch(() => ({}));
      const channelsTabBtn = document.querySelector('.tabs .tab[data-tab="channels"]');
      if (channelsTabBtn || typeof activateTab === 'function') {
        const eventModal = document.getElementById('eventModal');
        if (eventModal && !eventModal.hidden) {
          try { window.__nokakoiEventModalEvent = null; } catch (_e) { }
          eventModal.hidden = true;
        }
        const profileModal = document.getElementById('profileModal');
        if (profileModal && !profileModal.hidden) {
          const profileClose = document.getElementById('profileClose');
          if (profileClose && typeof profileClose.onclick === 'function') {
            try { profileClose.onclick(); } catch (_e) { profileModal.hidden = true; }
          } else {
            profileModal.hidden = true;
          }
        }

        if (typeof activateTab === 'function') {
          const sm = (typeof getSettingsManager === 'function') ? getSettingsManager() : null;
          activateTab('channels', sm, { skipFeedLifecycle: true });
        } else if (channelsTabBtn) {
          channelsTabBtn.click();
        }
        const mod = await import('../../features/channel/channel-ui.js');
        if (mod && typeof mod.openChannelFromExternal === 'function') {
          await mod.openChannelFromExternal(rootId, state);
        }
        return;
      }

      const channel = await buildChannelEmbedContext(state, rootId, ev);
      if (!channel || !channel.reference) return;
      await openEhagakiWithChannel(channel);
    } catch (err) {
      console.warn('[Channel] チャンネル遷移に失敗', err);
    } finally {
      try { labelEl.classList.remove('is-busy'); } catch (err) { }
    }
  };
}
