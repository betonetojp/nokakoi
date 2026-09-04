import { getZapReceiptAmountSats, getZapReceiptSenderPubkey, getZapReceiptRecipientPubkey, isOutgoingZapReceiptFor } from '../../features/zap/zap.js';
import { findEventById } from '../../core/state.js';
import { displayName } from '../../features/profile/profile.js';
import { escapeHtml, truncateName, replaceBadgeEmoji } from '../../utils/utils.js';
import { linkifyText, getEffectiveTextLength, getPreviewWithFullLinksAndEmojis, getNip19 } from '../../utils/url-parser.js';
import { t } from '../../utils/i18n.js';
import { MAX_PREVIEW_LINES } from '../../config/constants.js';
import { pickETagEventId, pickETagWithHint, resolvePreviewMaxLength, evaluateMuteState } from './render-helpers.js';
import { formatReaction } from './reaction-renderer.js';

function getZapRequestComment(ev) {
  try {
    const descTag = (ev.tags || []).find((t) => Array.isArray(t) && t[0] === 'description' && t[1]);
    if (descTag) {
      const zapReq = JSON.parse(descTag[1]);
      if (zapReq && zapReq.content) return String(zapReq.content);
    }
  } catch (_e) {}
  return (ev && ev.content) ? String(ev.content) : '';
}

function isOpaqueDisplayName(name, pubkey) {
  try {
    if (!name) return true;
    if (pubkey && typeof pubkey === 'string' && /^[0-9a-f]{64}$/i.test(pubkey) && typeof name === 'string' && name.toLowerCase() === pubkey.toLowerCase()) return true;
    if (typeof name === 'string' && /^[0-9a-f]{64}$/i.test(name) && (!pubkey || name.toLowerCase() === pubkey.toLowerCase())) return true;
    return false;
  } catch (_e) {
    return false;
  }
}

export function renderZapReceiptAuthorLinkHtml(state, pubkey, nip19) {
  if (!pubkey) return '';
  const effectiveNip19 = nip19 || getNip19();
  let npub = '';
  try {
    if (effectiveNip19 && typeof effectiveNip19.npubEncode === 'function' && /^[0-9a-f]{64}$/i.test(pubkey)) {
      npub = effectiveNip19.npubEncode(pubkey);
    }
  } catch (_e) {}

  const uri = npub ? `nostr:${npub}` : `nostr:${pubkey}`;
  const href = npub ? `#npub:${npub}` : `#npub:${pubkey}`;
  const title = npub || pubkey;

  // petname 優先で表示名を解決
  let initialLabel = '';
  let isPetname = false;
  try {
    if (state && state.followPetnames && state.followPetnames.has(pubkey)) {
      const pet = state.followPetnames.get(pubkey);
      if (pet) {
        initialLabel = '\u200B📛' + pet;
        isPetname = true;
      }
    }
  } catch (_e) {}

  if (!initialLabel && state && state.profiles) {
    const prof = state.profiles.get(pubkey);
    if (prof) {
      const name = (prof.display_name || prof.name || '').trim();
      if (name) {
        initialLabel = '@' + name;
      }
    }
  }

  if (!initialLabel) {
    initialLabel = npub ? `@${npub.substring(0, 12)}...` : `@${pubkey.substring(0, 8)}...`;
  }

  const labelHtml = isPetname
    ? replaceBadgeEmoji(escapeHtml(initialLabel))
    : escapeHtml(initialLabel);

  return '<a href="' + escapeHtml(href) + '" class="nostr-link nostr-npub name" data-uri="' +
    escapeHtml(uri) + '" data-pubkey="' + escapeHtml(pubkey) +
    '" title="' + escapeHtml(title) + '">' +
    labelHtml + '</a>';
}

function formatZapComment(comment) {
  if (!comment || !comment.trim()) return '';
  const lines = comment.split(/\r\n|\r|\n/);
  return lines.map((line) => (line.trim() === '' ? '💬' : `💬 ${line}`)).join('\n');
}

export function formatZapReceiptLabel(state, ev, nip19) {
  const myPubkey = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage.getItem('pubkey') : '';
  const isOutgoing = !!(myPubkey && isOutgoingZapReceiptFor(ev, myPubkey));
  const senderPubkey = getZapReceiptSenderPubkey(ev) || (ev && ev.pubkey) || '';
  const recipientPubkey = getZapReceiptRecipientPubkey(ev);
  const targetPubkey = isOutgoing ? recipientPubkey : senderPubkey;
  const direction = isOutgoing ? 'to' : 'from';

  const sats = getZapReceiptAmountSats(ev);
  const amountStr = sats > 0 ? (sats === 1 ? '1sat' : `${sats}sats`) : 'Zap';

  const effectiveNip19 = nip19 || getNip19();
  let npub = '';
  try {
    if (effectiveNip19 && typeof effectiveNip19.npubEncode === 'function' && targetPubkey && /^[0-9a-f]{64}$/i.test(targetPubkey)) {
      npub = effectiveNip19.npubEncode(targetPubkey);
    }
  } catch (_e) {}
  const mention = npub ? `nostr:${npub}` : (targetPubkey ? `nostr:${targetPubkey}` : '');

  const header = mention ? `⚡ ${amountStr} ${direction} ${mention}` : `⚡ ${amountStr} ${direction}`;
  const rawComment = getZapRequestComment(ev);
  const formattedComment = formatZapComment(rawComment);
  const fullLabel = formattedComment ? `${header}\n${formattedComment}` : header;

  return {
    senderPubkey,
    recipientPubkey,
    targetPubkey,
    direction,
    sats,
    header,
    comment: formattedComment,
    rawComment,
    label: fullLabel
  };
}

