import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RESUME_RESTART_MS } from '../../config/constants.js';

const mocks = vi.hoisted(() => ({
  getAllRelayUrls: vi.fn(() => ['wss://relay1.example', 'wss://relay2.example']),
  getRelayFromPool: vi.fn(),
  sanitizeRelayActiveCounts: vi.fn(),
  processSubscribeQueue: vi.fn()
}));

vi.mock('./relay-helpers.js', () => ({
  getAllRelayUrls: mocks.getAllRelayUrls
}));

vi.mock('./relay-connection.js', () => ({
  getRelayFromPool: mocks.getRelayFromPool
}));

vi.mock('./relay-subscription.js', () => ({
  sanitizeRelayActiveCounts: mocks.sanitizeRelayActiveCounts,
  processSubscribeQueue: mocks.processSubscribeQueue
}));

import {
  relayStates,
  updateRelayState,
  reconnectSingleRelay,
  scheduleReconnect,
  setupVisibilityHandler,
  removeVisibilityHandler
} from './relay-state.js';

describe('relay-state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    relayStates.clear();
    globalThis.WebSocket = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };
  });

  describe('reconnectSingleRelay', () => {
    it('calls pool.ensureRelay and updates relayState on success', async () => {
      const state = {
        pool: {
          ensureRelay: vi.fn().mockResolvedValue({
            ws: { readyState: WebSocket.OPEN }
          })
        }
      };

      const result = await reconnectSingleRelay(state, 'wss://relay1.example');
      expect(result).toBe(true);
      expect(state.pool.ensureRelay).toHaveBeenCalledWith('wss://relay1.example');
      expect(relayStates.get('wss://relay1.example')?.connected).toBe(true);
    });

    it('handles ensureRelay error gracefully without throwing', async () => {
      const state = {
        pool: {
          ensureRelay: vi.fn().mockRejectedValue(new Error('Connection failed'))
        }
      };

      const result = await reconnectSingleRelay(state, 'wss://relay1.example');
      expect(result).toBe(false);
      expect(relayStates.get('wss://relay1.example')?.connected).toBe(false);
    });
  });

  describe('scheduleReconnect', () => {
    it('attempts single relay reconnect instead of calling restartFeeds', async () => {
      const state = {
        pool: {
          ensureRelay: vi.fn().mockResolvedValue({
            ws: { readyState: WebSocket.OPEN }
          })
        }
      };
      const restartFeedsCallback = vi.fn();
      updateRelayState('wss://relay1.example', false);

      scheduleReconnect(state, 'wss://relay1.example', restartFeedsCallback);

      // タイマーを進める
      await vi.runOnlyPendingTimersAsync();

      expect(state.pool.ensureRelay).toHaveBeenCalledWith('wss://relay1.example');
      expect(restartFeedsCallback).not.toHaveBeenCalled();
    });
  });

  describe('setupVisibilityHandler', () => {
    it('does NOT trigger restartFeeds on short background duration (< 5 mins) even if a relay was disconnected', async () => {
      let visibilityListener = null;
      let hiddenValue = false;
      const documentMock = {
        get hidden() { return hiddenValue; },
        addEventListener: vi.fn((event, handler) => {
          if (event === 'visibilitychange') visibilityListener = handler;
        }),
        removeEventListener: vi.fn()
      };
      vi.stubGlobal('document', documentMock);

      const state = {
        relays: ['wss://relay1.example', 'wss://relay2.example'],
        pool: {
          relays: new Map(),
          ensureRelay: vi.fn().mockResolvedValue({
            ws: { readyState: WebSocket.OPEN }
          })
        }
      };

      // relay1 は切断中、relay2 は接続中
      mocks.getRelayFromPool.mockImplementation((pool, url) => {
        if (url === 'wss://relay1.example') return { ws: { readyState: WebSocket.CLOSED } };
        return { ws: { readyState: WebSocket.OPEN } };
      });

      const restartFeedsCallback = vi.fn();
      setupVisibilityHandler(state, restartFeedsCallback);

      // タブがバックグラウンドに回る
      hiddenValue = true;
      visibilityListener();

      // 10秒経過
      vi.advanceTimersByTime(10000);

      // タブがフォアグラウンドに復帰する
      hiddenValue = false;
      visibilityListener();

      // 短時間なのでフィード再起動は呼ばれず、切断リレーの単体再接続が試行される
      await vi.advanceTimersByTimeAsync(1000);

      expect(restartFeedsCallback).not.toHaveBeenCalled();
      expect(state.pool.ensureRelay).toHaveBeenCalledWith('wss://relay1.example');

      removeVisibilityHandler(state);
      vi.unstubAllGlobals();
    });

    it('triggers restartFeeds on long background duration (>= 5 mins)', async () => {
      let visibilityListener = null;
      let hiddenValue = false;
      const documentMock = {
        get hidden() { return hiddenValue; },
        addEventListener: vi.fn((event, handler) => {
          if (event === 'visibilitychange') visibilityListener = handler;
        }),
        removeEventListener: vi.fn()
      };
      vi.stubGlobal('document', documentMock);

      const state = {
        relays: ['wss://relay1.example'],
        pool: {
          relays: new Map(),
          ensureRelay: vi.fn()
        }
      };

      mocks.getRelayFromPool.mockReturnValue({ ws: { readyState: WebSocket.OPEN } });

      const restartFeedsCallback = vi.fn();
      setupVisibilityHandler(state, restartFeedsCallback);

      // タブがバックグラウンドに回る
      hiddenValue = true;
      visibilityListener();

      // 5分（RESUME_RESTART_MS）以上経過
      vi.advanceTimersByTime(RESUME_RESTART_MS + 1000);

      // タブがフォアグラウンドに復帰する
      hiddenValue = false;
      visibilityListener();

      // 500ms 後に restartFeeds が発火する
      await vi.advanceTimersByTimeAsync(600);

      expect(restartFeedsCallback).toHaveBeenCalledWith(false);

      removeVisibilityHandler(state);
      vi.unstubAllGlobals();
    });
  });
});
