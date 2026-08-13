import { refreshClosestOmochatRelays } from '../features/timeline/omochat-lifecycle.js';

function serializedRelays(settingsManager) {
  return JSON.stringify(settingsManager.get('omochatComputedRelays') || []);
}

export function refreshOmochatRelaysOnBoot(settingsManager, setupBitchatFeed) {
  if (settingsManager.get('omochatAutoRelays') === false) return Promise.resolve(false);

  const originalRelays = serializedRelays(settingsManager);
  return refreshClosestOmochatRelays(settingsManager).then((updated) => {
    if (updated && originalRelays !== serializedRelays(settingsManager)) {
      console.log('[Main] 起動時に Omochat リレーが更新されました。bitchat フィードを更新します');
      if (typeof setupBitchatFeed === 'function') setupBitchatFeed();
      return true;
    }
    return false;
  });
}

export function setupOmochatTabListener(state, { handleTabChange, setupBitchatFeed }) {
  let lastActiveTab = null;
  setTimeout(() => {
    lastActiveTab = document.querySelector('.tab.active')?.dataset?.tab || null;
  }, 500);

  window.addEventListener('tab:changed', (event) => {
    try {
      const activeTab = event.detail?.tab;
      if (!activeTab) return;

      if (event.detail?.skipFeedLifecycle === true) {
        lastActiveTab = activeTab;
        return;
      }

      const sourceTab = lastActiveTab || document.querySelector('.tab.active')?.dataset?.tab || null;
      try {
        handleTabChange(sourceTab, activeTab);
      } catch (error) {
        console.warn('[Main] タブ切り替え処理に失敗しました:', error);
      }
      lastActiveTab = activeTab;

      if (activeTab === 'bitchat') {
        console.log('[Main] bitchat タブを有効化し、履歴付きフィードをセットアップ中...');
        setupBitchatFeed({ mode: 'full' });
      }
    } catch (error) {
      console.warn('[Main] tab:changed イベント処理に失敗しました:', error);
    }
  });
}

export function setupOmochatSettingsListener({
  state,
  settingsManager,
  setupTabs,
  setupGlobalTabSelector,
  clearGlobalFeed,
  updateGlobalButtonLabel,
  showToast,
  t,
  setupBitchatFeed
}) {
  window.addEventListener('omochatSettingsSaved', async () => {
    try {
      setupTabs(true);
      setupGlobalTabSelector(state, settingsManager, clearGlobalFeed);
      try { updateGlobalButtonLabel(settingsManager); } catch (_e) { }

      if (settingsManager.get('omochatAutoRelays') !== false) {
        showToast(t('omochat.relays.updating') || '位置情報リレーを更新中...', { type: 'info' });
        const originalRelays = serializedRelays(settingsManager);
        const updated = await refreshClosestOmochatRelays(settingsManager);
        if (updated && originalRelays !== serializedRelays(settingsManager)) {
          showToast(t('omochat.relays.updated') || '位置情報リレーを更新しました', { type: 'success' });
        }
      }

      if (typeof setupBitchatFeed === 'function') setupBitchatFeed();
    } catch (_e) { }
  });
}
