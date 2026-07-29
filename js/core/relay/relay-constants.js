/**
 * デフォルトのリレーリスト（読込/書込フラグ付き）
 */
export const defaultIntlRelayUrl = 'wss://nos.lol';
export const defaultJaRelayUrl = 'wss://yabu.me';

export const defaultRelays = [
  { url: defaultIntlRelayUrl, read: true, write: true },
  { url: defaultJaRelayUrl, read: true, write: true }
];

export const profileIndexerRelay = 'wss://directory.yabu.me';
