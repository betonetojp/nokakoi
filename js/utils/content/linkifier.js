import { escapeHtml } from '../utils.js';
import { t } from '../i18n.js';
import { getNip19 as getNip19Compat } from '../../core/nostr-compat.js';
import { URL_REGEX, NOSTR_URI_REGEX, EMOJI_SHORTCODE_REGEX } from './text-preview.js';

export function isImageUrl(url) {
  const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i;
  return imageExtensions.test(url);
}

export function isVideoUrl(url) {
  const videoExtensions = /\.(mp4|webm|ogg|mov)(\?.*)?$/i;
  return videoExtensions.test(url);
}

export function getNip19() {
  try {
    return getNip19Compat() || null;
  } catch (e) { }
  return null;
}

export function linkifyNostrUri(uri) {
  const nip19 = getNip19();
  if (!nip19) return escapeHtml(uri);

  try {
    const bech32 = uri.replace(/^nostr:/, '');
    const decoded = nip19.decode(bech32);

    let label = '';
    let link = '';

    switch (decoded.type) {
      case 'npub':
        label = `@${bech32.substring(0, 12)}...`;
        link = `#npub:${bech32}`;
        return '<a href="' + escapeHtml(link) + '" class="nostr-link nostr-npub" data-uri="' +
          escapeHtml(uri) + '" data-pubkey="' + escapeHtml(decoded.data) +
          '" title="' + escapeHtml(bech32) + '">' +
          escapeHtml(label) + '</a>';
      case 'nprofile':
        label = `@${bech32.substring(0, 12)}...`;
        link = `#nprofile:${bech32}`;
        return '<a href="' + escapeHtml(link) + '" class="nostr-link nostr-npub" data-uri="' +
          escapeHtml(uri) + '" data-pubkey="' + escapeHtml(decoded.data.pubkey) +
          '" title="' + escapeHtml(bech32) + '">' +
          escapeHtml(label) + '</a>';
      case 'note':
        label = t('quote.placeholder', '引用');
        return '<span class="nostr-quote" data-uri="' +
          escapeHtml(uri) + '" data-event-id="' + escapeHtml(decoded.data) +
          '" data-relays="[]" title="' + escapeHtml(bech32) + '">' +
          escapeHtml(label) + '</span>';
      case 'nevent':
        label = t('quote.placeholder', '引用');
        return '<span class="nostr-quote" data-uri="' +
          escapeHtml(uri) + '" data-event-id="' + escapeHtml(decoded.data.id) +
          '" data-relays="' + escapeHtml(JSON.stringify(decoded.data.relays || [])) +
          '" title="' + escapeHtml(bech32) + '">' +
          escapeHtml(label) + '</span>';
      case 'naddr':
        label = `addr:${bech32.substring(0, 12)}...`;
        return '<span class="nostr-quote" data-uri="' +
          escapeHtml(uri) + '" data-naddr-kind="' + escapeHtml(String(decoded.data.kind)) +
          '" data-naddr-pubkey="' + escapeHtml(decoded.data.pubkey) +
          '" data-naddr-identifier="' + escapeHtml(decoded.data.identifier) +
          '" data-relays="' + escapeHtml(JSON.stringify(decoded.data.relays || [])) +
          '" title="' + escapeHtml(bech32) + '">' +
          escapeHtml(label) + '</span>';
      default:
        return escapeHtml(uri);
    }
  } catch (e) {
    console.warn('[UrlParser] Nostr URIのパースに失敗:', e.message || e);
    return escapeHtml(uri);
  }
}

