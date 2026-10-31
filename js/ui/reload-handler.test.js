// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const restartFeedsMock = vi.fn();
vi.mock('../features/timeline/feed-manager.js', () => ({
  restartFeeds: (...args) => restartFeedsMock(...args),
  setupGlobalFeed: vi.fn()
}));

vi.mock('../core/relay.js', () => ({
  loadRelays: vi.fn(() => [])
}));

vi.mock('../features/profile/profile.js', () => ({
  initializeProfileCache: vi.fn()
}));

vi.mock('../utils/utils.js', () => ({
  showToast: vi.fn()
}));

vi.mock('../utils/i18n.js', () => ({
  t: (key) => key === 'loading' ? '読み込み中...' : key
}));

import { isFeedLoading, setupReloadHandler } from './reload-handler.js';

describe('reload-handler isFeedLoading and guard', () => {
  let mockState;
  let mockSettingsManager;

  beforeEach(() => {
    vi.useFakeTimers();
    restartFeedsMock.mockClear();
    window.__nokakoiSoftReloading = false;
    window.__nokakoiSoftReloadLast = undefined;
    document.body.innerHTML = `
      <div id="feeds">
        <div class="feed active" id="feed-global"></div>
      </div>
    `;
    mockState = { relays: [] };
    mockSettingsManager = { get: vi.fn() };
    setupReloadHandler(mockState, mockSettingsManager);
  });

  it('returns true when active feed has loading placeholder', () => {
    const feed = document.getElementById('feed-global');
    feed.innerHTML = '<div class="muted p-12 text-center">読み込み中...</div>';

    expect(isFeedLoading()).toBe(true);
  });

  it('returns true when active feed has channel fetching placeholder', () => {
    const feed = document.getElementById('feed-global');
    feed.innerHTML = '<div class="muted p-12 text-center">メッセージを取得中...</div>';

    expect(isFeedLoading()).toBe(true);
  });

  it('returns false when feed has events and no loading placeholder', () => {
    const feed = document.getElementById('feed-global');
    feed.innerHTML = '<div class="event">Content</div>';

    expect(isFeedLoading()).toBe(false);
  });

  it('suppresses window.softReload when active feed is currently loading', () => {
    const feed = document.getElementById('feed-global');
    feed.innerHTML = '<div class="muted p-12 text-center">読み込み中...</div>';

    window.softReload();
    vi.advanceTimersByTime(500);

    expect(restartFeedsMock).not.toHaveBeenCalled();
  });

  it('suppresses softReloadRequest event when active feed is currently loading', () => {
    const feed = document.getElementById('feed-global');
    feed.innerHTML = '<div class="muted p-12 text-center">メッセージを取得中...</div>';

    window.dispatchEvent(new CustomEvent('softReloadRequest'));
    vi.advanceTimersByTime(500);

    expect(restartFeedsMock).not.toHaveBeenCalled();
  });

  it('allows softReload when feed is not in loading state', () => {
    const feed = document.getElementById('feed-global');
    feed.innerHTML = '<div class="event">Existing post</div>';

    window.softReload();
    vi.advanceTimersByTime(300);

    expect(restartFeedsMock).toHaveBeenCalledWith(true);
  });

  it('allows softReload in channel tab when chat messages are loaded even if channelListStatus is loading', () => {
    document.body.innerHTML = `
      <div id="feeds">
        <div class="feed active" id="feed-channels">
          <div class="channel-portal-wrapper show-chat">
            <div class="channel-sidebar">
              <div class="channel-list-status" id="channelListStatus">チャンネル一覧を読み込み中...</div>
            </div>
            <div class="channel-main-view">
              <div class="channel-chat-container">
                <div class="channel-messages" id="channelMessages">
                  <div class="event">Channel message</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    expect(isFeedLoading()).toBe(false);

    window.softReload();
    vi.advanceTimersByTime(300);

    expect(restartFeedsMock).toHaveBeenCalledWith(true);
  });

  it('suppresses softReload in channel tab when chat messages are currently loading', () => {
    document.body.innerHTML = `
      <div id="feeds">
        <div class="feed active" id="feed-channels">
          <div class="channel-portal-wrapper show-chat">
            <div class="channel-sidebar">
              <div class="channel-list-status" id="channelListStatus">参加中: 5件</div>
            </div>
            <div class="channel-main-view">
              <div class="channel-chat-container">
                <div class="channel-messages" id="channelMessages">
                  <div class="muted p-12 text-center">メッセージを取得中...</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    expect(isFeedLoading()).toBe(true);

    window.softReload();
    vi.advanceTimersByTime(300);

    expect(restartFeedsMock).not.toHaveBeenCalled();
  });
});
