import { franc } from 'franc-min';

/**
 * kakoi 準拠の 14言語定義（国旗絵文字付き）
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'jpn', nameJa: '日本語', nameEn: 'Japanese', flag: '🇯🇵' },
  { code: 'eng', nameJa: '英語', nameEn: 'English', flag: '🇺🇸' },
  { code: 'kor', nameJa: '韓国語', nameEn: 'Korean', flag: '🇰🇷' },
  { code: 'zho', nameJa: '中国語', nameEn: 'Chinese', flag: '🇨🇳', aliases: ['cmn', 'yue'] },
  { code: 'deu', nameJa: 'ドイツ語', nameEn: 'German', flag: '🇩🇪' },
  { code: 'fra', nameJa: 'フランス語', nameEn: 'French', flag: '🇫🇷' },
  { code: 'spa', nameJa: 'スペイン語', nameEn: 'Spanish', flag: '🇪🇸' },
  { code: 'por', nameJa: 'ポルトガル語', nameEn: 'Portuguese', flag: '🇧🇷' },
  { code: 'ita', nameJa: 'イタリア語', nameEn: 'Italian', flag: '🇮🇹' },
  { code: 'rus', nameJa: 'ロシア語', nameEn: 'Russian', flag: '🇷🇺' },
  { code: 'nld', nameJa: 'オランダ語', nameEn: 'Dutch', flag: '🇳🇱' },
  { code: 'nor', nameJa: 'ノルウェー語', nameEn: 'Norwegian', flag: '🇳🇴' },
  { code: 'swe', nameJa: 'スウェーデン語', nameEn: 'Swedish', flag: '🇸🇪' },
  { code: 'dan', nameJa: 'デンマーク語', nameEn: 'Danish', flag: '🇩🇰' },
  { code: 'und', nameJa: '未判定', nameEn: 'Undetermined', flag: null }
];

const CODE_TO_CANONICAL = new Map();
SUPPORTED_LANGUAGES.forEach(lang => {
  CODE_TO_CANONICAL.set(lang.code, lang.code);
  if (Array.isArray(lang.aliases)) {
    lang.aliases.forEach(alias => CODE_TO_CANONICAL.set(alias, lang.code));
  }
});

// franc に渡す対象言語リスト（14言語限定で識別精度を向上）
const FRANC_14_LANGS = ['dan', 'deu', 'eng', 'fra', 'ita', 'jpn', 'kor', 'cmn', 'nld', 'nor', 'por', 'rus', 'spa', 'swe'];

/**
 * 言語コードに対応する国旗絵文字を取得する
 */
export function getLanguageFlag(langCode) {
  if (!langCode || langCode === 'und') return null;
  const canonical = CODE_TO_CANONICAL.get(langCode) || langCode;
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === canonical);
  return lang ? lang.flag : null;
}

/**
 * テキストからノイズ（URL、Nostrメンション等）を除去して正規化する
 */
export function cleanTextForLangDetection(content) {
  if (!content || typeof content !== 'string') return '';
  return content
    .replace(/nostr:(?:npub1|nprofile1|note1|nevent1|naddr1|nsec1)[a-z0-9]+/gi, '')
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/:[a-zA-Z0-9_+-]+:/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[\s\r\n\t]+/g, ' ')
    .trim();
}

/**
 * 言語を判定する (ISO 639-3 コード または 'und')
 */
export function detectLanguage(content) {
  const text = cleanTextForLangDetection(content);
  if (!text) return 'und';

  // 1. キリル文字 (ロシア語): 1文字でもキリル文字があればロシア語として扱う
  if (/[\u0400-\u04FF]/.test(text)) {
    return 'rus';
  }

  // 2. 日本語判定: ひらがなまたはカタカナが含まれる場合は確実に日本語
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
    return 'jpn';
  }

  // 3. 韓国語判定: ハングルが含まれる場合は韓国語
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(text)) {
    return 'kor';
  }

  // 文字が全くない（数字や絵文字・記号のみ）場合は判定不能（und）
  const lettersOnly = text.replace(/[^\p{L}]/gu, '');
  if (lettersOnly.length === 0) {
    return 'und';
  }

  // それ以外（漢字のみ、ラテン文字等）はエンジン（franc）に任せる
  try {
    const code = franc(text, { minLength: 3, only: FRANC_14_LANGS });
    const canonical = CODE_TO_CANONICAL.get(code) || code;
    if (canonical && canonical !== 'und') {
      return canonical;
    }
  } catch (e) { }

  return 'und';
}

/**
 * グローバルフィードでイベントを表示すべきかどうか判定する
 * 
 * ポリシー:
 * 1. フィルタ無効時は常に表示
 * 2. 自分の投稿は常に表示
 * 3. フォロイー（自分がフォローしている相手）の投稿は常に表示
 * 4. ノンフォロイーの投稿:
 *    - 判定不能（und・絵文字や数字記号のみ）は常に表示
 *    - 選択言語に一致すれば表示、それ以外は完全非表示
 */
export function shouldDisplayGlobalEvent(ev, state, settingsManager) {
  if (!ev) return false;
  if (!settingsManager) return true;

  const rawEnabled = settingsManager.get('globalLangFilterEnabled');
  const enabled = rawEnabled === true || rawEnabled === 'true';
  if (!enabled) return true;

  // 自分の投稿チェック（常に表示）
  const myPubkey = (state?.pubkey || (typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : null) || '').toLowerCase();
  const evPubkey = (ev.pubkey || '').toLowerCase();
  if (myPubkey && evPubkey && myPubkey === evPubkey) return true;

  // フォロイーチェック: ホームマージ有効時のみ言語判定から除外（常に表示）
  const mergeHome = settingsManager.get('globalMergeHome') === true;
  const homeFeed = state?.feeds?.home;
  if (mergeHome && homeFeed && evPubkey) {
    if (homeFeed.followSet && homeFeed.followSet.has(evPubkey)) return true;
    if (Array.isArray(homeFeed.follows) && homeFeed.follows.some(pk => pk && pk.toLowerCase() === evPubkey)) return true;
  }

  // 許可言語セット取得（未判定 'und' も含みうる）
  const selectedList = settingsManager.get('globalLangFilterSelected');
  const allowedSet = new Set(Array.isArray(selectedList) ? selectedList : ['jpn']);

  // 本文取得（純粋なリポスト kind 6 / 16 の場合は元投稿の content も探索）
  let textToDetect = ev.content || '';
  if ((ev.kind === 6 || ev.kind === 16) && typeof textToDetect === 'string' && textToDetect.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(textToDetect.trim());
      if (parsed) {
        if (mergeHome && parsed.pubkey && homeFeed && (
          (homeFeed.followSet && homeFeed.followSet.has(parsed.pubkey.toLowerCase())) ||
          (Array.isArray(homeFeed.follows) && homeFeed.follows.some(pk => pk && pk.toLowerCase() === parsed.pubkey.toLowerCase()))
        )) {
          return true; // ホーム合流時はフォロイーの元投稿リポストを常に表示
        }
        if (typeof parsed.content === 'string') {
          textToDetect = parsed.content;
        }
      }
    } catch (e) { /* そのまま使用 */ }
  }

  const detected = detectLanguage(textToDetect);

  // 判定結果（14言語コード または 'und'）が許可セットに含まれているか判定
  return allowedSet.has(detected);
}
