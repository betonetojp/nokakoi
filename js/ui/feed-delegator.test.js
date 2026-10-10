// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupDelegatedFeedHandlers } from './feed-delegator.js';
import { getSelectedEventEl, setSelectedEventEl } from './keyboard-shortcuts.js';

describe('feed-delegator selection toggle', () => {
  let state;
  let settingsManager;

  beforeEach(() => {
    setSelectedEventEl(null);
    document.body.innerHTML = `
      <div id="feeds">
        <div class="feed active" id="feed-global">
          <div class="event" data-event-id="ev-1">
            <div class="event-content">Hello world</div>
            <a href="https://example.com" class="event-link">Link</a>
            <button type="button" class="btn-more">More</button>
          </div>
          <div class="event" data-event-id="ev-2">
            <div class="event-content">Second event</div>
          </div>
        </div>
      </div>
    `;
  });

  // Setup handler once on document
  setupDelegatedFeedHandlers(
    { feeds: { global: { list: [], map: new Map() } } },
    {
      settings: { reactionDefault: '+' },
      get: vi.fn(() => '+'),
      saveUserReaction: vi.fn()
    },
    null
  );

  it('selects an event on click without auto-scrolling', () => {
    const ev1 = document.querySelector('[data-event-id="ev-1"]');
    const content = ev1.querySelector('.event-content');

    content.click();
    expect(getSelectedEventEl()).toBe(ev1);
    expect(ev1.classList.contains('event-selected')).toBe(true);
  });

  it('deselects the event when clicked again', () => {
    const ev1 = document.querySelector('[data-event-id="ev-1"]');
    const content = ev1.querySelector('.event-content');

    // First click: select
    content.click();
    expect(getSelectedEventEl()).toBe(ev1);
    expect(ev1.classList.contains('event-selected')).toBe(true);

    // Second click on the same event: deselect
    content.click();
    expect(getSelectedEventEl()).toBe(null);
    expect(ev1.classList.contains('event-selected')).toBe(false);
  });

  it('does not toggle selection when interactive elements (link, button) are clicked', () => {
    const ev1 = document.querySelector('[data-event-id="ev-1"]');
    const link = ev1.querySelector('.event-link');
    const btn = ev1.querySelector('.btn-more');

    link.click();
    expect(getSelectedEventEl()).toBe(null);
    expect(ev1.classList.contains('event-selected')).toBe(false);

    btn.click();
    expect(getSelectedEventEl()).toBe(null);
    expect(ev1.classList.contains('event-selected')).toBe(false);
  });

  it('switches selection when clicking a different event', () => {
    const ev1 = document.querySelector('[data-event-id="ev-1"]');
    const ev2 = document.querySelector('[data-event-id="ev-2"]');

    ev1.querySelector('.event-content').click();
    expect(getSelectedEventEl()).toBe(ev1);

    ev2.querySelector('.event-content').click();
    expect(getSelectedEventEl()).toBe(ev2);
    expect(ev1.classList.contains('event-selected')).toBe(false);
    expect(ev2.classList.contains('event-selected')).toBe(true);
  });
});
