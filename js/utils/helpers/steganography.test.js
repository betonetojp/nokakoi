// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { processHiddenTagChars } from './dom-helpers.js';
import { encodeHiddenTagChars } from './string-helpers.js';
import { parseSteganographyReaction } from '../../ui/modals/modals.js';
import { collectMergedSkipRanges, HIDDEN_TAG_CHARS_RE } from '../content/text-preview.js';

describe('Super Sexy Gyouza (multiline steganography)', () => {
  it('correctly encodes and decodes multiline text with newlines', () => {
    const rawText = '1行目の秘密\n2行目の秘密\n3行目の秘密';
    const encoded = encodeHiddenTagChars('🥟', rawText);

    const div = document.createElement('div');
    div.textContent = encoded;
    processHiddenTagChars(div);

    const emojiSpan = div.querySelector('.steganography-emoji');
    expect(emojiSpan).not.toBeNull();
    expect(emojiSpan.textContent).toBe('🥟');
    expect(emojiSpan.dataset.hidden).toBe(rawText);

    // Initial state: not opened
    expect(emojiSpan.querySelector('.steganography-revealed')).toBeNull();

    // Click to open
    emojiSpan.click();
    const popup = emojiSpan.querySelector('.steganography-revealed');
    expect(popup).not.toBeNull();
    expect(popup.textContent).toBe(rawText);
    expect(emojiSpan.classList.contains('steganography-open')).toBe(true);

    // Clicking inside popup does not close it (stopPropagation)
    popup.click();
    expect(emojiSpan.querySelector('.steganography-revealed')).not.toBeNull();

    // Clicking emojiSpan again closes it
    emojiSpan.click();
    expect(emojiSpan.querySelector('.steganography-revealed')).toBeNull();
    expect(emojiSpan.classList.contains('steganography-open')).toBe(false);
  });

  it('handles CRLF and tab characters', () => {
    const rawText = "タイトル\r\n\tインデントされた詳細";
    const encoded = encodeHiddenTagChars('🥟', rawText);

    const div = document.createElement('div');
    div.textContent = encoded;
    processHiddenTagChars(div);

    const emojiSpan = div.querySelector('.steganography-emoji');
    expect(emojiSpan).not.toBeNull();
    expect(emojiSpan.dataset.hidden).toBe(rawText);

    emojiSpan.click();
    const popup = emojiSpan.querySelector('.steganography-revealed');
    expect(popup).not.toBeNull();
    expect(popup.textContent).toBe(rawText);
  });

  it('supports autoExpand option for multiline text', () => {
    const rawText = '自動展開テキスト\n改行あり';
    const encoded = encodeHiddenTagChars('🥟', rawText);

    const div = document.createElement('div');
    div.textContent = encoded;
    processHiddenTagChars(div, { autoExpand: true });

    const emojiSpan = div.querySelector('.steganography-emoji');
    expect(emojiSpan).not.toBeNull();
    const popup = emojiSpan.querySelector('.steganography-revealed');
    expect(popup).not.toBeNull();
    expect(popup.textContent).toBe(rawText);
    expect(emojiSpan.classList.contains('steganography-open')).toBe(true);
  });

  it('handles tag characters with no preceding emoji by falling back to dumpling emoji', () => {
    const rawText = '絵文字なし隠し文字\n改行';
    const encoded = encodeHiddenTagChars('🥟', rawText);
    // Remove the visible dumpling emoji so only tag chars remain
    const tagOnly = encoded.replace(/🥟/g, '');

    const div = document.createElement('div');
    div.textContent = '前置き ' + tagOnly + ' 後置き';
    processHiddenTagChars(div);

    const emojiSpan = div.querySelector('.steganography-emoji');
    expect(emojiSpan).not.toBeNull();
    expect(emojiSpan.textContent).toBe('🥟');
    expect(emojiSpan.dataset.hidden).toBe(rawText);

    emojiSpan.click();
    const popup = emojiSpan.querySelector('.steganography-revealed');
    expect(popup).not.toBeNull();
    expect(popup.textContent).toBe(rawText);
  });

  it('correctly handles nested steganography with newlines in both levels', () => {
    const innerText = '最深部の秘密\n改行あり';
    const inner = encodeHiddenTagChars('🥟', innerText);
    const outerText = '外側の秘密\n' + inner;
    const outer = encodeHiddenTagChars('🥟', outerText);

    const div = document.createElement('div');
    div.textContent = outer;
    processHiddenTagChars(div);

    const outerSpan = div.querySelector('.steganography-emoji');
    expect(outerSpan).not.toBeNull();

    // Open outer
    outerSpan.click();
    const outerPopup = outerSpan.querySelector('.steganography-revealed');
    expect(outerPopup).not.toBeNull();

    // Inside outerPopup, there should be an inner steganography-emoji
    const innerSpan = outerPopup.querySelector('.steganography-emoji');
    expect(innerSpan).not.toBeNull();

    // Open inner
    innerSpan.click();
    const innerPopup = innerSpan.querySelector('.steganography-revealed');
    expect(innerPopup).not.toBeNull();
    expect(innerPopup.textContent).toBe(innerText);
  });

  it('parseSteganographyReaction handles multiline steganography correctly', () => {
    const rawText = '1行目\n2行目';
    const encoded = encodeHiddenTagChars('🥟', rawText);
    const result = parseSteganographyReaction(encoded);
    expect(result).not.toBeNull();
    expect(result.visibleEmoji).toBe('🥟');
    expect(result.decodedText).toBe(rawText);
  });

  it('collectMergedSkipRanges correctly identifies multiline tag chars', () => {
    const rawText = '改行入り\nテキスト';
    const encoded = encodeHiddenTagChars('🥟', rawText);
    const postContent = 'Hello ' + encoded + ' World';

    const ranges = collectMergedSkipRanges(postContent);
    expect(ranges.length).toBeGreaterThan(0);
    // The tag characters part should be covered by a skip range
    const tagMatch = HIDDEN_TAG_CHARS_RE.exec(postContent);
    expect(tagMatch).not.toBeNull();
    const covered = ranges.some(r => r.start <= tagMatch.index && r.end >= tagMatch.index + tagMatch[0].length);
    expect(covered).toBe(true);
  });
});
