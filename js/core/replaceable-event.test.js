import { describe, expect, it, vi } from 'vitest';

vi.mock('./relay.js', () => ({
  getReadRelays: () => ['wss://relay.example'],
  getWriteRelays: () => [],
}));
vi.mock('../features/post/actions.js', () => ({
  signEventWithMode: vi.fn(),
}));
vi.mock('../utils/utils.js', () => ({
  awaitAny: vi.fn(),
}));

import { fetchLatestEvent } from './replaceable-event.js';

describe('fetchLatestEvent', () => {
  it('reports the first event and later newer ones, then resolves the newest', async () => {
    const seen = [];
    let handlers = null;
    const pool = {
      subscribeMany(_relays, _filters, cbs) {
        handlers = cbs;
        return { close: vi.fn() };
      },
    };

    const progress = [];
    const pending = fetchLatestEvent({ pool, relays: [] }, 10005, 'aa', {
      timeout: 4000,
      onEvent: (event) => seen.push(event.id),
      onProgress: (state) => progress.push({ ...state }),
    });

    handlers.onevent({ id: 'old', created_at: 10 });
    handlers.onevent({ id: 'new', created_at: 20 });
    handlers.onevent({ id: 'older', created_at: 5 });
    handlers.onevent({ id: 'same', created_at: 20 });
    handlers.oneose();

    await expect(pending).resolves.toMatchObject({ id: 'new' });
    expect(seen).toEqual(['old', 'new']);
    expect(progress[0]).toEqual({ settled: 0, total: 1, done: false });
    expect(progress.at(-1)).toEqual({ settled: 1, total: 1, done: true });
  });
});
