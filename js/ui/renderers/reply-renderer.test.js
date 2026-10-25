// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../features/profile/profile.js', () => ({
  displayName: (_state, pk) => {
    if (pk === 'sender') return 'べったん';
    if (pk === 'recipient') return 'アリス';
    if (pk === 'eadef7c9066f48df0f96f7a07778bc024c0f7f7332e98d6cad0d550b2ed2623a') return '\u200B📛お気に入り';
    return pk || '';
  },
  npubShort: (pk) => (pk && pk.length > 12 ? pk.slice(0, 12) + '…' : pk || '')
}));

vi.mock('../../utils/i18n.js', () => ({
  t: (key, params) => {
    if (key === 'repost.label' && params && params.author) return `${params.author} をリポスト`;
    if (key === 'reply.label' && params && params.author) return `${params.author} に返信`;
    if (key === 'reaction.label' && params && params.author) return `${params.author} にリアクション`;
    if (params && typeof params === 'object') {
      return Object.entries(params).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), key);
    }
    return key;
  },
  initI18n: () => Promise.resolve(),
  applyTranslations: () => Promise.resolve()
}));

vi.mock('../../core/state.js', () => ({
  findEventById: vi.fn(() => null)
}));

import { resetAppContextForTests } from '../../core/app-context.js';
import { bindEmbeddedCwHandlers } from './render-helpers.js';
import { formatZapReceiptLabel, renderReplyContext } from './reply-renderer.js';

const profileZap = {
  kind: 9735,
  id: 'receipt1',
  pubkey: 'ln-server',
  content: '',
  tags: [
    ['p', 'recipient'],
    ['P', 'sender'],
    ['description', JSON.stringify({
      kind: 9734,
      content: 'プロフィールから',
      tags: [['p', 'recipient'], ['amount', '100000']]
    })]
  ]
};

