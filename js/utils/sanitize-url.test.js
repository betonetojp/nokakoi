import { describe, it, expect } from 'vitest';
import { sanitizeUrlCandidate } from './sanitize-url.js';

describe('sanitizeUrlCandidate', () => {
  it('allows http and https', () => {
    expect(sanitizeUrlCandidate('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(sanitizeUrlCandidate('http://example.com/')).toBe('http://example.com/');
  });

  it('rejects javascript and non-image data schemes', () => {
    expect(sanitizeUrlCandidate('javascript:alert(1)')).toBeNull();
    expect(sanitizeUrlCandidate('data:text/html,hi')).toBeNull();
    expect(sanitizeUrlCandidate('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBeNull();
  });

  it('allows safe data:image/ base64 URIs with internal whitespace or newlines', () => {
    const validDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    expect(sanitizeUrlCandidate(validDataUri)).toBe(validDataUri);

    const dataUriWithNewlines = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA\nAbUAAAG1CAYAAAB+qmrdAAAACXBIWXMA\nAC4jAAAu';
    expect(sanitizeUrlCandidate(dataUriWithNewlines)).toBe(dataUriWithNewlines);
  });

  it('rejects empty and oversized input', () => {
    expect(sanitizeUrlCandidate('')).toBeNull();
    expect(sanitizeUrlCandidate(null)).toBeNull();
    expect(sanitizeUrlCandidate('https://x.com/' + 'a'.repeat(3000))).toBeNull();
  });

  it('resolves relative URLs against base', () => {
    expect(sanitizeUrlCandidate('/img.png', 'https://cdn.example/')).toBe('https://cdn.example/img.png');
  });
});
