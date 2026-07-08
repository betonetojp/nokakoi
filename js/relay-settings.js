// ============================================================================
// リレー設定UI
// ============================================================================

import { $, setStatus } from './utils.js';
import { defaultRelays, saveRelays, getReadRelays } from './relay.js';
import { showConfirmModal } from './modals.js';
import { t } from './i18n.js';
import { hideComposerForOverlay, restoreComposerFromOverlay } from './composer-scroll.js';

function _hideComposerForSettings() {
  hideComposerForOverlay();
}
function _restoreComposerFromSettings(container) {
  restoreComposerFromOverlay(container);
}

/**
 * リレーリストUIを描画
 * ---- 修正: innerHTML を直接使わず DOM API で要素を構築（XSS 対策）
 */
function renderRelayList(relays) {
  const container = $('#relayList');
  if (!container) return;

  container.innerHTML = '';

  relays.forEach((relay, index) => {
    const item = document.createElement('div');
    item.className = 'relay-item';
    item.dataset.index = index;

    // URL入力欄
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.value = relay.url || '';
    urlInput.placeholder = t('relay.input.placeholder');
    urlInput.setAttribute('data-field', 'url');
    // 任意: 極端に長いペイロード対策として長さ制限
    try { urlInput.maxLength = 256; } catch (e) { }

    // read チェック + ラベル
    const readLabel = document.createElement('label');
    const readCheckbox = document.createElement('input');
    readCheckbox.type = 'checkbox';
    readCheckbox.checked = !!relay.read;
    readCheckbox.setAttribute('data-field', 'read');
    readLabel.appendChild(readCheckbox);
    const readSpan = document.createElement('span');
    readSpan.textContent = t('relay.field.read');
    readLabel.appendChild(readSpan);

    // write チェック + ラベル
    const writeLabel = document.createElement('label');
    const writeCheckbox = document.createElement('input');
    writeCheckbox.type = 'checkbox';
    writeCheckbox.checked = !!relay.write;
    writeCheckbox.setAttribute('data-field', 'write');
    writeLabel.appendChild(writeCheckbox);
    const writeSpan = document.createElement('span');
    writeSpan.textContent = t('relay.field.write');
    writeLabel.appendChild(writeSpan);

    // 削除ボタン
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove';
    removeBtn.type = 'button';
    removeBtn.title = t('relay.btn.remove.title');
    removeBtn.textContent = '×';

    // 既定順で要素追加
    item.appendChild(urlInput);
    item.appendChild(readLabel);
    item.appendChild(writeLabel);
    item.appendChild(removeBtn);

    container.appendChild(item);
  });
}

/**
 * UIからリレーリストを取得
 */
function getRelayListFromUI() {
  const container = $('#relayList');
  if (!container) return [];

  const items = container.querySelectorAll('.relay-item');
  const relays = [];

  items.forEach(item => {
    const urlInput = item.querySelector('[data-field="url"]');
    const readCheckbox = item.querySelector('[data-field="read"]');
    const writeCheckbox = item.querySelector('[data-field="write"]');

    const url = (urlInput && urlInput.value) ? urlInput.value.trim() : '';
    // URLが空でなく有効な場合のみ追加
    if (url && (url.startsWith('wss://') || url.startsWith('ws://'))) {
      relays.push({
        url: url,
        read: readCheckbox ? readCheckbox.checked : true,
        write: writeCheckbox ? writeCheckbox.checked : true
      });
    }
  });

  return relays;
}

/**
 * リレー設定パネルのセットアップ
 */