describe('profile zap receipt cards', () => {
  it('formats amount and comment without an e tag for incoming zap with kako nostr:npub text format', () => {
    localStorage.removeItem('pubkey');
    const { label, header, comment, direction } = formatZapReceiptLabel({ profiles: new Map() }, profileZap, null);
    expect(direction).toBe('from');
    expect(header).toBe('⚡ 100sats from nostr:sender');
    expect(comment).toBe('💬 プロフィールから');
    expect(label).toBe('⚡ 100sats from nostr:sender\n💬 プロフィールから');
  });

  it('formats amount and comment with "to" and recipient nostr:npub when sender is logged-in user', () => {
    localStorage.setItem('pubkey', 'sender');
    try {
      const { label, header, comment, direction } = formatZapReceiptLabel({ profiles: new Map() }, profileZap, null);
      expect(direction).toBe('to');
      expect(header).toBe('⚡ 100sats to nostr:recipient');
      expect(comment).toBe('💬 プロフィールから');
      expect(label).toBe('⚡ 100sats to nostr:recipient\n💬 プロフィールから');
    } finally {
      localStorage.removeItem('pubkey');
    }
  });

  it('renders a notification banner for profile zaps with author as inline nostr-link only', () => {
    localStorage.removeItem('pubkey');
    const html = renderReplyContext({ profiles: new Map([['sender', { display_name: 'べったん' }]]) }, profileZap, null, {});
    expect(html).toContain('reply-to zap');
    expect(html).toContain('zap-header');
    expect(html).toContain('zap-header-prefix');
    expect(html).toContain('⚡ 100sats from');
    expect(html).toContain('nostr-link nostr-npub name');
    expect(html).toContain('data-pubkey="sender"');
    expect(html).toContain('@べったん');
    expect(html).toContain('zap-comment');
    expect(html).toContain('💬 プロフィールから');
    expect(html).not.toContain('reply-to-content');
  });

  it('returns empty for other kinds without an e tag', () => {
    expect(renderReplyContext({}, { kind: 1, tags: [] }, null, {})).toBe('');
  });

  it('formats sample zap receipt event matching kako format with petname-first inline name link', () => {
    const userSampleZap = {
      content: 'いいね',
      created_at: 1788551374,
      id: 'f5f9b4ff2665db5793720d2a0a561698ac662dc1186abfdec529ea68bc927241',
      kind: 9735,
      pubkey: 'ln-server',
      tags: [
        ['p', 'eadef7c9066f48df0f96f7a07778bc024c0f7f7332e98d6cad0d550b2ed2623a'],
        ['e', '1456f693541710ceca6a3d81b577c42443993d1936e5989edc15649ed40d4f1c'],
        ['P', '21ac29561b5de90cdc21995fc0707525cd78c8a52d87721ab681d3d609d1e2df'],
        ['bolt11', 'lnbc20n1p4fkgxdsp58sl34v267l3lpmpnusw0kdjyf4qk70x0rvu2qdqskl7mt7qqtkjspp585uluk7emqh22wcagfe5cv8pnh48hav7dnq6l4n23wv4d2v86tpshp5x7t4jwuwyhcxhw7793eu0u7tkn9qwwwz5ammtrv25t8ph2uazmmsxq9z0rgqcqpnrzjq2zdkresdzshu007ddeudy0x7uu4cek0tggr9jmjsrmu9tdna8dyyrn0vsqqw5cqqqqqqqpjqqqqp9sqy']
      ]
    };

    localStorage.setItem('pubkey', '21ac29561b5de90cdc21995fc0707525cd78c8a52d87721ab681d3d609d1e2df');
    try {
      const { direction, header, comment, label, sats } = formatZapReceiptLabel({ profiles: new Map() }, userSampleZap, null);
      expect(direction).toBe('to');
      expect(sats).toBe(2);
      expect(header).toBe('⚡ 2sats to nostr:npub1at000jgxdayd7ruk77s8w79uqfxq7lmnxt5c6m9dp42sktkjvgaqvxf4ju');
      expect(comment).toBe('💬 いいね');
      expect(label).toBe('⚡ 2sats to nostr:npub1at000jgxdayd7ruk77s8w79uqfxq7lmnxt5c6m9dp42sktkjvgaqvxf4ju\n💬 いいね');

      const state = {
        profiles: new Map(),
        followPetnames: new Map([['eadef7c9066f48df0f96f7a07778bc024c0f7f7332e98d6cad0d550b2ed2623a', 'お気に入り']])
      };
      const html = renderReplyContext(state, userSampleZap, null, {});
      expect(html).toContain('reply-to zap');
      expect(html).toContain('zap-header');
      expect(html).toContain('zap-header-prefix');
      expect(html).toContain('⚡ 2sats to');
      expect(html).toContain('nostr-link nostr-npub name');
      expect(html).toContain('data-pubkey="eadef7c9066f48df0f96f7a07778bc024c0f7f7332e98d6cad0d550b2ed2623a"');
      expect(html).toContain('petname-badge');
      expect(html).toContain('お気に入り');
      expect(html).toContain('💬 いいね');
    } finally {
      localStorage.removeItem('pubkey');
    }
  });

  it('renders kind:30023 article preview with markdown and emojis when referenced by kind:7 reaction', async () => {
    const { findEventById } = await import('../../core/state.js');
    const articleEvent = {
      id: 'article-target-1',
      pubkey: 'author-pk',
      kind: 30023,
      content: '### :nan: 見出し\n\n- リスト:nan:\n\n![nan](https://example.com/nan.png)',
      tags: [
        ['d', 'test'],
        ['title', 'テスト記事'],
        ['emoji', 'nan', 'https://example.com/nan.png']
      ]
    };
    findEventById.mockReturnValue(articleEvent);

    const reactionEvent = {
      id: 'reaction-1',
      pubkey: 'reactor-pk',
      kind: 7,
      content: '⭐',
      tags: [
        ['e', 'article-target-1']
      ]
    };

    const state = { profiles: new Map([['author-pk', { display_name: 'もの' }]]) };
    const html = renderReplyContext(state, reactionEvent, null, {});

    expect(html).toContain('reply-to reaction');
    expect(html).toContain('⭐');
    expect(html).toContain('テスト記事');
    expect(html).toContain('article-quote-preview');
    expect(html).toContain('article-quote-markdown');
    expect(html).toContain('class="custom-emoji"');
    expect(html).toContain('src="https://example.com/nan.png"');
    expect(html).toContain('article-quote-fade');
  });
  it('renders kind:6 repost placeholder with shortened npub when original event is not yet cached but p tag exists', async () => {
    const { findEventById } = await import('../../core/state.js');
    findEventById.mockReset();
    findEventById.mockReturnValue(null);
    const repostEvent = {
      id: 'repost-ev-1',
      kind: 6,
      pubkey: 'reposter-pk',
      content: '',
      tags: [
        ['e', 'orig-ev-123456789012', 'wss://relay.example.com'],
        ['p', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef']
      ]
    };

    const html = renderReplyContext({ profiles: new Map() }, repostEvent, null, {});
    expect(html).toContain('reply-to repost');
    expect(html).toContain('data-pubkey="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"');
    expect(html).toContain('data-event-id="orig-ev-123456789012"');
    expect(html).toContain('0123456789ab…');
  });

  it('renders kind:6 repost with original event content and author display name when cached', async () => {
    const { findEventById } = await import('../../core/state.js');
    findEventById.mockImplementation((_state, id) => {
      if (id === 'cached-orig-id') {
        return {
          id: 'cached-orig-id',
          pubkey: 'recipient',
          kind: 1,
          content: 'こんにちは世界',
          tags: []
        };
      }
      return null;
    });

    const repostEvent = {
      id: 'repost-ev-2',
      kind: 6,
      pubkey: 'reposter-pk',
      content: '',
      tags: [
        ['e', 'cached-orig-id']
      ]
    };

    const html = renderReplyContext({ profiles: new Map() }, repostEvent, null, {});
    expect(html).toContain('reply-to repost');
    expect(html).toContain('data-pubkey="recipient"');
    expect(html).toContain('アリス');
    expect(html).toContain('こんにちは世界');
  });

  it('uses reply target author and eventId (not root) on unresolved reply card when both root and reply tags exist', async () => {
    const { findEventById } = await import('../../core/state.js');
    findEventById.mockImplementation((_state, id) => {
      if (id === 'root-ev-id') {
        return {
          id: 'root-ev-id',
          pubkey: 'sender',
          kind: 1,
          content: 'これはroot投稿',
          tags: []
        };
      }
      return null;
    });

    const threadReplyEv = {
      id: 'thread-reply-1',
      kind: 1,
      pubkey: 'replier-pk',
      content: '枝への返信です',
      tags: [
        ['e', 'root-ev-id', 'wss://yabu.me', 'root'],
        ['e', 'reply-ev-id', 'wss://yabu.me', 'reply'],
        ['p', 'sender'],     // root author ('べったん')
        ['p', 'recipient']   // reply target author ('アリス')
      ]
    };

    const html = renderReplyContext({ profiles: new Map() }, threadReplyEv, null, {});
    expect(html).toContain('data-event-id="reply-ev-id"');
    expect(html).toContain('data-pubkey="recipient"');
    expect(html).toContain('アリス に返信');
    expect(html).not.toContain('べったん に返信');
  });

  it('renders reply event content (not root content) when both root and reply events are cached', async () => {
    const { findEventById } = await import('../../core/state.js');
    findEventById.mockImplementation((_state, id) => {
      if (id === 'root-ev-id') {
        return { id: 'root-ev-id', pubkey: 'sender', kind: 1, content: 'ROOT本文', tags: [] };
      }
      if (id === 'reply-ev-id') {
        return { id: 'reply-ev-id', pubkey: 'recipient', kind: 1, content: 'REPLY親本文', tags: [] };
      }
      return null;
    });

    const threadReplyEv = {
      id: 'thread-reply-2',
      kind: 1,
      pubkey: 'replier-pk',
      content: '枝への返信2',
      tags: [
        ['e', 'root-ev-id', 'wss://yabu.me', 'root'],
        ['e', 'reply-ev-id', 'wss://yabu.me', 'reply'],
        ['p', 'sender'],
        ['p', 'recipient']
      ]
    };

    const html = renderReplyContext({ profiles: new Map() }, threadReplyEv, null, {});
    expect(html).toContain('data-event-id="reply-ev-id"');
    expect(html).toContain('data-pubkey="recipient"');
    expect(html).toContain('アリス に返信');
    expect(html).toContain('REPLY親本文');
    expect(html).not.toContain('ROOT本文');
  });

  it('preserves Content Warning fold bar on original post when rendered inside reply, repost, and reaction cards', async () => {
    resetAppContextForTests();
    const { findEventById } = await import('../../core/state.js');
    const cwOriginal = {
      id: 'cw-orig-1',
      pubkey: 'recipient',
      kind: 1,
      content: '秘密のネタバレ本文',
      tags: [['content-warning', '映画の結末']]
    };
    const repostOfCw = {
      id: 'repost-cw-1',
      pubkey: 'sender',
      kind: 6,
      content: '',
      tags: [['e', 'cw-orig-1']]
    };
    const replyToCw = {
      id: 'reply-cw-1',
      pubkey: 'sender',
      kind: 1,
      content: 'わかる！',
      tags: [['e', 'cw-orig-1', '', 'root']]
    };
    const reactionToCw = {
      id: 'react-cw-1',
      pubkey: 'sender',
      kind: 7,
      content: '+',
      tags: [['e', 'cw-orig-1']]
    };

    findEventById.mockImplementation((_state, id) => {
      if (id === 'cw-orig-1') return cwOriginal;
      if (id === 'repost-cw-1') return repostOfCw;
      return null;
    });

    const state = { profiles: new Map() };

    for (const wrapperEv of [replyToCw, repostOfCw, reactionToCw]) {
      const container = document.createElement('div');
      container.innerHTML = renderReplyContext(state, wrapperEv, null, {});
      const foldBar = container.querySelector('.cw-embedded-fold-bar');
      const bodyEl = container.querySelector('.cw-embedded-body');
      expect(foldBar).not.toBeNull();
      expect(foldBar.textContent).toContain('映画の結末');
      expect(bodyEl).not.toBeNull();
      expect(bodyEl.classList.contains('d-none')).toBe(true);
      expect(bodyEl.textContent).toContain('秘密のネタバレ本文');
    }

    // Expanding via button reveals body in-place and marks event expanded globally
    const cardWrap = document.createElement('div');
    cardWrap.innerHTML = renderReplyContext(state, repostOfCw, null, {});
    const parentClickSpy = vi.fn();
    cardWrap.addEventListener('click', parentClickSpy);
    bindEmbeddedCwHandlers(cardWrap);

    const expandBtn = cardWrap.querySelector('.cw-embedded-expand-btn');
    expandBtn.click();

    expect(parentClickSpy).not.toHaveBeenCalled();
    expect(cardWrap.querySelector('.cw-embedded-fold-bar')).toBeNull();
    expect(cardWrap.querySelector('.cw-embedded-body').classList.contains('d-none')).toBe(false);

    resetAppContextForTests();
  });
});
