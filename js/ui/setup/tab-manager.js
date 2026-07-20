import { t, applyTranslations } from '../../utils/i18n.js';
import { showOmochatSettingsModal } from '../modals/modals.js';
import { clearReplyTarget } from '../../features/post/composer.js';
import { setMentionBlink } from './mention-blink.js';
import { showHomeDisplayQuickModal } from './display-settings.js';

export const DEFAULT_TABS = [
  { id: 'home', labelKey: 'tabs.home', canToggle: true, defaultVisible: true },
  { id: 'global', labelKey: 'tabs.global', canToggle: true, defaultVisible: true },
  { id: 'me', labelKey: 'tabs.me', canToggle: true, defaultVisible: true },
  { id: 'mentions', labelKey: 'tabs.mentions', canToggle: true, defaultVisible: true },
  { id: 'bitchat', labelKey: 'tabs.bitchat', fallbackLabel: 'omochat', canToggle: true, defaultVisible: true }
];

export function loadTabSettings(settingsManager) {
  try {
    let raw = settingsManager.get('tabs_v2');
    if (!raw && typeof settingsManager.getRaw === 'function') {
      const stored = settingsManager.getRaw('tabs_v2');
      if (stored) {
        raw = stored;
        if (settingsManager.settings) {
          settingsManager.settings.tabs_v2 = raw;
        }
      }
    }
    if (raw) return raw;
  } catch (e) {}

  let tabs = JSON.parse(JSON.stringify(DEFAULT_TABS));
  try {
    if (settingsManager.settings.showOmochat === false) {
      const bit = tabs.find(t => t.id === 'bitchat');
      if (bit) bit.visible = false;
    }
  } catch (e) {}

  tabs.forEach(t => {
    if (t.visible === undefined) t.visible = t.defaultVisible;
    if (t.notifyDot === undefined) t.notifyDot = true;
  });
  return tabs;
}

export function saveTabSettings(settingsManager, tabs) {
  settingsManager.set('tabs_v2', tabs);
}

export function clearMentionBlinkState() {
  try {
    const mentionsFeed = document.getElementById('feed-mentions');
    let newest = 0;
    try {
      const evt = (function () {
        try {
          const el = mentionsFeed;
          if (el) {
            const first = el.querySelector('.event');
            if (first && first.dataset && first.dataset.eventId) {
              const evId = first.dataset.eventId;
              if (window.__nostrState) {
                const ev = window.__nostrState && window.__nostrState.feeds && window.__nostrState.feeds['mentions'] && window.__nostrState.feeds['mentions'].map && window.__nostrState.feeds['mentions'].map.get(evId);
                if (ev) return ev;
              }
            }
          }
        } catch (e) { }
        return null;
      })();
      if (evt && evt.created_at) {
        newest = evt.created_at;
        try { if (evt.id) localStorage.setItem('mentions_last_viewed_id', String(evt.id)); } catch (e) { }
      }
    } catch (e) { }
    if (newest <= 0) newest = Math.floor(Date.now() / 1000);
    localStorage.setItem('mentions_last_viewed_at', String(newest));
  } catch (e) { }
  setMentionBlink(false);
}

