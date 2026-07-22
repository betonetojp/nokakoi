import { escapeHtml, fmtTime, processHiddenTagChars, buildReactionEmojiTags, replaceBadgeEmoji } from '../../utils/utils.js';
import { findEventById } from '../../core/state.js';
import { displayNameWithUsername } from '../../features/profile/profile.js';
import { showReactionModal, showConfirmModal } from '../modals/modals.js';
import { linkifyText, updateNostrNpubLinks, updateNostrNoteLinks, fitCustomEmoji, getPreviewWithFullLinksAndEmojis, getEffectiveTextLength } from '../../utils/url-parser.js';
import { setReplyTarget, setGeohashTarget, setQuoteTarget } from '../../features/post/composer.js';
import { showJsonModal } from '../modals/json-modal.js';
import { showEventModal } from '../modals/event-modal.js';
import { showMediaViewer } from '../media-viewer.js';
import { t, applyTranslations } from '../../utils/i18n.js';
import { replyToEvent as apiReplyToEvent } from '../../features/post/actions.js';
import { MAX_PREVIEW_LENGTH, MAX_PREVIEW_LINES } from '../../config/constants.js';
import { pickChannelRootId, scheduleChannelLabelUpdate } from '../../features/channel/channel.js';

import {
  pickETagEventId,
  applyMutedToneToEvent,
  evaluateMuteState,
  formatReactionForTitle,
  invokeShowProfileModalProxy,
  installReactionDefaultListener
} from './render-helpers.js';

import {
  setReactionDisplay,
  getReactionLabel
} from './reaction-renderer.js';

import { renderChannelContext } from './channel-renderer.js';
import { applyClientBadgeToContainer } from './badge-renderer.js';
import { renderReplyContext } from './reply-renderer.js';

/**
 * リアクションボタンのセットアップ
 */
export function setupReactButton(div, ev, settings, settingsManager, reactToEvent) {
  const reactBtn = div.querySelector('.btn-react');
  if (!reactBtn) return;

  const resolveImmediateEmojiTags = function (reaction) {
    let emojiTags = [];
    try {
      if (ev && Array.isArray(ev.tags)) {
        emojiTags = ev.tags;
      }
      if (typeof window !== 'undefined' && window.userKind7Memory && typeof window.userKind7Memory.get === 'function') {
        const mem = window.userKind7Memory.get(ev && ev.id);
        if (mem && typeof mem === 'object' && Array.isArray(mem.emojiTags)) {
          emojiTags = mem.emojiTags;
        }
      }
    } catch (e) { }

    try {
      const fallbackEmojiTags = buildReactionEmojiTags(reaction);
      for (const emojiTag of fallbackEmojiTags) {
        const hasEmojiTag = (emojiTags || []).some(tag => Array.isArray(tag) && tag[0] === 'emoji' && tag[1] === emojiTag[1] && tag[2]);
        if (!hasEmojiTag) {
          emojiTags = (emojiTags || []).concat([emojiTag]);
        }
      }
    } catch (e) { }

    return emojiTags;
  };

  const applyReactionUI = function (reaction) {
    const emojiTags = resolveImmediateEmojiTags(reaction);
    setReactionDisplay(reactBtn, reaction, emojiTags);
    reactBtn.dataset.reacted = reaction ? 'true' : 'false';
    try {
      const lbl = getReactionLabel(reaction, emojiTags);
      reactBtn.dataset.reactionDisplay = lbl;
      reactBtn.title = t('reaction.button.title_with_default', { display: lbl });
    } catch (e) { }
  };

  const restoreReactionUI = function () {
    const stored = settingsManager.getUserReaction(ev.id);
    if (stored) {
      applyReactionUI(stored);
      return;
    }
    reactBtn.innerHTML = '<img src="icon/star.png" alt="" class="icon-btn" data-i18n-alt="reaction.button.title">';
    try { reactBtn.dataset.reacted = 'false'; } catch (e) { }
    try { delete reactBtn.dataset.reactionDisplay; } catch (e) { }
    try { reactBtn.title = t('reaction.button.title'); } catch (e) { }
  };

  try { installReactionDefaultListener(settingsManager); } catch (e) { }

  const userReaction = settingsManager.getUserReaction(ev.id);
  if (userReaction) {
    applyReactionUI(userReaction);
  }

  const currentDefault = (settingsManager && typeof settingsManager.get === 'function') ? (settingsManager.get('reactionDefault') || settings.reactionDefault || '+') : (settings.reactionDefault || '+');
  const display = formatReactionForTitle(currentDefault);
  try { reactBtn.dataset.reactionDisplay = reactBtn.dataset.reactionDisplay || display; } catch (e) { }
  reactBtn.title = t('reaction.button.title_with_default', { display: display });

  let lpTimer = null;
  let lpTriggered = false;
  let suppressClickUntil = 0;

  const openSetDefault = function () {
    lpTriggered = true;
    const nowDefault = (settingsManager && typeof settingsManager.get === 'function') ? (settingsManager.get('reactionDefault') || settings.reactionDefault || '+') : (settings.reactionDefault || '+');
    const runReactOnce = async (symbol) => {
      const ok = await reactToEvent(ev, symbol);
      if (!ok) {
        restoreReactionUI();
        throw new Error('react_failed');
      }
      settingsManager.saveUserReaction(ev.id, symbol);
      applyReactionUI(symbol);
    };
    showReactionModal(nowDefault, (symbol) => {
      settingsManager.set('reactionDefault', symbol);
      const display = formatReactionForTitle(symbol);
      reactBtn.title = t('reaction.button.title_with_default', { display: display });
    }, settingsManager, {
      showReactActions: true,
      onSaveAndReact: runReactOnce,
      onReactOnly: runReactOnce
    });
    suppressClickUntil = Date.now() + 700;
  };

  reactBtn.addEventListener('touchstart', function (e) {
    lpTriggered = false;
    try { if (lpTimer) clearTimeout(lpTimer); } catch { }
    lpTimer = setTimeout(function () {
      try { e.preventDefault(); } catch { }
      openSetDefault();
    }, 600);
  }, { passive: false });

  const cancelLp = function () {
    try { if (lpTimer) clearTimeout(lpTimer); } catch { }
    lpTimer = null;
  };

  reactBtn.addEventListener('touchend', function (e) {
    cancelLp();
    if (lpTriggered) {
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch { }
      return false;
    }
  }, { passive: false });

  reactBtn.addEventListener('touchmove', cancelLp, { passive: true });
  reactBtn.addEventListener('touchcancel', cancelLp, { passive: true });

  reactBtn.onclick = async function (e) {
    if (Date.now() < suppressClickUntil) return;

    if (e && (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey)) {
      const nowDefault = (settingsManager && typeof settingsManager.get === 'function') ? (settingsManager.get('reactionDefault') || settings.reactionDefault || '+') : (settings.reactionDefault || '+');
      const runReactOnce = async (symbol) => {
        const ok = await reactToEvent(ev, symbol);
        if (!ok) {
          restoreReactionUI();
          throw new Error('react_failed');
        }
        settingsManager.saveUserReaction(ev.id, symbol);
        applyReactionUI(symbol);
      };

      showReactionModal(nowDefault, (symbol) => {
        settingsManager.set('reactionDefault', symbol);
        const display = formatReactionForTitle(symbol);
        reactBtn.title = t('reaction.button.title_with_default', { display: display });
      }, settingsManager, {
        showReactActions: true,
        onSaveAndReact: runReactOnce,
        onReactOnly: runReactOnce
      });
    } else {
      const reactionSym = (settingsManager && typeof settingsManager.get === 'function') ? (settingsManager.get('reactionDefault') || settings.reactionDefault || '+') : (settings.reactionDefault || '+');
      const ok = await reactToEvent(ev, reactionSym);
      if (!ok) {
        restoreReactionUI();
        return;
      }
      settingsManager.saveUserReaction(ev.id, reactionSym);
      applyReactionUI(reactionSym);
    }
  };

  reactBtn.oncontextmenu = function (e) {
    e.preventDefault();
    const nowDefault = (settingsManager && typeof settingsManager.get === 'function') ? (settingsManager.get('reactionDefault') || settings.reactionDefault || '+') : (settings.reactionDefault || '+');
    const runReactOnce = async (symbol) => {
      const ok = await reactToEvent(ev, symbol);
      if (!ok) throw new Error('react_failed');
      settingsManager.saveUserReaction(ev.id, symbol);
      applyReactionUI(symbol);
    };
    showReactionModal(nowDefault, (symbol) => {
      settingsManager.set('reactionDefault', symbol);
      const display = formatReactionForTitle(symbol);
      reactBtn.title = t('reaction.button.title_with_default', { display: display });
      try { reactBtn.dataset.reactionDisplay = display; } catch (e) { }
    }, settingsManager, {
      showReactActions: true,
      onSaveAndReact: runReactOnce,
      onReactOnly: runReactOnce
    });
    return false;
  };
  try { reactBtn.dataset.listenerInstalled = '1'; } catch (e) { }
}

