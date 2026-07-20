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
  const eTags = (ev.tags || []).filter(t => t && t[0] === 'e' && t[1]);
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
      if (marker === 'root') rootId = t[1];
      if (!marker) unmarked.push(t[1]);
    } catch (e) { }
  }

  if (rootId && unmarked.length > 0) return unmarked[unmarked.length - 1];
  if (rootId) return rootId;
  return eTags[eTags.length - 1][1];
}

export function pickLastETagEventId(ev) {
  if (!ev || !Array.isArray(ev.tags)) return null;
  const eTags = (ev.tags || []).filter(t => t && t[0] === 'e' && t[1]);
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

export function evaluateMuteState(state, pk, content) {
  const result = {
    isMuted: false,
    mutedType: null,
    matchedWord: null,
    muteApply: (localStorage.getItem('mute_apply') || '1') === '1',
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
    if (allMutedPubkeys.includes(pk)) {
      result.isMuted = true;
      result.mutedType = 'user';
      return result;
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
          const prof = state.profiles.get(pk) || {};
          const nameParts = [];
          if (prof.display_name) nameParts.push(prof.display_name);
          if (prof.name && prof.name !== prof.display_name) nameParts.push(prof.name);
          const namesCombined = nameParts.join(' ');
          profileText = (namesCombined + ' ' + (prof.about || '')).toLowerCase();
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
    if (window.__nokakoiDebug) console.warn('invokeShowProfileModalProxy failed', e);
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
