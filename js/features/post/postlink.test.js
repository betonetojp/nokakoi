// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  replyTarget: null,
  quoteMode: false,
  channelTarget: null,
  nip19: {
    neventEncode: vi.fn((data) => `nevent1${data.id}`),
    noteEncode: vi.fn((id) => `note1${id}`),
  },
  settingsManager: {
    get: vi.fn((key) => {
      if (key === 'postLinkBaseUrl') return 'https://lokuyow.github.io/ehagaki/';
      return null;
    }),
    set: vi.fn(),
  },
}));

vi.mock('./composer.js', () => ({
  getReplyTarget: () => mocks.replyTarget,
  getQuoteMode: () => mocks.quoteMode,
  getChannelTarget: () => mocks.channelTarget,
}));

vi.mock('../../core/settings.js', () => ({
  getSettingsManager: () => mocks.settingsManager,
}));

vi.mock('../../core/nostr-compat.js', () => ({
  getNip19: () => mocks.nip19,
}));

vi.mock('../../utils/i18n.js', () => ({
  t: (key) => key,
}));

import {
  setupPostLinkUI,
  openEhagakiWithChannel,
} from './postlink.js';

describe('postlink context aggregation', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="tabs">
        <button class="tab active" data-tab="channels">Channels</button>
      </div>
      <input id="noteInput" value="Hello world" />
      <button id="ehagakiBtn">eHagaki</button>
      <input id="postLinkCustomTitle" value="" />
      <input id="postLinkCustomUrl" value="" />
      <div id="ehagakiModal" hidden>
        <iframe id="ehagakiFrame"></iframe>
      </div>
    `;
    mocks.replyTarget = null;
    mocks.quoteMode = false;
    mocks.channelTarget = null;
  });

  it('initializes postlink without error', () => {
    expect(() => setupPostLinkUI(mocks.settingsManager)).not.toThrow();
  });

  it('opens eHagaki with channel context and preserves existing reply/quote', async () => {
    setupPostLinkUI(mocks.settingsManager);
    mocks.replyTarget = { id: 'msg123', kind: 42, pubkey: 'pk123' };
    mocks.quoteMode = false;

    const channelContext = {
      reference: 'nevent1channel123',
      name: 'Test Channel',
    };

    const result = await openEhagakiWithChannel(channelContext);
    expect(result).toBe(true);

    const iframe = document.getElementById('ehagakiFrame');
    expect(iframe.src).toContain('parentOrigin=');
    expect(iframe.src).toContain('channel=nevent1channel123');
    expect(iframe.src).toContain('channelName=Test+Channel');
    // iframe モーダルでは早期フェッチ失敗防止のため reply/quote は URL から除外される
    expect(iframe.src).not.toContain('reply=');
    expect(iframe.src).not.toContain('quote=');
  });

  it('includes valid Nostr event in preloadedEvents for instant hydration', async () => {
    setupPostLinkUI(mocks.settingsManager);
    const validEvent = {
      id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      pubkey: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      created_at: 1740000000,
      kind: 1,
      tags: [],
      content: 'Hello Nostr',
      sig: 'abcdefabcdefabcdef',
    };
    mocks.replyTarget = validEvent;
    mocks.quoteMode = true;

    const channelContext = {
      reference: 'nevent1channel123',
      name: 'Test Channel',
    };

    const result = await openEhagakiWithChannel(channelContext);
    expect(result).toBe(true);
  });

  it('supports channel context with quoting', async () => {
    setupPostLinkUI(mocks.settingsManager);
    mocks.replyTarget = { id: 'quoteTarget456', kind: 42, pubkey: 'pk456' };
    mocks.quoteMode = true;

    const channelContext = {
      reference: 'nevent1channel123',
      name: 'Test Channel',
    };

    const result = await openEhagakiWithChannel(channelContext);
    expect(result).toBe(true);

    const iframe = document.getElementById('ehagakiFrame');
    expect(iframe.src).toContain('channel=nevent1channel123');
    expect(iframe.src).not.toContain('quote=');
  });

  it('sets embedAccentColor query parameter based on colorTheme and dark mode', async () => {
    mocks.settingsManager.get.mockImplementation((key) => {
      if (key === 'theme') return 'dark';
      if (key === 'colorTheme') return 'pink';
      if (key === 'postLinkBaseUrl') return 'https://lokuyow.github.io/ehagaki/';
      return null;
    });

    setupPostLinkUI(mocks.settingsManager);
    const channelContext = {
      reference: 'nevent1channel123',
      name: 'Test Channel',
    };
    await openEhagakiWithChannel(channelContext);

    const iframe = document.getElementById('ehagakiFrame');
    expect(iframe.src).toContain('embedAccentColor=%23e287b2');
    expect(iframe.src).toContain('embedTheme=dark');
  });

  it('sets embedAccentColor for light mode theme', async () => {
    document.body.classList.add('theme-light');
    mocks.settingsManager.get.mockImplementation((key) => {
      if (key === 'theme') return 'light';
      if (key === 'colorTheme') return 'blue';
      if (key === 'postLinkBaseUrl') return 'https://lokuyow.github.io/ehagaki/';
      return null;
    });

    setupPostLinkUI(mocks.settingsManager);
    const channelContext = {
      reference: 'nevent1channel123',
      name: 'Test Channel',
    };
    await openEhagakiWithChannel(channelContext);

    const iframe = document.getElementById('ehagakiFrame');
    expect(iframe.src).toContain('embedAccentColor=%233b629b');
    expect(iframe.src).toContain('embedTheme=light');
    document.body.classList.remove('theme-light');
  });

  it('handles storage delegation for accentColor and baseColor without error', async () => {
    setupPostLinkUI(mocks.settingsManager);
    const channelContext = {
      reference: 'nevent1channel123',
      name: 'Test Channel',
    };
    await openEhagakiWithChannel(channelContext);

    const iframe = document.getElementById('ehagakiFrame');
    const sentMessages = [];
    const mockContentWindow = {
      postMessage: vi.fn((msg) => {
        sentMessages.push(msg);
      }),
    };
    Object.defineProperty(iframe, 'contentWindow', {
      value: mockContentWindow,
      configurable: true,
      writable: true,
    });

    const expectedOrigin = new URL(iframe.src).origin;

    // Test storage.set
    const setEvent = new MessageEvent('message', {
      origin: expectedOrigin,
      source: mockContentWindow,
      data: {
        namespace: 'ehagaki.embed',
        version: 1,
        type: 'storage.set',
        requestId: 'req-set-1',
        payload: {
          values: {
            accentColor: '#123456',
            baseColor: '#654321',
          },
        },
      },
    });
    window.dispatchEvent(setEvent);

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'storage.result',
      requestId: 'req-set-1',
      payload: expect.objectContaining({
        applied: ['accentColor', 'baseColor'],
      }),
    }));

    // Test storage.get
    const getEvent = new MessageEvent('message', {
      origin: expectedOrigin,
      source: mockContentWindow,
      data: {
        namespace: 'ehagaki.embed',
        version: 1,
        type: 'storage.get',
        requestId: 'req-get-1',
        payload: {
          keys: ['accentColor', 'baseColor'],
        },
      },
    });
    window.dispatchEvent(getEvent);

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'storage.result',
      requestId: 'req-get-1',
      payload: expect.objectContaining({
        values: {
          accentColor: '#123456',
          baseColor: '#654321',
        },
      }),
    }));

    // Test storage.remove
    const removeEvent = new MessageEvent('message', {
      origin: expectedOrigin,
      source: mockContentWindow,
      data: {
        namespace: 'ehagaki.embed',
        version: 1,
        type: 'storage.remove',
        requestId: 'req-remove-1',
        payload: {
          keys: ['accentColor', 'baseColor'],
        },
      },
    });
    window.dispatchEvent(removeEvent);

    expect(sentMessages).toContainEqual(expect.objectContaining({
      type: 'storage.result',
      requestId: 'req-remove-1',
      payload: expect.objectContaining({
        removed: ['accentColor', 'baseColor'],
      }),
    }));
  });
});