export function setupReplyButton(div, ev, replyToEvent) {
  const replyBtn = div.querySelector('.btn-reply');
  if (!replyBtn) return;
  replyBtn.onclick = function () {
    replyToEvent(ev);
  };
}

export function setupRepostButton(div, ev, repostEvent) {
  const repostBtn = div.querySelector('.btn-repost');
  if (!repostBtn) return;

  repostBtn.onclick = async function () {
    showConfirmModal(
      t('repost.confirm.title'),
      t('repost.confirm.message'),
      async () => {
        try {
          repostBtn.disabled = true;
          repostBtn.innerHTML = '...';

          const success = await repostEvent(ev);
          if (success) {
            repostBtn.innerHTML = '✓';
            setTimeout(() => {
              repostBtn.innerHTML = '<img src="icon/repost.png" alt="' + t('repost') + '" class="icon-btn">';
              repostBtn.disabled = false;
            }, 2000);
          } else {
            repostBtn.innerHTML = '<img src="icon/repost.png" alt="' + t('repost') + '" class="icon-btn">';
            repostBtn.disabled = false;
          }
        } catch (e) {
          console.error(t('repost.failed'), e);
          repostBtn.innerHTML = '<img src="icon/repost.png" alt="' + t('repost') + '" class="icon-btn">';
          repostBtn.disabled = false;
        }
      }
    );
  };
}

function buildEventContainer(ev) {
  const div = document.createElement('div');
  div.className = 'event';
  div.dataset.eventId = ev.id;
  div.dataset.kind = ev.kind;
  if (ev.kind === 42) div.classList.add('event-channel');
  return div;
}

function buildEventNameBlockHtml(state, ev, settings, names, statusHtml) {
  const pk = ev.pubkey;
  const showAvatars = settings.showAvatars !== false;
  let avatarHtml = '';
  if (showAvatars) {
    const profile = state.profiles.get(pk);
    const avatarUrl = (profile && profile.picture) || '';
    if (avatarUrl) {
      avatarHtml = '<img src="' + escapeHtml(avatarUrl) + '" alt="avatar" class="avatar" loading="lazy" onerror="this.classList.add(\'d-none\')">';
    }
  }

  let namePrimaryHtml = '<span class="name" data-pubkey="' + pk + '">' + replaceBadgeEmoji(escapeHtml(names.main)) + '</span>';
  if (ev.kind === 20000) {
    const hash = (pk && pk.length >= 4) ? '#' + pk.slice(-4) : '';
    if (hash) {
      namePrimaryHtml += '<span class="username">' + escapeHtml(hash) + '</span>';
    }
    if (ev.tags) {
      const gTag = ev.tags.find(t => t[0] === 'g');
      if (gTag && gTag[1]) {
        namePrimaryHtml += '<span class="username omochat-geohash" data-geohash="' + escapeHtml(gTag[1]) + '" style="margin-left:4px; opacity:0.8; cursor:pointer;">📍' + escapeHtml(gTag[1]) + '</span>';
      }
    }
  } else if (names.sub) {
    namePrimaryHtml += '<span class="username">@' + escapeHtml(names.sub) + '</span>';
  }

  return (
    '<div class="event-name">' +
    avatarHtml +
    '<div class="event-name-text">' +
    '<div class="event-name-primary">' + namePrimaryHtml + '</div>' +
    statusHtml +
    '</div></div>'
  );
}

