import { escapeHtml, getReactionContent, getReactionEmojiTags } from '../../utils/utils.js';
import { findEventById } from '../../core/state.js';
import { displayName } from '../../features/profile/profile.js';
import { t } from '../../utils/i18n.js';
import { MAX_PREVIEW_LENGTH } from '../../config/constants.js';

// clients.json のマッピングをキャッシュ読み込み
export let __clientsMap = null;
export let __clientsMapPromise = null;

export async function loadClientsMap() {
  if (__clientsMap) return __clientsMap;
  if (__clientsMapPromise) return __clientsMapPromise;
  __clientsMapPromise = fetch('clients.json')
    .then(r => r.ok ? r.json() : [])
    .then(list => {
      const m = new Map();
      if (Array.isArray(list)) {
        for (const it of list) {
          try {
            if (it && it.Name) m.set(it.Name, it.ColorCode || null);
          } catch (e) { }
        }
      }
      __clientsMap = m;
      return m;
    }).catch(e => {
      __clientsMap = new Map();
      return __clientsMap;
    });
  return __clientsMapPromise;
}

export function pickETagEventId(ev) {
  if (!ev || !Array.isArray(ev.tags)) return null;
  const eTags = (ev.tags || []).filter(t => t && (t[0] === 'e' || t[0] === 'E') && t[1]);
  if (!eTags || eTags.length === 0) return null;

  if (ev.kind === 7) {
    return eTags[eTags.length - 1][1];
  }

  for (const t of eTags) {
    try {
      if ((t[3] || '').toString().toLowerCase() === 'reply') return t[1];
    } catch (e) { }
  }

  let rootId = null;
  const unmarked = [];
  for (const t of eTags) {
    try {
      const marker = (t[3] || '').toString().toLowerCase();
      if (marker === 'root' || t[0] === 'E') rootId = t[1];
      if (!marker && t[0] === 'e') unmarked.push(t[1]);
    } catch (e) { }
  }

  if (rootId && unmarked.length > 0) return unmarked[unmarked.length - 1];
  if (rootId) return rootId;
  return eTags[eTags.length - 1][1];
}

export function pickETagWithHint(ev) {
  if (!ev || !Array.isArray(ev.tags)) return { eventId: null, relayHint: '' };
  const eTags = (ev.tags || []).filter(t => t && (t[0] === 'e' || t[0] === 'E') && t[1]);
  if (!eTags || eTags.length === 0) return { eventId: null, relayHint: '' };

  if (ev.kind === 7) {
    const tag = eTags[eTags.length - 1];
    return { eventId: tag[1], relayHint: tag[2] || '' };
  }

  for (const t of eTags) {
    try {
      if ((t[3] || '').toString().toLowerCase() === 'reply') return { eventId: t[1], relayHint: t[2] || '' };
    } catch (e) { }
  }

  let rootTag = null;
  const unmarked = [];
  for (const t of eTags) {
    try {
      const marker = (t[3] || '').toString().toLowerCase();
      if (marker === 'root' || t[0] === 'E') rootTag = t;
      if (!marker && t[0] === 'e') unmarked.push(t);
    } catch (e) { }
  }

  if (rootTag && unmarked.length > 0) {
    const tag = unmarked[unmarked.length - 1];
    return { eventId: tag[1], relayHint: tag[2] || '' };
  }
  if (rootTag) return { eventId: rootTag[1], relayHint: rootTag[2] || '' };
  const tag = eTags[eTags.length - 1];
  return { eventId: tag[1], relayHint: tag[2] || '' };
}

export function pickLastETagEventId(ev) {
  if (!ev || !Array.isArray(ev.tags)) return null;
  const eTags = (ev.tags || []).filter(t => t && (t[0] === 'e' || t[0] === 'E') && t[1]);
  if (!eTags || eTags.length === 0) return null;
  return eTags[eTags.length - 1][1];
}

export function applyMutedToneToEvent(div) {
  try {
    if (!div) return;
    if (div.classList && div.classList.contains('muted-event-dim')) return;
    div.classList.add('muted-event-dim');
  } catch (e) { }
}

