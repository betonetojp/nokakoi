/**
 * URL検出用の正規表現
 */
export const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;

/**
 * Nostr URI用の正規表現
 */
export const NOSTR_URI_REGEX = /(nostr:(npub|note|nprofile|nevent|naddr|nsec)[a-z0-9]+)/gi;

/**
 * :smile: のような絵文字ショートコード用正規表現
 */
export const EMOJI_SHORTCODE_REGEX = /:([a-zA-Z0-9_+-]+):/g;

/**
 * セクシー餃子で使用する Unicode Tag characters（隠し文字）
 */
export const HIDDEN_TAG_CHARS_RE = /[\u{E0100}-\u{E01EF}]+/gu;

export function getGraphemeLengthAt(text, index) {
  if (index >= text.length) return 0;
  const cp = text.codePointAt(index);
  return (cp && cp > 0xFFFF) ? 2 : 1;
}

export function collectMergedSkipRanges(text) {
  const skipRanges = [];
  let match;

  const urlRegex = new RegExp(URL_REGEX.source, URL_REGEX.flags);
  while ((match = urlRegex.exec(text)) !== null) {
    skipRanges.push({ start: match.index, end: match.index + match[0].length });
  }
  const nostrRegex = new RegExp(NOSTR_URI_REGEX.source, NOSTR_URI_REGEX.flags);
  while ((match = nostrRegex.exec(text)) !== null) {
    skipRanges.push({ start: match.index, end: match.index + match[0].length });
  }
  const emojiRegex = new RegExp(EMOJI_SHORTCODE_REGEX.source, EMOJI_SHORTCODE_REGEX.flags);
  while ((match = emojiRegex.exec(text)) !== null) {
    skipRanges.push({ start: match.index, end: match.index + match[0].length });
  }
  const hiddenTagRegex = new RegExp(HIDDEN_TAG_CHARS_RE.source, HIDDEN_TAG_CHARS_RE.flags);
  while ((match = hiddenTagRegex.exec(text)) !== null) {
    skipRanges.push({ start: match.index, end: match.index + match[0].length });
  }

  skipRanges.sort((a, b) => a.start - b.start);

  const merged = [];
  for (const r of skipRanges) {
    if (merged.length > 0 && r.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }

  return merged;
}

export function getEffectiveTextLength(text) {
  if (!text) return 0;
  const merged = collectMergedSkipRanges(text);

  let visibleCount = 0;
  let pos = 0;
  let si = 0;

  while (pos < text.length) {
    while (si < merged.length && pos >= merged[si].end) si++;
    if (si < merged.length && pos >= merged[si].start && pos < merged[si].end) {
      pos = merged[si].end;
      continue;
    }

    const step = getGraphemeLengthAt(text, pos) || 1;
    pos += step;
    visibleCount++;
  }

  return visibleCount;
}

export function getPreviewWithFullLinksAndEmojis(text, maxLength, maxLines = 0) {
  const merged = collectMergedSkipRanges(text);
  const effectiveLength = getEffectiveTextLength(text);

  let lineLimit = text.length;
  if (maxLines > 0) {
    let newlineCount = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') {
        newlineCount++;
        if (newlineCount === maxLines) {
          lineLimit = i;
          break;
        }
      }
    }
  }

  const needsCharTruncation = effectiveLength > maxLength;
  const needsLineTruncation = maxLines > 0 && lineLimit < text.length;

  if (!needsCharTruncation && !needsLineTruncation) return text;

  let visibleCount = 0;
  let pos = 0;
  let si = 0;
  const charLimit = needsCharTruncation ? maxLength : Infinity;

  while (pos < text.length && visibleCount < charLimit && pos < lineLimit) {
    while (si < merged.length && pos >= merged[si].end) si++;
    if (si < merged.length && pos >= merged[si].start && pos < merged[si].end) {
      pos = Math.min(merged[si].end, lineLimit);
      continue;
    }

    const nextSkipStart = si < merged.length ? merged[si].start : text.length;
    const nextBound = Math.min(nextSkipStart, lineLimit);
    if (pos >= nextBound) {
      pos = nextBound;
      continue;
    }

    const step = getGraphemeLengthAt(text, pos) || 1;
    pos += Math.min(step, nextBound - pos);
    visibleCount++;
  }

  return text.slice(0, pos);
}
