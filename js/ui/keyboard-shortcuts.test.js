// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { setupKeyboardShortcuts, setSelectedEventEl } from './keyboard-shortcuts.js';

describe('keyboard shortcuts V and Shift+V for event detail', () => {
  beforeAll(() => {
    setupKeyboardShortcuts({}, {
      nip19: {},
      clearReplyTarget: vi.fn(),
      findEventById: vi.fn(),
      revealComposer: vi.fn(),
      setQuoteTarget: vi.fn(),
      showProfileModalProxy: vi.fn(),
      $: (selector) => document.querySelector(selector)
    });
  });

  beforeEach(() => {
    setSelectedEventEl(null);
    document.body.innerHTML = `
      <div id="feeds">
        <div class="feed active" id="feed-global">
          <div class="event" data-event-id="plain-ev">
            <div class="event-bottom-row">
              <div class="event-time-kind">
                <span class="time" role="button" tabindex="0">10:00</span>
              </div>
            </div>
          </div>
          <div class="event" data-event-id="quote-ev">
            <div class="nostr-quote" data-event-id="ref-ev">Quote content</div>
            <div class="event-bottom-row">
              <div class="event-time-kind">
                <span class="time" role="button" tabindex="0">10:05</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  it('triggers .time click when V key is pressed on a plain event without references', async () => {
    const plainEv = document.querySelector('[data-event-id="plain-ev"]');
    const timeEl = plainEv.querySelector('.time');
    const timeClickSpy = vi.fn();
    timeEl.onclick = timeClickSpy;

    setSelectedEventEl(plainEv);

    const event = new KeyboardEvent('keydown', { key: 'v', bubbles: true });
    document.dispatchEvent(event);

    // Wait microtask for async fallback
    await Promise.resolve();
    await Promise.resolve();

    expect(timeClickSpy).toHaveBeenCalledTimes(1);
  });

  it('triggers reference click when V key is pressed on an event with reference', async () => {
    const quoteEv = document.querySelector('[data-event-id="quote-ev"]');
    const refEl = quoteEv.querySelector('.nostr-quote');
    const timeEl = quoteEv.querySelector('.time');

    const refClickSpy = vi.fn();
    const timeClickSpy = vi.fn();
    refEl.onclick = refClickSpy;
    timeEl.onclick = timeClickSpy;

    setSelectedEventEl(quoteEv);

    const event = new KeyboardEvent('keydown', { key: 'v', bubbles: true });
    document.dispatchEvent(event);

    await Promise.resolve();
    await Promise.resolve();

    expect(refClickSpy).toHaveBeenCalledTimes(1);
    expect(timeClickSpy).not.toHaveBeenCalled();
  });

  it('triggers .time click of the selected event when Shift+V is pressed even if it has references', async () => {
    const quoteEv = document.querySelector('[data-event-id="quote-ev"]');
    const refEl = quoteEv.querySelector('.nostr-quote');
    const timeEl = quoteEv.querySelector('.time');

    const refClickSpy = vi.fn();
    const timeClickSpy = vi.fn();
    refEl.onclick = refClickSpy;
    timeEl.onclick = timeClickSpy;

    setSelectedEventEl(quoteEv);

    const event = new KeyboardEvent('keydown', { key: 'v', shiftKey: true, bubbles: true });
    document.dispatchEvent(event);

    await Promise.resolve();
    await Promise.resolve();

    expect(timeClickSpy).toHaveBeenCalledTimes(1);
    expect(refClickSpy).not.toHaveBeenCalled();
  });
});
