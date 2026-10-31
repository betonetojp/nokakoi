import { t, applyTranslations } from '../../utils/i18n.js';
import { showOmochatSettingsModal, showConfirmModal } from '../modals/modals.js';
import { clearReplyTarget, setChannelTarget } from '../../features/post/composer.js';
import { shortenChannelEventId, fetchChannelMetadata } from '../../features/channel/channel.js';
import { subscribeChannelFeed, unsubscribeAllChannelFeeds } from '../../features/channel/channel-feed.js';
import { setMentionBlink } from './mention-blink.js';
import { showHomeDisplayQuickModal } from './display-settings.js';
import { getAppState, updateTabVisibility, getSettingsManager } from '../../core/app-context.js';
import { writeMentionLastViewed } from '../../utils/mention-last-viewed.js';
import {
  initChannelView,
  pauseChannelSubscriptions,
  resumeChannelSubscriptions,
  syncChannelComposerState
} from '../../features/channel/channel-ui.js';
import {
  ensureTabBarScroller,
  scheduleActiveTabAlign,
  setupTabBarScroll
} from '../tab-bar-scroll.js';

export const DEFAULT_TABS = [
  { id: 'home', labelKey: 'tabs.home', canToggle: true, defaultVisible: true },
  { id: 'global', labelKey: 'tabs.global', canToggle: true, defaultVisible: true },
  { id: 'me', labelKey: 'tabs.me', canToggle: true, defaultVisible: true },
  { id: 'mentions', labelKey: 'tabs.mentions', canToggle: true, defaultVisible: true },
  { id: 'channels', labelKey: 'tabs.channels', fallbackLabel: 'チャンネル', canToggle: true, defaultVisible: true, notifyDot: false },
  { id: 'bitchat', labelKey: 'tabs.bitchat', fallbackLabel: 'omochat', canToggle: true, defaultVisible: true }
];

async function ensureChannelView(settingsManager) {
  const feedChan = document.getElementById('feed-channels');
  if (feedChan && (!feedChan.children.length || feedChan.dataset.initialized !== 'true')) {
    feedChan.dataset.initialized = 'true';
    const currentState = getAppState();
    if (typeof initChannelView === 'function') {
      initChannelView(feedChan, currentState, settingsManager);
    }
  }
  return {
    pauseChannelSubscriptions,
    resumeChannelSubscriptions,
    syncChannelComposerState
  };
}

export function loadTabSettings(settingsManager) {
  try {
    let raw = settingsManager.get('tabs_v2');
    if (!raw && typeof settingsManager.getRaw === 'function') {
      const stored = settingsManager.getRaw('tabs_v2');
      if (stored) {
        raw = stored;
        if (settingsManager.settings) {
          settingsManager.settings.tabs_v2 = raw;
        }
      }
    }
    if (raw && Array.isArray(raw)) {
      if (!raw.some(t => t.id === 'channels')) {
        const bitIndex = raw.findIndex(t => t.id === 'bitchat');
        const newChan = { id: 'channels', labelKey: 'tabs.channels', fallbackLabel: 'チャンネル', canToggle: true, defaultVisible: true, visible: true, notifyDot: false };
        if (bitIndex >= 0) raw.splice(bitIndex, 0, newChan);
        else raw.push(newChan);
      }
      raw.forEach(t => {
        if (t.id === 'channels' || (t.id && t.id.startsWith('channel-'))) {
          t.notifyDot = false;
        }
      });
      return raw;
    }
  } catch (e) {}

  let tabs = JSON.parse(JSON.stringify(DEFAULT_TABS));
  try {
    if (settingsManager.settings.showOmochat === false) {
      const bit = tabs.find(t => t.id === 'bitchat');
      if (bit) bit.visible = false;
    }
  } catch (e) {}

  tabs.forEach(t => {
    if (t.visible === undefined) t.visible = t.defaultVisible;
    if (t.notifyDot === undefined) t.notifyDot = (t.id !== 'channels' && !t.id.startsWith('channel-'));
  });
  return tabs;
}

export function saveTabSettings(settingsManager, tabs) {
  settingsManager.set('tabs_v2', tabs);
}

