import { escapeHtml, getReactionContent, getReactionEmojiTags } from '../../utils/utils.js';
import { fitCustomEmoji } from '../../utils/url-parser.js';
import { t } from '../../utils/i18n.js';
import { formatReactionForTitle } from './render-helpers.js';

// リアクション表示用フォーマット
export function formatReaction(reaction, emojiTags = []) {
  const reactionContent = getReactionContent(reaction);
  const effectiveEmojiTags = getReactionEmojiTags(reaction).concat(emojiTags || []);
  if (reactionContent === '+') {
    return '⭐';
  } else if (typeof reactionContent === 'string' && reactionContent.startsWith(':') && reactionContent.endsWith(':')) {
    const shortcode = reactionContent.slice(1, -1);
    const emojiTag = effectiveEmojiTags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);
    if (emojiTag && emojiTag[2]) {
      return '<img src="' + escapeHtml(emojiTag[2]) + '" alt="' + escapeHtml(reactionContent) + '" class="custom-emoji" style="max-width: 100%; max-height: 18px; width: auto; height: auto; vertical-align: middle;">';
    }
    return escapeHtml(reactionContent);
  } else if (reactionContent) {
    return escapeHtml(reactionContent);
  } else {
    return '';
  }
}

// リアクションボタン表示を安全に更新
export function setReactionDisplay(btn, reaction, emojiTags = []) {
  try {
    if (!btn) return;
    const reactionContent = getReactionContent(reaction);
    const effectiveEmojiTags = getReactionEmojiTags(reaction).concat(emojiTags || []);
    // 既存表示をクリア
    while (btn.firstChild) btn.removeChild(btn.firstChild);
    if (!reactionContent) return;
    if (reactionContent === '+') {
      btn.appendChild(document.createTextNode('⭐'));
      return;
    }
    // 汎用ショートコード処理: emoji タグを優先
    if (typeof reactionContent === 'string' && reactionContent.startsWith(':') && reactionContent.endsWith(':')) {
      const shortcode = reactionContent.slice(1, -1);
      const emojiTag = effectiveEmojiTags.find(tag => tag[0] === 'emoji' && tag[1] === shortcode);
      if (emojiTag && emojiTag[2]) {
        const img = document.createElement('img');
        img.src = emojiTag[2];
        img.alt = reactionContent;
        img.className = 'custom-emoji';
        img.onerror = function () { try { img.classList.add('d-none'); } catch (e) { } };
        btn.appendChild(img);
        try { if (typeof fitCustomEmoji === 'function') fitCustomEmoji(btn, 18); } catch (e) { }
        return;
      }
      btn.appendChild(document.createTextNode(reactionContent));
      return;
    }
    btn.appendChild(document.createTextNode(reactionContent || ''));
  } catch (e) { try { btn.textContent = getReactionContent(reaction) || ''; } catch (ee) { } }
}

// リアクション表示更新の公開API
export function applyReactionToButton(btn, reaction, emojiTags = []) {
  try {
    setReactionDisplay(btn, reaction, emojiTags);
    if (!btn) return;
    try { btn.dataset.reacted = reaction ? 'true' : 'false'; } catch (e) { }
    try {
      const lbl = getReactionLabel(reaction, emojiTags);
      try { btn.dataset.reactionDisplay = lbl; } catch (e) { }
      try { btn.title = t('reaction.button.title_with_default', { display: lbl }); } catch (e) { }
    } catch (e) { }
  } catch (e) { }
}

// title/tooltip 向けのプレーンテキストラベルを返す
export function getReactionLabel(reaction, emojiTags = []) {
  try {
    const reactionContent = getReactionContent(reaction);
    if (reactionContent === '+') return '⭐';
    if (reactionContent === ':nokakoi:') return formatReactionForTitle(reaction);
    if (typeof reactionContent === 'string' && reactionContent.startsWith(':') && reactionContent.endsWith(':')) {
      return reactionContent;
    }
    if (reactionContent && reactionContent.length > 2) return reactionContent.slice(0, 2);
    return reactionContent || '';
  } catch (e) {
    return getReactionContent(reaction) || '';
  }
}
