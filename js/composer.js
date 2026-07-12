// ============================================================================
// 投稿欄管理
// ============================================================================

import { $, escapeHtml, truncateName, truncateByGraphemeVisible, logWarn, replaceBadgeEmoji } from './utils.js';
import { displayName } from './profile.js';
import { t, applyTranslations } from './i18n.js';
import { attachEmojiShortcodeSuggest } from './emoji-shortcode-suggest.js';
import { revealComposer, syncComposerViewport } from './composer-scroll.js';
import { publishNote, replyToEvent } from './actions.js';
import {
  buildEmojiUrlMapFromText,
  clearTextShortcodeRegistry,
  extractEmojiTagsFromText
} from './custom-emoji-store.js';

let currentReplyTarget = null;
let currentGeohashTarget = null;
let currentQuoteMode = false;
let __composerLastState = null;
let __composerLastNip19 = null;
const COMPOSER_AUTHOR_LIMIT = 16;

/**
 * 返信対象をセットし投稿欄UIを更新
 */
export function setReplyTarget(state, event, nip19) {
  currentReplyTarget = event;
  currentQuoteMode = false;
  currentGeohashTarget = null;
  __composerLastState = state;
  __composerLastNip19 = nip19;

  const replyContext = $('#replyContext');
  const replyContextContent = $('#replyContextContent');
  const composerTitle = $('#composerTitle');
  const noteInput = $('#noteInput');

  if (!replyContext || !replyContextContent || !composerTitle || !noteInput) return;

  // 返信ラベルを既定表示に戻す
  const labelEl = replyContext.querySelector('.reply-context-label');
  if (labelEl) {
    labelEl.style.display = ''; // restore display
    labelEl.setAttribute('data-i18n', 'composer.replyLabel');
    labelEl.textContent = t('composer.replyLabel');
  }

// （quote target用関数は setReplyTarget の後方に移動済み）
  // 「geohash変更」ラベルは非表示
  const changeLabel = replyContext.querySelector('#changeGeohashLabel');
  if (changeLabel) {
    changeLabel.style.display = 'none';
  }

  // 返信コンテキスト表示
  replyContext.hidden = false;

  // タイトル更新
  composerTitle.textContent = t('composer.replyTitle');

  // 返信対象情報表示
  function truncateComposerName(str) {
    return truncateByGraphemeVisible(str, COMPOSER_AUTHOR_LIMIT);
  }
  // kind:20000 ならnタグか#xxxxを即時採用し、displayName()結果を無視
  let authorName;
  if (event && event.kind === 20000) {
    const pk = event.pubkey || '';
    const hash = (pk && pk.length >= 4) ? '#' + pk.slice(-4) : '';
    const nTag = Array.isArray(event.tags) ? event.tags.find(t => t && t[0] === 'n') : null;
    const nName = (nTag && nTag[1]) ? String(nTag[1]).trim() : '';
    authorName = truncateComposerName(nName || hash);
  } else {
    authorName = truncateComposerName(displayName(state, event.pubkey, nip19));
  }
  const content = (event.content || '').split('\n')[0];
  const contentShort = content.length > 100 ? content.substring(0, 100) + '...' : content;

  replyContextContent.innerHTML =
    '<span class="reply-author">' + replaceBadgeEmoji(escapeHtml(authorName)) + '</span>: ' +
    escapeHtml(contentShort);

  // プレースホルダー更新
  try { noteInput.placeholder = t('composer.reply_placeholder', { name: authorName }); } catch (e) { noteInput.placeholder = 'Reply to ' + authorName + '...'; }

  // テキストエリアにフォーカス
  noteInput.focus();

  // 投稿欄が隠れていれば表示
  revealComposer();
}

/**
 * 引用対象をセット（NIP-18 qタグモード）
 */
