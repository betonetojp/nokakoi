// 新規リリース（デプロイ）時の古いキャッシュ等の影響で、動的モジュール(Chunk)の取得が404エラー（TypeError）になった場合、
// ページを自動で強制リロードして最新のアセットを読み込ませる
window.addEventListener('unhandledrejection', (event) => {
  const reasonStr = event.reason ? event.reason.toString() : '';
  if (reasonStr.includes('Failed to fetch dynamically imported module')) {
    console.warn('[Main] チャンクの読み込みに失敗しました。最新版取得のため強制再読み込みします...', event.reason);
    window.location.reload();
  }
});

import { initApp } from './core/bootstrap.js';

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
