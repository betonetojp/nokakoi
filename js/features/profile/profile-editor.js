/**
 * Profile Editor Module
 * プロフィール編集機能
 */

import { fetchLatestEvent, backupEvent, publishReplaceableEvent } from '../../core/replaceable-event.js';
import { t, applyTranslations } from '../../utils/i18n.js';
import { getNip19 } from '../../core/nostr-compat.js';
import { showConfirmModal } from '../../ui/modals/modals.js';

// 編集対象フィールド定義
const PROFILE_FIELDS = [
  { key: 'display_name', i18n: 'editor.profile.display_name', type: 'text' },
  { key: 'name', i18n: 'editor.profile.name', type: 'text' },
  { key: 'about', i18n: 'editor.profile.about', type: 'textarea' },
  { key: 'picture', i18n: 'editor.profile.picture', type: 'url' },
  { key: 'banner', i18n: 'editor.profile.banner', type: 'url' },
  { key: 'nip05', i18n: 'editor.profile.nip05', type: 'text' },
  { key: 'lud16', i18n: 'editor.profile.lud16', type: 'text' },
  { key: 'website', i18n: 'editor.profile.website', type: 'url' },
];

/**
 * プロフィール編集モーダルを開く
 * @param {Object} state - アプリケーション状態
 */
export async function openProfileEditor(state) {
  try {
    // 1. ログイン状態の確認（localStorageからpubkeyを取得）
    const pubkey = localStorage.getItem('pubkey');
    if (!pubkey) {
      console.warn('Not logged in: pubkey not found in localStorage');
      return;
    }

    // 2. モーダルの表示
    const modal = document.getElementById('profileEditModal');
    if (!modal) {
      console.error('Modal #profileEditModal not found');
      return;
    }
    modal.hidden = false;

    // 関連要素の取得
    const statusEl = document.getElementById('profileEditStatus');
    const contentEl = document.getElementById('profileEditContent');
    const saveBtn = document.getElementById('profileEditSaveBtn');
    const cancelBtn = document.getElementById('profileEditCancelBtn');
    const closeBtn = document.getElementById('profileEditClose');

    // 3. ローディング状態の表示
    if (statusEl) {
      statusEl.textContent = t('editor.common.fetching') || 'Fetching...';
    }
    if (contentEl) {
      contentEl.innerHTML = ''; // フォーム領域のクリア
    }

    // イベントリスナーの重複登録を防ぐためにボタンをクローンして置き換える
    const newSaveBtn = saveBtn ? saveBtn.cloneNode(true) : null;
    const newCancelBtn = cancelBtn ? cancelBtn.cloneNode(true) : null;
    const newCloseBtn = closeBtn ? closeBtn.cloneNode(true) : null;

    if (saveBtn && newSaveBtn) saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    if (cancelBtn && newCancelBtn) cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    if (closeBtn && newCloseBtn) closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

    // 4. 最新の kind:0 イベントを取得
    let baseObject = {};
    const latestEvent = await fetchLatestEvent(state, 0, pubkey);

    if (latestEvent) {
      // 5. 既存のプロフィール情報 (JSON) をパースして base object とする
      try {
        baseObject = JSON.parse(latestEvent.content);
        // 6. 念のため元のイベントをバックアップ
        backupEvent(0, latestEvent);
      } catch (e) {
        console.error('Failed to parse existing profile JSON:', e);
      }
    }

    if (statusEl) {
      statusEl.textContent = '';
    }

    let activeTab = 'current'; // 'current' | 'saved'

    function renderProfileEditorStructure() {
      if (!contentEl) return;
      contentEl.innerHTML = `
        <div class="editor-tabs" style="margin-bottom: 12px;">
          <button type="button" class="editor-tab ${activeTab === 'current' ? 'active' : ''}" id="tabProfCurrent">
            ${t('editor.snapshot.tab_current') || '編集'}
          </button>
          <button type="button" class="editor-tab ${activeTab === 'saved' ? 'active' : ''}" id="tabProfSaved">
            ${t('editor.snapshot.tab_saved') || 'バックアップ一覧'}
          </button>
        </div>
        <div id="profCurrentSection" ${activeTab === 'current' ? '' : 'hidden'}></div>
        <div id="profSavedSection" ${activeTab === 'saved' ? '' : 'hidden'}>
          <div id="profileSnapshotsContainer" style="padding: 8px 0;"></div>
        </div>
      `;

      const currentSec = contentEl.querySelector('#profCurrentSection');
      const savedSec = contentEl.querySelector('#profSavedSection');
      const snapContainer = contentEl.querySelector('#profileSnapshotsContainer');

      if (currentSec && activeTab === 'current') {
        const topBar = document.createElement('div');
        topBar.className = 'row align-center space-between mb-12';
        topBar.style.display = 'flex';
        topBar.style.alignItems = 'center';
        topBar.style.justifyContent = 'space-between';
        topBar.style.marginBottom = '12px';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'muted text-sm';
        labelSpan.textContent = t('editor.profile.title') || 'プロフィール設定';
        topBar.appendChild(labelSpan);

        const saveSnapBtn = document.createElement('button');
        saveSnapBtn.type = 'button';
        saveSnapBtn.className = 'secondary text-sm';
        saveSnapBtn.textContent = t('editor.snapshot.save_btn') || '現在の状態をバックアップ保存';
        saveSnapBtn.onclick = () => {
          const inputs = currentSec.querySelectorAll('.editor-input');
          const currentObj = {};
          inputs.forEach(inp => {
            if (inp.dataset.key && inp.value.trim()) {
              currentObj[inp.dataset.key] = inp.value.trim();
            }
          });
          createProfileSnapshot(pubkey, currentObj);
          if (statusEl) statusEl.textContent = t('editor.snapshot.saved_msg') || 'バックアップを保存しました';
          activeTab = 'saved';
          renderProfileEditorStructure();
        };
        topBar.appendChild(saveSnapBtn);

        currentSec.appendChild(topBar);

        const form = document.createElement('div');
        form.className = 'editor-form';

        PROFILE_FIELDS.forEach(field => {
          const fieldDiv = document.createElement('div');
          fieldDiv.className = 'editor-field';

          const label = document.createElement('label');
          label.textContent = t(field.i18n) || field.key;
          fieldDiv.appendChild(label);

          let input;
          if (field.type === 'textarea') {
            input = document.createElement('textarea');
            input.rows = 4;
          } else {
            input = document.createElement('input');
            input.type = field.type;
          }
          input.className = 'editor-input';
          input.dataset.key = field.key;
          input.value = baseObject[field.key] || '';
          
          fieldDiv.appendChild(input);
          form.appendChild(fieldDiv);
        });

        currentSec.appendChild(form);
      } else if (savedSec && activeTab === 'saved' && snapContainer) {
        renderProfileSnapshotsUI(snapContainer, pubkey, (restoredData) => {
          if (!restoredData) return;
          baseObject = { ...baseObject, ...restoredData };
          activeTab = 'current';
          renderProfileEditorStructure();
          if (statusEl) statusEl.textContent = t('editor.snapshot.loaded_msg') || '編集画面に読み込みました。内容確認後、保存で反映・発行できます。';
        });
      }

      const tabCurrent = contentEl.querySelector('#tabProfCurrent');
      const tabSaved = contentEl.querySelector('#tabProfSaved');

      if (tabCurrent) {
        tabCurrent.onclick = () => {
          activeTab = 'current';
          renderProfileEditorStructure();
        };
      }
      if (tabSaved) {
        tabSaved.onclick = () => {
          activeTab = 'saved';
          renderProfileEditorStructure();
        };
      }
    }

    renderProfileEditorStructure();

    // 8. 保存ボタン (#profileEditSaveBtn) の処理
    if (newSaveBtn) {
      newSaveBtn.addEventListener('click', async () => {
        try {
          if (statusEl) statusEl.textContent = t('editor.common.publishing') || 'Publishing...';

          // a. フォームからすべての値を取得
          const inputs = contentEl.querySelectorAll('.editor-input');
          
          // b. base object をコピーして、編集されたフィールドをマージ (未知のフィールドを維持)
          const merged = { ...baseObject };

          inputs.forEach(input => {
            const key = input.dataset.key;
            const val = input.value.trim();
            
            if (val === '') {
              // c. ユーザーが空文字にした場合はキーごと削除
              delete merged[key];
            } else {
              merged[key] = val;
            }
          });

          // d. 確認ダイアログの表示
          const confirmed = await showConfirmDialog(modal, !latestEvent);
          if (!confirmed) {
            if (statusEl) statusEl.textContent = '';
            return;
          }

          if (statusEl) statusEl.textContent = t('editor.common.publishing') || 'Publishing...';

          // e. ドラフトイベントの構築
          const draft = {
            kind: 0,
            created_at: Math.floor(Date.now() / 1000),
            tags: [],
            content: JSON.stringify(merged),
            pubkey: pubkey
          };

          // f. イベントの公開
          const res = await publishReplaceableEvent(state, draft);

          if (res && res.ok) {
            // g. 成功時の処理：状態の更新とDOMの更新
            const profileStateObj = {
              ...merged,
              loaded: true,
              loading: false,
              fromCache: false,
              lastAttempt: Date.now()
            };
            state.profiles.set(pubkey, profileStateObj);

            // キャッシュとDOM更新のために遅延インポート
            const { saveProfileToCache, updateNameDom } = await import('./profile.js');
            saveProfileToCache(pubkey, merged);

            const nip19 = getNip19();
            updateNameDom(state, pubkey, nip19);

            // ヘッダーの名前も更新
            const { updateHeaderName } = await import('../../core/auth/auth-core.js');
            updateHeaderName(state, nip19);

            if (statusEl) statusEl.textContent = t('editor.common.success') || 'Success!';
            // 少し待ってからモーダルを閉じる
            setTimeout(closeProfileEditor, 1500);
          } else {
            // h. 失敗時の処理
            const errMsg = (res && res.error) ? res.error : '';
            if (statusEl) statusEl.textContent = t('editor.common.failed', { msg: errMsg }) || `Failed: ${errMsg}`;
          }
        } catch (e) {
          console.error('Failed to save profile:', e);
          if (statusEl) statusEl.textContent = t('editor.common.failed', { msg: e.message || e }) || 'Error occurred';
        }
      });
    }

    // 9. キャンセルボタン (#profileEditCancelBtn) の処理
    if (newCancelBtn) {
      newCancelBtn.addEventListener('click', closeProfileEditor);
    }

    // 10. 閉じるボタン (#profileEditClose) の処理
    if (newCloseBtn) {
      newCloseBtn.addEventListener('click', closeProfileEditor);
    }

  } catch (e) {
    console.error('Error opening profile editor:', e);
  }
}

