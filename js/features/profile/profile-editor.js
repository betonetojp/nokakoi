/**
 * Profile Editor Module
 * プロフィール編集機能
 */

import { fetchLatestEvent, backupEvent, publishReplaceableEvent } from '../../core/replaceable-event.js';
import { t, applyTranslations } from '../../utils/i18n.js';
import { getNip19 } from '../../core/nostr-compat.js';

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

    // 7. 編集フォームを動的に構築して #profileEditContent に追加
    if (contentEl) {
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
        // 既存の値をセット（未定義の場合は空文字）
        input.value = baseObject[field.key] || '';
        
        fieldDiv.appendChild(input);
        form.appendChild(fieldDiv);
      });

      contentEl.appendChild(form);
    }

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
