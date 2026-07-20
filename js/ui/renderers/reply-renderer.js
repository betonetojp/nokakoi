import { findEventById } from '../../core/state.js';
import { displayName } from '../../features/profile/profile.js';
import { escapeHtml, truncateName, replaceBadgeEmoji } from '../../utils/utils.js';
import { linkifyText, getEffectiveTextLength, getPreviewWithFullLinksAndEmojis } from '../../utils/url-parser.js';
import { t } from '../../utils/i18n.js';
import { MAX_PREVIEW_LINES } from '../../config/constants.js';
import { pickETagEventId, resolvePreviewMaxLength } from './render-helpers.js';
import { formatReaction } from './reaction-renderer.js';

export function renderReplyContext(state, ev, nip19, settings) {
  const isModal = !!settings && settings.isModal === true;
  const inlineMedia = settings && settings.showTimelineMedia === true;
  if (ev.kind !== 1 && ev.kind !== 7 && ev.kind !== 6 && ev.kind !== 16) return '';

  const eTags = (ev.tags || []).filter(t => t && t[0] === 'e' && t[1]);
  if (eTags.length === 0) return '';

  const replyToEventId = pickETagEventId(ev);
  const effectiveReplyToEventId = replyToEventId;
  const replyToEvent = findEventById(state, effectiveReplyToEventId);

  if (!replyToEvent) {
    if (ev.kind === 7) {
      const reactionDisplay = formatReaction(ev.content, ev.tags || []);
      const label = t('reaction.button.title');
      return '<div class="reply-to reaction"><span class="reply-marker">' + reactionDisplay + '</span><span class="reply-to-author" data-event-id="' + replyToEventId + '"><span>' + label + '</span></span></div>';
    } else if (ev.kind === 6 || ev.kind === 16) {
      const label = t('repost');
      return '<div class="reply-to repost"><span class="reply-marker"><img src="icon/repost.png" alt="' + escapeHtml(t('repost')) + '" class="icon"/></span><span class="reply-to-author" data-event-id="' + replyToEventId + '"><span>' + label + '</span></span></div>';
    } else {
      const label = t('reply');
      return '<div class="reply-to"><span class="reply-marker"><img src="icon/reply.png" alt="' + escapeHtml(t('reply')) + '" class="icon"/></span><span class="reply-to-author" data-event-id="' + replyToEventId + '"><span>' + label + '</span></span></div>';
    }
  }

  const replyToAuthor = truncateName(displayName(state, replyToEvent.pubkey, nip19));
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
  } else {
    if (isOpaqueAuthor) {
      const label = t('reply');
      return '<div class="reply-to"><span class="reply-marker"><img src="icon/reply.png" alt="' + escapeHtml(t('reply')) + '" class="icon"/></span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + label + '</span></span><div class="reply-to-content" data-event-id="' + (replyToEvent.id || '') + '">' + replyContentHtml + '</div></div>';
    }
    const label = t('reply.label', { author: escapeHtml(replyToAuthor) });
    return '<div class="reply-to"><span class="reply-marker"><img src="icon/reply.png" alt="' + escapeHtml(t('reply')) + '" class="icon"/></span><span class="reply-to-author" data-pubkey="' + replyToPubkey + '"><span>' + replaceBadgeEmoji(label) + '</span></span><div class="reply-to-content" data-event-id="' + (replyToEvent.id || '') + '">' + replyContentHtml + '</div></div>';
  }
}
