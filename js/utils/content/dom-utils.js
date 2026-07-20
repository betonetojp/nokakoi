import { escapeHtml, truncateName, replaceBadgeEmoji } from '../utils.js';
import { showMediaViewer } from '../../ui/media-viewer.js';
import { t } from '../i18n.js';
import { MAX_PREVIEW_LENGTH, MAX_PREVIEW_LINES } from '../../config/constants.js';
import { findEventById } from '../../core/state.js';
import { getNip19, linkifyText, linkifyNostrUri } from './linkifier.js';
import { captureTimelineAnchor, restoreTimelineAnchor, followUpTimelineAnchor } from './timeline-anchor.js';
import { resolveQuoteRelays, fetchQuoteEventById, fetchQuoteEventByNaddr, prefetchQuotesForElements, sanitizeRelays } from './quote-resolver.js';
import { getEffectiveTextLength, getPreviewWithFullLinksAndEmojis } from './text-preview.js';

export const NOSTR_QUOTE_RECURSION_MAX_DEPTH = 2;

export function setupMediaLinkHandlers(container) {
  container.addEventListener('click', function (e) {
    const target = e.target;
    const btn = target.classList.contains('open-media') ? target : target.closest('.open-media');
    if (btn) {
      e.preventDefault();
      const url = btn.dataset.url;
      const type = btn.dataset.type || 'auto';
      if (url) {
        showMediaViewer(url, type);
      }
      return false;
    }
    const link = target.classList.contains('media-link') ?
      target : target.closest('.media-link');
    if (link) {
      e.preventDefault();
      const url = link.dataset.url;
      const type = link.dataset.type || 'auto';
      if (url) {
        showMediaViewer(url, type);
      }
      return false;
    }

    const nostrLink = target.classList.contains('nostr-link') ?
      target : target.closest('.nostr-link');

    if (nostrLink && nostrLink.classList.contains('nostr-note')) {
      const uri = nostrLink.dataset.uri;
      if (uri) {
        handleNostrUri(uri);
      }
      return false;
    }

    const npubLink = target.classList.contains('nostr-npub') ?
      target : target.closest('.nostr-npub');

    if (npubLink) {
      e.preventDefault();
      const uri = npubLink.dataset.uri;
      if (uri) {
        handleNostrUri(uri);
      }
      return false;
    }
  });
}

export async function handleNostrUri(uri) {
  const nip19 = getNip19();
  if (!nip19) {
    alert(t('nostrtools.not_loaded'));
    return;
  }

  try {
    const bech32 = uri.replace(/^nostr:/, '');
    const decoded = nip19.decode(bech32);

    const state = window.__nostrState;

    switch (decoded.type) {
      case 'npub':
        if (state) {
          if (typeof window !== 'undefined' && typeof window.showProfileModalProxy === 'function') {
            window.showProfileModalProxy(decoded.data);
          } else {
            try {
              const mod = await import('../../main.js');
              if (mod && mod.showProfileModalProxy) {
                mod.showProfileModalProxy(decoded.data);
              }
            } catch (e) { }
          }
        }
        break;
      case 'nprofile':
        if (state) {
          if (typeof window !== 'undefined' && typeof window.showProfileModalProxy === 'function') {
            window.showProfileModalProxy(decoded.data.pubkey);
          } else {
            try {
              const mod = await import('../../main.js');
              if (mod && mod.showProfileModalProxy) {
                mod.showProfileModalProxy(decoded.data.pubkey);
              }
            } catch (e) { }
          }
        }
        break;
      case 'note':
        if (state && state.pool) {
          try {
            const eventId = decoded.type === 'note' ? decoded.data : decoded.data.id;
            const { findEventById: findEventByIdLocal } = await import('../../core/state.js');
            const { getReadRelays } = await import('../../core/relay.js');
            const { showJsonModal } = await import('../../ui/modals/json-modal.js');

            let event = findEventByIdLocal(state, eventId);

            if (!event) {
              const rawRelays = decoded.type === 'nevent' && decoded.data.relays && decoded.data.relays.length > 0
                ? decoded.data.relays
                : getReadRelays(state.relays);
              const relays = sanitizeRelays(rawRelays);

              if (relays && relays.length > 0) {
                event = await fetchQuoteEventById(state, relays, eventId);
              }
            }

            if (event) {
              showJsonModal(event);
            } else {
              alert(t('error.event_not_found'));
            }
          } catch (e) {
            console.error('[UrlParser] イベント取得に失敗:', e);
            alert(t('error.event_fetch_failed', { msg: (e && e.message) }));
          }
        }
        break;
      case 'naddr': {
        const { showJsonModal } = await import('../../ui/modals/json-modal.js');
        showJsonModal(decoded.data);
        break;
      }
    }
  } catch (e) {
    console.error('[UrlParser] Nostr URIの処理に失敗:', e);
    alert(t('error.nostr_uri_failed', { msg: (e && e.message) }));
  }
}

