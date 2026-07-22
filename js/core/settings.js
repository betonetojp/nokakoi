import { POSTLINK_DEFAULT_TITLE, POSTLINK_DEFAULT_URL, EVENTLINK_DEFAULT_TITLE, EVENTLINK_DEFAULT_URL, MAX_PREVIEW_LENGTH, setEventsMax } from '../config/constants.js';
import { DEFAULT_NIP46_RELAYS } from './nip46.js';

/**
 * アプリ設定・ユーザーリアクション管理
 */
export class SettingsManager {
  constructor() {
    this.settings = this.load();
    if (this.settings && this.settings.maxEvents) {
      try { setEventsMax(this.settings.maxEvents); } catch (e) {}
    }
  }

  /**
   * localStorageから設定を読み込む
   */
  load() {
    try {
      const raw = localStorage.getItem('appSettings');
      const obj = raw ? JSON.parse(raw) : {};
      return {
        reactionDefault: (obj && obj.reactionDefault) || '+',
        preferredSigner: (obj && obj.preferredSigner) || null,
        encryptedNsec: (obj && obj.encryptedNsec) || null,
        globalRelay: (obj && obj.globalRelay) || null,
        // グローバルタブにホームタイムラインをマージするか
        globalMergeHome: (obj && typeof obj.globalMergeHome !== 'undefined') ? obj.globalMergeHome : false,
        // フィード投稿をコンパクト表示（選択時のみメタ情報・アクションを表示）
        simpleDisplayMode: (obj && typeof obj.simpleDisplayMode !== 'undefined') ? obj.simpleDisplayMode : true,
        showAvatars: (obj && obj.showAvatars !== undefined) ? obj.showAvatars : true,
        // タイムラインで inline media（images/videos）を既定で表示
        showTimelineMedia: (obj && obj.showTimelineMedia !== undefined) ? obj.showTimelineMedia : false,
        // kind ボタン横に client name バッジを表示
        showClientName: (obj && obj.showClientName !== undefined) ? obj.showClientName : true,
        // 投稿/返信/リポスト/リアクション送信時に client tag を付与
        attachClientName: (obj && obj.attachClientName !== undefined) ? obj.attachClientName : true,
        // 付与する既定の client name
        clientName: (obj && obj.clientName) || 'nokakoi',
        passkeyCredentialId: (obj && obj.passkeyCredentialId) || null,
        passkeyEncryptedNsec: (obj && obj.passkeyEncryptedNsec) || null,
        passkeyDeviceInfo: (obj && obj.passkeyDeviceInfo) || null,
        // 既定は 'system'（OS の配色に自動追従）
        theme: (obj && obj.theme) || 'system',
        colorTheme: (obj && obj.colorTheme) || 'gray',
                // post link 設定: 保存済み値を優先し、未保存なら妥当な既定値を使用
        postLinkUrl: (obj && typeof obj.postLinkUrl !== 'undefined') ? obj.postLinkUrl : POSTLINK_DEFAULT_URL,
        postLinkTitle: (obj && typeof obj.postLinkTitle !== 'undefined') ? obj.postLinkTitle : POSTLINK_DEFAULT_TITLE,
        // post-link を新規タブで開くか（boolean、既定 false）
        postLinkOpenInNewTab: (obj && typeof obj.postLinkOpenInNewTab !== 'undefined') ? obj.postLinkOpenInNewTab : false,
        // event link 設定
        eventLinkUrl: (obj && typeof obj.eventLinkUrl !== 'undefined') ? obj.eventLinkUrl : EVENTLINK_DEFAULT_URL,
        eventLinkTitle: (obj && typeof obj.eventLinkTitle !== 'undefined') ? obj.eventLinkTitle : EVENTLINK_DEFAULT_TITLE,
        // followee の kind:20000（omochat）を home feed に表示するか
        showHomeOmochat: (obj && typeof obj.showHomeOmochat !== 'undefined') ? obj.showHomeOmochat : true,
        // followee の kind:7 reactions を home feed に表示するか
        showHomeReactions: (obj && typeof obj.showHomeReactions !== 'undefined') ? obj.showHomeReactions : false,
        // followee の kind:42 channel posts を home feed に表示するか
        showHomeChannel: (obj && typeof obj.showHomeChannel !== 'undefined') ? obj.showHomeChannel : false,
        // followee の kind:16 generic reposts を home feed に表示するか
        showHomeRepost16: (obj && typeof obj.showHomeRepost16 !== 'undefined') ? obj.showHomeRepost16 : false,
        // 点滅通知を無効化（mention タブ点滅 + Top ボタン点滅）
        disableBlink: (obj && typeof obj.disableBlink !== 'undefined') ? obj.disableBlink : false,
        // メンションの OS 通知: 'off' | 'background'（非表示時のみ）
        mentionNotificationMode: (obj && obj.mentionNotificationMode === 'background') ? 'background' : 'off',
        // フォロイーの kind:10030 が参照する絵文字セット(kind:30030)も取得する
        fetchFollowEmoji: (obj && typeof obj.fetchFollowEmoji !== 'undefined') ? obj.fetchFollowEmoji : false,
        // live受信時の端末時計との差分を表示するか
        showReceivedDelta: (obj && typeof obj.showReceivedDelta !== 'undefined') ? obj.showReceivedDelta : true,
        // profile modal feed で kind:7 を取得するか
        showProfileReactions: (obj && typeof obj.showProfileReactions !== 'undefined') ? obj.showProfileReactions : false,
        // profile modal feed で kind:42 を取得するか
        showProfileChannel: (obj && typeof obj.showProfileChannel !== 'undefined') ? obj.showProfileChannel : false,
        // profile modal feed で kind:16 を取得するか
        showProfileRepost16: (obj && typeof obj.showProfileRepost16 !== 'undefined') ? obj.showProfileRepost16 : false,
        // profile modal で banner 画像を表示するか
        showProfileBanner: (obj && typeof obj.showProfileBanner !== 'undefined') ? obj.showProfileBanner : false,
        // music status（Now Playing）をインライン表示
        showMusicStatus: (obj && typeof obj.showMusicStatus !== 'undefined') ? obj.showMusicStatus : true,
        // omochat タブを表示
        showOmochat: (obj && typeof obj.showOmochat !== 'undefined') ? obj.showOmochat : true,
        // Tabs 設定（並び順と表示/非表示に対応した v2）
        tabs_v2: (obj && obj.tabs_v2) ? obj.tabs_v2 : null,
        // Omochat geohash
        omochatGeohash: (obj && obj.omochatGeohash) || 'xn',
        // Omochat subordinate オプション
        omochatSubordinate: (obj && typeof obj.omochatSubordinate !== 'undefined') ? obj.omochatSubordinate : true,
        // Omochat geohash 履歴
        omochatGeohashHistory: (obj && Array.isArray(obj.omochatGeohashHistory)) ? obj.omochatGeohashHistory : [],
        // Omochat relays
        omochatRelays: (obj && Array.isArray(obj.omochatRelays)) ? obj.omochatRelays : null,
        omochatAutoRelays: (obj && typeof obj.omochatAutoRelays !== 'undefined') ? obj.omochatAutoRelays : true,
        omochatAutoRelayAlgo: (obj && obj.omochatAutoRelayAlgo) || 'merged',
        omochatMergeParent: (obj && typeof obj.omochatMergeParent !== 'undefined') ? obj.omochatMergeParent : true,
        omochatComputedRelays: (obj && Array.isArray(obj.omochatComputedRelays)) ? obj.omochatComputedRelays : [],
        // NIP-46 Nostr Connect 設定
        nip46Relays: (obj && Array.isArray(obj.nip46Relays)) ? obj.nip46Relays : DEFAULT_NIP46_RELAYS.slice(),
        // プレビュー最大文字数
        previewMaxLength: (obj && typeof obj.previewMaxLength !== 'undefined') ? obj.previewMaxLength : MAX_PREVIEW_LENGTH,
        // 最大保持件数
        useDomPurge: (obj && typeof obj.useDomPurge !== 'undefined') ? obj.useDomPurge : false,
        maxEvents: (obj && typeof obj.maxEvents !== 'undefined') ? obj.maxEvents : 500,
        nip46LocalSecretKey: (obj && obj.nip46LocalSecretKey) || null,
        nip46RemotePubkey: (obj && obj.nip46RemotePubkey) || null,
        nip46Secret: (obj && obj.nip46Secret) || null
      };
    } catch {
      return {
        reactionDefault: '+',
        preferredSigner: null,
        encryptedNsec: null,
        globalRelay: null,
        globalMergeHome: false,
        simpleDisplayMode: true,
        showAvatars: true,
        showTimelineMedia: false,
        showClientName: true,
        attachClientName: true,
        clientName: 'nokakoi',
        passkeyCredentialId: null,
        passkeyEncryptedNsec: null,
        passkeyDeviceInfo: null,
        theme: 'system',
        colorTheme: 'gray',
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
        showProfileReactions: false,
        showProfileChannel: false,
        showProfileRepost16: false,
        showProfileBanner: false,
        showMusicStatus: true,
        showOmochat: true,
        tabs_v2: null,
        // Omochat geohash
        omochatGeohash: 'xn',
        // Omochat subordinate オプション
        omochatSubordinate: true,
        // Omochat geohash 履歴
        omochatGeohashHistory: [],
        omochatAutoRelays: true,
        omochatAutoRelayAlgo: 'merged',
        omochatMergeParent: true,
        omochatComputedRelays: [],
        // NIP-46 既定値
        nip46Relays: DEFAULT_NIP46_RELAYS.slice(),
        previewMaxLength: MAX_PREVIEW_LENGTH,
        useDomPurge: false,
        maxEvents: 500,
        nip46LocalSecretKey: null,
        nip46RemotePubkey: null,
        nip46Secret: null
      };
    }
  }

