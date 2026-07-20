// ============================================================================
// 投稿欄スクロール動作
// ============================================================================

const COMPOSER_TRANSITION_SCROLL = 'transform 0.3s ease-out';
const COMPOSER_TRANSITION_OVERLAY = 'transform 0.2s ease-out';
const KEYBOARD_THRESHOLD_PX = 80;

/** setupComposerScrollBehavior 実行中のコントローラ */
let scrollController = null;

function getComposerEl() {
  return document.getElementById('composer');
}

function isComposerTransformHidden(composer) {
  if (!composer) return false;
  return (composer.style.transform || '') === 'translateY(100%)';
}

/**
 * スクロールダウンで投稿欄を自動非表示、スクロールアップで表示
 */
export function setupComposerScrollBehavior() {
  const composer = getComposerEl();
  if (!composer || composer.hidden) return;

  if (scrollController) {
    try { scrollController.cleanup(); } catch (e) { }
  }

  scrollController = createScrollController(composer);
  return scrollController.cleanup;
}

/**
 * 投稿欄を表示（スクロール非表示を解除）
 */
export function revealComposer() {
  if (scrollController) {
    scrollController.reveal();
    return getComposerEl();
  }
  const composer = getComposerEl();
  if (!composer || composer.hidden) return null;
  if (composer.dataset && composer.dataset._settingsHidden) return null;
  composer.style.transform = 'translateY(0)';
  composer.style.transition = COMPOSER_TRANSITION_SCROLL;
  composer.style.bottom = '0';
  return composer;
}

/**
 * 設定パネル等のオーバーレイ表示時に投稿欄を隠す
 */
export function hideComposerForOverlay() {
  if (scrollController) {
    scrollController.hideForOverlay();
    return;
  }
  const composer = getComposerEl();
  if (!composer || composer.hidden) return;
  if (composer.dataset._settingsHidden) return;
  composer.dataset._settingsPrevTransform = composer.style.transform || '';
  composer.dataset._settingsPrevTransition = composer.style.transition || '';
  composer.dataset._settingsPrevBottom = composer.style.bottom || '';
  composer.style.transform = 'translateY(100%)';
  composer.style.transition = COMPOSER_TRANSITION_OVERLAY;
  composer.style.bottom = '0';
  composer.dataset._settingsHidden = '1';
}

/**
 * オーバーレイ非表示後に投稿欄の位置を復元
 */
export function restoreComposerFromOverlay(container) {
  if (scrollController) {
    scrollController.restoreFromOverlay(container);
    return;
  }
  const composer = getComposerEl();
  if (!composer) return;
  if (!composer.dataset._settingsHidden) return;
  try {
    const ae = document.activeElement;
    if (ae && container && container.contains && container.contains(ae)) return;
  } catch (e) { }
  composer.style.transform = composer.dataset._settingsPrevTransform || 'translateY(0)';
  composer.style.transition = composer.dataset._settingsPrevTransition || '';
  composer.style.bottom = composer.dataset._settingsPrevBottom || '0';
  delete composer.dataset._settingsHidden;
  delete composer.dataset._settingsPrevTransform;
  delete composer.dataset._settingsPrevTransition;
  delete composer.dataset._settingsPrevBottom;
}

/** スクロール起因で非表示か */
export function isComposerScrollHidden() {
  if (scrollController) return scrollController.isComposerScrollHidden();
  const composer = getComposerEl();
  if (!composer) return false;
  return isComposerTransformHidden(composer);
}

/** visualViewport に合わせて bottom を同期 */
export function syncComposerViewport() {
  if (scrollController) {
    scrollController.syncComposerViewport();
    return;
  }
  const composer = getComposerEl();
  if (!composer || composer.hidden) return;
  if (composer.dataset && composer.dataset._settingsHidden) {
    composer.style.transform = 'translateY(100%)';
    return;
  }
  if (isComposerTransformHidden(composer)) {
    composer.style.bottom = '0';
    return;
  }
  composer.style.bottom = '0';
}

