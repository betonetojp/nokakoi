// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSteganographyReaction, showReactionModal } from './modals.js';
import { encodeHiddenTagChars } from '../../utils/helpers/string-helpers.js';

describe('steganography in reaction history', () => {
  it('returns null for non-steganography strings', () => {
    expect(parseSteganographyReaction('❤️')).toBe(null);
    expect(parseSteganographyReaction(':custom_emoji:')).toBe(null);
    expect(parseSteganographyReaction('+')).toBe(null);
  });

  it('correctly parses and decodes a steganography emoji', () => {
    const encoded = encodeHiddenTagChars('🥟', 'ぎょうざ');
    const result = parseSteganographyReaction(encoded);
    expect(result).not.toBe(null);
    expect(result.visibleEmoji).toBe('🥟');
    expect(result.decodedText).toBe('ぎょうざ');
  });

  it('correctly parses and recursively decodes nested steganography', () => {
    const inner = encodeHiddenTagChars('🥟', '秘密の味');
    const outer = encodeHiddenTagChars('🥟', inner);
    const result = parseSteganographyReaction(outer);
    expect(result).not.toBe(null);
    expect(result.visibleEmoji).toBe('🥟');
    expect(result.decodedText).toBe('秘密の味');
  });

  it('renders steganography in recent reactions and populates input on click without folding', () => {
    const encoded = encodeHiddenTagChars('🥟', '大盛り餃子');
    localStorage.setItem('recentReactions', JSON.stringify([encoded]));

    document.body.innerHTML = `
      <div id="reactionModal" hidden>
        <textarea id="reactionInput"></textarea>
        <button id="reactionSave"></button>
        <button id="reactionSaveAndReact"></button>
        <button id="reactionReactOnly"></button>
        <button id="reactionClose"></button>
        <span id="reactionStatus"></span>
        <div id="reactionRecentList"></div>
      </div>
    `;

    showReactionModal('+', vi.fn(), null, {});

    const recentList = document.getElementById('reactionRecentList');
    const btn = recentList.querySelector('.quick-reaction');
    expect(btn).not.toBe(null);
    expect(btn.classList.contains('quick-reaction-steganography')).toBe(true);

    const emojiSpan = btn.querySelector('.quick-reaction-emoji');
    const textSpan = btn.querySelector('.quick-reaction-steganography-text');
    expect(emojiSpan).not.toBe(null);
    expect(emojiSpan.textContent).toBe('🥟');
    expect(textSpan).not.toBe(null);
    expect(textSpan.textContent).toBe('大盛り餃子');

    // Click should populate input without folding
    const input = document.getElementById('reactionInput');
    btn.click();
    expect(input.value).toBe(encoded);
    // Button content still contains the text (not folded)
    expect(btn.querySelector('.quick-reaction-steganography-text').textContent).toBe('大盛り餃子');
  });
});