  /**
   * 設定をlocalStorageに保存
   */
  save() {
    try {
      localStorage.setItem('appSettings', JSON.stringify(this.settings || {}));
    } catch (e) {
      console.warn('[Settings] 設定保存失敗:', e);
    }
  }

  /**
   * 設定値を取得
   */
  get(key) {
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
    if (key === 'maxEvents') {
      try { setEventsMax(value); } catch (e) {}
    }
  }

  /**
   * イベントごとのユーザーリアクション取得
   */
  getUserReaction(eventId) {
    try {
      const reactions = JSON.parse(localStorage.getItem('userReactions') || '{}');
      return reactions[eventId] || null;
    } catch {
      return null;
    }
  }

  /**
   * イベントごとのユーザーリアクション保存
   * localStorage肥大化防止のため最新1000件のみ保持
   */
  saveUserReaction(eventId, reaction) {
    try {
      const reactions = JSON.parse(localStorage.getItem('userReactions') || '{}');
      reactions[eventId] = reaction;

      const entries = Object.entries(reactions);
      if (entries.length > 1000) {
        const keep = Object.fromEntries(entries.slice(-1000));
        localStorage.setItem('userReactions', JSON.stringify(keep));
      } else {
        localStorage.setItem('userReactions', JSON.stringify(reactions));
      }
    } catch (e) {
      console.warn('[Settings] リアクション保存失敗:', e);
    }
  }
}