function renderEventContent(state, ev, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent, contentEl, allowInlineMedia) {
  if (!contentEl) return;
  const content = ev.content || '';
  if (ev.kind !== 7 && ev.kind !== 6 && ev.kind !== 16) {
    const previewMaxLength = (settingsManager && typeof settingsManager.get === 'function' && settingsManager.get('previewMaxLength')) ? parseInt(settingsManager.get('previewMaxLength'), 10) : MAX_PREVIEW_LENGTH;
    if (getEffectiveTextLength(content) > previewMaxLength || content.split('\n').length > MAX_PREVIEW_LINES) {
      const previewText = getPreviewWithFullLinksAndEmojis(content, previewMaxLength, MAX_PREVIEW_LINES);
      contentEl.innerHTML = linkifyText(previewText, ev.tags || [], { inlineMedia: allowInlineMedia });
      if (previewText.length < content.length) {
        const seeDetailBtn = document.createElement('button');
        seeDetailBtn.type = 'button';
        seeDetailBtn.className = 'read-more-btn secondary';
        seeDetailBtn.textContent = t && typeof t === 'function' ? t('see_detail') : '省略されています';
        contentEl.appendChild(seeDetailBtn);
        seeDetailBtn.addEventListener('click', function() {
          showEventModal(ev, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
        });
      }
      updateNostrNpubLinks(contentEl);
      updateNostrNoteLinks(
        contentEl,
        showEventModal,
        state,
        nip19,
        reactToEvent,
        replyToEvent,
        repostEvent,
        settings,
        settingsManager
      );
      try { processHiddenTagChars(contentEl); } catch (e) { }
    } else {
      contentEl.innerHTML = linkifyText(content, ev.tags || [], { inlineMedia: allowInlineMedia });
      updateNostrNpubLinks(contentEl);
      updateNostrNoteLinks(
        contentEl,
        showEventModal,
        state,
        nip19,
        reactToEvent,
        replyToEvent,
        repostEvent,
        settings,
        settingsManager
      );
      try { processHiddenTagChars(contentEl); } catch (e) { }
    }
  } else {
    contentEl.classList.add('d-none');
  }
}

function setupContentWarning(div, ev, contentEl, isCwExpanded, markCwExpanded) {
  try {
    const cwTag = (ev.tags || []).find(t => t[0] === 'content-warning');
    if (cwTag) {
      div.dataset.hasCw = '1';
      const reason = cwTag[1] || '';

      if (!isCwExpanded) {
        if (contentEl) contentEl.classList.add('d-none');

        const foldBar = document.createElement('div');
        foldBar.className = 'muted-fold-bar muted-small cw-fold-bar';

        const left = document.createElement('div');
        left.className = 'cw-fold-bar-left';

        const cwLabel = document.createElement('span');
        cwLabel.className = 'cw-fold-bar-label';

        if (reason) {
          cwLabel.textContent = t('content_warning.reason', { reason: reason });
        } else {
          cwLabel.setAttribute('data-i18n', 'content_warning');
          cwLabel.textContent = t('content_warning');
        }
        left.appendChild(cwLabel);
        foldBar.appendChild(left);

        const expandBtn = document.createElement('button');
        expandBtn.type = 'button';
        expandBtn.className = 'secondary small cw-fold-bar-btn';
        expandBtn.setAttribute('data-i18n', 'fold.show');
        expandBtn.textContent = t('fold.show');

        foldBar.appendChild(expandBtn);

        if (contentEl && contentEl.parentNode) {
          contentEl.parentNode.insertBefore(foldBar, contentEl);
        }

        expandBtn.onclick = function (e) {
          try {
            if (contentEl) contentEl.classList.remove('d-none');
            try { if (markCwExpanded) markCwExpanded(ev.id, true); } catch (e) { }
            try { foldBar.parentNode && foldBar.parentNode.removeChild(foldBar); } catch (e) { }
          } catch (e) { }
        };
      } else if (contentEl) {
        contentEl.classList.remove('d-none');
      }
    }
  } catch (e) {
    console.warn('[Renderer] CW 処理に失敗', e);
  }
}

function setupMuteCollapse(div, ev, contentEl, muteState, isMutedExpanded, markMutedExpanded) {
  try {
    const isMuted = !!muteState.isMuted;
    const mutedType = muteState.mutedType;
    const muteApply = !!muteState.muteApply;
    const muteDisplayMode = muteState.muteDisplayMode || 'collapse';

    if (isMuted && !muteApply) {
      try {
        div.classList.add('muted-event-soft');
        applyMutedToneToEvent(div);
      } catch (e) { }
    }

    if (isMuted && muteApply) {
      applyMutedToneToEvent(div);
      if (muteDisplayMode === 'hide') {
        div.classList.add('muted-event', 'muted-hidden', 'd-none');
        return true;
      }

      div.dataset.muteCollapsible = '1';
      div.classList.add('muted-event');
      if (!isMutedExpanded) {
        try {
          if (contentEl) contentEl.classList.add('d-none');
          const actionReact = div.querySelector('.event-actions-react'); if (actionReact) actionReact.classList.add('d-none');
          const actionBottom = div.querySelector('.event-actions-bottom'); if (actionBottom) actionBottom.classList.add('d-none');
          const topRowEl = div.querySelector('.event-top-row');
          if (topRowEl) topRowEl.classList.add('d-none');

          const cwBar = div.querySelector('.cw-fold-bar');
          if (cwBar) cwBar.classList.add('d-none');
        } catch (e) { }

        const foldBar = document.createElement('div');
        foldBar.className = 'muted-fold-bar muted-small';

        const left = document.createElement('div');
        left.className = 'muted-fold-bar-left';

        try {
          const topRowEl = div.querySelector('.event-top-row');
          if (topRowEl) {
            const cloned = topRowEl.cloneNode(true);
            const clonedActions = cloned.querySelector('.event-actions-react');
            if (clonedActions) clonedActions.parentNode && clonedActions.parentNode.removeChild(clonedActions);
            const clonedBottom = cloned.querySelector('.event-actions-bottom');
            if (clonedBottom) clonedBottom.parentNode && clonedBottom.parentNode.removeChild(clonedBottom);

            const img = cloned.querySelector('img.avatar');
            if (img) {
              img.className = 'avatar muted-avatar';
            }
            const nameSpan = cloned.querySelector('.name');
            if (nameSpan) nameSpan.classList.add('muted-name');

            left.appendChild(cloned);

            const muteLabel = document.createElement('span');
            muteLabel.className = 'mute-event-label';
            try {
              if (mutedType === 'user') {
                muteLabel.textContent = t('muted.user');
              } else if (mutedType === 'word') {
                muteLabel.textContent = t('muted.word');
              } else {
                muteLabel.textContent = t('muted.generic');
              }
            } catch (e) {
              if (mutedType === 'user') muteLabel.setAttribute('data-i18n', 'muted.user');
              else if (mutedType === 'word') muteLabel.setAttribute('data-i18n', 'muted.word');
              else muteLabel.setAttribute('data-i18n', 'muted.generic');
            }

            const labelAndBtnWrap = document.createElement('div');
            labelAndBtnWrap.className = 'mute-label-wrap';
            labelAndBtnWrap.appendChild(muteLabel);
            left.appendChild(labelAndBtnWrap);
          } else {
            const lbl = mutedType === 'user' ? t('muted.user') : (mutedType === 'word' ? t('muted.word') : t('muted.generic'));
            left.innerHTML = '<span class="mute-event-label">' + lbl + '</span>';
          }
        } catch (e) {
          left.textContent = t('muted.generic');
        }

        const expandBtn = document.createElement('button');
        expandBtn.type = 'button';
        expandBtn.className = 'secondary small muted-fold-expand-btn';
        expandBtn.textContent = t('fold.show');

        try {
          const wrapper = left.querySelector('.mute-label-wrap');
          const muteSpan = wrapper && wrapper.querySelector('span');
          const muteColor = muteSpan ? (muteSpan.style.color || getComputedStyle(muteSpan).color) : null;
          if (muteColor) {
            expandBtn.style.color = muteColor;
            expandBtn.style.borderColor = muteColor;
          } else {
            expandBtn.style.color = 'var(--muted)';
            expandBtn.style.borderColor = 'var(--muted)';
          }
          if (wrapper) {
            expandBtn.style.marginLeft = '6px';
            wrapper.appendChild(expandBtn);
          }
        } catch (e) {
          expandBtn.style.color = 'var(--muted)';
          expandBtn.style.borderColor = 'var(--muted)';
        }

        foldBar.appendChild(left);

        const replyNode = div.querySelector('.reply-to');
        if (replyNode && replyNode.parentNode) replyNode.parentNode.insertBefore(foldBar, replyNode.nextSibling);
        else if (contentEl && contentEl.parentNode) contentEl.parentNode.insertBefore(foldBar, contentEl);
        else div.insertBefore(foldBar, div.firstChild);

        expandBtn.onclick = function (e) {
          try {
            const cwTag = (ev.tags || []).find(t => t[0] === 'content-warning');
            const cwBar = div.querySelector('.cw-fold-bar');

            if (cwTag && cwBar) {
              cwBar.classList.remove('d-none');
            } else {
              if (contentEl) contentEl.classList.remove('d-none');
            }

            const actionReact = div.querySelector('.event-actions-react'); if (actionReact) actionReact.classList.remove('d-none');
            const actionBottom = div.querySelector('.event-actions-bottom'); if (actionBottom) actionBottom.classList.remove('d-none');
            const topRowEl2 = div.querySelector('.event-top-row');
            if (topRowEl2) topRowEl2.classList.remove('d-none');
            try { if (markMutedExpanded) markMutedExpanded(ev.id, true); } catch (e) { }
            try { foldBar.parentNode && foldBar.parentNode.removeChild(foldBar); } catch (e) { }
          } catch (e) {
            console.warn('[Renderer] ミュートイベントの展開に失敗', e);
          }
        };
      } else {
        try {
          const actionReact = div.querySelector('.event-actions-react'); if (actionReact) actionReact.classList.remove('d-none');
          const actionBottom = div.querySelector('.event-actions-bottom'); if (actionBottom) actionBottom.classList.remove('d-none');
          const topRowEl = div.querySelector('.event-top-row'); if (topRowEl) topRowEl.classList.remove('d-none');
          if (contentEl) contentEl.classList.remove('d-none');
          const cwBar = div.querySelector('.cw-fold-bar');
          if (cwBar) cwBar.classList.remove('d-none');
        } catch (e) { }
      }
    }
  } catch (e) {
    if (window.__nokakoiDebug) console.warn('[Renderer] ミュートUI処理に失敗', e);
  }
  return false;
}

function bindProfileClickHandlers(div, ev, state, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent) {
  const pk = ev.pubkey;

  const nameEl = div.querySelector('.name');
  if (nameEl) {
    nameEl.onclick = function () {
      invokeShowProfileModalProxy(pk);
    };
  }

  const geohashEl = div.querySelector('.omochat-geohash');
  if (geohashEl) {
    geohashEl.onclick = function (e) {
      e.stopPropagation();
      const gh = geohashEl.dataset.geohash;
      if (gh) {
        setGeohashTarget(gh);
      }
    };
  }

  const replyToAuthorEl = div.querySelector('.reply-to-author[data-pubkey], .reply-to-author[data-event-id]');
  if (replyToAuthorEl) {
    if (replyToAuthorEl.hasAttribute('data-pubkey')) {
      replyToAuthorEl.onclick = function () {
        const pubkey = replyToAuthorEl.getAttribute('data-pubkey');
        if (pubkey) {
          invokeShowProfileModalProxy(pubkey);
        }
      };
    } else if (replyToAuthorEl.hasAttribute('data-event-id')) {
      replyToAuthorEl.onclick = async function () {
        const eventId = replyToAuthorEl.getAttribute('data-event-id');
        if (eventId && state && state.pool) {
          const { getReadRelays } = await import('../../core/relay.js');
          const relays = getReadRelays(state.relays);
          let event = null;
          if (relays && relays.length > 0) {
            event = await state.pool.get(relays, { ids: [eventId] });
          }
          if (event) {
            showEventModal(event, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
          }
        }
      };
    }
  }

  const quoteLabelEls = div.querySelectorAll('.event-quote-label.name[data-pubkey]');
  quoteLabelEls.forEach(labelEl => {
    labelEl.onclick = function () {
      const pubkey = labelEl.getAttribute('data-pubkey');
      if (pubkey) {
        invokeShowProfileModalProxy(pubkey);
      }
    };
  });
}

function bindJsonButtonHandlers(div, ev, nip19) {
  const jsonBtns = div.querySelectorAll('.btn-json');
  jsonBtns.forEach(jsonBtn => {
    let longPressTimer = null;
    let longPressTriggered = false;
    let suppressClickUntil = 0;

    jsonBtn.addEventListener('touchstart', function (e) {
      longPressTriggered = false;
      try { if (longPressTimer) clearTimeout(longPressTimer); } catch { }

      longPressTimer = setTimeout(function () {
        longPressTriggered = true;
        try { e.preventDefault(); } catch { }

        const sm = window.settingsManager;
        const appTitle = (sm && typeof sm.get === 'function') ? (sm.get('eventLinkTitle') || 'lumilumi') : 'lumilumi';
        const appUrl = (sm && typeof sm.get === 'function') ? (sm.get('eventLinkUrl') || 'https://lumilumi.app/') : 'https://lumilumi.app/';

        showConfirmModal(
          '',
          t('eventlink.confirm', { title: appTitle }),
          () => {
            try {
              let nevent = null;
              if (nip19) {
                try {
                  if (nip19.neventEncode && typeof nip19.neventEncode === 'function') {
                    nevent = nip19.neventEncode({ id: ev.id, relays: [] });
                  } else if (nip19.nevent && typeof nip19.nevent.encode === 'function') {
                    nevent = nip19.nevent.encode({ id: ev.id, relays: [] });
                  }
                } catch (ex) { }
              }
              if (!nevent) nevent = 'nevent1' + ev.id;
              const separator = appUrl.endsWith('/') ? '' : '/';
              window.open(appUrl + separator + nevent, '_blank', 'noopener,noreferrer');
            } catch (ex) { }
          }
        );

        suppressClickUntil = Date.now() + 700;
      }, 600);
    }, { passive: false });

    const cancelLongPress = function () {
      try { if (longPressTimer) clearTimeout(longPressTimer); } catch { }
      longPressTimer = null;
    };

    jsonBtn.addEventListener('touchend', function (e) {
      const wasTriggered = longPressTriggered;
      cancelLongPress();
      if (wasTriggered) {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch { }
        return false;
      }
    }, { passive: false });

    jsonBtn.addEventListener('touchmove', cancelLongPress, { passive: true });
    jsonBtn.addEventListener('touchcancel', cancelLongPress, { passive: true });

    jsonBtn.onclick = function () {
      if (Date.now() < suppressClickUntil) return;
      showJsonModal(ev);
    };

    jsonBtn.oncontextmenu = function (e) {
      e.preventDefault();
      const sm = window.settingsManager;
      const appTitle = (sm && typeof sm.get === 'function') ? (sm.get('eventLinkTitle') || 'lumilumi') : 'lumilumi';
      const appUrl = (sm && typeof sm.get === 'function') ? (sm.get('eventLinkUrl') || 'https://lumilumi.app/') : 'https://lumilumi.app/';

      showConfirmModal(
        '',
        t('eventlink.confirm', { title: appTitle }),
        () => {
          try {
            let nevent = null;
            if (nip19) {
              try {
                if (nip19.neventEncode && typeof nip19.neventEncode === 'function') {
                  nevent = nip19.neventEncode({ id: ev.id, relays: [] });
                } else if (nip19.nevent && typeof nip19.nevent.encode === 'function') {
                  nevent = nip19.nevent.encode({ id: ev.id, relays: [] });
                }
              } catch (ex) { }
            }
            if (!nevent) nevent = 'nevent1' + ev.id;
            const separator = appUrl.endsWith('/') ? '' : '/';
            window.open(appUrl + separator + nevent, '_blank', 'noopener,noreferrer');
          } catch (ex) { }
        }
      );
      return false;
    };
  });
}

function bindQuoteButtonHandler(div, ev, state, nip19) {
  try {
    const quoteBtn = div.querySelector('.btn-quote');
    if (quoteBtn) {
      quoteBtn.onclick = function (e) {
        e.stopPropagation();
        const composer = document.getElementById('composer');
        if (composer) composer.hidden = false;
        const noteInput = document.getElementById('noteInput');
        if (noteInput) {
          import('../../core/nostr-compat.js').then(mod => {
            try {
              const nip19local = mod.getNip19 && mod.getNip19();
              let nevent = null;
              if (nip19local) {
                try {
                  if (nip19local.nevent && typeof nip19local.nevent.encode === 'function') nevent = nip19local.nevent.encode({ id: ev.id, relays: [] });
                } catch (e) { }
                try {
                  if (!nevent && typeof nip19local.neventEncode === 'function') nevent = nip19local.neventEncode({ id: ev.id, relays: [] });
                } catch (e) { }
              }
              if (!nevent) nevent = 'nevent1' + ev.id;
              if (!/^nostr:/i.test(nevent)) nevent = 'nostr:' + nevent;
              noteInput.value = '\n' + nevent + '\n';
              noteInput.focus();
              noteInput.selectionStart = noteInput.selectionEnd = 0;
            } catch (e) {
              noteInput.value = '\nnostr:nevent1' + ev.id + '\n';
              noteInput.focus();
              noteInput.selectionStart = noteInput.selectionEnd = 0;
            }
          }).catch(() => {
            noteInput.value = '\nnostr:nevent1' + ev.id + '\n';
            noteInput.focus();
            noteInput.selectionStart = noteInput.selectionEnd = 0;
          });
        }
        try { setQuoteTarget(state, ev, nip19); window.__nokakoiQuoteMode = true; } catch (e) { }
      };
    }
  } catch (e) { }
}

function bindContentClickHandlers(div, ev, state, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent) {
  const replyContentEls = div.querySelectorAll('.reply-to-content');
  replyContentEls.forEach(el => {
    el.onclick = function (e) {
      try {
        const a = e.target.closest('a');
        if (a) return;

        const btn = e.target.classList.contains('open-media') ? e.target : e.target.closest('.open-media');
        if (btn) {
          e.preventDefault();
          const url = btn.dataset.url;
          const type = btn.dataset.type || 'auto';
          if (url) { showMediaViewer(url, type); }
          return;
        }

        const link = e.target.classList.contains('media-link') ? e.target : e.target.closest('.media-link');
        if (link) {
          e.preventDefault();
          const url = link.dataset.url;
          const type = link.dataset.type || 'auto';
          if (url) { showMediaViewer(url, type); }
          return;
        }
      } catch (err) { }
      e.stopPropagation();
      const targetId = pickETagEventId(ev) || ev.id;
      showEventModal(findEventById(state, targetId) || ev, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
    };
  });

  const repostContentEls = div.querySelectorAll('.reply-to.repost .reply-to-content');
  repostContentEls.forEach(el => {
    if (el.dataset.repostListenerInstalled) return;
    el.onclick = function (e) {
      try {
        if (e.target.closest('.open-media')) {
          e.preventDefault();
          const btn = e.target.closest('.open-media');
          const url = btn && btn.dataset.url;
          const type = btn && (btn.dataset.type || 'auto');
          if (url) { showMediaViewer(url, type); }
          return;
        }
        if (e.target.closest('.media-link')) {
          e.preventDefault();
          const link = e.target.closest('.media-link');
          const url = link && link.dataset.url;
          const type = link && (link.dataset.type || 'auto');
          if (url) { showMediaViewer(url, type); }
          return;
        }
        if (e.target.closest('a')) return;
      } catch (err) { }
      e.stopPropagation();
      const targetId = pickETagEventId(ev) || ev.id;
      showEventModal(findEventById(state, targetId) || ev, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
    };
    el.dataset.repostListenerInstalled = '1';
  });

  const quoteContentEls = div.querySelectorAll('.event-quote-content');
  quoteContentEls.forEach(el => {
    el.onclick = function (e) {
      try {
        const a = e.target.closest('a');
        if (a) return;
        const btn = e.target.classList.contains('open-media') ? e.target : e.target.closest('.open-media');
        if (btn) {
          e.preventDefault();
          const url = btn.dataset.url;
          const type = btn.dataset.type || 'auto';
          if (url) { showMediaViewer(url, type); }
          return;
        }
        const link = e.target.classList.contains('media-link') ? e.target : e.target.closest('.media-link');
        if (link) {
          e.preventDefault();
          const url = link.dataset.url;
          const type = link.dataset.type || 'auto';
          if (url) { showMediaViewer(url, type); }
          return;
        }
      } catch (err) { }
      e.stopPropagation();
      let eventId = null;
      let parent = el.closest('.event-quote');
      if (parent) {
        eventId = parent.querySelector('.nostr-quote')?.dataset?.eventId;
      }
      if (!eventId && parent && parent.dataset.eventId) {
        eventId = parent.dataset.eventId;
      }
      let event = eventId ? findEventById(state, eventId) : null;
      showEventModal(event || ev, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
    };
  });
}

function bindOmochatHandlers(div, ev, state, nip19) {
  const hBtn = div.querySelector('.btn-omochat-h');
  const tBtn = div.querySelector('.btn-omochat-t');
  if (hBtn) {
    hBtn.onclick = async (e) => {
      e.stopPropagation();
      const myPub = localStorage.getItem('pubkey');
      let myName = 'Guest';
      if (myPub) {
        const p = state.profiles ? state.profiles.get(myPub) : null;
        if (p) myName = p.display_name || p.name || 'Guest';
      }
      const targetHash = (ev.pubkey && ev.pubkey.length >= 4) ? '#' + ev.pubkey.slice(-4) : '';
      let targetName = targetHash || 'Guest';
      if (ev.tags) {
        const n = ev.tags.find(t => t[0] === 'n');
        const nName = (n && n[1]) ? String(n[1]).trim() : '';
        if (nName) targetName = nName;
      }
      await apiReplyToEvent(state, ev, `* 🫂 ${myName} hugs ${targetName}${targetHash} *`);
    };
  }
  if (tBtn) {
    tBtn.onclick = async (e) => {
      e.stopPropagation();
      const myPub = localStorage.getItem('pubkey');
      let myName = 'Guest';
      if (myPub) {
        const p = state.profiles ? state.profiles.get(myPub) : null;
        if (p) myName = p.display_name || p.name || 'Guest';
      }
      const targetHash = (ev.pubkey && ev.pubkey.length >= 4) ? '#' + ev.pubkey.slice(-4) : '';
      let targetName = targetHash || 'Guest';
      if (ev.tags) {
        const n = ev.tags.find(t => t[0] === 'n');
        const nName = (n && n[1]) ? String(n[1]).trim() : '';
        if (nName) targetName = nName;
      }
      await apiReplyToEvent(state, ev, `* 🐟 ${myName} slaps ${targetName}${targetHash} around a bit with a large trout *`);
    };
  }
  const replyBtn = div.querySelector('.btn-reply');
  if (replyBtn) {
    replyBtn.title = t('reply');
    replyBtn.onclick = (e) => {
      e.stopPropagation();
      setReplyTarget(state, ev, nip19);

      const targetHash = (ev.pubkey && ev.pubkey.length >= 4) ? '#' + ev.pubkey.slice(-4) : '';
      let targetName = '';
      if (ev.tags) {
        const n = ev.tags.find(t => t[0] === 'n');
        const nName = (n && n[1]) ? String(n[1]).trim() : '';
        if (nName) {
          targetName = nName;
        }
      }
      const composer = document.getElementById('composer');
      if (composer) composer.hidden = false;

      const noteInput = document.getElementById('noteInput');
      if (noteInput) {
        noteInput.value = `@${targetName}${targetHash} `;
        noteInput.focus();
        noteInput.selectionStart = noteInput.selectionEnd = noteInput.value.length;
      }
    };
  }
}

function bindEventListeners(div, ev, state, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent) {
  bindProfileClickHandlers(div, ev, state, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent);
  bindJsonButtonHandlers(div, ev, nip19);
  bindQuoteButtonHandler(div, ev, state, nip19);
  bindContentClickHandlers(div, ev, state, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent);

  if (!localStorage.getItem('pubkey')) return;

  setupReactButton(div, ev, settings, settingsManager, reactToEvent);
  setupRepostButton(div, ev, repostEvent);
  setupReplyButton(div, ev, replyToEvent);

  if (ev.kind === 20000) {
    bindOmochatHandlers(div, ev, state, nip19);
  }
}

export function renderEvent(state, ev, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent, feedId = null) {
  const div = buildEventContainer(ev);

  const timelineUiState = settings && settings.__timelineUiState ? settings.__timelineUiState : null;
  const markMutedExpanded = settings && typeof settings.__timelineMarkMutedExpanded === 'function' ? settings.__timelineMarkMutedExpanded : null;
  const markCwExpanded = settings && typeof settings.__timelineMarkCwExpanded === 'function' ? settings.__timelineMarkCwExpanded : null;
  const isMutedExpanded = !!(timelineUiState && timelineUiState.expandedMutedEventIds && timelineUiState.expandedMutedEventIds.has && timelineUiState.expandedMutedEventIds.has(ev.id));
  const isCwExpanded = !!(timelineUiState && timelineUiState.expandedCwEventIds && timelineUiState.expandedCwEventIds.has && timelineUiState.expandedCwEventIds.has(ev.id));
  const content = ev.content || '';
  const pk = ev.pubkey;
  const muteState = evaluateMuteState(state, pk, content);
  const allowInlineMedia = (settings && settings.showTimelineMedia === true) && !muteState.isMuted;

  const replyToHtml = renderReplyContext(state, ev, nip19, { ...(settings || {}), settingsManager, isModal: false, showTimelineMedia: allowInlineMedia });
  const channelContextHtml = ev.kind === 42 ? renderChannelContext(state, ev) : '';

  let names;
  if (ev.kind === 20000) {
    if (settings && settings.omochatSubordinate) {
       const userGeohash = settings.omochatGeohash || 'xn';
       const gTag = ev.tags && ev.tags.find(t => t[0] === 'g');
       const evGeohash = gTag ? gTag[1] : '';
       if (evGeohash && evGeohash !== userGeohash && evGeohash.startsWith(userGeohash)) {
          div.style.opacity = '0.6';
       }
    }
    const hash = (pk && pk.length >= 4) ? '#' + pk.slice(-4) : '';
    const nTag = ev.tags && ev.tags.find(t => t[0] === 'n');
    const nName = (nTag && nTag[1]) ? String(nTag[1]).trim() : '';
    if (nName) {
      names = { main: nName, sub: hash };
    } else {
      names = { main: hash, sub: '' };
    }
  } else {
    names = displayNameWithUsername(state, pk, nip19, { noTruncate: true });
  }

  let statusHtml = '<span class="user-status event-name-status" data-pubkey="' + pk + '" style="display:none;"></span>';
  const showMusic = !settings || settings.showMusicStatus !== false;

  if (showMusic && state.userStatuses) {
    const us = state.userStatuses.get(pk);
    if (us && us.content) {
      statusHtml = '<span class="user-status event-name-status" data-pubkey="' + pk + '" title="' + escapeHtml(us.content) + '">♫ ' + escapeHtml(us.content) + '</span>';
    }
  }

  const nameBlockHtml = buildEventNameBlockHtml(state, ev, settings, names, statusHtml);

  const topRowHtml = '<div class="event-top-row">' +
    nameBlockHtml +
    (localStorage.getItem('pubkey') && ev.kind !== 20000 ?
      '<div class="event-actions-react">' +
      '<button class="btn-react" type="button" data-i18n-title="reaction.button.title"><img src="icon/star.png" alt="" class="icon-btn" data-i18n-alt="reaction.button.title"></button>' +
      '</div>' : '') +
    '</div>';

  const formatTimeForEvent = (eventObj) => {
    try {
      const base = fmtTime(eventObj.created_at);
      if ((!settings || settings.showReceivedDelta !== false) && eventObj && eventObj.__receivedAt) {
        const diffMs = (eventObj.created_at * 1000) - eventObj.__receivedAt;
        const absMs = Math.abs(diffMs);
        let delta = '';
        if (absMs < 1000) {
          delta = t('now');
        } else {
          const s = Math.round(absMs / 1000);
          if (s < 60) delta = (diffMs >= 0 ? '+' : '-') + s + 's';
          else {
            const m = Math.round(s / 60);
            delta = (diffMs >= 0 ? '+' : '-') + m + 'm';
          }
        }
        return base + ' [' + delta + ']';
      }
      return base;
    } catch (e) {
      return fmtTime(eventObj.created_at);
    }
  };

  let omochatButtons = '';
  if (ev.kind === 20000 && localStorage.getItem('pubkey')) {
    omochatButtons = '<button class="btn-omochat-h" type="button" title="( ⊃·ω·)⊃🫂">🫂</button>' +
                     '<button class="btn-omochat-t" type="button" title="( \'ω\' )в 🐟">🐟</button>';
  }

  const bottomRowHtml = '<div class="event-bottom-row">' +
    '<div class="event-time-kind">' +
    '<span class="time">' + formatTimeForEvent(ev) + '</span>' +
    '<button class="btn-json btn-kind" type="button" data-kind="' + ev.kind + '" data-i18n-title="showJson"> k:' + ev.kind + '</button>' +
    '</div>' +
    (localStorage.getItem('pubkey') ?
      '<div class="event-actions-bottom">' +
      omochatButtons +
      (ev.kind !== 20000 ? '<button class="btn-quote" type="button" data-i18n-title="quote"><img src="icon/note.png" alt="" class="icon-btn" data-i18n-alt="quote"></button>' : '') +
      (ev.kind !== 20000 ? '<button class="btn-repost" type="button" data-i18n-title="repost"><img src="icon/repost.png" alt="" class="icon-btn" data-i18n-alt="repost"></button>' : '') +
      (ev.kind === 1 || ev.kind === 20000 ? '<button class="btn-reply" type="button" data-i18n-title="reply"><img src="icon/reply.png" alt="" class="icon-btn" data-i18n-alt="reply"></button>' : '') +
      '</div>' : '') +
    '</div>';

  div.innerHTML = topRowHtml + channelContextHtml + replyToHtml + '<div class="content"></div>' + bottomRowHtml;

  const contentEl = div.querySelector('.content');
  renderEventContent(state, ev, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent, contentEl, allowInlineMedia);

  try {
    const replyBlock = div.querySelector('.reply-to');
    if (replyBlock) {
      try { updateNostrNpubLinks(replyBlock); } catch (e) { }
      try {
        updateNostrNoteLinks(
          replyBlock,
          showEventModal,
          state,
          nip19,
          reactToEvent,
          replyToEvent,
          repostEvent,
          settings,
          settingsManager
        );
      } catch (e) { }
      if (ev.kind === 7) {
        try { processHiddenTagChars(replyBlock); } catch (e) { }
      }
    }
  } catch (e) { }

  try { if (typeof fitCustomEmoji === 'function') fitCustomEmoji(div, 28); } catch (e) { }

  setupContentWarning(div, ev, contentEl, isCwExpanded, markCwExpanded);

  const isHidden = setupMuteCollapse(div, ev, contentEl, muteState, isMutedExpanded, markMutedExpanded);
  if (isHidden) return div;

  bindEventListeners(div, ev, state, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent);

  try {
    const showClientName = !settings || settings.showClientName !== false;
    if (showClientName) {
      const clientTag = (ev.tags || []).find(t => t && t[0] === 'client' && t[1]);
      if (clientTag) {
        const clientName = clientTag[1];
        const kindBtnEl = div.querySelector('.btn-kind');
        if (kindBtnEl && kindBtnEl.parentNode) {
          const span = document.createElement('span');
          span.className = 'client-badge';
          span.setAttribute('data-client', clientName);
          kindBtnEl.parentNode.insertBefore(span, kindBtnEl.nextSibling);
        }
      }
    }
  } catch (e) { }

  try {
    const clientBadges = div.querySelectorAll('.client-badge[data-client]');
    if (clientBadges && clientBadges.length > 0) {
      applyClientBadgeToContainer(div);
    } else {
      const kindBtn = div.querySelector('.btn-kind');
      if (kindBtn) {
        kindBtn.style.marginRight = '4px';
      }
    }
  } catch (e) { }

  try {
    try {
      const btnJson = div.querySelector('.btn-json'); if (btnJson) { try { btnJson.title = t('showJson'); const img = btnJson.querySelector && btnJson.querySelector('img'); if (img) img.alt = t('showJson'); } catch (e) { } }
      const repostBtn = div.querySelector('.btn-repost'); if (repostBtn) { try { repostBtn.title = t('repost'); const img = repostBtn.querySelector && repostBtn.querySelector('img'); if (img) img.alt = t('repost'); } catch (e) { } }
      const quoteBtn = div.querySelector('.btn-quote'); if (quoteBtn) { try { quoteBtn.title = t('quote.icon_alt'); const img = quoteBtn.querySelector && quoteBtn.querySelector('img'); if (img) img.alt = t('quote.icon_alt'); } catch (e) { } }
      const replyBtn = div.querySelector('.btn-reply'); if (replyBtn) { try { replyBtn.title = t('reply'); const img = replyBtn.querySelector && replyBtn.querySelector('img'); if (img) img.alt = t('reply'); } catch (e) { } }
      const reactBtn = div.querySelector('.btn-react'); if (reactBtn) { try { const stored = reactBtn.dataset && reactBtn.dataset.reactionDisplay ? reactBtn.dataset.reactionDisplay : null; if (stored) reactBtn.title = t('reaction.button.title_with_default', { display: stored }); else reactBtn.title = t('reaction.button.title'); const img = reactBtn.querySelector && reactBtn.querySelector('img'); if (img) img.alt = t('reaction.button.title'); } catch (e) { } }
    } catch (e) { }
  } catch (e) { }

  if (ev.kind === 42) {
    const channelRootId = pickChannelRootId(ev);
    if (channelRootId) scheduleChannelLabelUpdate(state, channelRootId, div);
  }

  return div;
}

try {
  if (typeof window !== 'undefined') {
    window.addEventListener('i18n:updated', () => {
      try {
        document.querySelectorAll('.btn-kind').forEach(btn => {
          try {
            const kind = btn.dataset && btn.dataset.kind ? btn.dataset.kind : (btn.textContent || '').split(':').pop().trim();
            btn.textContent = t('kind') + ':' + kind;
            try { btn.setAttribute('title', t('showJson')); } catch (e) { }
          } catch (e) { }
        });

        document.querySelectorAll('.btn-react').forEach(btn => {
          try {
            const stored = btn.dataset && btn.dataset.reactionDisplay ? btn.dataset.reactionDisplay : null;
            if (stored) {
              btn.title = t('reaction.button.title_with_default', { display: stored });
            } else {
              btn.title = t('reaction.button.title');
            }
            const img = btn.querySelector && btn.querySelector('img');
            if (img) img.alt = t('reaction.button.title');
          } catch (e) { }
        });

        document.querySelectorAll('.btn-repost').forEach(b => { try { b.title = t('repost'); const img = b.querySelector && b.querySelector('img'); if (img) img.alt = t('repost'); } catch (e) { } });
        document.querySelectorAll('.btn-reply').forEach(b => { try { b.title = t('reply'); const img = b.querySelector && b.querySelector('img'); if (img) img.alt = t('reply'); } catch (e) { } });

        document.querySelectorAll('.muted-fold-bar button').forEach(b => { try { b.textContent = t('fold.show'); } catch (e) { } });

        document.querySelectorAll('.reply-to-author').forEach(el => {
          try {
            const nameEl = el.querySelector('.reply-author-name');
            const name = nameEl ? nameEl.textContent : el.textContent || '';
            const parent = el.closest('.reply-to');
            if (parent && parent.classList.contains('repost')) {
              el.innerHTML = '<span class="reply-author-name">' + replaceBadgeEmoji(escapeHtml(name)) + '</span> ' + '<span>' + t('repost') + '</span>';
            } else if (parent && parent.querySelector('.reply-marker') && parent.querySelector('.reply-marker').innerText.trim()) {
              el.innerHTML = '<span class="reply-author-name">' + replaceBadgeEmoji(escapeHtml(name)) + '</span> ' + '<span>' + t('reaction.button.title') + '</span>';
            } else {
              el.innerHTML = '<span class="reply-author-name">' + replaceBadgeEmoji(escapeHtml(name)) + '</span> ' + '<span>' + t('reply') + '</span>';
            }
          } catch (e) { }
        });

        try { if (typeof applyTranslations === 'function') applyTranslations(document, true); } catch (e) { }
      } catch (e) { }
    });
  }
} catch (e) { }
