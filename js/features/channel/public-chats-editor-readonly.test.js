// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/i18n.js', () => ({
  t: vi.fn((key) => {
    if (key === 'readonly.action_blocked') return '閲覧専用アカウントのため保存できません';
    return key;
  })
}));

vi.mock('./public-chats.js', () => ({
  loadPublicChatsEditableState: vi.fn(async () => ({
    publicItems: [{ rootId: 'ch1', relayHint: null, isPrivate: false, label: 'Channel 1' }],
    privateItems: [],
    otherTags: [],
    encryptionMode: 'nip44',
    event: { id: 'evt_chat' },
    privateDecryptAttempted: true,
    privateDecryptOk: true
  })),
  publishPublicChatsState: vi.fn()
}));

vi.mock('./channel.js', () => ({
  fetchChannelMetadata: vi.fn(async () => ({ label: 'Channel 1' })),
  shortenChannelEventId: vi.fn((id) => id)
}));

vi.mock('./channel-membership.js', () => ({
  getCustomJoinedChannels: vi.fn(() => [])
}));

vi.mock('./channel-search.js', () => ({
  resolveChannelRootIdInput: vi.fn()
}));

import { openPublicChatsEditor } from './public-chats-editor.js';

describe('openPublicChatsEditor readonly account', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="publicChatsEditModal" hidden>
        <span id="publicChatsEditStatus"></span>
        <div id="publicChatsEditContent"></div>
        <button id="publicChatsEditSaveBtn">Save</button>
        <button id="publicChatsEditCancelBtn">Cancel</button>
        <button id="publicChatsEditClose">Close</button>
      </div>
    `;
    localStorage.setItem('pubkey', 'readonly_pk');
  });

  it('disables save button and add inputs when account is read-only', async () => {
    const state = {
      pubkey: 'readonly_pk',
      signer: 'read-only',
      relays: {}
    };

    await openPublicChatsEditor(state);

    const saveBtn = document.getElementById('publicChatsEditSaveBtn');
    expect(saveBtn).not.toBeNull();
    expect(saveBtn.disabled).toBe(true);
    expect(saveBtn.title).toBe('閲覧専用アカウントのため保存できません');

    const addInput = document.getElementById('publicChatsAddInput');
    expect(addInput).not.toBeNull();
    expect(addInput.disabled).toBe(true);

    const addBtn = document.getElementById('publicChatsAddBtn');
    expect(addBtn).not.toBeNull();
    expect(addBtn.disabled).toBe(true);

    // List items should not have drag-handle or remove buttons
    const dragHandle = document.querySelector('.drag-handle');
    expect(dragHandle).toBeNull();
    const removeBtn = document.querySelector('.editor-list-actions button');
    expect(removeBtn).toBeNull();
  });
});
