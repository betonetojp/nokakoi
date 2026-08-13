import { getNip04, getNip44, hexToBytes } from '../../core/nostr-compat.js';
import { getReadRelays, subOnce } from '../../core/relay.js';
import { t, applyTranslations } from '../../utils/i18n.js';
import { addAutoCloseCheckbox, waitForEhagakiPublish } from '../../ui/ehagaki-autoclose.js';
import { refreshEventsMuteState, invalidateMuteConfigCache } from '../../ui/renderers/render-helpers.js';
import { signer } from '../../core/signer.js';

const reportedMuteEventDiagnostics = new Set();
const reportedMuteSuccessEvents = new Set();
let muteWorkGeneration = 0;
let muteAccountIdentity = null;

function normalizePubkey(pubkey) {
  return typeof pubkey === 'string' && pubkey ? pubkey.toLowerCase() : null;
}

function establishMuteAccount(pubkey) {
  const normalized = normalizePubkey(pubkey);
  if (muteAccountIdentity !== normalized) {
    muteAccountIdentity = normalized;
    muteWorkGeneration += 1;
  }
  return muteWorkGeneration;
}

function beginMuteRequest(pubkey, state) {
  muteAccountIdentity = normalizePubkey(pubkey);
  muteWorkGeneration += 1;
  return { pubkey: muteAccountIdentity, generation: muteWorkGeneration, state };
}

export function invalidateMuteWork(nextPubkey = null) {
  muteWorkGeneration += 1;
  muteAccountIdentity = normalizePubkey(nextPubkey);
  return muteWorkGeneration;
}

function isCurrentMuteRequest(request) {
  if (!request || request.generation !== muteWorkGeneration || request.pubkey !== muteAccountIdentity) return false;
  try {
    if (normalizePubkey(localStorage.getItem('pubkey')) !== request.pubkey) return false;
  } catch (e) {
    return false;
  }
  return !request.state || normalizePubkey(request.state.pubkey) === request.pubkey;
}

function debugMuteEventOnce(ev, format, itemCount = 0) {
  try {
    if (typeof window === 'undefined' || !window.__nokakoiDebug) return;
    const eventId = ev && typeof ev.id === 'string' ? ev.id : 'unknown';
    const diagnosticKey = eventId + '|' + format;
    if (reportedMuteEventDiagnostics.has(diagnosticKey)) return;
    reportedMuteEventDiagnostics.add(diagnosticKey);
    console.debug('[mute] イベント診断', { eventId, format, itemCount });
  } catch (e) { }
}

function debugMuteSuccessOnce(ev, formats, itemCount) {
  try {
    if (typeof window === 'undefined' || !window.__nokakoiDebug) return;
    const eventId = ev && typeof ev.id === 'string' ? ev.id : 'unknown';
    if (reportedMuteSuccessEvents.has(eventId)) return;
    reportedMuteSuccessEvents.add(eventId);
    console.debug('[mute] 復号要約', {
      eventId,
      formats: Array.from(formats || []).sort(),
      itemCount
    });
  } catch (e) { }
}

function getMuteSettingKey(key) {
  const pk = localStorage.getItem('pubkey');
  return pk ? `${key}.${pk.toLowerCase()}` : key;
}

