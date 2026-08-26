import { POSTLINK_DEFAULT_TITLE, POSTLINK_DEFAULT_URL, EVENTLINK_DEFAULT_TITLE, EVENTLINK_DEFAULT_URL, MAX_PREVIEW_LENGTH, setEventsMax } from '../config/constants.js';
import { DEFAULT_NIP46_RELAYS } from './nip46.js';
import { getDefaultGlobalRelayByLang } from './relay.js';

/**
 * アプリ設定・ユーザーリアクション管理
 */
export class SettingsManager {
  constructor() {
    this.activePubkey = (typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : null)?.toLowerCase() || null;
    this.settings = this.load();
    // 過去に appSettings へ混在していた NIP-46 鍵を専用キーへ移行して除去
    this._purgeLegacyNip46LocalSecretKey();
    if (this.settings && this.settings.maxEvents) {
      try { setEventsMax(this.settings.maxEvents); } catch (e) {}
    }
  }

  /**
   * デフォルト設定オブジェクトを返す
   */
  getDefaultSettings() {
    return {
      nwcUri: null,
      reactionDefault: '+',
      preferredSigner: null,
      encryptedNsec: null,
      globalRelay: getDefaultGlobalRelayByLang(),
      globalMergeHome: false,
      simpleDisplayMode: true,
      famicomMode: false,
      showAvatars: true,
      showTimelineMedia: false,
      showClientName: true,
      attachClientName: true,
      alwaysUseNip22Comment: false,
      clientName: 'nokakoi',
      passkeyCredentialId: null,
      passkeyEncryptedNsec: null,
      passkeyDeviceInfo: null,
      theme: 'system',
      colorTheme: 'gray',
      bgBrightness: 100,
      bgBrightness_light: 100,
      bgBrightness_dark: 100,
      postLinkUrl: POSTLINK_DEFAULT_URL,
      postLinkTitle: POSTLINK_DEFAULT_TITLE,
      postLinkOpenInNewTab: false,
      eventLinkUrl: EVENTLINK_DEFAULT_URL,
      eventLinkTitle: EVENTLINK_DEFAULT_TITLE,
      showHomeOmochat: true,
      showHomeReactions: false,
      showHomeChannel: false,
      showHomeRepost16: false,
      disableBlink: false,
      mentionNotificationMode: 'off',
      fetchFollowEmoji: false,
      showReceivedDelta: true,
      showProfileReactions: false,
      showProfileChannel: false,
      showProfileRepost16: false,
      showProfileBanner: false,
      showMusicStatus: true,
      showOmochat: true,
      tabs_v2: null,
      omochatGeohash: 'xn',
      omochatSubordinate: true,
      omochatGeohashHistory: [],
      omochatAutoRelays: true,
      omochatAutoRelayAlgo: 'merged',
      omochatMergeParent: true,
      omochatComputedRelays: [],
      nip46Relays: DEFAULT_NIP46_RELAYS.slice(),
      previewMaxLength: MAX_PREVIEW_LENGTH,
      useDomPurge: false,
      maxEvents: 500,
      nip46RemotePubkey: null,
      nip46Secret: null,
      nip46PasskeyCredentialId: null,
      nip46PasskeyDeviceInfo: null
    };
  }

  /**
   * localStorageから設定を読み込む
   */
  load() {
    const defaults = this.getDefaultSettings();
    try {
      const raw = localStorage.getItem('appSettings');
      const obj = raw ? JSON.parse(raw) : {};
      return { ...defaults, ...(obj || {}) };
    } catch {
      return defaults;
    }
  }

  /**
   * 設定をlocalStorageに保存
   */
  save() {
    try {
      const toSave = { ...(this.settings || {}) };
      // NIP-46 ローカル通信鍵は専用キーで管理（appSettings には混ぜない）
      delete toSave.nip46LocalSecretKey;
      localStorage.setItem('appSettings', JSON.stringify(toSave));
    } catch (e) {
      console.warn('[Settings] 設定保存失敗:', e);
    }
  }

  /**
   * 現在の設定をアカウント別キーに退避
   */
  saveForAccount(pubkey) {
    if (!pubkey) return;
    const pk = pubkey.toLowerCase();
    // メモリ上のアクティブpubkeyと異なるアカウントへの保存要求はデータ破壊を防ぐためブロック（アクティブ時のみ同期保存）
    if (this.activePubkey && this.activePubkey !== pk) {
      console.warn(`[Settings] 別アカウント (${pk}) への設定誤上書きをブロックしました (現在のActive: ${this.activePubkey})`);
      return;
    }
    try {
      const toSave = { ...(this.settings || {}) };
      delete toSave.nip46LocalSecretKey;
      localStorage.setItem(`appSettings.${pk}`, JSON.stringify(toSave));
      this.save();
    } catch (e) {
      console.warn('[Settings] アカウント別設定保存失敗:', e);
    }
  }

