// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/i18n.js', () => ({
  t: vi.fn((key, params) => {
    if (key === 'profile.follow_list_modal_title') return `${params?.name} のフォロー一覧`;
    if (key === 'editor.snapshot.count') return `${params?.n} 件`;
    if (key === 'profile.follow_list_empty') return 'フォローしているユーザーはいません。';
    if (key === 'editor.follow.following') return 'フォロー中';
    if (key === 'editor.follow.follow') return '+ フォロー';
    return key;
  })
}));

vi.mock('../../core/nostr-compat.js', () => ({
  getNip19: vi.fn(() => ({ npubEncode: vi.fn((pk) => `npub1${pk}`) })),
  getSimplePool: vi.fn()
}));

vi.mock('../../core/relay.js', () => ({
  getReadRelays: vi.fn(() => []),
  relayConnect: vi.fn(),
  profileIndexerRelays: []
}));

vi.mock('../../ui/setup/modal-helper.js', () => ({
  bringModalToFront: vi.fn()
}));

vi.mock('./profile.js', () => ({
  displayNameWithUsername: vi.fn((state, pk) => ({ main: `User_${pk}`, sub: pk })),
  loadProfile: vi.fn(async (state, pk) => ({ name: `User_${pk}`, picture: 'https://example.com/pic.png' })),
  saveProfileToCache: vi.fn(),
  saveProfilesBatchToCache: vi.fn(),
  isAvatarsEnabled: vi.fn(() => true),
  isDomPurgeEnabled: vi.fn(() => false)
}));

vi.mock('./follow-editor.js', () => ({
  updateFollowButtonState: vi.fn(),
  toggleFollowUser: vi.fn()
}));

import { openUserFollowListModal } from './user-follow-modal.js';

describe('openUserFollowListModal', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="userFollowListModal" class="modal" hidden>
        <h2 id="userFollowListTitle" class="modal-title"></h2>
        <button id="userFollowListClose" type="button">✕</button>
        <span id="userFollowListCount"></span>
        <button id="userFollowListEditBtn" class="d-none" type="button">編集</button>
        <div id="userFollowListStatus"></div>
        <div id="userFollowListContent"></div>
        <button id="userFollowListBottomCloseBtn" type="button">閉じる</button>
      </div>
    `;
    localStorage.clear();
  });

  it('renders modal title, count, and items correctly from cached kind:3', async () => {
    const state = {
      pubkey: 'my_pubkey',
      profiles: new Map()
    };
    const cachedKind3 = {
      kind: 3,
      tags: [
        ['p', 'pk_alice'],
        ['p', 'pk_bob'],
        ['p', 'pk_charlie']
      ]
    };
    const targetProfile = { display_name: 'Alice', name: 'alice' };

    await openUserFollowListModal(state, 'target_user_pk', targetProfile, cachedKind3);

    const modal = document.getElementById('userFollowListModal');
    expect(modal.hidden).toBe(false);

    const titleEl = document.getElementById('userFollowListTitle');
    expect(titleEl.textContent).toBe('Alice のフォロー一覧');

    const countEl = document.getElementById('userFollowListCount');
    expect(countEl.textContent).toBe('3 件');

    const items = document.querySelectorAll('.editor-list-item');
    expect(items.length).toBe(3);

    // 編集ボタンは自分以外の場合は非表示
    const editBtn = document.getElementById('userFollowListEditBtn');
    expect(editBtn.classList.contains('d-none')).toBe(true);
  });

  it('shows empty message when follow list is empty', async () => {
    const state = {
      pubkey: 'my_pubkey',
      profiles: new Map()
    };
    const cachedKind3 = {
      kind: 3,
      tags: []
    };

    await openUserFollowListModal(state, 'target_user_pk', null, cachedKind3);

    const countEl = document.getElementById('userFollowListCount');
    expect(countEl.textContent).toBe('0 件');

    const contentEl = document.getElementById('userFollowListContent');
    expect(contentEl.textContent).toContain('フォローしているユーザーはいません。');
  });

  it('shows edit button when target is logged-in user', async () => {
    const state = {
      pubkey: 'my_pubkey',
      profiles: new Map()
    };
    const cachedKind3 = {
      kind: 3,
      tags: [['p', 'pk_someone']]
    };

    await openUserFollowListModal(state, 'my_pubkey', { name: 'Me' }, cachedKind3);

    const editBtn = document.getElementById('userFollowListEditBtn');
    expect(editBtn.classList.contains('d-none')).toBe(false);
  });

  it('closes modal when close button is clicked', async () => {
    const state = { pubkey: 'my_pubkey', profiles: new Map() };
    await openUserFollowListModal(state, 'target_user_pk', null, { kind: 3, tags: [] });

    const modal = document.getElementById('userFollowListModal');
    expect(modal.hidden).toBe(false);

    const closeBtn = document.getElementById('userFollowListClose');
    closeBtn.click();
    expect(modal.hidden).toBe(true);
  });

  it('hides avatars when isAvatarsEnabled is false', async () => {
    const { isAvatarsEnabled } = await import('./profile.js');
    isAvatarsEnabled.mockReturnValue(false);

    const state = {
      pubkey: 'my_pubkey',
      profiles: new Map([['pk_alice', { name: 'Alice', picture: 'https://example.com/alice.jpg' }]])
    };
    const cachedKind3 = {
      kind: 3,
      tags: [['p', 'pk_alice']]
    };

    await openUserFollowListModal(state, 'target_user_pk', null, cachedKind3);

    const avatar = document.querySelector('.editor-list-avatar');
    expect(avatar).not.toBeNull();
    expect(avatar.classList.contains('d-none')).toBe(true);
    expect(avatar.getAttribute('src') || '').toBe('');

    isAvatarsEnabled.mockReturnValue(true);
  });

  it('initializes purgeObserver when isDomPurgeEnabled is true', async () => {
    const { isDomPurgeEnabled } = await import('./profile.js');
    isDomPurgeEnabled.mockReturnValue(true);

    const observeFn = vi.fn();
    const disconnectFn = vi.fn();
    const mockObserver = vi.fn().mockImplementation((callback) => ({
      observe: observeFn,
      unobserve: vi.fn(),
      disconnect: disconnectFn
    }));
    vi.stubGlobal('IntersectionObserver', mockObserver);

    const state = {
      pubkey: 'my_pubkey',
      profiles: new Map([['pk_alice', { name: 'Alice' }]])
    };
    const cachedKind3 = {
      kind: 3,
      tags: [['p', 'pk_alice']]
    };

    await openUserFollowListModal(state, 'target_user_pk', null, cachedKind3);

    // Observer should have been called and observed the row
    expect(observeFn).toHaveBeenCalled();

    // Closing modal should disconnect observer
    const closeBtn = document.getElementById('userFollowListClose');
    closeBtn.click();
    expect(disconnectFn).toHaveBeenCalled();

    isDomPurgeEnabled.mockReturnValue(false);
    vi.unstubAllGlobals();
  });
});
