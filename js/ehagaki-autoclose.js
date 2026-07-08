import { getReadRelays } from './relay.js';
import { getSimplePool, getNostrTools } from './nostr-compat.js';
import { t } from './i18n.js';

// モーダル要素に「投稿後自動で閉じる」チェックボックスを追加し、
// 設定を localStorage に保存する。
export function addAutoCloseCheckbox(modalEl, opts = {}) {
  if (!modalEl || !(modalEl instanceof HTMLElement)) return null;
  try {
    const key = opts.storageKey || 'ehagaki_auto_close';
    const containerId = opts.containerId || 'ehagakiAutoCloseContainer';
    let container = modalEl.querySelector('#' + containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.gap = '8px';
      container.style.marginTop = '8px';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'ehagakiAutoCloseCheckbox';

      // 既定は ON
      const stored = localStorage.getItem(key);
      checkbox.checked = (stored === null) ? true : (stored !== '0');

      const label = document.createElement('label');
      label.htmlFor = checkbox.id;
      // ローカライズ済みラベルがあれば使用し、なければ日本語文言へフォールバック
      label.textContent = opts.labelText || t('postlink.auto_close') || '投稿後自動で閉じる';

      checkbox.addEventListener('change', (e) => {
        try {
          // ユーザー操作での変更時のみ保存する。プログラム変更（isTrusted === false）では
          // ユーザーの保存済み設定を上書きしない。
          if (e && e.isTrusted) {
            try { localStorage.setItem(key, checkbox.checked ? '1' : '0'); } catch (ee) { }
          }
        } catch (e) { /* ignore */ }
      });

      container.appendChild(checkbox);
      container.appendChild(label);

      // モーダル下部に追加。`.modal-footer` があれば優先して配置
      const footer = modalEl.querySelector('.modal-footer');
      if (footer) footer.appendChild(container);
      else {
        // modal-body の末尾に配置
        const body = modalEl.querySelector('.modal-body');
        if (body) body.appendChild(container);
        else modalEl.appendChild(container);
      }
    }

    return {
      isChecked: () => {
        const chk = modalEl.querySelector('#ehagakiAutoCloseCheckbox');
        if (!chk) return true;
        return !!chk.checked;
      }
    };
  } catch (e) {
    console.warn('[ehagaki-autoclose] チェックボックス追加に失敗', e);
    return null;
  }
}

// SimplePool プロバイダーを解決する内部ヘルパー
function resolveSimplePoolProvider() {
  try {
    try {
      const sp = getSimplePool();
      if (sp) return sp;
    } catch (e) { }
    const NT = getNostrTools();
    if (NT && NT.SimplePool) return NT.SimplePool;
    return null;
  } catch (e) { return null; }
}

