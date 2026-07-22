// ============================================================================
// サービスワーカー（nokakoi用）
// バージョン管理によるキャッシュバスティング
// ============================================================================

// バージョンは js/config/version.js で一元管理
// (リリース時は `npm run version:update` で自動同期されます)
const CACHE_VERSION = 'v1.103.1';
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
            return caches.match(request).then((cached) => {
              if (cached) return cached;
              // navigate リクエストのオフラインフォールバック
              // （URL 不一致でキャッシュヒットしない場合に備える）
              if (request.mode === 'navigate') {
                return caches.match('index.html').then((fallback) => {
                  return fallback || caches.match('./');
                });
              }
              return cached;
            });
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