function createScrollController(composer) {
  let isComposerHidden = !!(
    composer.dataset && composer.dataset._settingsHidden
  ) || isComposerTransformHidden(composer);
  let overlaySavedState = null;
  let scrollTimeout = null;
  let lastScrollY = window.scrollY;
  // 投稿窓を隠した時点のスクロール位置（累積上方向スクロールの基準点）
  let directionScrollY = window.scrollY;
  let ticking = false;

  function composerHasTextInputFocus() {
    try {
      const ae = document.activeElement;
      if (!ae || !composer.contains(ae)) return false;
      const tag = ae.tagName;
      if (tag === 'TEXTAREA') return true;
      if (tag === 'INPUT') {
        const type = (ae.type || '').toLowerCase();
        if (type === 'button' || type === 'submit' || type === 'checkbox' || type === 'radio') {
          return false;
        }
        return true;
      }
      if (ae.isContentEditable) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function computeKeyboardOffset() {
    if (!window.visualViewport) return 0;
    const vv = window.visualViewport;
    const raw = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    if (raw <= KEYBOARD_THRESHOLD_PX) return 0;
    const maxOffset = vv.height * 0.6;
    return Math.min(raw, maxOffset);
  }

  function setComposerScrollHidden(hidden, options = {}) {
    const transition = options.transition || COMPOSER_TRANSITION_SCROLL;
    if (hidden) {
      composer.style.transform = 'translateY(100%)';
      composer.style.transition = transition;
      composer.style.bottom = '0';
      isComposerHidden = true;
    } else {
      composer.style.transform = 'translateY(0)';
      composer.style.transition = transition;
      isComposerHidden = false;
      syncComposerViewport();
    }
  }

  function syncComposerViewport() {
    try {
      if (!composer) return;
      if (composer.dataset && composer.dataset._settingsHidden) {
        composer.style.transform = 'translateY(100%)';
        return;
      }
      if (window.__nokakoiProgrammaticScroll) return;

      if (isComposerHidden) {
        composer.style.bottom = '0';
        return;
      }

      if (!composerHasTextInputFocus()) {
        composer.style.bottom = '0';
        return;
      }

      if (window.visualViewport) {
        const offset = computeKeyboardOffset();
        composer.style.bottom = offset + 'px';
        composer.style.transform = 'translateY(0)';
      } else {
        composer.style.bottom = '0';
      }
    } catch (e) {
      console.warn('[Composer] 位置調整でエラー', e);
    }
  }

  function reveal() {
    if (composer.dataset && composer.dataset._settingsHidden) return;
    setComposerScrollHidden(false);
  }

  function hideForOverlay() {
    if (!composer || composer.hidden) return;
    if (composer.dataset._settingsHidden) return;
    overlaySavedState = {
      transform: composer.style.transform || '',
      transition: composer.style.transition || '',
      bottom: composer.style.bottom || '',
      isComposerHidden,
    };
    composer.dataset._settingsHidden = '1';
    setComposerScrollHidden(true, { transition: COMPOSER_TRANSITION_OVERLAY });
  }

  function restoreFromOverlay(container) {
    if (!composer) return;
    if (!composer.dataset._settingsHidden) return;
    try {
      const ae = document.activeElement;
      if (ae && container && container.contains && container.contains(ae)) return;
    } catch (e) { }

    delete composer.dataset._settingsHidden;
    if (overlaySavedState) {
      composer.style.transform = overlaySavedState.transform || 'translateY(0)';
      composer.style.transition = overlaySavedState.transition || '';
      composer.style.bottom = overlaySavedState.bottom || '0';
      isComposerHidden = overlaySavedState.isComposerHidden;
      overlaySavedState = null;
    } else {
      setComposerScrollHidden(false);
    }
    syncComposerViewport();
  }

  const handleScroll = () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        const currentScrollY = window.scrollY;
        const scrollDelta = currentScrollY - lastScrollY;

        if (scrollTimeout) {
          clearTimeout(scrollTimeout);
        }

        if (window.__nokakoiProgrammaticScroll) {
          lastScrollY = currentScrollY;
          ticking = false;
          return;
        }

        if (composer.dataset && composer.dataset._settingsHidden) {
          lastScrollY = currentScrollY;
          ticking = false;
          return;
        }

        // テキスト入力フォーカス時はスクロールで隠さない
        // (iOS でキーボード出現時の自動スクロールで消えるのを防ぐ)
        if (composerHasTextInputFocus()) {
          lastScrollY = currentScrollY;
          ticking = false;
          return;
        }

        if (scrollDelta > 5 && !isComposerHidden) {
          // 下方向スクロール: 投稿窓を隠す。基準点を現在位置に更新
          setComposerScrollHidden(true);
          directionScrollY = currentScrollY;
        } else if (isComposerHidden) {
          if (scrollDelta > 0) {
            // 投稿窓が隠れている間もさらに下スクロールしたら基準点を追従させる
            // （最も深い位置から-40pxで再表示するため）
            directionScrollY = currentScrollY;
          } else {
            // 上方向スクロール: 最後に下端だった位置から累積40px以上戻ったら再表示
            const cumulativeUpDelta = currentScrollY - directionScrollY;
            if (cumulativeUpDelta < -40) {
              setComposerScrollHidden(false);
              directionScrollY = currentScrollY;
            }
          }
        }

        if (currentScrollY < 100 && isComposerHidden) {
          setComposerScrollHidden(false);
          directionScrollY = currentScrollY;
        }

        lastScrollY = currentScrollY;
        ticking = false;
      });

      ticking = true;
    }
  };

  function onComposerFocus() {
    if (composer.dataset && composer.dataset._settingsHidden) return;
    setComposerScrollHidden(false);
    setTimeout(syncComposerViewport, 50);
  }

  function onComposerBlur() {
    setTimeout(() => {
      if (composerHasTextInputFocus()) return;
      composer.style.bottom = '0';
      syncComposerViewport();
    }, 150);
  }

  window.addEventListener('scroll', handleScroll, { passive: true });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncComposerViewport);
    window.visualViewport.addEventListener('scroll', syncComposerViewport);
  } else {
    window.addEventListener('resize', syncComposerViewport);
  }

  const inputs = composer.querySelectorAll('input, textarea, [contenteditable]');
  inputs.forEach((el) => {
    el.addEventListener('focus', onComposerFocus, { passive: true });
    el.addEventListener('blur', onComposerBlur, { passive: true });
  });

  const controller = {
    reveal,
    hideForOverlay,
    restoreFromOverlay,
    syncComposerViewport,
    isComposerScrollHidden: () => isComposerHidden,
    cleanup() {
      window.removeEventListener('scroll', handleScroll);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', syncComposerViewport);
        window.visualViewport.removeEventListener('scroll', syncComposerViewport);
      } else {
        window.removeEventListener('resize', syncComposerViewport);
      }
      inputs.forEach((el) => {
        el.removeEventListener('focus', onComposerFocus);
        el.removeEventListener('blur', onComposerBlur);
      });
      if (scrollTimeout) clearTimeout(scrollTimeout);
      if (scrollController === controller) scrollController = null;
    },
  };

  return controller;
}