export async function updateNostrNpubLinks(container) {
  if (!container) return;

  const state = window.__nostrState;
  if (!state) return;

  const npubLinks = container.querySelectorAll('.nostr-npub[data-pubkey]');

  for (const link of npubLinks) {
    const pubkey = link.dataset.pubkey;
    if (!pubkey) continue;

    const profile = state.profiles.get(pubkey);
    if (profile) {
      const displayNameVal = (profile.display_name || profile.name || '').trim();
      if (displayNameVal) {
        link.textContent = '@' + displayNameVal;
      }
    } else {
      try {
        const { loadProfile } = await import('../../features/profile/profile.js');
        loadProfile(state, pubkey).then(() => {
          const prof = state.profiles.get(pubkey);
          if (prof) {
            const displayNameVal = (prof.display_name || prof.name || '').trim();
            if (displayNameVal) {
              link.textContent = '@' + displayNameVal;
            }
          }
        });
      } catch (e) {
        console.warn('[UrlParser] npubリンクのプロフィール取得に失敗:', e);
      }
    }
  }
}

export async function updateNostrNoteLinks(container, showEventModal, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager, recursionState = null) {
  if (!container) return;
  const globalState = window.__nostrState;
  if (!state) state = globalState;
  if (!state || !state.pool) return;
  if (!nip19) nip19 = getNip19();
  const depth = recursionState && typeof recursionState.depth === 'number' ? recursionState.depth : 0;
  const maxDepth = recursionState && typeof recursionState.maxDepth === 'number'
    ? recursionState.maxDepth
    : NOSTR_QUOTE_RECURSION_MAX_DEPTH;
  if (depth > maxDepth) return;

  const quoteElements = Array.from(container.querySelectorAll('.nostr-quote'));
  await prefetchQuotesForElements(state, quoteElements);

  for (const quoteEl of quoteElements) {
    const eventId = quoteEl.dataset.eventId;
    const naddrKind = quoteEl.dataset.naddrKind;
    const ownerEventEl = quoteEl.closest && quoteEl.closest('.event[data-event-id]');
    const ownerEventId = ownerEventEl && ownerEventEl.dataset ? ownerEventEl.dataset.eventId : null;

    if (eventId && ownerEventId && ownerEventId === eventId) continue;

    if (!eventId && !naddrKind) continue;

    const resolved = await resolveAndRenderQuote(
      quoteEl, container, showEventModal, state, nip19,
      reactToEvent, replyToEvent, repostEvent, settings, settingsManager,
      depth, maxDepth
    );
    if (!resolved) {
      attachQuoteRetryHandler(
        quoteEl, container, showEventModal, state, nip19,
        reactToEvent, replyToEvent, repostEvent, settings, settingsManager,
        depth, maxDepth
      );
    }
  }
}

