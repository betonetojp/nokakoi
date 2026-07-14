// UI 設定ヘルパー（main.js から分離）
import { t, applyTranslations } from './i18n.js';
import { showToast } from './utils.js';
import { POSTLINK_DEFAULT_TITLE, POSTLINK_DEFAULT_URL, MAX_PREVIEW_LENGTH, EVENTS_MAX } from './constants.js';
import { showOmochatSettingsModal } from './modals.js';
import { clearReplyTarget } from './composer.js';
import { hideComposerForOverlay, restoreComposerFromOverlay } from './composer-scroll.js';
import { ensureNotificationPermission } from './notification.js';

// モジュールスコープの settingsManager 参照（setupDisplaySettings で設定）
let _settingsManagerRef = null;
let _restartFeedsRef = null;

const DEFAULT_TABS = [
  { id: 'home', labelKey: 'tabs.home', canToggle: true, defaultVisible: true },
  { id: 'global', labelKey: 'tabs.global', canToggle: true, defaultVisible: true },
  { id: 'me', labelKey: 'tabs.me', canToggle: true, defaultVisible: true },
  { id: 'mentions', labelKey: 'tabs.mentions', canToggle: true, defaultVisible: true },
  { id: 'bitchat', labelKey: 'tabs.bitchat', fallbackLabel: 'omochat', canToggle: true, defaultVisible: true } // 既定で ON
];

// タブ設定を読み込む（showOmochat からの移行を含む）
function loadTabSettings(settingsManager) {
  try {
    let raw = settingsManager.get('tabs_v2');

    // 古い SettingsManager ロジックの救済（キャッシュ版に tabs_v2 がない場合）
    if (!raw && typeof settingsManager.getRaw === 'function') {
      const stored = settingsManager.getRaw('tabs_v2');
      if (stored) {
        raw = stored;
        // 現在インスタンスを補正し、save() で消えないようにする
        if (settingsManager.settings) {
          settingsManager.settings.tabs_v2 = raw;
        }
      }
    }

    if (raw) {
      // スキーマ変更時に備えて既定定義（labels/ids）とのマージを検討
      // ただし保存済みの並び順と可視性は優先
      // 将来タブ追加時は保存リストとの差分マージが必要
      // 単純方針: 保存済みリストをベースに、必要なら未知 id を除外し
      // 既定値側にのみ存在する id を末尾に追加
      return raw;
    }
  } catch (e) {}

  // 初回移行または既定値
  let tabs = JSON.parse(JSON.stringify(DEFAULT_TABS));
  try {
    // 旧 showOmochat 設定があれば移行
    // キーは localStorage 直書きまたは settingsManager 経由の可能性あり
    // 通常は settingsManager が localStorage の appSettings を読む
    // 旧コード想定: settingsManager.settings.showOmochat
    if (settingsManager.settings.showOmochat === false) {
      const bit = tabs.find(t => t.id === 'bitchat');
      if (bit) bit.visible = false;
    }
  } catch (e) {}

  // 全タブに visible プロパティを補完（既定は defaultVisible）
  tabs.forEach(t => {
    if (t.visible === undefined) t.visible = t.defaultVisible;
    if (t.notifyDot === undefined) t.notifyDot = true;
  });
  return tabs;
}

// タブ設定を保存
function saveTabSettings(settingsManager, tabs) {
  settingsManager.set('tabs_v2', tabs);
}

// ヘルパー: composer を直接 hide/show
function hideComposer() {
  hideComposerForOverlay();
}
let _suppressRestore = false;
function restoreComposer() {
  try {
    if (_suppressRestore) return;
    restoreComposerFromOverlay(null);
  } catch (e) { }
}

// 登録済み settings パネル（displayPanel/relayPanel）を畳む
function collapseSettingsPanels() {
  try {
    const dp = document.getElementById('displayPanel');
    if (dp && dp.tagName && dp.tagName.toLowerCase() === 'details' && dp.open) dp.open = false;
  } catch (e) { }
  try {
    const rp = document.getElementById('relayPanel');
    if (rp && rp.tagName && rp.tagName.toLowerCase() === 'details' && rp.open) rp.open = false;
  } catch (e) { }
  // DOM 反映後に open 状態を更新
  try { setTimeout(() => { try { /* after collapsing restore composer if none open */ try { restoreComposer(); } catch (ee) { } } catch (e) { } try { restoreComposer(); } catch (ee) { } }, 50); } catch (e) { try { restoreComposer(); } catch (ee) { } }
}

// soft reload 要求時、開いた settings パネルを閉じて展開状態を残さない
try {
  window.addEventListener('softReloadRequest', () => {
    try { collapseSettingsPanels(); } catch (e) { }
  });
} catch (e) { }