  /**
   * アカウント別キーから設定を復元し、appSettingsにも反映
   */
  loadForAccount(pubkey) {
    const defaults = this.getDefaultSettings();
    if (!pubkey) {
      this.activePubkey = null;
      this.settings = defaults;
      this.save();
      return;
    }
    const pk = pubkey.toLowerCase();
    this.activePubkey = pk;
    try {
      const raw = localStorage.getItem(`appSettings.${pk}`);
      if (raw) {
        const obj = JSON.parse(raw);
        this.settings = { ...defaults, ...obj };
      } else {
        // 新規アカウント（個別保存が存在しない場合）：
        // 前のアカウントの情報が残らないよう、100%デフォルト初期値で構成
        this.settings = { ...defaults };
      }
      this.save();
      localStorage.setItem(`appSettings.${pk}`, JSON.stringify(this.settings));
    } catch (e) {
      console.warn('[Settings] アカウント別設定読み込み失敗:', e);
      this.settings = defaults;
    }
  }

  /**
   * アカウント別の設定を削除
   */
  removeForAccount(pubkey) {
    if (!pubkey) return;
    try {
      localStorage.removeItem(`appSettings.${pubkey.toLowerCase()}`);
    } catch (e) {
      console.warn('[Settings] アカウント別設定削除失敗:', e);
    }
  }

  /**
   * 旧版で appSettings に混在していた NIP-46 ローカル鍵を専用キーへ移行して除去
   */
  _purgeLegacyNip46LocalSecretKey() {
    try {
      if (this.settings && Object.prototype.hasOwnProperty.call(this.settings, 'nip46LocalSecretKey')) {
        delete this.settings.nip46LocalSecretKey;
        this.save();
      }
    } catch (e) { }
  }

  /**
   * 設定値を取得
   */
  get(key) {
    if (!this.settings) return null;
    return this.settings[key];
  }

  /**
   * 生のストレージ値を取得（デフォルト補完を適用しない）
   */
  getRaw(key) {
    try {
      const raw = localStorage.getItem('appSettings');
      const obj = raw ? JSON.parse(raw) : {};
      return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * localStorage にキーが存在するか（値が null でも true）
   */
  hasRaw(key) {
    try {
      const raw = localStorage.getItem('appSettings');
      const obj = raw ? JSON.parse(raw) : {};
      return Object.prototype.hasOwnProperty.call(obj, key);
    } catch (e) {
      return false;
    }
  }

  /**
   * 設定値をセットして保存
   */
  set(key, value) {
    this.settings[key] = value;
    this.save();
    const activePk = (typeof window !== 'undefined' && window.__nostrState && window.__nostrState.pubkey) ||
                     (typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : null);
    if (activePk) {
      this.saveForAccount(activePk);
    }
    if (key === 'maxEvents') {
      try { setEventsMax(value); } catch (e) {}
    }
  }

  /**
   * イベントごとのユーザーリアクション取得
   */
  getUserReaction(eventId, pubkey) {
    try {
      const activePk = pubkey || localStorage.getItem('pubkey');
      const key = activePk ? `userReactions.${activePk.toLowerCase()}` : 'userReactions';
      const reactions = JSON.parse(localStorage.getItem(key) || '{}');
      return reactions[eventId] || null;
    } catch {
      return null;
    }
  }

  /**
   * イベントごとのユーザーリアクション保存
   * localStorage肥大化防止のため最新1000件のみ保持
   */
  saveUserReaction(eventId, reaction, pubkey) {
    try {
      const activePk = pubkey || localStorage.getItem('pubkey');
      const key = activePk ? `userReactions.${activePk.toLowerCase()}` : 'userReactions';
      const reactions = JSON.parse(localStorage.getItem(key) || '{}');
      reactions[eventId] = reaction;

      const entries = Object.entries(reactions);
      let toSave = reactions;
      if (entries.length > 1000) {
        toSave = Object.fromEntries(entries.slice(-1000));
      }
      localStorage.setItem(key, JSON.stringify(toSave));
    } catch (e) {
      console.warn('[Settings] リアクション保存失敗:', e);
    }
  }
}
