import { getNip04, getNip44, hexToBytes } from './nostr-compat.js';
import { getReadRelays } from './relay.js';
import { t, applyTranslations } from './i18n.js';
import { addAutoCloseCheckbox, waitForEhagakiPublish } from './ehagaki-autoclose.js';

function restoreMuteListFromStorage(ui = {}) {
  const status = ui.status || null;
  const countsWrap = ui.countsWrap || null;
  const pubPubEl = ui.pubPubEl || null;
  const pubPrivEl = ui.pubPrivEl || null;
  const wordPubEl = ui.wordPubEl || null;
  const wordPrivEl = ui.wordPrivEl || null;

  try {
    const stored = localStorage.getItem('muteList_expanded');
    if (!stored) return null;
    const expanded = JSON.parse(stored);
    window.__nokakoiMuteList = expanded;
    const pubP = expanded && expanded.pubkeys && Array.isArray(expanded.pubkeys.public) ? expanded.pubkeys.public.length : 0;
    const pubPr = expanded && expanded.pubkeys && Array.isArray(expanded.pubkeys.private) ? expanded.pubkeys.private.length : 0;
    const wdP = expanded && expanded.words && Array.isArray(expanded.words.public) ? expanded.words.public.length : 0;
    const wdPr = expanded && expanded.words && Array.isArray(expanded.words.private) ? expanded.words.private.length : 0;
    if (pubPubEl) pubPubEl.textContent = pubP;
    if (pubPrivEl) pubPrivEl.textContent = pubPr;
    if (wordPubEl) wordPubEl.textContent = wdP;
    if (wordPrivEl) wordPrivEl.textContent = wdPr;
    if (countsWrap) countsWrap.hidden = false;
    if (status && !status.textContent) status.textContent = '';
    return expanded;
  } catch (e) {
    console.warn('[mute] 保存済み muteList_expanded の解析に失敗', e);
    return null;
  }
}

