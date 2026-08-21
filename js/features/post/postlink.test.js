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
});