export function linkifyText(text, emojiTags = [], options = {}) {
  if (!text) return '';
  const inlineMedia = options.inlineMedia !== false;
  const showCustomEmoji = (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('showCustomEmoji') === '0') ? false : true;

  const emojiMap = new Map();
  try {
    if (Array.isArray(emojiTags)) {
      for (const tag of emojiTags) {
        try {
          if (Array.isArray(tag) && tag[0] === 'emoji' && tag[1]) {
            emojiMap.set(String(tag[1]), tag[2] || null);
          }
        } catch (e) { }
      }
    }
  } catch (e) { }

  const lines = text.split('\n');
  const result = [];
  const isBlock = [];

  for (let line of lines) {
    let lastIndex = 0;
    const lineParts = [];
    const matches = [];

    const emojiOnly = /^\s*(?::[A-Za-z0-9_+-]+:\s*)+$/.test(line);

    const urlRegex = new RegExp(URL_REGEX.source, URL_REGEX.flags);
    let match;
    while ((match = urlRegex.exec(line)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        text: match[0],
        type: 'url'
      });
    }

    const nostrRegex = new RegExp(NOSTR_URI_REGEX.source, NOSTR_URI_REGEX.flags);
    while ((match = nostrRegex.exec(line)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        text: match[0],
        type: 'nostr'
      });
    }

    const emojiRegex = new RegExp(EMOJI_SHORTCODE_REGEX.source, EMOJI_SHORTCODE_REGEX.flags);
    while ((match = emojiRegex.exec(line)) !== null) {
      matches.push({
        index: match.index,
        length: match[0].length,
        text: match[0],
        type: 'emoji'
      });
    }

    matches.sort((a, b) => a.index - b.index);

    const filteredMatches = [];
    let lastEnd = 0;
    for (const m of matches) {
      if (m.index >= lastEnd) {
        filteredMatches.push(m);
        lastEnd = m.index + m.length;
      }
    }

    let emojiSeq = [];
    for (const m of filteredMatches) {
      if (m.index > lastIndex) {
        if (emojiSeq.length > 0) {
          lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>');
          emojiSeq = [];
        }
        lineParts.push('<span class="plain-text">' + escapeHtml(line.substring(lastIndex, m.index)) + '</span>');
      }

      if (m.type === 'url') {
        if (emojiSeq.length > 0) { lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>'); emojiSeq = []; }
        const url = m.text;
        const isImage = isImageUrl(url);
        const isVideo = isVideoUrl(url);

        if (isImage || isVideo) {
          const type = isImage ? 'image' : 'video';
          const label = isImage ? t('media.open_image') : t('media.open_video');
          const safeUrl = escapeHtml(url);
          if (inlineMedia) {
            if (isImage) {
              lineParts.push(
                '<span class="media-inline media-link" data-url="' + safeUrl + '" data-type="' + type + '" title="' + safeUrl + '">' +
                '<img src="' + safeUrl + '" alt="' + escapeHtml(t('media.image')) + '" loading="lazy">' +
                '</span>'
              );
            } else {
              lineParts.push(
                '<span class="media-inline media-link media-inline-video" data-url="' + safeUrl + '" data-type="' + type + '" title="' + safeUrl + '">' +
                '<video src="' + safeUrl + '" muted playsinline preload="metadata"></video>' +
                '<span class="media-inline-overlay">' + escapeHtml(t('media.video')) + '</span>' +
                '</span>'
              );
            }
          } else {
            lineParts.push(
              '<button type="button" class="open-media" data-url="' + safeUrl +
              '" data-type="' + type + '" title="' + safeUrl + '">' + escapeHtml(label) + '</button>'
            );
          }
        } else {
          lineParts.push(
            '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" title="' +
            escapeHtml(url) + '">' + escapeHtml(url) + '</a>'
          );
        }
      } else if (m.type === 'nostr') {
        if (emojiSeq.length > 0) { lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>'); emojiSeq = []; }
        lineParts.push(linkifyNostrUri(m.text));
      } else if (m.type === 'emoji') {
        try {
          const sc = m.text.slice(1, -1);
          const url = emojiMap.get(sc);
          const show = (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('showCustomEmoji') === '0') ? false : true;
          if (!show) {
            if (emojiSeq.length > 0) { lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>'); emojiSeq = []; }
            lineParts.push('<span class="plain-text">' + escapeHtml(m.text) + '</span>');
            lastIndex = m.index + m.length;
            continue;
          }
          if (url) {
            const imgHtml = '<span class="emoji-wrap" style="display:inline-block;line-height:1;margin:0;padding:0;vertical-align:middle;max-width:100%;">' +
              '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(m.text) + '" class="custom-emoji" style="max-width:100%;"/>' +
              '</span>';
            emojiSeq.push(imgHtml);
          } else {
            if (emojiSeq.length > 0) { lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>'); emojiSeq = []; }
            lineParts.push('<span class="plain-text">' + escapeHtml(m.text) + '</span>');
          }
        } catch (e) {
          if (emojiSeq.length > 0) { lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>'); emojiSeq = []; }
          lineParts.push('<span class="plain-text">' + escapeHtml(m.text) + '</span>');
        }
      }

      lastIndex = m.index + m.length;
    }

    if (lastIndex < line.length) {
      if (emojiSeq.length > 0) {
        lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>');
        emojiSeq = [];
      }
      lineParts.push('<span class="plain-text">' + escapeHtml(line.substring(lastIndex)) + '</span>');
    }

    if (emojiSeq.length > 0) { lineParts.push('<span class="emoji-inline-group">' + emojiSeq.join('') + '</span>'); }

    const inner = lineParts.join('');

    const hasEmojiImg = inner.indexOf('class="custom-emoji"') >= 0;
    const plainText = inner.replace(/<[^>]+>/g, '').trim();
    const isMixedLine = !emojiOnly && hasEmojiImg && plainText.length > 0;

    if (emojiOnly && showCustomEmoji) {
      result.push('<div class="emoji-line">' + inner + '</div>');
      isBlock.push(true);
    } else if (isMixedLine) {
      result.push('<span class="mixed-line">' + inner + '</span>');
      isBlock.push(false);
    } else {
      result.push(inner);
      isBlock.push(false);
    }
  }

  let out = '';
  for (let i = 0; i < result.length; i++) {
    out += result[i];
    if (i < result.length - 1) {
      if (!isBlock[i] && !isBlock[i + 1]) {
        out += '<br>';
      }
    }
  }

  return out;
}
