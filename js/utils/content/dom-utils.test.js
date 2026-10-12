// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../i18n.js', () => ({
  t: (key, params) => {
    if (params && typeof params === 'object') {
      return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), key === 'quote.label' ? '{author}' : key);
    }
    return key;
  },
  initI18n: () => Promise.resolve(),
  applyTranslations: () => Promise.resolve(),
}));

import { updateNostrNpubLinks } from './dom-utils.js';

describe('updateNostrNpubLinks', () => {
  beforeEach(() => {
    delete window.__nostrState;
  });

  it('updates npub link with petname when available', async () => {
    window.__nostrState = {
      profiles: new Map([['pk1', { display_name: 'Alice' }]]),
      followPetnames: new Map([['pk1', 'お気に入り']])
    };

    const container = document.createElement('div');
    container.innerHTML = '<a class="nostr-link nostr-npub name" data-pubkey="pk1">@npub1...</a>';

    await updateNostrNpubLinks(container);

    expect(container.innerHTML).toContain('petname-badge');
    expect(container.innerHTML).toContain('お気に入り');
  });

  it('updates npub link with profile display_name when no petname', async () => {
    window.__nostrState = {
      profiles: new Map([['pk2', { display_name: 'Bob' }]]),
      followPetnames: new Map()
    };

    const container = document.createElement('div');
    container.innerHTML = '<a class="nostr-link nostr-npub name" data-pubkey="pk2">@npub1...</a>';

    await updateNostrNpubLinks(container);

    expect(container.textContent).toBe('@Bob');
  });
});

import { renderChannelQuote, renderEmojiPackQuote, resolveAndRenderQuote } from './dom-utils.js';

describe('renderChannelQuote', () => {
  it('renders kind:40 channel creation event as channel quote card', async () => {
    const ev = {
      id: 'channel-root-id',
      pubkey: 'creator-pk',
      kind: 40,
      content: JSON.stringify({
        name: '開発チャンネル',
        about: 'Nokakoi開発の部屋です',
        picture: 'https://example.com/icon.png'
      }),
      tags: []
    };

    const html = await renderChannelQuote({ profiles: new Map() }, ev, {});
    expect(html).toContain('channel-quote');
    expect(html).toContain('開発チャンネル');
    expect(html).toContain('Nokakoi開発の部屋です');
    expect(html).toContain('https://example.com/icon.png');
    expect(html).toContain('data-channel-id="channel-root-id"');
    expect(html).toContain('channel-quote-open-btn');
  });

  it('renders kind:41 metadata event resolving rootId from e tag', async () => {
    const ev = {
      id: 'meta-event-id',
      pubkey: 'creator-pk',
      kind: 41,
      content: JSON.stringify({
        name: '更新された部屋名',
        about: '更新された説明文'
      }),
      tags: [['e', 'original-root-id']]
    };

    const html = await renderChannelQuote({ profiles: new Map() }, ev, {});
    expect(html).toContain('channel-quote');
    expect(html).toContain('更新された部屋名');
    expect(html).toContain('data-channel-id="original-root-id"');
  });
});

describe('renderEmojiPackQuote', () => {
  it('renders kind:30030 custom emoji pack event with emoji grid', async () => {
    const ev = {
      id: 'emoji-pack-id',
      pubkey: 'author-pk',
      kind: 30030,
      content: '',
      tags: [
        ['d', 'pepe-pack'],
        ['title', 'Pepe Stickers'],
        ['description', 'Cute frog stickers'],
        ['emoji', 'pepe_smile', 'https://example.com/pepe_smile.png'],
        ['emoji', 'pepe_cry', 'https://example.com/pepe_cry.png']
      ]
    };

    const html = await renderEmojiPackQuote({ profiles: new Map() }, ev, {});
    expect(html).toContain('emoji-pack-quote');
    expect(html).toContain('Pepe Stickers');
    expect(html).toContain('Cute frog stickers');
    expect(html).toContain('https://example.com/pepe_smile.png');
    expect(html).toContain(':pepe_smile:');
    expect(html).toContain('https://example.com/pepe_cry.png');
    expect(html).toContain(':pepe_cry:');
  });
});

describe('resolveAndRenderQuote kind routing', () => {
  it('renders kind:20000 omochat as event-quote card', async () => {
    const container = document.createElement('div');
    const quoteEl = document.createElement('span');
    quoteEl.className = 'nostr-quote';
    quoteEl.dataset.eventId = 'omochat-ev-1';
    container.appendChild(quoteEl);

    const state = {
      eventCache: new Map([
        ['omochat-ev-1', {
          id: 'omochat-ev-1',
          pubkey: '1234567890abcdef',
          kind: 20000,
          content: 'こんにちはオモチャット',
          tags: [['n', '名無し']]
        }]
      ]),
      profiles: new Map()
    };

    const result = await resolveAndRenderQuote(quoteEl, container, null, state, {}, null, null, null, {}, {}, 0, 2);
    expect(result).toBe(true);
    const quoteDiv = container.querySelector('.event-quote');
    expect(quoteDiv).not.toBeNull();
    expect(quoteDiv.textContent).toContain('こんにちはオモチャット');
    expect(quoteDiv.textContent).toContain('名無し');
  });

  it('renders kind:40 as channel-quote card and binds open button', async () => {
    const container = document.createElement('div');
    const quoteEl = document.createElement('span');
    quoteEl.className = 'nostr-quote';
    quoteEl.dataset.eventId = 'chan-ev-1';
    container.appendChild(quoteEl);

    const state = {
      eventCache: new Map([
        ['chan-ev-1', {
          id: 'chan-ev-1',
          pubkey: 'pk1',
          kind: 40,
          content: JSON.stringify({ name: 'テスト部屋' }),
          tags: []
        }]
      ]),
      profiles: new Map()
    };

    const result = await resolveAndRenderQuote(quoteEl, container, null, state, {}, null, null, null, {}, {}, 0, 2);
    expect(result).toBe(true);
    const card = container.querySelector('.channel-quote');
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('テスト部屋');
    expect(card.querySelector('.channel-quote-open-btn')).not.toBeNull();
  });

  it('renders kind:30030 as emoji-pack-quote card', async () => {
    const container = document.createElement('div');
    const quoteEl = document.createElement('span');
    quoteEl.className = 'nostr-quote';
    quoteEl.dataset.eventId = 'emoji-ev-1';
    container.appendChild(quoteEl);

    const state = {
      eventCache: new Map([
        ['emoji-ev-1', {
          id: 'emoji-ev-1',
          pubkey: 'pk1',
          kind: 30030,
          content: '',
          tags: [
            ['title', 'Gyouza Set'],
            ['emoji', 'gyouza', 'https://example.com/gyouza.png']
          ]
        }]
      ]),
      profiles: new Map()
    };

    const result = await resolveAndRenderQuote(quoteEl, container, null, state, {}, null, null, null, {}, {}, 0, 2);
    expect(result).toBe(true);
    const card = container.querySelector('.emoji-pack-quote');
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('Gyouza Set');
    expect(card.querySelector('.emoji-pack-item img').getAttribute('src')).toBe('https://example.com/gyouza.png');
  });
});
