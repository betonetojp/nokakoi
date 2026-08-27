/**
 * Mute Editor Module
 * ミュートリスト管理機能 (kind:10000)
 */

import { fetchLatestEvent, backupEvent, publishReplaceableEvent } from '../../core/replaceable-event.js';
import { getNip04, getNip44, hexToBytes, getNip19 } from '../../core/nostr-compat.js';
import { t } from '../../utils/i18n.js';
import { displayNameWithUsername, loadProfile, updateNameDom } from '../profile/profile.js';
import { refreshEventsMuteState, invalidateMuteConfigCache } from '../../ui/renderers/render-helpers.js';
import { signer } from '../../core/signer.js';

const MUTE_SNAPSHOTS_KEY_BASE = 'mute_list_snapshots';

function getMuteSnapshotsKey() {
  const pk = localStorage.getItem('pubkey');
  return pk ? `${MUTE_SNAPSHOTS_KEY_BASE}.${pk.toLowerCase()}` : MUTE_SNAPSHOTS_KEY_BASE;
}

function loadMuteSnapshots() {
  try {
    const raw = localStorage.getItem(getMuteSnapshotsKey());
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveMuteSnapshots(list) {
  try {
    localStorage.setItem(getMuteSnapshotsKey(), JSON.stringify(list));
  } catch (e) { }
}


function formatDateStr(ts) {
  const d = new Date(ts || Date.now());
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

function openMuteSnapshotModal(parentModal, options) {
  const overlay = document.createElement('div');
  overlay.className = 'editor-confirm-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'editor-confirm-dialog';
  dialog.style.maxWidth = '480px';
  dialog.style.width = '90%';

  function renderDialogContent() {
    const snapshots = loadMuteSnapshots();
    dialog.innerHTML = `
      <div class="row align-center justify-between mb-12">
        <h3 class="font-bold text-base m-0">📸 ${t('editor.mute.snapshots') || 'Snapshots'}</h3>
        <button type="button" class="secondary small" id="closeSnapDialog">✕</button>
      </div>
      <button type="button" id="createSnapBtn" class="mb-12 w-full">${t('editor.mute.create_snapshot') || '+ Create Snapshot'}</button>
      <div class="editor-list" style="max-height: 260px; text-align: left;">
        ${snapshots.length === 0 ? `<div class="muted p-8 text-center text-sm">${t('editor.mute.no_snapshots') || 'No saved snapshots.'}</div>` : ''}
      </div>
    `;

    const closeBtn = dialog.querySelector('#closeSnapDialog');
    closeBtn.onclick = () => overlay.remove();

    const createBtn = dialog.querySelector('#createSnapBtn');
    createBtn.onclick = () => {
      const now = Date.now();
      const newSnap = {
        id: now.toString(),
        name: formatDateStr(now),
        createdAt: now,
        publicUsers: options.publicUserItems.filter(i => i.isMuted).map(i => i.pubkey),
        publicWords: options.publicWordItems.filter(i => i.isMuted).map(i => i.word),
        privateUsers: options.privateUserItems.filter(i => i.isMuted).map(i => i.pubkey),
        privateWords: options.privateWordItems.filter(i => i.isMuted).map(i => i.word),
        encryptionMode: options.selectedEncryptionMode
      };
      snapshots.unshift(newSnap);
      saveMuteSnapshots(snapshots);
      renderDialogContent();
    };

    const listContainer = dialog.querySelector('.editor-list');
    snapshots.forEach((snap, idx) => {
      const row = document.createElement('div');
      row.className = 'editor-list-item justify-between align-center p-6';

      const userCount = (snap.publicUsers ? snap.publicUsers.length : 0) + (snap.privateUsers ? snap.privateUsers.length : 0);
      const wordCount = (snap.publicWords ? snap.publicWords.length : 0) + (snap.privateWords ? snap.privateWords.length : 0);

      row.innerHTML = `
        <div class="flex-column min-w-0 flex-1 mr-8">
          <div class="font-bold text-sm truncate">${snap.name}</div>
          <div class="muted text-xs">Users: ${userCount} / Words: ${wordCount}</div>
        </div>
        <div class="flex-row gap-4">
          <button type="button" class="small apply-btn">${t('editor.mute.snapshot_apply') || 'Apply'}</button>
          <button type="button" class="secondary small delete-btn">✕</button>
        </div>
      `;

      row.querySelector('.apply-btn').onclick = () => {
        if (typeof options.onApply === 'function') {
          options.onApply(snap);
        }
        overlay.remove();
      };

      row.querySelector('.delete-btn').onclick = () => {
        snapshots.splice(idx, 1);
        saveMuteSnapshots(snapshots);
        renderDialogContent();
      };

      listContainer.appendChild(row);
    });
  }

  renderDialogContent();
  overlay.appendChild(dialog);
  (parentModal.querySelector('.modal-body') || parentModal).appendChild(overlay);
}

let dragScrollTimer = null;

function handleDragAutoScroll(e, listEl) {
  if (!listEl) return;
  const rect = listEl.getBoundingClientRect();
  const threshold = 40;
  const speed = 8;

  const distFromTop = e.clientY - rect.top;
  const distFromBottom = rect.bottom - e.clientY;

  stopDragAutoScroll();

  if (distFromTop > 0 && distFromTop < threshold) {
    const scrollStep = () => {
      listEl.scrollTop -= speed * (1 - distFromTop / threshold);
      dragScrollTimer = requestAnimationFrame(scrollStep);
    };
    dragScrollTimer = requestAnimationFrame(scrollStep);
  } else if (distFromBottom > 0 && distFromBottom < threshold) {
    const scrollStep = () => {
      listEl.scrollTop += speed * (1 - distFromBottom / threshold);
      dragScrollTimer = requestAnimationFrame(scrollStep);
    };
    dragScrollTimer = requestAnimationFrame(scrollStep);
  }
}

function stopDragAutoScroll() {
  if (dragScrollTimer) {
    cancelAnimationFrame(dragScrollTimer);
    dragScrollTimer = null;
  }
}

function attachDragAndTouchHandlers(row, dragHandle, itemType, index, itemsArray, container, listSelector) {
  row.setAttribute('draggable', 'true');
  row.setAttribute('data-drag-index', index.toString());

  // HTML5 Mouse Drag Events
  row.ondragstart = (e) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: itemType, index }));
    row.classList.add('dragging');
  };

  row.ondragend = () => {
    stopDragAutoScroll();
    row.classList.remove('dragging');
    container.querySelectorAll('.editor-list-item').forEach(el => {
      el.classList.remove('drag-over-top', 'drag-over-bottom');
    });
  };

  row.ondragover = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const listEl = container.querySelector(listSelector);
    handleDragAutoScroll(e, listEl);

    const rect = row.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      row.classList.add('drag-over-top');
      row.classList.remove('drag-over-bottom');
    } else {
      row.classList.add('drag-over-bottom');
      row.classList.remove('drag-over-top');
    }
  };

  row.ondragleave = () => {
    stopDragAutoScroll();
    row.classList.remove('drag-over-top', 'drag-over-bottom');
  };

  row.ondrop = (e) => {
    e.preventDefault();
    stopDragAutoScroll();
    row.classList.remove('drag-over-top', 'drag-over-bottom');
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      if (data && data.type === itemType && typeof data.index === 'number') {
        const fromIndex = data.index;
        const rect = row.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        let toIndex = e.clientY < midY ? index : index + 1;

        if (fromIndex !== toIndex) {
          const [moved] = itemsArray.splice(fromIndex, 1);
          if (toIndex > fromIndex) toIndex--;
          itemsArray.splice(toIndex, 0, moved);
          const renderFn = row.closest('#muteEditContent').__renderMuteStructure;
          if (typeof renderFn === 'function') renderFn();
        }
      }
    } catch (err) { }
  };

  // Mobile / Touch Drag Events
  dragHandle.ontouchstart = (e) => {
    const fromIndex = index;
    row.classList.add('dragging');

    const onTouchMove = (moveEv) => {
      if (moveEv.cancelable) moveEv.preventDefault();
      const moveTouch = moveEv.touches[0];
      const clientY = moveTouch.clientY;
      const clientX = moveTouch.clientX;

      const listEl = container.querySelector(listSelector);
      handleDragAutoScroll({ clientY }, listEl);

      const elementUnder = document.elementFromPoint(clientX, clientY);
      const targetRow = elementUnder ? elementUnder.closest('.editor-list-item') : null;

      container.querySelectorAll('.editor-list-item').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      if (targetRow && targetRow !== row) {
        const rect = targetRow.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (clientY < midY) {
          targetRow.classList.add('drag-over-top');
        } else {
          targetRow.classList.add('drag-over-bottom');
        }
      }
    };

    const onTouchEnd = (endEv) => {
      stopDragAutoScroll();
      row.classList.remove('dragging');
      const endTouch = endEv.changedTouches[0];
      const clientY = endTouch ? endTouch.clientY : 0;
      const clientX = endTouch ? endTouch.clientX : 0;

      const elementUnder = document.elementFromPoint(clientX, clientY);
      const targetRow = elementUnder ? elementUnder.closest('.editor-list-item') : null;

      container.querySelectorAll('.editor-list-item').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      if (targetRow) {
        const targetIndexStr = targetRow.getAttribute('data-drag-index');
        if (targetIndexStr !== null) {
          const toIdx = parseInt(targetIndexStr, 10);
          const rect = targetRow.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          let finalIdx = clientY < midY ? toIdx : toIdx + 1;

          if (fromIndex !== finalIdx) {
            const [moved] = itemsArray.splice(fromIndex, 1);
            if (finalIdx > fromIndex) finalIdx--;
            itemsArray.splice(finalIdx, 0, moved);
            const container = row.closest('#muteEditContent');
            const renderFn = container ? container.__renderMuteStructure : null;
            if (typeof renderFn === 'function') renderFn();
          }
        }
      }

      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };

    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
  };
}

