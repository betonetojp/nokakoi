// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../features/profile/profile.js', () => ({
  displayName: (_state, pk) => (pk === 'sender' ? 'べったん' : pk || '')
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
  it('formats amount and comment without an e tag', () => {
    const { label } = formatZapReceiptLabel({ profiles: new Map() }, profileZap, null);
    expect(label).toContain('100 sat');
    expect(label).toContain('プロフィールから');
    expect(label).toContain('Zap from');
  });

  it('renders a notification banner for profile zaps with no e tag', () => {
    const html = renderReplyContext({ profiles: new Map() }, profileZap, null, {});
    expect(html).toContain('reply-to zap');
    expect(html).toContain('100 sat');
    expect(html).toContain('プロフィールから');
    expect(html).not.toContain('reply-to-content');
  });

  it('returns empty for other kinds without an e tag', () => {
    expect(renderReplyContext({}, { kind: 1, tags: [] }, null, {})).toBe('');
  });
});