export async function fetchMuteList(state, SimplePoolProvider, renderFeed, ui = {}) {
  const status = ui.status || null;
  const countsWrap = ui.countsWrap || null;
  const pubPubEl = ui.pubPubEl || null;
  const pubPrivEl = ui.pubPrivEl || null;
  const wordPubEl = ui.wordPubEl || null;
  const wordPrivEl = ui.wordPrivEl || null;
  const preserveScroll = !!ui.preserveScroll;
  const prevScroll = preserveScroll && (typeof window !== 'undefined')
    ? (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0)
    : 0;

  try {
    if (!state.pool) {
      if (status) status.textContent = t('mute.no_pool');
      try { if (preserveScroll) window.scrollTo(0, prevScroll); } catch (e) { }
      return { ok: false, reason: 'no_pool' };
    }

    const pubkey = localStorage.getItem('pubkey');
    if (!pubkey) {
      if (status) status.textContent = t('auth.login_required');
      try { if (preserveScroll) window.scrollTo(0, prevScroll); } catch (e) { }
      return { ok: false, reason: 'no_pubkey' };
    }

    if (status) status.textContent = t('mute.fetching');
    if (countsWrap) countsWrap.hidden = true;

    const SimplePoolClass = SimplePoolProvider();
    const pool = (state && state.pool) ? state.pool : (typeof SimplePoolClass === 'function' ? new SimplePoolClass() : SimplePoolClass);
    const isOwnPool = !(state && state.pool);
    const relays = getReadRelays(state.relays);
    const filter = { kinds: [10000], authors: [pubkey], limit: 10 };
    let results = [];

    await new Promise((resolve, reject) => {
      try {
        const sub = pool.subscribeMany(relays, [filter], {
          onevent: (ev) => { results.push(ev); },
          oneose: () => { try { sub.close(); } catch (e) { } if (isOwnPool) { try { pool.close(relays); } catch (e) { } } resolve(); },
          onerror: (err) => { reject(err); }
        });
        setTimeout(() => { try { sub.close(); } catch (e) { } if (isOwnPool) { try { pool.close(relays); } catch (e) { } } resolve(); }, 4000);
      } catch (e) { reject(e); }
    });

    if (!results.length) {
      if (status) status.textContent = t('mute.kind10000.notfound');
      return { ok: false, reason: 'not_found' };
    }

    // 複数のリレーから取得した場合、同一の作者による過去のバージョンが混在する可能性がある。
    // 最新のイベントのみを採用することで、古いリレーの状態によりリストが復元される問題を防ぐ。
    const latestResultsMap = new Map();
    for (const ev of results) {
      try {
        const key = ev.pubkey || ev.id || '__unknown';
        const ts = Number(ev.created_at) || 0;
        const prev = latestResultsMap.get(key);
        if (!prev || (Number(prev.created_at) || 0) < ts) {
          latestResultsMap.set(key, ev);
        }
      } catch (e) { /* ignore per-event errors */ }
    }
    const latestResults = Array.from(latestResultsMap.values());

    const nip04 = getNip04();
    const nip44 = getNip44();

    const expanded = { pubkeys: { public: [], private: [] }, words: { public: [], private: [] } };
    const detectedFormats = new Set();
    let hasEncryptedEvents = false;

    function reportDecryptSuccess(label, parsed, fromEncrypted) {
      try {
        const pp = parsed && (Array.isArray(parsed) ? parsed.length : (typeof parsed === 'object' ? Object.keys(parsed).length : 0));
        const counts = {
          pub_public: expanded.pubkeys.public.length,
          pub_private: expanded.pubkeys.private.length,
          words_public: expanded.words.public.length,
          words_private: expanded.words.private.length
        };
        console.log('[mute] 復号成功:', label, fromEncrypted ? '(暗号化イベント由来)' : '', 'parsed_items:', pp, 'counts:', counts);
      } catch (e) { /* ignore */ }
    }

    for (const ev of latestResults) {
      let content = ev.content || '';

      try {
        if (Array.isArray(ev.tags) && ev.tags.length) {
          mergeMuteObject(expanded, ev.tags, { fromEncrypted: false });
        }
      } catch (e) { console.warn('[mute] ev.tags のマージに失敗', e); }

      if (content && typeof content === 'string') {
        try {
          const parsed = JSON.parse(content);
          if (parsed && typeof parsed === 'object') {
            mergeMuteObject(expanded, parsed);
            continue;
          }
        } catch (e) {
          if (content && content.length > 40) hasEncryptedEvents = true;
        }
      }

      const hasContent = content && typeof content === 'string' && content.length > 0;

      try {
        if (content && content.indexOf('?iv=') !== -1) {
          const parts = content.split('?iv=');
          const ct = parts[0] || '';
          const iv = parts[1] || '';
          JSON.stringify({ ct: ct, iv: decodeURIComponent(iv) });
        }
      } catch (e) { console.warn('[mute] ?iv= ペイロード解析に失敗', e); }

      let decrypted = null;

      if (nip44 && nip44.v2 && hasContent) {
        if (!(state.signer === 'nip07' && !state.sk)) {
          try {
            const attempts = [];
            if (state.sk && ev.pubkey) {
              try {
                const skBytes = hexToBytes(state.sk);
                const conversationKey = nip44.v2.utils.getConversationKey(skBytes, ev.pubkey);
                const result = nip44.v2.decrypt(content, conversationKey);
                attempts.push(['nip44.v2.decrypt(content, conversationKey)', result]);
              } catch (e) {
                attempts.push(['nip44.v2.decrypt(content, conversationKey) failed', e]);
              }
            }

            let candidateLabel = null;
            for (const a of attempts) {
              if (typeof a[1] === 'string' && a[1].length) { decrypted = a[1]; candidateLabel = a[0]; break; }
            }
            if (decrypted && candidateLabel) {
              detectedFormats.add('NIP-44');
              try {
                const parsed = JSON.parse(decrypted);
                mergeMuteObject(expanded, parsed, { fromEncrypted: true });
                reportDecryptSuccess(candidateLabel, parsed, true);
                continue;
              } catch (e) { }
            }
          } catch (e) { console.warn('[mute] nip44 復号エラー', e); }
        }
      }

      if (!decrypted && nip04 && hasContent) {
        if (!(state.signer === 'nip07' && !state.sk)) {
          try {
            const attempts = [];
            if (state.sk) {
              try {
                const res = await nip04.decrypt(state.sk, ev.pubkey, content);
                attempts.push(['nip04.decrypt(state.sk, ev.pubkey, content)', res]);
              } catch (e) { attempts.push(['nip04.decrypt(state.sk, ev.pubkey,content) failed', e]); }
            } else {
              attempts.push(['nip04.decrypt(state.sk, ev.pubkey, content) skipped - no sk', 'no-sk']);
            }
            try { attempts.push(['nip04.decrypt(content)', await nip04.decrypt(content)]); } catch (e) { attempts.push(['nip04.decrypt(content) failed', e]); }
            try { attempts.push(['nip04.decrypt(ev.pubkey, content)', await nip04.decrypt(ev.pubkey, content)]); } catch (e) { attempts.push(['nip04.decrypt(ev.pubkey, content) failed', e]); }
            try { attempts.push(['nip04.decrypt(content, state.sk)', await nip04.decrypt(content, state.sk)]); } catch (e) { attempts.push(['nip04.decrypt(content, state.sk) failed', e]); }

            let candidateLabel = null;
            for (const a of attempts) {
              if (typeof a[1] === 'string' && a[1].length && a[1] !== 'no-sk') {
                decrypted = a[1];
                candidateLabel = a[0];
                detectedFormats.add('NIP-04');
                break;
              }
            }
            if (decrypted && candidateLabel) {
              try {
                const parsed = JSON.parse(decrypted);
                mergeMuteObject(expanded, parsed, { fromEncrypted: true });
                reportDecryptSuccess(candidateLabel, parsed, true);
                continue;
              } catch (e) { }
            }

          } catch (e) { console.warn('[mute] nip04 復号エラー', e); }
        }
      }

      if (decrypted) {
        try {
          const parsed = JSON.parse(decrypted);
          mergeMuteObject(expanded, parsed, { fromEncrypted: true });
          reportDecryptSuccess('local-decrypt', parsed, true);
          continue;
        } catch (e) {
          console.warn('[mute] 復号できたが JSON 解析に失敗', e);
          console.log('[mute] 復号結果プレビュー:', (decrypted || '').slice(0, 1000));
        }
      }

      try {
        const attempt = JSON.parse(content);
        if (attempt && typeof attempt === 'object') {
          mergeMuteObject(expanded, attempt);
          continue;
        }
      } catch (e) { }

      try {
        console.debug('[mute] イベント内容の解析/解釈に失敗', ev.id, 'tags:', ev.tags);
      } catch (e) { console.warn('[mute] デバッグログ出力エラー', e); }
    }

    try {
      localStorage.setItem('muteList_raw_kind10000', JSON.stringify(results));
      localStorage.setItem('muteList_expanded', JSON.stringify(expanded));
      try { if (status) status.textContent = t('mute.fetch.done'); } catch (ee) { }
      if (window.__nokakoiDebug && detectedFormats.size) {
        const arr = Array.from(detectedFormats).sort();
        console.log('[mute] 検出した暗号化形式:', arr.join(', '));
      }
      if (window.__nokakoiDebug) console.log('[mute][final] expanded mute list:', expanded);
    } catch (e) {
      console.warn('[mute] 保存に失敗', e);
      if (status) status.textContent = t('mute.save.error');
    }

    const pubP = expanded.pubkeys.public ? expanded.pubkeys.public.length : 0;
    const pubPr = expanded.pubkeys.private ? expanded.pubkeys.private.length : 0;
    const wdP = expanded.words.public ? expanded.words.public.length : 0;
    const wdPr = expanded.words.private ? expanded.words.private.length : 0;
    if (pubPubEl) pubPubEl.textContent = pubP;
    if (pubPrivEl) pubPrivEl.textContent = pubPr;
    if (wordPubEl) wordPubEl.textContent = wdP;
    if (wordPrivEl) wordPrivEl.textContent = wdPr;
    if (countsWrap) countsWrap.hidden = false;

    window.__nokakoiMuteList = expanded;

    try {
      if (typeof renderFeed === 'function') {
        ['home', 'global', 'mentions', 'me', 'bitchat'].forEach(id => { try { renderFeed(id, true); } catch (e) { } });
      }
    } catch (e) { /* ignore */ }

    try {
      const isNip46 = state.signer === 'nip46';
      const isNsec = state.signer === 'nsec';
      const hasNostrToolsCrypto = !!getNip04() || !!getNip44();
      const shouldShow = !isNsec && ((expanded.pubkeys && expanded.pubkeys.private && expanded.pubkeys.private.length > 0) || hasEncryptedEvents) &&
                         (state.signer === 'nip07' || (typeof window !== 'undefined' && (!!window.nostr || hasNostrToolsCrypto)) || isNip46);

      async function performDeferredDecrypt() {
        try {
          if (!latestResults || !latestResults.length) return false;

          if (status) {
            if (isNip46) {
              status.textContent = t('mute.decrypting.nip46');
            } else {
              status.textContent = t('mute.decrypting.extension');
            }
          }

            async function tryDecryptEvent(ev) {
              const content = ev.content || '';
              if (!content || typeof content !== 'string') return null;

              if (state.signer === 'nip46' && state.nip46 && state.nip46.client) {
                const client = state.nip46.client;
                const isNip04Format = content.includes('?iv=');
                const DECRYPT_TIMEOUT = 20000;

                const methods = isNip04Format
                  ? [
                      { fn: 'nip04Decrypt', label: 'nip04Decrypt' },
                      { fn: 'nip44Decrypt', label: 'nip44Decrypt/fallback' }
                    ]
                  : [
                      { fn: 'nip44Decrypt', label: 'nip44Decrypt' },
                      { fn: 'nip04Decrypt', label: 'nip04Decrypt/fallback' }
                    ];

                for (const m of methods) {
                  try {
                    if (typeof client[m.fn] === 'function') {
                      const res = await client[m.fn](ev.pubkey, content, DECRYPT_TIMEOUT);
                      if (typeof res === 'string' && res.length) return { raw: res, label: 'NIP-46(' + m.label + ')' };
                    }
                  } catch (e) {
                    if (window.__nokakoiDebug) console.log('[mute][nip46]', m.label, '失敗:', e.message || e);
                  }
                }

                try {
                  if (typeof client._decrypt === 'function') {
                    const res = await client._decrypt(content, ev.pubkey);
                    if (typeof res === 'string' && res.length) {
                      try {
                        JSON.parse(res);
                        return { raw: res, label: 'NIP-46(_decrypt)' };
                      } catch (e) {
                        if (window.__nokakoiDebug) console.log('[mute][nip46] _decrypt の結果が有効な JSON ではありません');
                      }
                    }
                  }
                } catch (e) {
                  if (window.__nokakoiDebug) console.log('[mute][nip46] _decrypt に失敗', e);
                }

                return null;
              }

              const isNip04Format = content.includes('?iv=');
              const candidates = [];

              if (window.nostr) {
                if (isNip04Format) {
                  if (window.nostr.nip04 && typeof window.nostr.nip04.decrypt === 'function') {
                    candidates.push({ label: 'window.nostr.nip04.decrypt(ev.pubkey, content)', fn: async () => window.nostr.nip04.decrypt(ev.pubkey, content) });
                  }
                  if (window.nostr.nip44 && typeof window.nostr.nip44.decrypt === 'function') {
                    candidates.push({ label: 'window.nostr.nip44.decrypt(ev.pubkey, content)', fn: async () => window.nostr.nip44.decrypt(ev.pubkey, content) });
                  }
                } else {
                  if (window.nostr.nip44 && typeof window.nostr.nip44.decrypt === 'function') {
                    candidates.push({ label: 'window.nostr.nip44.decrypt(ev.pubkey, content)', fn: async () => window.nostr.nip44.decrypt(ev.pubkey, content) });
                  }
                  if (window.nostr.nip04 && typeof window.nostr.nip04.decrypt === 'function') {
                    candidates.push({ label: 'window.nostr.nip04.decrypt(ev.pubkey, content)', fn: async () => window.nostr.nip04.decrypt(ev.pubkey, content) });
                  }
                }
              }

              for (const c of candidates) {
                try {
                  const res = await c.fn();
                  if (typeof res === 'string' && res.length) return { raw: res, label: c.label };
                  if (res && typeof res === 'object') {
                    try { return { raw: JSON.stringify(res), label: c.label }; } catch (e) { return null; }
                  }
                } catch (e) {
                  if (window.__nokakoiDebug) console.log('[mute][ext] 試行に失敗', c && c.label, e && e.message ? e.message : e);
                }
              }

              return null;
            }

            let any = false;
            for (const ev of latestResults) {
              if (!ev || !ev.content) continue;
              try {
                if (window.__nokakoiDebug) console.log('[mute][ext] 拡張復号を試行', ev.id || ev);
                const dec = await tryDecryptEvent(ev);
                if (window.__nokakoiDebug) console.log('[mute][ext] 復号結果(raw):', dec && dec.raw ? dec.raw : dec, '候補:', dec && dec.label ? dec.label : '不明');
                if (dec && dec.raw) {
                  const decrypted = dec.raw;
                  const candidateLabel = dec.label || 'unknown';
                  if (window.__nokakoiDebug) console.log('[mute][ext] 成功した候補:', candidateLabel);
                  let parsed = null;
                  if (typeof decrypted === 'string') {
                    try { parsed = JSON.parse(decrypted); } catch (e) { }
                  } else if (typeof decrypted === 'object') {
                    parsed = decrypted;
                  }

                  if (parsed) {
                    mergeMuteObject(expanded, parsed, { fromEncrypted: true });
                    detectedFormats.add('NIP-07(extension)');
                    detectedFormats.add(candidateLabel);
                    any = true;
                  }
                }
              } catch (e) { console.warn('[mute][ext] イベント復号エラー', e); }
            }

          if (any) {
              try { localStorage.setItem('muteList_expanded', JSON.stringify(expanded)); } catch (e) { }
              const pubP2 = expanded.pubkeys.public ? expanded.pubkeys.public.length : 0;
              const pubPr2 = expanded.pubkeys.private ? expanded.pubkeys.private.length : 0;
              const wdP2 = expanded.words && expanded.words.public ? expanded.words.public.length : 0;
              const wdPr2 = expanded.words && expanded.words.private ? expanded.words.private.length : 0;
              if (pubPubEl) pubPubEl.textContent = pubP2;
              if (pubPrivEl) pubPrivEl.textContent = pubPr2;
              if (wordPubEl) wordPubEl.textContent = wdP2;
              if (wordPrivEl) wordPrivEl.textContent = wdPr2;
              if (countsWrap) countsWrap.hidden = false;
              try { if (status) status.textContent = t('mute.fetch.done'); } catch (e) { }
              if (window.__nokakoiDebug && detectedFormats.size) {
                const arr = Array.from(detectedFormats).sort();
                console.log('[mute] 検出した暗号化形式（拡張）:', arr.join(', '));
              }
              try {
                if (typeof renderFeed === 'function') {
                  ['home', 'global', 'mentions', 'me', 'bitchat'].forEach(id => { try { renderFeed(id, true); } catch (e) { } });
                }
              } catch (e) { /* ignore */ }
              try { if (preserveScroll) window.scrollTo(0, prevScroll); } catch (e) { }
            return true;
          } else {
            if (state.signer === 'nip46') {
              try { if (status) status.textContent = t('mute.fetch.done') + ' (Decrypt failed)'; } catch (e) { }
            } else {
              try { if (status) status.textContent = t('mute.decrypt_failed_extension'); } catch (e) { }
            }
            try { if (preserveScroll) window.scrollTo(0, prevScroll); } catch (e) { }
            return false;
          }

        } catch (e) {
          console.warn('[mute][ext] 復号フローに失敗', e);
          try { if (status) status.textContent = t('mute.ext_decrypt_error', { msg: (e && e.message) }); } catch (e2) { }
          return false;
        }
      }

      if (shouldShow) {
        // 起動時（UI要素なし）では復号完了を待ってから返し、初期描画前に非公開ミュートを反映する。
        const noUiContext = !status && !countsWrap;
        if (noUiContext) {
          try { await performDeferredDecrypt(); } catch (e) { if (window.__nokakoiDebug) console.warn('[Mute] 起動時復号に失敗', e); }
        } else {
          setTimeout(() => { performDeferredDecrypt().catch(e => { if (window.__nokakoiDebug) console.warn('[Mute] 自動遅延復号に失敗', e); }); }, 50);
        }
      }
    } catch (e) { console.warn('[mute] 拡張復号セットアップに失敗', e); }
    try { if (preserveScroll) window.scrollTo(0, prevScroll); } catch { }
    return { ok: true, reason: 'fetched' };
  } catch (e) {
    console.error('[mute] 取得処理に失敗', e);
    try { if (status) status.textContent = t('mute.fetch.failed', { msg: (e && e.message) }); } catch (e2) { }
    return { ok: false, reason: 'error', error: e };
  } finally {
    try { window.dispatchEvent(new CustomEvent('muteListFetched')); } catch (e) { }
  }
}