/**
 * 確認ダイアログを表示する
 */
function showConfirmDialog(parentElement, msgKey, okBtnKey) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'editor-confirm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'editor-confirm-dialog';

    const msg = document.createElement('div');
    msg.className = 'editor-confirm-msg';
    msg.innerHTML = `<strong>${t(msgKey) || 'Confirm'}</strong><br><br>${t(msgKey + '_detail') || ''}`;

    const btnGroup = document.createElement('div');
    btnGroup.className = 'editor-confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = t('editor.common.cancel') || 'Cancel';
    cancelBtn.className = 'secondary';
    cancelBtn.type = 'button';
    cancelBtn.onclick = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(false);
    };

    const okBtn = document.createElement('button');
    const okBtnText = okBtnKey ? (t(okBtnKey) || okBtnKey) : (t('editor.common.confirm_publish') || 'Publish');
    okBtn.textContent = okBtnText;
    okBtn.type = 'button';
    okBtn.onclick = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(true);
    };

    btnGroup.appendChild(cancelBtn);
    btnGroup.appendChild(okBtn);
    dialog.appendChild(msg);
    dialog.appendChild(btnGroup);
    overlay.appendChild(dialog);

    if (getComputedStyle(parentElement).position === 'static') {
      parentElement.style.position = 'relative';
    }

    parentElement.appendChild(overlay);
  });
}

function getSecretKeyHex(state) {
  return signer.hasKey();
}

/**
 * ミュートデータの初期パース
 */
