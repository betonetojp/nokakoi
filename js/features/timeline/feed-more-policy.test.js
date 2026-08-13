import { describe, expect, it } from 'vitest';

import {
  canStartMore,
  markMoreFinished,
  markMoreStarted,
  resetAutoMoreState
} from './feed-more-policy.js';

describe('automatic more policy', () => {
  it('allows smooth consecutive automatic pages after each successful settle', () => {
    const state = {};
    markMoreStarted(state, false, 1000);
    expect(canStartMore(state, false, 1001)).toBe(false);
    markMoreFinished(state, 3, 1200);

    expect(canStartMore(state, false, 1200)).toBe(true);
    markMoreStarted(state, false, 1200);
    markMoreFinished(state, 2, 1300);
    expect(canStartMore(state, false, 1300)).toBe(true);
    expect(canStartMore(state, true, 1300)).toBe(true);
  });

  it('stops automatic retries after exhaustion until manual action or history reset', () => {
    const state = {};
    markMoreStarted(state, false, 1000);
    markMoreFinished(state, 0, 1200);

    expect(canStartMore(state, false, 10000)).toBe(false);
    expect(canStartMore(state, true, 10000)).toBe(true);

    resetAutoMoreState(state, 20000, true);
    expect(canStartMore(state, false, 20000)).toBe(true);
  });
});