try {
  if (typeof window !== 'undefined') {
    window.__nokakoiFetchMuteList = fetchMuteList;
  }
} catch (e) { }

// ミュートリストUI初期化の公開関数。state / SimplePoolProvider / renderFeed を受け取る。
export async function setupMuteListUI(state, SimplePoolProvider, renderFeed, restartFeeds) {
  try {
    const btn = document.getElementById('fetchMuteListBtn');
    const status = document.getElementById('fetchMuteListStatus');
    const countsWrap = document.getElementById('muteCounts');
    const pubPubEl = document.getElementById('mutePubPublicCount');
    const pubPrivEl = document.getElementById('mutePubPrivateCount');
    const wordPubEl = document.getElementById('muteWordPublicCount');
    const wordPrivEl = document.getElementById('muteWordPrivateCount');

    if (!btn) return;

    // 初期表示時に localStorage のミュートリストを反映し、件数表示を復元
    try { restoreMuteListFromStorage({ status, countsWrap, pubPubEl, pubPrivEl, wordPubEl, wordPrivEl }); } catch (e) { }

    // ミュート設定UIを追加（適用ON/OFF + 表示モード）
    try {
      const containerId = 'muteSettingsContainer';
      let container = document.getElementById(containerId);
      if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        container.style.marginTop = '8px';
        container.style.fontSize = '13px';

        const applyLabel = document.createElement('label');
        applyLabel.style.display = 'inline-flex';
        applyLabel.style.alignItems = 'center';
        applyLabel.style.gap = '8px';

        const applyCheckbox = document.createElement('input');
        applyCheckbox.type = 'checkbox';
        applyCheckbox.id = 'applyMuteCheckbox';
        applyCheckbox.checked = (localStorage.getItem('mute_apply') || '1') === '1';

        const applyText = document.createElement('span');
        // 後から再翻訳できるよう data-i18n を使用
        applyText.setAttribute('data-i18n', 'mute.apply');

        applyLabel.appendChild(applyCheckbox);
        applyLabel.appendChild(applyText);

        const modeWrap = document.createElement('div');
        modeWrap.style.marginTop = '6px';
        modeWrap.style.display = applyCheckbox.checked ? 'block' : 'none';
        modeWrap.style.gap = '6px';
        modeWrap.style.alignItems = 'flex-start';

        const modeFieldset = document.createElement('div');
        modeFieldset.style.display = 'block';

        const modeCollapseLabel = document.createElement('label');
        modeCollapseLabel.style.display = 'block';
        modeCollapseLabel.style.marginTop = '4px';
        modeCollapseLabel.style.marginLeft = '18px';
        const modeCollapse = document.createElement('input');
        modeCollapse.type = 'radio';
        modeCollapse.name = 'muteDisplayMode';
        modeCollapse.value = 'collapse';
        modeCollapse.id = 'muteModeCollapse';

        const storedMode = localStorage.getItem('mute_display_mode') || 'collapse';
        modeCollapse.checked = storedMode === 'collapse';
        // ラベル文言は data-i18n 経由
        const modeCollapseText = document.createElement('span');
        modeCollapseText.setAttribute('data-i18n', 'mute.mode.collapse');
        modeCollapseLabel.appendChild(modeCollapse);
        modeCollapseLabel.appendChild(modeCollapseText);

        const modeHideLabel = document.createElement('label');
        modeHideLabel.style.display = 'block';
        modeHideLabel.style.marginTop = '4px';
        modeHideLabel.style.marginLeft = '18px';
        const modeHide = document.createElement('input');
        modeHide.type = 'radio';
        modeHide.name = 'muteDisplayMode';
        modeHide.value = 'hide';
        modeHide.id = 'muteModeHide';
        modeHide.checked = storedMode === 'hide';
        const modeHideText = document.createElement('span');
        modeHideText.setAttribute('data-i18n', 'mute.mode.hide');
        modeHideLabel.appendChild(modeHide);
        modeHideLabel.appendChild(modeHideText);

        modeFieldset.appendChild(modeCollapseLabel);
        modeFieldset.appendChild(modeHideLabel);

        modeWrap.appendChild(modeFieldset);

        container.appendChild(applyLabel);
        container.appendChild(modeWrap);

        // UI挿入時の sticky/tabbar ジャンプを避けるためスクロール位置を保持
        try {
          const prevScroll = (typeof window !== 'undefined') ? (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0) : 0;
          btn.parentNode && btn.parentNode.insertBefore(container, btn.nextSibling);
          try { window.scrollTo(0, prevScroll); } catch (e) { }
        } catch (e) {
          btn.parentNode && btn.parentNode.insertBefore(container, btn.nextSibling);
        }

        // kind:0 イベントへミュート語を適用するオプションを追加（既定OFF）
        const kind0Wrap = document.createElement('div');
        kind0Wrap.style.marginTop = '8px';
        kind0Wrap.style.marginLeft = '18px';
        kind0Wrap.style.display = 'flex';
        kind0Wrap.style.alignItems = 'center';
        kind0Wrap.style.gap = '8px';

        const kind0Label = document.createElement('label');
        kind0Label.style.display = 'inline-flex';
        kind0Label.style.alignItems = 'center';
        kind0Label.style.gap = '8px';

        const kind0Checkbox = document.createElement('input');
        kind0Checkbox.type = 'checkbox';
        kind0Checkbox.id = 'muteApplyKind0Checkbox';
        // 既定OFF
        kind0Checkbox.checked = (localStorage.getItem('mute_apply_kind0') || '0') === '1';

        const kind0Text = document.createElement('span');
        kind0Text.setAttribute('data-i18n', 'mute.apply_kind0');

        kind0Label.appendChild(kind0Checkbox);
        kind0Label.appendChild(kind0Text);
        kind0Wrap.appendChild(kind0Label);
        modeWrap.appendChild(kind0Wrap);

        // kind:0 適用チェックボックスのイベント配線
        kind0Checkbox.addEventListener('change', function () {
          try {
            localStorage.setItem('mute_apply_kind0', kind0Checkbox.checked ? '1' : '0');
            try {
              if (renderFeed) {
                ['home', 'global', 'mentions', 'me'].forEach(id => { try { renderFeed(id); } catch (e) { } });
              }
              if (status) { status.textContent = t('settings.saved'); setTimeout(() => { if (status) status.textContent = ''; },1200); }
            } catch (e) { }
          } catch (e) { console.warn('[Mute] kind0 保存に失敗', e); }
        });

        const saveMode = function (v) {
          try {
            localStorage.setItem('mute_display_mode', v || 'collapse');
            try {
              if (renderFeed) {
                ['home', 'global', 'mentions', 'me'].forEach(id => {
                  try { renderFeed(id); } catch (e) { }
                });
              }
              if (status) { status.textContent = t('mute.mode.saved'); setTimeout(() => { if (status) status.textContent = ''; }, 1200); }
            } catch (e) { console.warn('[Mute] モード描画に失敗', e); }
          } catch (e) { console.warn('[Mute] モード保存に失敗', e); }
        };

        modeCollapse.addEventListener('change', function () { if (modeCollapse.checked) saveMode('collapse'); });
        modeHide.addEventListener('change', function () { if (modeHide.checked) saveMode('hide'); });

        // apply チェック変更時に子設定表示を切り替え
        applyCheckbox.addEventListener('change', function () {
          try {
            localStorage.setItem('mute_apply', applyCheckbox.checked ? '1' : '0');
            // 表示のクイック設定側も同期
            try {
              const quickMuteCheck = document.getElementById('homeDisplayQuickMuteCheck');
              if (quickMuteCheck) quickMuteCheck.checked = applyCheckbox.checked;
            } catch (e) { }

            try { modeWrap.style.display = applyCheckbox.checked ? 'block' : 'none'; } catch (e) { }
            try {
              if (typeof restartFeeds === 'function') {
                restartFeeds(true);
              } else if (renderFeed) {
                ['home', 'global', 'mentions', 'me'].forEach(id => { try { renderFeed(id); } catch (e) { } });
              }
              if (status) { status.textContent = t('settings.saved'); setTimeout(() => { if (status && status.textContent === t('settings.saved')) status.textContent = ''; },1200); }
            } catch (e) { console.warn('[Mute] 適用時の描画に失敗', e); }
          } catch (e) { console.warn('[Mute] 適用設定の保存に失敗', e); }
        });

        // 全UI要素の作成・挿入後に翻訳を適用
        try { if (typeof applyTranslations === 'function') applyTranslations(container, true); } catch (e) { }
      }
    } catch (e) {
      console.warn('[mute] 設定 UI の構築に失敗', e);
    }

    // 取得ボタンの処理
    btn.onclick = async function () {
      await fetchMuteList(state, SimplePoolProvider, renderFeed, {
        status,
        countsWrap,
        pubPubEl,
        pubPrivEl,
        wordPubEl,
        wordPrivEl,
        preserveScroll: true
      });
    };

  } catch (e) {
    console.warn('[mute] セットアップに失敗', e);
  }
}

