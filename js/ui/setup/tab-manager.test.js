// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calls: [],
  clearReplyTarget: vi.fn(),
  initChannelView: vi.fn(),
  pauseChannelSubscriptions: vi.fn(() => mocks.calls.push('pause')),
  resumeChannelSubscriptions: vi.fn(() => mocks.calls.push('resume')),
  syncChannelComposerState: vi.fn(() => mocks.calls.push('sync')),
  subscribeChannelFeed: vi.fn(),
  unsubscribeAllChannelFeeds: vi.fn(() => mocks.calls.push('unsubscribeChannel')),
}));

vi.mock('../../utils/i18n.js', () => ({ t: key => key, applyTranslations: vi.fn() }));
vi.mock('../modals/modals.js', () => ({ showOmochatSettingsModal: vi.fn() }));
vi.mock('../../features/post/composer.js', () => ({ clearReplyTarget: mocks.clearReplyTarget }));
vi.mock('../../features/relay/global-relay.js', () => ({ updateGlobalButtonLabel: vi.fn() }));
vi.mock('./mention-blink.js', () => ({ setMentionBlink: vi.fn() }));
vi.mock('./display-settings.js', () => ({ showHomeDisplayQuickModal: vi.fn() }));
vi.mock('../../core/app-context.js', () => ({
  getAppState: vi.fn(() => ({})),
  getSettingsManager: vi.fn(() => null),
  setRelayInspector: vi.fn()
}));
vi.mock('../../features/channel/channel-ui.js', () => ({
  initChannelView: mocks.initChannelView,
  pauseChannelSubscriptions: mocks.pauseChannelSubscriptions,
  resumeChannelSubscriptions: mocks.resumeChannelSubscriptions,
  syncChannelComposerState: mocks.syncChannelComposerState,
}));

vi.mock('../../features/channel/channel-feed.js', () => ({
  subscribeChannelFeed: mocks.subscribeChannelFeed,
  unsubscribeAllChannelFeeds: mocks.unsubscribeAllChannelFeeds,
}));
vi.mock('../../features/channel/channel.js', () => ({
  shortenChannelEventId: vi.fn(id => String(id).slice(0, 8)),
  fetchChannelMetadata: vi.fn().mockResolvedValue({ label: 'TestChannel' }),
}));

import { setupTabs, activateTab, ensureTabVisible, addChannelTab, removeChannelTab, isChannelTabPinned, renderTabSettingsUI } from './tab-manager.js';

function settingsManagerFor(ids) {
  return {
    settings: {},
    get: vi.fn(key => key === 'tabs_v2'
      ? ids.map(id => ({ id, visible: true, notifyDot: id !== 'channels' }))
      : null),
    set: vi.fn(),
  };
}

