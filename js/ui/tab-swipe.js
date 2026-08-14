// ============================================================================
// タブスワイプハンドラ
// ============================================================================

/**
 * タブ切り替え用スワイプジェスチャーのセットアップ
 */
export function setupTabSwipe() {
  if (typeof document === 'undefined') return;

  let touchStartX = 0;
  let touchEndX = 0;
  let touchStartY = 0;
  let touchEndY = 0;
  let touchStartTime = 0;
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
    touchStartX = 0;
    touchStartY = 0;
    handled = false;

    const target = e.target;
    if (!target) return;

    // モーダル内、カスタム絵文字サジェスト、タブバー、レンジ入力は除外
    if (target.closest('.modal, .emoji-shortcode-suggest, .tabs, .tabs-scroller, input[type="range"]')) {
      return;
    }

    // 横スクロール専用要素内（コードブロック等）でのタッチを除外（縦スクロールコンテナや入力欄は除外しない）
    let parent = target;
    while (parent && parent !== document.body) {
      try {
        const style = window.getComputedStyle(parent);
        const isHorizontalScroll = (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
                                   (style.overflowY !== 'auto' && style.overflowY !== 'scroll') &&
                                   (parent.scrollWidth - parent.clientWidth > 20);
        if (isHorizontalScroll) {
          return;
        }
      } catch (err) {}
      parent = parent.parentElement;
    }

    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    touchStartTime = Date.now();
  };

  const touchEndHandler = (e) => {
    if (handled) return;

    // タッチ開始座標が未設定の場合はスキップ
    if (touchStartX === 0 && touchStartY === 0) return;

    // タッチ時間が長い（350ms超）場合は長押し・テキスト選択ドラッグとみなしてキャンセル
    const touchDuration = Date.now() - touchStartTime;
    if (touchDuration > 350) {
      touchStartX = 0;
      touchStartY = 0;
      return;
    }

    // テキスト選択範囲が存在する場合はキャンセル
    const selection = window.getSelection();
    if (selection && (selection.type === 'Range' || selection.toString().length > 0)) {
      touchStartX = 0;
      touchStartY = 0;
      return;
    }

    handled = true;
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleSwipe();

    // 座標をリセット
    touchStartX = 0;
    touchStartY = 0;
  };

  const touchCancelHandler = () => {
    handled = true;
    touchStartX = 0;
    touchStartY = 0;
  };

  // documentにイベントリスナーを追加
  document.addEventListener('touchstart', touchStartHandler, { passive: true });
  document.addEventListener('touchend', touchEndHandler, { passive: true });
  document.addEventListener('touchcancel', touchCancelHandler, { passive: true });

  return () => {
    document.removeEventListener('touchstart', touchStartHandler);
    document.removeEventListener('touchend', touchEndHandler);
    document.removeEventListener('touchcancel', touchCancelHandler);
  };
}