export async function resolveAndRenderQuote(quoteEl, container, showEventModal, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager, depth, maxDepth) {
  const eventId = quoteEl.dataset.eventId;
  const naddrKind = quoteEl.dataset.naddrKind;

  try {
    const nip19local = getNip19();

    let event = null;
    if (eventId) {
      event = findEventById(state, eventId);
    }

    if (!event) {
      const relays = resolveQuoteRelays(quoteEl, state);
      if (relays.length > 0) {
        if (eventId) {
          event = await fetchQuoteEventById(state, relays, eventId);
        } else if (naddrKind) {
          const kind = parseInt(naddrKind, 10);
          const pubkey = quoteEl.dataset.naddrPubkey;
          const identifier = quoteEl.dataset.naddrIdentifier;
          if (!isNaN(kind) && pubkey && identifier !== undefined) {
            event = await fetchQuoteEventByNaddr(state, relays, kind, pubkey, identifier);
          }
        }
      }
    }

    if (event && (event.kind === 1 || event.kind === 42 || event.kind === 30023 || (naddrKind && event.content))) {
      const quoteHtml = await renderEventQuote(state, event, nip19local, settings);
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = quoteHtml;
      const quoteDiv = tempDiv.firstChild;
      if (quoteDiv) {
        const anchor = captureTimelineAnchor(container);
        quoteEl.parentNode.replaceChild(quoteDiv, quoteEl);
        restoreTimelineAnchor(anchor, container);
        try { updateNostrNpubLinks(quoteDiv); } catch (e) { }
        if (depth < maxDepth) {
          try {
            await updateNostrNoteLinks(
              quoteDiv,
              showEventModal,
              state,
              nip19,
              reactToEvent,
              replyToEvent,
              repostEvent,
              settings,
              settingsManager,
              { depth: depth + 1, maxDepth }
            );
          } catch (e) { }
        }
        try { if (typeof fitCustomEmoji === 'function') fitCustomEmoji(quoteDiv, 18); } catch (e) { }
        const labelEls = quoteDiv.querySelectorAll('.event-quote-label[data-pubkey]');
        labelEls.forEach(labelEl => {
          labelEl.onclick = function () {
            const pubkey = labelEl.getAttribute('data-pubkey');
            if (pubkey) {
              import('../../main.js').then(mod => {
                if (mod.showProfileModalProxy) mod.showProfileModalProxy(pubkey);
              });
            }
          };
        });
        const contentEl = quoteDiv.querySelector('.event-quote-content');
        if (contentEl && typeof showEventModal === 'function') {
          contentEl.onclick = function (e) {
            try {
              const btn = e.target.classList.contains('open-media') ? e.target : e.target.closest('.open-media');
              if (btn) {
                e.preventDefault();
                const url = btn.dataset.url;
                const type = btn.dataset.type || 'auto';
                if (url) {
                  showMediaViewer(url, type);
                }
                return false;
              }

              const link = e.target.classList.contains('media-link') ? e.target : e.target.closest('.media-link');
              if (link) {
                e.preventDefault();
                const url = link.dataset.url;
                const type = link.dataset.type || 'auto';
                if (url) showMediaViewer(url, type);
                return false;
              }
            } catch (err) { }
            e.stopPropagation();
            showEventModal(event, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
          };
        }
      }
      return true;
    } else if (event && (event.kind === 6 || event.kind === 7 || event.kind === 16)) {
      const { renderReplyContext } = await import('../../ui/renderer.js');
      const referenceHtml = (typeof renderReplyContext === 'function')
        ? renderReplyContext(state, event, nip19local, { isModal: false, showTimelineMedia: false, settingsManager })
        : '';
      if (referenceHtml) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = referenceHtml;
        const referenceDiv = tempDiv.firstChild;
        if (referenceDiv) {
          const { showEventModal: showEventModalLocal } = await import('../../ui/modals/event-modal.js');
          const clickableRefs = referenceDiv.querySelectorAll('.reply-to-author[data-event-id], .reply-to-content[data-event-id]');
          clickableRefs.forEach((el) => {
            const refEventId = el.getAttribute('data-event-id');
            if (!refEventId) return;
            const referencedEvent = findEventById(state, refEventId);
            if (!referencedEvent) return;
            el.style.cursor = 'pointer';
            el.onclick = function (e) {
              try {
                e.preventDefault();
                e.stopPropagation();
              } catch (_) { }
              showEventModalLocal(referencedEvent, state, nip19local, null, null, null, settings, settingsManager);
            };
          });

          const anchor = captureTimelineAnchor(container);
          quoteEl.parentNode.replaceChild(referenceDiv, quoteEl);
          restoreTimelineAnchor(anchor, container);
          try { updateNostrNpubLinks(referenceDiv); } catch (e) { }
          if (depth < maxDepth) {
            try {
              await updateNostrNoteLinks(
                referenceDiv,
                showEventModal,
                state,
                nip19,
                reactToEvent,
                replyToEvent,
                repostEvent,
                settings,
                settingsManager,
                { depth: depth + 1, maxDepth }
              );
            } catch (e) { }
          }
        }
      } else {
        const { showJsonModal } = await import('../../ui/modals/json-modal.js');
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'nostr-link nostr-event-json';
        link.textContent = `[kind ${event.kind} event]`;
        link.style.cssText = 'color: #fbbf24; text-decoration: none; border-bottom: 1px solid transparent; font-size: 0.9em;';
        link.onclick = function (e) {
          e.preventDefault();
          showJsonModal(event);
          return false;
        };
        quoteEl.parentNode.replaceChild(link, quoteEl);
      }
      return true;
    } else if (event) {
      const { showJsonModal } = await import('../../ui/modals/json-modal.js');
      const link = document.createElement('a');
      link.href = '#';
      link.className = 'nostr-link nostr-event-json';
      link.textContent = `[kind ${event.kind} event]`;
      link.style.cssText = 'color: #fbbf24; text-decoration: none; border-bottom: 1px solid transparent; font-size: 0.9em;';
      link.onclick = function (e) {
        e.preventDefault();
        showJsonModal(event);
        return false;
      };
      quoteEl.parentNode.replaceChild(link, quoteEl);
      return true;
    }

    return false;
  } catch (e) {
    console.warn('[UrlParser] 引用イベント取得に失敗:', e);
    return false;
  }
}