export function updateEventMuteDom(eventEl, state, settings = null) {
  try {
    if (!eventEl) return;
    let pubkey = eventEl.dataset.pubkey;
    if (!pubkey) {
      const nameEl = eventEl.querySelector('.name[data-pubkey]');
      if (nameEl) pubkey = nameEl.dataset.pubkey;
    }
    if (!pubkey) return;

    const eventId = eventEl.dataset.eventId;
    let ev = null;
    if (eventId && state) {
      ev = findEventById(state, eventId);
    }

    const contentEl = eventEl.querySelector('.content:not(.muted-fold-bar *)');
    const content = contentEl ? contentEl.textContent || '' : '';
    const muteState = evaluateMuteState(state, pubkey, content, settings, ev);

    const existingFold = eventEl.querySelector('.muted-fold-bar');

    if (!muteState.isMuted) {
      if (existingFold) existingFold.remove();
      eventEl.classList.remove('muted-event', 'muted-event-soft', 'muted-event-dim', 'muted-hidden', 'd-none');
      delete eventEl.dataset.muteCollapsible;

      if (contentEl) contentEl.classList.remove('d-none');
      const actionReact = eventEl.querySelector('.event-actions-react:not(.muted-fold-bar *)'); if (actionReact) actionReact.classList.remove('d-none');
      const actionBottom = eventEl.querySelector('.event-actions-bottom:not(.muted-fold-bar *)'); if (actionBottom) actionBottom.classList.remove('d-none');
      const topRowEl = eventEl.querySelector('.event-top-row:not(.muted-fold-bar *)'); if (topRowEl) topRowEl.classList.remove('d-none');
      const replyToEls = eventEl.querySelectorAll('.reply-to:not(.muted-fold-bar *)'); replyToEls.forEach(el => el.classList.remove('d-none'));
      const chanEls = eventEl.querySelectorAll('.event-channel-context:not(.muted-fold-bar *), .channel-context:not(.muted-fold-bar *)'); chanEls.forEach(el => el.classList.remove('d-none'));
      const bottomRowEl = eventEl.querySelector('.event-bottom-row:not(.muted-fold-bar *)'); if (bottomRowEl) bottomRowEl.classList.remove('d-none');
      const cwBar = eventEl.querySelector('.cw-fold-bar:not(.muted-fold-bar *)'); if (cwBar) cwBar.classList.remove('d-none');
      return;
    }

    if (muteState.isMuted && !muteState.muteApply) {
      if (existingFold) existingFold.remove();
      eventEl.classList.remove('muted-event', 'muted-hidden', 'd-none');
      eventEl.classList.add('muted-event-soft');
      applyMutedToneToEvent(eventEl);
      return;
    }

    if (muteState.isMuted && muteState.muteApply) {
      applyMutedToneToEvent(eventEl);
      if (muteState.muteDisplayMode === 'hide') {
        if (existingFold) existingFold.remove();
        eventEl.classList.add('muted-event', 'muted-hidden', 'd-none');
      } else {
        eventEl.dataset.muteCollapsible = '1';
        eventEl.classList.add('muted-event');
        if (contentEl) contentEl.classList.add('d-none');
        const actionReact = eventEl.querySelector('.event-actions-react:not(.muted-fold-bar *)'); if (actionReact) actionReact.classList.add('d-none');
        const actionBottom = eventEl.querySelector('.event-actions-bottom:not(.muted-fold-bar *)'); if (actionBottom) actionBottom.classList.add('d-none');
        const topRowEl = eventEl.querySelector('.event-top-row:not(.muted-fold-bar *)'); if (topRowEl) topRowEl.classList.add('d-none');
        const replyToEls = eventEl.querySelectorAll('.reply-to:not(.muted-fold-bar *)'); replyToEls.forEach(el => el.classList.add('d-none'));
        const chanEls = eventEl.querySelectorAll('.event-channel-context:not(.muted-fold-bar *), .channel-context:not(.muted-fold-bar *)'); chanEls.forEach(el => el.classList.add('d-none'));
        const bottomRowEl = eventEl.querySelector('.event-bottom-row:not(.muted-fold-bar *)'); if (bottomRowEl) bottomRowEl.classList.add('d-none');
        const cwBar = eventEl.querySelector('.cw-fold-bar:not(.muted-fold-bar *)'); if (cwBar) cwBar.classList.add('d-none');

        if (!existingFold) {
          const foldBar = createFoldBar(eventEl, muteState);
          if (foldBar) {
            eventEl.insertBefore(foldBar, eventEl.firstChild);
          }
        }
      }
    }
  } catch (e) {
    if (window.__nokakoiDebug) console.warn('[Renderer] updateEventMuteDom に失敗', e);
  }
}