// softReload 実行前にパネルを確実に閉じるため、window.softReload もラップ
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
    // まず即時に試行し、未定義なら短時間ポーリング
    if (!tryWrap()) {
      const iv = setInterval(() => {
        try {
          if (tryWrap()) { clearInterval(iv); }
        } catch (e) { clearInterval(iv); }
      }, 200);
      // 一定時間後に試行停止
      setTimeout(() => { try { clearInterval(iv); } catch (e) { } }, 5000);
    }
  } catch (e) { }
})();

// 監視対象パネル ID
const _panelIds = ['displayPanel', 'relayPanel'];

function closeOtherPanels(exceptEl) {
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

// パネルの開閉変化を監視し、ユーザー操作に応じて composer を hide/restore
function observePanel(el) {
  try {
    if (!el) return;
    // toggle イベント: 開いたら hide、閉じたら restore
    el.addEventListener('toggle', () => {
      try {
        if (el.open) {
          hideComposer();
        } else {
          // 他パネルが開いている間は復元しない
          let anyOtherOpen = false;
          for (const id of _panelIds) {
            try { const oel = document.getElementById(id); if (oel && oel !== el && oel.tagName && oel.tagName.toLowerCase() === 'details' && oel.open) { anyOtherOpen = true; break; } } catch (e) { }
          }
          if (!anyOtherOpen) restoreComposer();
        }
      } catch (e) { }
    });
    // ブラウザによっては summary クリックで open が変化するため監視
    try {
      const summary = el.querySelector('summary');
      if (summary) {
        summary.addEventListener('click', (ev) => {
          try {
            // このパネルが閉じていて開く直前なら、他を先に閉じて同時 open を防ぐ
            if (!el.open) {
              // 中間的な restore 呼び出しを抑止
              _suppressRestore = true;
              try { closeOtherPanels(el); } catch (e) { }
              // 正常な restore を許可するため短時間後に抑止解除
              setTimeout(() => { _suppressRestore = false; }, 120);
            }
            // 既定 toggle 動作後に更新
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
    // open 属性の直接変更（framework 由来）も監視
    try {
      const mo = new MutationObserver((mutations) => {
        setTimeout(() => {
          try {
            for (const m of mutations) {
              if (m.type === 'attributes' && m.attributeName === 'open') {
                try {
                  if (el.open) { // プログラムで開いた場合も他を閉じる
                    _suppressRestore = true; closeOtherPanels(el); setTimeout(() => { _suppressRestore = false; }, 120); hideComposer();
                  } else {
                    // 閉じた場合: 他が開いていなければ復元
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

// settings パネルにトグル監視を設定し、open 状態で composer hide/restore を制御
function setupSettingsPanelToggle() {
  try {
    for (const id of _panelIds) {
      try {
        const el = document.getElementById(id);
        if (!el) continue;
        observePanel(el);
      } catch (e) { }
    }

    // 初期判定: 既にどれか開いていれば hide、なければ restore
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

export function setMentionBlink(active) {
  try {
    const tab = document.querySelector('.tab[data-tab="mentions"]');
    if (!tab) return;
    if (active) {
      // 通知ドットを追加（per-tab notifyDot 設定を尊重）
      try {
        const tabsCfg = _settingsManagerRef && _settingsManagerRef.get('tabs_v2');
        const tabCfg = tabsCfg && tabsCfg.find(tc => tc.id === 'mentions');
        if (!tabCfg || tabCfg.notifyDot !== false) {
          tab.classList.add('has-new-dot');
        }
      } catch (e) { }
      // 点滅アニメーション（disableBlink 設定で抑止）
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
      // 現在の先頭イベントを既読として保存
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
    // mentions タブ非アクティブ時は、保存済み last_viewed と先頭イベントを比較
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
            // 先頭 event id が保存済み id と同じなら既読扱い（点滅なし）
            if (storedId && topId && topId === storedId) { setMentionBlink(false); return; }
            if (topCreated > storedAt) { setMentionBlink(true); return; }
          } catch (e) { }
        }
      }
    } catch (e) { }
    // フォールバック: state 未準備時の誤検知を避けるため点滅しない
    setMentionBlink(false);
  } catch (e) { }
}

// mention 点滅状態をクリアするヘルパー
function clearMentionBlinkState() {
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
              try { if (window.__nostrState) { const ev = window.__nostrState && window.__nostrState.feeds && window.__nostrState.feeds['mentions'] && window.__nostrState.feeds['mentions'].map && window.__nostrState.feeds['mentions'].map.get(evId); if (ev) return ev; } } catch (e) { }
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

  // 要求時は現在のアクティブタブを保持
  let activeId = null;
  if (preserveActive) {
    const activeBtn = tabsContainer.querySelector('.tab.active');
    if (activeBtn) activeId = activeBtn.dataset.tab;
  }

  // タブ設定を読み込み
  let tabsConfig = loadTabSettings(settingsManager);

  // 最低1つは表示されるよう保証
  if (!tabsConfig.some(t => t.visible !== false)) {
    const home = tabsConfig.find(t => t.id === 'home');
    if (home) home.visible = true;
    else if (tabsConfig.length > 0) tabsConfig[0].visible = true;
  }

  // 静的内容をクリア
  tabsContainer.innerHTML = '';

  const feeds = document.querySelectorAll('.feed');

  // 表示対象タブに基づいてボタンを生成
  const visibleTabs = tabsConfig.filter(t => t.visible !== false);
  visibleTabs.forEach(cfg => {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.tab = cfg.id;
    btn.type = 'button';
    if (cfg.labelKey) {
      if (cfg.id === 'bitchat') {
        // omochat: geohash のみ表示
        const gh = settingsManager.get('omochatGeohash') || 'xn';
        btn.textContent = '📍' + gh;
        // 単純翻訳処理で上書きされないよう data-i18n は付与しない
        // ラベルはここで手動構築する
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

      // eHagaki ボタン制御
      const ehagakiBtn = document.getElementById('ehagakiBtn');
      if (ehagakiBtn) {
        if (btn.dataset.tab === 'bitchat') ehagakiBtn.classList.add('d-none');
        else ehagakiBtn.classList.remove('d-none');
      }

      // 通知ドットをクリア
      try { btn.classList.remove('has-new-dot'); } catch (e) { }

      // Mentions クリア
      if (btn.dataset.tab === 'mentions') {
        clearMentionBlinkState();
      }

      // タブ切替時に reply/geohash ターゲットをクリア
      try { clearReplyTarget(); } catch(e) {}
    };
    // omochat 設定用の長押し/右クリックハンドラ
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

    // ホームタブ クイック表示設定
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

  // 翻訳を再適用
  try { if (typeof applyTranslations === 'function') applyTranslations(tabsContainer); } catch(e){}

  // 初期アクティブタブを設定
  const allBtns = tabsContainer.querySelectorAll('.tab');
  if (allBtns.length > 0) {
    let target = null;
    if (activeId) {
      target = Array.from(allBtns).find(b => b.dataset.tab === activeId);
    }
    // 未ログイン時は Global タブを優先選択
    if (!target) {
      try {
        const pubkey = localStorage.getItem('pubkey');
        if (!pubkey) {
          const globalBtn = Array.from(allBtns).find(b => b.dataset.tab === 'global');
          if (globalBtn) target = globalBtn;
        }
      } catch (e) { }
    }
    // 保持タブ/Global がなければ先頭タブへフォールバック
    if (!target) target = allBtns[0];

    // 整合のため、先に全 feed の active を解除
    feeds.forEach(f => f.classList.remove('active'));

    target.classList.add('active');
    const fid = 'feed-' + target.dataset.tab;
    const f = document.getElementById(fid);
    if (f) f.classList.add('active');

    // 初期 eHagaki 表示判定
    const ehagakiBtn = document.getElementById('ehagakiBtn');
    if (ehagakiBtn) {
       if (target.dataset.tab === 'bitchat') ehagakiBtn.classList.add('d-none');
       else ehagakiBtn.classList.remove('d-none');
    }
  }
}

function renderTabSettingsUI(settingsManager, container) {
  if (!container) return;
  container.innerHTML = '';

  let currentTabs = loadTabSettings(settingsManager);
  // 全タブに notifyDot プロパティを補完
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
    chk.onclick = (e) => {
      // ロジックは onchange/click 側で処理
    };
    chk.onchange = () => {
      if (!chk.checked) {
        // 最後の表示タブは非表示化を防止
        const visibleCount = currentTabs.filter(t => t.visible !== false).length;
        if (visibleCount <= 1 && tab.visible !== false) {
          chk.checked = true;
          // alert/toast でもよいが、ここでは暗黙的な抑止で十分
          // 必要に応じて再描画して disabled 状態を復元
          return;
        }
      }
      tab.visible = chk.checked;
      saveTabSettings(settingsManager, currentTabs);
      renderTabSettingsUI(settingsManager, container); // Re-render to update disabled states
      setupTabs(settingsManager, true);
      try { window.dispatchEvent(new CustomEvent('tabsRebuilt')); } catch(e) {}
    };

    // 最後の表示タブならチェックボックスを無効化
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

    // タブ単位の通知ドット切替
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

export function applyTheme(theme) {
  try {
    if (theme === 'light') document.body.classList.add('theme-light');
    else document.body.classList.remove('theme-light');
    updateMetaThemeColor();
  } catch (e) { }
}

export function applyColorTheme(colorTheme) {
  try {
    const list = [
      'color-theme-pink',
      'color-theme-blue',
      'color-theme-purple',
      'color-theme-green',
      'color-theme-orange',
      'color-theme-gray'
    ];
    list.forEach(c => document.body.classList.remove(c));
    document.body.classList.add(`color-theme-${colorTheme || 'pink'}`);
    updateMetaThemeColor();
  } catch (e) { }
}

export function updateMetaThemeColor() {
  try {
    const isLight = document.body.classList.contains('theme-light');
    const colorTheme = _settingsManagerRef ? (_settingsManagerRef.get('colorTheme') || 'pink') : 'pink';
    let themeColor = '#16181f'; // 既定ダークパネル

    if (isLight) {
      const lightColors = {
        pink: '#ffeaf5',
        blue: '#e0f2fe',
        purple: '#ede9fe',
        green: '#d1fae5',
        orange: '#ffedd5',
        gray: '#e2e8f0'
      };
      themeColor = lightColors[colorTheme] || '#ffffff';
    } else {
      themeColor = '#16181f';
    }

    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = themeColor;
  } catch (e) { }
}

export function applySimpleDisplayMode(enabled) {
  try {
    if (enabled) document.body.classList.add('simple-display-mode');
    else document.body.classList.remove('simple-display-mode');
  } catch (e) { }
}

function syncDisplayCheckbox(id, checked) {
  try {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
  } catch (e) { }
}

export function setSimpleDisplayModeEnabled(settingsManager, enabled) {
  settingsManager.set('simpleDisplayMode', enabled);
  applySimpleDisplayMode(enabled);
  syncDisplayCheckbox('simpleDisplayModeCheck', enabled);
  syncDisplayCheckbox('homeDisplayQuickCompactCheck', enabled);
}

export function setShowTimelineMediaEnabled(settingsManager, enabled, restartFeeds) {
  settingsManager.set('showTimelineMedia', enabled);
  syncDisplayCheckbox('showTimelineMediaCheck', enabled);
  syncDisplayCheckbox('homeDisplayQuickMediaCheck', enabled);
  const fn = restartFeeds || _restartFeedsRef;
  try { if (typeof fn === 'function') fn(true); } catch (e) { }
}

export function setShowHomeReactionsEnabled(settingsManager, enabled, restartFeeds) {
  settingsManager.set('showHomeReactions', enabled);
  syncDisplayCheckbox('showHomeReactionsCheck', enabled);
  syncDisplayCheckbox('homeDisplayQuickReactionsCheck', enabled);
  const fn = restartFeeds || _restartFeedsRef;
  try { if (typeof fn === 'function') fn(true); } catch (e) { }
}

export function setMuteApplyEnabled(settingsManager, enabled, restartFeeds) {
  try {
    localStorage.setItem('mute_apply', enabled ? '1' : '0');
  } catch (e) { }
  syncDisplayCheckbox('applyMuteCheckbox', enabled);
  syncDisplayCheckbox('homeDisplayQuickMuteCheck', enabled);

  try {
    const applyMuteCheckbox = document.getElementById('applyMuteCheckbox');
    if (applyMuteCheckbox) {
      const modeWrap = applyMuteCheckbox.parentNode?.nextSibling;
      if (modeWrap) {
        modeWrap.classList.toggle('d-none', !enabled);
      }
    }
  } catch (e) { }

  const fn = restartFeeds || _restartFeedsRef;
  try { if (typeof fn === 'function') fn(true); } catch (e) { }
}

export function showHomeDisplayQuickModal() {
  const settingsManager = _settingsManagerRef;
  if (!settingsManager) return;

  const modal = document.getElementById('homeDisplayQuickModal');
  const compactCheck = document.getElementById('homeDisplayQuickCompactCheck');
  const mediaCheck = document.getElementById('homeDisplayQuickMediaCheck');
  const reactionsCheck = document.getElementById('homeDisplayQuickReactionsCheck');
  const muteCheck = document.getElementById('homeDisplayQuickMuteCheck');
  const closeBtn = document.getElementById('homeDisplayQuickCloseBtn');
  if (!modal || !compactCheck || !mediaCheck || !reactionsCheck || !muteCheck) return;

  compactCheck.checked = settingsManager.settings.simpleDisplayMode === true;
  mediaCheck.checked = settingsManager.settings.showTimelineMedia === true;
  reactionsCheck.checked = settingsManager.settings.showHomeReactions === true;
  muteCheck.checked = (localStorage.getItem('mute_apply') || '1') === '1';

  compactCheck.onchange = function () {
    setSimpleDisplayModeEnabled(settingsManager, compactCheck.checked);
  };
  mediaCheck.onchange = function () {
    setShowTimelineMediaEnabled(settingsManager, mediaCheck.checked);
  };
  reactionsCheck.onchange = function () {
    setShowHomeReactionsEnabled(settingsManager, reactionsCheck.checked);
  };
  muteCheck.onchange = function () {
    setMuteApplyEnabled(settingsManager, muteCheck.checked);
  };

  modal.hidden = false;
  try { applyTranslations(modal, true); } catch (e) { }
  bringModalToFront(modal);

  const close = () => {
    modal.hidden = true;
    try { modal.style.zIndex = ''; } catch (e) { }
  };

  if (closeBtn) closeBtn.onclick = close;
  modal.onclick = (e) => {
    if (e.target === modal) close();
  };
}

export function setupDisplaySettings(settingsManager, restartFeeds, resetScrollToTopButtonPosition, updatePostLinkButtonAndModal) {
  // setMentionBlink 判定用にモジュール参照を保持
  _settingsManagerRef = settingsManager;
  _restartFeedsRef = restartFeeds;

  const $ = (s) => document.getElementById(s);
  const showAvatarsCheck = $('showAvatarsCheck');
  if (!showAvatarsCheck) return;

  const showTimelineMediaCheck = $('showTimelineMediaCheck');
  const showCustomEmojiCheck = $('showCustomEmojiCheck');
  const showMusicStatusCheck = $('showMusicStatusCheck');
  // showOmochatCheck は廃止
  const showHomeOmochatCheck = $('showHomeOmochatCheck');
  if (showHomeOmochatCheck) {
    showHomeOmochatCheck.checked = settingsManager.settings.showHomeOmochat === true;
    showHomeOmochatCheck.onchange = function () {
      settingsManager.set('showHomeOmochat', showHomeOmochatCheck.checked);
      try { restartFeeds(true); } catch (e) { }
    };
  }
  const showHomeReactionsCheck = $('showHomeReactionsCheck');
  const showProfileReactionsCheck = $('showProfileReactionsCheck');
  const showProfileBannerCheck = $('showProfileBannerCheck');

  const simpleDisplayModeCheck = $('simpleDisplayModeCheck');
  if (simpleDisplayModeCheck) {
    simpleDisplayModeCheck.checked = settingsManager.settings.simpleDisplayMode === true;
    applySimpleDisplayMode(simpleDisplayModeCheck.checked);
    simpleDisplayModeCheck.onchange = function () {
      setSimpleDisplayModeEnabled(settingsManager, simpleDisplayModeCheck.checked);
    };
  }

  // 保存済み設定を読み込む
  showAvatarsCheck.checked = settingsManager.settings.showAvatars !== false;
  if (showTimelineMediaCheck) showTimelineMediaCheck.checked = settingsManager.settings.showTimelineMedia === true;
  // showCustomEmoji は localStorage 直接参照する場合もあるが settingsManager 優先
  if (showCustomEmojiCheck) showCustomEmojiCheck.checked = settingsManager.settings.showCustomEmoji !== false;

    // Now Playing 設定を読み込む（既定は ON）
  if (showMusicStatusCheck) {
     showMusicStatusCheck.checked = settingsManager.settings.showMusicStatus !== false;
  }

    // タブ設定 UI を読み込む
  renderTabSettingsUI(settingsManager, $('tabSettingsList'));

  if (showHomeReactionsCheck) showHomeReactionsCheck.checked = settingsManager.settings.showHomeReactions === true;
  const showHomeChannelCheck = $('showHomeChannelCheck');
  if (showHomeChannelCheck) showHomeChannelCheck.checked = settingsManager.settings.showHomeChannel === true;
  const showHomeRepost16Check = $('showHomeRepost16Check');
  if (showHomeRepost16Check) showHomeRepost16Check.checked = settingsManager.settings.showHomeRepost16 === true;
  // disableBlink チェックボックス
  const disableBlinkCheck = $('disableBlinkCheck');
  if (disableBlinkCheck) disableBlinkCheck.checked = settingsManager.settings.disableBlink === true;
  const mentionBackgroundNotificationCheck = $('mentionBackgroundNotificationCheck');
  if (mentionBackgroundNotificationCheck) {
    mentionBackgroundNotificationCheck.checked = settingsManager.settings.mentionNotificationMode === 'background';
  }
  // fetchFollowEmoji チェックボックス
  const fetchFollowEmojiCheck = $('fetchFollowEmojiCheck');
  if (fetchFollowEmojiCheck) fetchFollowEmojiCheck.checked = settingsManager.settings.fetchFollowEmoji === true;
  if (showProfileReactionsCheck) showProfileReactionsCheck.checked = settingsManager.settings.showProfileReactions === true;
  const showProfileChannelCheck = $('showProfileChannelCheck');
  if (showProfileChannelCheck) showProfileChannelCheck.checked = settingsManager.settings.showProfileChannel === true;
  const showProfileRepost16Check = $('showProfileRepost16Check');
  if (showProfileRepost16Check) showProfileRepost16Check.checked = settingsManager.settings.showProfileRepost16 === true;
  if (showProfileBannerCheck) showProfileBannerCheck.checked = settingsManager.settings.showProfileBanner === true;

  // client name 表示/付与の既定設定
  const showClientNameCheck = $('showClientNameCheck');
  const attachClientNameCheck = $('attachClientNameCheck');
  const clientNameInput = $('clientNameInput');
  if (showClientNameCheck) showClientNameCheck.checked = settingsManager.settings.showClientName !== false;
  if (attachClientNameCheck) attachClientNameCheck.checked = settingsManager.settings.attachClientName !== false;
  if (clientNameInput) clientNameInput.value = settingsManager.settings.clientName || 'nokakoi';

  // displayPanel コンテナを manager へ登録
  try { if (window && window.settingsComposerManager) window.settingsComposerManager.registerContainer(document.getElementById('displayPanel')); } catch (e) { }

  if (showClientNameCheck) {
    showClientNameCheck.onchange = function () {
      settingsManager.set('showClientName', showClientNameCheck.checked);
      try { restartFeeds(true); } catch (e) { }
    };
  }
  if (attachClientNameCheck) {
    attachClientNameCheck.onchange = function () {
      settingsManager.set('attachClientName', attachClientNameCheck.checked);
    };
  }
  if (clientNameInput) {
    clientNameInput.onchange = function () {
      settingsManager.set('clientName', clientNameInput.value || 'nokakoi');
    };
  }

  if (showHomeReactionsCheck) {
    showHomeReactionsCheck.onchange = function () {
      setShowHomeReactionsEnabled(settingsManager, showHomeReactionsCheck.checked, restartFeeds);
    };
  }

  if (showHomeChannelCheck) {
    showHomeChannelCheck.onchange = function () {
      settingsManager.set('showHomeChannel', showHomeChannelCheck.checked);
      try { restartFeeds(true); } catch (e) { }
    };
  }

  if (showHomeRepost16Check) {
    showHomeRepost16Check.onchange = function () {
      settingsManager.set('showHomeRepost16', showHomeRepost16Check.checked);
      try { restartFeeds(true); } catch (e) { }
    };
  }

  if (fetchFollowEmojiCheck) {
    fetchFollowEmojiCheck.onchange = function () {
      settingsManager.set('fetchFollowEmoji', fetchFollowEmojiCheck.checked);
      try { window.dispatchEvent(new Event('softReloadRequest')); } catch (e) { }
    };
  }

  if (disableBlinkCheck) {
    disableBlinkCheck.onchange = function () {
      settingsManager.set('disableBlink', disableBlinkCheck.checked);
      // disableBlink 有効化時は現在の点滅を即時クリア
      if (disableBlinkCheck.checked) {
        setMentionBlink(false);
        try {
          const topBtn = document.getElementById('scrollToTopBtn');
          if (topBtn) topBtn.classList.remove('has-new');
        } catch (e) { }
      }
    };
  }

  if (mentionBackgroundNotificationCheck) {
    mentionBackgroundNotificationCheck.onchange = async function () {
      const enabled = mentionBackgroundNotificationCheck.checked;
      if (!enabled) {
        settingsManager.set('mentionNotificationMode', 'off');
        return;
      }
      try {
        const permOk = await ensureNotificationPermission();
        if (!permOk) {
          mentionBackgroundNotificationCheck.checked = false;
          settingsManager.set('mentionNotificationMode', 'off');
          try {
            showToast(t('mentionBackgroundNotification.permission_denied'), { type: 'info', duration: 4000 });
          } catch (e) { }
          return;
        }
        settingsManager.set('mentionNotificationMode', 'background');
      } catch (e) {
        mentionBackgroundNotificationCheck.checked = false;
        settingsManager.set('mentionNotificationMode', 'off');
      }
    };
  }

  if (showProfileReactionsCheck) {
    showProfileReactionsCheck.onchange = function () {
      settingsManager.set('showProfileReactions', showProfileReactionsCheck.checked);
    };
  }

  if (showProfileChannelCheck) {
    showProfileChannelCheck.onchange = function () {
      settingsManager.set('showProfileChannel', showProfileChannelCheck.checked);
    };
  }

  if (showProfileRepost16Check) {
    showProfileRepost16Check.onchange = function () {
      settingsManager.set('showProfileRepost16', showProfileRepost16Check.checked);
    };
  }

  if (showProfileBannerCheck) {
    showProfileBannerCheck.onchange = function () {
      settingsManager.set('showProfileBanner', showProfileBannerCheck.checked);
    };
  }

  //変更時に設定を保存
  showAvatarsCheck.onchange = function () {
    settingsManager.set('showAvatars', showAvatarsCheck.checked);
    //変更を反映するためフィードを再起動
    try { restartFeeds(true); } catch (e) { }
  };

  if (showTimelineMediaCheck) {
    showTimelineMediaCheck.onchange = function () {
      setShowTimelineMediaEnabled(settingsManager, showTimelineMediaCheck.checked, restartFeeds);
    };
  }

  // Custom emoji のチェックイベントは index.html（旧実装）側で処理中（将来統合可能）
  // 統合する場合はグローバルスクリプトとの localStorage 同期が必要
  if (showCustomEmojiCheck) {
    showCustomEmojiCheck.addEventListener('change', () => {
       settingsManager.set('showCustomEmoji', showCustomEmojiCheck.checked);
      // index.html のグローバルハンドラも change を監視してイベントを dispatch する
    });
  }

  // Now Playing 設定変更時の処理
  if (showMusicStatusCheck) {
    showMusicStatusCheck.onchange = function() {
      settingsManager.set('showMusicStatus', showMusicStatusCheck.checked);
      // 即時反映のため、再描画（restartFeeds）または DOM 更新が必要
      // UserStatus は DOM 要素の表示/非表示切り替えだけで対応可能ならそれでもよいが
      // ここではわかりやすくフィード再描画などをトリガーするか、
      // あるいは CSS クラスや DOM 操作で全体へ反映させる方法もある。
      // ここでは単純に restartFeeds(true) で全体再読込扱いにする。
      try { restartFeeds(true); } catch (e) { }
    };
  }

  // showOmochatCheck のイベント監視は廃止（タブ設定 UI へ置換）

  // omochat タブ初期表示判定は廃止（setupTabs ロジックで処理）

  const themeSelect = $('themeSelect');
  if (themeSelect) {
    const current = settingsManager.settings.theme || 'light';
    themeSelect.value = current;
    const resolveInitial = (val) => {
      if (val === 'system') {
        if (window.matchMedia && typeof window.matchMedia === 'function') {
          return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        }
        return 'light';
      }
      return val || 'light';
    };
    applyTheme(resolveInitial(current));

    let mq = null;
    const systemListener = (e) => { if (settingsManager.get('theme') === 'system') applyTheme(e.matches ? 'light' : 'dark'); };
    const setupSystemListener = () => {
      if (mq) mq.removeEventListener('change', systemListener);
      if (window.matchMedia) {
        mq = window.matchMedia('(prefers-color-scheme: light)');
        mq.addEventListener('change', systemListener);
      }
    };
    if (current === 'system') setupSystemListener();

    themeSelect.onchange = function () {
      const v = themeSelect.value;
      settingsManager.set('theme', v);
      if (v === 'system') { applyTheme(resolveInitial('system')); setupSystemListener(); }
      else { applyTheme(v); if (mq) { try { mq.removeEventListener('change', systemListener); } catch (e) { try { mq.removeListener(systemListener); } catch { } } mq = null; } }
    };
  }

  const colorThemeSelect = $('colorThemeSelect');
  if (colorThemeSelect) {
    const currentColor = settingsManager.settings.colorTheme || 'pink';
    colorThemeSelect.value = currentColor;
    applyColorTheme(currentColor);
    colorThemeSelect.onchange = function () {
      const v = colorThemeSelect.value;
      settingsManager.set('colorTheme', v);
      applyColorTheme(v);
    };
  }

  const clearCacheBtn = $('clearCacheBtn');
  const clearCacheStatus = $('clearCacheStatus');
  if (clearCacheBtn) {
    clearCacheBtn.onclick = async function () {
      try {
        if (clearCacheStatus) {
          clearCacheStatus.dataset.i18nKey = 'clear.inprogress';
          try { clearCacheStatus.dataset.i18nParams = ''; } catch (e) { }
          clearCacheStatus.textContent = t('clear.inprogress');
        }
        settingsManager.set('postLinkTitle', POSTLINK_DEFAULT_TITLE);
        settingsManager.set('postLinkUrl', POSTLINK_DEFAULT_URL);
        // キャッシュクリア時に client name 関連設定を既定値へ戻す
        try {
          settingsManager.set('showClientName', true);
          settingsManager.set('attachClientName', true);
          settingsManager.set('clientName', 'nokakoi');
        } catch (e) { /* ignore */ }
        if (typeof updatePostLinkButtonAndModal === 'function') updatePostLinkButtonAndModal(POSTLINK_DEFAULT_TITLE, POSTLINK_DEFAULT_URL);
        if (typeof resetScrollToTopButtonPosition === 'function') resetScrollToTopButtonPosition();
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) await registration.unregister();
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        if (clearCacheStatus) {
          clearCacheStatus.dataset.i18nKey = 'clear.done';
          try { clearCacheStatus.dataset.i18nParams = ''; } catch (e) { }
          clearCacheStatus.textContent = t('clear.done');
        }
        // ユーザーが確認できるようトースト表示後に待ってから reload
        try {
          const toastDur = 3000; //3 seconds for cache clear
          showToast(t('clear.done'), { type: 'success', duration: toastDur });
          setTimeout(() => { try { window.location.reload(true); } catch (e) { } }, toastDur + 200);
        } catch (e) { try { window.location.reload(true); } catch (ee) { } }
      } catch (e) {
        console.error('[UI] キャッシュクリア失敗:', e);
        if (clearCacheStatus) {
          try { clearCacheStatus.dataset.i18nKey = 'clear.error'; clearCacheStatus.dataset.i18nParams = JSON.stringify({ msg: (e && e.message) }); } catch (ee) { }
          try { clearCacheStatus.textContent = t('clear.error', { msg: (e && e.message) }); } catch (ee) { clearCacheStatus.textContent = (e && e.message) || String(e); }
        }
        try { showToast(t('clear.error', { msg: (e && e.message) }), { type: 'error', duration: 5000 }); } catch (ee) { }
      }
    };
  }

  // 言語セレクタ
  try {
    const langSelect = document.getElementById('langSelect');
    if (langSelect) {
      // 初期値を設定
      try { langSelect.value = (localStorage.getItem('lang') || 'ja'); } catch (e) { }
      langSelect.onchange = function () {
        try {
          const v = langSelect.value || 'ja';
          // 新しい言語を保存し、再描画で反映するためページを reload
          import('./i18n.js').then(m => {
            try {
              if (m && m.setLang) m.setLang(v);
            } catch (e) { }
            try {
              const toastDur = 3000; // show short toast before reload
              showToast(t('lang.changed_reload'), { type: 'info', duration: toastDur });
              setTimeout(() => { try { window.location.reload(); } catch (e) { } }, toastDur);
            } catch (e) {
              try { window.location.reload(); } catch (e) { }
            }
          }).catch(() => { try { window.location.reload(); } catch (e) { } });
        } catch (e) { try { window.location.reload(); } catch (e) { } }
      };
    }
  } catch (e) { }

  const previewMaxLengthInput = document.getElementById('previewMaxLengthInput');
  if (previewMaxLengthInput) {
    // 初期値反映
    const val = settingsManager.get('previewMaxLength');
    previewMaxLengthInput.value = val && !isNaN(val) ? val : MAX_PREVIEW_LENGTH;
    previewMaxLengthInput.onchange = function () {
      let v = parseInt(previewMaxLengthInput.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      if (v > 100000) v = 100000;
      settingsManager.set('previewMaxLength', v);
    };
  }

  const maxEventsInput = document.getElementById('maxEventsInput');
  if (maxEventsInput) {
    // 初期値反映
    const val = settingsManager.get('maxEvents');
    maxEventsInput.value = val && !isNaN(val) ? val : EVENTS_MAX;
    maxEventsInput.onchange = function () {
      let v = parseInt(maxEventsInput.value, 10);
      if (isNaN(v) || v < 50) v = 50;
      if (v > 5000) v = 5000;
      settingsManager.set('maxEvents', v);
    };
  }
}

export function bringModalToFront(modal) {
  if (!modal) return;
  const modals = Array.from(document.querySelectorAll('.modal'));
  let maxZ = 200;
  modals.forEach(m => { if (!m.hidden) { const z = parseInt(window.getComputedStyle(m).zIndex, 10); if (!isNaN(z) && z > maxZ) maxZ = z; } });
  modal.style.zIndex = maxZ + 1;
  try { window.bringModalToFront = bringModalToFront; } catch (e) { }
}
