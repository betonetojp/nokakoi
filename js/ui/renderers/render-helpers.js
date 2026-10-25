import { getReactionContent } from '../../utils/utils.js';
import { findEventById } from '../../core/state.js';
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
    }).catch(() => {
      __clientsMap = new Map();
      return __clientsMap;
    });
  return __clientsMapPromise;
}

const KNOWN_E_MARKERS = new Set(['root', 'reply', 'mention']);
const HEX64_RE = /^[0-9a-f]{64}$/i;

function normalizeMarker(val) {
  if (typeof val !== 'string') return '';
  const lower = val.trim().toLowerCase();
  return KNOWN_E_MARKERS.has(lower) ? lower : '';
}

function normalizeHexPubkey(val) {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  return HEX64_RE.test(trimmed) ? trimmed : '';
}

export function parseETagEntry(tag) {
  if (!Array.isArray(tag) || (tag[0] !== 'e' && tag[0] !== 'E') || !tag[1]) {
    return null;
  }
  const tagName = tag[0];
  const eventId = String(tag[1]);
  const raw2 = tag[2] != null ? String(tag[2]).trim() : '';
  const raw3 = tag[3] != null ? String(tag[3]).trim() : '';
  const raw4 = tag[4] != null ? String(tag[4]).trim() : '';

  const marker = tagName === 'E'
    ? (normalizeMarker(raw3) || normalizeMarker(raw4) || normalizeMarker(raw2) || 'root')
    : (normalizeMarker(raw3) || normalizeMarker(raw4) || normalizeMarker(raw2));

  const relayHint = (raw2 && !normalizeMarker(raw2) && !normalizeHexPubkey(raw2))
    ? raw2
    : '';

  const pubkey = normalizeHexPubkey(raw4) || normalizeHexPubkey(raw3) || normalizeHexPubkey(raw2);

  return { tagName, eventId, relayHint, marker, pubkey };
}

export function pickETagWithHint(ev) {
  if (!ev || !Array.isArray(ev.tags)) return { eventId: null, relayHint: '', pubkey: '' };
  const parsed = ev.tags.map(parseETagEntry).filter(Boolean);
  if (parsed.length === 0) return { eventId: null, relayHint: '', pubkey: '' };

  if (ev.kind === 7 || ev.kind === 9735) {
    const replyMarked = parsed.filter(t => t.marker === 'reply').pop();
    if (replyMarked) {
      return { eventId: replyMarked.eventId, relayHint: replyMarked.relayHint, pubkey: replyMarked.pubkey };
    }
    const nonRootMention = parsed.filter(t => t.tagName === 'e' && t.marker !== 'root' && t.marker !== 'mention').pop();
    if (nonRootMention) {
      return { eventId: nonRootMention.eventId, relayHint: nonRootMention.relayHint, pubkey: nonRootMention.pubkey };
    }
    const last = parsed[parsed.length - 1];
    return { eventId: last.eventId, relayHint: last.relayHint, pubkey: last.pubkey };
  }

  if (ev.kind === 1111) {
    const lowerETags = parsed.filter(t => t.tagName === 'e');
    const replyMarked = lowerETags.filter(t => t.marker === 'reply').pop();
    if (replyMarked) {
      return { eventId: replyMarked.eventId, relayHint: replyMarked.relayHint, pubkey: replyMarked.pubkey };
    }
    const parentTag = lowerETags.filter(t => t.marker !== 'root' && t.marker !== 'mention').pop()
      || lowerETags[lowerETags.length - 1];
    if (parentTag) {
      return { eventId: parentTag.eventId, relayHint: parentTag.relayHint, pubkey: parentTag.pubkey };
    }
    const rootTag = parsed.find(t => t.tagName === 'E');
    if (rootTag) {
      return { eventId: rootTag.eventId, relayHint: rootTag.relayHint, pubkey: rootTag.pubkey };
    }
    const fallbackTag = parsed[parsed.length - 1];
    return { eventId: fallbackTag.eventId, relayHint: fallbackTag.relayHint, pubkey: fallbackTag.pubkey };
  }

  if (ev.kind === 42) {
    const replyMarked = parsed.filter(t => t.marker === 'reply').pop();
    if (replyMarked) {
      return { eventId: replyMarked.eventId, relayHint: replyMarked.relayHint, pubkey: replyMarked.pubkey };
    }
    const rootTag = parsed.find(t => t.marker === 'root');
    const unmarked = parsed.filter(t => t.tagName === 'e' && !t.marker);
    if (rootTag) {
      if (unmarked.length > 0) {
        const tag = unmarked[unmarked.length - 1];
        return { eventId: tag.eventId, relayHint: tag.relayHint, pubkey: tag.pubkey };
      }
      return { eventId: null, relayHint: '', pubkey: '' };
    }
    if (unmarked.length >= 2) {
      const tag = unmarked[unmarked.length - 1];
      return { eventId: tag.eventId, relayHint: tag.relayHint, pubkey: tag.pubkey };
    }
    return { eventId: null, relayHint: '', pubkey: '' };
  }

  const replyMarked = parsed.filter(t => t.marker === 'reply').pop();
  if (replyMarked) {
    return { eventId: replyMarked.eventId, relayHint: replyMarked.relayHint, pubkey: replyMarked.pubkey };
  }

  const rootTags = parsed.filter(t => t.marker === 'root' || t.tagName === 'E');
  const unmarked = parsed.filter(t => t.tagName === 'e' && !t.marker);

  if (unmarked.length > 0) {
    const tag = unmarked[unmarked.length - 1];
    return { eventId: tag.eventId, relayHint: tag.relayHint, pubkey: tag.pubkey };
  }
  if (rootTags.length > 0) {
    const tag = rootTags[rootTags.length - 1];
    return { eventId: tag.eventId, relayHint: tag.relayHint, pubkey: tag.pubkey };
  }
  const tag = parsed[parsed.length - 1];
  return { eventId: tag.eventId, relayHint: tag.relayHint, pubkey: tag.pubkey };
}

