/**
 * Public chats (kind:10005) editor + snapshots
 */

import {
  loadPublicChatsEditableState,
  publishPublicChatsState,
} from './public-chats.js';
import { fetchChannelMetadata, shortenChannelEventId } from './channel.js';
import { getCustomJoinedChannels } from './channel-membership.js';
import { resolveChannelRootIdInput } from './channel-search.js';
import { t } from '../../utils/i18n.js';

const SNAPSHOTS_KEY_BASE = 'public_chats_snapshots';

function getSnapshotsKey() {
  const pk = localStorage.getItem('pubkey');
  return pk ? `${SNAPSHOTS_KEY_BASE}.${pk.toLowerCase()}` : SNAPSHOTS_KEY_BASE;
}

function loadSnapshots() {
  try {
    const raw = localStorage.getItem(getSnapshotsKey());
    return raw ? JSON.parse(raw) : [];
  } catch (_e) {
    return [];
  }
}

function saveSnapshots(list) {
  try {
    localStorage.setItem(getSnapshotsKey(), JSON.stringify(list));
  } catch (_e) { }
}

function formatDate(ts) {
  const d = new Date(ts || Date.now());
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
    okBtn.textContent = okBtnKey
      ? (t(okBtnKey) || okBtnKey)
      : (t('editor.common.confirm_publish') || 'Publish');
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

function attachDragHandlers(row, dragHandle, itemType, index, itemsArray, container, listSelector, onReorder) {
  row.setAttribute('draggable', 'true');
  row.setAttribute('data-drag-index', index.toString());

  row.ondragstart = (e) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: itemType, index }));
    row.classList.add('dragging');
  };
  row.ondragend = () => {
    stopDragAutoScroll();
    row.classList.remove('dragging');
    container.querySelectorAll('.editor-list-item').forEach((el) => {
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
          if (typeof onReorder === 'function') onReorder();
        }
      }
    } catch (_err) { }
  };

  if (dragHandle) {
    dragHandle.onmousedown = (e) => e.stopPropagation();
  }
}

/**
 * 参加リスト編集モーダルを開く
 */