export function setQuoteTarget(state, event, nip19) {
  currentReplyTarget = event;
  currentQuoteMode = true;
  try { if (typeof window !== 'undefined') window.__nokakoiQuoteMode = true; } catch (e) {}
  currentGeohashTarget = null;
  __composerLastState = state;
  __composerLastNip19 = nip19;

  const replyContext = $('#replyContext');
  const replyContextContent = $('#replyContextContent');
  const composerTitle = $('#composerTitle');
  const noteInput = $('#noteInput');

  if (!replyContext || !replyContextContent || !composerTitle || !noteInput) return;

  // 返信ラベルを引用ラベルへ切り替え
  const labelEl = replyContext.querySelector('.reply-context-label');
  if (labelEl) {
    labelEl.style.display = '';
    try { labelEl.setAttribute('data-i18n', 'composer.quoteLabel'); } catch (e) {}
    try { labelEl.textContent = t('composer.quoteLabel'); } catch (e) { labelEl.textContent = '引用元:'; }
  }
  const changeLabel = replyContext.querySelector('#changeGeohashLabel');
  if (changeLabel) changeLabel.style.display = 'none';

  replyContext.hidden = false;
  composerTitle.textContent = t('composer.title');

  // 引用元は最小限の情報のみ表示
  // kind:20000 ならnタグか#xxxxを即時採用し、displayName()結果を無視
  let authorName;
  if (event && event.kind === 20000) {
    const pk = event.pubkey || '';
    const hash = (pk && pk.length >= 4) ? '#' + pk.slice(-4) : '';
    const nTag = Array.isArray(event.tags) ? event.tags.find(t => t && t[0] === 'n') : null;
    const nName = (nTag && nTag[1]) ? String(nTag[1]).trim() : '';
    authorName = truncateName(nName || hash);
  } else {
    authorName = truncateName(displayName(state, event.pubkey, nip19));
  }
  const content = (event.content || '').split('\n')[0];
  const contentShort = content.length > 100 ? content.substring(0,100) + '...' : content;

  replyContextContent.innerHTML = '<span class="reply-author">' + replaceBadgeEmoji(escapeHtml(authorName)) + '</span>: ' + escapeHtml(contentShort);

  noteInput.focus();
}

/**
 * Geohash投稿対象をセットし投稿欄UIを更新
 */
export function setGeohashTarget(geohash) {
  currentReplyTarget = null;
  currentGeohashTarget = (geohash || '').trim();

  // geohash履歴に追加・保存
  try {
    const sm = (typeof window !== 'undefined' && window.settingsManager) ? window.settingsManager : null;
    if (sm && typeof sm.get === 'function' && typeof sm.set === 'function') {
      let hist = sm.get('omochatGeohashHistory');
      if (!Array.isArray(hist)) hist = [];
      const val = currentGeohashTarget;
      if (val && val.length > 0) {
        hist = hist.filter(v => v !== val);
        hist.unshift(val);
        if (hist.length > 20) hist = hist.slice(0, 20);
        sm.set('omochatGeohashHistory', hist);
      }
    }
  } catch (e) {}

  // 投稿欄UIの更新
  const replyContext = $('#replyContext');
  const replyContextContent = $('#replyContextContent');
  const composerTitle = $('#composerTitle');
  const noteInput = $('#noteInput');

  if (!replyContext || !replyContextContent || !composerTitle || !noteInput) return;

  // geohash投稿時は返信ラベルを隠す
  const labelEl = replyContext.querySelector('.reply-context-label');
  if (labelEl) {
    labelEl.style.display = 'none';
  }
  // geohash変更ラベルを表示
  const changeLabel = replyContext.querySelector('#changeGeohashLabel');
  if (changeLabel) {
    changeLabel.style.display = '';
  }

  // コンテキスト表示
  replyContext.hidden = false;

  // タイトル更新
  composerTitle.textContent = t('composer.title'); // 通常投稿タイトル

  // 詳細表示（例: "📍{geohash}に投稿"）
  const format = t('composer.geohash_target_format') || '📍{geohash}に投稿';
  const displayHtml = format.replace('{geohash}', `<b>${escapeHtml(currentGeohashTarget)}</b>`);
  replyContextContent.innerHTML = displayHtml;

  // プレースホルダー更新
  noteInput.placeholder = `geohash: ${currentGeohashTarget}`;

  // テキストエリアにフォーカス
  noteInput.focus();

  // 投稿欄が隠れていれば表示
  revealComposer();
}

/**
 * 返信対象をクリアし投稿欄を通常モードに戻す
 */
