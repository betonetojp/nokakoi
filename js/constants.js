// 共通定数（フィード・モーダルで共通利用）
export const EVENTS_TIMEOUT =5000; // ms - safety timeout for per-relay queries
export const EVENTS_FETCH_LIMIT =20; // 件数:1回のフェッチあたりの件数
export let EVENTS_MAX = 500; // 最大保持件数 / 表示件数
export function setEventsMax(val) {
  if (typeof val === 'number' && !isNaN(val) && val > 0) {
    EVENTS_MAX = val;
  }
}

// リレー接続・監視の既定値
export const RECONNECT_DELAY = 5000; // ms - 再接続の基本待機時間（指数バックオフの初期値）
export const MAX_RECONNECT_DELAY = 60000; // ms - 再接続の最大待機時間（指数バックオフの上限）
export const DOWN_PERSIST_MS = 5000; // ms - 切断状態が一定時間続いた場合のみ再接続を予約
export const KEEPALIVE_INTERVAL = 45000; // ms - WebSocket keepalive 送信間隔（リレーのアイドルタイムアウト防止）

// 購読スロットリング上限（リレーごと）
export const MAX_LIVE_PER_RELAY = 5; // リレーごとの同時Live購読数
export const MAX_ONESHOT_PER_RELAY = 1; // リレーごとの同時ワンショット購読数
export const MAX_TOTAL_SUB_PER_RELAY = 5; // リレーごとの同時合計購読上限（too many concurrent REQs 対策）

// Post-link（eHagaki）の既定値
export const POSTLINK_DEFAULT_TITLE = 'eHagaki';
export const POSTLINK_DEFAULT_URL = 'https://lokuyow.github.io/ehagaki/';

// プレビュー折りたたみの最大文字数（全体共通）
export const MAX_PREVIEW_LENGTH = 300;

// プレビュー折りたたみの最大行数
export const MAX_PREVIEW_LINES = 10;

// omochat (BitChat) デフォルトリレー
export const DEFAULT_OMOCHAT_RELAYS = [
  // --- iOS/Androidアプリのデフォルト（フォールバック）リレー ---
  'wss://relay.damus.io/',
  'wss://nos.lol/',
  'wss://relay.primal.net/',
  'wss://offchain.pub/',
  'wss://nostr21.com/', // Android用フォールバック

  // --- 地域・開発用カスタムリレー ---
  'wss://yabu.me/',
  'wss://staging.yabu.me/',
  'wss://nostr.middling.mydns.jp/',
  'wss://relay.homeinhk.xyz/',
  'wss://relay01.lnfi.network/',
  'wss://relay02.lnfi.network/',
  'wss://nostr.infero.net/'
];
