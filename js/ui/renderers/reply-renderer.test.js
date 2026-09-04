// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../features/profile/profile.js', () => ({
  displayName: (_state, pk) => {
    if (pk === 'sender') return 'べったん';
    if (pk === 'recipient') return 'アリス';
    if (pk === 'eadef7c9066f48df0f96f7a07778bc024c0f7f7332e98d6cad0d550b2ed2623a') return '\u200B📛お気に入り';
    return pk || '';
  }
}));

vi.mock('../../core/state.js', () => ({
  findEventById: vi.fn(() => null)
}));

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
});
