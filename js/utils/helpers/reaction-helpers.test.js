// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  resolveReactionCustomEmoji,
  buildReactionEmojiTags,
  buildStoredReactionValue,
  NOKAKOI_DEFAULT_ICON_URL,
} from './reaction-helpers.js';
import { formatReaction, setReactionDisplay } from '../../ui/renderers/reaction-renderer.js';

describe('reaction-helpers: :nokakoi: resolution', () => {
  it('resolves :nokakoi: to an absolute public https URL', () => {
    const resolved = resolveReactionCustomEmoji(':nokakoi:');
    expect(resolved).not.toBeNull();
    expect(resolved.shortcode).toBe('nokakoi');
    expect(resolved.url).toBe(NOKAKOI_DEFAULT_ICON_URL);
    expect(resolved.url.startsWith('https://')).toBe(true);
  });

  it('builds emoji tags with absolute URL for :nokakoi:', () => {
    const tags = buildReactionEmojiTags(':nokakoi:');
    expect(tags).toEqual([['emoji', 'nokakoi', NOKAKOI_DEFAULT_ICON_URL]]);
  });

  it('normalizes legacy relative icon/nokakoi.png tag to absolute URL', () => {
    const legacyReaction = {
      content: ':nokakoi:',
      emojiTags: [['emoji', 'nokakoi', 'icon/nokakoi.png']]
    };
    const resolved = resolveReactionCustomEmoji(legacyReaction);
    expect(resolved.url).toBe(NOKAKOI_DEFAULT_ICON_URL);

    const stored = buildStoredReactionValue(legacyReaction);
    expect(stored.emojiTags).toEqual([['emoji', 'nokakoi', NOKAKOI_DEFAULT_ICON_URL]]);
  });
});

describe('reaction-renderer: :nokakoi: display', () => {
  it('formats :nokakoi: into img tag with absolute URL even without explicit emojiTags', () => {
    const html = formatReaction(':nokakoi:');
    expect(html).toContain('src="https://nokakoi.com/app/icon/nokakoi.png"');
    expect(html).toContain('class="custom-emoji"');
  });

  it('formats :nokakoi: with legacy relative tag by upgrading to absolute URL', () => {
    const html = formatReaction(':nokakoi:', [['emoji', 'nokakoi', 'icon/nokakoi.png']]);
    expect(html).toContain('src="https://nokakoi.com/app/icon/nokakoi.png"');
    expect(html).not.toContain('src="icon/nokakoi.png"');
  });

  it('updates reaction button with absolute URL image for :nokakoi:', () => {
    const btn = document.createElement('button');
    setReactionDisplay(btn, ':nokakoi:', [['emoji', 'nokakoi', 'icon/nokakoi.png']]);
    const img = btn.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.src).toBe(NOKAKOI_DEFAULT_ICON_URL);
  });
});
