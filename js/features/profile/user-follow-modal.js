/**
 * User Follow Modal Module
 * ユーザーのフォロー中一覧 (kind:3) 閲覧用モーダル
 */

import { t } from '../../utils/i18n.js';
import { getNip19, getSimplePool } from '../../core/nostr-compat.js';
import { getReadRelays, relayConnect, profileIndexerRelays } from '../../core/relay.js';
import { displayNameWithUsername, loadProfile } from './profile.js';
import { updateFollowButtonState, toggleFollowUser } from './follow-editor.js';
import { bringModalToFront } from '../../ui/setup/modal-helper.js';

const PAGE_SIZE = 50;

/**
 * ユーザーのフォロー一覧モーダルを開く
 * @param {object} state アプリケーション状態
 * @param {string} targetPubkey 対象ユーザーのpubkey
 * @param {object|null} targetProfile プロフィール情報
 * @param {object|null} cachedKind3 事前に取得済みのkind:3イベント
 */
export async function openUserFollowListModal(state, targetPubkey, targetProfile = null, cachedKind3 = null) {
  const modal = document.getElementById('userFollowListModal');
  if (!modal) return;

  const titleEl = document.getElementById('userFollowListTitle');
  const closeBtn = document.getElementById('userFollowListClose');
  const bottomCloseBtn = document.getElementById('userFollowListBottomCloseBtn');
  const countEl = document.getElementById('userFollowListCount');
  const editBtn = document.getElementById('userFollowListEditBtn');
  const statusEl = document.getElementById('userFollowListStatus');
  const contentEl = document.getElementById('userFollowListContent');

  let listObserver = null;
  let currentLoadMore = null;

  // モーダルを閉じる処理
  const closeModal = () => {
    if (listObserver) {
      try { listObserver.disconnect(); } catch (e) { }
      listObserver = null;
    }
    currentLoadMore = null;
    modal.hidden = true;
    if (statusEl) statusEl.textContent = '';
  };
  if (closeBtn) closeBtn.onclick = closeModal;
  if (bottomCloseBtn) bottomCloseBtn.onclick = closeModal;

  // 初期化
  if (statusEl) statusEl.textContent = '';
  if (countEl) countEl.textContent = '';
  if (contentEl) contentEl.innerHTML = '';

  // タイトル設定
  const profile = targetProfile || (state && state.profiles && state.profiles.get(targetPubkey));
  const targetName = (profile && (profile.display_name || profile.name)) || (targetPubkey ? targetPubkey.substring(0, 8) + '...' : '');
  if (titleEl) {
    const titleText = t('profile.follow_list_modal_title', { name: targetName }) || `${targetName} のフォロー一覧`;
    titleEl.textContent = titleText;
    titleEl.title = titleText;
  }

  // ログイン中ユーザーが自分自身の場合は「フォローリスト編集」ボタンを表示
  const myPubkey = (state && state.pubkey) || localStorage.getItem('pubkey');
  if (editBtn) {
    if (myPubkey && myPubkey.toLowerCase() === targetPubkey.toLowerCase()) {
      editBtn.classList.remove('d-none');
      editBtn.onclick = () => {
        modal.hidden = true;
        import('./follow-editor.js').then(mod => {
          if (mod && typeof mod.openFollowEditor === 'function') {
            mod.openFollowEditor(state);
            const followModal = document.getElementById('followEditModal');
            if (followModal) {
              try {
                if (typeof bringModalToFront === 'function') bringModalToFront(followModal);
                else if (typeof window !== 'undefined' && typeof window.bringModalToFront === 'function') window.bringModalToFront(followModal);
              } catch (e) { }
            }
          }
        });
      };
    } else {
      editBtn.classList.add('d-none');
    }
  }

  // モーダルを表示して最前面に
  modal.hidden = false;
  try {
    if (typeof bringModalToFront === 'function') {
      bringModalToFront(modal);
    } else if (typeof window !== 'undefined' && typeof window.bringModalToFront === 'function') {
      window.bringModalToFront(modal);
    }
  } catch (e) { }

  // kind:3 イベント取得
  let ev = cachedKind3;
  if (!ev) {
    if (statusEl) statusEl.textContent = t('editor.common.fetching') || '読み込み中...';
    try {
      const SimplePool = getSimplePool();
      const userRelays = getReadRelays(state ? state.relays : null) || [];
      const fetchRelays = [...userRelays];
      for (const idx of profileIndexerRelays) {
        if (idx && !fetchRelays.includes(idx)) fetchRelays.push(idx);
      }
      if (!fetchRelays.length) {
        if (statusEl) statusEl.textContent = t('channel.no_relay') || '接続可能なリレーがありません';
        return;
      }
      if (state && !state.pool) relayConnect(state, SimplePool, () => {});
      const pool = (state && state.pool) ? state.pool : (typeof SimplePool === 'function' ? new SimplePool() : SimplePool);
      ev = await pool.get(fetchRelays, { kinds: [3], authors: [targetPubkey] });
    } catch (e) {
      console.warn('[UserFollowModal] kind:3 取得失敗:', e);
      if (statusEl) statusEl.textContent = t('editor.common.fetch_failed', { msg: e.message || e }) || '取得に失敗しました';
      return;
    }
  }

  if (statusEl) statusEl.textContent = '';

  // フォロー中 pubkey 一覧を抽出（重複排除）
  const seen = new Set();
  const followPubkeys = [];
  if (ev && Array.isArray(ev.tags)) {
    for (const tag of ev.tags) {
      if (tag[0] === 'p' && tag[1] && !seen.has(tag[1])) {
        seen.add(tag[1]);
        followPubkeys.push(tag[1]);
      }
    }
  }

  // 新しい順（末尾に追加されることが多いため逆順）
  followPubkeys.reverse();

  // 件数表示
  if (countEl) {
    countEl.textContent = t('editor.snapshot.count', { n: followPubkeys.length }) || `${followPubkeys.length} 件`;
  }

  // 0件の場合
  if (followPubkeys.length === 0) {
    if (contentEl) {
      contentEl.innerHTML = `<div class="muted p-16 text-center">${t('profile.follow_list_empty') || 'フォローしているユーザーはいません。'}</div>`;
    }
    return;
  }

  // リストコンテナ生成
  const listEl = document.createElement('div');
  listEl.className = 'editor-list';

  let renderedIndex = 0;

  // アイテムレンダリング関数
  function renderItem(pk) {
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
    nameEl.textContent = pk.substring(0, 10) + '...';

    const subEl = document.createElement('span');
    subEl.className = 'editor-list-sub d-none';

    loadProfile(state, pk).then(prof => {
      if (prof) {
        if (prof.picture) {
          avatar.src = prof.picture;
          avatar.classList.remove('d-none');
        }
        const names = displayNameWithUsername(state, pk, getNip19(), { usePetname: false, noTruncate: true });
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
        nameEl.textContent = nip19 ? nip19.npubEncode(pk).substring(0, 12) + '...' : pk.substring(0, 10) + '...';
        subEl.textContent = '';
        subEl.classList.add('d-none');
      }
    }).catch(() => {
      nameEl.textContent = pk.substring(0, 10) + '...';
      subEl.textContent = '';
      subEl.classList.add('d-none');
    });

    profileInfo.appendChild(avatar);
    profileInfo.appendChild(nameEl);
    profileInfo.appendChild(subEl);

    // タップでプロフィールモーダルを開く
    profileInfo.onclick = (e) => {
      e.stopPropagation();
      import('./profile-modal.js').then(mod => {
        if (mod && typeof mod.showProfileModal === 'function') {
          mod.showProfileModal(state, pk, getNip19());
        }
      });
    };

    row.appendChild(profileInfo);

    // ログイン中かつ自分以外の場合はフォローボタントグルを表示
    if (myPubkey && myPubkey.toLowerCase() !== pk.toLowerCase()) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'editor-list-actions';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn-follow-toggle';
      actionsDiv.appendChild(toggleBtn);

      updateFollowButtonState(state, toggleBtn, pk);
      toggleBtn.onclick = async (e) => {
        e.stopPropagation();
        await toggleFollowUser(state, pk, toggleBtn);
      };

      row.appendChild(actionsDiv);
    }

    return row;
  }

  // 段階的読み込み
  function appendNextBatch() {
    const nextBatch = followPubkeys.slice(renderedIndex, renderedIndex + PAGE_SIZE);
    nextBatch.forEach(pk => {
      listEl.appendChild(renderItem(pk));
    });
    renderedIndex += nextBatch.length;

    // 既存の「もっと読む」行を削除
    const existingMoreRow = listEl.querySelector('.btn-load-more-follows');
    if (existingMoreRow) {
      if (listObserver) {
        try { listObserver.unobserve(existingMoreRow); } catch (e) { }
      }
      existingMoreRow.remove();
    }

    if (renderedIndex < followPubkeys.length) {
      const moreRow = document.createElement('div');
      moreRow.className = 'row justify-center mt-12 mb-8 btn-load-more-follows';
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'secondary text-sm';
      const remaining = followPubkeys.length - renderedIndex;
      moreBtn.textContent = t('feed.load_more') ? `${t('feed.load_more')} (${remaining})` : `もっと読む (${remaining})`;

      let isLoadingBatch = false;
      const triggerLoadMore = () => {
        if (isLoadingBatch) return;
        isLoadingBatch = true;
        moreBtn.disabled = true;
        moreBtn.textContent = t('loading') || '読み込み中...';
        currentLoadMore = null;
        if (listObserver) {
          try { listObserver.unobserve(moreRow); } catch (e) { }
        }
        moreRow.remove();
        appendNextBatch();
      };

      currentLoadMore = triggerLoadMore;
      moreBtn.onclick = triggerLoadMore;
      moreRow.appendChild(moreBtn);
      listEl.appendChild(moreRow);

      // フィードと同様にスクロール到達時に自動発火（毎回最新の currentLoadMore を呼び出す）
      try {
        if (typeof IntersectionObserver !== 'undefined') {
          if (!listObserver) {
            listObserver = new IntersectionObserver((entries) => {
              entries.forEach(entry => {
                if (entry.isIntersecting) {
                  if (typeof currentLoadMore === 'function') {
                    currentLoadMore();
                  }
                }
              });
            }, { root: listEl, rootMargin: '250px', threshold: 0.05 });
          }
          listObserver.observe(moreRow);
        }
      } catch (e) { }
    } else {
      currentLoadMore = null;
      if (listObserver) {
        try { listObserver.disconnect(); } catch (e) { }
        listObserver = null;
      }
    }
  }

  // スクロール底付近の到達検知（IntersectionObserver のフォールバック/ダブルガード）
  listEl.onscroll = () => {
    if (typeof currentLoadMore === 'function') {
      const remainingScroll = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
      if (remainingScroll < 300) {
        currentLoadMore();
      }
    }
  };

  if (contentEl) {
    contentEl.innerHTML = '';
    contentEl.appendChild(listEl);
    appendNextBatch();
  }
}
