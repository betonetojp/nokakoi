import { t } from '../../utils/i18n.js';
import { showConfirmModal } from '../../ui/modals/modals.js';

const RELAY_SNAPSHOTS_KEY_BASE = 'relay_list_snapshots';

export function getRelaySnapshotsStorageKey(pubkey) {
  const pk = pubkey || (typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : null);
  if (!pk) return RELAY_SNAPSHOTS_KEY_BASE;
  return `${RELAY_SNAPSHOTS_KEY_BASE}.${pk.toLowerCase()}`;
}

export function loadRelaySnapshots(pubkey) {
  try {
    const key = getRelaySnapshotsStorageKey(pubkey);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('[RelaySnapshot] スナップショット読み込み失敗:', e);
    return [];
  }
}

export function saveRelaySnapshots(pubkey, snapshots) {
  try {
    const key = getRelaySnapshotsStorageKey(pubkey);
    localStorage.setItem(key, JSON.stringify(snapshots || []));
  } catch (e) {
    console.warn('[RelaySnapshot] スナップショット保存失敗:', e);
  }
}

export function createRelaySnapshot(pubkey, relays, name = null) {
  if (!pubkey) pubkey = typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : null;
  if (!pubkey || !Array.isArray(relays)) return null;

  const snapshots = loadRelaySnapshots(pubkey);
  const now = Date.now();
  const dateStr = new Date(now).toLocaleString();
  const snapshotName = name || `バックアップ (${dateStr})`;

  const newSnap = {
    id: `snap_relay_${now}_${Math.random().toString(36).substring(2, 7)}`,
    name: snapshotName,
    timestamp: now,
    relays: JSON.parse(JSON.stringify(relays))
  };

  snapshots.unshift(newSnap);
  // 最大 30 件保持
  if (snapshots.length > 30) snapshots.length = 30;
  saveRelaySnapshots(pubkey, snapshots);
  return newSnap;
}

export function renderRelaySnapshotsUI(container, pubkey, onApply) {
  if (!container) return;
  const targetPk = pubkey || (typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : null);
  const snapshots = loadRelaySnapshots(targetPk);

  container.innerHTML = '';

  if (snapshots.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'muted p-16 text-center text-sm';
    emptyDiv.textContent = t('editor.snapshot.empty') || '保存されたリストはありません。';
    container.appendChild(emptyDiv);
    return;
  }

  const listContainer = document.createElement('div');
  listContainer.className = 'snapshot-list-container gap-8 column';

  snapshots.forEach((snap, idx) => {
    const card = document.createElement('div');
    card.className = 'snapshot-card panel p-12 mb-8 border rounded';

    const relayCount = Array.isArray(snap.relays) ? snap.relays.length : 0;
    const timeText = new Date(snap.timestamp).toLocaleString();

    card.innerHTML = `
      <div class="snapshot-header row align-center space-between gap-8 mb-4">
        <input type="text" class="snapshot-title-input font-bold" value="${snap.name || ''}" placeholder="${t('editor.snapshot.name_placeholder') || 'リスト名'}" style="flex:1; border:1px solid transparent; background:transparent; color:inherit;">
        <span class="snapshot-meta text-sm muted">${t('editor.relay_snapshot.count', { n: relayCount }) || `${relayCount} Relays`}</span>
      </div>
      <div class="text-xs muted mb-8">${timeText}</div>
      <div class="snapshot-actions row gap-8">
        <button type="button" class="small restore-snap-btn">${t('editor.snapshot.restore') || '編集画面に読み込む'}</button>
        <button type="button" class="small secondary delete-snap-btn">${t('editor.snapshot.delete') || '削除'}</button>
      </div>
    `;

    const titleInput = card.querySelector('.snapshot-title-input');
    if (titleInput) {
      titleInput.onfocus = () => { titleInput.style.borderColor = 'var(--border)'; titleInput.style.background = 'var(--panel)'; };
      titleInput.onblur = () => {
        titleInput.style.borderColor = 'transparent';
        titleInput.style.background = 'transparent';
        snap.name = titleInput.value.trim() || `バックアップ (${timeText})`;
        snapshots[idx] = snap;
        saveRelaySnapshots(targetPk, snapshots);
      };
    }

    const restoreBtn = card.querySelector('.restore-snap-btn');
    if (restoreBtn) {
      restoreBtn.onclick = () => {
        showConfirmModal(
          t('editor.snapshot.restore') || '編集画面に読み込む',
          t('editor.snapshot.confirm_restore') || 'この保存リストを編集画面に読み込みますか？',
          () => {
            if (typeof onApply === 'function') {
              onApply(snap.relays);
            }
          }
        );
      };
    }

    const deleteBtn = card.querySelector('.delete-snap-btn');
    if (deleteBtn) {
      deleteBtn.onclick = () => {
        showConfirmModal(
          t('editor.snapshot.delete') || '削除',
          t('editor.snapshot.confirm_delete') || 'このバックアップを削除しますか？',
          () => {
            snapshots.splice(idx, 1);
            saveRelaySnapshots(targetPk, snapshots);
            renderRelaySnapshotsUI(container, targetPk, onApply);
          }
        );
      };
    }

    listContainer.appendChild(card);
  });

  container.appendChild(listContainer);
}
