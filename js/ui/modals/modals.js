// ============================================================================
// モーダルダイアログ
// ============================================================================

import { $, buildReactionEmojiTags, buildStoredReactionValue, getReactionContent, isReactionShortcodeOnly, resolveReactionCustomEmoji } from '../../utils/utils.js';
import { t, applyTranslations } from '../../utils/i18n.js';
import { DEFAULT_OMOCHAT_RELAYS } from '../../config/constants.js';
import { attachEmojiShortcodeSuggest } from '../../features/emoji/emoji-shortcode-suggest.js';
import { getClosestRelays } from '../../features/relay/geo-relay-directory.js';

const HIDDEN_TAG_CHARS_RE = /[\u{E0100}-\u{E01EF}]+/gu;
const RECENT_REACTIONS_KEY = 'recentReactions';
const MAX_RECENT_REACTIONS = 24;
let reactionShortcodeSuggest = null;

function countGraphemeClusters(text) {
  if (!text) return 0;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
      let count = 0;
      for (const _ of segmenter.segment(text)) count++;
      return count;
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
}

function loadRecentReactions() {
  try {
    const raw = localStorage.getItem(RECENT_REACTIONS_KEY);
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
    localStorage.setItem(RECENT_REACTIONS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
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
      btn.textContent = content;
    }

    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
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

  // ヘルパーがあれば最前面へ、なければ高い z-index を設定
  try {
    if (typeof window !== 'undefined' && typeof window.bringModalToFront === 'function') {
      try { window.bringModalToFront(modal); } catch (e) { /* 無視 */ }
    } else {
      // フォールバック: このモーダルを他より前面にする
      modal.style.zIndex = '9999';
    }
  } catch (e) { /* 無視 */ }

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
  const quickButtons = modal.querySelectorAll('.quick-reaction');
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

  // 保存ボタン
  saveBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const validated = readValidatedReaction();
    if (!validated) return;
    const reactionValue = validated.reactionValue;

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

/**
 * 確認ダイアログモーダルを表示
 */
export function showConfirmModal(title, message, onYes, onNo) {
  const modal = $('#confirmModal');
  const titleEl = $('#confirmTitle');
  const messageEl = $('#confirmMessage');
  const yesBtn = $('#confirmYes');
  const noBtn = $('#confirmNo');

  if (!modal || !titleEl || !messageEl || !yesBtn || !noBtn) return;

  // 内容セット（改行保持）
  titleEl.textContent = title || t('confirm.title');
  messageEl.textContent = message;

  // モーダル固定ラベルへ翻訳を適用
  try { if (typeof applyTranslations === 'function') applyTranslations(modal, true); } catch (e) { }

  // 確認モーダルを最前面に（利用可能ならグローバルヘルパーを使用）
  try {
    if (typeof window !== 'undefined' && typeof window.bringModalToFront === 'function') {
      try { window.bringModalToFront(modal); } catch (e) { /* 無視 */ }
    } else {
      modal.style.zIndex = '9999';
    }
  } catch (e) { /* 無視 */ }

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
  const cleanupKey = () => { document.removeEventListener('keydown', _confirmKeyHandler); };

  // はいボタン
  yesBtn.onclick = () => {
    modal.hidden = true;
    clearZ();
    cleanupKey();
    if (onYes) onYes();
  };

  // いいえボタン
  noBtn.onclick = () => {
    modal.hidden = true;
    clearZ();
    cleanupKey();
    if (onNo) onNo();
  };

  // 背景クリックで閉じる（いいえと同じ）
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.hidden = true;
      clearZ();
      cleanupKey();
      if (onNo) onNo();
    }
  };
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
  try {
    if (typeof window !== 'undefined' && typeof window.bringModalToFront === 'function') {
      try { window.bringModalToFront(modal); } catch (e) { }
    } else {
      modal.style.zIndex = '9999';
    }
  } catch (e) { }

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
      label.onclick = (e) => {
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

  // 履歴ボタン挙動（重複登録防止のため一度だけセット）
  if (historyBtn && historyPopup && !historyBtn._historyListenerSet) {
    historyBtn._historyListenerSet = true;
    historyBtn.onclick = (e) => {
      renderHistoryPopup();
      // スマホ等狭い画面では中央に表示、PCは従来通り
      const isMobile = window.innerWidth <= 480;
      historyPopup.classList.remove('d-none');
      if (isMobile) {
        historyPopup.className = 'geohash-history-popup history-popup--mobile';
      } else {
        historyPopup.className = 'geohash-history-popup';
        const rect = historyBtn.getBoundingClientRect();
        historyPopup.style.left = rect.left + window.scrollX + 'px';
        historyPopup.style.top = (rect.bottom + window.scrollY + 2) + 'px';
        historyPopup.style.minWidth = rect.width + 120 + 'px';
      }
    };
    // 外クリックで閉じる（1回だけセット）
    if (!historyPopup._outsideListenerSet) {
      historyPopup._outsideListenerSet = true;
      document.addEventListener('mousedown', function hidePopup(ev) {
        if (!historyPopup.classList.contains('d-none') && !historyPopup.contains(ev.target) && ev.target !== historyBtn) {
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
  async function updateRelayListUI() {
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

    if (isAuto) {
      if (addRelayBtn) addRelayBtn.classList.add('d-none');
      if (resetRelaysBtn) resetRelaysBtn.classList.add('d-none');

      const currentGeohash = input.value.trim() || 'xn';
      const algo = autoRelayAlgoSelect ? autoRelayAlgoSelect.value : 'merged';
      const mergeParent = mergeParentCheck ? mergeParentCheck.checked : false;
      const myUpdateId = ++activeUpdateId;
      relayListEl.innerHTML = '<div class="muted text-sm" style="padding:4px;">リレーを計算中...</div>';

      const autoRelays = await getClosestRelays(currentGeohash, 5, algo, mergeParent);
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
        relayListEl.innerHTML = '<div class="muted text-sm text-accent" style="padding:4px;">位置情報リレーの取得に失敗しました。フォールバックリレーを使用します。</div>';
      }
    } else {
      if (addRelayBtn) addRelayBtn.classList.remove('d-none');
      if (resetRelaysBtn) resetRelaysBtn.classList.remove('d-none');
      renderRelayList();
    }
  }

  updateRelayListUI();

  if (autoRelayCheck) {
    autoRelayCheck.onchange = updateRelayListUI;
  }
  if (autoRelayAlgoSelect) {
    autoRelayAlgoSelect.onchange = updateRelayListUI;
  }
  if (mergeParentCheck) {
    mergeParentCheck.onchange = updateRelayListUI;
  }
  input.oninput = () => {
    if (autoRelayCheck && autoRelayCheck.checked) {
      updateRelayListUI();
    }
  };

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
  emojiInput.value = '🥟';
  textInput.value = '';
  if (statusEl) statusEl.textContent = '';

  // 前面化
  try {
    if (typeof window !== 'undefined' && typeof window.bringModalToFront === 'function') {
      window.bringModalToFront(modal);
    } else {
      modal.style.zIndex = '9999';
    }
  } catch (e) { }

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
    } catch (e) {
      console.warn('[Modals] エンコード失敗', e);
      if (statusEl) statusEl.textContent = t('steganography.error.encode_failed');
    }
  };

  // 閉じるボタン
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.hidden = true;
    };
  }

  // 背景クリックで閉じる
  modal.onclick = (e) => {
    if (e.target === modal) {
      e.preventDefault();
      modal.hidden = true;
      if (statusEl) statusEl.textContent = '';
      try { if (!window.bringModalToFront) modal.style.zIndex = ''; } catch (e) { }
    }
  };
}
