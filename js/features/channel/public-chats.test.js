// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchLatestEvent: vi.fn(),
  publishReplaceableEvent: vi.fn(),
  buildChannelEmbedContext: vi.fn(),
  getChannelLabelFromCache: vi.fn(() => null),
}));

vi.mock('../../core/replaceable-event.js', () => ({
  fetchLatestEvent: mocks.fetchLatestEvent,
  backupEvent: vi.fn(),
  publishReplaceableEvent: mocks.publishReplaceableEvent,
  describeLatestFetchProgress: () => '',
}));
vi.mock('./channel.js', () => ({
  buildChannelEmbedContext: mocks.buildChannelEmbedContext,
  formatChannelLabelText: (name, rootId) => name || rootId,
  getChannelLabelFromCache: mocks.getChannelLabelFromCache,
  shortenChannelEventId: (id) => String(id || '').slice(0, 8),
}));

import { fetchPublicChatsEntries, togglePublicChatMembership } from './public-chats.js';

const PUBKEY = 'c'.repeat(64);
const ROOT_A = 'a'.repeat(64);
const ROOT_B = 'b'.repeat(64);

describe('fetchPublicChatsEntries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getChannelLabelFromCache.mockReturnValue(null);
  });

  it('paints public refs before decrypt and skips channel metadata lookups', async () => {
    const older = { id: 'old', created_at: 10, tags: [['e', ROOT_A]], content: '' };
    const newer = {
      id: 'new',
      created_at: 20,
      tags: [['e', ROOT_A]],
      content: JSON.stringify([['e', ROOT_B]]),
    };
    mocks.fetchLatestEvent.mockImplementation(async (_state, _kind, _pubkey, options) => {
      options.onEvent(older);
      options.onEvent(newer);
      options.onEvent(older);
      return newer;
    });

    const updates = [];
    const result = await fetchPublicChatsEntries({ feeds: {} }, PUBKEY, {
      resolveChannels: false,
      onUpdate: (snapshot) => updates.push(snapshot),
    });

    expect(mocks.buildChannelEmbedContext).not.toHaveBeenCalled();
    expect(updates.map((snapshot) => ({
      partial: !!snapshot.partial,
      ids: snapshot.entries.map((entry) => entry.rootId),
    }))).toEqual([
      { partial: true, ids: [ROOT_A] },
      { partial: false, ids: [ROOT_A, ROOT_B] },
    ]);
    expect(result.event.id).toBe('new');
    expect(result.entries.map((entry) => entry.rootId)).toEqual([ROOT_A, ROOT_B]);
    expect(result.entries[1].isPrivate).toBe(true);
  });

  it('still resolves embed context when the caller needs channel records', async () => {
    mocks.buildChannelEmbedContext.mockResolvedValue({ reference: 'nevent1test', name: 'Named' });
    mocks.fetchLatestEvent.mockResolvedValue({
      id: 'only',
      created_at: 1,
      tags: [['e', ROOT_A]],
      content: '',
    });

    const result = await fetchPublicChatsEntries({ feeds: {} }, PUBKEY);

    expect(mocks.buildChannelEmbedContext).toHaveBeenCalledTimes(1);
    expect(result.entries[0]).toMatchObject({
      rootId: ROOT_A,
      label: 'Named',
      channel: { reference: 'nevent1test', name: 'Named' },
    });
  });
});

describe('togglePublicChatMembership leave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('pubkey', PUBKEY);
  });

  it('removes a listed channel from kind 10005 without publishing device-only channels or clearing other exclusions', async () => {
    const other = 'd'.repeat(64);
    localStorage.setItem(`channel_10005_exclusions_v1.${PUBKEY}`, JSON.stringify([other]));
    localStorage.setItem(`custom_joined_channels.${PUBKEY}`, JSON.stringify([ROOT_B]));
    mocks.fetchLatestEvent.mockResolvedValue({
      id: 'list',
      created_at: 10,
      pubkey: PUBKEY,
      tags: [['e', ROOT_A], ['e', other]],
      content: '',
    });
    mocks.publishReplaceableEvent.mockResolvedValue({ ok: true, event: { id: 'next' } });

    const result = await togglePublicChatMembership({ pubkey: PUBKEY }, ROOT_A, {
      join: false,
      preserveExclusions: true,
    });

    expect(result.ok).toBe(true);
    const draft = mocks.publishReplaceableEvent.mock.calls[0][1];
    expect(draft.tags.map((tag) => tag[1])).toEqual([other]);
    expect(draft.content).toBe('');
    expect(JSON.parse(localStorage.getItem(`channel_10005_exclusions_v1.${PUBKEY}`))).toEqual([other]);
    expect(JSON.parse(localStorage.getItem(`custom_joined_channels.${PUBKEY}`))).toEqual([ROOT_B]);
  });

  it('does not publish when the channel is not on kind 10005', async () => {
    mocks.fetchLatestEvent.mockResolvedValue({
      id: 'list',
      created_at: 10,
      pubkey: PUBKEY,
      tags: [['e', ROOT_A]],
      content: '',
    });

    const result = await togglePublicChatMembership({ pubkey: PUBKEY }, ROOT_B, { join: false });

    expect(result).toMatchObject({ ok: true, already: true });
    expect(mocks.publishReplaceableEvent).not.toHaveBeenCalled();
  });
});
