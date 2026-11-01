// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/i18n.js', () => ({
  t: vi.fn((key) => {
    if (key === 'readonly.action_blocked') return '閲覧専用アカウントのため保存できません';
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
  fetchLatestEvent: vi.fn(async () => ({
    event: { id: 'evt1', tags: [['p', 'pk_followed', '', '']], content: '' }
  })),
  backupEvent: vi.fn(),
  publishReplaceableEvent: vi.fn(),
  describeLatestFetchProgress: (progress, options = {}) => {
    if (options.stale) return 'editor.common.edited_before_latest';
    if (progress && progress.done) return 'editor.common.fetched';
    const total = progress && Number(progress.total) > 0 ? Number(progress.total) : 0;
    const settled = progress && Number(progress.settled) > 0 ? Math.min(Number(progress.settled), total) : 0;
    if (!total) return 'editor.common.checking_unknown';
    return `editor.common.checking:${settled}/${total}`;
  }
}));

vi.mock('../profile/profile.js', () => ({
  displayNameWithUsername: vi.fn(() => 'TestUser'),
  loadProfile: vi.fn(async () => null),
  updateNameDom: vi.fn(),
  isAvatarsEnabled: vi.fn(() => false)
}));

import { fetchLatestEvent } from '../../core/replaceable-event.js';
import { openFollowEditor } from './follow-editor.js';

describe('openFollowEditor readonly account', () => {
  beforeEach(() => {
    fetchLatestEvent.mockReset();
    fetchLatestEvent.mockImplementation(async () => ({
      event: { id: 'evt1', tags: [['p', 'pk_followed', '', '']], content: '' }
    }));
    document.body.innerHTML = `
      <div id="followEditModal" hidden>
        <span id="followEditStatus"></span>
        <div id="followEditContent"></div>
        <button id="followEditSaveBtn">Save</button>
        <button id="followEditCancelBtn">Cancel</button>
        <button id="followEditClose">Close</button>
      </div>
    `;
    localStorage.setItem('pubkey', 'readonly_pk');
  });

  it('disables save button and item actions when account is read-only', async () => {
    const state = {
      pubkey: 'readonly_pk',
      signer: 'read-only',
      relays: {}
    };

    await openFollowEditor(state);

    const saveBtn = document.getElementById('followEditSaveBtn');
    expect(saveBtn).not.toBeNull();
    expect(saveBtn.disabled).toBe(true);
    expect(saveBtn.title).toBe('閲覧専用アカウントのため保存できません');

    const toggleBtn = document.querySelector('.follow-item-toggle');
    if (toggleBtn) {
      expect(toggleBtn.disabled).toBe(true);
    }
  });

  it('paints the first follow list and replaces it only when a newer list arrives', async () => {
    const olderId = 'a'.repeat(64);
    const newerId = 'b'.repeat(64);
    const older = { created_at: 1, tags: [['p', olderId, '', 'old']], content: '' };
    const newer = { created_at: 2, tags: [['p', newerId, '', 'new']], content: '' };
    fetchLatestEvent.mockImplementation(async (_state, _kind, _pubkey, options) => {
      options.onEvent(older);
      expect(document.querySelector('[data-focus-pubkey]').getAttribute('data-focus-pubkey')).toBe(olderId);
      options.onEvent(newer);
      expect(document.querySelector('[data-focus-pubkey]').getAttribute('data-focus-pubkey')).toBe(newerId);
      options.onEvent(older);
      expect(document.querySelector('[data-focus-pubkey]').getAttribute('data-focus-pubkey')).toBe(newerId);
      return newer;
    });

    await openFollowEditor({
      pubkey: 'readonly_pk',
      signer: 'read-only',
      relays: {}
    });

    expect(document.querySelector('[data-focus-pubkey]').getAttribute('data-focus-pubkey')).toBe(newerId);
    expect(document.getElementById('followEditStatus').textContent).toBe('editor.common.fetched');
  });

  it('keeps the follow list after the user starts editing', async () => {
    const olderId = 'c'.repeat(64);
    const newerId = 'd'.repeat(64);
    fetchLatestEvent.mockImplementation(async (_state, _kind, _pubkey, options) => {
      options.onEvent({ created_at: 1, tags: [['p', olderId, '', '']], content: '' });
      document.querySelector('.editor-list-item').dispatchEvent(new Event('pointerdown', { bubbles: true }));
      options.onEvent({ created_at: 2, tags: [['p', newerId, '', '']], content: '' });
      expect(document.getElementById('followEditStatus').textContent).toBe('editor.common.edited_before_latest');
      return { created_at: 2, tags: [['p', newerId, '', '']], content: '' };
    });

    await openFollowEditor({
      pubkey: 'readonly_pk',
      signer: 'read-only',
      relays: {}
    });

    expect(document.querySelector('[data-focus-pubkey]').getAttribute('data-focus-pubkey')).toBe(olderId);
    expect(document.getElementById('followEditStatus').textContent).toBe('editor.common.edited_before_latest');
  });
});