export function clearReplyTarget() {
  currentReplyTarget = null;
  currentGeohashTarget = null;
  currentQuoteMode = false;
  try { if (typeof window !== 'undefined') window.__nokakoiQuoteMode = false; } catch (e) {}
  __composerLastState = null;
  __composerLastNip19 = null;

  const replyContext = $('#replyContext');
  const composerTitle = $('#composerTitle');
  const noteInput = $('#noteInput');

  if (replyContext) {
    replyContext.hidden = true;
    // ラベルを既定状態へ戻す
    const labelEl = replyContext.querySelector('.reply-context-label');
    if (labelEl) {
      labelEl.style.display = ''; // restore display
      labelEl.setAttribute('data-i18n', 'composer.replyLabel');
      labelEl.textContent = t('composer.replyLabel');
    }
    // geohash変更ラベルは非表示へ戻す
    const changeLabel = replyContext.querySelector('#changeGeohashLabel');
    if (changeLabel) {
      changeLabel.style.display = 'none';
    }
  }
  if (composerTitle) composerTitle.textContent = t('composer.title');
  if (noteInput) try { noteInput.placeholder = t('composer.placeholder'); } catch(e) { noteInput.placeholder = 'What are you up to?'; }
}

/**
 * 現在の返信対象を取得
 */
export function getReplyTarget() {
  return currentReplyTarget;
}

export function getQuoteMode() {
  return !!currentQuoteMode;
}

export function getGeohashTarget() {
  return currentGeohashTarget;
}

/**
 * 返信キャンセルボタンのセットアップ
 */
export function setupCancelReplyButton() {
  const cancelBtn = $('#cancelReply');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      clearReplyTarget();
      const noteInput = $('#noteInput');
      if (noteInput) {
        noteInput.value = '';
        clearTextShortcodeRegistry();
        noteInput.dispatchEvent(new Event('input'));
        noteInput.focus();
      }
    };
  }
}

// 言語変更時に投稿欄UIを再反映
try {
  if (typeof window !== 'undefined') {
    window.addEventListener('i18n:updated', () => {
      try {
        const composerTitle = $('#composerTitle');
        const noteInput = $('#noteInput');
        const replyContext = $('#replyContext');
        const replyContextContent = $('#replyContextContent');
        if (composerTitle) {
          composerTitle.textContent = currentReplyTarget ? t('composer.replyTitle') : t('composer.title');
        }
        if (noteInput) {
          if (currentReplyTarget && __composerLastState && __composerLastNip19) {
            try {
              let authorName;
              if (currentReplyTarget.kind === 20000) {
                const pk = currentReplyTarget.pubkey || '';
                const hash = (pk && pk.length >= 4) ? '#' + pk.slice(-4) : '';
                const nTag = Array.isArray(currentReplyTarget.tags) ? currentReplyTarget.tags.find(t => t && t[0] === 'n') : null;
                const nName = (nTag && nTag[1]) ? String(nTag[1]).trim() : '';
                authorName = nName || hash;
              } else {
                authorName = displayName(__composerLastState, currentReplyTarget.pubkey, __composerLastNip19);
              }
              noteInput.placeholder = t('composer.reply_placeholder', { name: authorName });
            } catch (e) {
              noteInput.placeholder = t('composer.placeholder');
            }
          } else {
            try { noteInput.placeholder = t('composer.placeholder'); } catch (e) { }
          }
        }
        if (replyContext && replyContextContent && currentReplyTarget && __composerLastState && __composerLastNip19) {
          try {
            let authorName;
            if (currentReplyTarget.kind === 20000) {
              const pk = currentReplyTarget.pubkey || '';
              const hash = (pk && pk.length >= 4) ? '#' + pk.slice(-4) : '';
              const nTag = Array.isArray(currentReplyTarget.tags) ? currentReplyTarget.tags.find(t => t && t[0] === 'n') : null;
              const nName = (nTag && nTag[1]) ? String(nTag[1]).trim() : '';
              authorName = nName || hash;
            } else {
              authorName = displayName(__composerLastState, currentReplyTarget.pubkey, __composerLastNip19);
            }
            const content = (currentReplyTarget.content || '').split('\n')[0];
            const contentShort = content.length > 100 ? content.substring(0, 100) + '...' : content;
            replyContextContent.innerHTML = '<span class="reply-author">' + replaceBadgeEmoji(escapeHtml(authorName)) + '</span>: ' + escapeHtml(contentShort);
            replyContext.hidden = false;
          } catch (e) { }
        }
        // 投稿欄内の data-i18n も再適用（再dispatchなし）
        try { if (typeof applyTranslations === 'function') applyTranslations(document.getElementById('composer') || document, true); } catch (e) { }
      } catch (e) { }
    });
  }
} catch (e) { }

