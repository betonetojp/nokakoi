// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTabSwipe } from './tab-swipe.js';

describe('setupTabSwipe', () => {
  let cleanup;

  beforeEach(() => {
    // 画面幅とスクロール設定のモック
    window.innerWidth = 375;
    window.scrollTo = vi.fn();

    document.body.innerHTML = `
      <div class="tabs">
        <div class="tabs-scroller">
          <button type="button" class="tab active" id="tab-home">ホーム</button>
          <button type="button" class="tab" id="tab-global">グローバル</button>
          <button type="button" class="tab" id="tab-channels">チャンネル</button>
        </div>
      </div>
      <div id="feed-channels" class="feed">
        <div class="channel-portal-wrapper">
          <div class="channel-sidebar" id="channelSidebar">
            <div class="channel-list" id="channelList">
              <div class="channel-list-item-row">
                <button type="button" class="channel-list-item" id="channelItemBtn">
                  <span class="channel-item-name"># test-channel</span>
                </button>
              </div>
            </div>
            <div class="channel-join-box">
              <input type="text" id="channelSearchInput" class="channel-id-input" placeholder="検索">
              <button type="button" id="channelSearchBtn">検索</button>
            </div>
            <div class="channel-search-results" id="channelSearchResults">
              <div class="channel-search-result-item" id="searchResultRow">
                <div class="channel-search-result-name"># found-channel</div>
                <button type="button" id="searchResultAddBtn">追加</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal" id="testModal">
        <div class="modal-content">
          <button type="button" id="modalBtn">モーダルボタン</button>
        </div>
      </div>
      <input type="range" id="testRange" min="0" max="100">
    `;

    cleanup = setupTabSwipe();
  });

  afterEach(() => {
    if (typeof cleanup === 'function') cleanup();
    vi.restoreAllMocks();
  });

  function simulateTouchSwipe(targetEl, { startX, startY, endX, endY, durationMs = 100 }) {
    const startTime = Date.now();
    const touchStart = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(touchStart, 'changedTouches', {
      value: [{ screenX: startX, screenY: startY }]
    });
    Object.defineProperty(touchStart, 'target', { value: targetEl });
    targetEl.dispatchEvent(touchStart);

    vi.spyOn(Date, 'now').mockReturnValue(startTime + durationMs);

    const touchEnd = new Event('touchend', { bubbles: true, cancelable: true });
    Object.defineProperty(touchEnd, 'changedTouches', {
      value: [{ screenX: endX, screenY: endY }]
    });
    Object.defineProperty(touchEnd, 'target', { value: targetEl });
    document.dispatchEvent(touchEnd);
  }

  it('switches to next tab when swiping left on channel list item', () => {
    const globalTab = document.getElementById('tab-global');
    const clickSpy = vi.fn();
    globalTab.addEventListener('click', clickSpy);

    const channelItem = document.getElementById('channelItemBtn');
    simulateTouchSwipe(channelItem, { startX: 250, startY: 100, endX: 50, endY: 105, durationMs: 150 });

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('switches to previous tab (looping) when swiping right on channel search input', () => {
    const channelsTab = document.getElementById('tab-channels');
    const clickSpy = vi.fn();
    channelsTab.addEventListener('click', clickSpy);

    const searchInput = document.getElementById('channelSearchInput');
    simulateTouchSwipe(searchInput, { startX: 50, startY: 100, endX: 250, endY: 105, durationMs: 150 });

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('switches tab when swiping on channel search results', () => {
    const globalTab = document.getElementById('tab-global');
    const clickSpy = vi.fn();
    globalTab.addEventListener('click', clickSpy);

    const searchResult = document.getElementById('searchResultRow');
    simulateTouchSwipe(searchResult, { startX: 250, startY: 100, endX: 50, endY: 105, durationMs: 150 });

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT switch tab when tapping (swipe distance is too small)', () => {
    const globalTab = document.getElementById('tab-global');
    const clickSpy = vi.fn();
    globalTab.addEventListener('click', clickSpy);

    const channelItem = document.getElementById('channelItemBtn');
    simulateTouchSwipe(channelItem, { startX: 200, startY: 100, endX: 205, endY: 102, durationMs: 50 });

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('does NOT switch tab when vertical movement exceeds limit', () => {
    const globalTab = document.getElementById('tab-global');
    const clickSpy = vi.fn();
    globalTab.addEventListener('click', clickSpy);

    const channelItem = document.getElementById('channelItemBtn');
    simulateTouchSwipe(channelItem, { startX: 250, startY: 100, endX: 50, endY: 200, durationMs: 150 });

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('does NOT switch tab when swiping inside a modal', () => {
    const globalTab = document.getElementById('tab-global');
    const clickSpy = vi.fn();
    globalTab.addEventListener('click', clickSpy);

    const modalBtn = document.getElementById('modalBtn');
    simulateTouchSwipe(modalBtn, { startX: 250, startY: 100, endX: 50, endY: 105, durationMs: 150 });

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('does NOT switch tab when swiping inside tabs scroller', () => {
    const globalTab = document.getElementById('tab-global');
    const clickSpy = vi.fn();
    globalTab.addEventListener('click', clickSpy);

    const tabHome = document.getElementById('tab-home');
    simulateTouchSwipe(tabHome, { startX: 250, startY: 100, endX: 50, endY: 105, durationMs: 150 });

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('does NOT stop touchend propagation to other document listeners', () => {
    const documentTouchEndSpy = vi.fn();
    document.addEventListener('touchend', documentTouchEndSpy);

    const channelItem = document.getElementById('channelItemBtn');
    simulateTouchSwipe(channelItem, { startX: 200, startY: 100, endX: 205, endY: 102, durationMs: 50 });

    expect(documentTouchEndSpy).toHaveBeenCalledTimes(1);
    document.removeEventListener('touchend', documentTouchEndSpy);
  });
});
