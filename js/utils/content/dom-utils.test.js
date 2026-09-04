// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { updateNostrNpubLinks } from './dom-utils.js';

describe('updateNostrNpubLinks', () => {
  beforeEach(() => {
    delete window.__nostrState;
  });

  it('updates npub link with petname when available', async () => {
    window.__nostrState = {
      profiles: new Map([['pk1', { display_name: 'Alice' }]]),
      followPetnames: new Map([['pk1', 'お気に入り']])
    };

    const container = document.createElement('div');
    container.innerHTML = '<a class="nostr-link nostr-npub name" data-pubkey="pk1">@npub1...</a>';

    await updateNostrNpubLinks(container);

    expect(container.innerHTML).toContain('petname-badge');
    expect(container.innerHTML).toContain('お気に入り');
  });

  it('updates npub link with profile display_name when no petname', async () => {
    window.__nostrState = {
      profiles: new Map([['pk2', { display_name: 'Bob' }]]),
      followPetnames: new Map()
    };

    const container = document.createElement('div');
    container.innerHTML = '<a class="nostr-link nostr-npub name" data-pubkey="pk2">@npub1...</a>';

    await updateNostrNpubLinks(container);

    expect(container.textContent).toBe('@Bob');
  });
});
