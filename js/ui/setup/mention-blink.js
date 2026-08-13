import { _settingsManagerRef } from './display-settings.js';
import { getAppState } from '../../core/app-context.js';
import {
  readMentionLastViewed,
  writeMentionLastViewed,
} from '../../utils/mention-last-viewed.js';

export function setMentionBlink(active) {
  try {
    const tab = document.querySelector('.tab[data-tab="mentions"]');
    if (!tab) return;
    if (active) {
      try {
        const tabsCfg = _settingsManagerRef && _settingsManagerRef.get('tabs_v2');
        const tabCfg = tabsCfg && tabsCfg.find(tc => tc.id === 'mentions');
        if (!tabCfg || tabCfg.notifyDot !== false) {
          tab.classList.add('has-new-dot');
        }
      } catch (e) { }
      if (!(_settingsManagerRef && _settingsManagerRef.get('disableBlink'))) {
        tab.classList.add('blink');
        tab.classList.add('blink-active');
      }
    } else {
      tab.classList.remove('blink-active');
      tab.classList.remove('blink');
    }
  } catch (e) { }
}

export function checkMentionBlink() {
  try {
    const activeTabEl = document.querySelector('.tab.active');
    const activeTab = activeTabEl && activeTabEl.dataset ? activeTabEl.dataset.tab : null;
    if (activeTab === 'mentions') {
      setMentionBlink(false);
      try {
        const mentionsFeed = document.getElementById('feed-mentions');
        if (mentionsFeed) {
          const first = mentionsFeed.querySelector('.event');
          if (first && first.dataset && first.dataset.eventId) {
            try {
              const appState = getAppState();
              if (appState && appState.feeds && appState.feeds['mentions'] && appState.feeds['mentions'].map) {
                const ev = appState.feeds['mentions'].map.get(first.dataset.eventId);
                if (ev && ev.created_at) {
                  writeMentionLastViewed({ at: ev.created_at, id: ev.id });
                }
              }
            } catch (e) { }
          }
        }
      } catch (e) { }
      return;
    }
    try {
      const mentionsFeed = document.getElementById('feed-mentions');
      if (mentionsFeed) {
        const first = mentionsFeed.querySelector('.event');
        if (first && first.dataset && first.dataset.eventId) {
          try {
            const { at: storedAt, id: storedId } = readMentionLastViewed();
            const appState = getAppState();
            const ev = appState && appState.feeds && appState.feeds['mentions'] && appState.feeds['mentions'].map && appState.feeds['mentions'].map.get(first.dataset.eventId);
            const topCreated = ev && ev.created_at ? ev.created_at : 0;
            const topId = ev && ev.id ? ev.id : '';
            if (storedId && topId && topId === storedId) { setMentionBlink(false); return; }
            if (topCreated > storedAt) { setMentionBlink(true); return; }
          } catch (e) { }
        }
      }
    } catch (e) { }
    setMentionBlink(false);
  } catch (e) { }
}

if (typeof window !== 'undefined') {
  window.__setMentionBlink = setMentionBlink;
}
