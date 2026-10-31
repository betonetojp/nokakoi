// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/i18n.js', () => ({
  t: (key) => key
}));

import {
  setChannelTarget,
  getChannelTarget,
  clearChannelTarget,
  isChannelChatOpen
} from '../post/composer.js';

describe('pinned channel composer targeting and isChannelChatOpen', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="tabs">
        <button class="tab" data-tab="home">Home</button>
        <button class="tab active" data-tab="channel-rootA"># Channel A</button>
        <button class="tab" data-tab="channel-rootB"># Channel B</button>
      </div>
      <div id="replyContext" hidden>
        <span class="reply-context-label"></span>
        <button id="cancelReply"></button>
        <button id="changeGeohashLabel"></button>
        <div id="replyContextContent"></div>
      </div>
      <div id="composerTitle"></div>
      <textarea id="noteInput"></textarea>
    `;
    clearChannelTarget();
  });

  it('reports isChannelChatOpen as true when a pinned channel tab is active', () => {
    expect(isChannelChatOpen()).toBe(true);

    // Switch active tab to home
    document.querySelector('.tab[data-tab="channel-rootA"]').classList.remove('active');
    document.querySelector('.tab[data-tab="home"]').classList.add('active');
    expect(isChannelChatOpen()).toBe(false);
  });

  it('accepts setChannelTarget when rootId matches active pinned channel tab', () => {
    setChannelTarget({ rootId: 'rootA', name: 'Channel A', relays: [] });
    expect(getChannelTarget()).toEqual({ rootId: 'rootA', name: 'Channel A', relays: [] });
  });

  it('ignores setChannelTarget when rootId does NOT match active pinned channel tab (prevents async override)', () => {
    // Active is channel-rootA, late async response comes from channel-rootB
    setChannelTarget({ rootId: 'rootA', name: 'Channel A', relays: [] });
    expect(getChannelTarget()?.rootId).toBe('rootA');

    // Late async callback from rootB should be rejected
    setChannelTarget({ rootId: 'rootB', name: 'Channel B', relays: [] });
    expect(getChannelTarget()?.rootId).toBe('rootA');
  });

  it('clears channel target when clearChannelTarget is called', () => {
    setChannelTarget({ rootId: 'rootA', name: 'Channel A', relays: [] });
    expect(getChannelTarget()).not.toBeNull();

    clearChannelTarget();
    expect(getChannelTarget()).toBeNull();
  });
});
