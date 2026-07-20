import { hideComposerForOverlay, restoreComposerFromOverlay } from '../../features/post/composer-scroll.js';

export let _suppressRestore = false;
export const _panelIds = ['displayPanel', 'relayPanel'];

export function hideComposer() {
  hideComposerForOverlay();
}

export function restoreComposer() {
  try {
    if (_suppressRestore) return;
    restoreComposerFromOverlay(null);
  } catch (e) { }
}

export function collapseSettingsPanels() {
  try {
    const dp = document.getElementById('displayPanel');
    if (dp && dp.tagName && dp.tagName.toLowerCase() === 'details' && dp.open) dp.open = false;
  } catch (e) { }
  try {
    const rp = document.getElementById('relayPanel');
    if (rp && rp.tagName && rp.tagName.toLowerCase() === 'details' && rp.open) rp.open = false;
  } catch (e) { }
  try { setTimeout(() => { try { try { restoreComposer(); } catch (ee) { } } catch (e) { } try { restoreComposer(); } catch (ee) { } }, 50); } catch (e) { try { restoreComposer(); } catch (ee) { } }
}

try {
  window.addEventListener('softReloadRequest', () => {
    try { collapseSettingsPanels(); } catch (e) { }
  });
} catch (e) { }

(function ensureSoftReloadWrapped() {
  try {
    let wrapped = false;
    const tryWrap = () => {
      try {
        if (wrapped) return true;
        if (typeof window !== 'undefined' && typeof window.softReload === 'function') {
          const orig = window.softReload.bind(window);
          window.softReload = function () {
            try { collapseSettingsPanels(); } catch (e) { }
            try { return orig.apply(null, arguments); } catch (e) { try { return orig(); } catch (ee) { } }
          };
          wrapped = true;
          return true;
        }
      } catch (e) { }
      return false;
    };
    if (!tryWrap()) {
      const iv = setInterval(() => {
        try {
          if (tryWrap()) { clearInterval(iv); }
        } catch (e) { clearInterval(iv); }
      }, 200);
      setTimeout(() => { try { clearInterval(iv); } catch (e) { } }, 5000);
    }
  } catch (e) { }
})();

export function closeOtherPanels(exceptEl) {
  try {
    for (const id of _panelIds) {
      try {
        const el = document.getElementById(id);
        if (!el || el === exceptEl) continue;
        if (el.tagName && el.tagName.toLowerCase() === 'details' && el.open) {
          el.open = false;
        }
      } catch (e) { }
    }
  } catch (e) { }
}

export function observePanel(el) {
  try {
    if (!el) return;
    el.addEventListener('toggle', () => {
      try {
        if (el.open) {
          hideComposer();
        } else {
          let anyOtherOpen = false;
          for (const id of _panelIds) {
            try { const oel = document.getElementById(id); if (oel && oel !== el && oel.tagName && oel.tagName.toLowerCase() === 'details' && oel.open) { anyOtherOpen = true; break; } } catch (e) { }
          }
          if (!anyOtherOpen) restoreComposer();
        }
      } catch (e) { }
    });
    try {
      const summary = el.querySelector('summary');
      if (summary) {
        summary.addEventListener('click', (ev) => {
          try {
            if (!el.open) {
              _suppressRestore = true;
              try { closeOtherPanels(el); } catch (e) { }
              setTimeout(() => { _suppressRestore = false; }, 120);
            }
            setTimeout(() => {
              try {
                if (el.open) hideComposer(); else {
                  let anyOtherOpen = false;
                  for (const id of _panelIds) { try { const oel = document.getElementById(id); if (oel && oel !== el && oel.tagName && oel.tagName.toLowerCase() === 'details' && oel.open) { anyOtherOpen = true; break; } } catch (e) { } }
                  if (!anyOtherOpen) restoreComposer();
                }
              } catch (e) { }
            }, 0);
          } catch (e) { }
        });
      }
    } catch (e) { }
    try {
      const mo = new MutationObserver((mutations) => {
        setTimeout(() => {
          try {
            for (const m of mutations) {
              if (m.type === 'attributes' && m.attributeName === 'open') {
                try {
                  if (el.open) {
                    _suppressRestore = true; closeOtherPanels(el); setTimeout(() => { _suppressRestore = false; }, 120); hideComposer();
                  } else {
                    let anyOtherOpen = false;
                    for (const id of _panelIds) { try { const oel = document.getElementById(id); if (oel && oel !== el && oel.tagName && oel.tagName.toLowerCase() === 'details' && oel.open) { anyOtherOpen = true; break; } } catch (e) { } }
                    if (!anyOtherOpen) restoreComposer();
                  }
                } catch (e) { }
              }
            }
          } catch (e) { }
        }, 0);
      });
      mo.observe(el, { attributes: true, attributeFilter: ['open'] });
    } catch (e) { }
  } catch (e) { }
}

export function setupSettingsPanelToggle() {
  try {
    for (const id of _panelIds) {
      try {
        const el = document.getElementById(id);
        if (!el) continue;
        observePanel(el);
      } catch (e) { }
    }

    try {
      let anyOpen = false;
      for (const id of _panelIds) {
        try {
          const el = document.getElementById(id);
          if (el && el.tagName && el.tagName.toLowerCase() === 'details' && el.open) { anyOpen = true; break; }
        } catch (e) { }
      }
      if (anyOpen) hideComposer(); else restoreComposer();
    } catch (e) { }
  } catch (e) { }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupSettingsPanelToggle);
} else {
  setupSettingsPanelToggle();
}
