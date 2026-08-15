// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/relay.js', () => ({
  profileIndexerRelay: 'wss://profile.example'
}));
vi.mock('../../utils/utils.js', () => ({
  truncateName: vi.fn((value) => value),
  escapeHtml: vi.fn((value) => value),
  replaceBadgeEmoji: vi.fn((value) => value)
}));
vi.mock('../../core/nostr-compat.js', () => ({
  getNip19: vi.fn(() => ({ npubEncode: vi.fn((pk) => pk) }))
}));
vi.mock('../../ui/renderers/render-helpers.js', () => ({
  evaluateMuteState: vi.fn(),
  applyMutedToneToEvent: vi.fn(),
  updateEventMuteDom: vi.fn()
}));

import { updateAvatarDom, updateNameDom } from './profile.js';

describe('updateAvatarDom and updateNameDom', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('inserts avatar image into .event-name when none exists', () => {
    document.body.innerHTML = `
      <div class="event" data-kind="1" data-pubkey="pk1">
        <div class="event-name">
          <div class="event-name-text">
            <div class="event-name-primary">
              <span class="name" data-pubkey="pk1">User 1</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const state = {
      profiles: new Map([
        ['pk1', { name: 'User 1', picture: 'https://example.com/pic.png', loaded: true }]
      ])
    };

    updateAvatarDom(state, 'pk1');

    const avatar = document.querySelector('.event-name .avatar');
    expect(avatar).not.toBeNull();
    expect(avatar.tagName).toBe('IMG');
    expect(avatar.src).toBe('https://example.com/pic.png');
    expect(avatar.loading).toBe('lazy');
  });

  it('updates existing avatar image src and unhides it', () => {
    document.body.innerHTML = `
      <div class="event" data-kind="1" data-pubkey="pk1">
        <div class="event-name">
          <img src="https://example.com/old.png" alt="avatar" class="avatar d-none">
          <div class="event-name-text">
            <div class="event-name-primary">
              <span class="name" data-pubkey="pk1">User 1</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const state = {
      profiles: new Map([
        ['pk1', { name: 'User 1', picture: 'https://example.com/new.png', loaded: true }]
      ])
    };

    updateAvatarDom(state, 'pk1');

    const avatar = document.querySelector('.event-name .avatar');
    expect(avatar.src).toBe('https://example.com/new.png');
    expect(avatar.classList.contains('d-none')).toBe(false);
  });

  it('skips kind 20000 events', () => {
    document.body.innerHTML = `
      <div class="event" data-kind="20000" data-pubkey="pk1">
        <div class="event-name">
          <div class="event-name-text">
            <div class="event-name-primary">
              <span class="name" data-pubkey="pk1">#1234</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const state = {
      profiles: new Map([
        ['pk1', { name: 'User 1', picture: 'https://example.com/pic.png', loaded: true }]
      ])
    };

    updateAvatarDom(state, 'pk1');

    const avatar = document.querySelector('.event-name .avatar');
    expect(avatar).toBeNull();
  });

  it('does not insert avatar when showAvatars is false in settings', () => {
    localStorage.setItem('appSettings', JSON.stringify({ showAvatars: false }));

    document.body.innerHTML = `
      <div class="event" data-kind="1" data-pubkey="pk1">
        <div class="event-name">
          <div class="event-name-text">
            <div class="event-name-primary">
              <span class="name" data-pubkey="pk1">User 1</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const state = {
      profiles: new Map([
        ['pk1', { name: 'User 1', picture: 'https://example.com/pic.png', loaded: true }]
      ])
    };

    updateAvatarDom(state, 'pk1');

    const avatar = document.querySelector('.event-name .avatar');
    expect(avatar).toBeNull();
  });

  it('updateNameDom triggers updateAvatarDom', () => {
    document.body.innerHTML = `
      <div class="event" data-kind="1" data-pubkey="pk1">
        <div class="event-name">
          <div class="event-name-text">
            <div class="event-name-primary">
              <span class="name" data-pubkey="pk1">npub1...</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const state = {
      profiles: new Map([
        ['pk1', { display_name: 'Alice', picture: 'https://example.com/alice.png', loaded: true }]
      ])
    };

    updateNameDom(state, 'pk1', { npubEncode: (pk) => pk });

    const nameSpan = document.querySelector('.name');
    expect(nameSpan.textContent).toBe('Alice');

    const avatar = document.querySelector('.event-name .avatar');
    expect(avatar).not.toBeNull();
    expect(avatar.src).toBe('https://example.com/alice.png');
  });
});