export function pickETagEventId(ev) {
  return pickETagWithHint(ev).eventId;
}

function extractInlineMentionPubkeys(content, nip19) {
  const set = new Set();
  if (!content || typeof content !== 'string' || !nip19 || typeof nip19.decode !== 'function') {
    return set;
  }
  const matches = content.match(/(?:nostr:)?(?:npub1|nprofile1)[02-9ac-hj-np-z]+/gi) || [];
  for (const raw of matches) {
    try {
      const token = raw.replace(/^nostr:/i, '');
      const decoded = nip19.decode(token);
      if (decoded?.type === 'npub' && typeof decoded.data === 'string') {
        set.add(decoded.data.toLowerCase());
      } else if (decoded?.type === 'nprofile' && decoded.data?.pubkey) {
        set.add(String(decoded.data.pubkey).toLowerCase());
      }
    } catch (_e) { }
  }
  return set;
}

export function pickReplyTargetPubkey(ev, state = null, nip19 = null) {
  if (!ev || !Array.isArray(ev.tags)) return '';

  const picked = pickETagWithHint(ev);
  if (picked.pubkey) {
    return picked.pubkey;
  }

  const lowerPTags = ev.tags
    .filter(t => Array.isArray(t) && t[0] === 'p' && t[1])
    .map(t => String(t[1]).trim())
    .filter(Boolean);
  const upperPTags = ev.tags
    .filter(t => Array.isArray(t) && t[0] === 'P' && t[1])
    .map(t => String(t[1]).trim())
    .filter(Boolean);

  if (ev.kind === 1111) {
    if (lowerPTags.length > 0) return lowerPTags[lowerPTags.length - 1];
    if (upperPTags.length > 0) return upperPTags[upperPTags.length - 1];
    return '';
  }

  const pTags = lowerPTags.length > 0 ? lowerPTags : upperPTags;
  if (pTags.length === 0) return '';
  if (pTags.length === 1) return pTags[0];

  const inlineMentions = extractInlineMentionPubkeys(ev.content, nip19);
  const threadPTags = inlineMentions.size > 0
    ? pTags.filter(pk => !inlineMentions.has(pk.toLowerCase()))
    : pTags;
  const candidates = threadPTags.length > 0 ? threadPTags : pTags;

  const parsedETags = ev.tags.map(parseETagEntry).filter(Boolean);
  const rootTag = parsedETags.find(t => t.marker === 'root' || t.tagName === 'E')
    || (parsedETags.length >= 2 && !parsedETags[0].marker ? parsedETags[0] : null);
  const rootId = rootTag ? rootTag.eventId : null;

  if (rootId && picked.eventId && rootId !== picked.eventId) {
    let rootPubkey = rootTag?.pubkey || '';
    if (!rootPubkey && state) {
      try {
        const rootEv = findEventById(state, rootId);
        if (rootEv?.pubkey) rootPubkey = rootEv.pubkey;
      } catch (_e) { }
    }
    if (rootPubkey) {
      const rootLower = rootPubkey.toLowerCase();
      const rootOccurrences = candidates.filter(pk => pk.toLowerCase() === rootLower).length;
      const nonRoot = candidates.filter(pk => pk.toLowerCase() !== rootLower);
      if (rootOccurrences === 1 && nonRoot.length > 0) {
        return nonRoot[nonRoot.length - 1];
      }
    }
  }

  return candidates[candidates.length - 1];
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

export function updateEventMuteDom(eventEl, state, settings = null, forceExpanded = null) {
  try {
    if (!eventEl) return;

    let effectiveSettings = settings;
    if (!effectiveSettings || (typeof effectiveSettings.ignoreMuteApply === 'undefined' && typeof effectiveSettings.disableMuteApply === 'undefined')) {
      if (eventEl && eventEl.closest && (eventEl.closest('#profileModal') || eventEl.closest('[data-ignore-mute-apply="true"]'))) {
        effectiveSettings = { ...(settings || {}), ignoreMuteApply: true };
      }
    }

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

    const contentEl = eventEl.querySelector('.content');
    const content = contentEl ? contentEl.textContent || '' : '';
    const muteState = evaluateMuteState(state, pubkey, content, effectiveSettings, ev);

    const existingFold = eventEl.querySelector('.muted-fold-bar');

    if (!muteState.isMuted) {
      if (existingFold) existingFold.remove();
      eventEl.classList.remove('muted-event', 'muted-event-soft', 'muted-event-dim', 'muted-hidden', 'd-none');
      delete eventEl.dataset.muteCollapsible;

      if (contentEl) contentEl.classList.remove('d-none');
      const actionReact = eventEl.querySelector('.event-actions-react'); if (actionReact) actionReact.classList.remove('d-none');
      const actionBottom = eventEl.querySelector('.event-actions-bottom'); if (actionBottom) actionBottom.classList.remove('d-none');
      const topRowEl = eventEl.querySelector('.event-top-row'); if (topRowEl) topRowEl.classList.remove('d-none');
      const replyToEls = eventEl.querySelectorAll('.reply-to'); replyToEls.forEach(el => el.classList.remove('d-none'));
      const chanEls = eventEl.querySelectorAll('.event-channel-context, .channel-context'); chanEls.forEach(el => el.classList.remove('d-none'));
      const bottomRowEl = eventEl.querySelector('.event-bottom-row'); if (bottomRowEl) bottomRowEl.classList.remove('d-none');
      const cwBar = eventEl.querySelector('.cw-fold-bar'); if (cwBar) cwBar.classList.remove('d-none');
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
        return;
      }

      let isExpanded = false;
      if (typeof forceExpanded === 'boolean') {
        isExpanded = forceExpanded;
      }

      eventEl.dataset.muteCollapsible = '1';
      eventEl.classList.add('muted-event');

      if (existingFold) existingFold.remove();
      const foldBar = createFoldBar(eventEl, muteState, isExpanded);
      if (foldBar) {
        const btn = foldBar.querySelector('.muted-fold-expand-btn');
        if (btn) {
          btn.onclick = function (e) {
            e.stopPropagation();
            const nextExpanded = !isExpanded;
            updateEventMuteDom(eventEl, state, settings, nextExpanded);
          };
        }
        eventEl.insertBefore(foldBar, eventEl.firstChild);
      }

      if (isExpanded) {
        if (contentEl) contentEl.classList.remove('d-none');
        const actionReact = eventEl.querySelector('.event-actions-react'); if (actionReact) actionReact.classList.remove('d-none');
        const actionBottom = eventEl.querySelector('.event-actions-bottom'); if (actionBottom) actionBottom.classList.remove('d-none');
        const topRowEl = eventEl.querySelector('.event-top-row'); if (topRowEl) topRowEl.classList.remove('d-none');
        const replyToEls = eventEl.querySelectorAll('.reply-to'); replyToEls.forEach(el => el.classList.remove('d-none'));
        const chanEls = eventEl.querySelectorAll('.event-channel-context, .channel-context'); chanEls.forEach(el => el.classList.remove('d-none'));
        const bottomRowEl = eventEl.querySelector('.event-bottom-row'); if (bottomRowEl) bottomRowEl.classList.remove('d-none');
        const cwBar = eventEl.querySelector('.cw-fold-bar'); if (cwBar) cwBar.classList.remove('d-none');
      } else {
        if (contentEl) contentEl.classList.add('d-none');
        const actionReact = eventEl.querySelector('.event-actions-react'); if (actionReact) actionReact.classList.add('d-none');
        const actionBottom = eventEl.querySelector('.event-actions-bottom'); if (actionBottom) actionBottom.classList.add('d-none');
        const topRowEl = eventEl.querySelector('.event-top-row'); if (topRowEl) topRowEl.classList.add('d-none');
        const replyToEls = eventEl.querySelectorAll('.reply-to'); replyToEls.forEach(el => el.classList.add('d-none'));
        const chanEls = eventEl.querySelectorAll('.event-channel-context, .channel-context'); chanEls.forEach(el => el.classList.add('d-none'));
        const bottomRowEl = eventEl.querySelector('.event-bottom-row'); if (bottomRowEl) bottomRowEl.classList.add('d-none');
        const cwBar = eventEl.querySelector('.cw-fold-bar'); if (cwBar) cwBar.classList.add('d-none');
      }
    }
  } catch (e) {
    if (window.__nokakoiDebug) console.warn('[Renderer] updateEventMuteDom に失敗', e);
  }
}

