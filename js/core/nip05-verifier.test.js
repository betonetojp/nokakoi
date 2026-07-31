import { describe, it, expect } from 'vitest';
import { parseNip05, formatNip05Display } from './nip05-verifier.js';

describe('parseNip05', () => {
  it('parses name@domain correctly', () => {
    expect(parseNip05('bob@example.com')).toEqual({ name: 'bob', domain: 'example.com' });
    expect(parseNip05('Alice@Domain.COM')).toEqual({ name: 'alice', domain: 'domain.com' });
  });

  it('defaults name to _ when no @ is provided', () => {
    expect(parseNip05('example.com')).toEqual({ name: '_', domain: 'example.com' });
  });

  it('returns null for invalid inputs', () => {
    expect(parseNip05('')).toBeNull();
    expect(parseNip05(null)).toBeNull();
    expect(parseNip05('a@b@c')).toBeNull();
  });
});

describe('formatNip05Display', () => {
  it('omits _@ prefix for root domain identifiers', () => {
    expect(formatNip05Display('_@example.com')).toBe('example.com');
  });

  it('preserves custom username prefix', () => {
    expect(formatNip05Display('alice@example.com')).toBe('alice@example.com');
  });
});