function renderZapReceiptBannerHtml(state, ev, nip19, extraAttrs, extraInner) {
  const { senderPubkey, targetPubkey, direction, sats, comment } = formatZapReceiptLabel(state, ev, nip19);
  const attrs = extraAttrs ? extraAttrs : '';
  const extra = extraInner || '';

  const amountStr = sats > 0 ? (sats === 1 ? '1sat' : `${sats}sats`) : 'Zap';
  const prefixText = `⚡ ${amountStr} ${direction} `;
  const authorLinkHtml = renderZapReceiptAuthorLinkHtml(state, targetPubkey || senderPubkey, nip19);

  const commentHtml = comment ? linkifyText(comment, ev && ev.tags ? ev.tags : [], { inlineMedia: false }) : '';

  let html = '<div class="reply-to zap"' + attrs + '>';
  html += '<div class="zap-header">';
  html += '<span class="zap-header-prefix">' + escapeHtml(prefixText) + '</span>';
  html += authorLinkHtml;
  html += '</div>';

  if (commentHtml) {
    html += '<div class="zap-comment">' + replaceBadgeEmoji(commentHtml) + '</div>';
  }

  html += extra;
  html += '</div>';
  return html;
}

export function renderReplyContext(state, ev, nip19, settings) {
  const isModal = !!settings && settings.isModal === true;
  const inlineMedia = settings && settings.showTimelineMedia === true;
  if (ev.kind !== 1 && ev.kind !== 42 && ev.kind !== 1111 && ev.kind !== 7 && ev.kind !== 6 && ev.kind !== 16 && ev.kind !== 9735) return '';

  const eTags = (ev.tags || []).filter(t => t && (t[0] === 'e' || t[0] === 'E') && t[1]);
  if (eTags.length === 0) {
    if (Number(ev.kind) === 9735) return renderZapReceiptBannerHtml(state, ev, nip19);
    return '';
  }

  const { eventId: replyToEventId, relayHint: replyToRelayHint } = pickETagWithHint(ev);
  if (!replyToEventId) return '';
  const effectiveReplyToEventId = replyToEventId;
  const replyToEvent = findEventById(state, effectiveReplyToEventId);

  if (!replyToEvent) {
    const ownerAttr = ' data-owner-event-id="' + escapeHtml(ev.id || '') + '"';
    if (ev.kind === 9735) {
      return renderZapReceiptBannerHtml(
        state,
        ev,
        nip19,
        ownerAttr,
        '<span class="reply-to-author" data-event-id="' + replyToEventId + '" data-relay-hint="' + escapeHtml(replyToRelayHint) + '" hidden></span>'
      );
    } else if (ev.kind === 7) {
      const reactionDisplay = formatReaction(ev.content, ev.tags || []);
      const label = t('reaction.button.title');
      return '<div class="reply-to reaction"' + ownerAttr + '><span class="reply-marker">' + reactionDisplay + '</span><span class="reply-to-author" data-event-id="' + replyToEventId + '" data-relay-hint="' + escapeHtml(replyToRelayHint) + '"><span>' + label + '</span></span></div>';
    } else if (ev.kind === 6 || ev.kind === 16) {
      const label = t('repost');
      return '<div class="reply-to repost"' + ownerAttr + '><span class="reply-marker"><img src="icon/repost.png" alt="' + escapeHtml(t('repost')) + '" class="icon"/></span><span class="reply-to-author" data-event-id="' + replyToEventId + '" data-relay-hint="' + escapeHtml(replyToRelayHint) + '"><span>' + label + '</span></span></div>';
    } else {
      const label = t('reply');
      return '<div class="reply-to"' + ownerAttr + '><span class="reply-marker"><img src="icon/reply.png" alt="' + escapeHtml(t('reply')) + '" class="icon"/></span><span class="reply-to-author" data-event-id="' + replyToEventId + '" data-relay-hint="' + escapeHtml(replyToRelayHint) + '"><span>' + label + '</span></span></div>';
    }
  }

  const replyToAuthor = displayName(state, replyToEvent.pubkey, nip19);
  const replyToContent = replyToEvent.content || '';
  const replyToPubkey = replyToEvent.pubkey;

  const isOpaqueAuthor = (function (a, pk) {
    try {
      if (!a) return true;
      if (pk && typeof pk === 'string' && /^[0-9a-f]{64}$/i.test(pk) && typeof a === 'string' && a.toLowerCase() === pk.toLowerCase()) return true;
      if (typeof a === 'string' && /^[0-9a-f]{64}$/i.test(a) && (!pk || a.toLowerCase() === pk.toLowerCase())) return true;
      return false;
    } catch (e) { return false; }
  })(replyToAuthor, replyToPubkey);

  let replyContentHtml;
  if (isModal) {
    replyContentHtml = linkifyText(replyToContent, replyToEvent && replyToEvent.tags ? replyToEvent.tags : [], { inlineMedia });
  } else {
    const tags = replyToEvent && replyToEvent.tags ? replyToEvent.tags : [];
    const previewMaxLength = resolvePreviewMaxLength(settings);
    if (getEffectiveTextLength(replyToContent) > previewMaxLength || replyToContent.split('\n').length > MAX_PREVIEW_LINES) {
      const previewText = getPreviewWithFullLinksAndEmojis(replyToContent, previewMaxLength, MAX_PREVIEW_LINES);
      replyContentHtml = `<span class="reply-preview-text">${linkifyText(previewText, tags, { inlineMedia: false })}</span>`;
      if (previewText.length < replyToContent.length) {
        replyContentHtml += `<button type="button" class="read-more-btn secondary reply-read-more">${t('see_detail','省略されています')}</button>`;
      }
    } else {
      replyContentHtml = `<span class="reply-preview-text">${linkifyText(replyToContent, tags, { inlineMedia: false })}</span>`;
    }
  }

  if (ev.kind === 7) {
    const reactionDisplay = formatReaction(ev.content, ev.tags || []);
    const isReferenceReaction = replyToEvent && (replyToEvent.kind === 6 || replyToEvent.kind === 16 || replyToEvent.kind === 7);
    const repostReferenceHtml = isReferenceReaction
      ? renderReplyContext(state, replyToEvent, nip19, settings)
      : '';
    const reactionContentHtml = repostReferenceHtml || replyContentHtml;
    const reactionContentEventId = (replyToEvent && replyToEvent.id) ? replyToEvent.id : '';
    if (isOpaqueAuthor) {
      const label = t('reaction.button.title');
      return '<div class="reply-to reaction"><span class="reply-marker">' + reactionDisplay + '</span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + label + '</span></span><div class="reply-to-content" data-event-id="' + reactionContentEventId + '">' + reactionContentHtml + '</div></div>';
    }
    const label = t('reaction.label', { author: escapeHtml(replyToAuthor) });
    return '<div class="reply-to reaction"><span class="reply-marker">' + reactionDisplay + '</span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + replaceBadgeEmoji(label) + '</span></span><div class="reply-to-content" data-event-id="' + reactionContentEventId + '">' + reactionContentHtml + '</div></div>';
  } else if (ev.kind === 6 || ev.kind === 16) {
    if (isOpaqueAuthor) {
      const label = t('repost');
      return '<div class="reply-to repost"><span class="reply-marker"><img src="icon/repost.png" alt="' + escapeHtml(t('repost')) + '" class="icon"/></span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + label + '</span></span><div class="reply-to-content" data-event-id="' + (replyToEvent.id || '') + '">' + replyContentHtml + '</div></div>';
    }
    const label = t('repost.label', { author: escapeHtml(replyToAuthor) });
    return '<div class="reply-to repost"><span class="reply-marker"><img src="icon/repost.png" alt="' + escapeHtml(t('repost')) + '" class="icon"/></span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + replaceBadgeEmoji(label) + '</span></span><div class="reply-to-content" data-event-id="' + (replyToEvent.id || '') + '">' + replyContentHtml + '</div></div>';
  } else if (ev.kind === 9735) {
    return renderZapReceiptBannerHtml(
      state,
      ev,
      nip19,
      '',
      '<div class="reply-to-content" data-event-id="' + (replyToEvent.id || '') + '">' + replyContentHtml + '</div>'
    );
  } else {
    if (isOpaqueAuthor) {
      const label = t('reply');
      return '<div class="reply-to"><span class="reply-marker"><img src="icon/reply.png" alt="' + escapeHtml(t('reply')) + '" class="icon"/></span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + label + '</span></span><div class="reply-to-content" data-event-id="' + (replyToEvent.id || '') + '">' + replyContentHtml + '</div></div>';
    }
    const label = t('reply.label', { author: escapeHtml(replyToAuthor) });
    return '<div class="reply-to"><span class="reply-marker"><img src="icon/reply.png" alt="' + escapeHtml(t('reply')) + '" class="icon"/></span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + replaceBadgeEmoji(label) + '</span></span><div class="reply-to-content" data-event-id="' + (replyToEvent.id || '') + '">' + replyContentHtml + '</div></div>';
  }
}