export function createFoldBar(eventEl, muteState, isExpanded = false) {
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
    expandBtn.textContent = isExpanded ? (t('fold.hide') || '折りたたむ') : (t('fold.show') || '表示');

    labelAndBtnWrap.appendChild(expandBtn);
    foldBar.appendChild(left);

    return foldBar;
  } catch (e) {
    return null;
  }
}

export function refreshEventsMuteState(state = null, targetPubkey = null) {
  try {
    invalidateMuteConfigCache();
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

let _cachedMuteConfig = null;
const _profileTextCache = new Map();

function getCachedProfileText(state, pubkey) {
  if (!pubkey || !state || !state.profiles || !state.profiles.get) return '';
  const prof = state.profiles.get(pubkey);
  if (!prof) return '';

  if (_profileTextCache.has(pubkey)) {
    const entry = _profileTextCache.get(pubkey);
    if (entry.prof === prof) return entry.text;
  }

  const textParts = [];
  if (prof.display_name) textParts.push(prof.display_name);
  if (prof.name && prof.name !== prof.display_name) textParts.push(prof.name);
  if (prof.about) textParts.push(prof.about);
  if (prof.nip05) textParts.push(prof.nip05);
  if (prof.lud16) textParts.push(prof.lud16);
  if (prof.lud06) textParts.push(prof.lud06);
  if (prof.website) textParts.push(prof.website);

  const text = textParts.join(' ').toLowerCase();
  _profileTextCache.set(pubkey, { prof, text });
  return text;
}

export function invalidateMuteConfigCache() {
  _cachedMuteConfig = null;
  _profileTextCache.clear();
}

function getMuteConfig() {
  if (!_cachedMuteConfig) {
    let rawMuteList = window.__nokakoiMuteList;
    if (!rawMuteList) {
      try {
        const raw = localStorage.getItem('muteList_expanded');
        if (raw) rawMuteList = JSON.parse(raw);
      } catch (e) { }
    }

    const pubkeysPublicSet = new Set((rawMuteList && rawMuteList.pubkeys && Array.isArray(rawMuteList.pubkeys.public)) ? rawMuteList.pubkeys.public : []);
    const pubkeysPrivateSet = new Set((rawMuteList && rawMuteList.pubkeys && Array.isArray(rawMuteList.pubkeys.private)) ? rawMuteList.pubkeys.private : []);
    const wordsPublic = (rawMuteList && rawMuteList.words && Array.isArray(rawMuteList.words.public)) ? rawMuteList.words.public.map(w => String(w).toLowerCase()) : [];
    const wordsPrivate = (rawMuteList && rawMuteList.words && Array.isArray(rawMuteList.words.private)) ? rawMuteList.words.private.map(w => String(w).toLowerCase()) : [];

    const getMuteSettingLocal = (key, defVal) => {
      const pk = localStorage.getItem('pubkey');
      const fullKey = pk ? `${key}.${pk.toLowerCase()}` : key;
      const val = localStorage.getItem(fullKey);
      if (val !== null) return val;
      const fallback = localStorage.getItem(key);
      return fallback !== null ? fallback : defVal;
    };

    _cachedMuteConfig = {
      rawMuteApply: (getMuteSettingLocal('mute_apply', '1')) === '1',
      muteDisplayMode: getMuteSettingLocal('mute_display_mode', 'collapse'),
      hidePublic: (getMuteSettingLocal('mute_hide_public', '0')) === '1',
      applyKind0: (getMuteSettingLocal('mute_apply_kind0', '0')) === '1',
      pubkeysPublicSet,
      pubkeysPrivateSet,
      wordsPublic,
      wordsPrivate,
      hasMuteData: pubkeysPublicSet.size > 0 || pubkeysPrivateSet.size > 0 || wordsPublic.length > 0 || wordsPrivate.length > 0
    };
  }
  return _cachedMuteConfig;
}

export function evaluateMuteState(state, pk, content, settings = null, ev = null) {
  const cfg = getMuteConfig();
  const ignoreMuteApply = !!(settings && (settings.ignoreMuteApply === true || settings.disableMuteApply === true));
  const result = {
    isMuted: false,
    mutedType: null,
    matchedWord: null,
    muteApply: ignoreMuteApply ? false : cfg.rawMuteApply,
    muteDisplayMode: cfg.muteDisplayMode
  };

  if (!cfg.hasMuteData) return result;

  try {
    const targetPubkeys = [pk];
    // 純粋なリポスト (kind 6 / 16) の場合のみ元投稿者 (pタグ) もミュート判定に含める
    if (ev && (ev.kind === 6 || ev.kind === 16) && Array.isArray(ev.tags)) {
      const pTags = ev.tags.filter(t => t && t[0] === 'p' && t[1]).map(t => t[1]);
      targetPubkeys.push(...pTags);
    }

    for (const targetPk of targetPubkeys) {
      if (!targetPk) continue;
      const isPublic = cfg.pubkeysPublicSet.has(targetPk);
      const isPrivate = cfg.pubkeysPrivateSet.has(targetPk);
      if (isPublic || isPrivate) {
        result.isMuted = true;
        result.mutedType = 'user';
        if (cfg.hidePublic && isPublic && result.muteDisplayMode === 'collapse') {
          result.muteDisplayMode = 'hide';
        }
        return result;
      }
    }

    if (cfg.wordsPublic.length > 0 || cfg.wordsPrivate.length > 0) {
      let profileText = '';
      if (cfg.applyKind0 && state) {
        try {
          const parts = [];
          for (const targetPk of targetPubkeys) {
            const txt = getCachedProfileText(state, targetPk);
            if (txt) parts.push(txt);
          }
          profileText = parts.join(' ');
        } catch (e) { }
      }

      const combinedText = ((content || '') + ' ' + profileText).toLowerCase();
      for (const lw of cfg.wordsPublic) {
        if (!lw) continue;
        if (combinedText.indexOf(lw) !== -1) {
          result.isMuted = true;
          result.mutedType = 'word';
          result.matchedWord = lw;
          if (cfg.hidePublic && result.muteDisplayMode === 'collapse') {
            result.muteDisplayMode = 'hide';
          }
          return result;
        }
      }

      for (const lw of cfg.wordsPrivate) {
        if (!lw) continue;
        if (combinedText.indexOf(lw) !== -1) {
          result.isMuted = true;
          result.mutedType = 'word';
          result.matchedWord = lw;
          return result;
        }
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
