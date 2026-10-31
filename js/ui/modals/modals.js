// ============================================================================
// モーダルダイアログ
// ============================================================================

import { $, showToast, buildReactionEmojiTags, buildStoredReactionValue, getReactionContent, getReactionEmojiTags, isReactionShortcodeOnly, resolveReactionCustomEmoji, isRelativeOrLocalEmojiUrl } from '../../utils/utils.js';
import { t, applyTranslations } from '../../utils/i18n.js';
import { DEFAULT_OMOCHAT_RELAYS } from '../../config/constants.js';
import { attachEmojiShortcodeSuggest } from '../../features/emoji/emoji-shortcode-suggest.js';
import { registerTextShortcodeVariant } from '../../features/emoji/custom-emoji-store.js';
import { getClosestRelays } from '../../features/relay/geo-relay-directory.js';
import { bringModalToFront } from '../setup/modal-helper.js';

const HIDDEN_TAG_CHARS_RE = /[\u{E00F0}-\u{E01EF}]+/gu;
const RECENT_REACTIONS_KEY = 'recentReactions';
const MAX_RECENT_REACTIONS = 24;
let reactionShortcodeSuggest = null;

function bringModalTop(modal) {
  if (!modal) return;
  try {
    if (typeof bringModalToFront === 'function') {
      bringModalToFront(modal);
      return;
    }
    if (typeof window !== 'undefined' && typeof window.bringModalToFront === 'function') {
      window.bringModalToFront(modal);
      return;
    }
  } catch (e) { }
  try {
    const modals = Array.from(document.querySelectorAll('.modal'));
    let maxZ = 250;
    modals.forEach(m => {
      if (!m.hidden && m !== modal) {
        const rawZ = (typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(m).zIndex : '') || m.style?.zIndex;
        const z = parseInt(rawZ, 10);
        if (!isNaN(z) && z > maxZ) maxZ = z;
      }
    });
    modal.style.zIndex = String(maxZ + 1);
  } catch (e) {
    modal.style.zIndex = '9999';
  }
}

function countGraphemeClusters(text) {
  if (!text) return 0;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
      return Array.from(segmenter.segment(text)).length;
    }
  } catch (e) { }
  return Array.from(text).length;
}

function isValidReactionSymbol(symbol) {
  if (!symbol) return false;
  if (isReactionShortcodeOnly(symbol)) return buildReactionEmojiTags(symbol).length > 0;

  // セクシー餃子の隠しタグ列は可視1文字に付随するため文字数判定から除外
  const normalized = symbol.replace(HIDDEN_TAG_CHARS_RE, '');
  if (!normalized) return false;
  return countGraphemeClusters(normalized) === 1;
}

function getReactionValidationMessage(symbol) {
  if (isReactionShortcodeOnly(symbol) && buildReactionEmojiTags(symbol).length === 0) {
    return t('reaction.input.shortcode_missing');
  }
  return t('reaction.input.invalid');
}

function ensureReactionPreviewContainer(modal, input) {
  let preview = modal.querySelector('[data-reaction-preview="1"]');
  if (preview) return preview;

  preview = document.createElement('div');
  preview.dataset.reactionPreview = '1';
  preview.className = 'emoji-preview d-none';
  input.insertAdjacentElement('afterend', preview);
  return preview;
}

function updateReactionPreview(modal, input) {
  const preview = ensureReactionPreviewContainer(modal, input);
  const symbol = (input.value || '').trim();
  const resolved = isReactionShortcodeOnly(symbol) ? resolveReactionCustomEmoji(symbol) : null;

  preview.innerHTML = '';
  if (!resolved || !resolved.url) {
    preview.classList.add('d-none');
    return;
  }

  preview.classList.remove('d-none');
  const line = document.createElement('div');
  line.className = 'emoji-preview-line';

  const img = document.createElement('img');
  img.src = resolved.url;
  img.alt = ':' + resolved.shortcode + ':';
  img.title = ':' + resolved.shortcode + ':';
  img.className = 'emoji-preview-img';

  const label = document.createElement('span');
  label.className = 'muted';
  label.textContent = ':' + resolved.shortcode + ':';

  line.appendChild(img);
  line.appendChild(label);
  preview.appendChild(line);

  if (isRelativeOrLocalEmojiUrl(resolved.url)) {
    const warn = document.createElement('div');
    warn.className = 'status-warning muted mt-4';
    warn.style.color = 'var(--status-warn, #f59e0b)';
    warn.style.fontSize = '0.85em';
    warn.style.lineHeight = '1.4';
    warn.textContent = t('reaction.warning.relative_or_local_url');
    preview.appendChild(warn);
  }
}

function getRecentReactionsKey() {
  const pk = localStorage.getItem('pubkey');
  return pk ? `${RECENT_REACTIONS_KEY}.${pk.toLowerCase()}` : RECENT_REACTIONS_KEY;
}

function loadRecentReactions() {
  try {
    const raw = localStorage.getItem(getRecentReactionsKey());
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const item of arr) {
      const normalized = buildStoredReactionValue(item);
      if (!getReactionContent(normalized)) continue;
      out.push(normalized);
    }
    return out;
  } catch (e) {
    return [];
  }
}

function saveRecentReactions(list) {
  try {
    localStorage.setItem(getRecentReactionsKey(), JSON.stringify(Array.isArray(list) ? list : []));
  } catch (e) { }
}

