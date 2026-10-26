import { describe, it, expect, vi } from 'vitest';
import { awaitAny } from './misc-helpers.js';

describe('awaitAny', () => {
  it('resolves immediately when promises is null or empty', async () => {
    await expect(awaitAny(null)).resolves.toBeUndefined();
    await expect(awaitAny([])).resolves.toBeUndefined();
  });

  it('resolves immediately when at least one promise succeeds', async () => {
    const successPromise = Promise.resolve('ok: event received');
    const slowPromise = new Promise(() => {});
    const res = await awaitAny([successPromise, slowPromise]);
    expect(res).toBe('ok: event received');
  });

  it('treats "connection failure: ..." as an error and rejects when all relays fail to connect', async () => {
    const fail1 = Promise.resolve('connection failure: connect ECONNREFUSED 127.0.0.1');
    const fail2 = Promise.resolve('connection failure: getaddrinfo ENOTFOUND invalid.relay');
    await expect(awaitAny([fail1, fail2])).rejects.toThrow();
  });

  it('ignores connection failure on one relay if another relay succeeds', async () => {
    const fail = Promise.resolve('connection failure: timeout');
    const success = Promise.resolve('ok: accepted');
    const res = await awaitAny([fail, success]);
    expect(res).toBe('ok: accepted');
  });

  it('rescues with { delayed: true } when all relays fail with "publish timed out"', async () => {
    const to1 = Promise.reject(new Error('publish timed out'));
    const to2 = Promise.reject(new Error('publish timed out'));
    const res = await awaitAny([to1, to2]);
    expect(res).toEqual({ delayed: true });
  });

  it('rescues with { delayed: true } when one relay fails connection and another times out', async () => {
    const connFail = Promise.resolve('connection failure: error');
    const timedOut = Promise.reject(new Error('publish timed out'));
    const res = await awaitAny([connFail, timedOut]);
    expect(res).toEqual({ delayed: true });
  });

  it('re-throws error when a relay explicitly rejects with non-timeout error', async () => {
    const blocked = Promise.reject(new Error('blocked: spam detected'));
    const timedOut = Promise.reject(new Error('publish timed out'));
    await expect(awaitAny([blocked, timedOut])).rejects.toThrow();
  });

  it('resolves with { delayed: true } when fallbackTimeoutMs fires before any promise settles', async () => {
    vi.useFakeTimers();
    try {
      const slow = new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('publish timed out')), 4400);
      });
      const p = awaitAny([slow], 500);
      vi.advanceTimersByTime(501);
      const res = await p;
      expect(res).toEqual({ delayed: true });

      // 4400ms 後に遅延 reject されても unhandledrejection が起きないことを検証
      vi.advanceTimersByTime(4000);
    } finally {
      vi.useRealTimers();
    }
  });
});
