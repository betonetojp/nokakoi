import { describe, it, expect } from 'vitest';
import { NOSTR_URI_REGEX } from './text-preview.js';
import { linkifyText } from './linkifier.js';

describe('NOSTR_URI_REGEX', () => {
  it('matches nostr:npub1 surrounded by Japanese characters', () => {
    const text = '作者：nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6です。';
    const matches = Array.from(text.matchAll(NOSTR_URI_REGEX));
    expect(matches).toHaveLength(1);
    expect(matches[0][0]).toBe('nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6');
  });

  it('does not match standalone npub1 without nostr: prefix (kept as plain text)', () => {
    const text = '作者：npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6です。';
    const matches = Array.from(text.matchAll(NOSTR_URI_REGEX));
    expect(matches).toHaveLength(0);
  });
});

describe('linkifyText', () => {
  const npub = 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6';
  const nevent = 'nevent1qqsqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgaffult';
  const note = 'note1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsxthhhz';

  it('converts nostr:npub1 to a mention link', () => {
    const result = linkifyText(`hello nostr:${npub} world`);
    expect(result).toContain('nostr-link nostr-npub');
    expect(result).toContain(`data-uri="nostr:${npub}"`);
  });

  it('leaves standalone npub1 as plain text without linkifying', () => {
    const result = linkifyText(`hello ${npub} world`);
    expect(result).not.toContain('nostr-link');
    expect(result).not.toContain('data-uri');
    expect(result).toContain(npub);
  });

  it('converts nostr:nevent1 to a quote span', () => {
    const result = linkifyText(`Check this nostr:${nevent}`);
    expect(result).toContain('nostr-quote');
    expect(result).toContain(`data-uri="nostr:${nevent}"`);
  });

  it('leaves standalone nevent1 as plain text without quote span', () => {
    const result = linkifyText(`Check this ${nevent}`);
    expect(result).not.toContain('nostr-quote');
    expect(result).not.toContain('data-uri');
    expect(result).toContain(nevent);
  });

  it('converts nostr:note1 to a quote span', () => {
    const result = linkifyText(`Check this nostr:${note}`);
    expect(result).toContain('nostr-quote');
    expect(result).toContain(`data-uri="nostr:${note}"`);
  });

  it('leaves standalone note1 as plain text without quote span', () => {
    const result = linkifyText(`Check this ${note}`);
    expect(result).not.toContain('nostr-quote');
    expect(result).not.toContain('data-uri');
    expect(result).toContain(note);
  });
});