export function getChannelTabId(rootId) {
  if (!rootId) return '';
  return String(rootId).startsWith('channel-') ? String(rootId) : `channel-${rootId}`;
}

export function isChannelTabPinned(settingsManager, rootId) {
  if (!settingsManager || !rootId) return false;
  const tabId = getChannelTabId(rootId);
  const currentTabs = loadTabSettings(settingsManager);
  return currentTabs.some(t => t.id === tabId || t.rootId === rootId);
}

export function addChannelTab(settingsManager, { rootId, name = '', relays = [] } = {}) {
  if (!settingsManager || !rootId) return false;
  const tabId = getChannelTabId(rootId);
  const currentTabs = loadTabSettings(settingsManager);
  const existing = currentTabs.find(t => t.id === tabId || t.rootId === rootId);
  if (existing) {
    if (existing.visible === false) {
      existing.visible = true;
      saveTabSettings(settingsManager, currentTabs);
      refreshTabSettingsUI(settingsManager);
    }
    setupTabs(settingsManager, true);
    activateTab(existing.id, settingsManager);
    try { window.dispatchEvent(new CustomEvent('tabsRebuilt')); } catch (e) {}
    return true;
  }

  const rawName = String(name || '').trim();
  const label = rawName ? (rawName.startsWith('#') ? rawName : `# ${rawName}`) : `# ${shortenChannelEventId(rootId)}`;
  const newTab = {
    id: tabId,
    type: 'channel',
    rootId,
    label,
    fallbackLabel: label,
    canRemove: true,
    canToggle: true,
    defaultVisible: true,
    visible: true,
    notifyDot: false,
    relays: Array.isArray(relays) ? relays : []
  };

  const chanIndex = currentTabs.findIndex(t => t.id === 'channels');
  if (chanIndex >= 0) {
    let insertIndex = chanIndex + 1;
    while (insertIndex < currentTabs.length && currentTabs[insertIndex].id.startsWith('channel-')) {
      insertIndex++;
    }
    currentTabs.splice(insertIndex, 0, newTab);
  } else {
    currentTabs.push(newTab);
  }

  saveTabSettings(settingsManager, currentTabs);
  refreshTabSettingsUI(settingsManager);
  setupTabs(settingsManager, true);
  activateTab(tabId, settingsManager);
  try { window.dispatchEvent(new CustomEvent('tabsRebuilt')); } catch (e) {}
  return true;
}

export function removeChannelTab(settingsManager, rootId, options = {}) {
  if (!settingsManager || !rootId) return false;
  const tabId = getChannelTabId(rootId);
  const currentTabs = loadTabSettings(settingsManager);
  const targetIndex = currentTabs.findIndex(t => t.id === tabId || t.rootId === rootId);
  if (targetIndex < 0) return false;

  const targetTab = currentTabs[targetIndex];
  currentTabs.splice(targetIndex, 1);
  saveTabSettings(settingsManager, currentTabs);
  refreshTabSettingsUI(settingsManager);

  const activeBtn = document.querySelector('.tabs .tab.active');
  const activeTabId = activeBtn ? activeBtn.dataset.tab : null;
  const wasActive = activeTabId === tabId || activeTabId === targetTab.id;

  try {
    const feedEl = document.getElementById(`feed-${tabId}`) || document.getElementById(`feed-${targetTab.id}`);
    if (feedEl && feedEl.parentNode) {
      feedEl.parentNode.removeChild(feedEl);
    }
  } catch (_e) {}

  const closeDetails = options.closeDetails !== undefined ? options.closeDetails : true;
  setupTabs(settingsManager, !wasActive, { closeDetails });
  if (wasActive) {
    const nextTab = currentTabs.find(t => t.visible !== false) || currentTabs[0];
    if (nextTab) activateTab(nextTab.id, settingsManager, { closeDetails });
  }
  try { window.dispatchEvent(new CustomEvent('tabsRebuilt')); } catch (e) {}
  return true;
}