async function parseMuteEvent(ev, state) {
  const publicUsers = new Set();
  const publicWords = new Set();
  const nonMuteTags = [];

  if (ev && ev.tags) {
    for (const tag of ev.tags) {
      if (tag[0] === 'p' && tag[1]) {
        publicUsers.add(tag[1]);
      } else if (tag[0] === 'word' && tag[1]) {
        publicWords.add(tag[1]);
      } else {
        nonMuteTags.push([...tag]);
      }
    }
  }

  const content = ev ? (ev.content || '') : '';
  let encryptionMode = 'nip44'; // 新規時は nip44 優先
  let privateUsers = new Set();
  let privateWords = new Set();
  let canEditPrivate = true;
  let decryptedSuccess = false;

  if (content && typeof content === 'string' && content.trim() !== '') {
    // 平文 JSON の可能性チェック
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        extractMuteObj(parsed, privateUsers, privateWords);
        decryptedSuccess = true;
      }
    } catch (e) {
      // 暗号化されている
    }

    if (!decryptedSuccess) {
      // NIP-04 か NIP-44 か判定
      const isNip04Format = content.includes('?iv=');
      if (isNip04Format) {
        encryptionMode = 'nip04';
      } else {
        encryptionMode = 'nip44';
      }

      // 復号を試みる
      const nip44 = getNip44();
      const nip04 = getNip04();
      const myPubkey = state.pubkey || localStorage.getItem('pubkey');
      const targetPubkey = (ev && ev.pubkey) ? ev.pubkey : myPubkey;

      // 1. NIP-44 復号試行
      if (encryptionMode === 'nip44') {
        if (nip44 && nip44.v2 && signer.hasKey() && myPubkey) {
          try {
            let decrypted = signer.nip44Decrypt(nip44, content, targetPubkey);
            if (decrypted && typeof decrypted.then === 'function') decrypted = await decrypted;
            if (decrypted) {
              const parsed = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
              extractMuteObj(parsed, privateUsers, privateWords);
              decryptedSuccess = true;
            }
          } catch (e) { }
        }
        if (!decryptedSuccess && window.nostr && window.nostr.nip44 && typeof window.nostr.nip44.decrypt === 'function') {
          try {
            let decrypted = window.nostr.nip44.decrypt(targetPubkey, content);
            if (decrypted && typeof decrypted.then === 'function') decrypted = await decrypted;
            if (decrypted) {
              const parsed = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
              extractMuteObj(parsed, privateUsers, privateWords);
              decryptedSuccess = true;
            }
          } catch (e) { }
        }
        if (!decryptedSuccess && state.signer === 'nip46' && state.nip46 && state.nip46.client && typeof state.nip46.client.nip44Decrypt === 'function') {
          try {
            const decrypted = await state.nip46.client.nip44Decrypt(targetPubkey, content);
            if (decrypted) {
              const parsed = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
              extractMuteObj(parsed, privateUsers, privateWords);
              decryptedSuccess = true;
            }
          } catch (e) { }
        }
      }

      // 2. NIP-04 復号試行
      if (!decryptedSuccess) {
        if (nip04 && signer.hasKey() && myPubkey) {
          try {
            let decrypted = signer.nip04Decrypt(nip04, myPubkey, content);
            if (decrypted && typeof decrypted.then === 'function') decrypted = await decrypted;
            if (decrypted) {
              const parsed = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
              extractMuteObj(parsed, privateUsers, privateWords);
              decryptedSuccess = true;
              encryptionMode = 'nip04';
            }
          } catch (e) { }
        }
        if (!decryptedSuccess && window.nostr && window.nostr.nip04 && typeof window.nostr.nip04.decrypt === 'function') {
          try {
            let decrypted = window.nostr.nip04.decrypt(myPubkey, content);
            if (decrypted && typeof decrypted.then === 'function') decrypted = await decrypted;
            if (decrypted) {
              const parsed = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
              extractMuteObj(parsed, privateUsers, privateWords);
              decryptedSuccess = true;
              encryptionMode = 'nip04';
            }
          } catch (e) { }
        }
        if (!decryptedSuccess && state.signer === 'nip46' && state.nip46 && state.nip46.client && typeof state.nip46.client.nip04Decrypt === 'function') {
          try {
            const decrypted = await state.nip46.client.nip04Decrypt(myPubkey, content);
            if (decrypted) {
              const parsed = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
              extractMuteObj(parsed, privateUsers, privateWords);
              decryptedSuccess = true;
              encryptionMode = 'nip04';
            }
          } catch (e) { }
        }
      }

      // 3. NIP-44 フォールバック試行
      if (!decryptedSuccess && window.nostr && window.nostr.nip44 && typeof window.nostr.nip44.decrypt === 'function') {
        try {
          let decrypted = window.nostr.nip44.decrypt(myPubkey, content);
          if (decrypted && typeof decrypted.then === 'function') decrypted = await decrypted;
          if (decrypted) {
            const parsed = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
            extractMuteObj(parsed, privateUsers, privateWords);
            decryptedSuccess = true;
            encryptionMode = 'nip44';
          }
        } catch (e) { }
      }

      if (!decryptedSuccess) {
        // 鍵がなく復号失敗 ➔ 非公開部分は編集不可・保護
        canEditPrivate = false;
      }
    }
  }

  return {
    publicUsers: Array.from(publicUsers),
    publicWords: Array.from(publicWords),
    privateUsers: Array.from(privateUsers),
    privateWords: Array.from(privateWords),
    nonMuteTags,
    content,
    encryptionMode,
    canEditPrivate
  };
}

function extractMuteObj(parsed, usersSet, wordsSet) {
  if (!parsed) return;

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (Array.isArray(item)) {
        if (item[0] === 'p' && item[1]) usersSet.add(item[1]);
        if (item[0] === 'word' && item[1]) wordsSet.add(item[1]);
      }
    }
  } else if (typeof parsed === 'object') {
    if (parsed.pubkeys) {
      const arr = Array.isArray(parsed.pubkeys) ? parsed.pubkeys : (parsed.pubkeys.private || parsed.pubkeys.public || []);
      if (Array.isArray(arr)) arr.forEach(pk => usersSet.add(pk));
    }
    if (parsed.words) {
      const arr = Array.isArray(parsed.words) ? parsed.words : (parsed.words.private || parsed.words.public || []);
      if (Array.isArray(arr)) arr.forEach(w => wordsSet.add(w));
    }
  }
}

/**
 * ミュートデータの暗号化
 */
async function encryptPrivateMutes(state, privateUsers, privateWords, encryptionMode) {
  const muteTags = [];
  privateUsers.forEach(pk => muteTags.push(['p', pk]));
  privateWords.forEach(w => muteTags.push(['word', w]));

  const plaintext = JSON.stringify(muteTags);
  const myPubkey = state.pubkey || localStorage.getItem('pubkey');

  const nip44 = getNip44();
  const nip04 = getNip04();

  const checkNip07Match = async () => {
    if (typeof window === 'undefined' || !window.nostr) return false;
    if (typeof window.nostr.getPublicKey === 'function') {
      try {
        const extPk = await window.nostr.getPublicKey();
        if (extPk && myPubkey && extPk.toLowerCase() !== myPubkey.toLowerCase()) {
          console.warn('[MuteEditor] NIP-07拡張のアカウントが不一致のため拡張機能暗号化をスキップします');
          return false;
        }
      } catch (e) {
        return false;
      }
    }
    return true;
  };

  // NIP-44 暗号化
  if (encryptionMode === 'nip44') {
    if (nip44 && nip44.v2 && signer.hasKey() && myPubkey) {
      return signer.nip44Encrypt(nip44, plaintext, myPubkey);
    }
    if (window.nostr && window.nostr.nip44 && typeof window.nostr.nip44.encrypt === 'function' && (await checkNip07Match())) {
      let res = window.nostr.nip44.encrypt(myPubkey, plaintext);
      if (res && typeof res.then === 'function') res = await res;
      if (res) return res;
    }
    if (state.signer === 'nip46' && state.nip46 && state.nip46.client) {
      const client = state.nip46.client;
      if (typeof client.nip44Encrypt === 'function') {
        return await client.nip44Encrypt(myPubkey, plaintext);
      }
    }
  }

  // NIP-04 暗号化
  if (encryptionMode === 'nip04') {
    if (nip04 && signer.hasKey() && myPubkey) {
      let res = signer.nip04Encrypt(nip04, myPubkey, plaintext);
      if (res && typeof res.then === 'function') res = await res;
      return res;
    }
    if (window.nostr && window.nostr.nip04 && typeof window.nostr.nip04.encrypt === 'function' && (await checkNip07Match())) {
      let res = window.nostr.nip04.encrypt(myPubkey, plaintext);
      if (res && typeof res.then === 'function') res = await res;
      if (res) return res;
    }
    if (state.signer === 'nip46' && state.nip46 && state.nip46.client) {
      const client = state.nip46.client;
      if (typeof client.nip04Encrypt === 'function') {
        return await client.nip04Encrypt(myPubkey, plaintext);
      }
      if (typeof client._encrypt === 'function') {
        return await client._encrypt(plaintext, myPubkey);
      }
    }
  }

  // フォールバック: NIP-07 (window.nostr.nip44 または nip04)
  if (window.nostr && (await checkNip07Match())) {
    if (window.nostr.nip44 && typeof window.nostr.nip44.encrypt === 'function') {
      let res = window.nostr.nip44.encrypt(myPubkey, plaintext);
      if (res && typeof res.then === 'function') res = await res;
      if (res) return res;
    }
    if (window.nostr.nip04 && typeof window.nostr.nip04.encrypt === 'function') {
      let res = window.nostr.nip04.encrypt(myPubkey, plaintext);
      if (res && typeof res.then === 'function') res = await res;
      if (res) return res;
    }
  }

  if (nip44 && nip44.v2 && signer.hasKey() && myPubkey) {
    return signer.nip44Encrypt(nip44, plaintext, myPubkey);
  }

  throw new Error('Encryption unavailable for selected mode: ' + encryptionMode);
}

