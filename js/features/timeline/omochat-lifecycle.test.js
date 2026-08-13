import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getClosestRelays } = vi.hoisted(() => ({ getClosestRelays: vi.fn() }));

vi.mock('../relay/geo-relay-directory.js', () => ({ getClosestRelays }));

const {
  refreshClosestOmochatRelays,
  shouldConnectOmochatOnBoot,
  shouldLoadOmochatHistory
} = await import('./omochat-lifecycle.js');

function createSettings(values = {}) {
  return {
    get: vi.fn((key) => values[key]),
    set: vi.fn()
  };
}

describe('omochat lifecycle', () => {
  beforeEach(() => {
    getClosestRelays.mockReset();
  });

  it('connects live without history when the tab is visible but inactive and home is off', () => {
    const doc = { querySelector: vi.fn(() => ({ dataset: { tab: 'global' } })) };
    const settings = createSettings({ showOmochat: true, showHomeOmochat: false });

    expect(shouldConnectOmochatOnBoot(settings, doc)).toBe(true);
    expect(shouldLoadOmochatHistory(settings, doc)).toBe(false);
  });

  it('loads history when omochat is enabled on home', () => {
    const doc = { querySelector: vi.fn(() => ({ dataset: { tab: 'global' } })) };
    const settings = createSettings({ showOmochat: true, showHomeOmochat: true });

    expect(shouldConnectOmochatOnBoot(settings, doc)).toBe(true);
    expect(shouldLoadOmochatHistory(settings, doc)).toBe(true);
  });

  it('loads history when bitchat is active', () => {
    const doc = {
      querySelector: vi.fn(() => ({ dataset: { tab: 'bitchat' } }))
    };
    const settings = createSettings({ showOmochat: true, showHomeOmochat: false });

    expect(shouldConnectOmochatOnBoot(settings, doc)).toBe(true);
    expect(shouldLoadOmochatHistory(settings, doc)).toBe(true);
  });

  it('skips disabled inactive omochat', () => {
    const doc = { querySelector: vi.fn(() => ({ dataset: { tab: 'home' } })) };
    expect(shouldConnectOmochatOnBoot(createSettings({ showOmochat: false }), doc)).toBe(false);
  });

  it('updates computed relays through the shared implementation', async () => {
    const settings = createSettings({
      omochatGeohash: 'xn7',
      omochatAutoRelayAlgo: 'ios',
      omochatMergeParent: true
    });
    getClosestRelays.mockResolvedValue(['wss://relay.example']);

    await expect(refreshClosestOmochatRelays(settings)).resolves.toBe(true);
    expect(getClosestRelays).toHaveBeenCalledWith('xn7', 5, 'ios', true);
    expect(settings.set).toHaveBeenCalledWith('omochatComputedRelays', ['wss://relay.example']);
  });

  it('does not fetch relays when automatic selection is disabled', async () => {
    const settings = createSettings({ omochatAutoRelays: false });
    await expect(refreshClosestOmochatRelays(settings)).resolves.toBe(false);
    expect(getClosestRelays).not.toHaveBeenCalled();
  });
});