// ============================================================================
// NIP-30 カスタム絵文字プレビュー
// ============================================================================

let currentEmojiPreviewTags = []; // 投稿欄で検出されたショートコード → emoji タグ

/**
 * 投稿欄から使用されているカスタム絵文字の emoji タグを抽出
 * @param {string} text - 投稿テキスト
 * @returns {Array} emoji タグの配列
 */
export function extractUsedEmojiTags(text) {
  const customEmojis = (typeof window !== 'undefined' && window.__customEmojis instanceof Map)
    ? window.__customEmojis
    : new Map();
  return extractEmojiTagsFromText(text, customEmojis);
}

/**
 * 投稿欄のカスタム絵文字プレビューを更新
 * フィードと同じように改行や画像配置を反映
 */
function updateEmojiPreview() {
  try {
    const noteInput = $('#noteInput');
    const composer = $('#composer');
    if (!noteInput || !composer) return;

    const text = noteInput.value || '';
    const emojiTags = extractUsedEmojiTags(text);
    currentEmojiPreviewTags = emojiTags;

    // プレビューコンテナを取得または作成
    // composer 内で noteInput の上に配置
    let previewContainer = composer.querySelector('.emoji-preview-container');
    if (!previewContainer) {
      previewContainer = document.createElement('div');
      previewContainer.className = 'emoji-preview-container compose-preview d-none';
      const suggestEl = composer.querySelector('.emoji-shortcode-suggest');
      const insertAnchor = suggestEl || noteInput;
      noteInput.parentNode.insertBefore(previewContainer, insertAnchor);
    }

    if (!text.trim() || emojiTags.length === 0) {
      previewContainer.classList.add('d-none');
      previewContainer.innerHTML = '';
      return;
    }

    previewContainer.classList.remove('d-none');
    previewContainer.innerHTML = ''; // クリア

    // テキストから emoji 関連要素のみを抽出してプレビュー生成
    const customEmojis = (typeof window !== 'undefined' && window.__customEmojis instanceof Map)
      ? window.__customEmojis
      : new Map();
    const emojiMap = buildEmojiUrlMapFromText(text, customEmojis);

    const lines = text.split('\n');
    const emojiOnlyRegex = /^\s*(?::[A-Za-z0-9_+-]+:\s*)+$/;
    const emojiShortcodeRegex = /:([a-zA-Z0-9_+-]+):/g;

    for (const line of lines) {
      const isEmojiOnly = emojiOnlyRegex.test(line);

      // 行から絵文字アイコンを抽出（出現順、重複あり）
      const lineEmojis = [];
      let match;
      emojiShortcodeRegex.lastIndex = 0;
      while ((match = emojiShortcodeRegex.exec(line)) !== null) {
        const shortcode = match[1];
        const url = emojiMap.get(shortcode);
        if (url) {
          lineEmojis.push({ shortcode, url, index: match.index });
        }
      }

      if (lineEmojis.length === 0) continue; // 絵文字なし行はスキップ

      const lineDiv = document.createElement('div');
      lineDiv.className = 'compose-line';

      if (isEmojiOnly) {
        // 絵文字のみの行: flex で隙間なく並べる
        lineDiv.className = 'compose-line compose-line--emoji';

        for (const emoji of lineEmojis) {
          const imgWrapper = document.createElement('span');
          imgWrapper.className = 'emoji-wrapper';

          const img = document.createElement('img');
          img.src = emoji.url;
          img.alt = `:${emoji.shortcode}:`;
          img.title = `:${emoji.shortcode}:`;
          img.className = 'emoji-inline-img';

          imgWrapper.appendChild(img);
          lineDiv.appendChild(imgWrapper);
        }
      } else {
        // テキスト+絵文字の混在行: テキストと絵文字を一緒に inline で表示
        lineDiv.className = 'compose-line compose-text-block';

        // テキストを構築（絵文字ショートコードをimg タグに置換）
        let lastIndex = 0;
        emojiShortcodeRegex.lastIndex = 0;

        let match;
        while ((match = emojiShortcodeRegex.exec(line)) !== null) {
          // マッチ前のテキスト部分
          if (match.index > lastIndex) {
            const textPart = line.substring(lastIndex, match.index);
            const span = document.createElement('span');
            span.textContent = textPart;
            lineDiv.appendChild(span);
          }

          // 絵文字
          const shortcode = match[1];
          const emojiData = lineEmojis.find(e => e.shortcode === shortcode);
          if (emojiData) {
            const imgWrapper = document.createElement('span');
            imgWrapper.className = 'emoji-wrapper';

            const img = document.createElement('img');
            img.src = emojiData.url;
            img.alt = `:${shortcode}:`;
            img.title = `:${shortcode}:`;
            img.className = 'emoji-inline-img';

            imgWrapper.appendChild(img);
            lineDiv.appendChild(imgWrapper);
          }

          lastIndex = match.index + match[0].length;
        }

        // 残りのテキスト
        if (lastIndex < line.length) {
          const textPart = line.substring(lastIndex);
          const span = document.createElement('span');
          span.textContent = textPart;
          lineDiv.appendChild(span);
        }
      }

      previewContainer.appendChild(lineDiv);
    }
  } catch (e) {
    console.warn('[Composer] emoji プレビュー更新に失敗:', e);
  }
}