/**
 * モーダルを閉じる
 */
function closeProfileEditor() {
  const modal = document.getElementById('profileEditModal');
  if (modal) {
    modal.hidden = true;
    const statusEl = document.getElementById('profileEditStatus');
    if (statusEl) statusEl.textContent = '';
  }
}

/**
 * 確認ダイアログをモーダル内にオーバーレイとして表示する
 * @param {HTMLElement} parentElement - オーバーレイを追加する親要素（モーダル）
 * @returns {Promise<boolean>} ユーザーが確認した場合は true、キャンセルの場合は false
 */
function showConfirmDialog(parentElement, isNewProfile = false) {
  return new Promise((resolve) => {
    // オーバーレイ要素の作成
    const overlay = document.createElement('div');
    overlay.className = 'editor-confirm-overlay';

    // ダイアログ要素の作成
    const dialog = document.createElement('div');
    dialog.className = 'editor-confirm-dialog';

    // メッセージの作成
    const msg = document.createElement('div');
    msg.className = 'editor-confirm-msg';

    const titleText = isNewProfile 
      ? (t('editor.profile.confirm_new_title') || 'プロフィールを公開しますか？')
      : (t('editor.profile.confirm') || 'プロフィールを更新しますか？');

    const detailText = isNewProfile
      ? (t('editor.profile.confirm_new_detail') || 'この新しいアカウントにプロフィール情報(kind:0)を発行・保存します。')
      : (t('editor.profile.confirm_detail') || 'この操作は既存のプロフィール情報を更新・上書きします。');

    msg.innerHTML = `<strong>${titleText}</strong><br><br>${detailText}`;

    // ボタンコンテナ
    const btnContainer = document.createElement('div');
    btnContainer.className = 'editor-confirm-actions';

    // キャンセルボタン（セカンダリボタン）
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = t('editor.common.cancel') || 'Cancel';
    cancelBtn.className = 'secondary';
    cancelBtn.type = 'button';
    cancelBtn.onclick = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(false);
    };

    // 確定ボタン（プライマリボタン）
    const okBtn = document.createElement('button');
    okBtn.textContent = t('editor.common.confirm_publish') || 'Publish';
    okBtn.type = 'button';
    okBtn.onclick = () => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(true);
    };

    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(okBtn);

    dialog.appendChild(msg);
    dialog.appendChild(btnContainer);
    overlay.appendChild(dialog);
    
    // 親要素がrelativeでない場合は設定
    if (getComputedStyle(parentElement).position === 'static') {
      parentElement.style.position = 'relative';
    }
    
    parentElement.appendChild(overlay);
  });
}

