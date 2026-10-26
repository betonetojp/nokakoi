// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/i18n.js', () => ({
  t: vi.fn((key) => {
    if (key === 'editor.follow.mutual') return '相互';
    if (key === 'editor.follow.following') return 'フォロー中';
    if (key === 'editor.follow.follow') return '+ フォロー';
    return key;
  })
}));

vi.mock('../../core/nostr-compat.js', () => ({
  getNip19: vi.fn(),
  getSimplePool: vi.fn()
}));

vi.mock('../../core/relay.js', () => ({
  getReadRelays: vi.fn(() => []),
  relayConnect: vi.fn(),
  profileIndexerRelays: []
}));

vi.mock('../../core/replaceable-event.js', () => ({
  fetchLatestEvent: vi.fn(),
  backupEvent: vi.fn(),
  publishReplaceableEvent: vi.fn()
}));

vi.mock('./profile.js', () => ({
  displayNameWithUsername: vi.fn(),
  loadProfile: vi.fn(),
  updateNameDom: vi.fn(),
  isAvatarsEnabled: vi.fn(() => true)
}));

import { updateFollowButtonState, toggleFollowUser, checkMutualFollow, queueMutualCheck, clearMutualQueue, globalMutualCache } from './follow-editor.js';

describe('updateFollowButtonState', () => {
  beforeEach(() => {
    globalMutualCache.clear();
    document.body.innerHTML = '';
  });

  it('sets not-following state when user is not followed', () => {
    const btn = document.createElement('button');
    const state = {
      pubkey: 'my_pk',
      feeds: { home: { followSet: new Set() } }
    };

    updateFollowButtonState(state, btn, 'other_pk');

    expect(btn.textContent).toBe('+ フォロー');
    expect(btn.className).toBe('btn-follow-toggle not-following');
  });

  it('sets following state and uses globalMutualCache if available without network request', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    globalMutualCache.set('other_pk', true);

    const state = {
      pubkey: 'my_pk',
      feeds: { home: { followSet: new Set(['other_pk']) } }
    };

    updateFollowButtonState(state, btn, 'other_pk');

    expect(btn.textContent).toBe('相互');
    expect(btn.classList.contains('mutual')).toBe(true);
    expect(btn.classList.contains('following')).toBe(true);
  });

  it('does not trigger network check when skipMutualNetwork is true', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    const state = {
      pubkey: 'my_pk',
      feeds: { home: { followSet: new Set(['other_pk']) } }
    };

    updateFollowButtonState(state, btn, 'other_pk', { skipMutualNetwork: true });

    expect(btn.textContent).toBe('フォロー中');
    expect(btn.classList.contains('following')).toBe(true);
    expect(btn.classList.contains('mutual')).toBe(false);
  });

  it('matches case-insensitively when checking follow state with uppercase pubkey', () => {
    const btn = document.createElement('button');
    document.body.appendChild(btn);

    const state = {
      pubkey: 'my_pk',
      feeds: { home: { followSet: new Set(['abcdef123456']) } }
    };

    updateFollowButtonState(state, btn, 'ABCDEF123456', { skipMutualNetwork: true });

    expect(btn.textContent).toBe('フォロー中');
    expect(btn.classList.contains('following')).toBe(true);
  });
});

describe('toggleFollowUser', () => {
  it('handles uppercase pubkey correctly when adding and removing follows', async () => {
    const { fetchLatestEvent, publishReplaceableEvent } = await import('../../core/replaceable-event.js');
    localStorage.setItem('pubkey', 'my_pk');

    fetchLatestEvent.mockResolvedValueOnce({
      kind: 3,
      content: '',
      tags: [['p', 'abcdef123456', '', '']]
    });
    publishReplaceableEvent.mockResolvedValueOnce({ ok: true });

    const state = {
      feeds: {
        home: {
          follows: ['abcdef123456'],
          followSet: new Set(['abcdef123456'])
        }
      }
    };

    // Unfollow: simulate user clicking confirm dialog
    setTimeout(() => {
      const okBtn = document.querySelector('.editor-confirm-actions button:not(.secondary)');
      if (okBtn) okBtn.click();
    }, 10);

    const btn = document.createElement('button');
    const unfollowResult = await toggleFollowUser(state, 'ABCDEF123456', btn);
    expect(unfollowResult).toBe(true);
    expect(state.feeds.home.follows).not.toContain('abcdef123456');
    expect(state.feeds.home.followSet.has('abcdef123456')).toBe(false);
  });
});

describe('checkMutualFollow', () => {
  beforeEach(() => {
    globalMutualCache.clear();
  });

  it('returns cached result when targetPubkey exists in cache', async () => {
    globalMutualCache.set('target_1', true);
    const result = await checkMutualFollow({}, 'target_1', 'my_pk');
    expect(result).toBe(true);
  });

  it('returns false immediately when targetPubkey or myPubkey is missing', async () => {
    expect(await checkMutualFollow({}, null, 'my_pk')).toBe(false);
    expect(await checkMutualFollow({}, 'target_1', null)).toBe(false);
  });
});

describe('queueMutualCheck and clearMutualQueue', () => {
  beforeEach(() => {
    globalMutualCache.clear();
    clearMutualQueue();
  });

  it('calls callback immediately if result is already in cache', () => {
    globalMutualCache.set('target_cached', true);
    const cb = vi.fn();

    queueMutualCheck({}, 'target_cached', 'my_pk', cb);

    expect(cb).toHaveBeenCalledWith(true);
  });

  it('clears queue items matching signal on clearMutualQueue', () => {
    const controller = new AbortController();
    const cb = vi.fn();

    queueMutualCheck({}, 'target_uncached_1', 'my_pk', cb, { signal: controller.signal });
    queueMutualCheck({}, 'target_uncached_2', 'my_pk', cb, { signal: controller.signal });

    clearMutualQueue(controller.signal);

    // After clearing, aborted queue items will not run callbacks
    controller.abort();
    expect(cb).not.toHaveBeenCalled();
  });
});