export function attachQuoteRetryHandler(quoteEl, container, showEventModal, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager, depth, maxDepth) {
  if (!quoteEl || quoteEl.dataset.retryHandlerInstalled === '1') return;
  quoteEl.dataset.retryHandlerInstalled = '1';
  quoteEl.classList.add('nostr-quote-clickable');
  quoteEl.setAttribute('role', 'button');
  quoteEl.tabIndex = 0;

  const placeholderText = quoteEl.textContent;

  const handleActivate = async (e) => {
    try { e.stopPropagation(); } catch (_) { }
    if (quoteEl.dataset.retryLoading === '1') return;
    if (!quoteEl.isConnected) return;
    quoteEl.dataset.retryLoading = '1';
    quoteEl.textContent = t('quote.loading', '取得中...');
    let resolved;
    try {
      resolved = await resolveAndRenderQuote(
        quoteEl, container, showEventModal, state, nip19,
        reactToEvent, replyToEvent, repostEvent, settings, settingsManager,
        depth, maxDepth
      );
    } catch (err) { resolved = false; }
    if (!resolved && quoteEl.isConnected) {
      quoteEl.textContent = placeholderText;
      delete quoteEl.dataset.retryLoading;
    }
  };

  quoteEl.addEventListener('click', handleActivate);
  quoteEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      handleActivate(e);
    }
  });
}

export async function renderEventQuote(state, event, nip19, settings = {}) {
  const { displayName } = await import('../../features/profile/profile.js');
  let author;
  if (event && event.kind === 20000) {
    const pk = event.pubkey || '';
    const hash = (pk && pk.length >= 4) ? '#' + pk.slice(-4) : '';
    const nTag = Array.isArray(event.tags) ? event.tags.find(t => t && t[0] === 'n') : null;
    const nName = (nTag && nTag[1]) ? String(nTag[1]).trim() : '';
    author = truncateName(nName || hash);
  } else {
    author = truncateName(displayName(state, event.pubkey, nip19));
  }
  const content = event.content || '';
  let quoteContentHtml;
  let previewMaxLength = MAX_PREVIEW_LENGTH;
  try {
    const sm = (typeof window !== 'undefined' && window.settingsManager) ? window.settingsManager : null;
    if (sm && typeof sm.get === 'function') {
      const v = sm.get('previewMaxLength');
      if (v && !isNaN(v)) previewMaxLength = parseInt(v, 10);
    }
  } catch {}
  if (getEffectiveTextLength(content) > previewMaxLength || content.split('\n').length > MAX_PREVIEW_LINES) {
    const previewText = getPreviewWithFullLinksAndEmojis(content, previewMaxLength, MAX_PREVIEW_LINES);
    quoteContentHtml = `<span class="reply-preview-text">${linkifyText(previewText, event.tags || [], { inlineMedia: false })}</span>`;
    if (previewText.length < content.length) {
      quoteContentHtml += `<button type="button" class="read-more-btn secondary quote-read-more">${t('see_detail','省略されています')}</button>`;
    }
  } else {
    quoteContentHtml = `<span class="reply-preview-text">${linkifyText(content, event.tags || [], { inlineMedia: false })}</span>`;
  }
  const quotedLabel = replaceBadgeEmoji(t('quote.label', { author: escapeHtml(author) }));
  return '<div class="event-quote">' +
    '<div class="event-quote-header">' +
    '<span class="reply-marker"><img src="icon/note.png" alt="' + escapeHtml(t('quote.icon_alt') || '引用') + '" class="icon"/></span>' +
    '<span class="event-quote-label" data-pubkey="' + event.pubkey + '">' + quotedLabel + '</span>' +
    '</div>' +
    `<div class="event-quote-content" data-event-id="${event.id || ''}">${quoteContentHtml}</div>` +
    '</div>';
}

