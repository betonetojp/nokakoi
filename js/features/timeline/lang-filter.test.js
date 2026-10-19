import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  getLanguageFlag,
  cleanTextForLangDetection,
  detectLanguage,
  shouldDisplayGlobalEvent
} from './lang-filter.js';

describe('lang-filter', () => {
  describe('cleanTextForLangDetection', () => {
    it('removes URLs, nostr mentions, and custom emoji shortcodes', () => {
      const input = 'こんにちは！ https://example.com/pic.jpg nostr:npub1234567890 :blobcat_happy: :custom-emoji: 素敵ですね';
      const cleaned = cleanTextForLangDetection(input);
      expect(cleaned).toBe('こんにちは！ 素敵ですね');
    });

    it('handles empty or non-string input safely', () => {
      expect(cleanTextForLangDetection(null)).toBe('');
      expect(cleanTextForLangDetection(undefined)).toBe('');
      expect(cleanTextForLangDetection('')).toBe('');
    });
  });

  describe('getLanguageFlag', () => {
    it('returns flag emoji for supported language codes', () => {
      expect(getLanguageFlag('jpn')).toBe('🇯🇵');
      expect(getLanguageFlag('eng')).toBe('🇺🇸');
      expect(getLanguageFlag('rus')).toBe('🇷🇺');
      expect(getLanguageFlag('kor')).toBe('🇰🇷');
      expect(getLanguageFlag('zho')).toBe('🇨🇳');
      expect(getLanguageFlag('cmn')).toBe('🇨🇳'); // alias
    });

    it('returns null for und or unknown', () => {
      expect(getLanguageFlag('und')).toBeNull();
      expect(getLanguageFlag(null)).toBeNull();
    });
  });

  describe('detectLanguage', () => {
    it('detects Japanese text with hiragana/katakana reliably even for short phrases', () => {
      expect(detectLanguage('おはようございます')).toBe('jpn');
      expect(detectLanguage('了解です！')).toBe('jpn');
      expect(detectLanguage('草生えたwww')).toBe('jpn');
      expect(detectLanguage('これは日本語のテスト投稿です。')).toBe('jpn');
    });

    it('detects kanji-only Japanese short phrases', () => {
      expect(detectLanguage('本日晴天 乾杯！')).toBe('jpn');
      expect(detectLanguage('帰宅 了解')).toBe('jpn');
    });

    it('detects Russian / Cyrillic text reliably', () => {
      expect(detectLanguage('Привет мир!')).toBe('rus');
      expect(detectLanguage('да')).toBe('rus');
    });

    it('detects Korean text with hangul', () => {
      expect(detectLanguage('안녕하세요 반갑습니다')).toBe('kor');
    });

    it('detects Chinese simplified text', () => {
      expect(detectLanguage('我们都是好朋友')).toBe('zho');
    });

    it('detects English text and short english words', () => {
      expect(detectLanguage('This is a longer English post for testing language detection in Nostr.')).toBe('eng');
      expect(detectLanguage('gm')).toBe('eng');
      expect(detectLanguage('Hello world')).toBe('nld'); // franc classifies short 'Hello world' as nld (in 14 langs)
    });

    it('detects German text', () => {
      expect(detectLanguage('Das ist ein wunderbarer und sonniger Tag in Deutschland heute.')).toBe('deu');
    });

    it('returns und for emoji/numbers only or URLs only or custom emojis only', () => {
      expect(detectLanguage('👍😊 🎉')).toBe('und');
      expect(detectLanguage('12345')).toBe('und');
      expect(detectLanguage('https://example.com')).toBe('und');
      expect(detectLanguage(':blobcat: :party_parrot:')).toBe('und');
      expect(detectLanguage(':custom_emoji-1:')).toBe('und');
    });

    it('detects language accurately when mixed with custom emoji shortcodes', () => {
      expect(detectLanguage('了解 :blobcat_nod:')).toBe('jpn');
      expect(detectLanguage(':blobcat_dance: おはようございます')).toBe('jpn');
      expect(detectLanguage(':custom_emoji: Hello world from Nostr client')).toBe('eng');
    });
  });

  describe('SUPPORTED_LANGUAGES', () => {
    it('includes und with flag: null', () => {
      const und = SUPPORTED_LANGUAGES.find(l => l.code === 'und');
      expect(und).toBeDefined();
      expect(und.flag).toBeNull();
      expect(und.nameJa).toContain('未判定');
    });
  });

  describe('shouldDisplayGlobalEvent', () => {
    const mockState = {
      pubkey: 'mypubkey123',
      feeds: {
        home: {
          follows: ['followee1', 'followee2'],
          followSet: new Set(['followee1', 'followee2'])
        }
      }
    };

    const createSettings = (enabled, selected, mergeHome = false) => ({
      get: (key) => {
        if (key === 'globalLangFilterEnabled') return enabled;
        if (key === 'globalLangFilterSelected') return selected;
        if (key === 'globalMergeHome') return mergeHome;
        return null;
      }
    });

    it('allows all events when filter is disabled', () => {
      const settings = createSettings(false, ['jpn']);
      const ev = { pubkey: 'stranger1', content: 'This is an English post' };
      expect(shouldDisplayGlobalEvent(ev, mockState, settings)).toBe(true);
    });

    it('always allows user own posts even in different languages or when undetermined', () => {
      const settings = createSettings(true, ['jpn'], false);
      const ev1 = { pubkey: 'mypubkey123', content: 'This is an English post written by myself' };
      const ev2 = { pubkey: 'mypubkey123', content: '👍🎉' };
      expect(shouldDisplayGlobalEvent(ev1, mockState, settings)).toBe(true);
      expect(shouldDisplayGlobalEvent(ev2, mockState, settings)).toBe(true);
    });

    it('allows followee posts regardless of language when mergeHome is true', () => {
      const settings = createSettings(true, ['jpn'], true);
      const ev = { pubkey: 'followee1', content: 'This is an English post by a friend' };
      expect(shouldDisplayGlobalEvent(ev, mockState, settings)).toBe(true);
    });

    it('filters followee posts by language when mergeHome is false', () => {
      const settings = createSettings(true, ['jpn'], false);
      const evEnglish = { pubkey: 'followee1', content: 'This is an English post by a friend' };
      const evJapanese = { pubkey: 'followee1', content: 'これはフォローしている友人の日本語投稿です' };
      expect(shouldDisplayGlobalEvent(evEnglish, mockState, settings)).toBe(false);
      expect(shouldDisplayGlobalEvent(evJapanese, mockState, settings)).toBe(true);
    });

    it('filters out undetermined posts (emoji/symbols) when und is not selected', () => {
      const settings = createSettings(true, ['jpn']);
      const ev = { pubkey: 'stranger1', content: '👍🎉' };
      expect(shouldDisplayGlobalEvent(ev, mockState, settings)).toBe(false);
    });

    it('allows undetermined posts when und is selected', () => {
      const settings = createSettings(true, ['jpn', 'und']);
      const evEmoji = { pubkey: 'stranger1', content: '👍🎉' };
      const evJapanese = { pubkey: 'stranger2', content: 'こんにちは世界' };
      expect(shouldDisplayGlobalEvent(evEmoji, mockState, settings)).toBe(true);
      expect(shouldDisplayGlobalEvent(evJapanese, mockState, settings)).toBe(true);
    });

    it('only displays undetermined posts when only und is selected', () => {
      const settings = createSettings(true, ['und']);
      const evEmoji = { pubkey: 'stranger1', content: '👍🎉' };
      const evJapanese = { pubkey: 'stranger2', content: 'こんにちは世界' };
      const evEnglish = { pubkey: 'stranger3', content: 'Hello world from Nostr' };
      expect(shouldDisplayGlobalEvent(evEmoji, mockState, settings)).toBe(true);
      expect(shouldDisplayGlobalEvent(evJapanese, mockState, settings)).toBe(false);
      expect(shouldDisplayGlobalEvent(evEnglish, mockState, settings)).toBe(false);
    });

    it('allows all posts when all languages and und are selected', () => {
      const allCodes = SUPPORTED_LANGUAGES.map(l => l.code);
      const settings = createSettings(true, allCodes);
      const evEmoji = { pubkey: 'stranger1', content: '👍🎉' };
      const evJapanese = { pubkey: 'stranger2', content: 'こんにちは世界' };
      const evEnglish = { pubkey: 'stranger3', content: 'Hello world from Nostr' };
      expect(shouldDisplayGlobalEvent(evEmoji, mockState, settings)).toBe(true);
      expect(shouldDisplayGlobalEvent(evJapanese, mockState, settings)).toBe(true);
      expect(shouldDisplayGlobalEvent(evEnglish, mockState, settings)).toBe(true);
    });

    it('filters out Russian / Cyrillic when only Japanese is selected', () => {
      const settings = createSettings(true, ['jpn']);
      const evRussian = {
        pubkey: 'stranger1',
        content: 'Привет мир! Это русский текст.'
      };
      expect(shouldDisplayGlobalEvent(evRussian, mockState, settings)).toBe(false);
    });

    it('filters out non-selected languages from strangers', () => {
      const settings = createSettings(true, ['jpn']);
      const evEnglish = {
        pubkey: 'stranger1',
        content: 'This is an English post by someone I do not follow.'
      };
      const evJapanese = {
        pubkey: 'stranger2',
        content: 'これはフォローしていないユーザーによる日本語の投稿です。'
      };
      expect(shouldDisplayGlobalEvent(evEnglish, mockState, settings)).toBe(false);
      expect(shouldDisplayGlobalEvent(evJapanese, mockState, settings)).toBe(true);
    });

    it('allows both selected languages when multiple are enabled', () => {
      const settings = createSettings(true, ['jpn', 'eng']);
      const evEnglish = {
        pubkey: 'stranger1',
        content: 'This is an English post by someone I do not follow.'
      };
      const evGerman = {
        pubkey: 'stranger2',
        content: 'Das ist ein deutscher Beitrag von einem Fremden.'
      };
      expect(shouldDisplayGlobalEvent(evEnglish, mockState, settings)).toBe(true);
      expect(shouldDisplayGlobalEvent(evGerman, mockState, settings)).toBe(false);
    });

    it('filters kind 6 repost of an English post when only Japanese is selected', () => {
      const settings = createSettings(true, ['jpn']);
      const repostOfEnglish = {
        id: 'repost1',
        pubkey: 'stranger1',
        kind: 6,
        content: JSON.stringify({
          id: 'orig1',
          pubkey: 'stranger2',
          content: 'Guys should be selling magnetic eye magnifying glasses at this time.'
        })
      };
      expect(shouldDisplayGlobalEvent(repostOfEnglish, mockState, settings)).toBe(false);
    });

    it('allows kind 6 repost of followee when mergeHome is true', () => {
      const settings = createSettings(true, ['jpn'], true);
      const repostOfFollowee = {
        id: 'repost2',
        pubkey: 'stranger1',
        kind: 6,
        content: JSON.stringify({
          id: 'orig2',
          pubkey: 'followee1',
          content: 'This is an English post by a followee'
        })
      };
      expect(shouldDisplayGlobalEvent(repostOfFollowee, mockState, settings)).toBe(true);
    });

    it('filters kind 6 repost of followee by language when mergeHome is false', () => {
      const settings = createSettings(true, ['jpn'], false);
      const repostOfFollowee = {
        id: 'repost2',
        pubkey: 'stranger1',
        kind: 6,
        content: JSON.stringify({
          id: 'orig2',
          pubkey: 'followee1',
          content: 'This is an English post by a followee'
        })
      };
      expect(shouldDisplayGlobalEvent(repostOfFollowee, mockState, settings)).toBe(false);
    });

    it('handles string boolean "true" in settings safely', () => {
      const settings = createSettings('true', ['jpn']);
      const evEnglish = {
        pubkey: 'stranger1',
        content: 'This is an English post'
      };
      expect(shouldDisplayGlobalEvent(evEnglish, mockState, settings)).toBe(false);
    });
  });
});

