import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ refreshClosestOmochatRelays: vi.fn() }));

vi.mock('../features/timeline/omochat-lifecycle.js', () => ({
  refreshClosestOmochatRelays: mocks.refreshClosestOmochatRelays
}));

import {
  refreshOmochatRelaysOnBoot,
  setupOmochatSettingsListener,
  setupOmochatTabListener
} from './omochat.js';

function createSettings(values) {
  return {
    get: vi.fn((key) => values[key])
  };
}

describe('omochat boot updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes only bitchat when computed relays change on boot', async () => {
    const values = {
      omochatAutoRelays: true,
      omochatComputedRelays: ['wss://old.example']
    };
    const settings = createSettings(values);
    const setupBitchatFeed = vi.fn();
    globalThis.window = { softReload: vi.fn() };
    mocks.refreshClosestOmochatRelays.mockImplementation(async () => {
      values.omochatComputedRelays = ['wss://new.example'];
      return true;
    });

    await expect(refreshOmochatRelaysOnBoot(settings, setupBitchatFeed)).resolves.toBe(true);
    expect(setupBitchatFeed).toHaveBeenCalledTimes(1);
    expect(window.softReload).not.toHaveBeenCalled();
  });

  it('routes saved settings to bitchat without a full reload', async () => {
    let listener;
    const values = { omochatAutoRelays: false };
    const setupBitchatFeed = vi.fn();
    globalThis.window = {
      addEventListener: vi.fn((_name, callback) => { listener = callback; }),
      softReload: vi.fn(),
      dispatchEvent: vi.fn()
    };

    setupOmochatSettingsListener({
      state: {},
      settingsManager: createSettings(values),
      setupTabs: vi.fn(),
      setupGlobalTabSelector: vi.fn(),
      clearGlobalFeed: vi.fn(),
      updateGlobalButtonLabel: vi.fn(),
      showToast: vi.fn(),
      t: vi.fn((key) => key),
      setupBitchatFeed
    });
    await listener();

    expect(setupBitchatFeed).toHaveBeenCalledTimes(1);
    expect(window.softReload).not.toHaveBeenCalled();
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it('requests full history when bitchat opens even with a live-only fetcher', () => {
    let tabListener;
    const setupBitchatFeed = vi.fn();
    const state = { _bitchatFetcher: { __configKey: 'live-only' } };
    globalThis.document = {
      querySelector: vi.fn(() => ({ dataset: { tab: 'global' } }))
    };
    globalThis.window = {
      addEventListener: vi.fn((name, callback) => {
        if (name === 'tab:changed') tabListener = callback;
      })
    };

    setupOmochatTabListener(state, {
      handleTabChange: vi.fn(),
      setupBitchatFeed
    });
    tabListener({ detail: { tab: 'bitchat' } });
    tabListener({ detail: { tab: 'bitchat' } });

    expect(setupBitchatFeed).toHaveBeenCalledTimes(2);
    expect(setupBitchatFeed).toHaveBeenNthCalledWith(1, { mode: 'full' });
    expect(setupBitchatFeed).toHaveBeenNthCalledWith(2, { mode: 'full' });
  });

  it('uses account-switch initial activation only as the next click baseline', () => {
    let tabListener;
    const handleTabChange = vi.fn();
    const setupBitchatFeed = vi.fn();
    globalThis.document = {
      querySelector: vi.fn(() => ({ dataset: { tab: 'global' } }))
    };
    globalThis.window = {
      addEventListener: vi.fn((name, callback) => {
        if (name === 'tab:changed') tabListener = callback;
      })
    };

    setupOmochatTabListener({}, { handleTabChange, setupBitchatFeed });
    tabListener({
      detail: {
        tab: 'global',
        accountSwitchInitial: true,
        skipFeedLifecycle: true
      }
    });

    expect(handleTabChange).not.toHaveBeenCalled();
    expect(setupBitchatFeed).not.toHaveBeenCalled();

    tabListener({ detail: { tab: 'bitchat' } });

    expect(handleTabChange).toHaveBeenCalledWith('global', 'bitchat');
    expect(setupBitchatFeed).toHaveBeenCalledTimes(1);
    expect(setupBitchatFeed).toHaveBeenCalledWith({ mode: 'full' });
  });
});