function getReactionIdentity(value) {
  const content = getReactionContent(value);
  const tags = buildReactionEmojiTags(value);
  const tag = (Array.isArray(tags) && tags[0]) ? tags[0] : null;
  const url = tag && tag[2] ? String(tag[2]) : '';
  return content + '|' + url;
}

function pushRecentReaction(value) {
  const normalized = buildStoredReactionValue(value);
  const content = getReactionContent(normalized);
  if (!content) return;

  const current = loadRecentReactions();
  const id = getReactionIdentity(normalized);
  const filtered = current.filter(item => getReactionIdentity(item) !== id);
  filtered.unshift(normalized);
  saveRecentReactions(filtered.slice(0, MAX_RECENT_REACTIONS));
}

function decodeSteganographyTagChars(tagStr) {
  try {
    const bytes = [];
    for (const ch of tagStr) {
      const cp = ch.codePointAt(0);
      if (cp >= 0xE00F0 && cp <= 0xE01EF) {
        bytes.push(cp - 0xE00F0);
      }
    }
    if (bytes.length === 0) return null;
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  } catch (e) {
    return null;
  }
}

export function parseSteganographyReaction(text) {
  if (!text || !/[\u{E00F0}-\u{E01EF}]/u.test(text)) return null;

  const PATTERN = /([\u{1F1E6}-\u{1F1FF}]{2}|[\p{Emoji_Presentation}\p{Extended_Pictographic}](?:[\u{FE0E}\u{FE0F}]?(?:\u200D[\p{Emoji_Presentation}\p{Extended_Pictographic}][\u{FE0E}\u{FE0F}]?)*)(?:[\u{1F3FB}-\u{1F3FF}])?|[^\u{E0000}-\u{E01FF}\s])?([\u{E00F0}-\u{E01EF}]+)/gu;

  const match = PATTERN.exec(text);
  if (!match) return null;

  const visibleEmoji = match[1] || '🥟';
  let decoded = decodeSteganographyTagChars(match[2]);
  if (!decoded) return null;

  let depth = 0;
  while (depth < 10 && /[\u{E00F0}-\u{E01EF}]/u.test(decoded)) {
    depth++;
    PATTERN.lastIndex = 0;
    const innerMatch = PATTERN.exec(decoded);
    if (innerMatch) {
      const innerDecoded = decodeSteganographyTagChars(innerMatch[2]);
      if (innerDecoded) {
        decoded = innerDecoded;
        continue;
      }
    }
    break;
  }

  return {
    visibleEmoji,
    decodedText: decoded
  };
}

function renderRecentReactions(modal, input, statusEl) {
  const listEl = modal.querySelector('#reactionRecentList');
  if (!listEl) return;

  listEl.innerHTML = '';
  const recent = loadRecentReactions();
  if (!recent.length) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.style.fontSize = '0.85em';
    empty.textContent = t('reaction.recent.empty');
    listEl.appendChild(empty);
    return;
  }

  for (const reaction of recent) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick-reaction';
    const content = getReactionContent(reaction);
    btn.dataset.reaction = content;

    const resolved = isReactionShortcodeOnly(reaction) ? resolveReactionCustomEmoji(reaction) : null;
    if (resolved && resolved.url) {
      const img = document.createElement('img');
      img.src = resolved.url;
      img.alt = content;
      img.title = content;
      img.className = 'quick-reaction-icon';
      btn.appendChild(img);
    } else {
      const stego = parseSteganographyReaction(content);
      if (stego) {
        btn.classList.add('quick-reaction-steganography');
        btn.title = `${stego.visibleEmoji} (${stego.decodedText})`;

        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'quick-reaction-emoji';
        emojiSpan.textContent = stego.visibleEmoji;

        const textSpan = document.createElement('span');
        textSpan.className = 'steganography-revealed quick-reaction-steganography-text';
        textSpan.textContent = stego.decodedText;

        btn.appendChild(emojiSpan);
        btn.appendChild(textSpan);
      } else {
        btn.textContent = content;
      }
    }

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      // 最近使ったリアクションがカスタム絵文字の場合、そのバリアント（URL）をレジストリに登録しておく
      if (isReactionShortcodeOnly(reaction)) {
        const scMatch = content.match(/^:([a-zA-Z0-9_+-]+):$/);
        if (scMatch) {
          const shortcode = scMatch[1];
          const tags = getReactionEmojiTags(reaction);
          const tag = (Array.isArray(tags) && tags[0]) ? tags[0] : null;
          if (tag && tag[2]) {
            const variant = { url: tag[2], address: tag[3] || '' };
            registerTextShortcodeVariant(shortcode, variant, shortcode);
          }
        }
      }

      input.value = content;
      updateReactionPreview(modal, input);
      if (statusEl) statusEl.textContent = '';
    };

    listEl.appendChild(btn);
  }
}

/**
 * リアクション記号入力モーダルを表示
 */
