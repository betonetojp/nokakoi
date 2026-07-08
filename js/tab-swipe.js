// ============================================================================
// タブスワイプハンドラ
// ============================================================================

/**
 * タブ切り替え用スワイプジェスチャーのセットアップ
 */
export function setupTabSwipe() {
  // フィードが空でもスワイプ可能にするためcontainerを使用
  const swipeContainer = document.querySelector('.container');
  if (!swipeContainer) return;

  let touchStartX = 0;
  let touchEndX = 0;
  let touchStartY = 0;
  let touchEndY = 0;
  let handled = false;

  // スワイプ判定の最小距離: 画面幅の18%または120pxのいずれか大きい方を採用（感度を下げる）
  const minSwipeDistance = Math.max(120, Math.round(window.innerWidth * 0.18));
  // 垂直方向の最大許容距離をさらに厳しく（感度を下げる）
  const maxVerticalDistance = 48;

  // 現在のアクティブタブのインデックス取得
  function getCurrentTabIndex() {
    const tabs = Array.from(document.querySelectorAll('.tab')).filter(t => t.style.display !== 'none');
    return tabs.findIndex(tab => tab.classList.contains('active'));
  }

  // インデックス指定でタブ切り替え（ループあり）
  function switchToTab(index) {
    const tabs = Array.from(document.querySelectorAll('.tab')).filter(t => t.style.display !== 'none');
    const tabCount = tabs.length;
    // インデックスが範囲外ならループ
    let targetIndex = index;
    if (targetIndex < 0) {
      targetIndex = tabCount - 1;
    } else if (targetIndex >= tabCount) {
      targetIndex = 0;
    }
    const tab = tabs[targetIndex];
    if (tab) {
      tab.click();
      // タブバーが最上部になる位置まで即座にスクロール
      const tabsBar = document.querySelector('.tabs');
      if (tabsBar) {
        const top = window.scrollY + tabsBar.getBoundingClientRect().top;
        window.scrollTo({ top, behavior: "auto" });
      } else {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    }
  }

  // スワイプ判定処理
  function handleSwipe() {
    const swipeDistanceX = touchEndX - touchStartX;
    const swipeDistanceY = Math.abs(touchEndY - touchStartY);
    // 垂直移動が大きい場合は無視
    if (swipeDistanceY > maxVerticalDistance) {
      return;
    }
    // 水平移動が足りない場合は無視
    if (Math.abs(swipeDistanceX) < minSwipeDistance) {
      return;
    }
    const currentIndex = getCurrentTabIndex();
    if (swipeDistanceX > 0) {
      // 右スワイプ→前のタブ（ループ）
      switchToTab(currentIndex - 1);
    } else {
      // 左スワイプ→次のタブ（ループ）
      switchToTab(currentIndex + 1);
    }
  }

  // タッチイベントハンドラ
  const touchStartHandler = (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    handled = false;
  };

  const touchEndHandler = (e) => {
    if (handled) return;
    handled = true;
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();
  };

  const touchCancelHandler = (e) => {
    handled = true;
    try { if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation(); } catch (err) { }
  };

  // containerにイベントリスナーを追加
  swipeContainer.addEventListener('touchstart', touchStartHandler, { passive: true });
  swipeContainer.addEventListener('touchend', touchEndHandler, { passive: true });
  swipeContainer.addEventListener('touchcancel', touchCancelHandler, { passive: true });

  // フッター要素にも同じイベントリスナーを追加（余白部分でもスワイプ可能にする）
  const footer = document.querySelector('.footer');
  if (footer) {
    footer.addEventListener('touchstart', touchStartHandler, { passive: true });
    footer.addEventListener('touchend', touchEndHandler, { passive: true });
    footer.addEventListener('touchcancel', touchCancelHandler, { passive: true });
  }
}