export function fitCustomEmoji(container, shortSidePx = 28) {
  if (!container) return;
  try {
    const effectiveShort = Math.max(1, Math.round(shortSidePx || 0));
    const inlineEnlargeFactor = 1.0;
    const inlineShort = Math.max(1, Math.round(effectiveShort * inlineEnlargeFactor));

    const imgs = container.querySelectorAll('img.custom-emoji');
    imgs.forEach(img => {
      try {
        const wrap = img.closest('.emoji-wrap') || img.parentElement;
        const applySizing = () => {
          try {
            const inlineGroup = img.closest('.emoji-inline-group');
            const emojiLineAncestor = img.closest('.emoji-line');
            const isReaction = img.closest('.reply-marker') || img.closest('.btn-react') || img.closest('.event-actions-react');
            if (isReaction) {
              img.style.height = 'auto';
              img.style.maxHeight = '18px';
              img.style.width = 'auto';
              img.style.maxWidth = '100%';
              img.style.display = 'inline-block';
              img.style.verticalAlign = '-0.15em';
              img.style.margin = '0';
              img.style.padding = '0';
              img.style.lineHeight = '1';
            } else if (inlineGroup) {
              const targetShort = inlineShort;
              img.style.height = 'auto';
              img.style.maxHeight = targetShort + 'px';
              img.style.width = 'auto';
              img.style.maxWidth = '100%';
              img.style.display = 'inline-block';
              img.style.verticalAlign = 'middle';
              img.style.margin = '0';
              img.style.padding = '0';
              img.style.lineHeight = '1';
              if (wrap) {
                wrap.style.maxWidth = '100%';
                wrap.style.display = 'inline-block';
                wrap.style.margin = '0';
                wrap.style.padding = '0';
                wrap.style.lineHeight = '1';
                wrap.style.verticalAlign = 'middle';
              }
            } else if (emojiLineAncestor) {
              const nw = img.naturalWidth || img.width || 0;
              const nh = img.naturalHeight || img.height || 0;
              if (!nw || !nh) {
                img.style.height = 'auto';
                img.style.maxHeight = effectiveShort + 'px';
                img.style.width = 'auto';
                if (wrap) wrap.style.height = img.getBoundingClientRect().height + 'px';
              } else if (nw <= nh) {
                img.style.width = effectiveShort + 'px';
                img.style.height = 'auto';
              } else {
                img.style.height = 'auto';
                img.style.maxHeight = effectiveShort + 'px';
                img.style.width = 'auto';
              }
              img.style.display = 'block';
              img.style.margin = '0';
              img.style.padding = '0';
              img.style.lineHeight = '1';
              img.style.objectFit = 'contain';
              img.style.maxWidth = '100%';
              if (wrap) {
                wrap.style.maxWidth = '100%';
                const rect = img.getBoundingClientRect();
                if (rect && rect.height) {
                  wrap.style.height = rect.height + 'px';
                  wrap.style.display = 'inline-block';
                  wrap.style.margin = '0';
                  wrap.style.padding = '0';
                  wrap.style.verticalAlign = 'top';
                }
              }
            } else {
              const maxEmH = 3.6;
              const nw = img.naturalWidth || img.width || 0;
              const nh = img.naturalHeight || img.height || 0;
              if (!nw || !nh) {
                img.style.height = 'auto';
                img.style.maxHeight = (effectiveShort * 1.0) + 'px';
                img.style.width = 'auto';
                if (wrap) wrap.style.height = img.getBoundingClientRect().height + 'px';
              } else if (nw <= nh) {
                img.style.width = effectiveShort + 'px';
                img.style.height = 'auto';
                img.style.maxHeight = maxEmH + 'em';
              } else {
                img.style.height = 'auto';
                img.style.maxHeight = effectiveShort + 'px';
                img.style.width = 'auto';
              }
              img.style.display = 'block';
              img.style.objectFit = 'contain';
              img.style.maxWidth = '100%';
              if (wrap) {
                wrap.style.maxWidth = '100%';
                const rect = img.getBoundingClientRect();
                if (rect && rect.height) {
                  wrap.style.height = rect.height + 'px';
                  wrap.style.display = 'inline-block';
                  wrap.style.verticalAlign = 'top';
                }
              }
            }
          } catch (e) { }
          try { followUpTimelineAnchor(container); } catch (e) { }
        };

        if (img.complete && (img.naturalWidth || img.naturalHeight)) {
          applySizing();
        } else {
          img.addEventListener('load', applySizing, { once: true });
          setTimeout(applySizing, 300);
        }
      } catch (e) { }
    });
  } catch (e) { }
}