export function setupRelaySettingsUI(state, relayConnect, getSimplePool, restartFeeds) {
  const container = $('#relayList');
  const addBtn = $('#addRelay');
  const saveBtn = $('#saveRelays');
  const resetBtn = $('#resetRelays');

  // 初期描画
  renderRelayList(state.relays);

  // リレー追加ボタン
  if (addBtn) {
    addBtn.onclick = () => {
      state.relays.push({ url: '', read: true, write: true });
      renderRelayList(state.relays);
      // 新規入力欄にフォーカス
      const items = container.querySelectorAll('.relay-item');
      const lastItem = items[items.length - 1];
      if (lastItem) {
        const input = lastItem.querySelector('[data-field="url"]');
        if (input) {
          input.focus();
        }
      }
    };
  }

  // リレー削除ボタン（イベント委譲）
  if (container) {
    container.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-remove')) {
        const item = e.target.closest('.relay-item');
        if (!item) return;
        const index = parseInt(item.dataset.index, 10);
        if (!isNaN(index)) {
          state.relays.splice(index, 1);
          renderRelayList(state.relays);
        }
      }
    });
  }

  // 保存ボタン
  if (saveBtn) {
    saveBtn.onclick = () => {
      const list = getRelayListFromUI();

      if (!list.length) {
        setStatus($('#relayStatus'), t('relay.save.noRelays'));
        return;
      }
      // 読込リレーが1つ以上あるか確認
      const hasReadRelay = list.some(r => r.read);
      if (!hasReadRelay) {
        setStatus($('#relayStatus'), t('relay.save.noReadRelay'));
        return;
      }
      state.relays = list;
      try { saveRelays(state.relays); } catch (e) { /* relayConnect 側から saveRelays が提供される場合あり */ }

      const SimplePool = getSimplePool();
      const ok = relayConnect(state, SimplePool, restartFeeds);

      const readCount = list.filter(r => r.read).length;
      const writeCount = list.filter(r => r.write).length;

      setStatus($('#relayStatus'), ok ?
        t('relay.save.status_connected', { total: list.length, readCount, writeCount }) :
        t('relay.save.status_no_lib'));

      restartFeeds(true);
      renderRelayList(state.relays);
    };
  }

  // リセットボタン
  if (resetBtn) {
    resetBtn.onclick = () => {
      showConfirmModal(
        t('relay.reset.title'),
        t('relay.reset.message'),
        () => {
          state.relays = JSON.parse(JSON.stringify(defaultRelays));
          try { saveRelays(state.relays); } catch (e) { }
          renderRelayList(state.relays);

          const SimplePool = getSimplePool();
          const ok = relayConnect(state, SimplePool, restartFeeds);
          restartFeeds(true);

          setStatus($('#relayStatus'), ok ?
            t('relay.reset.done') :
            t('relay.save.status_no_lib'));
        }
      );
    };
  }

  // kind:10002から読み込むボタン
  const importBtn = document.getElementById('importRelayKind10002');
  if (importBtn) {
    importBtn.onclick = async () => {
      try {
        const statusEl = $('#relayStatus');
        setStatus(statusEl, t('relay.import.fetching'));

        const SimplePool = getSimplePool();
        // 並列接続/REQの乱立を避けるため、可能なら既存 global pool を再利用
        const poolInstance = (state && state.pool) ? state.pool : (SimplePool ? new SimplePool() : null);
        const relaysForQuery = getReadRelays(state.relays);
        const pubkey = localStorage.getItem('pubkey');
        const filter = pubkey ? { kinds: [10002], authors: [pubkey], limit: 20 } : { kinds: [10002], limit: 20 };
        const results = [];

        await new Promise((resolve) => {
          try {
            if (!poolInstance) { resolve(); return; }
            const sub = poolInstance.subscribeMany(relaysForQuery, [filter], {
              onevent: (ev) => { if (ev) results.push(ev); },
              oneose: () => { resolve(); }
            });
            // セーフティタイムアウト
            setTimeout(() => { try { sub.close(); } catch (e) { }; resolve(); }, 4000);
          } catch (e) { resolve(); }
        });

        if (!results.length) {
          setStatus(statusEl, t('relay.import.notfound'));
          return;
        }

        // イベントから候補リレーURLを抽出（content JSON / tags / プレーンテキスト）
        const candidates = new Set();
        const urlRegex = /(wss?:\/\/[^\s,)\]]+)/g;
        for (const ev of results) {
          try {
            if (ev.tags && Array.isArray(ev.tags)) {
              for (const tag of ev.tags) {
                try {
                  if (Array.isArray(tag) && tag.length >= 2) {
                    const maybe = String(tag[1] || '').trim();
                    if (maybe && (maybe.startsWith('wss://') || maybe.startsWith('ws://'))) candidates.add(maybe.replace(/\/+$/g, ''));
                  }
                } catch (e) { }
              }
            }

            if (ev.content && typeof ev.content === 'string') {
              // まず JSON パースを試行
              try {
                const parsed = JSON.parse(ev.content);
                if (Array.isArray(parsed)) {
                  for (const p of parsed) {
                    if (typeof p === 'string' && (p.startsWith('wss://') || p.startsWith('ws://'))) candidates.add(p.trim().replace(/\/+$/g, ''));
                  }
                } else if (parsed && typeof parsed === 'object') {
                  // よくあるフィールド名を探索
                  const fields = ['relays', 'servers', 'urls', 'list'];
                  for (const f of fields) {
                    if (Array.isArray(parsed[f])) {
                      for (const u of parsed[f]) {
                        if (typeof u === 'string' && (u.startsWith('wss://') || u.startsWith('ws://'))) candidates.add(u.trim().replace(/\/+$/g, ''));
                      }
                    }
                  }
                }
              } catch (e) {
                // フォールバック: 正規表現でURL走査
                try {
                  const m = ev.content.match(urlRegex);
                  if (m) {
                    for (const u of m) candidates.add(u.trim().replace(/\/+$/g, ''));
                  }
                } catch (e2) { }
              }
            }
          } catch (e) { /* イベント解析エラーは無視 */ }
        }

        if (!candidates.size) {
          setStatus(statusEl, t('relay.import.noCandidates'));
          return;
        }

        // 候補URLとイベント解析結果から新しいリレーリストを構築
        const normalizeUrl = (u) => (u || '').toString().trim().replace(/\/+$/g, '');

        // URL -> { url, read, write } のマップ
        const relayMap = new Map();

        const addRelayCandidate = (url, read = true, write = true) => {
          try {
            if (!url || typeof url !== 'string') return;
            const nu = normalizeUrl(url);
            if (!nu) return;
            if (!nu.startsWith('wss://') && !nu.startsWith('ws://')) return;
            // ペイロード悪用対策として長さ上限
            if (nu.length > 256) return;
            const existing = relayMap.get(nu);
            if (existing) {
              // フラグをマージ（どこかで true なら true を維持）
              existing.read = existing.read || !!read;
              existing.write = existing.write || !!write;
              relayMap.set(nu, existing);
            } else {
              relayMap.set(nu, { url: nu, read: !!read, write: !!write });
            }
          } catch (e) { /* ignore */ }
        };

        // 解析済み content から構造化エントリを抽出（results は JSON を含む可能性あり）
        for (const ev of results) {
          try {
            // tags由来エントリ: 2要素目URL + 3要素目任意フラグ
            if (Array.isArray(ev.tags)) {
              for (const tag of ev.tags) {
                try {
                  if (Array.isArray(tag) && tag.length >= 2) {
                    const maybe = String(tag[1] || '').trim();
                    if (maybe && (maybe.startsWith('wss://') || maybe.startsWith('ws://'))) {
                      // tag[2] の任意フラグを解析
                      let read = true, write = true;
                      const f = tag[2] || '';
                      if (typeof f === 'string') {
                        const fl = f.toLowerCase();
                        if (fl === 'r') { read = true; write = false; }
                        else if (fl === 'w') { read = false; write = true; }
                        else if (fl === 'rw' || fl === 'wr') { read = true; write = true; }
                        else if (fl === 'read') { read = true; write = false; }
                        else if (fl === 'write') { read = false; write = true; }
                      }
                      addRelayCandidate(maybe, read, write);
                    }
                  }
                } catch (e) { }
              }
            }

            // content由来エントリ: JSON配列/オブジェクト または プレーンURL
            if (ev.content && typeof ev.content === 'string') {
              try {
                const parsed = JSON.parse(ev.content);
                // 配列の場合、要素は文字列またはオブジェクト
                if (Array.isArray(parsed)) {
                  for (const it of parsed) {
                    if (typeof it === 'string') addRelayCandidate(it, true, true);
                    else if (it && typeof it === 'object') {
                      const url = it.url || it.u || it.server || it[0] || null;
                      const read = (typeof it.read !== 'undefined') ? !!it.read : (typeof it.r !== 'undefined' ? !!it.r : true);
                      const write = (typeof it.write !== 'undefined') ? !!it.write : (typeof it.w !== 'undefined' ? !!it.w : true);
                      if (url) addRelayCandidate(url, read, write);
                    }
                  }
                } else if (parsed && typeof parsed === 'object') {
                  // 配列を含みうる一般的なフィールド
                  const fields = ['relays', 'servers', 'urls', 'list'];
                  for (const f of fields) {
                    if (Array.isArray(parsed[f])) {
                      for (const u of parsed[f]) {
                        if (typeof u === 'string') addRelayCandidate(u, true, true);
                        else if (u && typeof u === 'object') {
                          const url = u.url || u.u || u.server || null;
                          const read = (typeof u.read !== 'undefined') ? !!u.read : true;
                          const write = (typeof u.write !== 'undefined') ? !!u.write : true;
                          if (url) addRelayCandidate(url, read, write);
                        }
                      }
                    }
                  }
                  // オブジェクト本体が url -> flags のマップの場合にも対応
                  for (const [k, v] of Object.entries(parsed)) {
                    if ((k || '').startsWith('wss://') || (k || '').startsWith('ws://')) {
                      const read = (v && typeof v === 'object' && typeof v.read !== 'undefined') ? !!v.read : true;
                      const write = (v && typeof v === 'object' && typeof v.write !== 'undefined') ? !!v.write : true;
                      addRelayCandidate(k, read, write);
                    }
                  }
                }
              } catch (e) {
                // フォールバック: regex で URL を走査
                try {
                  const m = ev.content.match(urlRegex);
                  if (m) {
                    for (const u of m) addRelayCandidate(u, true, true);
                  }
                } catch (e2) { }
              }
            }
          } catch (e) { /* ignore event parse errors */ }
        }

        // 構造化エントリがなくても、先に収集した候補 URL があれば採用
        if (!relayMap.size && candidates.size) {
          for (const u of candidates) addRelayCandidate(u, true, true);
        }

        // state.relays を全置換（ユーザー要求どおり完全上書き）
        const newRelays = Array.from(relayMap.values());
        if (newRelays.length === 0) {
          setStatus(statusEl, t('relay.import.noCandidates'));
          return;
        }

        state.relays = newRelays;
        try { saveRelays(state.relays); } catch (e) { console.warn('[RelaySettings] saveRelays に失敗', e); }
        try {
          const SimplePoolForConnect = getSimplePool();
          const ok = relayConnect(state, SimplePoolForConnect, restartFeeds);
          restartFeeds(true);
          setStatus(statusEl, t('relay.import.success', { count: newRelays.length }));
          renderRelayList(state.relays);
        } catch (e) {
          console.warn('[RelaySettings] インポート後の再接続に失敗', e);
          setStatus(statusEl, t('relay.import.success_not_connected', { count: newRelays.length }));
        }
      } catch (e) {
        console.error('[RelaySettings] importRelayKind10002 に失敗', e);
        setStatus($('#relayStatus'), t('relay.import.failed', { msg: (e && e.message) }));
      }
    };
  }
}
