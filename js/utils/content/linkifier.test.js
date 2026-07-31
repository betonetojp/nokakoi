import { describe, it, expect } from 'vitest';
import { NOSTR_URI_REGEX } from './text-preview.js';

describe('NOSTR_URI_REGEX', () => {
  it('matches nostr:npub1 surrounded by Japanese characters', () => {
    const text = '作者：nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6です。';
    const matches = Array.from(text.matchAll(NOSTR_URI_REGEX));
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6');
  });

  it('matches standalone npub1 without nostr: prefix surrounded by Japanese characters', () => {
    const text = '作者：npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6です。';
    const matches = Array.from(text.matchAll(NOSTR_URI_REGEX));
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6');
  });
});
