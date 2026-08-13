import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configureAppContext,
  getAppState,
  getBuildInfo,
  getCustomEmojis,
  getRelayConnectionLog,
  getSettingsManager,
  getScrollAnchor,
  installDeprecatedWindowBridges,
  isDebugEnabled,
  isProgrammaticScroll,
  resetAppContextForTests,
  setBuildInfo,
  setCustomEmojis,
  setDebugEnabled,
  setProgrammaticScroll,
  setScrollAnchor,
  updateTabVisibility
} from './app-context.js';
import { extractEmojiTagsFromText } from '../features/emoji/custom-emoji-store.js';

describe('app context', () => {
  beforeEach(() => {
    resetAppContextForTests();
  });

  it('stores shared public references without copying signer secrets', () => {
    const state = { pubkey: 'pub', customEmojis: new Map() };
    const settingsManager = { get: vi.fn() };

    configureAppContext({ state, settingsManager, customEmojis: state.customEmojis });

    expect(getAppState()).toBe(state);
    expect(getSettingsManager()).toBe(settingsManager);
    expect(getCustomEmojis()).toBe(state.customEmojis);
    expect(getAppState()).not.toHaveProperty('sk');
  });

  it('keeps scroll state inside the module API', () => {
    const anchor = { eventId: 'event', top: 12 };
    setScrollAnchor(anchor);
    setProgrammaticScroll(true);

    expect(getScrollAnchor()).toBe(anchor);
    expect(isProgrammaticScroll()).toBe(true);
  });

  it('invokes the injected tab visibility dependency', () => {
    const update = vi.fn();
    configureAppContext({ updateTabVisibility: update });

    updateTabVisibility(true);

    expect(update).toHaveBeenCalledWith(true);
  });

  it('provides custom emojis to leaf utilities without window globals', () => {
    setCustomEmojis(new Map([
      ['wave', [{ url: 'https://example.com/wave.png', address: '' }]]
    ]));

    expect(extractEmojiTagsFromText('hello :wave:')).toEqual([
      ['emoji', 'wave', 'https://example.com/wave.png']
    ]);
  });

  it('keeps deprecated window bridges synchronized in both directions', () => {
    const legacyWindow = {
      __nostrState: { pubkey: 'legacy' },
      __nokakoiDebug: true,
      __relayConnectionLog: [{ action: 'existing' }]
    };

    installDeprecatedWindowBridges(legacyWindow);
    expect(getAppState()).toBe(legacyWindow.__nostrState);
    expect(isDebugEnabled()).toBe(true);
    expect(getRelayConnectionLog()).toHaveLength(1);

    const emojis = new Map([['wave', [{ url: 'https://example.com/wave.png' }]]]);
    setCustomEmojis(emojis);
    setBuildInfo('v1');
    setDebugEnabled(false);

    expect(legacyWindow.__customEmojis).toBe(emojis);
    expect(legacyWindow.__buildInfo).toBe('v1');
    expect(legacyWindow.__nokakoiDebug).toBe(false);

    legacyWindow.__nokakoiScrollAnchor = { eventId: 'next' };
    legacyWindow.__nokakoiProgrammaticScroll = true;
    expect(getScrollAnchor()).toEqual({ eventId: 'next' });
    expect(isProgrammaticScroll()).toBe(true);
    expect(getBuildInfo()).toBe('v1');
  });
});
