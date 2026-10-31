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
  publishReplaceableEvent: vi.fn()
}));

vi.mock('../profile/profile.js', () => ({
  displayNameWithUsername: vi.fn(() => 'TestUser'),
  loadProfile: vi.fn(),
  updateNameDom: vi.fn(),
  isAvatarsEnabled: vi.fn(() => false)
}));

import { openFollowEditor } from './follow-editor.js';

describe('openFollowEditor readonly account', () => {
  beforeEach(() => {
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
});
