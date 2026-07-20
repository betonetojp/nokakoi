// ============================================================================
// グローバルフィード用リレーセレクタ
// ============================================================================

import { t, applyTranslations } from '../../utils/i18n.js';
import { loadRelays } from '../../core/relay.js';

function countReadRelays(relays) {
  return (relays || []).filter(r => {
    const o = typeof r === 'string' ? { url: r, read: true } : r;
    return o && o.read !== false;
  }).length;
}

function formatRelayCountLabel(n) {
  const s = String(n);
  return n === 1
    ? t('globalRelay.count_1', { n: s })
    : t('globalRelay.count', { n: s });
}

function formatHomePlusLabel(n) {
  return t('globalRelay.home_and_relays', { n: String(n) });
}

/**
 * グローバルフィード用リレー選択モーダルを表示
 */
export function showGlobalRelaySelector(state, settingsManager, onSelect) {
  const relays = state.relays || [];
  // モーダル重複生成を防止（特にタッチ端末の再発火対策）
  try {
    if (typeof document !== 'undefined') {
      const existing = document.querySelector('.modal.relay-selector-modal');
      if (existing) return; // すでに表示中
    }
  } catch (e) { }

  const mergeHome = settingsManager.get('globalMergeHome') === true;
  // null/undefined=全リレー、[]=ホームのみ（mergeHome時）、array=部分選択
  const rawGlobalRelay = settingsManager.get('globalRelay');
  const allRelaysSelected = rawGlobalRelay === null || typeof rawGlobalRelay === 'undefined';
  let selectedRelays = null;
  if (typeof rawGlobalRelay === 'string') {
    selectedRelays = rawGlobalRelay ? [rawGlobalRelay] : [];
  } else if (Array.isArray(rawGlobalRelay)) {
    selectedRelays = rawGlobalRelay;
  }

  const isLoggedIn = (() => {
    try { return !!localStorage.getItem('pubkey'); } catch (e) { return false; }
  })();

  // モーダル作成 (DOMメソッドで安全に生成し、i18n対応)
  const modal = document.createElement('div');
  // 重複防止判定で識別できるようクラス付与
  modal.className = 'modal relay-selector-modal';

  const body = document.createElement('div');
  body.className = 'modal-body panel';

  const h2 = document.createElement('h2');
  h2.setAttribute('data-i18n', 'globalRelay.title');
  body.appendChild(h2);

  const p = document.createElement('p');
  p.className = 'muted';
  p.setAttribute('data-i18n', 'globalRelay.summary');
  body.appendChild(p);

  const selector = document.createElement('div');
  selector.id = 'relaySelector';
  selector.className = 'relay-selector';
  body.appendChild(selector);

  const row = document.createElement('div');
  row.className = 'row';
  row.style.marginTop = '12px';

  const confirmBtn = document.createElement('button');
  confirmBtn.id = 'confirmRelay';
  confirmBtn.type = 'button';
  confirmBtn.className = 'primary';
  confirmBtn.setAttribute('data-i18n', 'confirm.yes');

  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'cancelRelay';
  cancelBtn.type = 'button';
  cancelBtn.className = 'secondary';
  cancelBtn.setAttribute('data-i18n', 'cancel');

  row.appendChild(confirmBtn);
  row.appendChild(cancelBtn);
  body.appendChild(row);

  modal.appendChild(body);
  document.body.appendChild(modal);

  // ホームタイムラインオプション（先頭）
  const homeOption = document.createElement('label');
  homeOption.className = 'relay-option';

  const homeInput = document.createElement('input');
  homeInput.type = 'checkbox';
  homeInput.name = 'globalRelay_home';
  homeInput.checked = mergeHome;
  homeInput.disabled = !isLoggedIn;

  const homeSpan = document.createElement('span');
  homeSpan.setAttribute('data-i18n', 'globalRelay.home');

  homeOption.appendChild(homeInput);
  homeOption.appendChild(homeSpan);
  selector.appendChild(homeOption);

  if (!isLoggedIn) {
    const homeHint = document.createElement('p');
    homeHint.className = 'muted';
    homeHint.style.margin = '4px 0 8px 0';
    homeHint.style.fontSize = '0.85em';
    homeHint.setAttribute('data-i18n', 'globalRelay.home_login_required');
    selector.appendChild(homeHint);
  }

  // リレーリストを表示
  // 注: 「全て」専用チェックは置かない。read対象が全選択または0件なら全体扱い（ホームマージ時を除く）。
  let totalReadCount = 0;

  // 個別リレーオプション追加（read有効のみ）
  relays.forEach(relay => {
    const relayObj = typeof relay === 'string' ? { url: relay, read: true } : relay;
    if (!relayObj.read) return; // 読込無効は除外
    totalReadCount++;

    const option = document.createElement('label');
    option.className = 'relay-option';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'globalRelay_item';
    input.value = relayObj.url;

    if (mergeHome && Array.isArray(selectedRelays) && selectedRelays.length === 0) {
      input.checked = false;
    } else if (allRelaysSelected || (Array.isArray(selectedRelays) && selectedRelays.length === 0)) {
      input.checked = true;
    } else if (Array.isArray(selectedRelays) && selectedRelays.indexOf(relayObj.url) !== -1) {
      input.checked = true;
    }

    const span = document.createElement('span');
    span.textContent = relayObj.url; // リレーURLはそのままリテラルで表示

    option.appendChild(input);
    option.appendChild(span);
    selector.appendChild(option);
  });

  // 決定ボタン
  confirmBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const homeChecked = homeInput.checked;
    let selected = [];
    const items = modal.querySelectorAll('input[name="globalRelay_item"]');
    items.forEach(it => { try { if (it.checked) selected.push(it.value); } catch (e) { } });

    settingsManager.set('globalMergeHome', homeChecked);

    if (!homeChecked) {
      // 未選択または全read選択なら「全体扱い」
      if (selected.length === 0 || selected.length === totalReadCount) {
        settingsManager.set('globalRelay', null);
        if (onSelect) onSelect(null);
      } else {
        settingsManager.set('globalRelay', selected);
        if (onSelect) onSelect(selected);
      }
    } else {
      if (selected.length === 0) {
        settingsManager.set('globalRelay', []);
        if (onSelect) onSelect([]);
      } else if (selected.length === totalReadCount) {
        settingsManager.set('globalRelay', null);
        if (onSelect) onSelect(null);
      } else {
        settingsManager.set('globalRelay', selected);
        if (onSelect) onSelect(selected);
      }
    }

    updateGlobalButtonLabel(settingsManager);

    // タッチ環境での再入を避けるため、soft reload 前に同期的にモーダルを閉じる
    try {
      if (modal.parentNode) document.body.removeChild(modal);
    } catch (e) { /* 無視 */ }

    // pool再生成とフィード再起動のため soft reload を実行
    try {
      if (typeof window !== 'undefined') {
        if (typeof window.softReload === 'function') {
          window.softReload();
        } else {
          // フォールバック: main.js 側イベントを発火
          try { window.dispatchEvent(new CustomEvent('softReloadRequest')); } catch (e) { }
        }
      }
    } catch (e) { /* 無視 */ }
  };

  // キャンセルボタン
  cancelBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setTimeout(() => {
      if (modal.parentNode) {
        document.body.removeChild(modal);
      }
    }, 50);
  };

  // 背景クリックで閉じる
  modal.onclick = (e) => {
    if (e.target === modal) {
      try { if (modal.parentNode) document.body.removeChild(modal); } catch (e) { }
    }
  };
  // モーダル内の翻訳を適用（data-i18nキー使用箇所）
  try { applyTranslations(modal); } catch (e) { }
}