export async function openPublicChatsEditor(state, options = {}) {
  const modal = document.getElementById('publicChatsEditModal');
  if (!modal) return;

  modal.hidden = false;

  const statusEl = document.getElementById('publicChatsEditStatus');
  const contentEl = document.getElementById('publicChatsEditContent');
  const saveBtn = document.getElementById('publicChatsEditSaveBtn');
  const cancelBtn = document.getElementById('publicChatsEditCancelBtn');
  const closeBtn = document.getElementById('publicChatsEditClose');

  if (statusEl) statusEl.textContent = t('editor.common.fetching') || 'Fetching...';
  if (contentEl) contentEl.innerHTML = '';

  const myPubkey = localStorage.getItem('pubkey') || (state && state.pubkey);
  if (!myPubkey) {
    if (statusEl) statusEl.textContent = t('editor.common.no_login') || 'Login required';
    return;
  }

  const newSaveBtn = saveBtn ? saveBtn.cloneNode(true) : null;
  const newCancelBtn = cancelBtn ? cancelBtn.cloneNode(true) : null;
  const newCloseBtn = closeBtn ? closeBtn.cloneNode(true) : null;
  if (saveBtn && newSaveBtn) saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  if (cancelBtn && newCancelBtn) cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  if (closeBtn && newCloseBtn) closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

  const loaded = await loadPublicChatsEditableState(state, myPubkey);
  let publicItems = loaded.publicItems.slice();
  let privateItems = loaded.privateItems.slice();
  let otherTags = loaded.otherTags.slice();
  let encryptionMode = loaded.encryptionMode || 'nip44';
  let latestEvent = loaded.event;
  let activeTab = 'current';
  let listSection = 'public'; // public | private
  const canEditPrivate = !loaded.privateDecryptAttempted || loaded.privateDecryptOk;

  // ローカル custom 参加を編集画面に取り込む（未掲載分）
  const known = new Set([
    ...publicItems.map((i) => i.rootId),
    ...privateItems.map((i) => i.rootId),
  ]);
  getCustomJoinedChannels().forEach((id) => {
    if (!known.has(id)) {
      publicItems.push({ rootId: id, relayHint: null, isPrivate: false, label: null });
      known.add(id);
    }
  });

  if (statusEl) statusEl.textContent = '';

  const closeModal = () => {
    modal.hidden = true;
  };

  if (newCancelBtn) newCancelBtn.onclick = closeModal;
  if (newCloseBtn) newCloseBtn.onclick = closeModal;

  function renderStructure() {
    contentEl.innerHTML = `
      <div class="editor-tabs">
        <button type="button" class="editor-tab ${activeTab === 'current' ? 'active' : ''}" id="tabCurrentPublicChats">
          ${t('editor.snapshot.tab_current') || '編集'}
        </button>
        <button type="button" class="editor-tab ${activeTab === 'saved' ? 'active' : ''}" id="tabSavedPublicChats">
          ${t('editor.snapshot.tab_saved') || 'バックアップ一覧'}
        </button>
      </div>
      <div id="publicChatsEditorTabBody"></div>
    `;

    contentEl.querySelector('#tabCurrentPublicChats').onclick = () => {
      activeTab = 'current';
      renderStructure();
    };
    contentEl.querySelector('#tabSavedPublicChats').onclick = () => {
      activeTab = 'saved';
      renderStructure();
    };

    const bodyEl = contentEl.querySelector('#publicChatsEditorTabBody');
    if (activeTab === 'current') {
      if (newSaveBtn) newSaveBtn.hidden = false;
      renderCurrentView(bodyEl);
    } else {
      if (newSaveBtn) newSaveBtn.hidden = true;
      renderSavedView(bodyEl);
    }
  }

  function renderCurrentView(container) {
    const total = publicItems.length + privateItems.length;
    container.innerHTML = `
      <div class="row align-center justify-between mb-12">
        <span class="muted text-sm">${t('editor.snapshot.count', { n: total }) || `${total} channels`}</span>
        <button type="button" class="secondary text-sm" id="savePublicChatsSnapshotBtn">
          ${t('editor.snapshot.save_btn') || '現在の状態をバックアップ'}
        </button>
      </div>
      ${!canEditPrivate ? `<div class="editor-confirm-msg p-8 mb-12" style="background:var(--panel); border:1px solid var(--border); border-radius:6px; font-size:0.85rem;">⚠️ ${t('channel.editor.protected_notice') || t('editor.mute.protected_notice')}</div>` : ''}
      <div class="editor-tabs mb-12">
        <button type="button" class="editor-tab ${listSection === 'public' ? 'active' : ''}" id="tabPubChatsPublic">
          ${t('channel.editor.tab_public') || '公開チャンネル (tags)'}
        </button>
        <button type="button" class="editor-tab ${listSection === 'private' ? 'active' : ''}" id="tabPubChatsPrivate" ${!canEditPrivate ? 'disabled' : ''}>
          ${t('channel.editor.tab_private') || '非公開チャンネル (content)'}
        </button>
      </div>
      <div class="row gap-8 mb-12">
        <input type="text" id="publicChatsAddInput" class="flex-1" placeholder="${t('channel.editor.add_placeholder') || 'hex / nevent'}" autocomplete="off" ${(listSection === 'private' && !canEditPrivate) ? 'disabled' : ''}>
        <button type="button" id="publicChatsAddBtn" class="secondary" ${(listSection === 'private' && !canEditPrivate) ? 'disabled' : ''}>${t('channel.editor.add') || '追加'}</button>
      </div>
      <div id="publicChatsItemsList"></div>
    `;

    const snapBtn = container.querySelector('#savePublicChatsSnapshotBtn');
    if (snapBtn) {
      snapBtn.onclick = () => {
        const snapshots = loadSnapshots();
        const now = Date.now();
        snapshots.unshift({
          id: 'snap_' + now,
          name: formatDate(now),
          createdAt: now,
          publicItems: publicItems.map((i) => ({ ...i })),
          privateItems: privateItems.map((i) => ({ ...i })),
          otherTags: otherTags.map((tg) => [...tg]),
          encryptionMode,
        });
        saveSnapshots(snapshots);
        if (statusEl) {
          statusEl.textContent = t('editor.snapshot.saved_msg') || 'バックアップを保存しました';
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
        }
        activeTab = 'saved';
        renderStructure();
      };
    }

    container.querySelector('#tabPubChatsPublic').onclick = () => {
      listSection = 'public';
      renderCurrentView(container);
    };
    const privateTab = container.querySelector('#tabPubChatsPrivate');
    if (privateTab && canEditPrivate) {
      privateTab.onclick = () => {
        listSection = 'private';
        renderCurrentView(container);
      };
    }

    const addInput = container.querySelector('#publicChatsAddInput');
    const addBtn = container.querySelector('#publicChatsAddBtn');
    const doAdd = () => {
      if (listSection === 'private' && !canEditPrivate) return;
      const raw = (addInput && addInput.value || '').trim();
      if (!raw) return;
      const rootId = resolveChannelRootIdInput(raw);
      if (!rootId) {
        if (statusEl) {
          statusEl.textContent = t('channel.invalid_id') || 'Invalid channel ID';
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
        }
        return;
      }
      const exists = publicItems.some((i) => i.rootId === rootId) || privateItems.some((i) => i.rootId === rootId);
      if (exists) {
        if (statusEl) {
          statusEl.textContent = t('channel.editor.already_added') || 'すでに追加されています';
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
        }
        return;
      }
      const item = { rootId, relayHint: null, isPrivate: listSection === 'private', label: null };
      if (listSection === 'private') privateItems.push(item);
      else publicItems.push(item);
      if (addInput) addInput.value = '';
      renderCurrentView(container);
    };
    if (addBtn) addBtn.onclick = doAdd;
    if (addInput) {
      addInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doAdd();
        }
      };
    }

    renderItemsList(container.querySelector('#publicChatsItemsList'), container);
  }

  function renderItemsList(listHost, parentContainer) {
    if (!listHost) return;
    const items = listSection === 'private' ? privateItems : publicItems;
    const editable = listSection === 'public' || canEditPrivate;
    if (!items.length) {
      listHost.innerHTML = `<div class="muted p-16 text-center">${t('channel.editor.empty') || 'チャンネルがありません'}</div>`;
      return;
    }

    const listEl = document.createElement('div');
    listEl.className = 'editor-list';
    listEl.id = 'publicChatsDragList';

    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'editor-list-item';

      if (editable) {
        const dragHandle = document.createElement('span');
        dragHandle.className = 'drag-handle';
        dragHandle.textContent = '☰';
        row.appendChild(dragHandle);

        attachDragHandlers(row, dragHandle, listSection, index, items, parentContainer, '#publicChatsDragList', () => {
          renderCurrentView(parentContainer);
        });
      }

      const info = document.createElement('div');
      info.className = 'editor-list-info';
      const nameEl = document.createElement('span');
      nameEl.className = 'editor-list-name';
      nameEl.textContent = item.label || shortenChannelEventId(item.rootId);
      const subEl = document.createElement('span');
      subEl.className = 'editor-list-sub';
      subEl.textContent = shortenChannelEventId(item.rootId);
      info.appendChild(nameEl);
      info.appendChild(subEl);
      row.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'editor-list-actions';

      if (editable && canEditPrivate) {
        const moveBtn = document.createElement('button');
        moveBtn.type = 'button';
        moveBtn.className = 'secondary text-xs';
        moveBtn.textContent = listSection === 'public'
          ? (t('channel.editor.move_to_private') || t('editor.mute.move_to_private') || '非公開へ移動')
          : (t('channel.editor.move_to_public') || t('editor.mute.move_to_public') || '公開へ移動');
        moveBtn.onclick = () => {
          if (listSection === 'public') {
            publicItems = publicItems.filter((i) => i.rootId !== item.rootId);
            if (!privateItems.some((i) => i.rootId === item.rootId)) {
              privateItems.push({ ...item, isPrivate: true });
            }
          } else {
            privateItems = privateItems.filter((i) => i.rootId !== item.rootId);
            if (!publicItems.some((i) => i.rootId === item.rootId)) {
              publicItems.push({ ...item, isPrivate: false });
            }
          }
          renderCurrentView(parentContainer);
        };
        actions.appendChild(moveBtn);
      }

      if (editable) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'secondary text-sm';
        removeBtn.textContent = t('channel.editor.remove') || '削除';
        removeBtn.onclick = () => {
          if (listSection === 'private') {
            privateItems = privateItems.filter((i) => i.rootId !== item.rootId);
          } else {
            publicItems = publicItems.filter((i) => i.rootId !== item.rootId);
          }
          renderCurrentView(parentContainer);
        };
        actions.appendChild(removeBtn);
      }

      row.appendChild(actions);
      listEl.appendChild(row);

      if (!item.label) {
        fetchChannelMetadata(state, item.rootId).then((meta) => {
          if (meta && meta.label && nameEl.isConnected) {
            item.label = meta.label;
            nameEl.textContent = meta.label;
          }
        }).catch(() => { });
      }
    });

    listHost.innerHTML = '';
    listHost.appendChild(listEl);
  }

  function renderSavedView(container) {
    const snapshots = loadSnapshots();
    if (!snapshots.length) {
      container.innerHTML = `<div class="muted p-16 text-center">${t('editor.snapshot.empty') || '保存されたリストはありません。'}</div>`;
      return;
    }

    const listEl = document.createElement('div');
    listEl.className = 'editor-list';

    snapshots.forEach((snap, idx) => {
      const card = document.createElement('div');
      card.className = 'snapshot-card';
      const pubCount = (snap.publicItems || []).length;
      const privCount = (snap.privateItems || []).length;
      card.innerHTML = `
        <div class="snapshot-header">
          <input type="text" class="snapshot-title-input" value="${escapeHtml(snap.name || '')}" placeholder="${t('editor.snapshot.name_placeholder') || 'バックアップ名'}">
          <span class="snapshot-meta">${t('channel.editor.snapshot_counts', { pub: pubCount, priv: privCount }) || `${pubCount} / ${privCount}`}</span>
        </div>
        <div class="snapshot-meta mb-8">🕒 ${formatDate(snap.createdAt)}</div>
        <div class="snapshot-actions">
          <button type="button" class="restore-snap-btn">${t('editor.snapshot.restore') || '編集画面に読み込む'}</button>
          <button type="button" class="secondary delete-snap-btn">${t('editor.snapshot.delete') || '削除'}</button>
        </div>
      `;

      const titleInput = card.querySelector('.snapshot-title-input');
      if (titleInput) {
        titleInput.onchange = (e) => {
          snap.name = (e.target.value || '').trim() || formatDate(snap.createdAt);
          snapshots[idx] = snap;
          saveSnapshots(snapshots);
        };
      }

      card.querySelector('.restore-snap-btn').onclick = async () => {
        const confirmed = await showConfirmDialog(
          modal.querySelector('.modal-body') || modal,
          'editor.snapshot.confirm_restore',
          'editor.snapshot.restore',
        );
        if (!confirmed) return;
        publicItems = (snap.publicItems || []).map((i) => ({ ...i }));
        privateItems = (snap.privateItems || []).map((i) => ({ ...i }));
        otherTags = (snap.otherTags || []).map((tg) => [...tg]);
        if (snap.encryptionMode) encryptionMode = snap.encryptionMode;
        if (statusEl) {
          statusEl.textContent = t('editor.snapshot.loaded_msg') || '編集画面に読み込みました';
        }
        activeTab = 'current';
        renderStructure();
      };

      card.querySelector('.delete-snap-btn').onclick = async () => {
        const confirmed = await showConfirmDialog(
          modal.querySelector('.modal-body') || modal,
          'editor.snapshot.confirm_delete',
          'editor.snapshot.delete',
        );
        if (!confirmed) return;
        snapshots.splice(idx, 1);
        saveSnapshots(snapshots);
        renderSavedView(container);
      };

      listEl.appendChild(card);
    });

    container.innerHTML = '';
    container.appendChild(listEl);
  }

  if (newSaveBtn) {
    newSaveBtn.onclick = async () => {
      newSaveBtn.disabled = true;
      try {
        const confirmed = await showConfirmDialog(
          modal.querySelector('.modal-body') || modal,
          'channel.editor.confirm',
        );
        if (!confirmed) return;

        if (statusEl) statusEl.textContent = t('editor.common.publishing') || 'Publishing...';
        const res = await publishPublicChatsState(state, {
          event: latestEvent,
          publicItems,
          privateItems,
          otherTags,
          encryptionMode,
        }, { latestEvent });

        if (res && res.ok) {
          latestEvent = res.event || latestEvent;
          if (statusEl) statusEl.textContent = t('editor.common.success') || 'Updated';
          if (typeof options.onSaved === 'function') {
            try { options.onSaved(res); } catch (_e) { }
          }
          setTimeout(closeModal, 600);
        } else {
          if (statusEl) {
            statusEl.textContent = (t('editor.common.failed') || 'Failed: {msg}')
              .replace('{msg}', (res && res.error) || 'unknown');
          }
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = (t('editor.common.failed') || 'Failed: {msg}')
            .replace('{msg}', err && err.message ? err.message : 'unknown');
        }
      } finally {
        newSaveBtn.disabled = false;
      }
    };
  }

  renderStructure();
}
