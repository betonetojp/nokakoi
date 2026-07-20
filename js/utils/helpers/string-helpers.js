export function replaceBadgeEmoji(html) {
  if (typeof html !== 'string') return html;
  return html.replace(/\u200B📛/g, '<span class="icon petname-badge" role="img" aria-label="📛"></span>');
}

export function fmtTime(ts) {
  const d = new Date(ts * 1000);
  try {
    const now = new Date();
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return d.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return d.toLocaleString();
  }
}

export function truncateByBytes(str, maxBytes) {
  if (!str) return '';
  let bytes = 0;
  let i = 0;
  while (i < str.length) {
    const c = str.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
      bytes += 2;
      if (bytes > maxBytes) break;
      i += 2;
    } else {
      bytes += (c <= 0x7F) ? 1 : 2;
      if (bytes > maxBytes) break;
      i++;
    }
  }
  return i < str.length ? str.slice(0, i) + '...' : str;
}

export function truncateName(str) {
  return truncateByGraphemeVisible(str, 16);
}

const HIDDEN_TAG_CHARS_RE = /[\u{E0100}-\u{E01EF}]+/u;

export function truncateByGraphemeVisible(str, maxVisibleChars) {
  if (!str || !Number.isFinite(maxVisibleChars) || maxVisibleChars <= 0) return '';

  let pos = 0;
  let visible = 0;
  let cutPos = str.length;

  while (pos < str.length) {
    const tail = str.slice(pos);
    const hidden = HIDDEN_TAG_CHARS_RE.exec(tail);
    if (hidden && hidden.index === 0) {
      pos += hidden[0].length;
      continue;
    }

    if (visible >= maxVisibleChars) {
      cutPos = pos;
      break;
    }

    const c = str.charCodeAt(pos);
    let step = 1;
    let width;
    if (c >= 0xD800 && c <= 0xDBFF && pos + 1 < str.length) {
      step = 2;
      width = 2;
    } else {
      width = (c <= 0x7F) ? 1 : 2;
    }

    if (visible + width > maxVisibleChars) {
      cutPos = pos;
      break;
    }

    pos += step;
    visible += width;
  }

  if (cutPos === str.length && pos >= str.length) return str;

  let end = cutPos;
  while (end < str.length) {
    const hidden = HIDDEN_TAG_CHARS_RE.exec(str.slice(end));
    if (!(hidden && hidden.index === 0)) break;
    end += hidden[0].length;
  }

  return str.slice(0, end) + '...';
}

export function getGraphemeClusterEnd(text) {
  if (!text) return 0;

  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      for (const segment of segmenter.segment(text)) {
        return segment.index + segment.segment.length;
      }
    } catch (e) { }
  }

  const regionalFlagPattern = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
  const flagMatch = regionalFlagPattern.exec(text);
  if (flagMatch && flagMatch.index === 0) {
    return flagMatch[0].length;
  }

  const emojiPattern = /(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}](?:\u{FE0E}\u{FE0F})?(?:\u200D[\p{Emoji_Presentation}\p{Extended_Pictographic}](?:\u{FE0E}\u{FE0F})?)*)(?:[\u{1F3FB}-\u{1F3FF}])?/u;
  const match = emojiPattern.exec(text);
  if (match) {
    return match[0].length;
  }

  return text.length > 0 ? 1 : 0;
}

export function getLastGraphemeClusterRange(text) {
  if (!text) return { start: 0, end: 0 };

  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      let lastSegment = null;
      for (const segment of segmenter.segment(text)) {
        lastSegment = segment;
      }
      if (lastSegment) {
        return {
          start: lastSegment.index,
          end: lastSegment.index + lastSegment.segment.length,
        };
      }
    } catch (e) { }
  }

  let start = 0;
  let end = 0;
  while (end < text.length) {
    start = end;
    const clusterLength = getGraphemeClusterEnd(text.slice(end));
    end += clusterLength || 1;
  }
  return { start, end };
}

export function encodeHiddenTagChars(emoji, hiddenText) {
  if (!emoji || !hiddenText) return emoji;
  try {
    const { start, end } = getLastGraphemeClusterRange(emoji);
    const prefix = emoji.slice(0, start);
    const target = emoji.slice(start, end);
    const suffix = emoji.slice(end);

    const encoder = new TextEncoder();
    const bytes = encoder.encode(hiddenText);

    let encoded = prefix + target;
    for (const byte of bytes) {
      const cp = byte + 0xE00F0;
      encoded += String.fromCodePoint(cp);
    }
    return encoded + suffix;
  } catch (e) {
    console.warn('[Utils] encodeHiddenTagChars に失敗', e);
    return emoji;
  }
}