// 現在ユーザーが publish したイベントのうち、expectedClientName に一致する client タグを含むものを待つ。
// 柔軟なシグネチャ:
//   waitForEhagakiPublish(state, closeModal, opts)
//   waitForEhagakiPublish(closeModal, opts)
// state 省略時は window.__nostrState の利用を試みる。
// opts.expectedClientName（string）は client タグ値との大文字小文字非依存部分一致に使う。
// opts.modalEl（HTMLElement）指定時は、待機中にモーダルが非表示/閉じたら待機を中断する。
// opts.timeoutMs <= 0 の場合は、イベント検知またはモーダルクローズまで無期限待機する。
export async function waitForEhagakiPublish(arg1, arg2, arg3) {
  let state = null;
  let closeModal = null;
  let opts = {};

  if (typeof arg1 === 'function' || arg1 === null) {
    // シグネチャ: (closeModal, opts)
    closeModal = arg1;
    opts = arg2 || {};
  } else {
    // シグネチャ: (state, closeModal, opts)
    state = arg1;
    closeModal = arg2;
    opts = arg3 || {};
  }

  if (!state && typeof window !== 'undefined') state = window.__nostrState || null;

  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 8000;
  const storageKey = opts.storageKey || 'ehagaki_auto_close';
  const expectedClientName = opts.expectedClientName ? String(opts.expectedClientName).toLowerCase() : null;
  const modalEl = (opts && opts.modalEl && opts.modalEl instanceof HTMLElement) ? opts.modalEl : null;

  try {
    const pubkey = localStorage.getItem('pubkey');
    if (!pubkey) return false;

    // 既存の接続済み pool を優先して relay socket を再利用
    let pool = (state && state.pool) ? state.pool : null;
    if (!pool) {
      const SimplePoolClass = resolveSimplePoolProvider();
      pool = typeof SimplePoolClass === 'function' ? new SimplePoolClass() : SimplePoolClass;
    }
    if (!pool) return false;

    let relays = getReadRelays((state && state.relays) ? state.relays : {});

    // 開始時刻を記録し、それ以降に作成されたイベントのみ判定対象にする
    const startSince = Math.floor(Date.now() / 1000);
    const filter = { kinds: [1], authors: [pubkey], since: startSince };

    return await new Promise((resolve) => {
      let done = false;
      let sub = null;
      let modalCheckInterval = null;
      let statePollInterval = null;
      let resolved = false;
      let pollingStarted = false;

      function cleanup() {
        try { if (sub && typeof sub.close === 'function') sub.close(); } catch (e) { }
        try { if (modalCheckInterval) clearInterval(modalCheckInterval); } catch (e) { }
        try { if (statePollInterval) clearInterval(statePollInterval); } catch (e) { }
      }

      // フォールバック: メモリ上の state feeds をポーリングし、pubkey 作成かつ client tag 一致の新規イベントを探す
      function startStatePolling() {
        try {
          if (pollingStarted) return;
          pollingStarted = true;
          if (!state) state = (typeof window !== 'undefined') ? window.__nostrState : null;
          if (!state || !state.feeds) return;
          statePollInterval = setInterval(() => {
            try {
              // feeds を走査
              for (const feedId of Object.keys(state.feeds || {})) {
                const feed = state.feeds[feedId];
                if (!feed || !Array.isArray(feed.list)) continue;
                for (const ev of feed.list) {
                  try {
                    if (!ev || ev.pubkey !== pubkey) continue;
                    if (!Array.isArray(ev.tags)) continue;
                    for (const t of ev.tags) {
                      if (!Array.isArray(t) || t.length < 2) continue;
                      const name = String(t[0] || '').toLowerCase();
                      const val = String(t[1] || '').toLowerCase();
                      if (name === 'client') {
                        const third = t.length > 2 ? String(t[2] || '') : '';
                        const matchedByHandler = third && third.indexOf(pubkey) !== -1;
                        const matched = expectedClientName ? (val.indexOf(expectedClientName) !== -1 || matchedByHandler) : (val.indexOf('ehagaki') !== -1 || matchedByHandler);
                        // モーダル表示時刻より古いイベントは除外
                        if ((!ev || !ev.created_at) || ev.created_at < startSince) continue;
                        if (matched && !done) {
                          done = true;
                          try {
                            const pref = (localStorage.getItem(storageKey) === null) ? true : (localStorage.getItem(storageKey) !== '0');
                            if (pref) {
                              try { if (typeof closeModal === 'function') closeModal(); } catch (e) { }
                            }
                          } catch (e) { }
                          cleanup();
                          if (!resolved) { resolved = true; resolve(true); }
                          return;
                        }
                      }
                    }
                  } catch (e) { }
                }
              }
            } catch (e) { }
          }, 800);
        } catch (e) { }
      }

      // フォールバック: feed に新規描画されたイベントを DOM からポーリング（badge または handler id で検知）
      function startDomPolling() {
        try {
          const viaPrefix = (typeof t === 'function') ? t('via') : 'via ';
          // DOM 上の初期イベント ID 集合を記録
          const existing = new Set();
          try { document.querySelectorAll && Array.from(document.querySelectorAll('.event')).forEach(el => { try { if (el.dataset && el.dataset.eventId) existing.add(el.dataset.eventId); } catch (e) { } }); } catch (e) { }
          const domInterval = setInterval(() => {
            try {
              const nodes = document.querySelectorAll && Array.from(document.querySelectorAll('.event')) || [];
              for (const el of nodes) {
                try {
                  const id = el && el.dataset && el.dataset.eventId;
                  if (!id || existing.has(id)) continue;
                  existing.add(id);
                  // テキスト内容から expectedClientName の via badge を確認（大文字小文字非依存）
                  const text = (el.textContent || '').toLowerCase();
                  const expect = (expectedClientName || 'ehagaki').toLowerCase();
                  if (expect && text.indexOf((viaPrefix || 'via ') + expect) !== -1) {
                    try { if (typeof closeModal === 'function') closeModal(); } catch (e) { }
                    clearInterval(domInterval);
                    cleanup();
                    if (!resolved) { resolved = true; resolve(true); }
                    return;
                  }
                  // 描画ノード内に handler pubkey が含まれる場合も一致とみなす
                  if (pubkey && text.indexOf(pubkey) !== -1) {
                    try { if (typeof closeModal === 'function') closeModal(); } catch (e) { }
                    clearInterval(domInterval);
                    cleanup();
                    if (!resolved) { resolved = true; resolve(true); }
                    return;
                  }
                } catch (e) { /* ignore node */ }
              }
            } catch (e) { }
          }, 600);
          // cleanup で domInterval が確実に解放されるようにする
          try { if (!statePollInterval) statePollInterval = domInterval; } catch (e) { }
        } catch (e) { }
      }

      try {
        sub = pool.subscribeMany(relays, [filter], {
          onevent: (ev) => {
            if (done || !ev) return;
            try {
              if (Array.isArray(ev.tags)) {
                for (const t of ev.tags) {
                  if (!Array.isArray(t) || t.length < 2) continue;
                  const name = String(t[0] || '').toLowerCase();
                  const val = String(t[1] || '').toLowerCase();
                  if (name === 'client') {
                    const third = t.length > 2 ? String(t[2] || '') : '';
                    const matchedByHandler = third && third.indexOf(pubkey) !== -1;
                    const matched = expectedClientName ? (val.indexOf(expectedClientName) !== -1 || matchedByHandler) : (val.indexOf('ehagaki') !== -1 || matchedByHandler);
                    // モーダル表示時刻より古いイベントは除外
                    if ((!ev || !ev.created_at) || ev.created_at < startSince) continue;
                    if (matched) {
                      done = true;
                      try {
                        const pref = (localStorage.getItem(storageKey) === null) ? true : (localStorage.getItem(storageKey) !== '0');
                        if (pref) {
                          try { if (typeof closeModal === 'function') closeModal(); } catch (e) { /* ignore */ }
                        }
                      } catch (e) { /* ignore */ }
                      cleanup();
                      if (!resolved) { resolved = true; resolve(true); }
                      return;
                    }
                  }
                }
              }
            } catch (e) { /* ignore */ }
          },
          oneose: () => {
            // subscription 終了時: state ポーリングのフォールバックを開始して待機継続
            startStatePolling();
            startDomPolling();
            // ここでは done/resolve しない。ポーリングでの検知を許可する
          },
          onerror: (err) => { try { startStatePolling(); startDomPolling(); } catch (ee) { } }
        });

        // cleanup と干渉しないよう sub.close をラップ
        try {
          if (sub && typeof sub.close === 'function') {
            const origClose = sub.close.bind(sub);
            sub.close = function () {
              try { return origClose(); } catch (e) { /* ignore */ }
            };
          }
        } catch (e) { /* ignore */ }

      } catch (e) {
        // subscribe 失敗時は state ポーリングへフォールバック
        startStatePolling();
        cleanup();
        if (!resolved) { resolved = true; resolve(false); }
      }

      // modalEl 指定時は hidden 状態をポーリングし、非表示/クローズで待機を中断
      if (modalEl) {
        try {
          modalCheckInterval = setInterval(() => {
            try {
              // モーダルが DOM から削除、または hidden なら中断
              if (!modalEl.isConnected || modalEl.hidden || modalEl.dataset && modalEl.dataset.ehagakiAutoCloseDisabled === '1') {
                done = true;
                cleanup();
                if (!resolved) { resolved = true; resolve(false); }
              }
            } catch (e) { }
          }, 500);
        } catch (e) { }
      }

      // timeoutMs > 0 ならタイムアウトを設定。<= 0 なら無期限待機（モーダルクローズまたはイベント検知まで）
      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        setTimeout(() => {
          if (!done) {
            done = true;
            cleanup();
            if (!resolved) { resolved = true; resolve(false); }
          }
        }, timeoutMs);
      }
    });
  } catch (e) {
    console.warn('[ehagaki-autoclose] 待機処理に失敗', e);
    return false;
  }
}

