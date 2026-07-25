/**
 * Follow Editor Module
 * フォローリスト管理機能 (kind:3) & スナップショット（複数保存・名前変更・復元・削除）
 */

import { fetchLatestEvent, backupEvent, publishReplaceableEvent } from '../../core/replaceable-event.js';
import { t } from '../../utils/i18n.js';
import { getNip19 } from '../../core/nostr-compat.js';
import { displayNameWithUsername, loadProfile, updateNameDom } from './profile.js';

const SNAPSHOTS_KEY = 'follow_list_snapshots';

/**
 * 保存済みスナップショットを取得
 */
function loadSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * スナップショット一覧を保存
 */
function saveSnapshots(list) {
  try {
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(list));
  } catch (e) { }
}

/**
 * 現在の日時文字列（YYYY/MM/DD HH:mm）を生成
 */
function formatDate(ts) {
  const d = new Date(ts || Date.now());
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${min}`;
}

/**
 * tタグからpetnameを抽出するヘルパー関数
 */
function extractPetname(t) {
  let petname = '';
  if (t.length >= 4 && t[3]) {
    petname = String(t[3]);
  } else if (t.length >= 3 && t[2]) {
    const m = String(t[2]);
    if (!m.startsWith('wss://') && !m.startsWith('ws://') && !m.startsWith('http://') && !m.startsWith('https://')) {
      petname = m;
    }
  }
  return petname;
}

/**
 * tタグからrelayHintを抽出するヘルパー関数
 */
function extractRelayHint(t) {
  let relayHint = '';
  if (t.length >= 3 && (t[2].startsWith('wss://') || t[2].startsWith('ws://'))) {
    relayHint = t[2];
  }
  return relayHint;
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

/**
 * フォロー状態を切り替える（プロフィールモーダル内などの単一ユーザー用）
 */
export async function toggleFollowUser(state, targetPubkey, buttonEl) {
  try {
    const myPubkey = localStorage.getItem('pubkey');
    if (!myPubkey) {
      console.error('未ログインです');
      return false;
    }

    if (buttonEl) buttonEl.disabled = true;

    // 最新のkind:3を取得
    const latestEvent = await fetchLatestEvent(state, 3, myPubkey);
    let newTags = [];
    let existingContent = '';
    let isCurrentlyFollowing = false;

    if (latestEvent) {
      existingContent = latestEvent.content || '';
      for (const tag of latestEvent.tags) {
        if (tag[0] === 'p') {
          if (tag[1] === targetPubkey) {
            isCurrentlyFollowing = true;
          } else {
            newTags.push([...tag]);
          }
        } else {
          newTags.push([...tag]);
        }
      }
    } else {
      if (state.feeds['home'] && state.feeds['home'].follows) {
        for (const pk of state.feeds['home'].follows) {
          if (pk === targetPubkey) {
            isCurrentlyFollowing = true;
          } else {
            newTags.push(['p', pk, '', '']);
          }
        }
      }
    }

    if (isCurrentlyFollowing) {
      // 解除する場合は確認ダイアログを表示
      const parentEl = document.getElementById('profileModal') || document.body;
      const confirmed = await showConfirmDialog(parentEl, 'editor.follow.confirm_unfollow');
      if (!confirmed) {
        return false;
      }
    } else {
      newTags.push(['p', targetPubkey, '', '']);
    }

    const draft = {
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags: newTags,
      content: existingContent,
      pubkey: myPubkey
    };

    if (latestEvent) {
      backupEvent(3, latestEvent);
    }

    const res = await publishReplaceableEvent(state, draft);
    if (res && res.ok) {
      if (!state.feeds['home']) state.feeds['home'] = {};
      if (!state.feeds['home'].follows) state.feeds['home'].follows = [];
      if (!state.feeds['home'].followSet) state.feeds['home'].followSet = new Set();

      if (isCurrentlyFollowing) {
        state.feeds['home'].follows = state.feeds['home'].follows.filter(pk => pk !== targetPubkey);
        state.feeds['home'].followSet.delete(targetPubkey);
      } else {
        if (!state.feeds['home'].followSet.has(targetPubkey)) {
          state.feeds['home'].follows.push(targetPubkey);
          state.feeds['home'].followSet.add(targetPubkey);
        }
      }

      updateFollowButtonState(state, buttonEl, targetPubkey);
      return true;
    }

    return false;
  } catch (err) {
    console.error('フォローの切り替え中にエラーが発生しました', err);
    return false;
  } finally {
    if (buttonEl) buttonEl.disabled = false;
  }
}

/**
 * フォローボタンの見た目を更新する
 */
export function updateFollowButtonState(state, buttonEl, targetPubkey) {
  if (!buttonEl) return;

  const isFollowing = state.feeds['home'] && state.feeds['home'].followSet && state.feeds['home'].followSet.has(targetPubkey);

  if (isFollowing) {
    buttonEl.textContent = t('editor.follow.following') || 'Following';
    buttonEl.className = 'secondary';
  } else {
    buttonEl.textContent = t('editor.follow.follow') || 'Follow';
    buttonEl.className = 'secondary';
  }
}

/**
 * フォローリスト編集モーダルを開く
 */
export async function openFollowEditor(state) {
  const modal = document.getElementById('followEditModal');
  if (!modal) return;

  modal.hidden = false;

  const statusEl = document.getElementById('followEditStatus');
  const contentEl = document.getElementById('followEditContent');
  const saveBtn = document.getElementById('followEditSaveBtn');
  const cancelBtn = document.getElementById('followEditCancelBtn');
  const closeBtn = document.getElementById('followEditClose');

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

  // 最新の kind:3 を取得
  const latestEvent = await fetchLatestEvent(state, 3, myPubkey);
  if (latestEvent) {
    backupEvent(3, latestEvent);
  }

  let existingContent = latestEvent ? (latestEvent.content || '') : '';
  let items = [];
  let nonPTags = [];

  if (latestEvent && latestEvent.tags) {
    for (const tag of latestEvent.tags) {
      if (tag[0] === 'p' && tag[1]) {
        items.push({
          pubkey: tag[1],
          relayHint: extractRelayHint(tag),
          petname: extractPetname(tag),
          isFollowing: true
        });
      } else {
        nonPTags.push([...tag]);
      }
    }
  }

  if (statusEl) statusEl.textContent = '';

  let activeTab = 'current'; // 'current' | 'saved'

  // サブタブおよび領域の初期生成
  function renderModalStructure() {
    contentEl.innerHTML = `
      <div class="editor-tabs">
        <button type="button" class="editor-tab ${activeTab === 'current' ? 'active' : ''}" id="tabCurrentFollows">
          ${t('editor.snapshot.tab_current') || 'Current Follows'}
        </button>
        <button type="button" class="editor-tab ${activeTab === 'saved' ? 'active' : ''}" id="tabSavedSnapshots">
          ${t('editor.snapshot.tab_saved') || 'Saved Lists'}
        </button>
      </div>
      <div id="editorTabBody"></div>
    `;

    const tabCurrent = contentEl.querySelector('#tabCurrentFollows');
    const tabSaved = contentEl.querySelector('#tabSavedSnapshots');

    tabCurrent.onclick = () => {
      activeTab = 'current';
      renderModalStructure();
    };

    tabSaved.onclick = () => {
      activeTab = 'saved';
      renderModalStructure();
    };

    const bodyEl = contentEl.querySelector('#editorTabBody');

    if (activeTab === 'current') {
      if (newSaveBtn) newSaveBtn.hidden = false;
      renderCurrentFollowsView(bodyEl);
    } else {
      if (newSaveBtn) newSaveBtn.hidden = true;
      renderSavedSnapshotsView(bodyEl);
    }
  }

  // 1. 「現在のフォロー」タブの描画
  function renderCurrentFollowsView(container) {
    container.innerHTML = `
      <div class="row align-center justify-between mb-12">
        <span class="muted text-sm">${t('editor.snapshot.count', { n: items.length }) || `${items.length} follows`}</span>
        <button type="button" class="secondary text-sm" id="saveSnapshotBtn">
          ${t('editor.snapshot.save_btn') || 'Save Current List'}
        </button>
      </div>
      <div id="currentFollowsList"></div>
    `;

    // 「現在のリストをスナップショット保存」アクション
    const saveSnapshotBtn = container.querySelector('#saveSnapshotBtn');
    if (saveSnapshotBtn) {
      saveSnapshotBtn.onclick = () => {
        const snapshots = loadSnapshots();
        const now = Date.now();
        const defaultName = formatDate(now);
        
        // items は本来の時系列順（末尾が最新）。有効なフォローのみを抽出して正序で保存
        const activeItems = items.filter(it => it.isFollowing);
        const tags = [...nonPTags];
        for (const item of activeItems) {
          const pet = item.petname ? item.petname.trim() : '';
          const hint = item.relayHint || '';
          tags.push(['p', item.pubkey, hint, pet]);
        }

        const newSnap = {
          id: 'snap_' + now,
          name: defaultName,
          createdAt: now,
          tags: tags,
          content: existingContent
        };

        snapshots.unshift(newSnap);
        saveSnapshots(snapshots);

        if (statusEl) {
          statusEl.textContent = t('editor.snapshot.saved_msg') || 'Saved';
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
        }

        activeTab = 'saved';
        renderModalStructure();
      };
    }

    const listEl = container.querySelector('#currentFollowsList');
    if (items.length === 0) {
      listEl.innerHTML = `<div class="muted p-16 text-center">${t('editor.follow.empty') || 'Not following anyone.'}</div>`;
      return;
    }

    const listContainer = document.createElement('div');
    listContainer.className = 'editor-list';

    // 画面表示用に一時的に反転（最新が上）
    const displayItems = [...items].reverse();

    displayItems.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'editor-list-item';

      const profileInfo = document.createElement('div');
      profileInfo.className = 'editor-list-info';

      const avatar = document.createElement('img');
      avatar.className = 'editor-list-avatar d-none';
      avatar.alt = '';
      avatar.onerror = () => {
        avatar.classList.add('d-none');
      };

      const nameEl = document.createElement('span');
      nameEl.className = 'editor-list-name';
      nameEl.textContent = item.pubkey.substring(0, 10) + '...';

      loadProfile(state, item.pubkey).then(prof => {
        if (prof) {
          if (prof.picture) {
            avatar.src = prof.picture;
            avatar.classList.remove('d-none');
          }
          const names = displayNameWithUsername(state, item.pubkey, getNip19(), { usePetname: false });
          nameEl.textContent = names.main + (names.sub ? ` (@${names.sub})` : '');
        } else {
          const nip19 = getNip19();
          nameEl.textContent = nip19 ? nip19.npubEncode(item.pubkey).substring(0, 12) + '...' : item.pubkey.substring(0, 10) + '...';
        }
      }).catch(() => {
        nameEl.textContent = item.pubkey.substring(0, 10) + '...';
      });

      profileInfo.appendChild(avatar);
      profileInfo.appendChild(nameEl);

      // 名前タップでプロフィールモーダルを開く
      profileInfo.onclick = (e) => {
        e.stopPropagation();
        import('./profile-modal.js').then(mod => {
          if (mod && typeof mod.showProfileModal === 'function') {
            mod.showProfileModal(state, item.pubkey);
          }
        }).catch(err => {
          console.warn('[FollowEditor] プロフィールモーダルの読み込み失敗:', err);
        });
      };

      // petname 入力 + badge アイコンのラッパー
      const petnameWrapper = document.createElement('div');
      petnameWrapper.className = 'editor-petname-wrapper';

      const badgeIcon = document.createElement('img');
      badgeIcon.className = 'editor-petname-badge';
      badgeIcon.src = 'icon/badge.png';
      badgeIcon.alt = 'badge';

      const petnameInput = document.createElement('input');
      petnameInput.type = 'text';
      petnameInput.className = 'editor-petname-input';
      petnameInput.value = item.petname;
      petnameInput.placeholder = t('editor.follow.petname_placeholder') || 'Petname';
      petnameInput.oninput = (e) => {
        item.petname = e.target.value;
      };

      petnameWrapper.appendChild(badgeIcon);
      petnameWrapper.appendChild(petnameInput);

      // フォロートグルボタン
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'secondary';
      toggleBtn.textContent = t('editor.follow.following') || 'Following';
      toggleBtn.onclick = () => {
        item.isFollowing = !item.isFollowing;
        if (item.isFollowing) {
          toggleBtn.textContent = t('editor.follow.following') || 'Following';
          toggleBtn.className = 'secondary';
          row.style.opacity = '1';
        } else {
          toggleBtn.textContent = t('editor.follow.unfollow') || 'Unfollow';
          toggleBtn.className = '';
          row.style.opacity = '0.5';
        }
      };

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'editor-list-actions';
      actionsDiv.appendChild(petnameWrapper);
      actionsDiv.appendChild(toggleBtn);

      row.appendChild(profileInfo);
      row.appendChild(actionsDiv);
      listContainer.appendChild(row);
    });

    listEl.appendChild(listContainer);
  }

  // 2. 「保存済みスナップショット」タブの描画
  function renderSavedSnapshotsView(container) {
    container.innerHTML = '';
    const snapshots = loadSnapshots();
    if (snapshots.length === 0) {
      container.innerHTML = `<div class="muted p-16 text-center">${t('editor.snapshot.empty') || 'No saved lists found.'}</div>`;
      return;
    }

    const listEl = document.createElement('div');
    listEl.className = 'editor-list';

    snapshots.forEach((snap, idx) => {
      const card = document.createElement('div');
      card.className = 'snapshot-card';

      const pTagsCount = (snap.tags || []).filter(t => t[0] === 'p').length;

      card.innerHTML = `
        <div class="snapshot-header">
          <input type="text" class="snapshot-title-input" value="${snap.name || ''}" placeholder="リスト名">
          <span class="snapshot-meta">${t('editor.snapshot.count', { n: pTagsCount }) || `${pTagsCount} follows`}</span>
        </div>
        <div class="snapshot-meta">
          <span>🕒 ${formatDate(snap.createdAt)}</span>
        </div>
        <div class="snapshot-actions">
          <button type="button" class="restore-snap-btn">${t('editor.snapshot.restore') || 'Apply List'}</button>
          <button type="button" class="secondary delete-snap-btn">${t('editor.snapshot.delete') || 'Delete'}</button>
        </div>
      `;

      // スナップショット名のインライン編集・変更保存
      const titleInput = card.querySelector('.snapshot-title-input');
      if (titleInput) {
        titleInput.onchange = (e) => {
          const newName = e.target.value.trim();
          snap.name = newName || formatDate(snap.createdAt);
          snapshots[idx] = snap;
          saveSnapshots(snapshots);
        };
      }

      // 編集領域への読み込み（展開）処理
      const restoreBtn = card.querySelector('.restore-snap-btn');
      if (restoreBtn) {
        restoreBtn.onclick = async () => {
          const confirmed = await showConfirmDialog(
            modal.querySelector('.modal-body') || modal,
            'editor.snapshot.confirm_restore',
            'editor.snapshot.restore'
          );
          if (!confirmed) return;

          // スナップショットの tags から items と nonPTags を編集領域へ読み込み
          items = [];
          nonPTags = [];
          if (snap.tags) {
            for (const tag of snap.tags) {
              if (tag[0] === 'p' && tag[1]) {
                items.push({
                  pubkey: tag[1],
                  relayHint: extractRelayHint(tag),
                  petname: extractPetname(tag),
                  isFollowing: true
                });
              } else {
                nonPTags.push([...tag]);
              }
            }
          }

          if (typeof snap.content !== 'undefined') {
            existingContent = snap.content;
          }

          if (statusEl) {
            statusEl.textContent = t('editor.snapshot.loaded_msg') || 'Loaded saved list to editor.';
            setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);
          }

          // 「リスト編集」タブへ自動切替
          activeTab = 'current';
          renderModalStructure();
        };
      }

      // 削除処理
      const deleteBtn = card.querySelector('.delete-snap-btn');
      if (deleteBtn) {
        deleteBtn.onclick = async () => {
          const confirmed = await showConfirmDialog(modal.querySelector('.modal-body') || modal, 'editor.snapshot.confirm_delete', 'editor.snapshot.delete');
          if (!confirmed) return;

          snapshots.splice(idx, 1);
          saveSnapshots(snapshots);
          renderSavedSnapshotsView(container);
        };
      }

      listEl.appendChild(card);
    });

    container.appendChild(listEl);
  }

  // 初期レイアウト表示
  renderModalStructure();

  // 現在のフォローの保存処理
  const handleSave = async () => {
    if (newSaveBtn) newSaveBtn.disabled = true;
    try {
      const confirmed = await showConfirmDialog(modal.querySelector('.modal-body') || modal, 'editor.follow.confirm');
      if (!confirmed) {
        if (newSaveBtn) newSaveBtn.disabled = false;
        return;
      }

      if (statusEl) statusEl.textContent = t('editor.common.publishing') || 'Publishing...';

      let newTags = [...nonPTags];
      // items は本来の時系列順（末尾が最新）。正序でタグを構築
      for (const item of items) {
        if (item.isFollowing) {
          const pet = item.petname ? item.petname.trim() : '';
          const hint = item.relayHint || '';
          newTags.push(['p', item.pubkey, hint, pet]);
        }
      }

      const draft = {
        kind: 3,
        created_at: Math.floor(Date.now() / 1000),
        tags: newTags,
        content: existingContent,
        pubkey: myPubkey
      };

      const res = await publishReplaceableEvent(state, draft);
      if (res && res.ok) {
        if (statusEl) statusEl.textContent = t('editor.common.success') || 'Updated!';

        if (!state.feeds['home']) state.feeds['home'] = {};
        state.feeds['home'].follows = [];
        state.feeds['home'].followSet = new Set();
        if (!state.followPetnames) state.followPetnames = new Map();

        const nip19 = getNip19();
        for (const item of items) {
          if (item.isFollowing) {
            state.feeds['home'].follows.push(item.pubkey);
            state.feeds['home'].followSet.add(item.pubkey);
            if (item.petname && item.petname.trim() !== '') {
              state.followPetnames.set(item.pubkey, item.petname.trim());
            } else {
              state.followPetnames.delete(item.pubkey);
            }
            updateNameDom(state, item.pubkey, nip19);
          }
        }

        setTimeout(() => {
          modal.hidden = true;
          if (statusEl) statusEl.textContent = '';
        }, 1200);
      } else {
        const errMsg = (res && res.error) ? res.error : '';
        if (statusEl) statusEl.textContent = t('editor.common.failed', { msg: errMsg }) || `Failed: ${errMsg}`;
      }
    } catch (err) {
      console.error('Failed to save follow list:', err);
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