/**
 * グローバルボタンのラベルをリレー/ホーム設定で更新
 */
export function updateGlobalButtonLabel(settingsManager) {
  const btn = document.querySelector('.tab[data-tab="global"]');
  if (!btn || !settingsManager) return;

  const mergeHome = settingsManager.get('globalMergeHome') === true;
  const relay = settingsManager.get('globalRelay');

  const setPlainLabel = (text) => {
    btn.textContent = text;
    try { btn.removeAttribute('data-i18n'); } catch (e) { }
    try { if (btn.dataset) delete btn.dataset.i18nLang; } catch (e) { }
  };

  const setI18nLabel = (key) => {
    try { btn.setAttribute('data-i18n', key); } catch (e) { }
    try { if (btn.dataset) delete btn.dataset.i18nLang; } catch (e) { }
    try { applyTranslations(btn); } catch (e) { }
  };

  try {
    if (mergeHome) {
      if (Array.isArray(relay) && relay.length === 0) {
        setI18nLabel('tabs.home');
        return;
      }
      if (!relay) {
        setPlainLabel(formatHomePlusLabel(countReadRelays(loadRelays())));
        return;
      }
      if (Array.isArray(relay)) {
        setPlainLabel(formatHomePlusLabel(relay.length));
        return;
      }
      if (typeof relay === 'string') {
        setPlainLabel(formatHomePlusLabel(1));
        return;
      }
    }

    // ホームマージ OFF: リレーラベル
    if (!relay || (Array.isArray(relay) && relay.length === 0)) {
      setPlainLabel(formatRelayCountLabel(countReadRelays(loadRelays())));
      return;
    }

    if (Array.isArray(relay)) {
      if (relay.length === 1) {
        setPlainLabel(t('globalRelay.count_1', { n: '1' }));
        return;
      }
      setPlainLabel(t('globalRelay.count', { n: String(relay.length) }));
      return;
    }

    if (typeof relay === 'string') {
      try {
        const url = new URL(relay);
        setPlainLabel(url.hostname);
      } catch {
        setPlainLabel(relay || t('tabs.global'));
      }
    }
  } catch (e) { }
}

/**
 * グローバルタブの長押し・右クリックメニューセットアップ
 */
export function setupGlobalTabSelector(state, settingsManager, onSelect) {
  const btn = document.querySelector('.tab[data-tab="global"]');
  if (!btn) return;

  let longPressTimer = null;
  let startX, startY;
  let hasMoved = false;
  let longPressTriggered = false;

  // タッチデバイス用長押し
  btn.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    hasMoved = false;
    longPressTriggered = false;

    longPressTimer = setTimeout(() => {
      longPressTriggered = true;
      showGlobalRelaySelector(state, settingsManager, onSelect);
    }, 600);
    e.preventDefault();
  }, { passive: false });

  btn.addEventListener('touchmove', (e) => {
    if (hasMoved) return;
    const touch = e.touches[0];
    if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
      hasMoved = true;
      if (longPressTimer) clearTimeout(longPressTimer);
    }
  }, { passive: true });

  btn.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (longPressTimer) clearTimeout(longPressTimer);
    if (!longPressTriggered && !hasMoved) {
      btn.click();
    }
  });

  // デスクトップ用右クリック
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showGlobalRelaySelector(state, settingsManager, onSelect);
    return false;
  });

  // ボタンラベル初期化
  updateGlobalButtonLabel(settingsManager);
}
