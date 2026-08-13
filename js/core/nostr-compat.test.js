import { describe, expect, it, vi } from 'vitest';

import { makeIdempotentSubscription } from './nostr-compat.js';

describe('nostr subscription compatibility', () => {
  it('closes an underlying subscription only once and absorbs rejected close promises', async () => {
    const close = vi.fn(() => Promise.reject(new Error('socket already closed')));
    const subscription = makeIdempotentSubscription({ close });

    expect(() => subscription.close('eose')).not.toThrow();
    expect(() => subscription.close('timer')).not.toThrow();
    await Promise.resolve();

    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith('eose');
  });
});