export function setupTabs(settingsManager, preserveActive = false) {
  const tabsContainer = document.querySelector('.tabs');
  if (!tabsContainer) return;

  let activeId = null;
  if (preserveActive) {
    const activeBtn = tabsContainer.querySelector('.tab.active');
    if (activeBtn) activeId = activeBtn.dataset.tab;
  }

  let tabsConfig = loadTabSettings(settingsManager);

  if (!tabsConfig.some(t => t.visible !== false)) {
    const home = tabsConfig.find(t => t.id === 'home');
    if (home) home.visible = true;
    else if (tabsConfig.length > 0) tabsConfig[0].visible = true;
  }

  tabsContainer.innerHTML = '';
  const feeds = document.querySelectorAll('.feed');

  const visibleTabs = tabsConfig.filter(t => t.visible !== false);
  visibleTabs.forEach(cfg => {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.tab = cfg.id;
    btn.type = 'button';
    if (cfg.labelKey) {
      if (cfg.id === 'bitchat') {
        const gh = settingsManager.get('omochatGeohash') || 'xn';
        btn.textContent = '📍' + gh;
      } else {
        btn.setAttribute('data-i18n', cfg.labelKey);
        btn.textContent = t(cfg.labelKey);
      }
    } else {
      btn.textContent = cfg.fallbackLabel || cfg.id;
    }

    btn.onclick = function () {
      const allTabs = tabsContainer.querySelectorAll('.tab');
      allTabs.forEach(b => b.classList.toggle('active', b === btn));
      feeds.forEach(f => f.classList.remove('active'));
      const target = document.getElementById('feed-' + btn.dataset.tab);
      if (target) {
        target.classList.add('active');
        setTimeout(() => {
          const tabsBar = document.querySelector('.tabs');
          const tabsBarHeight = tabsBar ? tabsBar.getBoundingClientRect().height : 0;
          try {
             const top = target.getBoundingClientRect().top + window.scrollY - tabsBarHeight;
             window.scrollTo({ top, behavior: "auto" });
          } catch(e) {}
        }, 50);
      }

      const ehagakiBtn = document.getElementById('ehagakiBtn');
      if (ehagakiBtn) {
        if (btn.dataset.tab === 'bitchat') ehagakiBtn.classList.add('d-none');
        else ehagakiBtn.classList.remove('d-none');
      }

      try { btn.classList.remove('has-new-dot'); } catch (e) { }

      if (btn.dataset.tab === 'mentions') {
        clearMentionBlinkState();
      }

      try { clearReplyTarget(); } catch(e){}

      try {
        window.dispatchEvent(new CustomEvent('tab:changed', { detail: { tab: btn.dataset.tab } }));
      } catch (e) { }
    };

    if (cfg.id === 'bitchat') {
      let pressTimer;
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showOmochatSettingsModal(settingsManager);
      });
      btn.addEventListener('touchstart', (e) => {
        pressTimer = setTimeout(() => {
          showOmochatSettingsModal(settingsManager);
        }, 800);
      }, {passive: true});
      btn.addEventListener('touchend', (e) => {
        clearTimeout(pressTimer);
      });
      btn.addEventListener('touchcancel', (e) => {
        clearTimeout(pressTimer);
      });
    }

    if (cfg.id === 'home') {
      let longPressTimer = null;
      let longPressTriggered = false;
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showHomeDisplayQuickModal();
        return false;
      });
      btn.addEventListener('touchstart', (e) => {
        longPressTriggered = false;
        longPressTimer = setTimeout(() => {
          longPressTriggered = true;
          e.preventDefault();
          showHomeDisplayQuickModal();
        }, 600);
      }, { passive: false });
      btn.addEventListener('touchend', (e) => {
        if (longPressTimer) clearTimeout(longPressTimer);
        if (longPressTriggered) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
      btn.addEventListener('touchmove', () => {
        if (longPressTimer) clearTimeout(longPressTimer);
      }, { passive: true });
    }

    tabsContainer.appendChild(btn);
  });

  try { if (typeof applyTranslations === 'function') applyTranslations(tabsContainer); } catch(e){}

  const allBtns = tabsContainer.querySelectorAll('.tab');
  if (allBtns.length > 0) {
    let target = null;
    if (activeId) {
      target = Array.from(allBtns).find(b => b.dataset.tab === activeId);
    }
    if (!target) {
      try {
        const pubkey = localStorage.getItem('pubkey');
        if (!pubkey) {
          const globalBtn = Array.from(allBtns).find(b => b.dataset.tab === 'global');
          if (globalBtn) target = globalBtn;
        }
      } catch (e) { }
    }
    if (!target) target = allBtns[0];

    feeds.forEach(f => f.classList.remove('active'));
    target.classList.add('active');
    const fid = 'feed-' + target.dataset.tab;
    const f = document.getElementById(fid);
    if (f) f.classList.add('active');

    const ehagakiBtn = document.getElementById('ehagakiBtn');
    if (ehagakiBtn) {
       if (target.dataset.tab === 'bitchat') ehagakiBtn.classList.add('d-none');
       else ehagakiBtn.classList.remove('d-none');
    }
  }
}