/**
 * ミュート状態を更新してローカル状態と同期
 */
function syncMuteStateToApp(state, publicUsers, publicWords, privateUsers, privateWords) {
  const expanded = {
    pubkeys: {
      public: Array.from(publicUsers),
      private: Array.from(privateUsers)
    },
    words: {
      public: Array.from(publicWords),
      private: Array.from(privateWords)
    }
  };

  try {
    const myPubkey = (state && state.pubkey) || localStorage.getItem('pubkey');
    const str = JSON.stringify(expanded);
    localStorage.setItem('muteList_expanded', str);
    if (myPubkey) {
      localStorage.setItem(`muteList_expanded.${myPubkey.toLowerCase()}`, str);
    }
    window.__nokakoiMuteList = expanded;
    try { invalidateMuteConfigCache(); } catch (e) { }
    try { refreshEventsMuteState(state); } catch (e) { }
    try { updateAllMuteButtonStates(state); } catch (e) { }
    try { window.dispatchEvent(new CustomEvent('muteListUpdated')); } catch (e) { }
    try {
      if (typeof window.softReload === 'function') {
        window.softReload();
      } else {
        window.dispatchEvent(new CustomEvent('softReloadRequest'));
      }
    } catch (e) { }
  } catch (e) { }
}

/**
 * ミュート状態の判定
 */
export function isUserMuted(state, targetPubkey) {
  try {
    if (!targetPubkey) return false;
    let hexPk = String(targetPubkey).trim();
    if (hexPk.startsWith('npub')) {
      try {
        const nip19 = getNip19();
        if (nip19 && typeof nip19.decode === 'function') {
          const decoded = nip19.decode(hexPk);
          if (decoded && decoded.data) hexPk = decoded.data;
        }
      } catch (e) { }
    }
    hexPk = String(hexPk).toLowerCase();

    let stored = window.__nokakoiMuteList;
    if (!stored) {
      try {
        const raw = localStorage.getItem('muteList_expanded');
        if (raw) stored = JSON.parse(raw);
      } catch (e) { }
    }

    if (!stored || !stored.pubkeys) return false;
    const pubP = (Array.isArray(stored.pubkeys.public) ? stored.pubkeys.public : []).map(p => String(p).toLowerCase());
    const pubPr = (Array.isArray(stored.pubkeys.private) ? stored.pubkeys.private : []).map(p => String(p).toLowerCase());
    return pubP.includes(hexPk) || pubPr.includes(hexPk);
  } catch (e) {
    return false;
  }
}

/**
 * 単一ユーザーの即時ミュート/解除
 */
export async function toggleMuteUser(state, targetPubkey, buttonEl) {
  try {
    const myPubkey = localStorage.getItem('pubkey');
    if (!myPubkey) {
      console.error('未ログインです');
      return false;
    }

    let cleanTargetPk = String(targetPubkey || '').trim();
    if (cleanTargetPk.startsWith('npub')) {
      try {
        const nip19 = getNip19();
        if (nip19 && typeof nip19.decode === 'function') {
          const decoded = nip19.decode(cleanTargetPk);
          if (decoded && decoded.data) cleanTargetPk = decoded.data;
        }
      } catch (e) { }
    }
    cleanTargetPk = cleanTargetPk.toLowerCase();
    if (!cleanTargetPk) return false;

    const currentlyMuted = isUserMuted(state, cleanTargetPk);

    // 確認ダイアログ
    const parentEl = document.getElementById('profileModal') || document.body;
    const confirmKey = currentlyMuted ? 'editor.mute.confirm_unmute' : 'editor.mute.confirm_mute';
    const okBtnKey = currentlyMuted ? 'editor.mute.unmute' : 'editor.mute.mute';

    const confirmed = await showConfirmDialog(parentEl, confirmKey, okBtnKey);
    if (!confirmed) return false;

    if (buttonEl) buttonEl.disabled = true;

    // 最新 kind:10000 取得
    const latestEvent = await fetchLatestEvent(state, 10000, myPubkey);
    const parsed = await parseMuteEvent(latestEvent, state);

    let pubUsers = new Set(parsed.publicUsers.map(u => String(u).toLowerCase()));
    let privUsers = new Set(parsed.privateUsers.map(u => String(u).toLowerCase()));
    let newContent = parsed.content;

    if (currentlyMuted) {
      // 解除
      pubUsers.delete(cleanTargetPk);
      privUsers.delete(cleanTargetPk);
    } else {
      // ミュート追加（暗号化可能なら非公開、不可なら公開へ）
      if (parsed.canEditPrivate) {
        privUsers.add(cleanTargetPk);
      } else {
        pubUsers.add(cleanTargetPk);
      }
    }

    // 暗号化 content 構築
    if (parsed.canEditPrivate) {
      try {
        newContent = await encryptPrivateMutes(state, privUsers, new Set(parsed.privateWords), parsed.encryptionMode);
      } catch (e) {
        console.warn('[MuteEditor] 暗号化失敗、公開リストにフォールバック:', e);
        if (!currentlyMuted) {
          privUsers.delete(cleanTargetPk);
          pubUsers.add(cleanTargetPk);
        }
      }
    }

    // 新規 tags 構築
    const newTags = [...parsed.nonMuteTags];
    pubUsers.forEach(pk => newTags.push(['p', pk]));
    parsed.publicWords.forEach(w => newTags.push(['word', w]));

    const draft = {
      kind: 10000,
      created_at: Math.floor(Date.now() / 1000),
      tags: newTags,
      content: newContent,
      pubkey: myPubkey
    };

    if (latestEvent) {
      backupEvent(10000, latestEvent);
    }

    const res = await publishReplaceableEvent(state, draft);
    if (res && res.ok) {
      syncMuteStateToApp(state, pubUsers, parsed.publicWords, privUsers, parsed.privateWords);
      updateMuteButtonState(state, buttonEl, cleanTargetPk);
      return true;
    }

    return false;
  } catch (err) {
    console.error('ミュート切り替え中にエラーが発生しました', err);
    return false;
  } finally {
    if (buttonEl) buttonEl.disabled = false;
  }
}