export function createFoldBar(eventEl, muteState) {
  try {
    const foldBar = document.createElement('div');
    foldBar.className = 'muted-fold-bar muted-small';

    const left = document.createElement('div');
    left.className = 'muted-fold-bar-left';

    const muteLabel = document.createElement('span');
    muteLabel.className = 'mute-event-label';
    const mutedType = muteState.mutedType;
    if (mutedType === 'user') muteLabel.textContent = t('muted.user');
    else if (mutedType === 'word') muteLabel.textContent = t('muted.word');
    else muteLabel.textContent = t('muted.generic');

    const labelAndBtnWrap = document.createElement('div');
    labelAndBtnWrap.className = 'mute-label-wrap';
    labelAndBtnWrap.appendChild(muteLabel);
    left.appendChild(labelAndBtnWrap);

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'muted-fold-expand-btn';
    expandBtn.textContent = t('fold.show');

    labelAndBtnWrap.appendChild(expandBtn);
    foldBar.appendChild(left);

    expandBtn.onclick = function (e) {
      try {
        const contentEl = eventEl.querySelector('.content');
        const cwBar = eventEl.querySelector('.cw-fold-bar');

        if (cwBar) cwBar.classList.remove('d-none');
        else if (contentEl) contentEl.classList.remove('d-none');

        const actionReact = eventEl.querySelector('.event-actions-react'); if (actionReact) actionReact.classList.remove('d-none');
        const actionBottom = eventEl.querySelector('.event-actions-bottom'); if (actionBottom) actionBottom.classList.remove('d-none');
        const topRowEl = eventEl.querySelector('.event-top-row'); if (topRowEl) topRowEl.classList.remove('d-none');
        const replyToEls = eventEl.querySelectorAll('.reply-to'); replyToEls.forEach(el => el.classList.remove('d-none'));
        const chanEls = eventEl.querySelectorAll('.event-channel-context, .channel-context'); chanEls.forEach(el => el.classList.remove('d-none'));
        const bottomRowEl = eventEl.querySelector('.event-bottom-row'); if (bottomRowEl) bottomRowEl.classList.remove('d-none');
        foldBar.remove();
      } catch (err) { }
    };

    return foldBar;
  } catch (e) {
    return null;
  }
}

export function refreshEventsMuteState(state = null, targetPubkey = null) {
  try {
    const selector = targetPubkey
      ? `.event[data-pubkey="${targetPubkey}"], .event .name[data-pubkey="${targetPubkey}"]`
      : '.event';
    const nodes = document.querySelectorAll(selector);
    const updatedEvents = new Set();
    nodes.forEach(el => {
      const eventEl = el.classList.contains('event') ? el : el.closest('.event');
      if (eventEl && !updatedEvents.has(eventEl)) {
        updatedEvents.add(eventEl);
        updateEventMuteDom(eventEl, state);
      }
    });
  } catch (e) { }
}