export function showReactionModal(currentSymbol, onConfirm, settingsManager, options = {}) {
  const modal = $('#reactionModal');
  const input = $('#reactionInput');
  const saveBtn = $('#reactionSave');
  const saveAndReactBtn = $('#reactionSaveAndReact');
  const reactOnlyBtn = $('#reactionReactOnly');
  const closeBtn = $('#reactionClose');
  const statusEl = $('#reactionStatus');
  const showReactActions = !!options.showReactActions;
  const onSaveAndReact = (typeof options.onSaveAndReact === 'function') ? options.onSaveAndReact : null;
  const onReactOnly = (typeof options.onReactOnly === 'function') ? options.onReactOnly : null;

  if (!modal || !input || !saveBtn || !closeBtn || !saveAndReactBtn || !reactOnlyBtn) return;

  // まずモーダル表示
  modal.hidden = false;

  // モーダル内の固定ラベルに翻訳を適用（再 dispatch なし）
  try { if (typeof applyTranslations === 'function') applyTranslations(modal, true); } catch (e) { }

  bringModalTop(modal);

  // ステータスクリア
  if (statusEl) statusEl.textContent = '';
  saveAndReactBtn.hidden = !showReactActions;
  reactOnlyBtn.hidden = !showReactActions;

  // モーダル表示時はlocalStorageから最新値取得
  let initialValue = currentSymbol || '+';
  if (settingsManager) {
    // localStorageから取得
    const savedValue = settingsManager.get('reactionDefault');
    if (savedValue) {
      initialValue = savedValue;
    }
  }

  // 初期値がカスタム絵文字の場合、そのバリアント（URL）をレジストリに登録しておく
  if (isReactionShortcodeOnly(initialValue)) {
    const scMatch = getReactionContent(initialValue).match(/^:([a-zA-Z0-9_+-]+):$/);
    if (scMatch) {
      const shortcode = scMatch[1];
      const tags = getReactionEmojiTags(initialValue);
      const tag = (Array.isArray(tags) && tags[0]) ? tags[0] : null;
      if (tag && tag[2]) {
        const variant = { url: tag[2], address: tag[3] || '' };
        registerTextShortcodeVariant(shortcode, variant, shortcode);
      }
    }
  }

  // モーダル表示直後に値セット
  input.value = getReactionContent(initialValue) || initialValue;
  try { reactionShortcodeSuggest?.hide(); } catch (e) { }

  const handleCustomEmojiUpdated = () => {
    try { if (!modal.hidden) updateReactionPreview(modal, input); } catch (e) { }
  };

  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('customEmoji:updated', handleCustomEmojiUpdated);
    }
  } catch (e) { }

  const closeModal = () => {
    try { reactionShortcodeSuggest?.hide(); } catch (e) { }
    modal.hidden = true;
    if (statusEl) statusEl.textContent = '';
    try { if (!window.bringModalToFront) modal.style.zIndex = ''; } catch (e) { }
    try {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('customEmoji:updated', handleCustomEmojiUpdated);
      }
    } catch (e) { }
  };

  updateReactionPreview(modal, input);
  renderRecentReactions(modal, input, statusEl);

  if (!reactionShortcodeSuggest) {
    reactionShortcodeSuggest = attachEmojiShortcodeSuggest(input, {
      allowSuffix: false,
      onAfterInsert: () => {
        updateReactionPreview(modal, input);
        if (statusEl) statusEl.textContent = '';
      }
    });
  }

  const setErrorStatus = (message) => {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = 'muted status-error';
  };

  const readValidatedReaction = () => {
    const symbol = input.value.trim();
    const reactionValue = buildStoredReactionValue(symbol);
    if (!symbol) {
      setErrorStatus(t('reaction.input.empty'));
      return null;
    }
    if (!isValidReactionSymbol(symbol)) {
      setErrorStatus(getReactionValidationMessage(symbol));
      return null;
    }
    return { symbol, reactionValue };
  };

  const checkRelativeUrlConfirmation = async (reactionValue) => {
    const tags = getReactionEmojiTags(reactionValue);
    const hasRelativeOrLocal = tags.some(tag => Array.isArray(tag) && tag[0] === 'emoji' && isRelativeOrLocalEmojiUrl(tag[2]));
    if (!hasRelativeOrLocal) return true;

    return new Promise((resolve) => {
      showConfirmModal(
        t('reaction.confirm.relative_or_local_title'),
        t('reaction.confirm.relative_or_local_message'),
        () => resolve(true),
        () => resolve(false)
      );
    });
  };

  const setButtonsDisabled = (disabled) => {
    saveBtn.disabled = !!disabled;
    saveAndReactBtn.disabled = !!disabled;
    reactOnlyBtn.disabled = !!disabled;
  };

  const saveDefaultReaction = async (reactionValue) => {
    // onConfirm呼び出し
    if (onConfirm) {
      await Promise.resolve(onConfirm(reactionValue));
    }

    // settingsManager 側も即時更新し、キャッシュ読込 UI にすぐ反映
    try {
      if (settingsManager && typeof settingsManager.set === 'function') {
        settingsManager.set('reactionDefault', reactionValue);
      }
    } catch (e) { console.warn('[Modals] settingsManager.set に失敗', e); }

    // 即時変更をリスナーへ通知
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('reactionDefaultChanged', { detail: reactionValue }));
      }
    } catch (e) { }

    // localStorage 反映待ち（後方互換の検証は行うが即時 UI 反映には不要）
    await new Promise(resolve => setTimeout(resolve, 150));
    // localStorageに保存されたか検証
    const savedSettings = localStorage.getItem('appSettings');
    if (savedSettings) {
      const settings = JSON.parse(savedSettings);
      if (getReactionContent(settings.reactionDefault) === getReactionContent(reactionValue)) {
        // 成功
        if (statusEl) {
          statusEl.textContent = t('reaction.saved');
          statusEl.textContent = t('reaction.saved');
          statusEl.className = 'muted status-success';
        }
      } else {
        // localStorage 未反映でも settingsManager 更新済みなので成功扱い
        if (statusEl) {
          statusEl.textContent = t('reaction.saved');
          statusEl.className = 'muted status-success';
        }
      }
    } else {
      // appSettings がなくても settingsManager 更新済みなので成功扱い
      if (statusEl) {
        statusEl.textContent = t('reaction.saved');
        statusEl.className = 'muted status-success';
      }
    }
  };

  // クイックリアクションボタンセットアップ
  const quickButtons = modal.querySelectorAll('.reaction-quick-row .quick-reaction');
  quickButtons.forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const reaction = btn.dataset.reaction;
      if (reaction) {
        input.value = reaction;
        updateReactionPreview(modal, input);
        if (statusEl) statusEl.textContent = '';
      }
    };
  });

  // セクシー餃子（ステガノグラフィ）ボタンセットアップ
  const steganographyBtn = modal.querySelector('#reactionSteganographyBtn');
  if (steganographyBtn) {
    steganographyBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showHiddenTagCharModal((encoded) => {
        input.value = encoded;
        updateReactionPreview(modal, input);
        if (statusEl) statusEl.textContent = '';
        input.focus();
      });
    };
  }

  // 保存ボタン
  saveBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const validated = readValidatedReaction();
    if (!validated) return;
    const reactionValue = validated.reactionValue;

    const ok = await checkRelativeUrlConfirmation(reactionValue);
    if (!ok) return;

    // 二重クリック防止
    setButtonsDisabled(true);
    if (statusEl) {
      statusEl.textContent = t('reaction.saving');
      statusEl.className = 'muted status-muted';
    }

    try {
      await saveDefaultReaction(reactionValue);
      pushRecentReaction(reactionValue);
      renderRecentReactions(modal, input, statusEl);
    } catch (err) {
      console.error('[Modals] リアクション保存エラー:', err);
      setErrorStatus(t('reaction.save_failed'));
    }
    // ボタン再有効化
    setButtonsDisabled(false);

    // ユーザーがフィードバックを確認できるよう短い遅延後に閉じる
    setTimeout(() => {
      try { closeModal(); } catch (e) { }
    }, 500);
  };

  saveAndReactBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!showReactActions || !onSaveAndReact) return;

    const validated = readValidatedReaction();
    if (!validated) return;
    const reactionValue = validated.reactionValue;

    const ok = await checkRelativeUrlConfirmation(reactionValue);
    if (!ok) return;

    setButtonsDisabled(true);
    try {
      await saveDefaultReaction(reactionValue);
      await Promise.resolve(onSaveAndReact(reactionValue));
      pushRecentReaction(reactionValue);
      renderRecentReactions(modal, input, statusEl);
      setTimeout(() => {
        try { closeModal(); } catch (e) { }
      }, 200);
    } catch (err) {
      console.error('[Modals] 保存してリアクションに失敗', err);
      setErrorStatus(t('reaction.save_failed'));
    }
    setButtonsDisabled(false);
  };

  reactOnlyBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!showReactActions || !onReactOnly) return;

    const validated = readValidatedReaction();
    if (!validated) return;
    const reactionValue = validated.reactionValue;

    const ok = await checkRelativeUrlConfirmation(reactionValue);
    if (!ok) return;

    setButtonsDisabled(true);
    try {
      await Promise.resolve(onReactOnly(reactionValue));
      pushRecentReaction(reactionValue);
      renderRecentReactions(modal, input, statusEl);
      setTimeout(() => {
        try { closeModal(); } catch (e) { }
      }, 200);
    } catch (err) {
      console.error('[Modals] 保存せずリアクションに失敗', err);
      setErrorStatus(t('reaction.save_failed'));
    }
    setButtonsDisabled(false);
  };

  // 閉じるボタン
  closeBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setTimeout(() => {
      closeModal();
    }, 50);
  };

  // 背景クリックみにで閉じる
  modal.onclick = (e) => {
    if (e.target === modal) {
      e.preventDefault();
      setTimeout(() => {
        closeModal();
      }, 50);
    }
  };

  input.oninput = () => {
    updateReactionPreview(modal, input);
    if (statusEl) statusEl.textContent = '';
  };

  // Enterキー対応
  input.onkeydown = (e) => {
  if (e.key === 'Enter') {
    // textareaではEnterで改行が入るのを防ぐ
    e.preventDefault();
    saveBtn.click();
  } else {
      // 入力時はステータスクリア
      if (statusEl) statusEl.textContent = '';
    }
  };

  // モーダル描画後にフォーカス・選択
  setTimeout(() => {
    try {
      input.focus();
      // 全選択せずキャレットを末尾へ配置
      const len = input.value ? input.value.length : 0;
      if (typeof input.setSelectionRange === 'function') {
        input.setSelectionRange(len, len);
      }
    } catch (e) { }
  }, 50);
}