export async function ensureChannelFeedForTab(rootId, containerEl, settingsManager, options = {}) {
  if (!rootId || !containerEl) return;
  const state = getAppState();

  if (typeof unsubscribeAllChannelFeeds === 'function') {
    unsubscribeAllChannelFeeds();
  }

  const tabs = loadTabSettings(settingsManager);
  const cfg = tabs.find(t => t.id === `channel-${rootId}` || t.rootId === rootId);
  const channelName = cfg ? cfg.label : `# ${shortenChannelEventId(rootId)}`;
  try {
    setChannelTarget({ rootId, name: channelName.replace(/^#\s*/, ''), relays: cfg?.relays || [] });
  } catch (_e) {}

  try {
    const resume = options.resume !== undefined ? options.resume : true;
    await subscribeChannelFeed(rootId, state, containerEl, settingsManager, { resume });
  } catch (_e) {}

  if (typeof fetchChannelMetadata === 'function') {
    fetchChannelMetadata(state, rootId).then(meta => {
      if (!meta) return;
      const name = meta.label || (meta.metaEvent && meta.metaEvent.content ? (() => {
        try { return JSON.parse(meta.metaEvent.content).name; } catch (e) { return null; }
      })() : null);
      if (name) {
        const newLabel = `# ${name}`;
        if (cfg && cfg.label !== newLabel) {
          cfg.label = newLabel;
          cfg.fallbackLabel = newLabel;
          saveTabSettings(settingsManager, tabs);
          const btn = document.querySelector(`.tab[data-tab="channel-${rootId}"]`);
          if (btn) btn.textContent = newLabel;
          refreshTabSettingsUI(settingsManager);
        }
        try {
          setChannelTarget({ rootId, name, relays: cfg?.relays || [] });
        } catch (_e) {}
      }
    }).catch(() => {});
  }
}

export function clearMentionBlinkState() {
  try {
    const mentionsFeed = document.getElementById('feed-mentions');
    let newest = 0;
    let newestId = '';
    try {
      const evt = (function () {
        try {
          const el = mentionsFeed;
          if (el) {
            const first = el.querySelector('.event');
            if (first && first.dataset && first.dataset.eventId) {
              const evId = first.dataset.eventId;
              const appState = getAppState();
              if (appState) {
                const ev = appState.feeds && appState.feeds['mentions'] && appState.feeds['mentions'].map && appState.feeds['mentions'].map.get(evId);
                if (ev) return ev;
              }
            }
          }
        } catch (e) { }
        return null;
      })();
      if (evt && evt.created_at) {
        newest = evt.created_at;
        newestId = evt.id || '';
      }
    } catch (e) { }
    if (newest <= 0) newest = Math.floor(Date.now() / 1000);
    writeMentionLastViewed({ at: newest, id: newestId });
  } catch (e) { }
  setMentionBlink(false);
}

export function ensureTabVisible(tabId, settingsManager) {
  if (!tabId || !settingsManager) return false;
  const currentTabs = loadTabSettings(settingsManager);
  const target = currentTabs.find(t => t.id === tabId);
  if (!target) return false;
  if (target.visible === false) {
    target.visible = true;
    saveTabSettings(settingsManager, currentTabs);
    refreshTabSettingsUI(settingsManager);
    setupTabs(settingsManager, true);
    try { window.dispatchEvent(new CustomEvent('tabsRebuilt')); } catch (e) { }
    return true;
  }
  return false;
}

export function activateTab(tabOrId, settingsManager, options = {}) {
  let tabsContainer = document.querySelector('.tabs');
  if (!tabsContainer) return false;
  let targetTab = typeof tabOrId === 'string'
    ? Array.from(tabsContainer.querySelectorAll('.tab')).find(tab => tab.dataset.tab === tabOrId)
    : tabOrId;

  if (!targetTab && typeof tabOrId === 'string' && settingsManager) {
    if (ensureTabVisible(tabOrId, settingsManager)) {
      tabsContainer = document.querySelector('.tabs');
      if (tabsContainer) {
        targetTab = Array.from(tabsContainer.querySelectorAll('.tab')).find(tab => tab.dataset.tab === tabOrId);
      }
    }
  }

  if (!targetTab || !tabsContainer || !tabsContainer.contains(targetTab)) return false;

  const currentActiveBtn = tabsContainer.querySelector('.tab.active');
  const isSameTab = currentActiveBtn === targetTab;

  const tabId = targetTab.dataset.tab;
  const {
    scroll = true,
    emitChange = true,
    skipFeedLifecycle = false,
    closeDetails = true,
    eventDetail = {}
  } = options;
  tabsContainer.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab === targetTab);
  });

  const feeds = document.querySelectorAll('.feed');
  feeds.forEach(feed => feed.classList.remove('active'));

  let targetFeed = document.getElementById('feed-' + tabId);
  if (!targetFeed && tabId.startsWith('channel-')) {
    const feedsContainer = document.getElementById('feeds') || document.querySelector('.feed')?.parentNode || document.body;
    if (feedsContainer) {
      targetFeed = document.createElement('div');
      targetFeed.id = 'feed-' + tabId;
      targetFeed.className = 'feed';
      targetFeed.dataset.channelRootId = tabId.slice('channel-'.length);
      feedsContainer.appendChild(targetFeed);
    }
  }

  if (targetFeed) {
    targetFeed.classList.add('active');
    if (scroll) {
      setTimeout(() => {
        if (typeof document === 'undefined') return;
        const tabsBar = document.querySelector('.tabs');
        const tabsBarHeight = tabsBar ? tabsBar.getBoundingClientRect().height : 0;
        try {
          const top = targetFeed.getBoundingClientRect().top + window.scrollY - tabsBarHeight;
          window.scrollTo({ top, behavior: 'auto' });
        } catch (e) { }
      }, 50);
    }
  }

  const ehagakiBtn = document.getElementById('ehagakiBtn');
  if (ehagakiBtn) {
    ehagakiBtn.classList.toggle('d-none', tabId === 'bitchat');
  }

  try { targetTab.classList.remove('has-new-dot'); } catch (e) { }
  if (tabId === 'mentions') clearMentionBlinkState();

  if (tabId.startsWith('channel-')) {
    const rootId = tabId.slice('channel-'.length);
    if (!skipFeedLifecycle && targetFeed) {
      ensureChannelFeedForTab(rootId, targetFeed, settingsManager);
    }
  } else if (tabId === 'channels') {
    if (skipFeedLifecycle) {
      try {
        if (typeof syncChannelComposerState === 'function') syncChannelComposerState();
      } catch (e) { }
    } else {
      ensureChannelView(settingsManager).then((module) => {
        if (module && typeof module.resumeChannelSubscriptions === 'function') {
          module.resumeChannelSubscriptions();
        }
        if (module && typeof module.syncChannelComposerState === 'function') {
          module.syncChannelComposerState();
        }
      }).catch(() => {});
    }
  } else {
    try { clearReplyTarget(); } catch (e) { }
    try {
      if (typeof pauseChannelSubscriptions === 'function') pauseChannelSubscriptions();
      if (typeof unsubscribeAllChannelFeeds === 'function') unsubscribeAllChannelFeeds();
    } catch (e) { }
  }

  if (closeDetails && !isSameTab) {
    try {
      document.querySelectorAll('details').forEach(details => { details.open = false; });
    } catch (e) { }
  }

  if (emitChange) {
    try {
      window.dispatchEvent(new CustomEvent('tab:changed', {
        detail: { ...eventDetail, tab: tabId }
      }));
    } catch (e) { }
  }
  scheduleActiveTabAlign(tabsContainer);
  return true;
}

