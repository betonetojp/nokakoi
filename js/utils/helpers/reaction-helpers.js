import { getRegisteredTextShortcodeVariant, resolveCustomEmoji } from '../../features/emoji/custom-emoji-store.js';
import { logWarn } from './misc-helpers.js';

const REACTION_SHORTCODE_ONLY_RE = /^:([a-zA-Z0-9_+-]+):$/;

export function getReactionContent(reaction) {
  if (reaction && typeof reaction === 'object' && typeof reaction.content === 'string') {
    return reaction.content;
  }
  return (typeof reaction === 'string') ? reaction : '';
}

export function getReactionEmojiTags(reaction) {
  if (!reaction || typeof reaction !== 'object' || !Array.isArray(reaction.emojiTags)) return [];
  return reaction.emojiTags.filter(tag => Array.isArray(tag) && tag[0] === 'emoji' && tag[1] && tag[2]);
}

export function isReactionShortcodeOnly(reaction) {
  return REACTION_SHORTCODE_ONLY_RE.test(getReactionContent(reaction));
}

export function resolveReactionCustomEmoji(reaction) {
  const content = getReactionContent(reaction);
  const match = content.match(REACTION_SHORTCODE_ONLY_RE);
  if (!match) return null;

  const shortcode = match[1];
  const storedTag = getReactionEmojiTags(reaction).find(tag => tag[1] === shortcode && tag[2]);
  if (storedTag) {
    return {
      shortcode,
      url: String(storedTag[2]),
      address: storedTag[3] ? String(storedTag[3]) : ''
    };
  }

  try {
    const registered = getRegisteredTextShortcodeVariant(shortcode);
    if (registered && registered.url) {
      return {
        shortcode,
        url: String(registered.url),
        address: registered.address ? String(registered.address) : ''
      };
    }
  } catch (e) { logWarn('[Utils] getRegisteredTextShortcodeVariant 失敗:', e); }

  try {
    const customEmojis = (typeof window !== 'undefined' && window.__customEmojis instanceof Map) ? window.__customEmojis : null;
    if (customEmojis) {
      const resolved = resolveCustomEmoji(customEmojis, shortcode);
      if (resolved && resolved.url) {
        return {
          shortcode,
          url: String(resolved.url),
          address: resolved.address ? String(resolved.address) : ''
        };
      }
    }
  } catch (e) { logWarn('[Utils] resolveCustomEmoji 失敗:', e); }

  if (shortcode === 'nokakoi') {
    let iconUrl = 'icon/nokakoi.png';
    return { shortcode, url: iconUrl, address: '' };
  }

  return null;
}

export function buildReactionEmojiTags(reaction) {
  const resolved = resolveReactionCustomEmoji(reaction);
  if (!resolved || !resolved.url) return [];
  const tag = ['emoji', resolved.shortcode, resolved.url];
  if (resolved.address) tag.push(resolved.address);
  return [tag];
}

export function buildStoredReactionValue(reaction) {
  const content = (getReactionContent(reaction) || '').trim();
  if (!content) return '';

  const emojiTags = getReactionEmojiTags(reaction);
  if (emojiTags.length) {
    return { content, emojiTags };
  }

  const resolvedEmojiTags = buildReactionEmojiTags(content);
  if (resolvedEmojiTags.length) {
    return { content, emojiTags: resolvedEmojiTags };
  }

  return content;
}

export function contrastColorForBg(color) {
  try {
    if (!color) return '#fff';
    let r, g, b;
    const s = String(color).trim();
    const mRgb = s.match(/^rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (mRgb) {
      r = parseInt(mRgb[1], 10);
      g = parseInt(mRgb[2], 10);
      b = parseInt(mRgb[3], 10);
    } else {
      const hex = s.replace('#', '');
      if (!/^[0-9a-fA-F]+$/.test(hex)) return '#fff';
      const full = (hex.length === 3) ? hex.split('').map(c => c + c).join('') : hex;
      const intval = parseInt(full, 16);
      r = (intval >> 16) & 255;
      g = (intval >> 8) & 255;
      b = intval & 255;
    }
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 180 ? '#000' : '#fff';
  } catch (e) { return '#fff'; }
}

export function resolveThemeButtonBg(type) {
  try {
    let sample = null;
    try { sample = document.getElementById('publishBtn'); } catch (e) { sample = null; }
    if (!sample) sample = document.querySelector('button:not(.secondary)');
    if (!sample) sample = document.querySelector('button.secondary') || document.querySelector('button');
    if (sample) {
      try {
        const cs = window.getComputedStyle(sample);
        const bg = (cs && cs.backgroundColor) ? cs.backgroundColor : (cs && cs.color) ? cs.color : null;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
      } catch (e) { }
    }
    try {
      const root = window.getComputedStyle(document.documentElement);
      const candidates = ['--button-bg', '--button-background', '--accent', '--accent-color', '--brand', '--button-primary'];
      for (const v of candidates) {
        try {
          const val = root.getPropertyValue(v);
          if (val && val.trim()) return val.trim();
        } catch (e) { }
      }
    } catch (e) { }
    if (type === 'error') return 'rgba(140,20,20,0.98)';
    if (type === 'success') return 'rgba(20,110,30,0.95)';
    return 'rgba(20,20,28,0.98)';
  } catch (e) {
    if (type === 'error') return 'rgba(140,20,20,0.98)';
    if (type === 'success') return 'rgba(20,110,30,0.95)';
    return 'rgba(20,20,28,0.98)';
  }
}