// 前回の確認モーダルの keydown ハンドラ参照
let _prevConfirmKeyHandler = null;

/**
 * 確認ダイアログモーダルを表示
 */
export function showConfirmModal(title, message, onYes, onNo) {
  let actualTitle = title;
  let actualMessage = message;
  let actualOnYes = onYes;
  let actualOnNo = onNo;
  if (typeof message === 'function') {
    actualOnNo = actualOnYes;
    actualOnYes = message;
    actualMessage = '';
  }
  const modal = $('#confirmModal');
  const titleEl = $('#confirmTitle');
  const messageEl = $('#confirmMessage');
  const yesBtn = $('#confirmYes');
  const noBtn = $('#confirmNo');

  if (!modal || !titleEl || !messageEl || !yesBtn || !noBtn) return;

  // 前回のリスナーが残っていれば除去
  if (_prevConfirmKeyHandler) {
    document.removeEventListener('keydown', _prevConfirmKeyHandler);
    _prevConfirmKeyHandler = null;
  }

  // 内容セット（改行保持）
  titleEl.textContent = actualTitle || t('confirm.title');
  messageEl.textContent = actualMessage;


  // モーダル固定ラベルへ翻訳を適用
  try { if (typeof applyTranslations === 'function') applyTranslations(modal, true); } catch (e) { }

  bringModalTop(modal);

  modal.hidden = false;
  yesBtn.focus();

  // モーダル非表示時に z-index をクリア
  const clearZ = () => { try { modal.style.zIndex = ''; } catch (e) { } };

  // Enterキーでconfirm（はい）
  const _confirmKeyHandler = (ev) => {
    if (modal.hidden) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      yesBtn.click();
    }
  };
  document.addEventListener('keydown', _confirmKeyHandler);
  _prevConfirmKeyHandler = _confirmKeyHandler;
  const cleanupKey = () => {
    document.removeEventListener('keydown', _confirmKeyHandler);
    if (_prevConfirmKeyHandler === _confirmKeyHandler) {
      _prevConfirmKeyHandler = null;
    }
  };

  // はいボタン
  yesBtn.onclick = () => {
    modal.hidden = true;
    clearZ();
    cleanupKey();
    if (actualOnYes) actualOnYes();
  };

  // いいえボタン
  noBtn.onclick = () => {
    modal.hidden = true;
    clearZ();
    cleanupKey();
    if (actualOnNo) actualOnNo();
  };

  // 背景クリックで閉じる（いいえと同じ）
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.hidden = true;
      clearZ();
      cleanupKey();
      if (actualOnNo) actualOnNo();
    }
  };
}

