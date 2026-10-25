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

import { resetAppContextForTests } from '../../core/app-context.js';
import { updateNostrNpubLinks, renderChannelQuote, renderEmojiPackQuote, renderArticleQuote, resolveAndRenderQuote, fitCustomEmoji } from './dom-utils.js';

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
    expect(html).toContain('チャンネル');
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

  it('renders kind:30023 as article-quote card', async () => {
    const container = document.createElement('div');
    const quoteEl = document.createElement('span');
    quoteEl.className = 'nostr-quote';
    quoteEl.dataset.eventId = 'article-ev-1';
    container.appendChild(quoteEl);

    const state = {
      eventCache: new Map([
        ['article-ev-1', {
          id: 'article-ev-1',
          pubkey: 'pk1',
          kind: 30023,
          content: '# はじめに\n\nNostrについての記事です。',
          tags: [
            ['title', 'Nostr入門ガイド'],
            ['summary', 'Nostrの基礎をわかりやすく解説します。'],
            ['image', 'https://example.com/cover.png']
          ]
        }]
      ]),
      profiles: new Map()
    };

    const result = await resolveAndRenderQuote(quoteEl, container, null, state, {}, null, null, null, {}, {}, 0, 2);
    expect(result).toBe(true);
    const card = container.querySelector('.article-quote');
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('Nostr入門ガイド');
    expect(card.textContent).toContain('Nostrの基礎をわかりやすく解説します。');
    expect(card.querySelector('.article-quote-image').getAttribute('src')).toBe('https://example.com/cover.png');
  });
});

describe('renderArticleQuote', () => {
  it('renders kind:30023 article event with title, summary and cover image', async () => {
    const ev = {
      id: 'article-1',
      pubkey: 'author-pk',
      kind: 30023,
      content: '記事本文がここに入ります。',
      tags: [
        ['title', 'テスト記事タイトル'],
        ['summary', '記事の概要文です'],
        ['image', 'https://example.com/thumb.jpg']
      ]
    };

    const html = await renderArticleQuote({ profiles: new Map() }, ev, {});
    expect(html).toContain('article-quote');
    expect(html).toContain('テスト記事タイトル');
    expect(html).toContain('記事の概要文です');
    expect(html).toContain('https://example.com/thumb.jpg');
    expect(html).toContain('📄');
  });

  it('falls back to content heading if title tag is absent', async () => {
    const ev = {
      id: 'article-2',
      pubkey: 'author-pk',
      kind: 30023,
      content: '# 自動抽出見出し\n\n本文テキストです。',
      tags: []
    };

    const html = await renderArticleQuote({ profiles: new Map() }, ev, {});
    expect(html).toContain('article-quote');
    expect(html).toContain('自動抽出見出し');
    expect(html).toContain('本文テキストです。');
  });

  it('renders mini markdown preview with custom emojis and inline images (Option B)', async () => {
    const ev = {
      id: 'article-3',
      pubkey: 'author-pk',
      kind: 30023,
      content: '- 1:nan:\n  - **2**\n\n|1|2|\n|:--|:--|\n|test| :nan: |\n![img](https://example.com/photo.webp)\n\n### :nan: **:nan:**',
      tags: [
        ['d', 'test'],
        ['title', 'test'],
        ['summary', ''],
        ['image', ''],
        ['emoji', 'nan', 'https://example.com/nan.webp']
      ]
    };

    const html = await renderArticleQuote({ profiles: new Map() }, ev, {});
    expect(html).toContain('article-quote-preview');
    expect(html).toContain('article-quote-markdown');
    expect(html).toContain('article-quote-fade');
    expect(html).toContain('article-quote-read-more');
    expect(html).toContain('class="custom-emoji"');
    expect(html).toContain('src="https://example.com/nan.webp"');
    expect(html).toContain('src="https://example.com/photo.webp"');
    expect(html).toContain('<table>');
  });

  it('hides cover image and converts preview images to fallback links when showTimelineMedia is false', async () => {
    const ev = {
      id: 'article-4',
      pubkey: 'author-pk',
      kind: 30023,
      content: '# Article with Images\n\n![diagram](https://example.com/diagram.png)\n\n:nan: emoji',
      tags: [
        ['title', 'メディア非表示テスト'],
        ['image', 'https://example.com/cover.jpg'],
        ['emoji', 'nan', 'https://example.com/nan.webp']
      ]
    };

    const settings = { showTimelineMedia: false };
    const html = await renderArticleQuote({ profiles: new Map() }, ev, {}, settings);

    // サムネイル画像は非表示
    expect(html).not.toContain('<img src="https://example.com/cover.jpg"');
    // 本文画像は fallback link に変換
    expect(html).not.toContain('<img src="https://example.com/diagram.png"');
    expect(html).toContain('class="article-image-fallback"');
    expect(html).toContain('href="https://example.com/diagram.png"');
    // カスタム絵文字は表示される
    expect(html).toContain('class="custom-emoji"');
    expect(html).toContain('src="https://example.com/nan.webp"');
  });
});

