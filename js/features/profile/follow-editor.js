/**
 * Follow Editor Module
 * フォローリスト管理機能 (kind:3) & スナップショット（複数保存・名前変更・復元・削除）
 */

import { fetchLatestEvent, backupEvent, publishReplaceableEvent } from '../../core/replaceable-event.js';
import { t } from '../../utils/i18n.js';
import { getNip19, getSimplePool } from '../../core/nostr-compat.js';
import { getReadRelays, relayConnect, profileIndexerRelay } from '../../core/relay.js';
import { displayNameWithUsername, loadProfile, updateNameDom } from './profile.js';

const SNAPSHOTS_KEY_BASE = 'follow_list_snapshots';

function getSnapshotsKey() {
  const pk = localStorage.getItem('pubkey');
  return pk ? `${SNAPSHOTS_KEY_BASE}.${pk.toLowerCase()}` : SNAPSHOTS_KEY_BASE;
}

const globalMutualCache = new Map();

/**
 * 相手が自分をフォローしているか（相互フォローか）非同期チェック
 */
export async function checkMutualFollow(state, targetPubkey, myPubkey, cache = null) {
  if (!targetPubkey || !myPubkey) return false;
  const activeCache = cache || globalMutualCache;
  if (activeCache.has(targetPubkey)) {
    return activeCache.get(targetPubkey);
  }

  try {
    const SimplePool = getSimplePool();
    const userRelays = getReadRelays(state ? state.relays : null) || [];
    const fetchRelays = [...userRelays];
    if (profileIndexerRelay && !fetchRelays.includes(profileIndexerRelay)) {
      fetchRelays.push(profileIndexerRelay);
    }
    if (!fetchRelays.length) return false;

    if (state && !state.pool) relayConnect(state, SimplePool, () => {});
    const pool = (state && state.pool) ? state.pool : (typeof SimplePool === 'function' ? new SimplePool() : SimplePool);

    const ev = await pool.get(fetchRelays, { kinds: [3], authors: [targetPubkey] });
    const isMutual = !!(ev && ev.tags && ev.tags.some(t => t[0] === 'p' && t[1] === myPubkey));
    activeCache.set(targetPubkey, isMutual);
    return isMutual;
  } catch (e) {
    return false;
  }
}

/**
 * 保存済みスナップショットを取得
 */
function loadSnapshots() {
  try {
    const raw = localStorage.getItem(getSnapshotsKey());
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
    localStorage.setItem(getSnapshotsKey(), JSON.stringify(list));
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

function attachDragAndTouchHandlers(row, dragHandle, itemType, index, itemsArray, container, listSelector, onReorder) {
  row.setAttribute('draggable', 'true');
  row.setAttribute('data-drag-index', index.toString());

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
          if (typeof onReorder === 'function') onReorder();
        }
      }
    } catch (err) { }
  };

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
            if (typeof onReorder === 'function') onReorder();
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
  const myPubkey = (state && state.pubkey) || localStorage.getItem('pubkey');

  if (isFollowing) {
    buttonEl.textContent = t('editor.follow.following') || 'フォロー中';
    buttonEl.className = 'btn-follow-toggle following';

    if (myPubkey) {
      checkMutualFollow(state, targetPubkey, myPubkey).then(isMutual => {
        if (isMutual && buttonEl.isConnected && buttonEl.classList.contains('following')) {
          buttonEl.textContent = t('editor.follow.mutual') || '相互';
          buttonEl.classList.add('mutual');
        }
      }).catch(() => {});
    }
  } else {
    buttonEl.textContent = t('editor.follow.follow') || '+ フォロー';
    buttonEl.className = 'btn-follow-toggle not-following';
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

  const mutualCache = new Map();
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

    displayItems.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'editor-list-item';
      row.setAttribute('data-focus-pubkey', item.pubkey);

      const dragHandle = document.createElement('span');
      dragHandle.className = 'drag-handle';
      dragHandle.textContent = '☰';
      row.appendChild(dragHandle);

      attachDragAndTouchHandlers(row, dragHandle, 'follow', index, displayItems, container, '.editor-list', () => {
        items = [...displayItems].reverse();
        renderCurrentFollowsView(container);
      });

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
        } else {
          const nip19 = getNip19();
          nameEl.textContent = nip19 ? nip19.npubEncode(item.pubkey).substring(0, 12) + '...' : item.pubkey.substring(0, 10) + '...';
          subEl.textContent = '';
          subEl.classList.add('d-none');
        }
      }).catch(() => {
        nameEl.textContent = item.pubkey.substring(0, 10) + '...';
        subEl.textContent = '';
        subEl.classList.add('d-none');
      });

      profileInfo.appendChild(avatar);
      profileInfo.appendChild(nameEl);
      profileInfo.appendChild(subEl);

      // 名前タップでプロフィールモーダルを開く
      profileInfo.onclick = (e) => {
        e.stopPropagation();
        import('../../ui/renderers/render-helpers.js').then(helpers => {
          if (helpers && typeof helpers.invokeShowProfileModalProxy === 'function') {
            helpers.invokeShowProfileModalProxy(item.pubkey);
          } else {
            import('./profile-modal.js').then(mod => {
              if (mod && typeof mod.showProfileModal === 'function') {
                mod.showProfileModal(state, item.pubkey, getNip19());
              }
            });
          }
        }).catch(() => {
          import('./profile-modal.js').then(mod => {
            if (mod && typeof mod.showProfileModal === 'function') {
              mod.showProfileModal(state, item.pubkey, getNip19());
            }
          });
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
      toggleBtn.className = item.isMutual ? 'secondary mutual' : 'secondary';
      toggleBtn.textContent = item.isMutual ? (t('editor.follow.mutual') || '相互') : (t('editor.follow.following') || 'Following');

      if (myPubkey && item.pubkey) {
        checkMutualFollow(state, item.pubkey, myPubkey, mutualCache).then(isMutual => {
          if (isMutual) {
            item.isMutual = true;
            if (item.isFollowing && toggleBtn.isConnected) {
              toggleBtn.textContent = t('editor.follow.mutual') || '相互';
              toggleBtn.className = 'secondary mutual';
            }
          }
        }).catch(() => {});
      }

      toggleBtn.onclick = () => {
        item.isFollowing = !item.isFollowing;
        if (item.isFollowing) {
          toggleBtn.textContent = item.isMutual ? (t('editor.follow.mutual') || '相互') : (t('editor.follow.following') || 'Following');
          toggleBtn.className = item.isMutual ? 'secondary mutual' : 'secondary';
          row.style.opacity = '1';
        } else {
          toggleBtn.textContent = t('editor.follow.unfollow') || 'Unfollow';
          toggleBtn.className = '';
          row.style.opacity = '0.5';
        }
      };

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'editor-list-actions';
      actionsDiv.appendChild(toggleBtn);
      actionsDiv.appendChild(petnameWrapper);

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