export function getMuteSetting(key, defaultValue = '') {
  try {
    const scopedKey = getMuteSettingKey(key);
    const val = localStorage.getItem(scopedKey);
    if (val !== null) return val;
    const fallback = localStorage.getItem(key);
    if (scopedKey !== key && fallback !== null) {
      const migrationKey = `${key}.__legacy_migrated`;
      if (localStorage.getItem(migrationKey) === null) {
        localStorage.setItem(scopedKey, fallback);
        localStorage.setItem(migrationKey, '1');
        return fallback;
      }
      return defaultValue;
    }
    return fallback !== null ? fallback : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

export function setMuteSetting(key, value) {
  try {
    localStorage.setItem(getMuteSettingKey(key), String(value));
  } catch (e) {}
}

export function clearMuteListState() {
  try {
    localStorage.removeItem('muteList_expanded');
    localStorage.removeItem('muteList_raw_kind10000');
  } catch (e) {}
  window.__nokakoiMuteList = null;
  invalidateMuteConfigCache();
  try {
    const pubPubEl = document.getElementById('mutePubPublicCount');
    const pubPrivEl = document.getElementById('mutePubPrivateCount');
    const wordPubEl = document.getElementById('muteWordPublicCount');
    const wordPrivEl = document.getElementById('muteWordPrivateCount');
    if (pubPubEl) pubPubEl.textContent = '0';
    if (pubPrivEl) pubPrivEl.textContent = '0';
    if (wordPubEl) wordPubEl.textContent = '0';
    if (wordPrivEl) wordPrivEl.textContent = '0';
  } catch (e) {}
}

export function saveMuteListForAccount(pubkey) {
  if (!pubkey) return;
  try {
    const raw10000 = localStorage.getItem('muteList_raw_kind10000');
    const expanded = localStorage.getItem('muteList_expanded');
    if (raw10000) localStorage.setItem(`muteList_raw_kind10000.${pubkey.toLowerCase()}`, raw10000);
    if (expanded) localStorage.setItem(`muteList_expanded.${pubkey.toLowerCase()}`, expanded);
  } catch (e) {}
}

export function loadMuteListForAccount(pubkey) {
  if (!pubkey) {
    invalidateMuteWork(null);
    clearMuteListState();
    return null;
  }
  const targetId = pubkey.toLowerCase();
  establishMuteAccount(targetId);
  try {
    const raw10000 = localStorage.getItem(`muteList_raw_kind10000.${targetId}`);
    const expanded = localStorage.getItem(`muteList_expanded.${targetId}`);
    if (expanded) {
      localStorage.setItem('muteList_expanded', expanded);
      if (raw10000) localStorage.setItem('muteList_raw_kind10000', raw10000);
      else localStorage.removeItem('muteList_raw_kind10000');
      return restoreMuteListFromStorage();
    }
  } catch (e) {}

  clearMuteListState();
  return null;
}

export function restoreMuteListFromStorage(ui = {}) {
  const status = ui.status || null;
  const countsWrap = ui.countsWrap || null;
  const pubPubEl = ui.pubPubEl || null;
  const pubPrivEl = ui.pubPrivEl || null;
  const wordPubEl = ui.wordPubEl || null;
  const wordPrivEl = ui.wordPrivEl || null;

  try {
    const stored = localStorage.getItem('muteList_expanded');
    if (!stored) {
      window.__nokakoiMuteList = null;
      invalidateMuteConfigCache();
      return null;
    }
    const expanded = JSON.parse(stored);
    window.__nokakoiMuteList = expanded;
    invalidateMuteConfigCache();
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
    window.__nokakoiMuteList = null;
    invalidateMuteConfigCache();
    return null;
  }
}

export function updateMuteListCountsUI() {
  const pubkey = localStorage.getItem('pubkey');
  if (pubkey) {
    loadMuteListForAccount(pubkey);
  } else {
    clearMuteListState();
  }
  const status = document.getElementById('fetchMuteListStatus');
  const countsWrap = document.getElementById('muteCounts');
  const pubPubEl = document.getElementById('mutePubPublicCount');
  const pubPrivEl = document.getElementById('mutePubPrivateCount');
  const wordPubEl = document.getElementById('muteWordPublicCount');
  const wordPrivEl = document.getElementById('muteWordPrivateCount');

  // アカウント切替に伴い設定DOM（チェックボックス等）が存在していれば最新状態に同期
  try {
    const applyCheckbox = document.getElementById('applyMuteCheckbox');
    if (applyCheckbox) applyCheckbox.checked = (getMuteSetting('mute_apply', '1')) === '1';

    const modeHide = document.getElementById('muteModeHide');
    const modeCollapse = document.getElementById('muteModeCollapse');
    const storedMode = getMuteSetting('mute_display_mode', 'collapse');
    if (modeHide) modeHide.checked = storedMode === 'hide';
    if (modeCollapse) modeCollapse.checked = storedMode === 'collapse';

    const kind0Checkbox = document.getElementById('muteApplyKind0Checkbox');
    if (kind0Checkbox) kind0Checkbox.checked = (getMuteSetting('mute_apply_kind0', '0')) === '1';

    const hidePublicCheckbox = document.getElementById('muteHidePublicCheckbox');
    if (hidePublicCheckbox) hidePublicCheckbox.checked = (getMuteSetting('mute_hide_public', '0')) === '1';
  } catch (e) {}

  return restoreMuteListFromStorage({ status, countsWrap, pubPubEl, pubPrivEl, wordPubEl, wordPrivEl });
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
  let request = null;

  try {
    if (!state.pool) {
      if (status) status.textContent = t('mute.no_pool');
      try { if (preserveScroll) window.scrollTo(0, prevScroll); } catch (e) { }
      return { ok: false, reason: 'no_pool' };
    }

    const pubkey = normalizePubkey(localStorage.getItem('pubkey'));
    if (!pubkey) {
      if (status) status.textContent = t('auth.login_required');
      try { if (preserveScroll) window.scrollTo(0, prevScroll); } catch (e) { }
      return { ok: false, reason: 'no_pubkey' };
    }
    request = beginMuteRequest(pubkey, state);
    if (!isCurrentMuteRequest(request)) return { ok: false, reason: 'stale' };

    if (status) status.textContent = t('mute.fetching');
    if (countsWrap) countsWrap.hidden = true;

    void SimplePoolProvider;
    const relays = getReadRelays(state.relays);
    const filter = { kinds: [10000], authors: [pubkey], limit: 10 };
    let results = [];

    await new Promise((resolve) => {
      try {
        let settled = false;
        let timer = null;
        let unsubscribe = null;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (e) { }
          resolve();
        };
        unsubscribe = subOnce(
          state,
          `mute-list:${pubkey}`,
          [filter],
          (ev, relay, done) => {
            void relay;
            if (ev) results.push(ev);
            if (done) finish();
          },
          relays
        );
        if (settled && typeof unsubscribe === 'function') unsubscribe();
        if (!settled) timer = setTimeout(finish, 4000);
      } catch (e) {
        resolve();
      }
    });
    if (!isCurrentMuteRequest(request)) return { ok: false, reason: 'stale' };

    if (!results.length) {
      if (!isCurrentMuteRequest(request)) return { ok: false, reason: 'stale' };
      clearMuteListState();
      localStorage.removeItem(`muteList_raw_kind10000.${pubkey}`);
      localStorage.removeItem(`muteList_expanded.${pubkey}`);
      updateMuteListCountsUI();
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
      } catch (e) { /* 各イベントのエラーは無視 */ }
    }
    const latestResults = Array.from(latestResultsMap.values());

    const nip04 = getNip04();
    const nip44 = getNip44();

    const expanded = { pubkeys: { public: [], private: [] }, words: { public: [], private: [] } };
    const detectedFormats = new Set();
    let hasEncryptedEvents = false;
    let decryptSucceeded = false;

    function reportDecryptSuccess(label, parsed, fromEncrypted) {
      void label;
      void parsed;
      void fromEncrypted;
      decryptSucceeded = true;
    }

    for (const ev of latestResults) {
      if (!isCurrentMuteRequest(request)) return { ok: false, reason: 'stale' };
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
        if (!(state.signer === 'nip07' && !signer.hasKey())) {
          try {
            const attempts = [];
            if (signer.hasKey() && ev.pubkey) {
              try {
                const result = signer.nip44Decrypt(nip44, content, ev.pubkey);
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
        if (!(state.signer === 'nip07' && !signer.hasKey())) {
          try {
            const attempts = [];
            if (signer.hasKey()) {
              try {
                const res = await signer.nip04Decrypt(nip04, ev.pubkey, content);
                attempts.push(['nip04.decrypt(signer, ev.pubkey, content)', res]);
              } catch (e) { attempts.push(['nip04.decrypt(signer, ev.pubkey, content) failed', e]); }
            } else {
              attempts.push(['nip04.decrypt skipped - no signer key', 'no-sk']);
            }
            try { attempts.push(['nip04.decrypt(content)', await nip04.decrypt(content)]); } catch (e) { attempts.push(['nip04.decrypt(content) failed', e]); }
            try { attempts.push(['nip04.decrypt(ev.pubkey, content)', await nip04.decrypt(ev.pubkey, content)]); } catch (e) { attempts.push(['nip04.decrypt(ev.pubkey, content) failed', e]); }
            if (!isCurrentMuteRequest(request)) return { ok: false, reason: 'stale' };

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
          debugMuteEventOnce(ev, 'decrypted-invalid-json');
        }
      }

      try {
        const attempt = JSON.parse(content);
        if (attempt && typeof attempt === 'object') {
          mergeMuteObject(expanded, attempt);
          continue;
        }
      } catch (e) { }

      // 外部署名や NIP-46 の遅延復号対象は、ここでは未処理であって失敗ではない。
      // raw content / tags は非公開ミュート対象を含み得るため、ログには出さない。
      if (!hasEncryptedEvents) debugMuteEventOnce(ev, 'unsupported', 0);
    }
    if (!isCurrentMuteRequest(request)) return { ok: false, reason: 'stale' };

    try {
      localStorage.setItem(`muteList_raw_kind10000.${pubkey}`, JSON.stringify(results));
      localStorage.setItem('muteList_raw_kind10000', JSON.stringify(results));
      // 暗号化イベントが存在し非同期復号が控えている場合は、未復号のままexpandedを保存して上書きすることを防止
      if (!hasEncryptedEvents) {
        localStorage.setItem(`muteList_expanded.${pubkey}`, JSON.stringify(expanded));
        localStorage.setItem('muteList_expanded', JSON.stringify(expanded));
      }
      try { if (status) status.textContent = t('mute.fetch.done'); } catch (ee) { }
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

    if (!isCurrentMuteRequest(request)) return { ok: false, reason: 'stale' };
    window.__nokakoiMuteList = expanded;

    try {
      if (typeof renderFeed === 'function') {
        ['home', 'global', 'mentions', 'me', 'bitchat'].forEach(id => { try { renderFeed(id, true); } catch (e) { } });
      }
    } catch (e) { /* 無視 */ }

    try {
      const isNip46 = state.signer === 'nip46';
      const isNsec = state.signer === 'nsec';
      const hasNostrToolsCrypto = !!getNip04() || !!getNip44();
      const shouldShow = !isNsec && ((expanded.pubkeys && expanded.pubkeys.private && expanded.pubkeys.private.length > 0) || hasEncryptedEvents) &&
                         (state.signer === 'nip07' || (typeof window !== 'undefined' && (!!window.nostr || hasNostrToolsCrypto)) || isNip46);

      async function performDeferredDecrypt() {
        try {
          if (!isCurrentMuteRequest(request)) return false;
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
                      { fn: 'nip44Decrypt', label: 'nip44Decrypt/フォールバック' }
                    ]
                  : [
                      { fn: 'nip44Decrypt', label: 'nip44Decrypt' },
                      { fn: 'nip04Decrypt', label: 'nip04Decrypt/フォールバック' }
                    ];

                for (const m of methods) {
                  try {
                    if (typeof client[m.fn] === 'function') {
                      const res = await client[m.fn](ev.pubkey, content, DECRYPT_TIMEOUT);
                      if (!isCurrentMuteRequest(request)) return null;
                      if (typeof res === 'string' && res.length) return { raw: res, label: 'NIP-46(' + m.label + ')' };
                    }
                  } catch (e) {
                    if (window.__nokakoiDebug) console.log('[mute][nip46]', m.label, '失敗:', e.message || e);
                  }
                }

                try {
                  if (typeof client._decrypt === 'function') {
                    const res = await client._decrypt(content, ev.pubkey);
                    if (!isCurrentMuteRequest(request)) return null;
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
                  if (!isCurrentMuteRequest(request)) return null;
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
              if (!isCurrentMuteRequest(request)) return false;
              if (!ev || !ev.content) continue;
              try {
                const dec = await tryDecryptEvent(ev);
                if (!isCurrentMuteRequest(request)) return false;
                if (dec && dec.raw) {
                  const decrypted = dec.raw;
                  const candidateLabel = dec.label || 'unknown';
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
                    decryptSucceeded = true;
                    any = true;
                  }
                }
              } catch (e) { console.warn('[mute][ext] イベント復号エラー', e); }
            }

          if (any) {
              if (!isCurrentMuteRequest(request)) return false;
              try {
                localStorage.setItem(`muteList_expanded.${pubkey}`, JSON.stringify(expanded));
                localStorage.setItem('muteList_expanded', JSON.stringify(expanded));
              } catch (e) { }
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
              debugMuteSuccessOnce(
                latestResults[0],
                detectedFormats,
                expanded.pubkeys.public.length + expanded.pubkeys.private.length +
                  expanded.words.public.length + expanded.words.private.length
              );
              try {
                if (typeof renderFeed === 'function') {
                  ['home', 'global', 'mentions', 'me', 'bitchat'].forEach(id => { try { renderFeed(id, true); } catch (e) { } });
                }
              } catch (e) { /* 無視 */ }
              try { if (preserveScroll) window.scrollTo(0, prevScroll); } catch (e) { }
            return true;
          } else {
            if (!isCurrentMuteRequest(request)) return false;
            if (decryptSucceeded) {
              debugMuteSuccessOnce(
                latestResults[0],
                detectedFormats,
                expanded.pubkeys.public.length + expanded.pubkeys.private.length +
                  expanded.words.public.length + expanded.words.private.length
              );
            }
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
          try { if (isCurrentMuteRequest(request) && status) status.textContent = t('mute.ext_decrypt_error', { msg: (e && e.message) }); } catch (e2) { }
          return false;
        }
      }

      if (shouldShow) {
        // 起動時（UI要素なし）では復号完了を待ってから返し、初期描画前に非公開ミュートを反映する。
        const noUiContext = !status && !countsWrap;
        if (noUiContext) {
          try { await performDeferredDecrypt(); } catch (e) { if (window.__nokakoiDebug) console.warn('[Mute] 起動時復号に失敗', e); }
        } else {
          setTimeout(() => {
            if (!isCurrentMuteRequest(request)) return;
            performDeferredDecrypt().catch(e => { if (window.__nokakoiDebug) console.warn('[Mute] 自動遅延復号に失敗', e); });
          }, 50);
        }
      } else if (decryptSucceeded) {
        debugMuteSuccessOnce(
          latestResults[0],
          detectedFormats,
          expanded.pubkeys.public.length + expanded.pubkeys.private.length +
            expanded.words.public.length + expanded.words.private.length
        );
      }
    } catch (e) { console.warn('[mute] 拡張復号セットアップに失敗', e); }
    if (!isCurrentMuteRequest(request)) return { ok: false, reason: 'stale' };
    try { if (isCurrentMuteRequest(request) && preserveScroll) window.scrollTo(0, prevScroll); } catch { }
    return { ok: true, reason: 'fetched' };
  } catch (e) {
    console.error('[mute] 取得処理に失敗', e);
    try { if ((!request || isCurrentMuteRequest(request)) && status) status.textContent = t('mute.fetch.failed', { msg: (e && e.message) }); } catch (e2) { }
    return { ok: false, reason: 'error', error: e };
  } finally {
    try { if (!request || isCurrentMuteRequest(request)) window.dispatchEvent(new CustomEvent('muteListFetched')); } catch (e) { }
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
    try { updateMuteListCountsUI(); } catch (e) { }

    // ミュート状態変更イベント時に件数表示とタイムラインミュート表現を自動更新
    try {
      if (window._onMuteUpdateListener) {
        window.removeEventListener('muteListUpdated', window._onMuteUpdateListener);
        window.removeEventListener('muteListFetched', window._onMuteUpdateListener);
      }
      window._onMuteUpdateListener = () => {
        try { updateMuteListCountsUI(); } catch (e) { }
        try { refreshEventsMuteState(state); } catch (e) { }
      };
      window.addEventListener('muteListUpdated', window._onMuteUpdateListener);
      window.addEventListener('muteListFetched', window._onMuteUpdateListener);
    } catch (e) { }

    // ミュート設定UIを追加（適用ON/OFF + 表示モード）
    try {
      const containerId = 'muteSettingsContainer';
      let container = document.getElementById(containerId);
      if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        container.className = 'mt-8 text-sm';

        const applyLabel = document.createElement('label');
        applyLabel.className = 'setting-row-clickable';

        const applyCheckbox = document.createElement('input');
        applyCheckbox.type = 'checkbox';
        applyCheckbox.id = 'applyMuteCheckbox';
        applyCheckbox.checked = (getMuteSetting('mute_apply', '1')) === '1';

        const applyText = document.createElement('span');
        applyText.setAttribute('data-i18n', 'mute.apply');

        const inlineStatus = document.createElement('span');
        inlineStatus.className = 'muted settings-status-inline ml-8';

        applyLabel.appendChild(applyCheckbox);
        applyLabel.appendChild(applyText);

        const applyRow = document.createElement('div');
        applyRow.className = 'flex-row align-center';
        applyRow.appendChild(applyLabel);
        applyRow.appendChild(inlineStatus);

        const showSavedStatus = function (msg) {
          const text = msg || t('settings.saved');
          inlineStatus.textContent = text;
          setTimeout(() => {
            if (inlineStatus && inlineStatus.textContent === text) {
              inlineStatus.textContent = '';
            }
          }, 1200);
        };

        const modeWrap = document.createElement('div');
        modeWrap.className = 'mt-8 flex-col items-start';
        if (!applyCheckbox.checked) modeWrap.classList.add('d-none');

        const modeFieldset = document.createElement('div');
        modeFieldset.className = 'd-block';

        // 1. ミュート対象を表示しない (hide)
        const modeHideLabel = document.createElement('label');
        modeHideLabel.className = 'd-block mt-4 settings-indent';
        const modeHide = document.createElement('input');
        modeHide.type = 'radio';
        modeHide.name = 'muteDisplayMode';
        modeHide.value = 'hide';
        modeHide.id = 'muteModeHide';
        const storedMode = getMuteSetting('mute_display_mode', 'collapse');
        modeHide.checked = storedMode === 'hide';
        const modeHideText = document.createElement('span');
        modeHideText.setAttribute('data-i18n', 'mute.mode.hide');
        modeHideLabel.appendChild(modeHide);
        modeHideLabel.appendChild(modeHideText);

        // 2. ミュート対象を折りたたんで表示 (collapse)
        const modeCollapseLabel = document.createElement('label');
        modeCollapseLabel.className = 'd-block mt-4 settings-indent';
        const modeCollapse = document.createElement('input');
        modeCollapse.type = 'radio';
        modeCollapse.name = 'muteDisplayMode';
        modeCollapse.value = 'collapse';
        modeCollapse.id = 'muteModeCollapse';
        modeCollapse.checked = storedMode === 'collapse';
        const modeCollapseText = document.createElement('span');
        modeCollapseText.setAttribute('data-i18n', 'mute.mode.collapse');
        modeCollapseLabel.appendChild(modeCollapse);
        modeCollapseLabel.appendChild(modeCollapseText);

        modeFieldset.appendChild(modeHideLabel);
        modeFieldset.appendChild(modeCollapseLabel);

        // kind:0 イベントへミュート語を適用するオプションを追加（親設定のすぐ下）
        const kind0Wrap = document.createElement('div');
        kind0Wrap.className = 'mt-4 settings-indent flex-row';

        const kind0Label = document.createElement('label');
        kind0Label.className = 'setting-row-clickable';

        const kind0Checkbox = document.createElement('input');
        kind0Checkbox.type = 'checkbox';
        kind0Checkbox.id = 'muteApplyKind0Checkbox';
        kind0Checkbox.checked = (getMuteSetting('mute_apply_kind0', '0')) === '1';

        const kind0Text = document.createElement('span');
        kind0Text.setAttribute('data-i18n', 'mute.apply_kind0');

        kind0Label.appendChild(kind0Checkbox);
        kind0Label.appendChild(kind0Text);
        kind0Wrap.appendChild(kind0Label);

        const refreshAllMuteSettings = function (msgKey = 'settings.saved') {
          invalidateMuteConfigCache();
          try {
            if (typeof refreshEventsMuteState === 'function') {
              refreshEventsMuteState();
            }
            if (typeof restartFeeds === 'function') {
              restartFeeds(true);
            } else if (renderFeed) {
              ['home', 'global', 'mentions', 'me'].forEach(id => { try { renderFeed(id); } catch (e) { } });
            }
            showSavedStatus(t(msgKey));
          } catch (e) { console.warn('[Mute] フィード再描画に失敗', e); }
        };

        // kind:0 適用チェックボックスのイベント配線
        kind0Checkbox.addEventListener('change', function () {
          try {
            setMuteSetting('mute_apply_kind0', kind0Checkbox.checked ? '1' : '0');
            refreshAllMuteSettings();
          } catch (e) { console.warn('[Mute] kind0 保存に失敗', e); }
        });

        // 公開ミュートを完全に非表示にするオプション（折りたたんで表示の配下にインデント）
        const hidePublicWrap = document.createElement('div');
        hidePublicWrap.className = 'mt-4 ml-16 settings-indent flex-row';

        const hidePublicLabel = document.createElement('label');
        hidePublicLabel.className = 'setting-row-clickable';

        const hidePublicCheckbox = document.createElement('input');
        hidePublicCheckbox.type = 'checkbox';
        hidePublicCheckbox.id = 'muteHidePublicCheckbox';
        hidePublicCheckbox.checked = (getMuteSetting('mute_hide_public', '0')) === '1';

        const hidePublicText = document.createElement('span');
        hidePublicText.setAttribute('data-i18n', 'mute.hide_public');

        hidePublicLabel.appendChild(hidePublicCheckbox);
        hidePublicLabel.appendChild(hidePublicText);
        hidePublicWrap.appendChild(hidePublicLabel);

        modeWrap.appendChild(kind0Wrap);
        modeWrap.appendChild(modeFieldset);
        modeWrap.appendChild(hidePublicWrap);

        container.appendChild(applyRow);
        container.appendChild(modeWrap);

        // UI挿入時の sticky/tabbar ジャンプを避けるためスクロール位置を保持
        try {
          const prevScroll = (typeof window !== 'undefined') ? (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0) : 0;
          const parentRow = btn.closest('.flex-row') || btn.parentNode;
          if (parentRow && parentRow.parentNode) {
            parentRow.parentNode.insertBefore(container, parentRow.nextSibling);
          } else {
            btn.parentNode && btn.parentNode.insertBefore(container, btn.nextSibling);
          }
          try { window.scrollTo(0, prevScroll); } catch (e) { }
        } catch (e) {
          btn.parentNode && btn.parentNode.insertBefore(container, btn.nextSibling);
        }

        hidePublicCheckbox.addEventListener('change', function () {
          try {
            setMuteSetting('mute_hide_public', hidePublicCheckbox.checked ? '1' : '0');
            refreshAllMuteSettings();
          } catch (e) { console.warn('[Mute] hide_public 保存に失敗', e); }
        });

        const saveMode = function (v) {
          try {
            setMuteSetting('mute_display_mode', v || 'collapse');
            refreshAllMuteSettings('mute.mode.saved');
          } catch (e) { console.warn('[Mute] モード保存に失敗', e); }
        };

        const updateHidePublicState = function () {
          try {
            if (hidePublicCheckbox) {
              const isCollapse = modeCollapse.checked;
              hidePublicCheckbox.disabled = !isCollapse;
              hidePublicLabel.style.opacity = isCollapse ? '1' : '0.5';
              hidePublicLabel.style.pointerEvents = isCollapse ? 'auto' : 'none';
            }
          } catch (e) { }
        };

        updateHidePublicState();

        modeCollapse.addEventListener('change', function () {
          if (modeCollapse.checked) {
            saveMode('collapse');
            updateHidePublicState();
          }
        });
        modeHide.addEventListener('change', function () {
          if (modeHide.checked) {
            saveMode('hide');
            updateHidePublicState();
          }
        });

        // apply チェック変更時に子設定表示を切り替え
        applyCheckbox.addEventListener('change', function () {
          try {
            setMuteSetting('mute_apply', applyCheckbox.checked ? '1' : '0');
            try {
              const quickMuteCheck = document.getElementById('homeDisplayQuickMuteCheck');
              if (quickMuteCheck) quickMuteCheck.checked = applyCheckbox.checked;
            } catch (e) { }

            try { modeWrap.classList.toggle('d-none', !applyCheckbox.checked); } catch (e) { }
            refreshAllMuteSettings();
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