describe('fitCustomEmoji', () => {
  it('does not call getBoundingClientRect or collapse emoji-wrap height to 0px when offscreen/unloaded', () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement('div');
      container.innerHTML = [
        '<div class="emoji-line"><span class="emoji-wrap"><img class="custom-emoji" src="https://example.com/a.webp" /></span></div>',
        '<p><span class="emoji-wrap"><img class="custom-emoji" src="https://example.com/b.webp" /></span></p>'
      ].join('');

      const imgs = Array.from(container.querySelectorAll('img.custom-emoji'));
      const rectSpies = imgs.map(img => vi.spyOn(img, 'getBoundingClientRect'));

      fitCustomEmoji(container, 28);
      vi.advanceTimersByTime(350);

      for (const spy of rectSpies) {
        expect(spy).not.toHaveBeenCalled();
      }

      const wraps = Array.from(container.querySelectorAll('.emoji-wrap'));
      for (const wrap of wraps) {
        expect(wrap.style.height).toBe('');
        expect(wrap.style.display).toBe('inline-block');
      }
      expect(imgs[0].style.maxHeight).toBe('28px');
      expect(imgs[1].style.maxHeight).toBe('28px');

      // 画像ロード完了後（縦長: naturalWidth <= naturalHeight）も getBoundingClientRect なしでサイズ反映される
      Object.defineProperty(imgs[0], 'naturalWidth', { value: 64, configurable: true });
      Object.defineProperty(imgs[0], 'naturalHeight', { value: 96, configurable: true });
      imgs[0].dispatchEvent(new Event('load'));

      expect(rectSpies[0]).not.toHaveBeenCalled();
      expect(imgs[0].style.width).toBe('28px');
      expect(imgs[0].style.maxHeight).toBe('');
      expect(wraps[0].style.height).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Content Warning preservation in quote cards', () => {
  it('folds CW-tagged quoted note until expand button is clicked without opening event modal', async () => {
    resetAppContextForTests();
    const cwNote = {
      id: 'cw-quoted-note-1',
      pubkey: 'pk-cw',
      kind: 1,
      content: '引用先のネタバレ本文',
      tags: [['content-warning', '重大ネタバレ']]
    };
    const state = {
      profiles: new Map([['pk-cw', { display_name: 'CW投稿者' }]]),
      eventCache: new Map([['cw-quoted-note-1', cwNote]]),
      feeds: {}
    };

    const container = document.createElement('div');
    const quoteEl = document.createElement('span');
    quoteEl.className = 'nostr-quote';
    quoteEl.dataset.eventId = 'cw-quoted-note-1';
    container.appendChild(quoteEl);

    const showEventModalSpy = vi.fn();
    const ok = await resolveAndRenderQuote(
      quoteEl, container, showEventModalSpy, state, {}, null, null, null, {}, null, 0, 2
    );
    expect(ok).toBe(true);

    const foldBar = container.querySelector('.cw-embedded-fold-bar');
    const bodyEl = container.querySelector('.cw-embedded-body');
    expect(foldBar).not.toBeNull();
    expect(foldBar.textContent).toContain('重大ネタバレ');
    expect(bodyEl.classList.contains('d-none')).toBe(true);

    // Clicking the CW expand button reveals quote text without opening #eventModal
    container.querySelector('.cw-embedded-expand-btn').click();
    expect(showEventModalSpy).not.toHaveBeenCalled();
    expect(container.querySelector('.cw-embedded-fold-bar')).toBeNull();
    expect(bodyEl.classList.contains('d-none')).toBe(false);
    expect(bodyEl.textContent).toContain('引用先のネタバレ本文');

    resetAppContextForTests();
  });
});


