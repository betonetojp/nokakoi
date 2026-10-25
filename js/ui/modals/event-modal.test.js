// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openChannelFromExternal: vi.fn(),
}));

vi.mock('../../utils/i18n.js', () => ({
  t: (key, params) => {
    if (params && typeof params === 'object') {
      return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), key);
    }
    return key;
  },
}));

vi.mock('../../features/channel/channel-ui.js', () => ({
  openChannelFromExternal: mocks.openChannelFromExternal,
}));

import { showEventModal } from './event-modal.js';

describe('showEventModal for kind:40 and kind:30030', () => {
  let modal;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="eventModal" hidden>
        <button id="eventModalClose"></button>
        <div id="eventModalAuthorWrap"></div>
        <div id="eventModalReactWrap"></div>
        <div id="eventModalContent"></div>
        <span id="eventModalTime"></span>
        <button id="eventModalKind"></button>
        <button id="eventModalCopyNevent" class="d-none"></button>
        <div id="eventModalActionsBottom"></div>
      </div>
    `;
    modal = document.getElementById('eventModal');
  });

  it('renders kind:40 channel creation event as channel card with open button', async () => {
    const event = {
      id: 'channel-root-id-40',
      pubkey: '1111111111111111111111111111111111111111111111111111111111111111',
      kind: 40,
      created_at: 1700000000,
      content: JSON.stringify({
        name: '雑談チャンネル',
        about: 'みんなで雑談する部屋です',
        picture: 'https://example.com/channel.png'
      }),
      tags: []
    };

    const state = { profiles: new Map() };
    showEventModal(event, state, {}, null, null, null, {}, {});

    // Wait for dynamic import
    await vi.waitFor(() => {
      const card = modal.querySelector('.channel-quote');
      expect(card).not.toBeNull();
    });

    const contentEl = modal.querySelector('#eventModalContent');
    expect(contentEl.textContent).toContain('雑談チャンネル');
    expect(contentEl.textContent).toContain('みんなで雑談する部屋です');
    expect(contentEl.querySelector('.channel-quote-picture').getAttribute('src')).toBe('https://example.com/channel.png');

    const openBtn = contentEl.querySelector('.channel-quote-open-btn');
    expect(openBtn).not.toBeNull();

    // Clicking open button should close modal and call openChannelFromExternal
    expect(modal.hidden).toBe(false);
    openBtn.click();
    expect(modal.hidden).toBe(true);
    await vi.waitFor(() => {
      expect(mocks.openChannelFromExternal).toHaveBeenCalledWith('channel-root-id-40', state);
    });
  });

  it('renders kind:41 metadata event resolving rootId from e tag', async () => {
    const event = {
      id: 'channel-meta-id-41',
      pubkey: '1111111111111111111111111111111111111111111111111111111111111111',
      kind: 41,
      created_at: 1700000000,
      content: JSON.stringify({
        name: '更新された雑談部屋',
        about: '更新された説明文'
      }),
      tags: [['e', 'original-channel-root-40']]
    };

    const state = { profiles: new Map() };
    showEventModal(event, state, {}, null, null, null, {}, {});

    await vi.waitFor(() => {
      const card = modal.querySelector('.channel-quote');
      expect(card).not.toBeNull();
    });

    const contentEl = modal.querySelector('#eventModalContent');
    expect(contentEl.textContent).toContain('更新された雑談部屋');

    const openBtn = contentEl.querySelector('.channel-quote-open-btn');
    openBtn.click();
    await vi.waitFor(() => {
      expect(mocks.openChannelFromExternal).toHaveBeenCalledWith('original-channel-root-40', state);
    });
  });

  it('renders kind:30030 emoji pack as emoji pack card', async () => {
    const event = {
      id: 'emoji-pack-id',
      pubkey: '1111111111111111111111111111111111111111111111111111111111111111',
      kind: 30030,
      created_at: 1700000000,
      content: '',
      tags: [
        ['d', 'cat-emojis'],
        ['title', 'Cute Cats'],
        ['emoji', 'cat_happy', 'https://example.com/cat_happy.png']
      ]
    };

    const state = { profiles: new Map() };
    showEventModal(event, state, {}, null, null, null, {}, {});

    await vi.waitFor(() => {
      const card = modal.querySelector('.emoji-pack-quote');
      expect(card).not.toBeNull();
    });

    const contentEl = modal.querySelector('#eventModalContent');
    expect(contentEl.textContent).toContain('Cute Cats');
    expect(contentEl.querySelector('.emoji-pack-item img').getAttribute('src')).toBe('https://example.com/cat_happy.png');
  });

  it('renders kind:30023 article with markdown and replaces custom emojis', async () => {
    const event = {
      id: 'article-id-1',
      pubkey: '1111111111111111111111111111111111111111111111111111111111111111',
      kind: 30023,
      created_at: 1700000000,
      content: '### :nan: 見出し\n\n- リスト:nan:\n\n![sample](https://example.com/sample.png)',
      tags: [
        ['d', 'test-article'],
        ['title', 'テスト記事'],
        ['emoji', 'nan', 'https://example.com/nan.png']
      ]
    };

    const state = { profiles: new Map() };
    showEventModal(event, state, {}, null, null, null, {}, {});

    const contentEl = modal.querySelector('#eventModalContent');
    await vi.waitFor(() => {
      const customEmoji = contentEl.querySelector('img.custom-emoji');
      expect(customEmoji).not.toBeNull();
    });

    expect(contentEl.querySelector('h3')).not.toBeNull();
    expect(contentEl.querySelector('ul')).not.toBeNull();
    const customEmojis = contentEl.querySelectorAll('img.custom-emoji');
    expect(customEmojis.length).toBeGreaterThanOrEqual(2);
    expect(customEmojis[0].getAttribute('src')).toBe('https://example.com/nan.png');

    const inlineImg = contentEl.querySelector('img:not(.custom-emoji)');
    expect(inlineImg).not.toBeNull();
    expect(inlineImg.getAttribute('src')).toBe('https://example.com/sample.png');
  });

  it('renders language flag badge next to kind button for Japanese event and cleans up on next event', () => {
    const jaEvent = {
      id: 'ja-event-1',
      pubkey: '1111111111111111111111111111111111111111111111111111111111111111',
      kind: 1,
      created_at: 1700000000,
      content: 'こんにちは、世界！今日も良い天気ですね。',
      tags: []
    };
    const state = { profiles: new Map() };
    showEventModal(jaEvent, state, {}, null, null, null, {}, {});

    const flagBadge = modal.querySelector('.lang-flag-badge');
    expect(flagBadge).not.toBeNull();
    expect(flagBadge.textContent).toBe('🇯🇵');
    expect(flagBadge.title).toBe('jpn');

    // Opening another event (English) cleans up the old badge and sets new one
    const enEvent = {
      id: 'en-event-1',
      pubkey: '1111111111111111111111111111111111111111111111111111111111111111',
      kind: 1,
      created_at: 1700000000,
      content: 'Hello world, this is a wonderful sunny day with english words.',
      tags: []
    };
    showEventModal(enEvent, state, {}, null, null, null, {}, {});

    const allBadges = modal.querySelectorAll('.lang-flag-badge');
    expect(allBadges.length).toBe(1);
    expect(allBadges[0].textContent).toBe('🇺🇸');
    expect(allBadges[0].title).toBe('eng');
  });

  it('aborts previous modal listeners on reopen and on close so listeners never stack', () => {
    const state = { profiles: new Map() };
    const ev1 = { id: 'ev-1', pubkey: '1'.repeat(64), kind: 1, created_at: 1700000000, content: 'one', tags: [] };
    const ev2 = { id: 'ev-2', pubkey: '1'.repeat(64), kind: 1, created_at: 1700000001, content: 'two', tags: [] };

    showEventModal(ev1, state, {}, null, null, null, {}, {});
    const firstController = modal._eventModalAbortController;
    expect(firstController).toBeTruthy();
    expect(firstController.signal.aborted).toBe(false);

    showEventModal(ev2, state, {}, null, null, null, {}, {});
    expect(firstController.signal.aborted).toBe(true);
    const secondController = modal._eventModalAbortController;
    expect(secondController.signal.aborted).toBe(false);

    document.getElementById('eventModalClose').click();
    expect(secondController.signal.aborted).toBe(true);
    expect(modal.hidden).toBe(true);
  });
});
