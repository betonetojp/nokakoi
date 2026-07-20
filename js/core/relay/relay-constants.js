/**
 * デフォルトのリレーリスト（読込/書込フラグ付き）
 */
export const defaultRelays = [
  { url: 'wss://relay.damus.io', read: true, write: true },
  { url: 'wss://yabu.me', read: true, write: true }
];

export const profileIndexerRelay = 'wss://directory.yabu.me';