try {
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('nostr:published', (ev) => {
      try {
        const detail = ev && ev.detail ? ev.detail : null;
        if (!detail) return;
        try { console.debug('[ehagaki-autoclose] global nostr:published を受信', detail && detail.id); } catch (e) { }

        // auto-close 有効判定（実行時のモーダル/チェックボックス状態を優先）
        const isAutoCloseEnabled = (function () {
          try {
            const modalEl = (typeof document !== 'undefined') ? document.getElementById('ehagakiModal') : null;
            if (modalEl) {
              // 実行時 dataset で明示的に無効ならそれを優先
              if (modalEl.dataset && modalEl.dataset.ehagakiAutoCloseDisabled === '1') return false;
              const chk = modalEl.querySelector && modalEl.querySelector('#ehagakiAutoCloseCheckbox');
              if (chk) return !!chk.checked;
            }
          } catch (e) { }
          try {
            // フォールバック: 保存済み設定を使用（既定 ON）
            return (localStorage.getItem('ehagaki_auto_close') === null) ? true : (localStorage.getItem('ehagaki_auto_close') !== '0');
          } catch (e) { return true; }
        })();

        if (!isAutoCloseEnabled) {
          try { console.debug('[ehagaki-autoclose] global: 自動クローズ設定が無効'); } catch (e) { }
          return;
        }

        const pubkey = localStorage.getItem('pubkey');
        if (!pubkey) return;
        if (!detail.pubkey || String(detail.pubkey).toLowerCase() !== String(pubkey).toLowerCase()) {
          try { console.debug('[ehagaki-autoclose] global: 公開イベントの pubkey が不一致', detail && detail.pubkey); } catch (e) { }
          return;
        }
        const tags = detail.tags || [];
        for (const t of tags) {
          try {
            if (!Array.isArray(t) || t.length < 2) continue;
            const name = String(t[0] || '').toLowerCase();
            const val = String(t[1] || '').toLowerCase();
            if (name === 'client') {
              try { console.debug('[ehagaki-autoclose] global: client タグ', val, '全タグ', t); } catch (e) { }
              const third = t.length > 2 ? String(t[2] || '') : '';
              const matchedByHandler = third && third.indexOf(pubkey) !== -1;
              const matched = (val.indexOf('ehagaki') !== -1) || matchedByHandler;
              try { console.debug('[ehagaki-autoclose] global: 一致判定', { val, third, matchedByHandler, matched }); } catch (e) { }
              if (matched) {
                try {
                  const modal = document.getElementById('ehagakiModal');
                  const iframe = document.getElementById('ehagakiFrame');
                  if (modal && !modal.hidden) {
                    try { console.debug('[ehagaki-autoclose] global: イベントに対してモーダルを閉じる', detail && detail.id); } catch (e) { }
                    try { modal.hidden = true; } catch (e) { }
                    try { if (iframe) iframe.src = ''; } catch (e) { }
                  }
                } catch (e) { }
                return;
              }
            }
          } catch (e) { }
        }
      } catch (e) { }
    });
  }
} catch (e) { }
