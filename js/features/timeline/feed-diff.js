// ============================================================================
// フィードDOMキー付き差分更新（Keyed Reconciliation）
// ============================================================================

/**
 * 既存のDOM要素を再利用しながら、eventsToRenderの順序に合わせてDOMを同期する。
 * 全件再生成（innerHTML = ''）を回避し、既存ノードやスクロール位置を保持する。
 *
 * @param {Object} params
 * @param {HTMLElement} params.container フィードコンテナ (.feed)
 * @param {Array<Object>} params.eventsToRender 描画すべきイベントオブジェクト配列
 * @param {Function} params.buildNode イベントノード生成関数 (eventObj, feedId) => HTMLElement|null
 * @param {string} [params.feedId] フィードID
 * @param {IntersectionObserver} [params.obs] DOMパージ等のオブザーバー
 * @param {HTMLElement} [params.bottomBar] ページネーション読み込みボタン
 * @param {HTMLElement} [params.scrollSentinel] 無限スクロール用センチネル
 * @param {boolean} [params.animateNewItems=false] 先頭に追加される新着要素にアニメーションを付与するか
 * @returns {{ modified: boolean, prependedCount: number, appendedCount: number, removedCount: number }}
 */
export function reconcileFeedDom({
  container,
  eventsToRender = [],
  buildNode,
  feedId = 'global',
  obs = null,
  bottomBar = null,
  scrollSentinel = null,
  animateNewItems = false
}) {
  if (!container) {
    return { modified: false, prependedCount: 0, appendedCount: 0, removedCount: 0 };
  }

  // ノード整列中に邪魔にならないよう、既存のボトムコントロールを取り外す（末尾配置は syncBottomControls で行う）
  const oldSentinels = Array.from(container.querySelectorAll('.feed-scroll-sentinel'));
  for (const s of oldSentinels) {
    s.remove();
  }
  const oldBottomBars = Array.from(container.querySelectorAll('.feed-bar-bottom'));
  for (const b of oldBottomBars) {
    b.remove();
  }

  const existingNodes = Array.from(container.querySelectorAll('.event'));
  const domMap = new Map();
  const domIds = [];

  for (const node of existingNodes) {
    const id = node.dataset ? node.dataset.eventId : null;
    if (id && !domMap.has(id)) {
      domMap.set(id, node);
      domIds.push(id);
    } else if (id && domMap.has(id)) {
      // 重複要素は安全に破棄
      if (obs) {
        try { obs.unobserve(node); } catch (e) { }
      }
      node.remove();
    }
  }

  const renderIds = eventsToRender.map(e => (e && e.id) ? e.id : '').filter(Boolean);

  // 1. 完全一致 (noop)
  if (domIds.length === renderIds.length && domIds.every((id, i) => id === renderIds[i])) {
    syncBottomControls(container, scrollSentinel, bottomBar);
    return { modified: false, prependedCount: 0, appendedCount: 0, removedCount: 0 };
  }

  // 2. 先頭追加のみ (prepend)
  const firstDomId = domIds[0];
  const firstDomIdxInRender = firstDomId ? renderIds.indexOf(firstDomId) : -1;
  const isPrependOnly = firstDomIdxInRender > 0
    && domIds.length === (renderIds.length - firstDomIdxInRender)
    && domIds.every((id, i) => renderIds[firstDomIdxInRender + i] === id);

  if (isPrependOnly) {
    const anchorNode = existingNodes[0];
    let inserted = 0;
    for (let i = firstDomIdxInRender - 1; i >= 0; i--) {
      const ev = eventsToRender[i];
      const node = buildNode(ev, feedId);
      if (node) {
        if (animateNewItems) {
          node.classList.add('event-slide-in');
        }
        container.insertBefore(node, anchorNode);
        if (obs) {
          try { obs.observe(node); } catch (e) { }
        }
        inserted++;
      }
    }
    syncBottomControls(container, scrollSentinel, bottomBar);
    return { modified: true, prependedCount: inserted, appendedCount: 0, removedCount: 0 };
  }

  // 3. 末尾追加のみ (append)
  const isAppendOnly = domIds.length > 0
    && renderIds.length > domIds.length
    && domIds.every((id, i) => renderIds[i] === id);

  if (isAppendOnly) {
    let inserted = 0;
    for (let i = domIds.length; i < renderIds.length; i++) {
      const ev = eventsToRender[i];
      const node = buildNode(ev, feedId);
      if (node) {
        container.appendChild(node);
        if (obs) {
          try { obs.observe(node); } catch (e) { }
        }
        inserted++;
      }
    }
    syncBottomControls(container, scrollSentinel, bottomBar);
    return { modified: true, prependedCount: 0, appendedCount: inserted, removedCount: 0 };
  }

  // 4. 先頭追加 + 末尾トリム (prepend + trim, 500件上限でのリアルタイム受信)
  const isPrependWithTrim = firstDomIdxInRender > 0
    && renderIds.length <= domIds.length
    && renderIds.slice(firstDomIdxInRender).every((id, i) => domIds[i] === id);

  if (isPrependWithTrim) {
    const anchorNode = existingNodes[0];
    let inserted = 0;
    for (let i = firstDomIdxInRender - 1; i >= 0; i--) {
      const ev = eventsToRender[i];
      const node = buildNode(ev, feedId);
      if (node) {
        if (animateNewItems) {
          node.classList.add('event-slide-in');
        }
        container.insertBefore(node, anchorNode);
        if (obs) {
          try { obs.observe(node); } catch (e) { }
        }
        inserted++;
      }
    }

    // 末尾からあふれたノードを削除
    const keepCountInExisting = renderIds.length - firstDomIdxInRender;
    let removed = 0;
    for (let i = keepCountInExisting; i < domIds.length; i++) {
      const nodeToRemove = domMap.get(domIds[i]);
      if (nodeToRemove) {
        if (obs) {
          try { obs.unobserve(nodeToRemove); } catch (e) { }
        }
        nodeToRemove.remove();
        removed++;
      }
    }
    syncBottomControls(container, scrollSentinel, bottomBar);
    return { modified: true, prependedCount: inserted, appendedCount: 0, removedCount: removed };
  }

  // 5. 一般ケース (時系列の途中挿入、削除、並び替え等)
  const renderIdSet = new Set(renderIds);
  let removedCount = 0;

  // 描画対象にない既存ノードを削除
  for (const [id, node] of domMap.entries()) {
    if (!renderIdSet.has(id)) {
      if (obs) {
        try { obs.unobserve(node); } catch (e) { }
      }
      node.remove();
      domMap.delete(id);
      removedCount++;
    }
  }

  // 順序を揃えつつ不足ノードを挿入
  let prependedCount = 0;
  let appendedCount = 0;

  for (let i = 0; i < eventsToRender.length; i++) {
    const ev = eventsToRender[i];
    if (!ev || !ev.id) continue;
    const id = ev.id;
    let node = domMap.get(id);

    if (!node) {
      node = buildNode(ev, feedId);
      if (!node) continue;
      if (i === 0 && animateNewItems) {
        node.classList.add('event-slide-in');
      }
      if (obs) {
        try { obs.observe(node); } catch (e) { }
      }
      if (i === 0) prependedCount++;
      else appendedCount++;
      domMap.set(id, node);
    }

    // 正しい位置にノードを挿入
    const currentNodes = container.querySelectorAll('.event');
    const currentNodeAtIndex = currentNodes[i] || null;

    if (currentNodeAtIndex !== node) {
      if (currentNodeAtIndex) {
        container.insertBefore(node, currentNodeAtIndex);
      } else {
        container.appendChild(node);
      }
    }
  }

  syncBottomControls(container, scrollSentinel, bottomBar);
  return { modified: true, prependedCount, appendedCount, removedCount };
}