/**
 * 単体通知・警告用モーダルを表示
 */
export function showAlertModal(title, message, onOk) {
  const modal = $('#confirmModal');
  const titleEl = $('#confirmTitle');
  const messageEl = $('#confirmMessage');
  const yesBtn = $('#confirmYes');
  const noBtn = $('#confirmNo');

  if (!modal || !titleEl || !messageEl || !yesBtn) {
    alert(message || title);
    if (typeof onOk === 'function') onOk();
    return;
  }

  titleEl.textContent = title || t('confirm.title') || 'お知らせ';

  if (noBtn) noBtn.hidden = true;

  bringModalTop(modal);

  modal.hidden = false;
  yesBtn.focus();

  const handleOk = () => {
    modal.hidden = true;
    if (noBtn) noBtn.hidden = false;
    yesBtn.onclick = null;
    if (typeof onOk === 'function') onOk();
  };

  yesBtn.onclick = handleOk;
}

/**
 * omochat設定モーダルを表示
 */
export function showOmochatSettingsModal(settingsManager) {
  const modal = $('#omochatModal');
  const input = $('#omochatGeohashInput');
  const historyBtn = $('#omochatGeohashHistoryBtn');
  const historyPopup = $('#omochatGeohashHistoryPopup');
  const subordinateCheck = $('#omochatSubordinateCheck');
  const saveBtn = $('#omochatSaveBtn');
  const cancelBtn = $('#omochatCancelBtn');
  const statusEl = $('#omochatStatus');

  if (!modal || !input || !saveBtn) return;

  // 履歴リスト取得はgetGeohashHistory()で都度取得
  // 初期値セット
  const currentVal = settingsManager.get('omochatGeohash') || 'xn';
  input.value = currentVal;
  if (subordinateCheck) {
    subordinateCheck.checked = settingsManager.get('omochatSubordinate') === true;
  }
  const autoRelayCheck = $('#omochatAutoRelayCheck');
  if (autoRelayCheck) {
    autoRelayCheck.checked = settingsManager.get('omochatAutoRelays') !== false;
  }
  const autoRelayAlgoSelect = $('#omochatAutoRelayAlgoSelect');
  if (autoRelayAlgoSelect) {
    autoRelayAlgoSelect.value = settingsManager.get('omochatAutoRelayAlgo') || 'merged';
  }
  const mergeParentCheck = $('#omochatMergeParentCheck');
  if (mergeParentCheck) {
    mergeParentCheck.checked = settingsManager.get('omochatMergeParent') === true;
  }
  if (statusEl) statusEl.textContent = '';

  modal.hidden = false;

  // 翻訳を適用
  try { if (typeof applyTranslations === 'function') applyTranslations(modal, true); } catch (e) { }

  // 最前面へ
  bringModalTop(modal);

  const close = () => {
    modal.hidden = true;
    try { if (!window.bringModalToFront) modal.style.zIndex = ''; } catch(e){}
  };

  // 履歴は保存時のみ更新、開くたびに最新を取得
  function getGeohashHistory() {
    const arr = settingsManager.get('omochatGeohashHistory');
    return Array.isArray(arr) ? arr : [];
  }
  let geohashHistory = getGeohashHistory();

  // 履歴ポップアップ描画関数
  function renderHistoryPopup() {
    if (!historyPopup) return;
    geohashHistory = getGeohashHistory().slice().sort((a, b) => a.localeCompare(b));
    historyPopup.innerHTML = '';
    const tFn = (typeof t === 'function') ? t : (window.t || ((k) => k));
    if (!geohashHistory.length) {
      const empty = document.createElement('div');
      empty.className = 'geohash-history-empty';
      empty.textContent = tFn('omochat.geohash_history.empty');
      historyPopup.appendChild(empty);
      return;
    }
    geohashHistory.forEach((gh, idx) => {
      const row = document.createElement('div');
      row.className = 'history-row';
      const label = document.createElement('span');
      label.textContent = gh;
      label.className = 'history-label';
      label.onclick = () => {
        input.value = gh;
        historyPopup.classList.add('d-none');
        input.dispatchEvent(new Event('input'));
      };
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-remove history-delete-btn';
      delBtn.type = 'button';
      delBtn.title = tFn('relay.btn.remove.title');
      delBtn.textContent = '×';
      delBtn.onclick = (e) => {
        e.stopPropagation();
        geohashHistory.splice(idx, 1);
        settingsManager.set('omochatGeohashHistory', geohashHistory);
        renderHistoryPopup();
      };
      row.appendChild(label);
      row.appendChild(delBtn);
      historyPopup.appendChild(row);
    });
  }

  // 履歴ボタン挙動
  if (historyBtn && historyPopup) {
    historyBtn.onclick = (e) => {
      e.stopPropagation();
      const isVisible = historyPopup.style.display === 'block' || !historyPopup.classList.contains('d-none');
      if (isVisible && historyPopup.style.display !== 'none') {
        historyPopup.style.display = 'none';
        historyPopup.classList.add('d-none');
        return;
      }
      renderHistoryPopup();
      const isMobile = window.innerWidth <= 480;
      historyPopup.classList.remove('d-none');
      historyPopup.style.display = 'block';
      if (isMobile) {
        historyPopup.className = 'geohash-history-popup history-popup--mobile';
      } else {
        historyPopup.className = 'geohash-history-popup';
        historyPopup.style.left = '';
        historyPopup.style.top = '';
        historyPopup.style.minWidth = '';
      }
    };
    if (!historyPopup._outsideListenerSet) {
      historyPopup._outsideListenerSet = true;
      document.addEventListener('mousedown', function hidePopup(ev) {
        if (!historyPopup.contains(ev.target) && !historyBtn.contains(ev.target)) {
          historyPopup.style.display = 'none';
          historyPopup.classList.add('d-none');
        }
      });
    }
  }

  // リレーリスト管理
  const relayListEl = $('#omochatRelayList');
  const addRelayBtn = $('#omochatAddRelay');
  const resetRelaysBtn = $('#omochatResetRelays');
  let omochatRelays = (() => {
    const saved = settingsManager.get('omochatRelays');
    return Array.isArray(saved) && saved.length > 0 ? saved.slice() : DEFAULT_OMOCHAT_RELAYS.slice();
  })();

  function renderRelayList() {
    if (!relayListEl) return;
    relayListEl.innerHTML = '';
    omochatRelays.forEach((relay, index) => {
      const row = document.createElement('div');
      row.className = 'relay-row';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = relay;
      inp.className = 'relay-input-flex';
      inp.name = `omochat_relay_${index}`;
      inp.id = `omochat_relay_${index}`;
      inp.setAttribute('aria-label', (typeof t === 'function' ? t('relay.input.placeholder') : '') || 'Relay URL');
      inp.onchange = () => { omochatRelays[index] = inp.value.trim(); };
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary relay-remove-btn';
      removeBtn.textContent = '✕';
      removeBtn.onclick = () => {
        if (omochatRelays.length > 1) {
          omochatRelays.splice(index, 1);
          renderRelayList();
        }
      };
      row.appendChild(inp);
      row.appendChild(removeBtn);
      relayListEl.appendChild(row);
    });
  }

  let activeUpdateId = 0;
  async function updateRelayListUI(forceRefresh = false) {
    if (!relayListEl) return;
    const isAuto = autoRelayCheck ? autoRelayCheck.checked : false;
    const algoContainer = $('#omochatAutoRelayAlgoContainer');
    if (algoContainer) {
      algoContainer.classList.toggle('d-none', !isAuto);
    }
    const mergeParentContainer = $('#omochatMergeParentContainer');
    if (mergeParentContainer) {
      mergeParentContainer.classList.toggle('d-none', !isAuto);
    }
    const refreshContainer = $('#omochatRefreshGeoRelaysContainer');
    if (refreshContainer) {
      refreshContainer.classList.toggle('d-none', !isAuto);
    }

    if (isAuto) {
      if (addRelayBtn) addRelayBtn.classList.add('d-none');
      if (resetRelaysBtn) resetRelaysBtn.classList.add('d-none');

      const currentGeohash = input.value.trim() || 'xn';
      const algo = autoRelayAlgoSelect ? autoRelayAlgoSelect.value : 'merged';
      const mergeParent = mergeParentCheck ? mergeParentCheck.checked : false;
      const myUpdateId = ++activeUpdateId;
      relayListEl.innerHTML = '<div class="muted text-sm" style="padding:4px;">' + t('omochat.relays.computing') + '</div>';

      const autoRelays = await getClosestRelays(currentGeohash, 5, algo, mergeParent, forceRefresh);
      if (myUpdateId !== activeUpdateId) return;

      relayListEl.innerHTML = '';
      if (autoRelays && autoRelays.length > 0) {
        autoRelays.forEach(relay => {
          const row = document.createElement('div');
          row.className = 'relay-row--readonly';
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.value = relay;
          inp.className = 'relay-input-flex';
          inp.readOnly = true;
          row.appendChild(inp);
          relayListEl.appendChild(row);
        });
      } else {
        relayListEl.innerHTML = '<div class="muted text-sm text-accent" style="padding:4px;">' + t('omochat.relays.geo_failed') + '</div>';
      }
    } else {
      if (addRelayBtn) addRelayBtn.classList.remove('d-none');
      if (resetRelaysBtn) resetRelaysBtn.classList.remove('d-none');
      renderRelayList();
    }
  }

  updateRelayListUI();

  if (autoRelayCheck) {
    autoRelayCheck.onchange = () => updateRelayListUI();
  }
  if (autoRelayAlgoSelect) {
    autoRelayAlgoSelect.onchange = () => updateRelayListUI();
  }
  if (mergeParentCheck) {
    mergeParentCheck.onchange = () => updateRelayListUI();
  }
  input.oninput = () => {
    if (autoRelayCheck && autoRelayCheck.checked) {
      updateRelayListUI();
    }
  };

  const refreshGeoRelaysBtn = $('#omochatRefreshGeoRelaysBtn');
  if (refreshGeoRelaysBtn) {
    refreshGeoRelaysBtn.onclick = async () => {
      refreshGeoRelaysBtn.disabled = true;
      try {
        await updateRelayListUI(true);
        showToast(t('omochat.relays.georelays_refreshed'), { type: 'success' });
      } catch (e) {
        console.error('[omochat] GeoRelays更新失敗:', e);
      } finally {
        refreshGeoRelaysBtn.disabled = false;
      }
    };
  }

  if (addRelayBtn) {
    addRelayBtn.onclick = () => {
      omochatRelays.push('wss://');
      renderRelayList();
    };
  }
  if (resetRelaysBtn) {
    resetRelaysBtn.onclick = () => {
      omochatRelays = DEFAULT_OMOCHAT_RELAYS.slice();
      renderRelayList();
    };
  }

  // 保存ボタン
  saveBtn.onclick = () => {
    const val = input.value.trim() || 'xn'; // 空の場合は xn を既定値とする
    settingsManager.set('omochatGeohash', val);
    if (subordinateCheck) {
      settingsManager.set('omochatSubordinate', subordinateCheck.checked);
    }
    const isAuto = autoRelayCheck ? autoRelayCheck.checked : false;
    settingsManager.set('omochatAutoRelays', isAuto);

    const algo = autoRelayAlgoSelect ? autoRelayAlgoSelect.value : 'merged';
    settingsManager.set('omochatAutoRelayAlgo', algo);

    const mergeParent = mergeParentCheck ? mergeParentCheck.checked : false;
    settingsManager.set('omochatMergeParent', mergeParent);

    if (!isAuto) {
      // リレー保存（空入力を除外し、1件以上保証）
      const validRelays = omochatRelays.map(r => r.trim()).filter(r => r.length > 0);
      settingsManager.set('omochatRelays', validRelays.length > 0 ? validRelays : DEFAULT_OMOCHAT_RELAYS.slice());
    }

    // 履歴に追加（重複なし、先頭）
    let hist = getGeohashHistory();
    if (val && val.length > 0) {
      hist = hist.filter(v => v !== val);
      hist.unshift(val);
      if (hist.length > 20) hist = hist.slice(0, 20);
      settingsManager.set('omochatGeohashHistory', hist);
    }
    // タブ更新と feed 再読込をアプリへ通知
    try { window.dispatchEvent(new Event('omochatSettingsSaved')); } catch (e) { }
    close();
  };

  if (cancelBtn) cancelBtn.onclick = close;

  modal.onclick = (e) => {
    if (e.target === modal) close();
  };
}

