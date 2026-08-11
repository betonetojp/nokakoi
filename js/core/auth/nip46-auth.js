import { $ } from '../../utils/utils.js';
import { t } from '../../utils/i18n.js';
import { Nip46Client, DEFAULT_NIP46_RELAYS, generateQRCodeSVG } from '../nip46.js';
import { setNip46LocalSecretKey } from './nip46-session.js';
import { getActiveSwitchSessionId } from '../account-manager.js';
import { signer } from '../signer.js';

function showModal(modalId) {
  const modal = $(modalId);
  if (modal) modal.hidden = false;
}

function hideModal(modalId) {
  const modal = $(modalId);
  if (modal) modal.hidden = true;
}

export function showNip46LoginModal(state, settings, settingsManager, loginFn) {
  const modal = $('#nip46Modal');
  const qrTab = $('#nip46QrTab');
  const bunkerTab = $('#nip46BunkerTab');
  const appTab = $('#nip46AppTab');
  const qrTabBtn = $('#nip46QrTabBtn');
  const bunkerTabBtn = $('#nip46BunkerTabBtn');
  const appTabBtn = $('#nip46AppTabBtn');
  const qrCodeEl = $('#nip46QrCode');
  const connectUriInput = $('#nip46ConnectUri');
  const copyUriBtn = $('#nip46CopyUri');
  const openAppBtn = $('#nip46OpenApp');
  const bunkerInput = $('#nip46BunkerInput');
  const bunkerConnectBtn = $('#nip46BunkerConnect');
  const relayListEl = $('#nip46RelayList');
  const relayDetails = $('#nip46RelayDetails');
  const addRelayBtn = $('#nip46AddRelay');
  const statusEl = $('#nip46Status');
  const cancelBtn = $('#nip46Cancel');

  if (!modal) return;

  let nip46Relays = settings.nip46Relays || DEFAULT_NIP46_RELAYS.slice();

  let client = new Nip46Client({
    relays: nip46Relays,
    onStatusChange: (status, message) => {
      if (statusEl) statusEl.textContent = message;
    }
  });

  client.initLocalKey();

  function switchTab(tabName) {
    if (tabName === 'qr') {
      if (qrTab) qrTab.hidden = false;
      if (bunkerTab) bunkerTab.hidden = true;
      if (appTab) appTab.hidden = true;
      if (qrTabBtn) qrTabBtn.classList.add('active');
      if (bunkerTabBtn) bunkerTabBtn.classList.remove('active');
      if (appTabBtn) appTabBtn.classList.remove('active');
      if (relayDetails) relayDetails.hidden = false;
    } else if (tabName === 'bunker') {
      if (qrTab) qrTab.hidden = true;
      if (bunkerTab) bunkerTab.hidden = false;
      if (appTab) appTab.hidden = true;
      if (qrTabBtn) qrTabBtn.classList.remove('active');
      if (bunkerTabBtn) bunkerTabBtn.classList.add('active');
      if (appTabBtn) appTabBtn.classList.remove('active');
      if (relayDetails) relayDetails.hidden = true;
    } else {
      if (qrTab) qrTab.hidden = true;
      if (bunkerTab) bunkerTab.hidden = true;
      if (appTab) appTab.hidden = false;
      if (qrTabBtn) qrTabBtn.classList.remove('active');
      if (bunkerTabBtn) bunkerTabBtn.classList.remove('active');
      if (appTabBtn) appTabBtn.classList.add('active');
      if (relayDetails) relayDetails.hidden = false;
    }
  }

  if (qrTabBtn) qrTabBtn.onclick = () => switchTab('qr');
  if (bunkerTabBtn) bunkerTabBtn.onclick = () => switchTab('bunker');
  if (appTabBtn) appTabBtn.onclick = () => switchTab('app');

  if (openAppBtn) {
    openAppBtn.onclick = () => {
      try {
        const uri = connectUriInput ? connectUriInput.value : '';
        if (uri) {
          window.location.href = uri;
        }
      } catch (e) {
        console.error('[NIP-46] アプリ起動に失敗:', e);
      }
    };
  }

  function renderRelayList() {
    if (!relayListEl) return;
    relayListEl.innerHTML = '';

    nip46Relays.forEach((relay, index) => {
      const row = document.createElement('div');
      row.className = 'relay-row';

      const input = document.createElement('input');
      input.type = 'text';
      input.value = relay;
      input.className = 'relay-input-flex';
      input.onchange = () => {
        nip46Relays[index] = input.value.trim();
        client.relays = nip46Relays.slice();
        updateQrCode();
      };

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'secondary relay-remove-btn';
      removeBtn.textContent = '✕';
      removeBtn.onclick = () => {
        if (nip46Relays.length > 1) {
          nip46Relays.splice(index, 1);
          client.relays = nip46Relays.slice();
          renderRelayList();
          updateQrCode();
        }
      };

      row.appendChild(input);
      row.appendChild(removeBtn);
      relayListEl.appendChild(row);
    });
  }

  if (addRelayBtn) {
    addRelayBtn.onclick = () => {
      nip46Relays.push('wss://');
      renderRelayList();
    };
  }

  const resetRelaysBtn = $('#nip46ResetRelays');
  if (resetRelaysBtn) {
    resetRelaysBtn.onclick = () => {
      import('../nip46.js').then(module => {
        try {
          nip46Relays = module.DEFAULT_NIP46_RELAYS.slice();
          client.relays = nip46Relays.slice();
          settingsManager.set('nip46Relays', nip46Relays);
          renderRelayList();
          updateQrCode();
        } catch (e) {
          console.warn('[NIP-46] リレーのリセットに失敗', e);
        }
      }).catch(e => {
        console.warn('[NIP-46] nip46.jsのインポートに失敗', e);
      });
    };
  }

  function updateQrCode() {
    try {
      const uri = client.generateConnectUri();
      if (connectUriInput) connectUriInput.value = uri;
      if (qrCodeEl) {
        const svg = generateQRCodeSVG(uri, { cellSize: 4, margin: 4 });
        qrCodeEl.innerHTML = svg;
      }
    } catch (e) {
      console.error('[NIP-46] QRコード生成失敗:', e);
      if (statusEl) statusEl.textContent = t('nip46.qr_failed');
    }
  }

  if (copyUriBtn) {
    copyUriBtn.onclick = async () => {
      try {
        const uri = connectUriInput ? connectUriInput.value : '';
        await navigator.clipboard.writeText(uri);
        copyUriBtn.textContent = '✓';
        setTimeout(() => { copyUriBtn.textContent = t('copy'); }, 2000);
      } catch (e) {
        if (statusEl) statusEl.textContent = t('copy_failed');
      }
    };
  }

  if (bunkerConnectBtn) {
    bunkerConnectBtn.onclick = async () => {
      const bunkerUri = bunkerInput ? bunkerInput.value.trim() : '';
      if (!bunkerUri) {
        if (statusEl) statusEl.textContent = t('nip46.enter_bunker_uri');
        return;
      }

      try {
        if (statusEl) statusEl.textContent = t('nip46.connecting');
        bunkerConnectBtn.disabled = true;

        try { client.disconnect(); } catch (e) { }

        const bunkerClient = new Nip46Client({
          relays: nip46Relays,
          onStatusChange: (status, message) => {
            if (statusEl) statusEl.textContent = message;
          }
        });
        bunkerClient.initLocalKey();

        await bunkerClient.connectWithBunkerUri(bunkerUri);

        // サイナーが保持する実際のユーザー公開鍵 (NIP-46 get_public_key) を問い合わせて確定させる
        try {
          const userPubkey = await bunkerClient.getPublicKey();
          if (userPubkey && /^[0-9a-f]{64}$/i.test(userPubkey)) {
            bunkerClient.remotePubkey = userPubkey.toLowerCase();
          }
        } catch (e) {
          console.warn('[NIP-46] get_public_key 取得スキップ:', e);
        }

        client = bunkerClient;
        state.nip46.client = bunkerClient;
        state.nip46.remotePubkey = bunkerClient.remotePubkey;
        state.nip46.connected = true;
        state.signer = 'nip46';
        try { bunkerClient.setupResumeHandler(); } catch (e) { }

        const targetPk = bunkerClient.remotePubkey.toLowerCase();
        if (settingsManager && typeof settingsManager.loadForAccount === 'function') {
          settingsManager.loadForAccount(targetPk);
        }

        settingsManager.set('nip46RemotePubkey', bunkerClient.remotePubkey);
        settingsManager.set('nip46Secret', bunkerClient.secret);
        settingsManager.set('nip46Relays', bunkerClient.relays);
        settingsManager.set('preferredSigner', 'nip46');
        if (typeof settingsManager.saveForAccount === 'function') {
          settingsManager.saveForAccount(targetPk);
        }
        setNip46LocalSecretKey(bunkerClient.localSecretKey);
        try {
          localStorage.setItem(`nokakoi.nip46.localSecretKey.${targetPk}`, bunkerClient.localSecretKey);
          localStorage.setItem('lastLoginMethod', 'nip46');
        } catch (e) { }

        try { signer.clearKey(); } catch (e) {}
        hideModal('#nip46Modal');
        await loginFn();
      } catch (e) {
        console.error('[NIP-46] bunker接続失敗:', e);
        if (statusEl) statusEl.textContent = e.message || t('nip46.connect_failed');
        bunkerConnectBtn.disabled = false;
      }
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = () => {
      if (client) {
        try { client.disconnect(); } catch (e) { }
      }
      hideModal('#nip46Modal');
    };
  }

  renderRelayList();
  updateQrCode();
  switchTab('qr');
  if (statusEl) statusEl.textContent = '';
  if (bunkerInput) bunkerInput.value = '';

  showModal('#nip46Modal');

  (async () => {
    try {
      if (statusEl) statusEl.textContent = t('nip46.waiting_for_connection');
      const startSessionId = getActiveSwitchSessionId();
      const result = await client.waitForConnection();

      // 接続待ち中に他アカウントへの切替や操作が行われた場合は遅延接続を安全にキャンセル
      if (startSessionId !== getActiveSwitchSessionId()) {
        console.warn('[NIP-46] 他操作が実行されたため遅延レスポンスを破棄しました');
        try { client.disconnect(); } catch (e) {}
        return;
      }

      if (result.connected) {
        // サイナーが保持する実際のユーザー公開鍵 (NIP-46 get_public_key) を問い合わせて確定させる
        try {
          const userPubkey = await client.getPublicKey();
          if (userPubkey && /^[0-9a-f]{64}$/i.test(userPubkey)) {
            client.remotePubkey = userPubkey.toLowerCase();
          }
        } catch (e) {
          console.warn('[NIP-46] get_public_key 取得スキップ:', e);
        }

        state.nip46.client = client;
        state.nip46.remotePubkey = client.remotePubkey;
        state.nip46.connected = true;
        state.signer = 'nip46';
        try { client.setupResumeHandler(); } catch (e) { }

        const targetPk = result.remotePubkey.toLowerCase();
        if (settingsManager && typeof settingsManager.loadForAccount === 'function') {
          settingsManager.loadForAccount(targetPk);
        }

        settingsManager.set('nip46RemotePubkey', client.remotePubkey);
        settingsManager.set('nip46Secret', client.secret);
        settingsManager.set('nip46Relays', nip46Relays);
        settingsManager.set('preferredSigner', 'nip46');
        if (typeof settingsManager.saveForAccount === 'function') {
          settingsManager.saveForAccount(targetPk);
        }
        setNip46LocalSecretKey(client.localSecretKey);
        try {
          localStorage.setItem(`nokakoi.nip46.localSecretKey.${targetPk}`, client.localSecretKey);
          localStorage.setItem('lastLoginMethod', 'nip46');
        } catch (e) { }

        try { signer.clearKey(); } catch (e) {}
        hideModal('#nip46Modal');
        await loginFn();
      }
    } catch (e) {
    }
  })();
}
