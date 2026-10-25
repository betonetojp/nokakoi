// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { subCallbacks } = vi.hoisted(() => ({
  subCallbacks: []
}));

vi.mock('../../core/relay.js', () => ({
  subOnce: vi.fn((_state, key, filters, cb, relays) => {
    const unsub = vi.fn();
    subCallbacks.push({ key, filters, cb, relays, unsub });
    return unsub;
  }),
  getReadRelays: vi.fn((relays) => Array.isArray(relays) ? relays : []),
  relayConnect: vi.fn(),
  profileIndexerRelays: []
}));

vi.mock('../../ui/renderer.js', () => ({
  renderEvent: vi.fn((_state, ev) => {
    const div = document.createElement('div');
    div.className = 'event';
    div.dataset.eventId = ev.id;
    div.textContent = ev.content || ev.id;
    return div;
  })
}));

vi.mock('../../utils/i18n.js', () => ({
  t: (k) => k,
  applyTranslations: vi.fn()
}));

vi.mock('../../utils/url-parser.js', () => ({
  setupMediaLinkHandlers: vi.fn(),
  linkifyText: (s) => s
}));

vi.mock('./follow-editor.js', () => ({
  updateFollowButtonState: vi.fn(),
  toggleFollowUser: vi.fn()
}));

vi.mock('../mute/mute-editor.js', () => ({
  updateMuteButtonState: vi.fn(),
  toggleMuteUser: vi.fn()
}));

import '../../utils/url-parser.js';
import { showProfileModal, cleanupProfileModalUnsubs } from './profile-modal.js';

describe('showProfileModal pagination & session safety', () => {
  const alicePk = 'a'.repeat(64);
  const bobPk = 'b'.repeat(64);

  beforeEach(() => {
    subCallbacks.length = 0;
    document.body.innerHTML = `
      <div id="profileModal" hidden>
        <button id="profileClose" type="button"></button>
        <div id="profileContent">
          <div class="profile-info-row"></div>
          <div id="profileDisplayName"></div>
          <div id="profileUsername"></div>
          <div id="profileNpub"></div>
          <img id="profilePicture" class="d-none">
          <div id="profileEvents"></div>
        </div>
      </div>
    `;
  });

  afterEach(async () => {
    cleanupProfileModalUnsubs();
    await new Promise(resolve => setTimeout(resolve, 0));
    vi.clearAllMocks();
  });

  it('stops rendering load-more button once relay returns 0 older events (prevents infinite loop)', async () => {
    const state = {
      pubkey: alicePk,
      relays: ['wss://relay1.example.com'],
      profiles: new Map([[alicePk, { display_name: 'Alice' }]]),
      pool: { get: vi.fn(async () => null) }
    };

    showProfileModal(state, alicePk, null, {}, null);

    // Complete initial fetch with 2 events
    const initCall = subCallbacks.find(c => c.key.includes(`profile_kinds_${alicePk}_fetch_`));
    expect(initCall).toBeDefined();
    initCall.cb({ id: 'ev-100', kind: 1, pubkey: alicePk, created_at: 100, content: 'newest' }, 'wss://relay1.example.com', false);
    initCall.cb({ id: 'ev-90', kind: 1, pubkey: alicePk, created_at: 90, content: 'older' }, 'wss://relay1.example.com', true);
    await Promise.resolve();
    await Promise.resolve();

    const container = document.getElementById('profileEvents');
    expect(Array.from(container.querySelectorAll('.event')).map(e => e.dataset.eventId)).toEqual(['ev-100', 'ev-90']);

    const loadMoreBtn = container.querySelector('.load-more-btn');
    expect(loadMoreBtn).not.toBeNull();

    // Trigger load-more, relay returns 0 events + done=true
    const clickPromise = loadMoreBtn.onclick();
    const moreCall = subCallbacks.find(c => c.key.includes(`profile_kinds_${alicePk}_more_`));
    expect(moreCall).toBeDefined();
    moreCall.cb(null, 'wss://relay1.example.com', true);
    await clickPromise;

    // Load-more button MUST be gone (noMoreEvents = true), preventing 17x loop!
    expect(container.querySelector('.load-more-btn')).toBeNull();
  });

  it('inserts middle-timestamp events without duplicating existing tail events', async () => {
    const state = {
      pubkey: alicePk,
      relays: ['wss://relay1.example.com'],
      profiles: new Map([[alicePk, { display_name: 'Alice' }]]),
      pool: { get: vi.fn(async () => null) }
    };

    showProfileModal(state, alicePk, null, {}, null);

    const initCall = subCallbacks.find(c => c.key.includes(`profile_kinds_${alicePk}_fetch_`));
    initCall.cb({ id: 'ev-100', kind: 1, pubkey: alicePk, created_at: 100 }, 'wss://relay1.example.com', false);
    initCall.cb({ id: 'ev-60', kind: 1, pubkey: alicePk, created_at: 60 }, 'wss://relay1.example.com', true);
    await Promise.resolve();
    await Promise.resolve();

    const container = document.getElementById('profileEvents');
    const firstEl = container.querySelector('.event[data-event-id="ev-100"]');
    const loadMoreBtn = container.querySelector('.load-more-btn');

    const clickPromise = loadMoreBtn.onclick();
    const moreCall = subCallbacks.find(c => c.key.includes(`profile_kinds_${alicePk}_more_`));
    // Relay returns a middle-timestamp event (80) AND an older event (40)
    moreCall.cb({ id: 'ev-80', kind: 1, pubkey: alicePk, created_at: 80 }, 'wss://relay1.example.com', false);
    moreCall.cb({ id: 'ev-40', kind: 1, pubkey: alicePk, created_at: 40 }, 'wss://relay1.example.com', true);
    await clickPromise;

    const ids = Array.from(container.querySelectorAll('.event')).map(e => e.dataset.eventId);
    expect(ids).toEqual(['ev-100', 'ev-80', 'ev-60', 'ev-40']);
    // Existing DOM node for ev-100 was reused in place
    expect(container.querySelector('.event[data-event-id="ev-100"]')).toBe(firstEl);
  });

  it('ignores stale fetch completion from Alice after switching modal to Bob', async () => {
    const state = {
      pubkey: alicePk,
      relays: ['wss://relay1.example.com'],
      profiles: new Map([
        [alicePk, { display_name: 'Alice' }],
        [bobPk, { display_name: 'Bob' }]
      ]),
      pool: { get: vi.fn(async () => null) }
    };

    showProfileModal(state, alicePk, null, {}, null);
    const aliceInit = subCallbacks.find(c => c.key.includes(`profile_kinds_${alicePk}_fetch_`));

    // Switch immediately to Bob before Alice's relay responds
    showProfileModal(state, bobPk, null, {}, null);
    const bobInit = subCallbacks.find(c => c.key.includes(`profile_kinds_${bobPk}_fetch_`));

    bobInit.cb({ id: 'bob-1', kind: 1, pubkey: bobPk, created_at: 200 }, 'wss://relay1.example.com', true);
    aliceInit.cb({ id: 'alice-1', kind: 1, pubkey: alicePk, created_at: 300 }, 'wss://relay1.example.com', true);
    await Promise.resolve();
    await Promise.resolve();

    const container = document.getElementById('profileEvents');
    const ids = Array.from(container.querySelectorAll('.event')).map(e => e.dataset.eventId);
    expect(ids).toEqual(['bob-1']);
  });
});
