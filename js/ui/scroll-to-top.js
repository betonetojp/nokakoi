// ============================================================================
// スクロールトップボタン
// ============================================================================

import { showToast } from '../utils/utils.js';
import { t } from '../utils/i18n.js';
import { restoreDomPurgeAround } from '../features/timeline/feed-renderer.js';

export function setupScrollToTopButton() {
  const button = document.getElementById('scrollToTopBtn');
  if (!button) return;

  // composer より前面に出るよう pointer-events と z-index を調整
  button.style.pointerEvents = 'auto';
  try { button.style.zIndex = 99999; } catch (e) { }

  // アイコン画像がなければ追加し、既定は上矢印にする
  const img = button.querySelector('img');
  if (!img) {
    const im = document.createElement('img');
    im.src = 'icon/up.png';
    im.className = 'icon-btn';
    button.appendChild(im);
  }

  // 状態
  let scrollTimeout = null;
  let inReloadMode = false;
  let pendingReloadRestore = false; // フラグ: softReload 完了後に tab-top へ復元
  let _spacerEl = null;
  let _desiredTabTop = null;
  let pendingSecondClickTimer = null;

  const getUseDomPurge = () => {
    try {
      // 稼働中の settingsManager を優先（main.js により window に設定される）
      const sm = typeof window !== 'undefined' ? window.settingsManager : null;
      if (sm && typeof sm.get === 'function') {
        return sm.get('useDomPurge') === true;
      }
      const raw = localStorage.getItem('appSettings');
      const obj = raw ? JSON.parse(raw) : {};
      return obj.useDomPurge === true;
    } catch (e) {
      return false;
    }
  };

  const getScrollTop = () => {
    try { return window.scrollY ?? document.documentElement.scrollTop ?? 0; } catch (e) { return 0; }
  };

  // タブ切替ロジックに合わせた "tab-top" 位置を計算
  function computeTabTopPosition() {
    try {
      const target = document.querySelector('.feed.active') || document.querySelector('.feed');
      const tabsBar = document.querySelector('.tabs');
      const tabsBarHeight = tabsBar ? tabsBar.getBoundingClientRect().height : 0;
      if (!target) return 0;
      const rect = target.getBoundingClientRect();
      const top = rect.top + window.scrollY - tabsBarHeight;
      return Math.max(0, Math.round(top));
    } catch (e) {
      return 0;
    }
  }

  function scrollToTabTop(behavior) {
    const tabTop = computeTabTopPosition();
    // プログラムによるスクロールとしてマークし、パージのスクロールリスナーがこのジャンプをユーザースクロールとして扱わないようにする。
    try {
      window.__nokakoiProgrammaticScroll = true;
      setTimeout(() => {
        try {
          if (!window.__nokakoiScrollAnchor) window.__nokakoiProgrammaticScroll = false;
        } catch (e) { }
      }, 200);
    } catch (e) { }
    try {
      window.scrollTo({ top: tabTop, behavior: behavior || 'auto' });
    } catch (e) {
      try { window.scrollTo(tabTop, 0); } catch (ee) { }
    }
    // ジャンプ後、ビューポート付近のパージされた投稿を実体化し、"上部"が空のシェルのままでないようにする。
    try {
      const feed = document.querySelector('.feed.active');
      if (feed && getUseDomPurge()) {
        requestAnimationFrame(() => {
          try { restoreDomPurgeAround(feed); } catch (e) { }
        });
      }
    } catch (e) { }
    return tabTop;
  }

  function setReloadMode(enabled) {
    if (!button) return;
    if (enabled === inReloadMode) return;
    inReloadMode = !!enabled;
    const imgEl = button.querySelector('img.icon-btn');
    if (inReloadMode) {
      if (imgEl) imgEl.src = 'icon/reload.png';
      button.title = 'Reload';
      button.hidden = false;
      button.style.opacity = '1';
      try { button.style.zIndex = 99999; } catch (e) { }
      // 再読込後の表示位置維持のため、スペーサー準備と tab-top へのスクロールを行う
      try {
        _desiredTabTop = computeTabTopPosition();
        const cur = getScrollTop();
        // 目標位置が現在より下なら、必要に応じてスペーサーでスクロール可能領域を確保
        if (typeof _desiredTabTop === 'number' && _desiredTabTop > cur + 2) {
          // 目標位置までスクロールできるだけ文書高さを確保
          try {
            const docHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
            const viewport = window.innerHeight || (document.documentElement.clientHeight || 0);
            const maxScroll = Math.max(0, docHeight - viewport);
            const neededExtra = Math.max(0, Math.ceil(_desiredTabTop - maxScroll) + 20);
            if (neededExtra > 0) {
              // スペーサーを新規作成、または高さを更新
              if (!_spacerEl) {
                _spacerEl = document.createElement('div');
                _spacerEl.id = 'scrollToTopSpacer';
                _spacerEl.style.width = '1px';
                _spacerEl.style.opacity = '0';
                _spacerEl.style.pointerEvents = 'none';
                _spacerEl.style.height = neededExtra + 'px';
                document.body.appendChild(_spacerEl);
              } else {
                _spacerEl.style.height = neededExtra + 'px';
              }
            }
          } catch (e) { }
          // 目標 tabTop へスクロール
          try { window.scrollTo({ top: _desiredTabTop, left: 0, behavior: 'auto' }); } catch (e) { }
        }
      } catch (e) { }
    } else {
      if (imgEl) imgEl.src = 'icon/up.png';
      button.title = 'Top';
      try { button.style.zIndex = 99999; } catch (e) { }
      // スペーサーがあれば削除
      try { if (_spacerEl && _spacerEl.parentNode) { _spacerEl.parentNode.removeChild(_spacerEl); _spacerEl = null; _desiredTabTop = null; } } catch (e) { }
    }
  }

  function updateVisibility() {
    clearTimeout(scrollTimeout);
    const scrollTop = getScrollTop();
    const tabTop = computeTabTopPosition();
    // 点滅を避けるため閾値に小さなバッファを持たせる
    const threshold = 8;

    if (scrollTop > 300) {
      button.hidden = false;
      if (inReloadMode) setReloadMode(false);
    } else if (scrollTop <= tabTop + threshold) {
      // tab-top 以上（または同等）なら reload モード表示
      setReloadMode(true);
      button.hidden = false;
      button.style.opacity = '1';
    } else {
      scrollTimeout = setTimeout(() => { button.hidden = true; }, 100);
    }
  }

  // 初期状態反映
  try {
    const st = getScrollTop();
    const tabTop = computeTabTopPosition();
    if (st > 300) button.hidden = false;
    else if (st <= tabTop + 8) { setReloadMode(true); button.hidden = false; }
    else button.hidden = true;
  } catch (e) { }

  function clearHasNew() {
    try { button.classList.remove('has-new'); } catch (e) { }
    // アクティブタブの通知ドットもクリア
    try {
      const activeTab = document.querySelector('.tab.active');
      if (activeTab) activeTab.classList.remove('has-new-dot');
    } catch (e) { }
  }

  function onScrollHandler() {
    const scrollTop = getScrollTop();
    const tabTop = computeTabTopPosition();
    if (scrollTop <= tabTop + 8) {
      clearHasNew();
      try { setReloadMode(true); button.hidden = false; button.style.opacity = '1'; } catch (e) { }
      return;
    }
    updateVisibility();
    try { setReloadMode(false); } catch (e) { }
  }

  try { window.addEventListener('scroll', onScrollHandler, { passive: true }); } catch (e) { window.addEventListener('scroll', onScrollHandler); }

  // softReload 完了時のトースト関連ハンドラ
  try {
    // 注: ここではトーストを消さない。再読込開始側で second click を予約して表示時間を確保する。
    window.addEventListener('softReloadDone', () => {
      // no-op: 復元処理は再読込開始時のタイマー側で実施
    });
  } catch (e) { }

  // 位置永続化ヘルパー
  function loadButtonPosition() { try { const saved = localStorage.getItem('scrollToTopButtonPosition'); return saved ? JSON.parse(saved) : null; } catch (e) { return null; } }
  function saveButtonPosition(pos) { try { localStorage.setItem('scrollToTopButtonPosition', JSON.stringify(pos)); } catch (e) { } }
  function clearButtonPosition() { try { localStorage.removeItem('scrollToTopButtonPosition'); } catch (e) { } }
  function isPositionValid(position) { try { const left = parseInt(position.left); const bottom = parseInt(position.bottom); if (isNaN(left) || isNaN(bottom)) return false; const maxLeft = window.innerWidth - 45; const maxBottom = window.innerHeight - 45; return left >= 0 && left <= maxLeft && bottom >= 0 && bottom <= maxBottom; } catch (e) { return false; } }
  function resetButtonPosition(buttonEl) { buttonEl.style.left = '50%'; buttonEl.style.bottom = '6px'; buttonEl.style.transform = 'translateX(-50%)'; }

  // 位置復元
  const saved = loadButtonPosition();
  if (saved && isPositionValid(saved)) {
    try { button.style.left = saved.left; button.style.bottom = saved.bottom; button.style.transform = 'none'; } catch (e) { resetButtonPosition(button); }
  } else {
    resetButtonPosition(button);
  }

  // ドラッグ/タップ処理
  let isDragging = false; let hasMoved = false; let startTime = 0;
  let offsetX = 0, offsetY = 0, initialX = 0, initialY = 0;

  function startDrag(e) {
    // composer 入力中は誤ドラッグ防止のため処理しない
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

    isDragging = true; hasMoved = false; startTime = Date.now();
    button.classList.add('dragging');
    const touch = (e.type && e.type.indexOf('touch') !== -1) ? e.touches[0] : e;
    const rect = button.getBoundingClientRect();
    offsetX = touch.clientX - rect.left; offsetY = touch.clientY - rect.top;
    initialX = touch.clientX; initialY = touch.clientY;
    button.style.transform = 'none';
    button.style.left = rect.left + 'px';
    button.style.bottom = (window.innerHeight - rect.bottom) + 'px';
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('mouseup', stopDrag);
    // touchend で preventDefault を使うため non-passive で登録
    document.addEventListener('touchend', stopDrag, { passive: false });
    try { e.preventDefault(); } catch (e) { }
  }

  function onDrag(e) {
    if (!isDragging) return;
    const touch = (e.type && e.type.indexOf('touch') !== -1) ? e.touches[0] : e;
    const deltaX = Math.abs(touch.clientX - initialX); const deltaY = Math.abs(touch.clientY - initialY);
    if (deltaX > 10 || deltaY > 10) hasMoved = true;
    const x = touch.clientX - offsetX; const y = touch.clientY - offsetY;
    const maxX = window.innerWidth - button.offsetWidth; const maxY = window.innerHeight - button.offsetHeight;
    const constrainedX = Math.max(0, Math.min(x, maxX));
    const constrainedY = Math.max(0, Math.min(y, maxY));
    button.style.left = constrainedX + 'px';
    button.style.bottom = (window.innerHeight - constrainedY - button.offsetHeight) + 'px';
    try { e.preventDefault(); } catch (e) { }
  }

  function stopDrag(e) {
    if (!isDragging) return;
    button.classList.remove('dragging');
    const duration = Date.now() - startTime;
    if (duration < 200 && !hasMoved) {
      if (inReloadMode) {
        // 位置を保持
        const pos = { left: button.style.left, bottom: button.style.bottom, transform: button.style.transform };
        // ここでは即トーストを出さず、second tab click 前に表示する
        // 目標 top を保持し、トースト描画後にスクロール位置を変えず再読込要求
        setTimeout(() => {
          // softReload 完了後に tab-top 復元するフラグを立てる
          try { pendingReloadRestore = true; } catch (e) { }
          // 進行中を明示するため 2 秒の loading トーストを表示
          try { showToast(t('loading'), { type: 'info', duration: 2000 }); } catch (e) { }
          // トースト表示後（約2秒）に second tab click を予約
          try {
            if (pendingSecondClickTimer) try { clearTimeout(pendingSecondClickTimer); } catch (e) { }
            pendingSecondClickTimer = setTimeout(() => {
              try {
                const tabs = Array.from(document.querySelectorAll('.tab'));
                if (tabs && tabs.length) {
                  const activeIdx = tabs.findIndex(t => t.classList && t.classList.contains && t.classList.contains('active'));
                  const srcIdx = (activeIdx >= 0) ? activeIdx : 0;
                  const srcTab = tabs[srcIdx];
                  if (srcTab && typeof srcTab.click === 'function') {
                    try { srcTab.click(); } catch (e) { }
                  }
                }
              } catch (e) { }
              // スペーサーをクリーンアップ
              try { if (_spacerEl && _spacerEl.parentNode) { _spacerEl.parentNode.removeChild(_spacerEl); _spacerEl = null; _desiredTabTop = null; } } catch (e) { }
              pendingSecondClickTimer = null;
              pendingReloadRestore = false;
            }, 2100);
          } catch (e) { }
          try { if (typeof window.softReload === 'function') { window.softReload(); } else { window.dispatchEvent(new CustomEvent('softReloadRequest')); } } catch (e) { }
          // ボタン位置を即時復元
          try { if (pos.left) { button.style.left = pos.left; button.style.bottom = pos.bottom; button.style.transform = pos.transform || 'none'; } } catch (e) { }
        }, 120);
      } else {
        const behavior = getUseDomPurge() ? 'auto' : 'smooth';
        scrollToTabTop(behavior);
      }
    } else if (hasMoved) {
      saveButtonPosition({ left: button.style.left, bottom: button.style.bottom });
    }
    setTimeout(() => { isDragging = false; hasMoved = false; }, 100);
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('touchmove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('touchend', stopDrag);
  }

  function activateButtonAction() {
    clearHasNew();
    // full reload へのフォールバック回避のため、まず inReloadMode フラグを優先
    if (inReloadMode) {
      // 位置を保持
      const pos = { left: button.style.left, bottom: button.style.bottom, transform: button.style.transform };
      // ここでは即トーストを出さず、second tab click 前に表示
      // 目標 top を保持し、短時間待ってからスクロール位置を変えず再読込要求
      setTimeout(() => {
        // softReload 完了後に tab-top 復元するフラグを立てる
        try { pendingReloadRestore = true; } catch (e) { }
        // 進行中を明示するため 2 秒の loading トーストを表示
        try { showToast(t('loading'), { type: 'info', duration: 2000 }); } catch (e) { }
        // トースト表示後（約2秒）に second tab click を予約
        try {
          if (pendingSecondClickTimer) try { clearTimeout(pendingSecondClickTimer); } catch (e) { }
          pendingSecondClickTimer = setTimeout(() => {
            try {
              const tabs = Array.from(document.querySelectorAll('.tab'));
              if (tabs && tabs.length) {
                const activeIdx = tabs.findIndex(t => t.classList && t.classList.contains && t.classList.contains('active'));
                const srcIdx = (activeIdx >= 0) ? activeIdx : 0;
                const srcTab = tabs[srcIdx];
                if (srcTab && typeof srcTab.click === 'function') {
                  try { srcTab.click(); } catch (e) { }
                }
              }
            } catch (e) { }
            // スペーサーをクリーンアップ
            try { if (_spacerEl && _spacerEl.parentNode) { _spacerEl.parentNode.removeChild(_spacerEl); _spacerEl = null; _desiredTabTop = null; } } catch (e) { }
            pendingSecondClickTimer = null;
            pendingReloadRestore = false;
          }, 2100);
        } catch (e) { }
        try {
          if (typeof window.softReload === 'function') {
            window.softReload();
            console.log('[ScrollTop] リロード操作を実行');
          } else {
            try { window.dispatchEvent(new CustomEvent('softReloadRequest')); } catch (e) { console.warn('[ScrollTop] softReload を要求したがハンドラがありません'); }
          }
        } catch (e) { }
        // ボタン位置を即時復元
        try { if (pos.left) { button.style.left = pos.left; button.style.bottom = pos.bottom; button.style.transform = pos.transform || 'none'; } } catch (e) { }
      }, 120);
      return;
    }

    const behavior = getUseDomPurge() ? 'auto' : 'smooth';
    scrollToTabTop(behavior);
  }

  button.addEventListener('click', (e) => { if (isDragging) return; activateButtonAction(); });
  button.addEventListener('pointerup', (e) => { if (!isDragging) activateButtonAction(); });
  button.addEventListener('touchend', (e) => { if (!isDragging) activateButtonAction(); }, { passive: true });

  // 下層の composer へイベントが抜けないようにする
  button.addEventListener('pointerdown', (e) => { try { e.stopPropagation(); } catch (err) { } });

  button.addEventListener('mousedown', startDrag);
  button.addEventListener('touchstart', startDrag, { passive: false });

  // リサイズ時の安全対策
  window.addEventListener('resize', function () {
    const currentLeft = parseInt(button.style.left) || 0;
    const currentBottom = parseInt(button.style.bottom) || 0;
    if (currentLeft > window.innerWidth - button.offsetWidth || currentBottom > window.innerHeight - button.offsetHeight) {
      resetButtonPosition(button);
      clearButtonPosition();
    }
  });
}

export function resetScrollToTopButtonPosition() {
  const button = document.getElementById('scrollToTopBtn');
  if (button) {
    try { button.style.left = '50%'; button.style.bottom = '6px'; button.style.transform = 'translateX(-50%)'; } catch (e) { }
    try { localStorage.removeItem('scrollToTopButtonPosition'); } catch (e) { }
  }
}
