// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  getMentionLastViewedKeys,
  initializeMentionLastViewed,
  readMentionLastViewed,
  writeMentionLastViewed,
} from './mention-last-viewed.js';

const ACCOUNT_A = 'A'.repeat(64);
const ACCOUNT_B = 'b'.repeat(64);

describe('account-scoped mention last-viewed state', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('normalizes pubkeys and keeps two accounts independent', () => {
    writeMentionLastViewed({ at: 100, id: 'mention-a' }, ` ${ACCOUNT_A} `);
    writeMentionLastViewed({ at: 200, id: 'mention-b' }, ACCOUNT_B);

    expect(getMentionLastViewedKeys(ACCOUNT_A).at)
      .toBe(`mentions_last_viewed_at.${ACCOUNT_A.toLowerCase()}`);
    expect(readMentionLastViewed(ACCOUNT_A)).toEqual({ at: 100, id: 'mention-a' });
    expect(readMentionLastViewed(ACCOUNT_B)).toEqual({ at: 200, id: 'mention-b' });
  });

  it('migrates legacy state to only the first loaded account', () => {
    localStorage.setItem('mentions_last_viewed_at', '123');
    localStorage.setItem('mentions_last_viewed_id', 'legacy-mention');

    expect(initializeMentionLastViewed(ACCOUNT_A, 999))
      .toEqual({ at: 123, id: 'legacy-mention' });
    expect(localStorage.getItem('mentions_last_viewed_at')).toBeNull();
    expect(localStorage.getItem('mentions_last_viewed_id')).toBeNull();

    expect(initializeMentionLastViewed(ACCOUNT_B, 999))
      .toEqual({ at: 999, id: '' });
    expect(readMentionLastViewed(ACCOUNT_A)).toEqual({ at: 123, id: 'legacy-mention' });
    expect(readMentionLastViewed(ACCOUNT_B)).toEqual({ at: 999, id: '' });
  });
});