/**
 * 投稿欄の emoji プレビュー機能をセットアップ
 */
export function setupEmojiPreview() {
  try {
    const noteInput = $('#noteInput');
    if (!noteInput) return;

    // input イベントでプレビューを更新
    noteInput.addEventListener('input', updateEmojiPreview);

    // custom emoji 更新時もプレビューを再描画
    if (typeof window !== 'undefined') {
      window.addEventListener('customEmoji:updated', updateEmojiPreview);
    }
  } catch (e) {
    console.warn('[Composer] emoji プレビューセットアップに失敗:', e);
  }
}

/**
 * 投稿欄のカスタム絵文字ショートコードサジェストをセットアップ
 */
export function setupEmojiShortcodeSuggest() {
  try {
    const noteInput = $('#noteInput');
    if (!noteInput) return;
    attachEmojiShortcodeSuggest(noteInput);
  } catch (e) {
    console.warn('[Composer] emoji ショートコードサジェストセットアップに失敗:', e);
  }
}

/**
 * 投稿欄で使用されている emoji タグを取得
 */
export function getEmojiPreviewTags() {
  return currentEmojiPreviewTags;
}
/**
 * 隠し文字埋め込みモーダルを表示
 */
export async function openHiddenTagCharModal() {
  try {
    const { showHiddenTagCharModal } = await import('./modals.js');
    const noteInput = $('#noteInput');
    if (!noteInput) {
      console.warn('[Composer] #noteInput が見つかりません');
      return;
    }

    showHiddenTagCharModal((encoded) => {
      // テキストエリアのカーソル位置に挿入
      const textarea = noteInput;
      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || 0;
      const before = textarea.value.substring(0, start);
      const after = textarea.value.substring(end);
      textarea.value = before + encoded + after;
      textarea.selectionStart = textarea.selectionEnd = start + encoded.length;
      textarea.focus();

      // change イベントを手動発火（UI 更新など）
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  } catch (e) {
    console.warn('[Composer] openHiddenTagCharModal に失敗', e);
  }
}

/**
 * 投稿入力エリアおよび送信ボタンのUIイベントをバインド
 */
export function setupComposerUI(state, { getOmochatRelays, consumeShareText }) {
  function blurComposerAfterPublish() {
    try {
      const ni = $('#noteInput');
      if (ni) ni.blur();
      const pb = $('#publishBtn');
      if (pb) pb.blur();
      setTimeout(() => {
        try { syncComposerViewport(); } catch (e) { }
      }, 200);
    } catch (e) { }
  }

  const publishBtn = $('#publishBtn');
  if (publishBtn) {
    publishBtn.onclick = async () => {
      const content = ($('#noteInput') && $('#noteInput').value || '').trim();
      if (!content) return;

      // nsec投稿防止チェック（nsec1+58文字のみ警告）
      if (/nsec1[0-9a-z]{58}/i.test(content)) {
        const result = $('#publishResult');
        if (result) result.textContent = t('publish.nsec_warning');
        return;
      }

      const replyTarget = currentReplyTarget;
      const geohashTarget = currentGeohashTarget;
      let success;

      if (replyTarget) {
        // 返信として送信
        success = await replyToEvent(state, replyTarget, content);
        if (success) {
          clearReplyTarget();
          clearTextShortcodeRegistry();
          $('#noteInput').value = '';
          $('#noteInput').dispatchEvent(new Event('input'));
          const result = $('#publishResult');
          if (result) result.textContent = t('publish.replied');
          blurComposerAfterPublish();
        }
      } else if (geohashTarget) {
        // Geohash投稿として送信 (kind:20000)
        success = await publishNote(state, content, $('#publishResult'), {
          kind: 20000,
          relays: getOmochatRelays(),
          tags: [['g', geohashTarget]]
        });
        if (success) {
          clearReplyTarget();
          clearTextShortcodeRegistry();
          $('#noteInput').value = '';
          $('#noteInput').dispatchEvent(new Event('input'));
          blurComposerAfterPublish();
        }
      } else {
        // 通常投稿として送信
        const activeTabBtn = document.querySelector('.tab.active');
        const activeTab = activeTabBtn ? activeTabBtn.dataset.tab : null;
        if (activeTab === 'bitchat') {
          success = await publishNote(state, content, $('#publishResult'), { kind: 20000, relays: getOmochatRelays() });
        } else {
          success = await publishNote(state, content, $('#publishResult'));
        }
        if (success) {
          clearTextShortcodeRegistry();
          $('#noteInput').value = '';
          $('#noteInput').dispatchEvent(new Event('input'));
          blurComposerAfterPublish();
        }
      }
    };
  }

  const noteInput = $('#noteInput');
  if (noteInput) {
    const initialShareText = consumeShareText();
    if (initialShareText && (!noteInput.value || !noteInput.value.trim())) {
      noteInput.value = initialShareText;
      try { noteInput.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { }
    }
    noteInput.addEventListener('keydown', async function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const content = noteInput.value.trim();
        if (!content) return;

        // nsec投稿防止チェック（nsec1+58文字のみ警告）
        if (/nsec1[0-9a-z]{58}/i.test(content)) {
          const result = $('#publishResult');
          if (result) result.textContent = t('publish.nsec_warning');
          return;
        }

        const replyTarget = currentReplyTarget;
        const geohashTarget = currentGeohashTarget;
        let success;

        if (replyTarget) {
          success = await replyToEvent(state, replyTarget, content);
          if (success) {
            clearReplyTarget();
            clearTextShortcodeRegistry();
            noteInput.value = '';
            noteInput.dispatchEvent(new Event('input'));
            const result = $('#publishResult');
            if (result) result.textContent = t('publish.replied');
            blurComposerAfterPublish();
          }
        } else if (geohashTarget) {
          success = await publishNote(state, content, $('#publishResult'), {
            kind: 20000,
            relays: getOmochatRelays(),
            tags: [['g', geohashTarget]]
          });
          if (success) {
            clearReplyTarget();
            clearTextShortcodeRegistry();
            noteInput.value = '';
            noteInput.dispatchEvent(new Event('input'));
            blurComposerAfterPublish();
          }
        } else {
          const activeTabBtn = document.querySelector('.tab.active');
          const activeTab = activeTabBtn ? activeTabBtn.dataset.tab : null;
          if (activeTab === 'bitchat') {
            success = await publishNote(state, content, $('#publishResult'), { kind: 20000, relays: getOmochatRelays() });
          } else {
            success = await publishNote(state, content, $('#publishResult'));
          }
          if (success) {
            clearTextShortcodeRegistry();
            noteInput.value = '';
            noteInput.dispatchEvent(new Event('input'));
            blurComposerAfterPublish();
          }
        }
      }
    });
  }
}