// 各種ミュート表現を expanded 構造へ統合するヘルパー
function mergeMuteObject(expanded, obj, opts = {}) {
  try {
    const toPrivate = !!(opts && opts.fromEncrypted);
    expanded.pubkeys = expanded.pubkeys || { public: [], private: [] };
    expanded.words = expanded.words || { public: [], private: [] };

    const add = (targetArr, v) => {
      if (!v) return;
      if (typeof v !== 'string') return;
      if (!targetArr.includes(v)) targetArr.push(v);
    };

    if (Array.isArray(obj)) {
      for (const t of obj) {
        if (!Array.isArray(t) || t.length < 2) continue;
        const tag = (t[0] || '').toString();
        const val = t[1] ? t[1].toString() : '';
        if (!val) continue;
        if (tag === 'p' || tag === 'pubkey') {
          add(toPrivate ? expanded.pubkeys.private : expanded.pubkeys.public, val);
        } else if (tag === 'w' || tag === 'word' || tag === 'keyword') {
          add(toPrivate ? expanded.words.private : expanded.words.public, val);
        }
      }
      return;
    }

    if (obj && Array.isArray(obj.tags)) {
      mergeMuteObject(expanded, obj.tags, opts);
      return;
    }

    if (obj && typeof obj === 'object') {
      if (obj.pubkeys && typeof obj.pubkeys === 'object') {
        for (const k of ['public', 'private']) {
          if (Array.isArray(obj.pubkeys[k])) {
            for (const v of obj.pubkeys[k]) add(expanded.pubkeys[k], v && v.toString());
          }
        }
      }
      if (obj.words && typeof obj.words === 'object') {
        for (const k of ['public', 'private']) {
          if (Array.isArray(obj.words[k])) {
            for (const v of obj.words[k]) add(expanded.words[k], v && v.toString());
          }
        }
      }
      if (Array.isArray(obj.p)) {
        for (const v of obj.p) add(toPrivate ? expanded.pubkeys.private : expanded.pubkeys.public, v && v.toString());
      }
      if (Array.isArray(obj.w)) {
        for (const v of obj.w) add(toPrivate ? expanded.words.private : expanded.words.public, v && v.toString());
      }
    }
  } catch (e) {
    console.warn('[mergeMuteObject] マージに失敗', e);
  }
}

