// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  pickRootIdFromKind42,
  pickRootIdFromKind41,
  resolveChannelRootIdInput,
  searchChannels,
} from './channel-search.js';

const mocks = vi.hoisted(() => ({
  fetchChannelMetadata: vi.fn(async (_state, rootId) => ({
    label: `Channel-${rootId.slice(0, 4)}`,
    rootEvent: { id: rootId, kind: 40, created_at: 100, content: JSON.stringify({ name: `Name-${rootId.slice(0, 4)}` }) },
    metaEvent: null,
  })),
  cacheEvent: vi.fn(),
  getReadRelays: vi.fn(() => ['wss://relay.example.com']),
}));

vi.mock('../../core/relay.js', () => ({
  getReadRelays: mocks.getReadRelays,
}));

vi.mock('../../core/state.js', () => ({
  cacheEvent: mocks.cacheEvent,
}));

vi.mock('./channel.js', () => ({
  extractChannelProfileFields: (root, meta) => {
    let name = '';
    let about = '';
    try {
      const parsed = JSON.parse((meta && meta.content) || (root && root.content) || '{}');
      name = parsed.name || '';
      about = parsed.about || '';
    } catch (_e) {}
    return { name, about, picture: '', relays: null };
  },
  resolveChannelLabelFromEvents: (root, meta) => {
    try {
      const parsed = JSON.parse((meta && meta.content) || (root && root.content) || '{}');
      return parsed.name || '';
    } catch (_e) {}
    return '';
  },
  shortenChannelEventId: id => String(id || '').slice(0, 8),
  fetchChannelMetadata: mocks.fetchChannelMetadata,
}));

describe('channel-search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pickRootIdFromKind42', () => {
    const rootId = '11'.repeat(32);

    it('extracts rootId from e tag with root marker', () => {
      const ev = {
        kind: 42,
        tags: [
          ['p', '22'.repeat(32)],
          ['e', rootId, 'wss://relay.example.com', 'root'],
        ],
      };
      expect(pickRootIdFromKind42(ev)).toBe(rootId);
    });

    it('extracts rootId from first e tag when root marker is absent', () => {
      const ev = {
        kind: 42,
        tags: [
          ['e', rootId],
        ],
      };
      expect(pickRootIdFromKind42(ev)).toBe(rootId);
    });

    it('returns null for non-42 kind or invalid tags', () => {
      expect(pickRootIdFromKind42({ kind: 1, tags: [['e', rootId]] })).toBeNull();
      expect(pickRootIdFromKind42({ kind: 42, tags: [] })).toBeNull();
      expect(pickRootIdFromKind42(null)).toBeNull();
    });
  });

  describe('searchChannels with kind:42 activity sorting', () => {
    const channelA = 'aa'.repeat(32); // Created early (1000), but has newest message (5000)
    const channelB = 'bb'.repeat(32); // Created recently (4000), no messages
    const channelC = 'cc'.repeat(32); // Created (2000), message at (3000)

    it('sorts channels by latest kind:42 activity in browse mode', async () => {
      const events = [
        // kind:40s
        { id: channelA, kind: 40, created_at: 1000, content: JSON.stringify({ name: 'Alpha Channel' }) },
        { id: channelB, kind: 40, created_at: 4000, content: JSON.stringify({ name: 'Beta Channel' }) },
        { id: channelC, kind: 40, created_at: 2000, content: JSON.stringify({ name: 'Gamma Channel' }) },
        // kind:42s
        { id: 'msg1', kind: 42, created_at: 5000, tags: [['e', channelA, '', 'root']], content: 'latest msg in Alpha' },
        { id: 'msg2', kind: 42, created_at: 3000, tags: [['e', channelC, '', 'root']], content: 'msg in Gamma' },
      ];

      const state = {
        relays: { 'wss://relay.example.com': { read: true } },
        pool: {
          querySync: vi.fn(async () => events),
        },
      };

      const result = await searchChannels(state, '');
      expect(result.mode).toBe('browse');
      expect(result.results.length).toBe(3);

      // Expected order: Channel A (active: 5000) -> Channel B (active: 4000) -> Channel C (active: 3000)
      expect(result.results[0].rootId).toBe(channelA);
      expect(result.results[0].last_active_at).toBe(5000);
      expect(result.results[0].last_message_at).toBe(5000);

      expect(result.results[1].rootId).toBe(channelB);
      expect(result.results[1].last_active_at).toBe(4000);
      expect(result.results[1].last_message_at).toBe(0);

      expect(result.results[2].rootId).toBe(channelC);
      expect(result.results[2].last_active_at).toBe(3000);
      expect(result.results[2].last_message_at).toBe(3000);
    });

    it('resolves metadata for channels discovered only via kind:42', async () => {
      const channelD = 'dd'.repeat(32);
      const events = [
        { id: 'msg_d', kind: 42, created_at: 6000, tags: [['e', channelD, '', 'root']], content: 'active msg' },
      ];

      const state = {
        relays: { 'wss://relay.example.com': { read: true } },
        pool: {
          querySync: vi.fn(async () => events),
        },
      };

      const result = await searchChannels(state, '');
      expect(mocks.fetchChannelMetadata).toHaveBeenCalledWith(state, channelD);
      expect(result.results.length).toBe(1);
      expect(result.results[0].rootId).toBe(channelD);
      expect(result.results[0].name).toBe(`Name-${channelD.slice(0, 4)}`);
      expect(result.results[0].last_active_at).toBe(6000);
    });

    it('ranks keyword match first and breaks ties with activity', async () => {
      const events = [
        { id: channelA, kind: 40, created_at: 1000, content: JSON.stringify({ name: 'Bitcoin Chat' }) },
        { id: channelB, kind: 40, created_at: 2000, content: JSON.stringify({ name: 'Bitcoin Builders' }) },
        { id: channelC, kind: 40, created_at: 3000, content: JSON.stringify({ name: 'General Chat' }) },
        // Message in Bitcoin Chat (5000) vs Bitcoin Builders (3000)
        { id: 'msg_a', kind: 42, created_at: 5000, tags: [['e', channelA, '', 'root']] },
        { id: 'msg_b', kind: 42, created_at: 3000, tags: [['e', channelB, '', 'root']] },
      ];

      const state = {
        relays: { 'wss://relay.example.com': { read: true } },
        pool: {
          querySync: vi.fn(async () => events),
        },
      };

      const result = await searchChannels(state, 'Bitcoin');
      expect(result.mode).toBe('search');
      expect(result.results.length).toBe(2);
      // Both match "Bitcoin", channelA has newer activity (5000 vs 3000)
      expect(result.results[0].rootId).toBe(channelA);
      expect(result.results[1].rootId).toBe(channelB);
    });
  });
});
