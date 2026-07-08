// ============================================================================
// サービスワーカー（nokakoi用）
// バージョン管理によるキャッシュバスティング
// ============================================================================

// バージョンは app/js/version.js で一元管理
// サービスワーカー用にここにもコピー（リリース時は手動で更新・version.jsと一致させること）
const CACHE_VERSION = 'v1.87.1';
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
  '/app/',
  '/app/index.html',
  '/app/style.css',
  '/app/manifest.json',
  '/app/icon/nokakoi-192.png',
  '/app/icon/nokakoi-512.png',
  '/app/icon/nokakoi.png',
  '/app/icon/more.png',
  '/app/icon/note.png',
  '/app/icon/reload.png',
  '/app/icon/reply.png',
  '/app/icon/repost.png',
  '/app/icon/star.png',
  '/app/icon/up.png',
  // JS Modules
  '/app/js/main.js',
  '/app/js/actions.js',
  '/app/js/auth.js',
  '/app/js/channel.js',
  '/app/js/composer-scroll.js',
  '/app/js/composer.js',
  '/app/js/constants.js',
  '/app/js/crypto.js',
  '/app/js/custom-emoji-store.js',
  '/app/js/debug.js',
  '/app/js/ehagaki-autoclose.js',
  '/app/js/emoji-shortcode-suggest.js',
  '/app/js/event-modal.js',
  '/app/js/feed-fetcher.js',
  '/app/js/feed-renderer.js',
  '/app/js/global-relay.js',
  '/app/js/i18n.js',
  '/app/js/notification.js',
  '/app/js/json-modal.js',
  '/app/js/keyboard-shortcuts.js',
  '/app/js/markdown.js',
  '/app/js/media-viewer.js',
  '/app/js/modals.js',
  '/app/js/mute.js',
  '/app/js/nip46.js',
  '/app/js/nostr-compat.js',
  '/app/js/postlink.js',
  '/app/js/profile-modal.js',
  '/app/js/profile.js',
  '/app/js/relay-settings.js',
  '/app/js/relay.js',
  '/app/js/renderer.js',
  '/app/js/scroll-to-top.js',
  '/app/js/settings.js',
  '/app/js/state.js',
  '/app/js/tab-swipe.js',
  '/app/js/ui-setup.js',
  '/app/js/url-parser.js',
  '/app/js/utils.js',
  '/app/js/version.js',
  '/app/js/webauthn.js',
  // i18n JSONs
  '/app/i18n/ja.json',
  '/app/i18n/en.json'
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
