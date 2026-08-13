// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calls: [],
  clearReplyTarget: vi.fn(),
  initChannelView: vi.fn(),
  pauseChannelSubscriptions: vi.fn(() => mocks.calls.push('pause')),
  resumeChannelSubscriptions: vi.fn(() => mocks.calls.push('resume')),
  syncChannelComposerState: vi.fn(() => mocks.calls.push('sync')),
}));

vi.mock('../../utils/i18n.js', () => ({ t: key => key, applyTranslations: vi.fn() }));
vi.mock('../modals/modals.js', () => ({ showOmochatSettingsModal: vi.fn() }));
vi.mock('../../features/post/composer.js', () => ({ clearReplyTarget: mocks.clearReplyTarget }));
vi.mock('../../features/relay/global-relay.js', () => ({ updateGlobalButtonLabel: vi.fn() }));
vi.mock('./mention-blink.js', () => ({ setMentionBlink: vi.fn() }));
vi.mock('./display-settings.js', () => ({ showHomeDisplayQuickModal: vi.fn() }));
vi.mock('../../core/app-context.js', () => ({
  getAppState: vi.fn(() => ({})),
  setRelayInspector: vi.fn()
}));
vi.mock('../../features/channel/channel-ui.js', () => ({
  initChannelView: mocks.initChannelView,
  pauseChannelSubscriptions: mocks.pauseChannelSubscriptions,
  resumeChannelSubscriptions: mocks.resumeChannelSubscriptions,
  syncChannelComposerState: mocks.syncChannelComposerState,
}));

import { setupTabs } from './tab-manager.js';

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
});