export function setupTabs(settingsManager, preserveActive = false, options = {}) {
  const tabsContainer = document.querySelector('.tabs');
  if (!tabsContainer) return;

  let activeId = null;
  if (preserveActive) {
    const activeBtn = tabsContainer.querySelector('.tab.active');
    if (activeBtn) activeId = activeBtn.dataset.tab;
  }

  let tabsConfig = loadTabSettings(settingsManager);

  if (!tabsConfig.some(t => t.visible !== false)) {
    const home = tabsConfig.find(t => t.id === 'home');
    if (home) home.visible = true;
    else if (tabsConfig.length > 0) tabsConfig[0].visible = true;
  }

  const tabsScroller = ensureTabBarScroller(tabsContainer);
  tabsScroller.innerHTML = '';
  setupTabBarScroll(tabsScroller);
  const visibleTabs = tabsConfig.filter(t => t.visible !== false);
  visibleTabs.forEach(cfg => {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.tab = cfg.id;
    btn.type = 'button';

    if (cfg.type === 'channel' || (cfg.id && cfg.id.startsWith('channel-'))) {
      const channelLabel = cfg.label || cfg.fallbackLabel || ('# ' + (cfg.rootId ? shortenChannelEventId(cfg.rootId) : 'channel'));
      btn.textContent = channelLabel;
      btn.title = channelLabel;

      const triggerRemoveTab = () => {
        const rootId = cfg.rootId || cfg.id.slice('channel-'.length);
        const chanName = cfg.label || `# ${shortenChannelEventId(rootId)}`;
        const confirmMsg = t('channel.delete_tab_confirm', { name: chanName }) || `「${chanName}」のタブを削除しますか？`;
        const modalTitle = t('channel.tab_remove_title') || 'タブの削除';
        showConfirmModal(modalTitle, confirmMsg, () => {
          removeChannelTab(settingsManager, rootId, { closeDetails: false });
        });
      };

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        triggerRemoveTab();
        return false;
      });

      let pressTimer;
      let startX, startY;
      let hasMoved = false;
      let longPressTriggered = false;

      btn.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        hasMoved = false;
        longPressTriggered = false;

        pressTimer = setTimeout(() => {
          longPressTriggered = true;
          triggerRemoveTab();
        }, 800);
      }, { passive: true });

      btn.addEventListener('touchmove', (e) => {
        if (hasMoved) return;
        const touch = e.touches[0];
        if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
          hasMoved = true;
          clearTimeout(pressTimer);
        }
      }, { passive: true });

      btn.addEventListener('touchend', (e) => {
        clearTimeout(pressTimer);
        if (longPressTriggered) {
          e.preventDefault();
        }
      });
      btn.addEventListener('touchcancel', () => {
        clearTimeout(pressTimer);
      });
    } else if (cfg.labelKey) {
      if (cfg.id === 'bitchat') {
        const gh = settingsManager.get('omochatGeohash') || 'xn';
        btn.textContent = '📍' + gh;
      } else if (cfg.id === 'global') {
        btn.textContent = t(cfg.labelKey);
      } else {
        btn.setAttribute('data-i18n', cfg.labelKey);
        btn.textContent = t(cfg.labelKey);
      }
    } else {
      btn.textContent = cfg.fallbackLabel || cfg.id;
    }

    btn.onclick = function () {
      activateTab(btn, settingsManager);
    };

    if (cfg.id === 'bitchat') {
      let pressTimer;
      let startX, startY;
      let hasMoved = false;
      let longPressTriggered = false;

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showOmochatSettingsModal(settingsManager);
      });
      btn.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        hasMoved = false;
        longPressTriggered = false;

        pressTimer = setTimeout(() => {
          longPressTriggered = true;
          showOmochatSettingsModal(settingsManager);
        }, 800);
      }, { passive: true });
      btn.addEventListener('touchmove', (e) => {
        if (hasMoved) return;
        const touch = e.touches[0];
        if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
          hasMoved = true;
          clearTimeout(pressTimer);
        }
      }, { passive: true });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        clearTimeout(pressTimer);
        if (!longPressTriggered && !hasMoved) {
          btn.click();
        }
      });
      btn.addEventListener('touchcancel', () => {
        clearTimeout(pressTimer);
      });
    }

    if (cfg.id === 'home') {
      let longPressTimer = null;
      let startX, startY;
      let hasMoved = false;
      let longPressTriggered = false;

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showHomeDisplayQuickModal();
        return false;
      });
      btn.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        hasMoved = false;
        longPressTriggered = false;

        longPressTimer = setTimeout(() => {
          longPressTriggered = true;
          showHomeDisplayQuickModal();
        }, 600);
      }, { passive: true });
      btn.addEventListener('touchmove', (e) => {
        if (hasMoved) return;
        const touch = e.touches[0];
        if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
          hasMoved = true;
          if (longPressTimer) clearTimeout(longPressTimer);
        }
      }, { passive: true });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (longPressTimer) clearTimeout(longPressTimer);
        if (!longPressTriggered && !hasMoved) {
          btn.click();
        }
      });
      btn.addEventListener('touchcancel', () => {
        if (longPressTimer) clearTimeout(longPressTimer);
      });
    }

    if (cfg.id === 'global') {
      let longPressTimer = null;
      let startX, startY;
      let hasMoved = false;
      let longPressTriggered = false;

      const triggerGlobalSelector = () => {
        import('../../features/relay/global-relay.js').then(m => {
          if (m && typeof m.showGlobalRelaySelector === 'function') {
            const currentState = getAppState();
            m.showGlobalRelaySelector(currentState, settingsManager);
          }
        });
      };

      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        triggerGlobalSelector();
        return false;
      });

      btn.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        hasMoved = false;
        longPressTriggered = false;

        longPressTimer = setTimeout(() => {
          longPressTriggered = true;
          triggerGlobalSelector();
        }, 600);
      }, { passive: true });

      btn.addEventListener('touchmove', (e) => {
        if (hasMoved) return;
        const touch = e.touches[0];
        if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
          hasMoved = true;
          if (longPressTimer) clearTimeout(longPressTimer);
        }
      }, { passive: true });

      btn.addEventListener('touchend', (e) => {
        if (longPressTimer) clearTimeout(longPressTimer);
        if (longPressTriggered) {
          e.preventDefault();
        }
      });

      btn.addEventListener('touchcancel', () => {
        if (longPressTimer) clearTimeout(longPressTimer);
      });
    }

    tabsScroller.appendChild(btn);
  });

  try { if (typeof applyTranslations === 'function') applyTranslations(tabsContainer); } catch(e){}

  try {
    import('../../features/relay/global-relay.js').then(m => {
      if (m && typeof m.updateGlobalButtonLabel === 'function') {
        m.updateGlobalButtonLabel(settingsManager);
        scheduleActiveTabAlign(tabsContainer);
      }
    });
  } catch (e) {}

  const allBtns = tabsContainer.querySelectorAll('.tab');
  if (allBtns.length > 0) {
    let target = null;
    if (activeId) {
      target = Array.from(allBtns).find(b => b.dataset.tab === activeId);
    }
    if (!target) {
      try {
        const pubkey = localStorage.getItem('pubkey');
        if (!pubkey) {
          const globalBtn = Array.from(allBtns).find(b => b.dataset.tab === 'global');
          if (globalBtn) target = globalBtn;
        }
      } catch (e) { }
    }
    if (!target) target = allBtns[0];

    activateTab(target, settingsManager, {
      scroll: false,
      emitChange: !preserveActive || target.dataset.tab !== activeId,
      ...options
    });
  }

  try {
    const currentState = getAppState();
    const pubkey = (currentState && currentState.pubkey) || (typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : null);
    if (typeof updateTabVisibility === 'function') {
      updateTabVisibility(!!pubkey);
    }
  } catch (e) {}
}

