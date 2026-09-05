/**
 * User Follow Modal Module
 * ユーザーのフォロー中一覧 (kind:3) 閲覧用モーダル
 */

import { t } from '../../utils/i18n.js';
import { getNip19, getSimplePool } from '../../core/nostr-compat.js';
import { getReadRelays, relayConnect, profileIndexerRelays } from '../../core/relay.js';
import { displayNameWithUsername, saveProfilesBatchToCache, isAvatarsEnabled, isDomPurgeEnabled } from './profile.js';
import { updateFollowButtonState, toggleFollowUser, clearMutualQueue } from './follow-editor.js';
import { bringModalToFront } from '../../ui/setup/modal-helper.js';

const PAGE_SIZE = 40;

/**
 * 複数ユーザーのプロフィールを一括非同期取得してキャッシュに保存
 */
async function fetchProfilesBatch(state, pubkeys, abortSignal = null) {
  if (!Array.isArray(pubkeys) || !pubkeys.length) return;
  if (abortSignal && abortSignal.aborted) return;
  const needed = pubkeys.filter(pk => {
    const p = (state && state.profiles) ? (state.profiles.get(pk) || state.profiles.get(pk.toLowerCase())) : null;
    return !p || (!p.loaded && !p.name && !p.display_name);
  });
  if (!needed.length) return;

  try {
    const SimplePool = getSimplePool();
    if (state && !state.pool) relayConnect(state, SimplePool, () => {});
    const pool = (state && state.pool) ? state.pool : (typeof SimplePool === 'function' ? new SimplePool() : SimplePool);
    if (!pool || typeof pool.querySync !== 'function') return;

    const queryParams = { maxWait: 1200 };
    if (abortSignal) queryParams.signal = abortSignal;

    const events = await pool.querySync(profileIndexerRelays, {
      kinds: [0],
      authors: needed,
    }, queryParams);

    if (abortSignal && abortSignal.aborted) return;

    if (Array.isArray(events)) {
      const toCache = [];
      const sortedEvents = events.slice().sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
      for (const ev of sortedEvents) {
        if (ev && ev.kind === 0 && ev.pubkey && ev.content) {
          try {
            const existing = state?.profiles?.get(ev.pubkey);
            if (existing && existing.created_at && Number(existing.created_at) >= Number(ev.created_at || 0)) {
              continue;
            }
            const meta = JSON.parse(ev.content);
            const entry = {
              name: meta.name || '',
              display_name: meta.display_name || '',
              picture: meta.picture || '',
              nip05: meta.nip05 || '',
              lud16: meta.lud16 || '',
              loaded: true,
              loading: false,
              fromCache: false,
              created_at: ev.created_at,
              lastAttempt: Date.now()
            };
            if (state && state.profiles) {
              state.profiles.set(ev.pubkey, entry);
              const lower = ev.pubkey.toLowerCase();
              if (lower !== ev.pubkey) state.profiles.set(lower, entry);
            }
            toCache.push({ pubkey: ev.pubkey, profile: entry });
          } catch (e) { }
        }
      }
      if (toCache.length > 0) {
        try {
          saveProfilesBatchToCache(toCache);
        } catch (e) { }
      }
    }
  } catch (e) {
    if (abortSignal && abortSignal.aborted) return;
    console.warn('[UserFollowModal] 一括プロフィール取得エラー:', e);
  }
}

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

  const modalAbortController = new AbortController();
  const abortSignal = modalAbortController.signal;

  let listObserver = null;
  let purgeObserver = null;
  let currentLoadMore = null;
  let isModalActive = true;
  let listEl = null;
  const showAvatars = isAvatarsEnabled(state);

  // モーダルを閉じる処理
  const closeModal = () => {
    isModalActive = false;
    try {
      modalAbortController.abort();
    } catch (e) { }
    clearMutualQueue(abortSignal);
    if (listObserver) {
      try { listObserver.disconnect(); } catch (e) { }
      listObserver = null;
    }
    if (purgeObserver) {
      try { purgeObserver.disconnect(); } catch (e) { }
      purgeObserver = null;
    }
    currentLoadMore = null;
    if (listEl) listEl.onscroll = null;
    modal.hidden = true;
    if (statusEl) statusEl.textContent = '';
    // DOMを即座に破棄してメモリを解放
    if (contentEl) contentEl.innerHTML = '';
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
      if (!isModalActive || abortSignal.aborted) return;
    } catch (e) {
      if (!isModalActive || abortSignal.aborted) return;
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
  listEl = document.createElement('div');
  listEl.className = 'editor-list';

  // DOMパージ（画面外要素のプレースホルダー置換によるメモリ節約。ユーザー設定に準拠）
  const useDomPurge = isDomPurgeEnabled(state);
  if (useDomPurge && typeof IntersectionObserver !== 'undefined') {
    purgeObserver = new IntersectionObserver((entries) => {
      if (!isModalActive) return;
      for (const entry of entries) {
        const el = entry.target;
        if (!el || !el.isConnected) continue;
        const pk = el.dataset.pk;
        if (!pk) continue;

        if (entry.isIntersecting) {
          // 画面内またはマージン内に戻ったプレースホルダーを実DOMに復元
          if (el.classList.contains('editor-list-placeholder')) {
            const newRow = renderItem(pk);
            purgeObserver.unobserve(el);
            el.replaceWith(newRow);
            purgeObserver.observe(newRow);
          }
        } else {
          // 画面外かつマージンを超えた実DOMをプレースホルダーに置換
          if (!el.classList.contains('editor-list-placeholder') && el.classList.contains('editor-list-item')) {
            const height = el.offsetHeight > 0 ? el.offsetHeight : 49;
            const placeholder = document.createElement('div');
            placeholder.className = 'editor-list-item editor-list-placeholder';
            placeholder.dataset.pk = pk;
            placeholder.style.height = `${height}px`;
            placeholder.style.boxSizing = 'border-box';
            purgeObserver.unobserve(el);
            el.replaceWith(placeholder);
            purgeObserver.observe(placeholder);
          }
        }
      }
    }, {
      root: listEl,
      rootMargin: '600px 0px 600px 0px'
    });
  }

  let renderedIndex = 0;

  // アイテムレンダリング関数
  function renderItem(pk) {
    const row = document.createElement('div');
    row.className = 'editor-list-item';
    row.dataset.pk = pk;

    const profileInfo = document.createElement('div');
    profileInfo.className = 'editor-list-info';

    const avatar = document.createElement('img');
    avatar.className = 'editor-list-avatar d-none';
    avatar.alt = '';
    avatar.loading = 'lazy';
    avatar.decoding = 'async';
    avatar.onerror = () => {
      avatar.classList.add('d-none');
    };

    const nameEl = document.createElement('span');
    nameEl.className = 'editor-list-name';

    const subEl = document.createElement('span');
    subEl.className = 'editor-list-sub d-none';

    // プロフィール表示の更新関数（同期反映 & noLoad で直列キューに積まない）
    const updateProfileUi = () => {
      const nip19 = getNip19();
      const prof = (state && state.profiles) ? (state.profiles.get(pk) || state.profiles.get(pk.toLowerCase())) : null;
      if (prof && (prof.name || prof.display_name || prof.picture)) {
        if (prof.picture && showAvatars) {
          avatar.src = prof.picture;
          avatar.classList.remove('d-none');
        } else {
          avatar.src = '';
          avatar.classList.add('d-none');
        }
        const names = displayNameWithUsername(state, pk, nip19, { usePetname: false, noTruncate: true, noLoad: true });
        nameEl.textContent = names.main;
        if (names.sub) {
          subEl.textContent = `@${names.sub}`;
          subEl.classList.remove('d-none');
        } else {
          subEl.textContent = '';
          subEl.classList.add('d-none');
        }
      } else {
        const shortNpub = (nip19 && typeof nip19.npubEncode === 'function')
          ? nip19.npubEncode(pk).substring(0, 12) + '...'
          : pk.substring(0, 10) + '...';
        nameEl.textContent = shortNpub;
        subEl.textContent = '';
        subEl.classList.add('d-none');
        avatar.src = '';
        avatar.classList.add('d-none');
      }
    };

    // 初期表示（キャッシュがあれば即時表示）
    updateProfileUi();
    row._updateProfileUi = updateProfileUi;

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

      updateFollowButtonState(state, toggleBtn, pk, { signal: abortSignal });
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
    const rows = [];
    nextBatch.forEach(pk => {
      const row = renderItem(pk);
      rows.push(row);
      listEl.appendChild(row);
      if (purgeObserver) {
        purgeObserver.observe(row);
      }
    });
    renderedIndex += nextBatch.length;

    // 未キャッシュのプロフィールを一括取得し、DOMを反映
    if (nextBatch.length > 0) {
      fetchProfilesBatch(state, nextBatch, abortSignal).then(() => {
        if (!isModalActive || abortSignal.aborted) return;
        nextBatch.forEach(pk => {
          const liveRow = listEl?.querySelector(`.editor-list-item[data-pk="${pk}"]`);
          if (liveRow && typeof liveRow._updateProfileUi === 'function') {
            liveRow._updateProfileUi();
          }
        });
      });
    }

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