const PROFILE_SNAPSHOTS_KEY_BASE = 'profile_snapshots';

export function getProfileSnapshotsStorageKey(pubkey) {
  const pk = pubkey || (typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : null);
  if (!pk) return PROFILE_SNAPSHOTS_KEY_BASE;
  return `${PROFILE_SNAPSHOTS_KEY_BASE}.${pk.toLowerCase()}`;
}

export function loadProfileSnapshots(pubkey) {
  try {
    const key = getProfileSnapshotsStorageKey(pubkey);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export function saveProfileSnapshots(pubkey, snapshots) {
  try {
    const key = getProfileSnapshotsStorageKey(pubkey);
    localStorage.setItem(key, JSON.stringify(snapshots || []));
  } catch (e) {}
}

export function createProfileSnapshot(pubkey, profileData, name = null) {
  if (!pubkey) pubkey = typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : null;
  if (!pubkey || !profileData || typeof profileData !== 'object') return null;

  const snapshots = loadProfileSnapshots(pubkey);
  const now = Date.now();
  const dateStr = new Date(now).toLocaleString();
  const displayName = profileData.display_name || profileData.name || '名称未設定';
  const snapshotName = name || `${displayName} (${dateStr})`;

  const newSnap = {
    id: `snap_prof_${now}_${Math.random().toString(36).substring(2, 7)}`,
    name: snapshotName,
    timestamp: now,
    data: JSON.parse(JSON.stringify(profileData))
  };

  snapshots.unshift(newSnap);
  if (snapshots.length > 30) snapshots.length = 30;
  saveProfileSnapshots(pubkey, snapshots);
  return newSnap;
}

export function renderProfileSnapshotsUI(container, pubkey, onApply) {
  if (!container) return;
  const targetPk = pubkey || (typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : null);
  const snapshots = loadProfileSnapshots(targetPk);

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

    const pData = snap.data || {};
    const dName = pData.display_name || pData.name || '名称未設定';
    const pictureUrl = pData.picture || '';
    const dateText = new Date(snap.timestamp).toLocaleString();

    card.innerHTML = `
      <div class="snapshot-header row align-center space-between gap-8 mb-4">
        <div class="row align-center gap-8" style="flex:1;">
          ${pictureUrl ? `<img src="${pictureUrl}" style="width:28px; height:28px; border-radius:50%; object-fit:cover;">` : '<span style="font-size:1.2rem;">👤</span>'}
          <input type="text" class="snapshot-title-input font-bold" value="${snap.name || dName}" placeholder="${t('editor.snapshot.name_placeholder') || 'リスト名'}" style="flex:1; border:1px solid transparent; background:transparent; color:inherit;">
        </div>
      </div>
      <div class="text-xs muted mb-8">${dateText}</div>
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
        snap.name = titleInput.value.trim() || `${dName} (${dateText})`;
        snapshots[idx] = snap;
        saveProfileSnapshots(targetPk, snapshots);
      };
    }

    const restoreBtn = card.querySelector('.restore-snap-btn');
    if (restoreBtn) {
      restoreBtn.onclick = () => {
        showConfirmModal(
          t('editor.snapshot.restore') || '編集画面に読み込む',
          t('editor.snapshot.confirm_restore') || 'この保存データを編集画面に読み込みますか？',
          () => {
            if (typeof onApply === 'function') {
              onApply(snap.data);
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
            saveProfileSnapshots(targetPk, snapshots);
            renderProfileSnapshotsUI(container, targetPk, onApply);
          }
        );
      };
    }

    listContainer.appendChild(card);
  });

  container.appendChild(listContainer);
}
