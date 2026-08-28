/**
 * デフォルトのリレーリスト（読込/書込フラグ付き）
 */
export const defaultIntlRelayUrl = 'wss://nos.lol';
export const defaultJaRelayUrl = 'wss://relay-jp.nostr.wirednet.jp';

export const defaultRelays = [
  { url: defaultIntlRelayUrl, read: true, write: true },
  { url: defaultJaRelayUrl, read: true, write: true },
  { url: 'wss://yabu.me', read: true, write: true }
];

export const profileIndexerRelays = [
  'wss://directory.yabu.me',
];

/**
 * 言語に応じたデフォルトのグローバル選択リレーリストを返す（一元化関数）
 */
export function getDefaultGlobalRelayByLang() {
  const lang = (typeof localStorage !== 'undefined' && localStorage.getItem('lang')) ||
               (typeof navigator !== 'undefined' && navigator.language && navigator.language.startsWith('ja') ? 'ja' : 'en');
  return lang === 'ja' ? [defaultJaRelayUrl] : [defaultIntlRelayUrl];
}