export function renderTabSettingsUI(settingsManager, container) {
  if (!container) return;
  container.innerHTML = '';

  let currentTabs = loadTabSettings(settingsManager);
  currentTabs.forEach(t => { if (t.notifyDot === undefined) t.notifyDot = true; });

  currentTabs.forEach((tab, index) => {
    const row = document.createElement('div');
    row.className = 'tab-order-row';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'tab-order-btn-group';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.textContent = '▲';
    upBtn.className = 'secondary small tab-order-arrow-btn';
    upBtn.disabled = index === 0;
    upBtn.onclick = () => {
      const temp = currentTabs[index-1];
      currentTabs[index-1] = currentTabs[index];
      currentTabs[index] = temp;
      saveTabSettings(settingsManager, currentTabs);
      renderTabSettingsUI(settingsManager, container);
      setupTabs(settingsManager, true, { closeDetails: false });
      try { window.dispatchEvent(new CustomEvent('tabsRebuilt')); } catch(e) {}
    };

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.textContent = '▼';
    downBtn.className = 'secondary small tab-order-arrow-btn';
    downBtn.disabled = index === currentTabs.length - 1;
    downBtn.onclick = () => {
      const temp = currentTabs[index+1];
      currentTabs[index+1] = currentTabs[index];
      currentTabs[index] = temp;
      saveTabSettings(settingsManager, currentTabs);
      renderTabSettingsUI(settingsManager, container);
      setupTabs(settingsManager, true, { closeDetails: false });
      try { window.dispatchEvent(new CustomEvent('tabsRebuilt')); } catch(e) {}
    };

    btnGroup.appendChild(upBtn);
    btnGroup.appendChild(downBtn);
    row.appendChild(btnGroup);

    const label = document.createElement('label');
    label.className = 'tab-order-label';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = tab.visible !== false;
    chk.onchange = () => {
      if (!chk.checked) {
        const visibleCount = currentTabs.filter(t => t.visible !== false).length;
        if (visibleCount <= 1 && tab.visible !== false) {
          chk.checked = true;
          return;
        }
      }
      tab.visible = chk.checked;
      saveTabSettings(settingsManager, currentTabs);
      renderTabSettingsUI(settingsManager, container);
      setupTabs(settingsManager, true, { closeDetails: false });
      try { window.dispatchEvent(new CustomEvent('tabsRebuilt')); } catch(e) {}
    };

    if (tab.visible !== false) {
       const visibleCount = currentTabs.filter(t => t.visible !== false).length;
       if (visibleCount <= 1) {
         chk.disabled = true;
         chk.title = "最低1つのタブを表示する必要があります";
       }
    }

    const textSpan = document.createElement('span');
    if (tab.labelKey) {
      textSpan.setAttribute('data-i18n', tab.labelKey);
      textSpan.textContent = t(tab.labelKey);
    } else {
      textSpan.textContent = tab.fallbackLabel || tab.id;
    }

    label.appendChild(chk);
    label.appendChild(textSpan);
    row.appendChild(label);

    const dotLabel = document.createElement('label');
    dotLabel.className = 'dot-label';
    const dotChk = document.createElement('input');
    dotChk.type = 'checkbox';
    const isCustomTab = tab.canRemove === true || (tab.id && tab.id.startsWith('channel-'));
    const channelsNoDot = tab.id === 'channels' || isCustomTab;
    if (channelsNoDot) {
      tab.notifyDot = false;
      dotChk.checked = false;
      dotChk.disabled = true;
      dotLabel.classList.add('is-disabled');
      dotLabel.title = t('channel.tab_notify_dot_disabled') || 'チャンネルタブでは通知ドットは使えません';
    } else {
      dotChk.checked = tab.notifyDot !== false;
      dotChk.onchange = () => {
        tab.notifyDot = dotChk.checked;
        saveTabSettings(settingsManager, currentTabs);
      };
    }
    const dotText = document.createElement('span');
    dotText.setAttribute('data-i18n', 'tabNotifyDot');
    dotText.textContent = t('tabNotifyDot');
    dotLabel.appendChild(dotChk);
    dotLabel.appendChild(dotText);
    row.appendChild(dotLabel);

    if (isCustomTab) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '✕';
      removeBtn.className = 'secondary small tab-order-remove-btn';
      removeBtn.title = t('channel.tab_remove_btn') || '削除';
      removeBtn.onclick = () => {
        const rootId = tab.rootId || tab.id.replace('channel-', '');
        const chanName = tab.label || `# ${shortenChannelEventId(rootId)}`;
        const confirmMsg = t('channel.delete_tab_confirm', { name: chanName }) || `「${chanName}」のタブを削除しますか？`;
        const modalTitle = t('channel.tab_remove_title') || 'タブの削除';
        showConfirmModal(modalTitle, confirmMsg, () => {
          removeChannelTab(settingsManager, rootId, { closeDetails: false });
          renderTabSettingsUI(settingsManager, container);
        });
      };
      row.appendChild(removeBtn);
    }

    container.appendChild(row);
  });

  try { if (typeof applyTranslations === 'function') applyTranslations(container); } catch(e){}
}

export function refreshTabSettingsUI(settingsManager) {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('tabSettingsList');
  if (!container) return;
  let sm = settingsManager;
  if (!sm) {
    try {
      if (typeof getSettingsManager === 'function') {
        sm = getSettingsManager();
      }
    } catch (_e) {}
  }
  if (sm && typeof renderTabSettingsUI === 'function') {
    renderTabSettingsUI(sm, container);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('tabsRebuilt', () => {
    refreshTabSettingsUI();
  });
}
