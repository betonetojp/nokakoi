// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/relay.js', () => ({
  profileIndexerRelays: ['wss://profile.example', 'wss://profile2.example']
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

import { updateAvatarDom, updateNameDom, updateZapButtonDom, getProfileLightningAddress } from './profile.js';

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

describe('getProfileLightningAddress', () => {
  it('trims lud16 and ignores empty strings', () => {
    expect(getProfileLightningAddress({ lud16: '  a@b.com  ' })).toBe('a@b.com');
    expect(getProfileLightningAddress({ lud16: '  ', lud06: 'lnurl1abc' })).toBe('lnurl1abc');
    expect(getProfileLightningAddress({ lud16: '', lud06: '' })).toBe('');
    expect(getProfileLightningAddress(null)).toBe('');
  });
});

describe('updateZapButtonDom', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows zap button only on posts authored by the pubkey with lightning', () => {
    document.body.innerHTML = `
      <div class="event" data-kind="1" data-pubkey="alice">
        <div class="event-top-row">
          <span class="name" data-pubkey="alice">Alice</span>
          <button class="btn-zap d-none"></button>
        </div>
        <div class="content">
          <a class="nostr-link nostr-npub name" data-pubkey="bob">@bob</a>
        </div>
      </div>
      <div class="event" data-kind="1" data-pubkey="bob">
        <div class="event-top-row">
          <span class="name" data-pubkey="bob">Bob</span>
          <button class="btn-zap d-none"></button>
        </div>
      </div>
    `;

    const state = {
      profiles: new Map([
        ['alice', { name: 'Alice', loaded: true }],
        ['bob', { name: 'Bob', lud16: 'bob@coinos.io', loaded: true }]
      ])
    };

    updateZapButtonDom(state, 'bob');

    expect(document.querySelector('.event[data-pubkey="alice"] .btn-zap').classList.contains('d-none')).toBe(true);
    expect(document.querySelector('.event[data-pubkey="bob"] .btn-zap').classList.contains('d-none')).toBe(false);
  });

  it('shows zap buttons without NWC when the author has a lightning address', () => {
    document.body.innerHTML = `
      <div class="event" data-kind="1" data-pubkey="bob">
        <div class="event-top-row">
          <button class="btn-zap d-none"></button>
        </div>
      </div>
    `;
    const state = {
      profiles: new Map([
        ['bob', { name: 'Bob', lud16: 'bob@coinos.io', loaded: true }]
      ])
    };
    updateZapButtonDom(state, 'bob');
    expect(document.querySelector('.btn-zap').classList.contains('d-none')).toBe(false);
  });
});

describe('profile cache optimization', () => {
  it('sanitizeProfileForCache strips heavy fields like about and banner', async () => {
    const { sanitizeProfileForCache } = await import('./profile.js');
    const heavyProfile = {
      name: 'alice',
      display_name: 'Alice',
      picture: 'https://example.com/pic.png',
      nip05: 'alice@example.com',
      lud16: 'alice@coinos.io',
      about: 'A'.repeat(50000), // Huge about string
      banner: 'https://example.com/huge-banner.jpg',
      extraField: 'should be stripped'
    };

    const sanitized = sanitizeProfileForCache(heavyProfile, 123456789);
    expect(sanitized).toEqual({
      name: 'alice',
      display_name: 'Alice',
      picture: 'https://example.com/pic.png',
      nip05: 'alice@example.com',
      lud16: 'alice@coinos.io',
      cachedAt: 123456789
    });
    expect(sanitized.about).toBeUndefined();
    expect(sanitized.banner).toBeUndefined();
    expect(sanitized.extraField).toBeUndefined();
  });

  it('saveProfilesBatchToCache and flushProfilesCacheToStorage write sanitized data to localStorage', async () => {
    const { saveProfilesBatchToCache, flushProfilesCacheToStorage } = await import('./profile.js');
    localStorage.clear();

    saveProfilesBatchToCache([
      {
        pubkey: 'pk_heavy_user',
        profile: {
          name: 'HeavyUser',
          about: 'Huge about text '.repeat(1000),
          picture: 'https://example.com/p.jpg'
        }
      }
    ]);

    // Flush immediately to test storage content
    flushProfilesCacheToStorage();

    const stored = JSON.parse(localStorage.getItem('nostr_profiles_cache') || '{}');
    expect(stored.pk_heavy_user).toBeDefined();
    expect(stored.pk_heavy_user.name).toBe('HeavyUser');
    expect(stored.pk_heavy_user.picture).toBe('https://example.com/p.jpg');
    expect(stored.pk_heavy_user.about).toBeUndefined();
  });
});