export function renderTabSettingsUI(settingsManager, container) {
  if (!container) return;
  container.innerHTML = '';

  let currentTabs = loadTabSettings(settingsManager);
  currentTabs.forEach(t => { if (t.notifyDot === undefined) t.notifyDot = true; });

  currentTabs.forEach((tab, index) => {
    const row = document.createElement('div');
    row.className = 'tab-order-row';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'tab-order-btn-group';

    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.textContent = '▲';
    upBtn.className = 'secondary small tab-order-arrow-btn';
    upBtn.disabled = index === 0;
    upBtn.onclick = () => {
      const temp = currentTabs[index-1];
      currentTabs[index-1] = currentTabs[index];
      currentTabs[index] = temp;
      saveTabSettings(settingsManager, currentTabs);
      renderTabSettingsUI(settingsManager, container);
      setupTabs(settingsManager, true);
      try { window.dispatchEvent(new CustomEvent('tabsRebuilt')); } catch(e) {}
    };

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.textContent = '▼';
    downBtn.className = 'secondary small tab-order-arrow-btn';
    downBtn.disabled = index === currentTabs.length - 1;
    downBtn.onclick = () => {
      const temp = currentTabs[index+1];
      currentTabs[index+1] = currentTabs[index];
      currentTabs[index] = temp;
      saveTabSettings(settingsManager, currentTabs);
      renderTabSettingsUI(settingsManager, container);
      setupTabs(settingsManager, true);
      try { window.dispatchEvent(new CustomEvent('tabsRebuilt')); } catch(e) {}
    };

    btnGroup.appendChild(upBtn);
    btnGroup.appendChild(downBtn);
    row.appendChild(btnGroup);

    const label = document.createElement('label');
    label.className = 'tab-order-label';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = tab.visible !== false;
    chk.onchange = () => {
      if (!chk.checked) {
        const visibleCount = currentTabs.filter(t => t.visible !== false).length;
        if (visibleCount <= 1 && tab.visible !== false) {
          chk.checked = true;
          return;
        }
      }
      tab.visible = chk.checked;
      saveTabSettings(settingsManager, currentTabs);
      renderTabSettingsUI(settingsManager, container);
      setupTabs(settingsManager, true);
      try { window.dispatchEvent(new CustomEvent('tabsRebuilt')); } catch(e) {}
    };

    if (tab.visible !== false) {
       const visibleCount = currentTabs.filter(t => t.visible !== false).length;
       if (visibleCount <= 1) {
         chk.disabled = true;
         chk.title = "最低1つのタブを表示する必要があります";
       }
    }

    const textSpan = document.createElement('span');
    if (tab.labelKey) {
      textSpan.setAttribute('data-i18n', tab.labelKey);
      textSpan.textContent = t(tab.labelKey);
    } else {
      textSpan.textContent = tab.fallbackLabel || tab.id;
    }

    label.appendChild(chk);
    label.appendChild(textSpan);
    row.appendChild(label);

    const dotLabel = document.createElement('label');
    dotLabel.className = 'dot-label';
    const dotChk = document.createElement('input');
    dotChk.type = 'checkbox';
    dotChk.checked = tab.notifyDot !== false;
    dotChk.onchange = () => {
      tab.notifyDot = dotChk.checked;
      saveTabSettings(settingsManager, currentTabs);
    };
    const dotText = document.createElement('span');
    dotText.setAttribute('data-i18n', 'tabNotifyDot');
    dotText.textContent = t('tabNotifyDot');
    dotLabel.appendChild(dotChk);
    dotLabel.appendChild(dotText);
    row.appendChild(dotLabel);

    container.appendChild(row);
  });

  try { if (typeof applyTranslations === 'function') applyTranslations(container); } catch(e){}
}
