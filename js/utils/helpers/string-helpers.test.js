import { describe, expect, it } from 'vitest';
import { fmtTime, formatLoadBeforeTime } from './string-helpers.js';

describe('fmtTime', () => {
  it('formats timestamp from today with time only', () => {
    const now = new Date();
    const ts = Math.floor(now.getTime() / 1000);
    const result = fmtTime(ts);
    // Should contain : (HH:mm:ss)
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });

  it('formats timestamp from current year but different day without year', () => {
    const now = new Date();
    // 3 days ago, or 3 days later, keeping same year
    const pastDate = new Date(now.getFullYear(), (now.getMonth() + 1) % 12, 1, 12, 30);
    if (pastDate.getFullYear() === now.getFullYear()) {
      const ts = Math.floor(pastDate.getTime() / 1000);
      const result = fmtTime(ts);
      expect(result).not.toContain(String(now.getFullYear()));
    }
  });

  it('formats timestamp from a previous year including year', () => {
    const prevYearDate = new Date(2023, 4, 15, 14, 30);
    const ts = Math.floor(prevYearDate.getTime() / 1000);
    const result = fmtTime(ts);
    expect(result).toContain('2023');
  });
});

describe('formatLoadBeforeTime', () => {
  it('formats current year timestamp as M/D HH:mm', () => {
    const now = new Date();
    const d = new Date(now.getFullYear(), 9, 19, 14, 5); // Oct 19, 14:05
    const ts = Math.floor(d.getTime() / 1000);
    expect(formatLoadBeforeTime(ts)).toBe('10/19 14:05');
  });

  it('formats previous year timestamp as YYYY/M/D HH:mm', () => {
    const d = new Date(2024, 0, 5, 9, 3); // Jan 5, 2024, 09:03
    const ts = Math.floor(d.getTime() / 1000);
    expect(formatLoadBeforeTime(ts)).toBe('2024/1/5 09:03');
  });

  it('returns empty string for invalid inputs', () => {
    expect(formatLoadBeforeTime(null)).toBe('');
    expect(formatLoadBeforeTime(undefined)).toBe('');
    expect(formatLoadBeforeTime(0)).toBe('');
    expect(formatLoadBeforeTime(-100)).toBe('');
    expect(formatLoadBeforeTime(NaN)).toBe('');
  });
});