export function evaluateMuteState(state, pk, content, settings = null, ev = null) {
  const ignoreMuteApply = !!(settings && (settings.ignoreMuteApply === true || settings.disableMuteApply === true));
  const rawMuteApply = (localStorage.getItem('mute_apply') || '1') === '1';
  const result = {
    isMuted: false,
    mutedType: null,
    matchedWord: null,
    muteApply: ignoreMuteApply ? false : rawMuteApply,
    muteDisplayMode: localStorage.getItem('mute_display_mode') || 'collapse'
  };

  try {
    const muteList = (window.__nokakoiMuteList)
      ? window.__nokakoiMuteList
      : (localStorage.getItem('muteList_expanded') ? JSON.parse(localStorage.getItem('muteList_expanded')) : null);
    if (!muteList) return result;

    const pubkeysPublic = (muteList.pubkeys && Array.isArray(muteList.pubkeys.public)) ? muteList.pubkeys.public : [];
    const pubkeysPrivate = (muteList.pubkeys && Array.isArray(muteList.pubkeys.private)) ? muteList.pubkeys.private : [];
    const allMutedPubkeys = pubkeysPublic.concat(pubkeysPrivate || []);

    const targetPubkeys = [pk];
    // 純粋なリポスト (kind 6 / 16) の場合のみ元投稿者 (pタグ) もミュート判定に含める
    if (ev && (ev.kind === 6 || ev.kind === 16) && Array.isArray(ev.tags)) {
      const pTags = ev.tags.filter(t => t && t[0] === 'p' && t[1]).map(t => t[1]);
      targetPubkeys.push(...pTags);
    }

    for (const targetPk of targetPubkeys) {
      if (targetPk && allMutedPubkeys.includes(targetPk)) {
        result.isMuted = true;
        result.mutedType = 'user';
        return result;
      }
    }

    if (muteList.words) {
      const wordsPublic = (muteList.words.public && Array.isArray(muteList.words.public)) ? muteList.words.public : [];
      const wordsPrivate = (muteList.words.private && Array.isArray(muteList.words.private)) ? muteList.words.private : [];
      const allWords = wordsPublic.concat(wordsPrivate || []);
      const txt = (content || '').toLowerCase();

      const applyKind0 = (localStorage.getItem('mute_apply_kind0') || '0') === '1';
      let profileText = '';
      try {
        if (applyKind0 && state && state.profiles && state.profiles.get) {
          const textParts = [];
          for (const targetPk of targetPubkeys) {
            if (!targetPk) continue;
            const prof = state.profiles.get(targetPk) || {};
            if (prof.display_name) textParts.push(prof.display_name);
            if (prof.name && prof.name !== prof.display_name) textParts.push(prof.name);
            if (prof.about) textParts.push(prof.about);
            if (prof.nip05) textParts.push(prof.nip05);
            if (prof.lud16) textParts.push(prof.lud16);
            if (prof.lud06) textParts.push(prof.lud06);
            if (prof.website) textParts.push(prof.website);
          }
          profileText = textParts.join(' ').toLowerCase();
        }
      } catch (e) { profileText = ''; }

      const combinedText = (txt + ' ' + profileText).toLowerCase();
      for (const w of allWords) {
        if (!w) continue;
        try {
          const lw = String(w).toLowerCase();
          if (combinedText.indexOf(lw) !== -1) {
            result.isMuted = true;
            result.mutedType = 'word';
            result.matchedWord = w;
            break;
          }
        } catch (e) { }
      }
    }
  } catch (e) {
    if (window.__nokakoiDebug) console.warn('[Renderer] ミュート判定に失敗', e);
  }

  return result;
}

export function resolvePreviewMaxLength(settings) {
  const sm = (settings && settings.settingsManager) ||
    (typeof window !== 'undefined' && window.settingsManager) ||
    null;
  if (sm && typeof sm.get === 'function') {
    const v = sm.get('previewMaxLength');
    if (v && !isNaN(v)) return parseInt(v, 10);
  }
  return MAX_PREVIEW_LENGTH;
}

export function formatReactionForTitle(reaction) {
  const reactionContent = getReactionContent(reaction);
  if (reactionContent === ':nokakoi:') {
    return '🖼️nokakoi';
  } else {
    return reactionContent;
  }
}

export async function invokeShowProfileModalProxy(pubkey) {
  try {
    if (typeof window !== 'undefined' && typeof window.showProfileModalProxy === 'function') {
      window.showProfileModalProxy(pubkey);
      return;
    }
    const mod = await import('../../main.js');
    if (mod && typeof mod.showProfileModalProxy === 'function') {
      mod.showProfileModalProxy(pubkey);
      return;
    }
  } catch (e) {
    if (window.__nokakoiDebug) console.warn('[Profile] invokeShowProfileModalProxy に失敗しました:', e);
  }
}

export let __reactionDefaultListenerInstalled = false;
export function installReactionDefaultListener(settingsManager) {
  if (__reactionDefaultListenerInstalled) return;
  try {
    window.addEventListener('reactionDefaultChanged', () => {
      try {
        const newDefault = (settingsManager && typeof settingsManager.get === 'function') ? (settingsManager.get('reactionDefault') || '+') : '+';
        const display = formatReactionForTitle(newDefault);
        document.querySelectorAll('.btn-react').forEach(btn => {
          try { btn.title = t('reaction.button.title_with_default', { display: display }); } catch (e) {}
        });
      } catch (e) {}
    });
    __reactionDefaultListenerInstalled = true;
  } catch (e) {}
}