/**
 * ミュートボタンの見た目を更新
 */
export function updateMuteButtonState(state, buttonEl, targetPubkey) {
  if (!buttonEl) return;

  if (targetPubkey) {
    buttonEl.dataset.pubkey = targetPubkey;
  }
  const pk = targetPubkey || buttonEl.dataset.pubkey;
  if (!pk) return;

  const muted = isUserMuted(state, pk);

  if (muted) {
    buttonEl.textContent = t('editor.mute.muting') || 'ミュート中';
    buttonEl.className = 'btn-mute-toggle muting';
  } else {
    buttonEl.textContent = t('editor.mute.mute') || '🔇 ミュート';
    buttonEl.className = 'btn-mute-toggle not-muted';
  }
}

/**
 * アプリ全体のすべてのミュートボタンの表示を更新・同期
 */
export function updateAllMuteButtonStates(state = null, targetPubkey = null) {
  try {
    const selector = targetPubkey
      ? `.btn-mute-toggle[data-pubkey="${targetPubkey}"]`
      : '.btn-mute-toggle';
    const btns = document.querySelectorAll(selector);
    btns.forEach(btn => {
      const pk = targetPubkey || btn.dataset.pubkey;
      if (pk) updateMuteButtonState(state, btn, pk);
    });
  } catch (e) { }
}

if (typeof window !== 'undefined' && !window.__nokakoiMuteButtonListenerInstalled) {
  try {
    window.addEventListener('muteListUpdated', () => {
      try { updateAllMuteButtonStates(null); } catch (e) { }
    });
    window.__nokakoiMuteButtonListenerInstalled = true;
  } catch (e) { }
}

/**
 * ミュートリスト編集モーダルを開く
 */
