// デバッグモーダル設定（main.js から分離）
import { t } from '../../utils/i18n.js';
import { VERSION } from '../../config/version.js';
import { signer } from '../../core/signer.js';
import { setupInfoHubModal } from './info-hub.js';

export function setupDebugModal(state, settings) {
  const setup = () => {
    const debugModal = document.getElementById('debugModal');
    const debugContent = document.getElementById('debugContent');
    const debugCopy = document.getElementById('debugCopy');
    const debugClose = document.getElementById('debugClose');
    const debugCopyStatus = document.getElementById('debugCopyStatus');

    setupInfoHubModal(state, settings);

    const renderDebugContent = () => {
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
        hasSk: signer.hasKey(),
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

      const skStoredMethod = (typeof settings !== 'undefined' && settings) ?
        (settings.passkeyCredentialId && settings.passkeyEncryptedNsec ? 'passkey' : (settings.encryptedNsec ? 'encrypted' : null)) : null;

      const skInfo = {
        inMemory: signer.hasKey(),
        storedMethod: skStoredMethod,
        preferredSingerSetting: settings && settings.preferredSigner ? settings.preferredSigner : null
      };

      let relayDebugInfo = null;
      try {
        if (typeof window !== 'undefined' && typeof window.__relayDebug === 'function') {
          try { relayDebugInfo = window.__relayDebug(); } catch (e) { relayDebugInfo = null; }
        }
      } catch (e) { relayDebugInfo = null; }

      function formatReadyState(rs) {
        switch (rs) {
          case 0: return 'CONNECTING';
          case 1: return 'OPEN';
          case 2: return 'CLOSING';
          case 3: return 'CLOSED';
          default: return 'UNKNOWN';
        }
      }

      let relaySummary;
      try {
        const poolRelays = rawState && rawState.pool && rawState.pool.relays;
        const liveCountsMap = {};
        try {
          if (relayDebugInfo && relayDebugInfo.activeCounts) {
            const liveArr = Array.isArray(relayDebugInfo.activeCounts.live) ? relayDebugInfo.activeCounts.live : (relayDebugInfo.activeCounts.live || []);
            const oneshotArr = Array.isArray(relayDebugInfo.activeCounts.oneshot) ? relayDebugInfo.activeCounts.oneshot : (relayDebugInfo.activeCounts.oneshot || []);

            for (const [url, cnt] of liveArr) {
              const key = normalizeUrl(url);
              liveCountsMap[key] = liveCountsMap[key] || { live: 0, oneshot: 0 };
              liveCountsMap[key].live = cnt || 0;
            }
            for (const [url, cnt] of oneshotArr) {
              const key = normalizeUrl(url);
              liveCountsMap[key] = liveCountsMap[key] || { live: 0, oneshot: 0 };
              liveCountsMap[key].oneshot = cnt || 0;
            }
          }
        } catch (e) { }

        if (poolRelays && typeof poolRelays.entries === 'function') {
          relaySummary = [];
          for (const [url, relayObj] of poolRelays.entries()) {
            try {
              const ws = relayObj && relayObj.ws;
              const readyState = ws ? ws.readyState : null;
              const readyStateStr = readyState === null ? null : formatReadyState(readyState);
              const bufferedAmount = (ws && typeof ws.bufferedAmount === 'number') ? ws.bufferedAmount : null;
              const lastSeen = relayObj && (relayObj.lastSeen || relayObj.last_seen) ? (relayObj.lastSeen || relayObj.last_seen) : undefined;
              const lastError = relayObj && (relayObj.lastError || relayObj.last_error) ? (relayObj.lastError || relayObj.last_error) : undefined;
              const info = relayObj && (relayObj.info || relayObj.metadata) ? (relayObj.info || relayObj.metadata) : undefined;

              const normKey = normalizeUrl(url);
              const activeCounts = liveCountsMap[normKey] || { live: 0, oneshot: 0 };

              relaySummary.push({
                url: normKey,
                connected: !!(ws && ws.readyState === WebSocket.OPEN),
                readyState,
                readyStateStr,
                bufferedAmount,
                lastSeen,
                lastError,
                info,
                activeSubscriptions: activeCounts
              });
            } catch (e) {
              relaySummary.push({ url: normalizeUrl(url), connected: false });
            }
          }
        }
      } catch (e) {
        relaySummary = undefined;
      }

      const effectiveSigner = rawState ? (signer.hasKey() ? 'nsec' : (rawState.signer || 'auto')) : undefined;
      const windowNostrAvailable = !!(typeof window !== 'undefined' && window.nostr);

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
          return act;
        })()
      };

      if (debugContent) {
        debugContent.textContent = JSON.stringify(debugObj, null, 2);
      }
    };

    const openDebugBtn = document.getElementById('openDebugFromInfoHubBtn');
    if (openDebugBtn) {
      openDebugBtn.addEventListener('click', renderDebugContent);
    }

    if (debugModal) {
      debugModal.onclick = function (e) {
        if (e.target === debugModal) debugModal.hidden = true;
      };
    }

    if (debugCopy && debugContent) {
      debugCopy.onclick = function () {
        navigator.clipboard.writeText(debugContent.textContent).then(() => {
          if (debugCopyStatus) debugCopyStatus.textContent = t('json.copy.done');
        }).catch(() => {
          if (debugCopyStatus) debugCopyStatus.textContent = t('json.copy.failed');
        });
      };
    }

    if (debugClose && debugModal) {
      debugClose.onclick = function () {
        debugModal.hidden = true;
      };
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
}