describe('channel tab activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls.length = 0;
    document.body.innerHTML = `
      <div class="tabs"></div>
      <div id="feed-home" class="feed"></div>
      <div id="feed-channels" class="feed"></div>
    `;
    window.scrollTo = vi.fn();
  });

  it('resumes before async composer sync when returning to a channel', async () => {
    setupTabs(settingsManagerFor(['home', 'channels']));
    document.querySelector('.tab[data-tab="channels"]').click();
    await vi.waitFor(() => expect(mocks.resumeChannelSubscriptions).toHaveBeenCalledTimes(1));
    document.querySelector('.tab[data-tab="home"]').click();
    await vi.waitFor(() => expect(mocks.pauseChannelSubscriptions).toHaveBeenCalled());

    mocks.calls.length = 0;
    document.querySelector('.tab[data-tab="channels"]').click();
    await vi.waitFor(() => expect(mocks.resumeChannelSubscriptions).toHaveBeenCalledTimes(2));

    expect(mocks.calls).toEqual(['resume', 'sync']);
    expect(mocks.resumeChannelSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('resumes before syncing when channels is initially active', async () => {
    setupTabs(settingsManagerFor(['channels', 'home']));
    await vi.waitFor(() => expect(mocks.resumeChannelSubscriptions).toHaveBeenCalledTimes(1));

    expect(mocks.calls).toEqual(['resume', 'sync']);
    expect(mocks.resumeChannelSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('selects the first visible configured tab through the tab lifecycle', async () => {
    document.body.innerHTML = `
      <div class="tabs"><button class="tab active" data-tab="bitchat"></button></div>
      <div id="feed-bitchat" class="feed active"></div>
      <div id="feed-mentions" class="feed"></div>
      <div id="feed-global" class="feed"></div>
      <button id="ehagakiBtn" class="d-none"></button>
    `;
    const changed = vi.fn();
    window.addEventListener('tab:changed', changed, { once: true });
    const settingsManager = {
      settings: {},
      get: vi.fn(key => key === 'tabs_v2' ? [
        { id: 'mentions', visible: false },
        { id: 'global', visible: true },
        { id: 'home', visible: true }
      ] : null),
      set: vi.fn()
    };

    setupTabs(settingsManager, false);
    await vi.waitFor(() => expect(mocks.pauseChannelSubscriptions).toHaveBeenCalled());

    expect(document.querySelector('.tab.active')?.dataset.tab).toBe('global');
    expect(document.querySelector('.feed.active')?.id).toBe('feed-global');
    expect(document.getElementById('ehagakiBtn').classList.contains('d-none')).toBe(false);
    expect(mocks.clearReplyTarget).toHaveBeenCalled();
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({
      detail: { tab: 'global' }
    }));
  });

  it('preserves the active tab during normal settings rebuilds', () => {
    const settingsManager = settingsManagerFor(['home', 'channels']);
    setupTabs(settingsManager);
    document.querySelector('.tab[data-tab="channels"]').click();

    setupTabs(settingsManager, true);

    expect(document.querySelector('.tab.active')?.dataset.tab).toBe('channels');
    expect(document.querySelector('.feed.active')?.id).toBe('feed-channels');
  });

  it('renders tab buttons into a horizontal scroller', () => {
    setupTabs(settingsManagerFor(['home', 'channels']));
    const scroller = document.querySelector('.tabs > .tabs-scroller');
    expect(scroller).toBeTruthy();
    expect(scroller.querySelectorAll('.tab').length).toBe(2);
    expect(document.querySelector('.tabs > .tab')).toBeNull();
  });

  it('marks only the account-switch initial activation to skip feed lifecycle', () => {
    document.body.innerHTML = `
      <div class="tabs"></div>
      <div id="feed-global" class="feed"></div>
      <div id="feed-bitchat" class="feed"></div>
    `;
    const details = [];
    const listener = event => details.push(event.detail);
    window.addEventListener('tab:changed', listener);
    const settingsManager = settingsManagerFor(['global', 'bitchat']);

    setupTabs(settingsManager, false, {
      skipFeedLifecycle: true,
      eventDetail: {
        accountSwitchInitial: true,
        skipFeedLifecycle: true
      }
    });
    document.querySelector('.tab[data-tab="bitchat"]').click();
    window.removeEventListener('tab:changed', listener);

    expect(details).toEqual([
      {
        accountSwitchInitial: true,
        skipFeedLifecycle: true,
        tab: 'global'
      },
      { tab: 'bitchat' }
    ]);
  });

  it('automatically enables and activates a hidden tab when requested by id', async () => {
    let savedTabs = null;
    const settingsManager = {
      settings: {},
      get: vi.fn(key => key === 'tabs_v2' ? (savedTabs || [
        { id: 'home', visible: true },
        { id: 'channels', visible: false }
      ]) : null),
      set: vi.fn((key, val) => {
        if (key === 'tabs_v2') savedTabs = val;
      })
    };

    setupTabs(settingsManager);
    expect(document.querySelector('.tab[data-tab="channels"]')).toBeNull();

    const success = activateTab('channels', settingsManager);
    expect(success).toBe(true);

    const channelTab = document.querySelector('.tab[data-tab="channels"]');
    expect(channelTab).not.toBeNull();
    expect(channelTab?.classList.contains('active')).toBe(true);
    expect(document.querySelector('#feed-channels')?.classList.contains('active')).toBe(true);
    expect(settingsManager.set).toHaveBeenCalledWith(
      'tabs_v2',
      expect.arrayContaining([expect.objectContaining({ id: 'channels', visible: true })])

    );
  });

  it('adds, activates, and removes a pinned channel tab dynamically', async () => {
    let savedTabs = [
      { id: 'home', visible: true },
      { id: 'channels', visible: true }
    ];
    const settingsManager = {
      settings: {},
      get: vi.fn(key => key === 'tabs_v2' ? savedTabs : null),
      set: vi.fn((key, val) => {
        if (key === 'tabs_v2') savedTabs = val;
      })
    };

    setupTabs(settingsManager);
    expect(isChannelTabPinned(settingsManager, 'root123')).toBe(false);

    addChannelTab(settingsManager, { rootId: 'root123', name: 'Nostr日本語' });
    expect(isChannelTabPinned(settingsManager, 'root123')).toBe(true);

    const channelTabBtn = document.querySelector('.tab[data-tab="channel-root123"]');
    expect(channelTabBtn).not.toBeNull();
    expect(channelTabBtn.textContent).toBe('# Nostr日本語');
    expect(channelTabBtn.classList.contains('active')).toBe(true);

    const dynamicFeed = document.getElementById('feed-channel-root123');
    expect(dynamicFeed).not.toBeNull();
    expect(dynamicFeed.classList.contains('active')).toBe(true);
    expect(mocks.subscribeChannelFeed).toHaveBeenCalledWith(
      'root123',
      expect.anything(),
      dynamicFeed,
      settingsManager,
      expect.objectContaining({ resume: true })
    );


    document.querySelector('.tab[data-tab="home"]').click();
    expect(mocks.unsubscribeAllChannelFeeds).toHaveBeenCalled();

    removeChannelTab(settingsManager, 'root123');
    expect(isChannelTabPinned(settingsManager, 'root123')).toBe(false);
    expect(document.querySelector('.tab[data-tab="channel-root123"]')).toBeNull();
    expect(document.getElementById('feed-channel-root123')).toBeNull();
  });

  it('renders custom channel tab with remove button in tab settings UI', async () => {
    let savedTabs = [
      { id: 'home', visible: true },
      { id: 'channel-test1', type: 'channel', rootId: 'test1', label: '# 雑談', canRemove: true, visible: true }
    ];
    const settingsManager = {
      settings: {},
      get: vi.fn(key => key === 'tabs_v2' ? savedTabs : null),
      set: vi.fn((key, val) => {
        if (key === 'tabs_v2') savedTabs = val;
      })
    };

    const container = document.createElement('div');
    renderTabSettingsUI(settingsManager, container);

    const removeBtn = container.querySelector('.tab-order-remove-btn');
    expect(removeBtn).not.toBeNull();
    expect(removeBtn.textContent).toBe('✕');
  });

  it('preserves open details when reordering or removing tabs in settings UI', async () => {
    let savedTabs = [
      { id: 'home', visible: true },
      { id: 'global', visible: true },
      { id: 'channel-test1', type: 'channel', rootId: 'test1', label: '# 雑談', canRemove: true, visible: true }
    ];
    const settingsManager = {
      settings: {},
      get: vi.fn(key => key === 'tabs_v2' ? savedTabs : null),
      set: vi.fn((key, val) => {
        if (key === 'tabs_v2') savedTabs = val;
      })
    };

    setupTabs(settingsManager);

    // 開いている details パネルを配置
    const details = document.createElement('details');
    details.open = true;
    document.body.appendChild(details);

    const container = document.createElement('div');
    renderTabSettingsUI(settingsManager, container);

    // 並び替え (downBtn)
    const downBtns = container.querySelectorAll('.tab-order-arrow-btn');
    const firstDownBtn = downBtns[1]; // homeのdownボタン
    firstDownBtn.click();

    expect(details.open).toBe(true);

    // 削除 (removeChannelTab with closeDetails: false)
    removeChannelTab(settingsManager, 'test1', { closeDetails: false });
    expect(details.open).toBe(true);

    details.remove();

  });
});

