// デバッグモーダル設定（main.js から分離）
import { t } from './i18n.js';
import { VERSION } from './version.js';
export function setupDebugModal(state, settings) {
  document.addEventListener('DOMContentLoaded', function () {
    const brand = document.querySelector('.brand');
    const debugModal = document.getElementById('debugModal');
    const debugContent = document.getElementById('debugContent');
    const debugCopy = document.getElementById('debugCopy');
    const debugClose = document.getElementById('debugClose');
    const debugCopyStatus = document.getElementById('debugCopyStatus');

    if (brand && debugModal && debugContent && debugCopy && debugClose) {
      brand.onclick = function (e) {
        function maskSk(sk) {
          if (!sk || typeof sk !== 'string') return sk;
          if (sk.includes('...')) return sk;
          if (sk.length < 16) return sk;
          return sk.slice(0, 8) + '...' + sk.slice(-8) + ' (' + t('mask.sk_length', { n: sk.length }) + ')';
        }

        function normalizeUrl(u) {
          try {
            if (!u || typeof u !== 'string') return u;
            return u.trim().replace(/\/+$/, '');
          } catch (e) { return u; }
        }

        const rawState = window.__nostrState || state;
        const prunedState = rawState ? {
          signer: rawState.signer,
          pubkey: rawState.pubkey || localStorage.getItem('pubkey') || null,
          hasSk: !!rawState.sk,
          // セキュリティ上 sk は意図的に除外し、hasSk のみ公開
          relays: (Array.isArray(rawState.relays) ? rawState.relays.map(r => (r && r.url) || r).filter(Boolean).map(normalizeUrl).slice(0, 10) : []),
          relayCount: Array.isArray(rawState.relays) ? rawState.relays.length : 0,
          profilesCount: rawState.profiles ? (typeof rawState.profiles.size === 'number' ? rawState.profiles.size : Object.keys(rawState.profiles).length) : 0,
          subsCount: rawState.subs ? (typeof rawState.subs.size === 'number' ? rawState.subs.size : Object.keys(rawState.subs).length) : 0,
          nip46: rawState.nip46 ? { connected: !!rawState.nip46.connected, remotePk: rawState.nip46 && rawState.nip46.remotePk ? rawState.nip46.remotePk : null } : undefined
        } : undefined;

        const settingsSummary = typeof settings !== 'undefined' ? {
          preferredSigner: settings.preferredSigner,
          hasPasskeyCredentialId: !!settings.passkeyCredentialId,
          hasPasskeyEncryptedNsec: !!settings.passkeyEncryptedNsec,
          hasEncryptedNsec: !!settings.encryptedNsec
        } : undefined;

        // nsec がどこに保存されているかを判定
        const skStoredMethod = (typeof settings !== 'undefined' && settings) ?
          (settings.passkeyCredentialId && settings.passkeyEncryptedNsec ? 'passkey' : (settings.encryptedNsec ? 'encrypted' : null)) : null;

        const skInfo = {
          inMemory: !!(rawState && rawState.sk),
          storedMethod: skStoredMethod, // 'passkey' | 'encrypted' | null
          preferredSingerSetting: settings && settings.preferredSigner ? settings.preferredSigner : null
        };

        // 利用可能なら relay デバッグヘルパーから relay/subscription 件数を取得
        let relayDebugInfo = null;
        try {
          if (typeof window !== 'undefined' && typeof window.__relayDebug === 'function') {
            try { relayDebugInfo = window.__relayDebug(); } catch (e) { relayDebugInfo = null; }
          }
        } catch (e) { relayDebugInfo = null; }

        // WebSocket readyState を文字列へ変換するヘルパー
        function rsToStr(n) {
          switch (n) {
            case 0: return 'CONNECTING';
            case 1: return 'OPEN';
            case 2: return 'CLOSING';
            case 3: return 'CLOSED';
            default: return 'UNKNOWN';
          }
        }

        // relay の詳細サマリーを構築
        let relaySummary = undefined;
        try {
          const relaysMap = state.pool && state.pool.relays;

          // relayDebugInfo.activeCounts があれば件数マップを構築
          const perRelayCounts = {};
          try {
            if (relayDebugInfo && relayDebugInfo.activeCounts) {
              const live = Array.isArray(relayDebugInfo.activeCounts.live) ? relayDebugInfo.activeCounts.live : (relayDebugInfo.activeCounts.live || []);
              const oneshot = Array.isArray(relayDebugInfo.activeCounts.oneshot) ? relayDebugInfo.activeCounts.oneshot : (relayDebugInfo.activeCounts.oneshot || []);
              for (const [u, c] of live) {
                const nu = normalizeUrl(u);
                perRelayCounts[nu] = perRelayCounts[nu] || { live: 0, oneshot: 0 };
                perRelayCounts[nu].live = (c || 0);
              }
              for (const [u, c] of oneshot) {
                const nu = normalizeUrl(u);
                perRelayCounts[nu] = perRelayCounts[nu] || { live: 0, oneshot: 0 };
                perRelayCounts[nu].oneshot = (c || 0);
              }
            }
          } catch (e) { /* ignore */ }

          if (relaysMap && typeof relaysMap.entries === 'function') {
            relaySummary = [];
            for (const [url, r] of relaysMap.entries()) {
              try {
                const ws = r && r.ws;
                const readyState = ws ? ws.readyState : null;
                const readyStateStr = readyState !== null ? rsToStr(readyState) : null;
                const bufferedAmount = ws && typeof ws.bufferedAmount === 'number' ? ws.bufferedAmount : null;
                const lastSeen = (r && (r.lastSeen || r.last_seen)) ? (r.lastSeen || r.last_seen) : undefined;
                const lastError = r && (r.lastError || r.last_error) ? (r.lastError || r.last_error) : undefined;
                const info = r && (r.info || r.metadata) ? (r.info || r.metadata) : undefined;
                const nurl = normalizeUrl(url);
                const counts = perRelayCounts[nurl] || { live: 0, oneshot: 0 };

                relaySummary.push({
                  url: nurl,
                  connected: !!(ws && ws.readyState === WebSocket.OPEN),
                  readyState,
                  readyStateStr,
                  bufferedAmount,
                  lastSeen,
                  lastError,
                  info,
                  activeSubscriptions: counts
                });
              } catch (e) {
                relaySummary.push({ url: normalizeUrl(url), connected: false });
              }
            }
          }
        } catch (e) {
          relaySummary = undefined;
        }

        // 実効 signer（実際に署名で使われる想定）を算出
        const effectiveSigner = rawState ? (rawState.sk ? 'nsec' : (rawState.signer || 'auto')) : undefined;
        const windowNostrAvailable = !!(typeof window !== 'undefined' && window.nostr);

        // relay 全体統計
        const totalRelays = Array.isArray(relaySummary) ? relaySummary.length : (Array.isArray(prunedState && prunedState.relays) ? prunedState.relays.length : 0);
        const connectedRelays = Array.isArray(relaySummary) ? relaySummary.filter(r => r.connected).length : undefined;
        const subscribeQueueLength = relayDebugInfo && typeof relayDebugInfo.queueLength === 'number' ? relayDebugInfo.queueLength : undefined;

        let debugObj = {
          appVersion: VERSION,
          buildInfo: window.__buildInfo || 'N/A',
          state: prunedState,
          settings: settingsSummary,
          skInfo,
          effectiveSigner,
          hasSk: prunedState ? !!prunedState.hasSk : undefined,
          pubkey: prunedState ? prunedState.pubkey : localStorage.getItem('pubkey'),
          authPending: !!(window && window.__nokakoiAuthPending),
          windowNostrAvailable,
          windowNostrSignEventAvailable: windowNostrAvailable && !!(window.nostr && window.nostr.signEvent),
          userAgent: navigator.userAgent,
          platform: (typeof navigator !== 'undefined' && navigator.userAgentData && navigator.userAgentData.platform) ? navigator.userAgentData.platform : undefined,
          relaySummary,
          relayStats: { totalRelays, connectedRelays, subscribeQueueLength },
          relayDebugInfo,
          lastAction: (() => {
            const act = window.__nokakoiLastAction || null;
            if (!act) return null;
            if (act.state && typeof act.state.sk === 'string') {
              // lastAction でも sk の一部を開示しない（hidden としてマスク）
              return { ...act, state: { ...act.state, sk: '[hidden]' } };
            }
            return act;
          })()
        };
        debugContent.textContent = JSON.stringify(debugObj, null, 2);
        debugModal.hidden = false;
        const debugCopyStatusEl = debugCopyStatus;
        if (debugCopyStatusEl) debugCopyStatusEl.textContent = '';
      };
      debugModal.onclick = function (e) {
        if (e.target === debugModal) debugModal.hidden = true;
      };
      debugCopy.onclick = function () {
        navigator.clipboard.writeText(debugContent.textContent)
          .then(() => { if (debugCopyStatus) debugCopyStatus.textContent = t('json.copy.done'); })
          .catch(() => { if (debugCopyStatus) debugCopyStatus.textContent = t('json.copy.failed'); });
      };
      debugClose.onclick = function () {
        debugModal.hidden = true;
      };
    }
  });
}