export async function openMuteEditor(state) {
  const modal = document.getElementById('muteEditModal');
  if (!modal) return;

  modal.hidden = false;

  const statusEl = document.getElementById('muteEditStatus');
  const contentEl = document.getElementById('muteEditContent');
  const saveBtn = document.getElementById('muteEditSaveBtn');
  const cancelBtn = document.getElementById('muteEditCancelBtn');
  const closeBtn = document.getElementById('muteEditClose');

  if (statusEl) statusEl.textContent = t('editor.common.fetching') || 'Fetching...';
  if (contentEl) contentEl.innerHTML = '';

  const myPubkey = localStorage.getItem('pubkey');
  if (!myPubkey) {
    if (statusEl) statusEl.textContent = t('editor.common.no_login') || 'Login required';
    return;
  }

  // 重複登録を防ぐためボタンをクローン
  const newSaveBtn = saveBtn ? saveBtn.cloneNode(true) : null;
  const newCancelBtn = cancelBtn ? cancelBtn.cloneNode(true) : null;
  const newCloseBtn = closeBtn ? closeBtn.cloneNode(true) : null;

  if (saveBtn && newSaveBtn) saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  if (cancelBtn && newCancelBtn) cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  if (closeBtn && newCloseBtn) closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

  // 最新の kind:10000 を取得
  const latestEvent = await fetchLatestEvent(state, 10000, myPubkey);
  if (latestEvent) {
    backupEvent(10000, latestEvent);
  }

  const parsed = await parseMuteEvent(latestEvent, state);

  let publicUserItems = parsed.publicUsers.map(pk => ({ pubkey: pk, isMuted: true }));
  let publicWordItems = parsed.publicWords.map(w => ({ word: w, isMuted: true }));
  let privateUserItems = parsed.privateUsers.map(pk => ({ pubkey: pk, isMuted: true }));
  let privateWordItems = parsed.privateWords.map(w => ({ word: w, isMuted: true }));

  let activeMainTab = 'mutes'; // 'mutes' | 'snapshots'
  let activeTab = parsed.canEditPrivate ? 'private' : 'public'; // 非公開ミュート編集可能なら非公開タブを初期選択
  let selectedEncryptionMode = parsed.encryptionMode || 'nip44';

  if (statusEl) statusEl.textContent = '';

  function renderMuteStructure() {
    if (contentEl) contentEl.__renderMuteStructure = renderMuteStructure;
    const modalBody = modal.querySelector('.modal-body');
    const savedModalScroll = modalBody ? modalBody.scrollTop : 0;
    const wordsListPrev = contentEl.querySelector('#muteWordsList');
    const usersListPrev = contentEl.querySelector('#muteUsersList');
    const savedWordsScroll = wordsListPrev ? wordsListPrev.scrollTop : 0;
    const savedUsersScroll = usersListPrev ? usersListPrev.scrollTop : 0;

    contentEl.innerHTML = `
      <div class="editor-tabs mb-12">
        <button type="button" class="editor-tab ${activeMainTab === 'mutes' ? 'active' : ''}" id="tabMainMutes">
          ${t('editor.snapshot.tab_current') || '現在のリスト'}
        </button>
        <button type="button" class="editor-tab ${activeMainTab === 'snapshots' ? 'active' : ''}" id="tabMainSnapshots">
          ${t('editor.snapshot.tab_saved') || '保存済みリスト'}
        </button>
      </div>
      <div id="muteMainBody"></div>
    `;

    const tabMainMutes = contentEl.querySelector('#tabMainMutes');
    const tabMainSnapshots = contentEl.querySelector('#tabMainSnapshots');
    const mainBody = contentEl.querySelector('#muteMainBody');

    tabMainMutes.onclick = () => {
      activeMainTab = 'mutes';
      renderMuteStructure();
    };

    tabMainSnapshots.onclick = () => {
      activeMainTab = 'snapshots';
      renderMuteStructure();
    };

    if (activeMainTab === 'snapshots') {
      if (newSaveBtn) newSaveBtn.hidden = true;
      renderSavedSnapshotsView(mainBody);
    } else {
      if (newSaveBtn) newSaveBtn.hidden = false;
      renderMutesTab(mainBody);
    }

    requestAnimationFrame(() => {
      if (modalBody) modalBody.scrollTop = savedModalScroll;
      const wordsListNew = contentEl.querySelector('#muteWordsList');
      const usersListNew = contentEl.querySelector('#muteUsersList');
      if (wordsListNew) wordsListNew.scrollTop = savedWordsScroll;
      if (usersListNew) usersListNew.scrollTop = savedUsersScroll;
    });
  }

  // 1. 「保存済みリスト」タブの描画 (フォローリストと完全同一カードデザイン・インライン名前編集付き)
  function renderSavedSnapshotsView(container) {
    container.innerHTML = '';
    const snapshots = loadMuteSnapshots();
    if (snapshots.length === 0) {
      container.innerHTML = `<div class="muted p-16 text-center">${t('editor.snapshot.empty') || 'No saved lists found.'}</div>`;
      return;
    }

    const listEl = document.createElement('div');
    listEl.className = 'editor-list';

    snapshots.forEach((snap, idx) => {
      const card = document.createElement('div');
      card.className = 'snapshot-card';

      const userCount = (snap.publicUsers ? snap.publicUsers.length : 0) + (snap.privateUsers ? snap.privateUsers.length : 0);
      const wordCount = (snap.publicWords ? snap.publicWords.length : 0) + (snap.privateWords ? snap.privateWords.length : 0);

      card.innerHTML = `
        <div class="snapshot-header">
          <input type="text" class="snapshot-title-input" value="${snap.name || ''}" placeholder="リスト名">
          <span class="snapshot-meta">${userCount} Users / ${wordCount} Words</span>
        </div>
        <div class="snapshot-meta mb-8 row align-center gap-8">
          <span>🕒 ${formatDateStr(snap.createdAt)}</span>
          <span style="font-size:0.75rem; padding:2px 8px; border-radius:12px; background:var(--panel-hover, rgba(255,255,255,0.08)); border:1px solid var(--border);">
            🔐 ${snap.encryptionMode === 'nip04' ? 'NIP-04' : 'NIP-44 (v2)'}
          </span>
        </div>
        <div class="snapshot-actions">
          <button type="button" class="restore-snap-btn">${t('editor.snapshot.restore') || '適用'}</button>
          <button type="button" class="secondary delete-snap-btn">${t('editor.snapshot.delete') || '削除'}</button>
        </div>
      `;

      // スナップショット名のインライン編集・変更保存
      const titleInput = card.querySelector('.snapshot-title-input');
      if (titleInput) {
        titleInput.onchange = (e) => {
          const newName = e.target.value.trim();
          snap.name = newName || formatDateStr(snap.createdAt);
          snapshots[idx] = snap;
          saveMuteSnapshots(snapshots);
        };
      }

      // 編集領域への適用処理
      const restoreBtn = card.querySelector('.restore-snap-btn');
      if (restoreBtn) {
        restoreBtn.onclick = async () => {
          const confirmed = await showConfirmDialog(
            modal.querySelector('.modal-body') || modal,
            'editor.snapshot.confirm_restore',
            'editor.snapshot.restore'
          );
          if (confirmed) {
            if (snap.publicUsers) publicUserItems = snap.publicUsers.map(pk => ({ pubkey: pk, isMuted: true }));
            if (snap.publicWords) publicWordItems = snap.publicWords.map(w => ({ word: w, isMuted: true }));
            if (snap.privateUsers) privateUserItems = snap.privateUsers.map(pk => ({ pubkey: pk, isMuted: true }));
            if (snap.privateWords) privateWordItems = snap.privateWords.map(w => ({ word: w, isMuted: true }));
            if (snap.encryptionMode) selectedEncryptionMode = snap.encryptionMode;
            activeMainTab = 'mutes';
            renderMuteStructure();
          }
        };
      }

      // 削除処理
      const deleteBtn = card.querySelector('.delete-snap-btn');
      if (deleteBtn) {
        deleteBtn.onclick = async () => {
          const confirmed = await showConfirmDialog(
            modal.querySelector('.modal-body') || modal,
            'editor.snapshot.confirm_delete',
            'editor.snapshot.delete'
          );
          if (confirmed) {
            snapshots.splice(idx, 1);
            saveMuteSnapshots(snapshots);
            renderMuteStructure();
          }
        };
      }

      listEl.appendChild(card);
    });

    container.appendChild(listEl);
  }

  // 2. 「現在のリスト」タブの描画
  function renderMutesTab(container) {
    const totalUsers = publicUserItems.filter(i => i.isMuted).length + privateUserItems.filter(i => i.isMuted).length;
    const totalWords = publicWordItems.filter(i => i.isMuted).length + privateWordItems.filter(i => i.isMuted).length;

    container.innerHTML = `
      <div style="display: flex; justify-content: flex-end;" class="mb-8">
        <button type="button" class="secondary text-sm" id="saveSnapshotBtn">
          ${t('editor.snapshot.save_btn') || '現在のリストを保存'}
        </button>
      </div>
      <div class="row align-center justify-between mb-12">
        <label class="setting-row">
          <span>${t('editor.mute.encryption_select') || '暗号化方式：'}</span>
          <select id="muteEncryptionModeSelect" ${!parsed.canEditPrivate ? 'disabled' : ''}>
            <option value="nip44" ${selectedEncryptionMode === 'nip44' ? 'selected' : ''}>NIP-44 (v2) [${t('editor.mute.enc_recommended') || 'Recommended'}]</option>
            <option value="nip04" ${selectedEncryptionMode === 'nip04' ? 'selected' : ''}>NIP-04 [${t('editor.mute.enc_legacy') || 'Legacy'}]</option>
          </select>
        </label>
      </div>
      ${!parsed.canEditPrivate ? `<div class="editor-confirm-msg p-8 mb-12" style="background:var(--panel); border:1px solid var(--border); border-radius:6px; font-size:0.85rem;">⚠️ ${t('editor.mute.protected_notice')}</div>` : ''}
      <div class="editor-tabs">
        <button type="button" class="editor-tab ${activeTab === 'public' ? 'active' : ''}" id="tabMutePublic">
          ${t('editor.mute.tab_public') || 'Public Mute'}
        </button>
        <button type="button" class="editor-tab ${activeTab === 'private' ? 'active' : ''}" id="tabMutePrivate">
          ${t('editor.mute.tab_private') || 'Private Mute'}
        </button>
      </div>
      <div id="muteTabBody"></div>
    `;

    // 「現在のリストを保存」アクション
    const saveSnapshotBtn = container.querySelector('#saveSnapshotBtn');
    if (saveSnapshotBtn) {
      saveSnapshotBtn.onclick = () => {
        const snapshots = loadMuteSnapshots();
        const now = Date.now();
        const defaultName = formatDateStr(now);

        const newSnap = {
          id: 'snap_' + now,
          name: defaultName,
          createdAt: now,
          publicUsers: publicUserItems.filter(i => i.isMuted).map(i => i.pubkey),
          publicWords: publicWordItems.filter(i => i.isMuted).map(i => i.word),
          privateUsers: privateUserItems.filter(i => i.isMuted).map(i => i.pubkey),
          privateWords: privateWordItems.filter(i => i.isMuted).map(i => i.word),
          encryptionMode: selectedEncryptionMode
        };

        snapshots.unshift(newSnap);
        saveMuteSnapshots(snapshots);

        if (statusEl) {
          statusEl.textContent = t('editor.snapshot.saved_msg') || 'Saved';
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
        }

        activeMainTab = 'snapshots';
        renderMuteStructure();
      };
    }

    const tabPub = container.querySelector('#tabMutePublic');
    const tabPriv = container.querySelector('#tabMutePrivate');
    const encSelect = container.querySelector('#muteEncryptionModeSelect');

    tabPub.onclick = () => {
      activeTab = 'public';
      renderMuteStructure();
    };

    tabPriv.onclick = () => {
      activeTab = 'private';
      renderMuteStructure();
    };

    if (encSelect) {
      encSelect.onchange = () => {
        selectedEncryptionMode = encSelect.value;
      };
    }

    const bodyEl = container.querySelector('#muteTabBody');

    if (activeTab === 'public') {
      renderMuteSection(bodyEl, publicUserItems, publicWordItems, true, 'public');
    } else {
      renderMuteSection(bodyEl, privateUserItems, privateWordItems, parsed.canEditPrivate, 'private');
    }
  }

  function renderMuteSection(container, userItems, wordItems, editable, tabType) {
    container.innerHTML = `
      <!-- 単語ミュートセクション -->
      <div class="font-bold text-sm mb-6">単語 (${wordItems.filter(w => w.isMuted).length})</div>
      ${editable ? `
      <div class="flex-row gap-6 mb-8">
        <input type="text" id="addMuteWordInput" placeholder="${t('editor.mute.add_word_placeholder') || 'Enter word...'}" class="flex-1">
        <button type="button" id="addMuteWordBtn">${t('editor.mute.add_btn') || 'Add'}</button>
      </div>
      ` : ''}
      <div id="muteWordsList" class="editor-list mb-16"></div>

      <!-- ユーザーミュートセクション -->
      <div class="font-bold text-sm mb-6">ユーザー (${userItems.filter(u => u.isMuted).length})</div>
      <div id="muteUsersList" class="editor-list"></div>
    `;

    if (editable) {
      const wordInput = container.querySelector('#addMuteWordInput');
      const addWordBtn = container.querySelector('#addMuteWordBtn');
      if (addWordBtn && wordInput) {
        addWordBtn.onclick = () => {
          const w = wordInput.value.trim();
          if (w) {
            const existing = wordItems.find(item => item.word === w);
            if (existing) {
              existing.isMuted = true;
            } else {
              wordItems.push({ word: w, isMuted: true });
            }
            wordInput.value = '';
            renderMuteStructure();
          }
        };
      }
    }

    // ユーザー一覧レンダリング
    const usersListEl = container.querySelector('#muteUsersList');
    if (userItems.length === 0) {
      usersListEl.innerHTML = `<div class="muted p-8 text-center text-sm">${t('editor.mute.empty')}</div>`;
    } else {
      userItems.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'editor-list-item';
        row.setAttribute('data-focus-pubkey', item.pubkey);

        if (editable) {
          const dragHandle = document.createElement('span');
          dragHandle.className = 'drag-handle';
          dragHandle.textContent = '☰';
          row.appendChild(dragHandle);

          attachDragAndTouchHandlers(row, dragHandle, 'user', index, userItems, container, '#muteUsersList');
        }

        const info = document.createElement('div');
        info.className = 'editor-list-info';

        const avatar = document.createElement('img');
        avatar.className = 'editor-list-avatar d-none';
        avatar.alt = '';
        avatar.onerror = () => avatar.classList.add('d-none');

        const nameEl = document.createElement('span');
        nameEl.className = 'editor-list-name';
        nameEl.textContent = item.pubkey.substring(0, 10) + '...';

        const subEl = document.createElement('span');
        subEl.className = 'editor-list-sub d-none';

        loadProfile(state, item.pubkey).then(prof => {
          if (prof) {
            if (prof.picture) {
              avatar.src = prof.picture;
              avatar.classList.remove('d-none');
            }
            const names = displayNameWithUsername(state, item.pubkey, getNip19(), { usePetname: false, noTruncate: true });
            nameEl.textContent = names.main;
            if (names.sub) {
              subEl.textContent = `@${names.sub}`;
              subEl.classList.remove('d-none');
            } else {
              subEl.textContent = '';
              subEl.classList.add('d-none');
            }
          }
        }).catch(() => { });

        info.appendChild(avatar);
        info.appendChild(nameEl);
        info.appendChild(subEl);

        info.onclick = (e) => {
          e.stopPropagation();
          import('../../ui/renderers/render-helpers.js').then(helpers => {
            if (helpers && typeof helpers.invokeShowProfileModalProxy === 'function') {
              helpers.invokeShowProfileModalProxy(item.pubkey);
            } else {
              import('../profile/profile-modal.js').then(mod => {
                if (mod && typeof mod.showProfileModal === 'function') {
                  mod.showProfileModal(state, item.pubkey);
                }
              });
            }
          }).catch(() => {
            import('../profile/profile-modal.js').then(mod => {
              if (mod && typeof mod.showProfileModal === 'function') {
                mod.showProfileModal(state, item.pubkey);
              }
            });
          });
        };

        const actions = document.createElement('div');
        actions.className = 'editor-list-actions';

        if (editable) {
          // 公開 ↔ 非公開 移動ボタン
          if (parsed.canEditPrivate) {
            const moveBtn = document.createElement('button');
            moveBtn.type = 'button';
            moveBtn.className = 'secondary text-xs';
            moveBtn.textContent = tabType === 'public'
              ? (t('editor.mute.move_to_private') || 'Move to Private')
              : (t('editor.mute.move_to_public') || 'Move to Public');

            moveBtn.onclick = () => {
              if (tabType === 'public') {
                publicUserItems = publicUserItems.filter(u => u.pubkey !== item.pubkey);
                if (!privateUserItems.some(u => u.pubkey === item.pubkey)) {
                  privateUserItems.push({ pubkey: item.pubkey, isMuted: true });
                }
              } else {
                privateUserItems = privateUserItems.filter(u => u.pubkey !== item.pubkey);
                if (!publicUserItems.some(u => u.pubkey === item.pubkey)) {
                  publicUserItems.push({ pubkey: item.pubkey, isMuted: true });
                }
              }
              renderMuteStructure();
            };
            actions.appendChild(moveBtn);
          }

          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';

          const updateBtnAppearance = () => {
            if (item.isMuted) {
              toggleBtn.textContent = t('editor.mute.muting') || 'Muted';
              toggleBtn.className = 'secondary';
            } else {
              toggleBtn.textContent = t('editor.mute.unmute') || 'Unmute';
              toggleBtn.className = 'secondary';
            }
          };

          updateBtnAppearance();

          toggleBtn.onclick = () => {
            item.isMuted = !item.isMuted;
            updateBtnAppearance();
            const userCountHead = container.querySelectorAll('.font-bold.text-sm')[1];
            if (userCountHead) {
              userCountHead.textContent = `ユーザー (${userItems.filter(u => u.isMuted).length})`;
            }
          };

          actions.appendChild(toggleBtn);
        }

        row.appendChild(info);
        row.appendChild(actions);
        usersListEl.appendChild(row);
      });
    }

    // 単語一覧レンダリング
    const wordsListEl = container.querySelector('#muteWordsList');
    if (wordItems.length === 0) {
      wordsListEl.innerHTML = `<div class="muted p-8 text-center text-sm">${t('editor.mute.empty')}</div>`;
    } else {
      wordItems.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'editor-list-item';
        row.setAttribute('data-focus-word', item.word);

        if (editable) {
          const dragHandle = document.createElement('span');
          dragHandle.className = 'drag-handle';
          dragHandle.textContent = '☰';
          row.appendChild(dragHandle);

          attachDragAndTouchHandlers(row, dragHandle, 'word', index, wordItems, container, '#muteWordsList');
        }

        const info = document.createElement('div');
        info.className = 'editor-list-info';

        const textEl = document.createElement('span');
        textEl.className = 'editor-list-name';
        textEl.textContent = item.word;

        if (editable) {
          textEl.style.cursor = 'pointer';
          textEl.title = t('editor.mute.click_to_edit') || 'クリック/タップで編集';
          textEl.onclick = (e) => {
            e.stopPropagation();
            if (info.querySelector('input.inline-edit-word')) return;

            const editInput = document.createElement('input');
            editInput.type = 'text';
            editInput.className = 'inline-edit-word text-sm';
            editInput.style.width = '100%';
            editInput.value = item.word;

            let finished = false;
            const commitChange = () => {
              if (finished) return;
              finished = true;
              const newWord = editInput.value.trim();
              if (newWord && newWord !== item.word) {
                item.word = newWord;
                renderMuteStructure();
              } else {
                renderMuteStructure();
              }
            };

            editInput.onkeydown = (ev) => {
              if (ev.key === 'Enter') {
                commitChange();
              } else if (ev.key === 'Escape') {
                finished = true;
                renderMuteStructure();
              }
            };
            editInput.onblur = commitChange;

            info.innerHTML = '';
            info.appendChild(editInput);
            editInput.focus();
            editInput.select();
          };
        }

        info.appendChild(textEl);

        const actions = document.createElement('div');
        actions.className = 'editor-list-actions';

        if (editable) {
          // 公開 ↔ 非公開 移動ボタン
          if (parsed.canEditPrivate) {
            const moveBtn = document.createElement('button');
            moveBtn.type = 'button';
            moveBtn.className = 'secondary text-xs';
            moveBtn.textContent = tabType === 'public'
              ? (t('editor.mute.move_to_private') || 'Move to Private')
              : (t('editor.mute.move_to_public') || 'Move to Public');

            moveBtn.onclick = () => {
              if (tabType === 'public') {
                publicWordItems = publicWordItems.filter(w => w.word !== item.word);
                if (!privateWordItems.some(w => w.word === item.word)) {
                  privateWordItems.push({ word: item.word, isMuted: true });
                }
              } else {
                privateWordItems = privateWordItems.filter(w => w.word !== item.word);
                if (!publicWordItems.some(w => w.word === item.word)) {
                  publicWordItems.push({ word: item.word, isMuted: true });
                }
              }
              renderMuteStructure();
            };
            actions.appendChild(moveBtn);
          }

          const toggleBtn = document.createElement('button');
          toggleBtn.type = 'button';

          const updateBtnAppearance = () => {
            if (item.isMuted) {
              toggleBtn.textContent = t('editor.mute.muting') || 'Muted';
              toggleBtn.className = 'secondary';
            } else {
              toggleBtn.textContent = t('editor.mute.unmute') || 'Unmute';
              toggleBtn.className = 'secondary';
            }
          };

          updateBtnAppearance();

          toggleBtn.onclick = () => {
            item.isMuted = !item.isMuted;
            updateBtnAppearance();
          };

          actions.appendChild(toggleBtn);
        }

        row.appendChild(info);
        row.appendChild(actions);
        wordsListEl.appendChild(row);
      });
    }
  }

  renderMuteStructure();

  // 保存処理
  const handleSave = async () => {
    if (newSaveBtn) newSaveBtn.disabled = true;
    try {
      const confirmed = await showConfirmDialog(modal.querySelector('.modal-body') || modal, 'editor.mute.confirm_save');
      if (!confirmed) {
        if (newSaveBtn) newSaveBtn.disabled = false;
        return;
      }

      if (statusEl) statusEl.textContent = t('editor.common.publishing') || 'Publishing...';

      const finalPubUsers = new Set(publicUserItems.filter(i => i.isMuted).map(i => i.pubkey));
      const finalPubWords = new Set(publicWordItems.filter(i => i.isMuted).map(i => i.word));
      const finalPrivUsers = new Set(privateUserItems.filter(i => i.isMuted).map(i => i.pubkey));
      const finalPrivWords = new Set(privateWordItems.filter(i => i.isMuted).map(i => i.word));

      let newContent = parsed.content;

      if (parsed.canEditPrivate) {
        try {
          newContent = await encryptPrivateMutes(state, finalPrivUsers, finalPrivWords, selectedEncryptionMode);
        } catch (e) {
          console.warn('[MuteEditor] 保存時の暗号化失敗:', e);
        }
      }

      const newTags = [...parsed.nonMuteTags];
      finalPubUsers.forEach(pk => newTags.push(['p', pk]));
      finalPubWords.forEach(w => newTags.push(['word', w]));

      const draft = {
        kind: 10000,
        created_at: Math.floor(Date.now() / 1000),
        tags: newTags,
        content: newContent,
        pubkey: myPubkey
      };

      const res = await publishReplaceableEvent(state, draft);
      if (res && res.ok) {
        if (statusEl) statusEl.textContent = t('editor.common.success') || 'Updated!';

        syncMuteStateToApp(state, finalPubUsers, finalPubWords, finalPrivUsers, finalPrivWords);

        setTimeout(() => {
          modal.hidden = true;
          if (statusEl) statusEl.textContent = '';
        }, 1200);
      } else {
        const errMsg = (res && res.error) ? res.error : '';
        if (statusEl) statusEl.textContent = t('editor.common.failed', { msg: errMsg }) || `Failed: ${errMsg}`;
      }
    } catch (err) {
      console.error('Failed to save mute list:', err);
      if (statusEl) statusEl.textContent = t('editor.common.failed', { msg: err.message || err });
    } finally {
      if (newSaveBtn) newSaveBtn.disabled = false;
    }
  };

  const closeModal = () => {
    modal.hidden = true;
    if (statusEl) statusEl.textContent = '';
  };

  if (newSaveBtn) newSaveBtn.onclick = handleSave;
  if (newCancelBtn) newCancelBtn.onclick = closeModal;
  if (newCloseBtn) newCloseBtn.onclick = closeModal;
}
