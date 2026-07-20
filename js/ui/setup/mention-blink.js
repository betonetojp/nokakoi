import { _settingsManagerRef } from './display-settings.js';

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
              if (window.__nostrState && window.__nostrState.feeds && window.__nostrState.feeds['mentions'] && window.__nostrState.feeds['mentions'].map) {
                const ev = window.__nostrState.feeds['mentions'].map.get(first.dataset.eventId);
                if (ev && ev.created_at) {
                  localStorage.setItem('mentions_last_viewed_at', String(ev.created_at));
                  localStorage.setItem('mentions_last_viewed_id', String(ev.id));
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
            const storedAt = parseInt(localStorage.getItem('mentions_last_viewed_at') || '0', 10);
            const storedId = localStorage.getItem('mentions_last_viewed_id') || '';
            const ev = window.__nostrState && window.__nostrState.feeds && window.__nostrState.feeds['mentions'] && window.__nostrState.feeds['mentions'].map && window.__nostrState.feeds['mentions'].map.get(first.dataset.eventId);
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
