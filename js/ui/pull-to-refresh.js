// ============================================================================
// Pull to Refresh (引っ張り更新 - ブラウザリロード)
// ============================================================================

import { t } from '../utils/i18n.js';

let _cleanupFn = null;

export function setupPullToRefresh() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  if (typeof _cleanupFn === 'function') {
    try { _cleanupFn(); } catch (e) { }
    _cleanupFn = null;
  }

  // インジケーター要素の生成（存在しなければ body に追加）
  let indicator = document.getElementById('ptrIndicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'ptrIndicator';
    indicator.className = 'ptr-indicator';
    indicator.innerHTML = '<span class="ptr-icon">↓</span><span class="ptr-text"></span>';
    document.body.appendChild(indicator);
  }

  const iconEl = indicator.querySelector('.ptr-icon');
  const textEl = indicator.querySelector('.ptr-text');

  let startY = 0;
  let startX = 0;
  let isTracking = false;
  let isPulling = false;
  let isRefreshing = false;

  const THRESHOLD = 65; // トリガーする引き下げピクセル
  const MAX_PULL = 110; // 最大引き下げピクセル

  function resetIndicator() {
    isPulling = false;
    indicator.classList.remove('ptr-pulling', 'ptr-ready', 'ptr-refreshing');
    indicator.style.transform = 'translate(-50%, 0)';
    indicator.style.opacity = '0';
    if (iconEl) {
      iconEl.textContent = '↓';
      iconEl.style.transform = 'none';
    }
    if (textEl) textEl.textContent = '';
  }

  function getScrollTop() {
    try {
      return window.scrollY ?? document.documentElement.scrollTop ?? 0;
    } catch (e) {
      return 0;
    }
  }

  function onTouchStart(e) {
    if (isRefreshing) return;
    if (!e.touches || e.touches.length !== 1) return;

    // モーダル表示中や入力中（composer, input, textarea）は無効
    const activeModal = document.querySelector('.modal:not([hidden])');
    if (activeModal) return;

    const activeEl = document.activeElement;
    if (activeEl) {
      const tag = activeEl.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || activeEl.isContentEditable) {
        return;
      }
    }

    // 画面最上部にいるときのみトラッキング開始
    const st = getScrollTop();
    if (st <= 2) {
      const touch = e.touches[0];
      startY = touch.clientY;
      startX = touch.clientX;
      isTracking = true;
    } else {
      isTracking = false;
    }
  }

  function onTouchMove(e) {
    if (!isTracking || isRefreshing) return;
    if (!e.touches || e.touches.length !== 1) return;

    const st = getScrollTop();
    if (st > 2) {
      if (isPulling) resetIndicator();
      isTracking = false;
      return;
    }

    const touch = e.touches[0];
    const diffY = touch.clientY - startY;
    const diffX = Math.abs(touch.clientX - startX);

    // 横スワイプ（タブ切替等）が優勢な場合はキャンセル
    if (diffX > Math.abs(diffY)) {
      if (isPulling) resetIndicator();
      isTracking = false;
      return;
    }

    // ブラウザネイティブの引っ張り更新・バウンスを抑止しカスタムUIで処理
    if (diffY > 0 && e.cancelable) {
      try { e.preventDefault(); } catch (_err) { }
    }

    // 下方向への引き下げ
    if (diffY > 8) {
      isPulling = true;
      indicator.classList.add('ptr-pulling');

      // 引き下げ量のダンピング計算
      const pull = Math.min(MAX_PULL, (diffY - 8) * 0.45);
      const progress = Math.min(1, pull / THRESHOLD);

      indicator.style.transform = `translate(-50%, ${pull + 10}px)`;
      indicator.style.opacity = `${Math.min(1, progress * 1.3)}`;

      if (pull >= THRESHOLD) {
        if (!indicator.classList.contains('ptr-ready')) {
          indicator.classList.add('ptr-ready');
          try { if (navigator.vibrate) navigator.vibrate(30); } catch (_e) { }
        }
        if (textEl) textEl.textContent = t('ptr.release') || '離して更新';
        if (iconEl) iconEl.style.transform = 'rotate(180deg)';
      } else {
        indicator.classList.remove('ptr-ready');
        if (textEl) textEl.textContent = t('ptr.pull') || '引っ張って更新';
        if (iconEl) iconEl.style.transform = `rotate(${progress * 180}deg)`;
      }

      // iOSでラバーバンドスクロールと競合しないよう、十分引き下げられたらイベントをキャンセル
      if (e.cancelable && pull > 15) {
        try { e.preventDefault(); } catch (_err) { }
      }
    } else if (diffY < 0 && isPulling) {
      resetIndicator();
    }
  }

  function onTouchEnd() {
    if (!isTracking && !isPulling) return;
    isTracking = false;

    if (isPulling) {
      const isReady = indicator.classList.contains('ptr-ready');
      indicator.classList.remove('ptr-pulling');

      if (isReady && !isRefreshing) {
        isRefreshing = true;
        indicator.classList.remove('ptr-ready');
        indicator.classList.add('ptr-refreshing');
        indicator.style.transform = 'translate(-50%, 65px)';
        indicator.style.opacity = '1';
        if (textEl) textEl.textContent = t('ptr.refreshing') || '更新中...';
        if (iconEl) {
          iconEl.textContent = '🔄';
          iconEl.style.transform = 'none';
        }

        setTimeout(() => {
          try {
            window.location.reload();
          } catch (e) {
            window.location.replace(window.location.href);
          }
        }, 320);
      } else {
        resetIndicator();
      }
    }
  }

  function onTouchCancel() {
    isTracking = false;
    if (isPulling) resetIndicator();
  }

  try {
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchCancel, { passive: true });
  } catch (e) { }

  _cleanupFn = () => {
    try {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchCancel);
    } catch (e) { }
    if (indicator && indicator.parentNode) {
      try { indicator.parentNode.removeChild(indicator); } catch (e) { }
    }
  };

  return _cleanupFn;
}