/**
 * 全モーダル共通: ESCキーで閉じる（モーダル外クリックと同じ）
 */
export function setupModalEscClose() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const openModals = Array.from(document.querySelectorAll('.modal:not([hidden])'));
    if (!openModals.length) return;
    // 最前面のモーダルを z-index 優先で判定（同値時は後勝ち）
    const modal = openModals.reduce((top, current) => {
      if (!top) return current;
      const topZ = parseInt(window.getComputedStyle(top).zIndex, 10);
      const currentZ = parseInt(window.getComputedStyle(current).zIndex, 10);
      const safeTopZ = isNaN(topZ) ? 0 : topZ;
      const safeCurrentZ = isNaN(currentZ) ? 0 : currentZ;
      return safeCurrentZ >= safeTopZ ? current : top;
    }, null);
    if (!modal) return;
    e.preventDefault();
    // 閉じる/キャンセル/いいえボタンを探してクリック（既存のクリーンアップ処理を活用）
    const closeBtn = modal.querySelector(
      'button[id$="Close"], button[id$="Cancel"], button[id$="CancelBtn"], button[id$="No"]'
    );
    if (closeBtn) {
      closeBtn.click();
    } else {
      modal.hidden = true;
    }
  });
}

const STEGANOGRAPHY_LAST_EMOJI_KEY = 'steganography_last_emoji';
const STEGANOGRAPHY_EMOJI_HISTORY_KEY = 'steganography_emoji_history';