/** 先行読み込みを発火させる「末尾からのイベント件数」（高速スクロールでも間に合うよう余裕を持たせる） */
export const PRELOAD_EVENT_OFFSET = 20;

/**
 * センチネルとボトムバーの位置を整え、余分なものは確実に削除する。
 * センチネルは末尾から一定件数（PRELOAD_EVENT_OFFSET件）手前のイベント直前に挿入することで、
 * 最下部に到達する前に先行して次ページを自動読み込みする。
 */
function syncBottomControls(container, scrollSentinel, bottomBar) {
  const existingSentinels = Array.from(container.querySelectorAll('.feed-scroll-sentinel'));
  for (const s of existingSentinels) {
    if (s !== scrollSentinel) s.remove();
  }

  const existingBottomBars = Array.from(container.querySelectorAll('.feed-bar-bottom'));
  for (const b of existingBottomBars) {
    if (b !== bottomBar) b.remove();
  }

  if (bottomBar) {
    container.appendChild(bottomBar);
  }

  if (scrollSentinel) {
    const events = container.querySelectorAll('.event');
    if (events.length >= PRELOAD_EVENT_OFFSET) {
      const targetIndex = events.length - PRELOAD_EVENT_OFFSET;
      container.insertBefore(scrollSentinel, events[targetIndex]);
    } else if (bottomBar) {
      container.insertBefore(scrollSentinel, bottomBar);
    } else {
      container.appendChild(scrollSentinel);
    }
  }
}
