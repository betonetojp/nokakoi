// ============================================================================
// サービスワーカー（nokakoi用）
// バージョン管理によるキャッシュバスティング
// ============================================================================

// バージョンは app/js/version.js で一元管理
// サービスワーカー用にここにもコピー（リリース時は手動で更新・version.jsと一致させること）
const CACHE_VERSION = 'v1.95.1';
const CACHE_NAME = `nokakoi-${CACHE_VERSION}`;

// ローカル開発時のみ詳細ログを有効化
const SW_DEBUG = ['localhost', '127.0.0.1'].includes(self.location.hostname);
const SW_LOG_PREFIX = '[SW]';
function swLog(...args) {
  if (!SW_DEBUG) return;
  console.info(SW_LOG_PREFIX, ...args);
}
function swWarn(...args) {
  console.warn(SW_LOG_PREFIX, ...args);
}
function swError(...args) {
  console.error(SW_LOG_PREFIX, ...args);
}

// キャッシュ対象ファイル
const STATIC_ASSETS = [
  './',
  'index.html',
  'style.css',
  'manifest.json',
  'icon/nokakoi-192.png',
  'icon/nokakoi-512.png',
  'icon/nokakoi.png',
  'icon/more.png',
  'icon/note.png',
  'icon/reload.png',
  'icon/reply.png',
  'icon/repost.png',
  'icon/star.png',
  'icon/badge.png',
  'icon/up.png',
  // JS Modules
  'js/main.js',
  'js/actions.js',
  'js/auth.js',
  'js/channel.js',
  'js/composer-scroll.js',
  'js/composer.js',
  'js/constants.js',
  'js/crypto.js',
  'js/custom-emoji-store.js',
  'js/debug.js',
  'js/ehagaki-autoclose.js',
  'js/emoji-shortcode-suggest.js',
  'js/event-modal.js',
  'js/feed-fetcher.js',
  'js/feed-renderer.js',
  'js/global-relay.js',
  'js/i18n.js',
  'js/notification.js',
  'js/json-modal.js',
  'js/keyboard-shortcuts.js',
  'js/markdown.js',
  'js/media-viewer.js',
  'js/modals.js',
  'js/mute.js',
  'js/nip46.js',
  'js/nostr-compat.js',
  'js/postlink.js',
  'js/profile-modal.js',
  'js/profile.js',
  'js/relay-settings.js',
  'js/relay.js',
  'js/renderer.js',
  'js/scroll-to-top.js',
  'js/settings.js',
  'js/state.js',
  'js/tab-swipe.js',
  'js/ui-setup.js',
  'js/url-parser.js',
  'js/utils.js',
  'js/version.js',
  'js/webauthn.js',
  // i18n JSONs
  'i18n/ja.json',
  'i18n/en.json'
];

// インストール時 - 静的アセットをキャッシュ
self.addEventListener('install', (event) => {
  swLog('install', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        swLog('cache static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        return Promise.resolve();
      })
  );
});

// アクティベート時 - 古いキャッシュのみ削除
self.addEventListener('activate', (event) => {
  swLog('activate', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              swLog('delete old cache', cacheName);
              return caches.delete(cacheName);
            }
            return Promise.resolve();
          })
        );
      })
      .then(() => {
        swLog('old cache cleanup completed');
        return self.clients.claim();
      })
  );
});

// fetch時 - キャッシュ優先/ネットワーク優先の切り替え
self.addEventListener('fetch', (event) => {
  const { request } = event;
  try {
    const url = new URL(request.url);
    // 同一オリジンのみ処理
    if (url.origin !== location.origin) {
      return;
    }
    // GET以外はキャッシュしない
    if (request.method !== 'GET') {
      event.respondWith(fetch(request));
      return;
    }
    // HTML/CSS/JSは常にネットワーク優先（バージョン付きファイルはキャッシュしない）
    if (request.mode === 'navigate' || 
        url.pathname.endsWith('.css') || 
        url.pathname.endsWith('.js') ||
        url.search.includes('v=')) {
      event.respondWith(
        fetch(request, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        })
          .then((response) => {
            swLog('network fetch', url.pathname);
            return response;
          })
          .catch((err) => {
            swWarn('network failed, fallback to cache', url.pathname, err);
            return caches.match(request);
          })
      );
      return;
    }
    // 画像等はキャッシュ優先（バージョンパラメータなしのみ）
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // キャッシュになければネットワーク取得
          return fetch(request)
            .then((response) => {
              if (response && response.ok && response.status === 200) {
                const responseToCache = response.clone();
                caches.open(CACHE_NAME)
                  .then((cache) => {
                    cache.put(request, responseToCache);
                  })
                  .catch((err) => {
                    swWarn('cache.put failed', err);
                  });
              }
              return response;
            });
        })
    );
  } catch (err) {
    swError('fetch handler failed', err);
    event.respondWith(fetch(request));
  }
});

// メッセージイベント - 手動キャッシュ更新等
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            return caches.delete(cacheName);
          })
        );
      })
    );
  }
});