function loadSteganographyEmojiHistory() {
  try {
    const raw = localStorage.getItem(STEGANOGRAPHY_EMOJI_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter(item => typeof item === 'string' && item.trim().length > 0);
    }
  } catch (e) { }
  return [];
}

function saveSteganographyEmojiHistory(history) {
  try {
    localStorage.setItem(STEGANOGRAPHY_EMOJI_HISTORY_KEY, JSON.stringify(history.slice(0, 8)));
  } catch (e) { }
}

function pushSteganographyEmojiHistory(emoji) {
  if (!emoji) return;
  const list = loadSteganographyEmojiHistory();
  const filtered = list.filter(item => item !== emoji);
  filtered.unshift(emoji);
  saveSteganographyEmojiHistory(filtered);
}

function loadSteganographyLastEmoji() {
  try {
    const saved = localStorage.getItem(STEGANOGRAPHY_LAST_EMOJI_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch (e) { }
  return '🥟';
}

function saveSteganographyLastEmoji(emoji) {
  try {
    if (emoji && emoji.trim()) localStorage.setItem(STEGANOGRAPHY_LAST_EMOJI_KEY, emoji.trim());
  } catch (e) { }
}

/**
 * 隠し文字埋め込みモーダルを表示
 */
export function showHiddenTagCharModal(onConfirm) {
  const modal = $('#steganographyModal');
  if (!modal) {
    console.warn('[Modals] #steganographyModal が見つかりません');
    return;
  }

  const emojiInput = modal.querySelector('#steganographyEmoji');
  const historyContainer = modal.querySelector('#steganographyEmojiHistory');
  const textInput = modal.querySelector('#steganographyText');
  const confirmBtn = modal.querySelector('#steganographyConfirm');
  const closeBtn = modal.querySelector('#steganographyClose');
  const statusEl = modal.querySelector('#steganographyStatus');

  if (!emojiInput || !textInput || !confirmBtn || !closeBtn) {
    console.warn('[Modals] 隠し文字埋め込みモーダルの要素が不足');
    return;
  }

  // モーダル表示
  modal.hidden = false;
  const initialEmoji = loadSteganographyLastEmoji();
  emojiInput.value = initialEmoji;
  textInput.value = '';
  if (statusEl) statusEl.textContent = '';

  function renderEmojiHistory() {
    if (!historyContainer) return;
    historyContainer.innerHTML = '';
    const history = loadSteganographyEmojiHistory();
    if (!history || history.length === 0) {
      historyContainer.hidden = true;
      return;
    }
    historyContainer.hidden = false;
    const currentVal = (emojiInput.value || '').trim();

    for (const em of history.slice(0, 8)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'steganography-history-chip' + (em === currentVal ? ' active' : '');
      chip.textContent = em;
      chip.title = em;
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        emojiInput.value = em;
        renderEmojiHistory();
        textInput.focus();
      });
      historyContainer.appendChild(chip);
    }
  }

  renderEmojiHistory();
  emojiInput.oninput = () => {
    renderEmojiHistory();
  };

  // 前面化
  bringModalTop(modal);

  // 翻訳適用
  try { if (typeof applyTranslations === 'function') applyTranslations(modal, true); } catch (e) { }

  // フォーカス
  textInput.focus();

  // 確定ボタン
  confirmBtn.onclick = async () => {
    const emoji = (emojiInput.value || '').trim();
    const text = (textInput.value || '').trim();

    if (!emoji) {
      if (statusEl) statusEl.textContent = t('steganography.error.emoji_required');
      return;
    }
    if (!text) {
      if (statusEl) statusEl.textContent = t('steganography.error.text_required');
      return;
    }

    saveSteganographyLastEmoji(emoji);
    pushSteganographyEmojiHistory(emoji);

    // エンコード処理
    try {
      // window グローバルから取得、または動的インポート
      let encodeHiddenTagChars = null;
      if (typeof window !== 'undefined' && window.encodeHiddenTagChars) {
        encodeHiddenTagChars = window.encodeHiddenTagChars;
      } else {
        const utils = await import('../../utils/utils.js');
        encodeHiddenTagChars = utils.encodeHiddenTagChars;
      }

      const encoded = encodeHiddenTagChars(emoji, text);
      if (typeof onConfirm === 'function') {
        onConfirm(encoded);
      }
      modal.hidden = true;
      try { modal.style.zIndex = ''; } catch (e) { }
    } catch (e) {
      console.warn('[Modals] エンコード失敗', e);
      if (statusEl) statusEl.textContent = t('steganography.error.encode_failed');
    }
  };

  // 閉じるボタン
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.hidden = true;
      try { modal.style.zIndex = ''; } catch (e) { }
    };
  }

  // 背景クリックで閉じる
  modal.onclick = (e) => {
    if (e.target === modal) {
      e.preventDefault();
      modal.hidden = true;
      if (statusEl) statusEl.textContent = '';
      try { modal.style.zIndex = ''; } catch (e) { }
    }
  };
}
