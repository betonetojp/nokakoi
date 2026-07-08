// ============================================================================
// プロフィールモーダル
// ============================================================================

import { $, escapeHtml, fmtTime } from './utils.js';
import { subOnce, getReadRelays, relayConnect } from './relay.js';
import { getSimplePool } from './nostr-compat.js';
import { renderEvent } from './renderer.js';
import { showJsonModal } from './json-modal.js';
import { t, applyTranslations } from './i18n.js';
import { EVENTS_TIMEOUT, EVENTS_FETCH_LIMIT, EVENTS_MAX } from './constants.js';

let currentModalPubkey = null;

/**
 * プロフィールモーダルを表示
 */
export function showProfileModal(state, pubkey, nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent) {
  const modal = $('#profileModal');
  const closeBtn = $('#profileClose');
  const content = $('#profileContent');

  if (!modal || !content) return;

  // 呼び出し側が settings や handlers を省略しても安全に動く既定値を補完
  try {
    if (!settings) settings = {};
    if (!settingsManager) {
      // settingsManager 未指定時の最小 no-op スタブ（実行時エラー回避）
      settingsManager = {
        get: function () { return null; },
        set: function () { },
        getUserReaction: function () { return null; },
        saveUserReaction: function () { },
      };
    }
    if (typeof reactToEvent !== 'function') reactToEvent = async () => { };
    if (typeof replyToEvent !== 'function') replyToEvent = async () => { };
    if (typeof repostEvent !== 'function') repostEvent = async () => { };
  } catch (e) { }

  // モーダル内の固定ラベルに翻訳を適用
  try { if (typeof applyTranslations === 'function') applyTranslations(modal, true); } catch (e) { }

  // pubkeyが未指定ならlocalStorageから取得
  if (!pubkey) pubkey = localStorage.getItem('pubkey');
  if (!pubkey) return;
  // キャッシュからプロフィール取得
  const profile = state.profiles.get(pubkey);

  // 基本情報表示
  const displayNameEl = $('#profileDisplayName');
  const usernameEl = $('#profileUsername');
  const npubEl = $('#profileNpub');
  const aboutEl = $('#profileAbout');
  const pictureEl = $('#profilePicture');
  const bannerEl = $('#profileBanner');
  const bannerContainerEl = $('#profileBannerContainer');
  const statsEl = $('#profileStats');
  const followStatusEl = $('#profileFollowStatus');

  currentModalPubkey = pubkey;
  if (followStatusEl) followStatusEl.style.display = 'none';

  // フォロー状態確認（非同期）
  if (state && state.pubkey && state.pubkey !== pubkey && followStatusEl) {
    const targetPubkey = pubkey;
    (async () => {
      try {
        const SimplePool = getSimplePool();
        const relays = getReadRelays(state.relays) || [];
        if (!relays.length) return;

        if (!state.pool) relayConnect(state, SimplePool, () => { });

        // 自分のpubkeyが相手のkind:3に含まれているか確認
        // get()は内部で複数のリレーから最新のイベントを解決してくれるはず
        const ev = await state.pool.get(relays, { kinds: [3], authors: [targetPubkey] });

        if (currentModalPubkey !== targetPubkey) return; // モーダル表示対象が切り替わった

        if (ev && ev.tags) {
          const isFollowing = ev.tags.some(t => t[0] === 'p' && t[1] === state.pubkey);
          if (isFollowing) {
            followStatusEl.style.display = 'block';
          }
        }
      } catch (e) { }
    })();
  }

  const includeProfileReactions = (() => {
    try {
      if (settingsManager && typeof settingsManager.get === 'function') {
        return settingsManager.get('showProfileReactions') === true;
      }
    } catch (e) { }
    if (settings && typeof settings.showProfileReactions !== 'undefined') {
      return settings.showProfileReactions === true;
    }
    return false;
  })();
  const includeProfileChannel = (() => {
    try {
      if (settingsManager && typeof settingsManager.get === 'function') {
        return settingsManager.get('showProfileChannel') === true;
      }
    } catch (e) { }
    if (settings && typeof settings.showProfileChannel !== 'undefined') {
      return settings.showProfileChannel === true;
    }
    return false;
  })();
  const includeProfileRepost16 = (() => {
    try {
      if (settingsManager && typeof settingsManager.get === 'function') {
        return settingsManager.get('showProfileRepost16') === true;
      }
    } catch (e) { }
    if (settings && typeof settings.showProfileRepost16 !== 'undefined') {
      return settings.showProfileRepost16 === true;
    }
    return false;
  })();
  const profileFeedKinds = [1, 6];
  if (includeProfileReactions) profileFeedKinds.push(7);
  if (includeProfileChannel) profileFeedKinds.push(42);
  if (includeProfileRepost16) profileFeedKinds.push(16);
  const profileFeedKindSet = new Set(profileFeedKinds);


  if (displayNameEl) {
    const displayName = (profile && profile.display_name) || (profile && profile.name) || 'Unknown';
    let html = '';
    try {
      const pet = (state && state.followPetnames && state.followPetnames.get && state.followPetnames.get(pubkey)) || '';
      if (pet && String(pet).trim()) {
        html += '<span class="petname"><span class="icon petname-badge" role="img" aria-label="Badge"></span>' + escapeHtml(String(pet).trim()) + '</span>';
      }
    } catch (e) { }
    html += '<span class="profile-display-name-text" title="' + escapeHtml(displayName) + '">' + escapeHtml(displayName) + '</span>';
    try {
      displayNameEl.innerHTML = html;
    } catch (e) {
      displayNameEl.textContent = displayName;
    }
  }

  if (usernameEl) {
    // モーダルではnameがあれば必ず表示
    const name = (profile && profile.name) || '';
    if (name) {
      usernameEl.textContent = '@' + name;
      usernameEl.title = name;
      usernameEl.style.display = 'block';
    } else {
      usernameEl.textContent = '';
      usernameEl.removeAttribute('title');
      usernameEl.style.display = 'none';
    }
  }

  if (npubEl && nip19 && nip19.npubEncode) {
    try {
      const npub = nip19.npubEncode(pubkey);
      npubEl.textContent = npub;

      // lumilumi へのリンクを追加
      try {
        const span = document.createElement('span'); // ラッパー（直接追加でも可）
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-kind';
        btn.style.marginLeft = '12px';
        btn.textContent = t('profile.open_lumilumi');
        btn.onclick = function() {
           window.open('https://lumilumi.app/' + npub, '_blank', 'noopener,noreferrer');
        };
        npubEl.appendChild(btn);
      } catch (e) { }

    } catch (e) {
      npubEl.textContent = pubkey.substring(0, 16) + '...';
    }
  }

  if (aboutEl) {
    const about = (profile && profile.about) || '';
    if (about) {
      aboutEl.textContent = about;
      aboutEl.style.display = 'block';
    } else {
      aboutEl.style.display = 'none';
    }
  }

  if (pictureEl) {
    const picture = (profile && profile.picture) || '';
    if (picture) {
      pictureEl.src = picture;
      pictureEl.style.display = 'block';

      //画像ロードエラー時の処理
      pictureEl.onerror = function () {
        pictureEl.style.display = 'none';
      };
    } else {
      pictureEl.style.display = 'none';
      pictureEl.src = '';
    }
  }

  if (bannerEl) {
    const banner = (profile && profile.banner) || '';
    // 設定でバナー表示が有効か確認
    const showBanner = settingsManager.get('showProfileBanner') !== false;
    if (banner && showBanner) {
      bannerEl.src = banner;
      bannerEl.style.display = 'block';
      if (bannerContainerEl) bannerContainerEl.style.display = 'block';

      //画像ロードエラー時の処理
      bannerEl.onerror = function () {
        bannerEl.style.display = 'none';
        if (bannerContainerEl) bannerContainerEl.style.display = 'none';
      };
    } else {
      bannerEl.style.display = 'none';
      bannerEl.src = '';
      if (bannerContainerEl) bannerContainerEl.style.display = 'none';
    }
  }

  if (statsEl) {
    // 現状は未使用（フォロワー数など追加予定）
    statsEl.innerHTML = '';
    try {
      // タイムラインの kind ボタンと同様に kind:0 JSON ボタンを追加
      const timeSpan = document.createElement('span');
      timeSpan.className = 'profile-kind-time muted';
      timeSpan.style.marginRight = '8px';
      timeSpan.style.fontSize = '0.9em';
      timeSpan.textContent = '';

      const jsonBtn = document.createElement('button');
      jsonBtn.type = 'button';
      jsonBtn.className = 'btn-json btn-kind';
      jsonBtn.setAttribute('data-i18n-title', 'showJson');
      try { jsonBtn.title = t('showJson'); } catch (e) { }
      jsonBtn.textContent = t('kind') + ':0';
      jsonBtn.onclick = async function () {
        try {
          // この pubkey の最新 kind:0 イベント取得を試行
          const SimplePool = getSimplePool();
          if (!state.pool) relayConnect(state, SimplePool, () => { });
          const relays = getReadRelays(state.relays) || [];
          let ev = null;
          try {
            if (state.pool && relays && relays.length > 0) {
              ev = await state.pool.get(relays, { kinds: [0], authors: [pubkey], limit: 1 });
            }
          } catch (e) { ev = null; }
          if (ev) { showJsonModal(ev); return; }

          // フォールバック: キャッシュされたプロフィール情報から擬似JSONを表示
          const prof = state.profiles.get(pubkey) || null;
          if (prof) {
            const fake = { kind: 0, pubkey: pubkey, content: JSON.stringify(prof), tags: [] };
            showJsonModal(fake);
            return;
          }

          // イベントが見つからない
          try { alert(t('error.event_not_found')); } catch (e) { alert('Event not found'); }
        } catch (e) {
          console.warn('[Profile] kind:0 JSON 表示に失敗', e);
          try { alert(t('error.event_fetch_failed', { msg: (e && e.message) })); } catch (ee) { alert('Failed to fetch event'); }
        }
      };

      // 時刻とボタンを追加
      statsEl.appendChild(timeSpan);
      statsEl.appendChild(jsonBtn);

      // created_at 表示のため最新 kind:0 を非同期取得
      (async () => {
        try {
          const SimplePool = getSimplePool();
          if (!state.pool) relayConnect(state, SimplePool, () => { });
          const relays = getReadRelays(state.relays) || [];
          let ev = null;
          try {
            if (state.pool && relays && relays.length > 0) {
              ev = await state.pool.get(relays, { kinds: [0], authors: [pubkey], limit: 1 });
            }
          } catch (e) { ev = null; }
          if (ev && ev.created_at) {
            timeSpan.textContent = fmtTime(ev.created_at);
          } else {
            // イベントがなければ空表示、あればプロフィールのキャッシュ時刻を利用
            const prof = state.profiles.get(pubkey) || null;
            if (prof && prof.created_at) {
              timeSpan.textContent = fmtTime(prof.created_at);
            } else {
              timeSpan.textContent = '';
            }
          }
        } catch (e) { /* ignore */ }
      })();
    } catch (e) { }
  }

  // モーダル表示
  modal.hidden = false;
  // モーダルクローズ時に強制解除できるよう active unsubscribe を保持
  let activeUnsubs = [];
  let activeUnsubMore = [];

  // 最前面に持ってくる
  try {
    if (window.bringModalToFront) window.bringModalToFront(modal);
    else if (window.require && typeof window.require === 'function') {
      import('./main.js').then(mod => {
        if (mod.bringModalToFront) mod.bringModalToFront(modal);
      });
    }
  } catch (e) { }

  // =========================
  // 最新kind:1,6（設定により7を含む）イベント最大表示まで取得して表示
  // =========================
  const eventsContainer = document.getElementById('profileEvents');
  if (eventsContainer) {
    eventsContainer.innerHTML = '<div class="muted">' + t('loading') + '</div>';
    // メディアリンクハンドラをセットアップ
    import('./url-parser.js').then(mod => {
      if (mod.setupMediaLinkHandlers) mod.setupMediaLinkHandlers(eventsContainer);
    });

    // id で重複排除するため Map を使用
    const eventsMap = new Map();
    // 表示上限（最新イベント表示数）。初期は取得件数、追加読込ごとに増加し最大値まで
    let displayLimit = EVENTS_FETCH_LIMIT;
    let rendered = false;
    let loadingMore = false;

    // ---追加: リレー接続確認 ---
    if (!state.pool || !state.relays || !Array.isArray(state.relays) || state.relays.length === 0) {
      const SimplePool = getSimplePool();
      relayConnect(state, SimplePool, () => { });
    }

    // 重複排除済みイベントをソートし、表示上限を適用して返す
    function getSortedEventsArray() {
      const arr = Array.from(eventsMap.values());
      arr.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      return arr;
    }

    // 重複排除・ソート済みリストを displayLimit に従って描画
    function renderProfileEvents() {
      try {
        const sorted = getSortedEventsArray();
        const toDisplay = sorted.slice(0, Math.min(displayLimit, EVENTS_MAX));

        // main feed 同様に増分追加し、DOM全再構築とスクロール位置ズレを回避
        const existingEvents = Array.from(eventsContainer.querySelectorAll('.event'));
        if (existingEvents.length > 0 && toDisplay.length > 0) {
          const firstExistingId = existingEvents[0].dataset ? existingEvents[0].dataset.eventId : null;
          if (firstExistingId && toDisplay[0] && toDisplay[0].id === firstExistingId) {
            // 新規分のみ追加
            const startIdx = existingEvents.length;
            for (let i = startIdx; i < toDisplay.length; i++) {
              const node = renderEvent(state, toDisplay[i], nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent);
              const currentBottom = eventsContainer.querySelector('.feed-bar-bottom');
              if (currentBottom) eventsContainer.insertBefore(node, currentBottom);
              else eventsContainer.appendChild(node);
            }
            try { const existingBottom = eventsContainer.querySelector('.feed-bar-bottom'); if (existingBottom) existingBottom.remove(); } catch (e) { }
          } else {
            // 全体再構築
            const prevScroll = eventsContainer.scrollTop;
            eventsContainer.innerHTML = '';
            for (let i = 0; i < toDisplay.length; i++) {
              eventsContainer.appendChild(renderEvent(state, toDisplay[i], nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent));
            }
            try { eventsContainer.scrollTop = prevScroll; } catch (e) { }
          }
        } else {
          eventsContainer.innerHTML = '';
          for (let i = 0; i < toDisplay.length; i++) {
            eventsContainer.appendChild(renderEvent(state, toDisplay[i], nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent));
          }
        }
      } catch (e) {
        // エラー時は全体再構築にフォールバック
        eventsContainer.innerHTML = '';
        const sorted = getSortedEventsArray();
        const toDisplay = sorted.slice(0, Math.min(displayLimit, EVENTS_MAX));
        for (let i = 0; i < toDisplay.length; i++) {
          eventsContainer.appendChild(renderEvent(state, toDisplay[i], nip19, settings, settingsManager, reactToEvent, replyToEvent, repostEvent));
        }
      }

      // さらに表示可能な場合は「もっと読む」バーを追加
      try { const existingBottom = eventsContainer.querySelector('.feed-bar-bottom'); if (existingBottom) existingBottom.remove(); } catch (e) { }
      const sortedAll = getSortedEventsArray();
      if (sortedAll.length < EVENTS_MAX && displayLimit < EVENTS_MAX) {
        const bar = document.createElement('button');
        bar.type = 'button';
        bar.className = 'feed-bar feed-bar-bottom accent-center load-more-btn secondary';
        bar.setAttribute('data-i18n', 'feed.load_more');
        bar.textContent = t('feed.load_more');
        // ビューポートに入ったら一度だけ自動クリック
        try {
          if (typeof IntersectionObserver !== 'undefined') {
            const modalObserver = new IntersectionObserver((entries) => {
              entries.forEach(entry => {
                if (entry.isIntersecting) {
                  const target = entry.target;
                  try { modalObserver.unobserve(target); } catch (e) { }
                  if (target && typeof target.click === 'function') target.click();
                }
              });
            }, { root: null, rootMargin: '200px', threshold: 0.1 });
            modalObserver.observe(bar);
          }
        } catch (e) { }
        bar.onclick = () => {
          if (loadingMore) return;
          loadingMore = true;
          try { bar.textContent = t('loading'); } catch (e) { bar.textContent = 'Loading...'; }
          // 現在表示中の最古イベントを基準に until を計算
          const currentlyDisplayed = sortedAll.slice(0, Math.min(displayLimit, EVENTS_MAX));
          const lastDisplayed = currentlyDisplayed[currentlyDisplayed.length - 1];
          const until = lastDisplayed && lastDisplayed.created_at ? lastDisplayed.created_at : Math.floor(Date.now() / 1000);

          // relay ごとに取得
          const relays = getReadRelays(state.relays) || [];
          const perRelayTimeout = EVENTS_TIMEOUT; // ミリ秒（共通定数）
          const unsubs = [];
          let receivedCountMore = 0;

          return new Promise((resolve) => {
            if (!relays.length) {
              // フォールバック: 全 relay 一括で取得
              const unsubAll = subOnce(
                state,
                'profile_kinds_' + pubkey + '_more_all_' + until,
                [{ kinds: profileFeedKinds, authors: [pubkey], limit: EVENTS_FETCH_LIMIT, until: until - 1 }],
                (ev, relay) => {
                  try { if (ev && profileFeedKindSet.has(ev.kind) && ev.id) eventsMap.set(ev.id, ev); if (ev) receivedCountMore++; } catch (e) { }
                },
                getReadRelays(state.relays)
              );
              activeUnsubMore.push(unsubAll);
              setTimeout(() => {
                // 表示上限を fetch limit 分だけ増やす
                displayLimit = Math.min(displayLimit + EVENTS_FETCH_LIMIT, EVENTS_MAX);
                renderProfileEvents();
                loadingMore = false;
                try { if (typeof unsubAll === 'function') unsubAll(); } catch (e) { }
                resolve();
              }, perRelayTimeout);
              return;
            }

            const finishedRelaySet = new Set();
            let settled = false;

            const tryFinish = (relayKey) => {
              const key = relayKey || '__unknown__';
              if (finishedRelaySet.has(key)) return;
              finishedRelaySet.add(key);
              if (finishedRelaySet.size >= relays.length && !settled) {
                settled = true;
                // 表示上限を fetch limit 分だけ増やす
                displayLimit = Math.min(displayLimit + EVENTS_FETCH_LIMIT, EVENTS_MAX);
                renderProfileEvents();
                loadingMore = false;
                // 後始末
                unsubs.forEach(u => { try { if (typeof u === 'function') u(); } catch (e) { } });
                resolve();
              }
            };

            relays.forEach((relay) => {
              try {
                const key = 'profile_kinds_' + pubkey + '_more_' + relay + '_' + until + '_' + Math.random().toString(36).slice(2, 8);
                const unsub = subOnce(
                  state,
                  key,
                  [{ kinds: profileFeedKinds, authors: [pubkey], limit: EVENTS_FETCH_LIMIT, until: until - 1 }],
                  (ev, r, done) => {
                    try {
                      if (ev && profileFeedKindSet.has(ev.kind) && ev.id) {
                        eventsMap.set(ev.id, ev);
                      }
                      if (ev) receivedCountMore++;
                      if (done) {
                        tryFinish(relay);
                      }
                    } catch (e) { }
                  },
                  [relay]
                );
                unsubs.push(unsub);
                activeUnsubMore.push(unsub);
              } catch (e) { tryFinish(relay); }
            });

            // 安全用タイムアウト
            setTimeout(() => {
              if (!settled) {
                settled = true;
                displayLimit = Math.min(displayLimit + EVENTS_FETCH_LIMIT, EVENTS_MAX);
                renderProfileEvents();
                loadingMore = false;
                unsubs.forEach(u => { try { if (typeof u === 'function') u(); } catch (e) { } });
                resolve();
              }
            }, perRelayTimeout);
          }).then(() => { try { bar.textContent = t('feed.load_more'); } catch (e) { bar.textContent = 'Load more'; } });
        };
        eventsContainer.appendChild(bar);
      }
    }

    // relay ごとの取得を共通化したヘルパー
    function fetchAndMergePerRelays({ relays, limit = EVENTS_FETCH_LIMIT, until = null, timeout = EVENTS_TIMEOUT }) {
      return new Promise((resolve) => {
        if (!relays || !relays.length) {
          // フォールバック: 複数 relay への単一クエリ
          const unsubAll = subOnce(
            state,
            'profile_kinds_' + pubkey + '_fetch_all_' + Math.random().toString(36).slice(2, 8),
            until ? [{ kinds: profileFeedKinds, authors: [pubkey], limit: limit, until: until }] : [{ kinds: profileFeedKinds, authors: [pubkey], limit: limit }],
            (ev, r, done) => {
              try { if (ev && profileFeedKindSet.has(ev.kind) && ev.id) eventsMap.set(ev.id, ev); } catch (e) { }
              // done が来ない実装もあるため timeout 側で確定
            },
            getReadRelays(state.relays)
          );
          activeUnsubs.push(unsubAll);
          setTimeout(() => { try { if (typeof unsubAll === 'function') unsubAll(); } catch (e) { } resolve(); }, timeout);
          return;
        }

        const finishedRelaySet = new Set();
        let settled = false;
        const unsubs = [];

        const tryFinish = (relayKey) => {
          const key = relayKey || '__unknown__';
          if (finishedRelaySet.has(key)) return;
          finishedRelaySet.add(key);
          if (finishedRelaySet.size >= relays.length && !settled) {
            settled = true;
            // 完了
            unsubs.forEach(u => { try { if (typeof u === 'function') u(); } catch (e) { } });
            resolve();
          }
        };

        relays.forEach((relay) => {
          try {
            const key = 'profile_kinds_' + pubkey + '_fetch_' + relay + '_' + Math.random().toString(36).slice(2, 8);
            const unsub = subOnce(
              state,
              key,
              until ? [{ kinds: profileFeedKinds, authors: [pubkey], limit: limit, until: until }] : [{ kinds: profileFeedKinds, authors: [pubkey], limit: limit }],
              (ev, r, done) => {
                try {
                  if (ev && profileFeedKindSet.has(ev.kind) && ev.id) {
                    eventsMap.set(ev.id, ev);
                  }
                  if (done) {
                    tryFinish(relay);
                  }
                } catch (e) { }
              },
              [relay]
            );
            unsubs.push(unsub);
            activeUnsubs.push(unsub);
          } catch (e) { tryFinish(relay); }
        });

        // 安全用タイムアウト
        setTimeout(() => {
          if (!settled) {
            settled = true;
            unsubs.forEach(u => { try { if (typeof u === 'function') u(); } catch (e) { } });
            resolve();
          }
        }, timeout);
      });
    }

    // 初回取得（共通ヘルパーを使用）
    function fetchProfileEvents() {
      const relays = getReadRelays(state.relays) || [];
      const perRelayTimeout = EVENTS_TIMEOUT; // ミリ秒（共通定数）
      fetchAndMergePerRelays({ relays, limit: EVENTS_FETCH_LIMIT, until: null, timeout: perRelayTimeout }).then(() => {
        renderProfileEvents();
        rendered = true;
      });
    }
    fetchProfileEvents();
  }

  // 閉じるボタンセットアップ
  if (closeBtn) {
    closeBtn.onclick = function () {
      try { activeUnsubs.forEach(u => { try { if (typeof u === 'function') u(); } catch (e) { } }); } catch (e) { }
      try { activeUnsubMore.forEach(u => { try { if (typeof u === 'function') u(); } catch (e) { } }); } catch (e) { }
      activeUnsubs = [];
      activeUnsubMore = [];
      // 次回表示時の画像残留を防ぐためクリア
      try {
        const pic = document.getElementById('profilePicture');
        if (pic) {
          try { pic.src = ''; } catch (e) { }
          try { pic.style.display = 'none'; } catch (e) { }
          try { pic.onerror = null; } catch (e) { }
        }
        const ban = document.getElementById('profileBanner');
        if (ban) {
          try { ban.src = ''; } catch (e) { }
          try { ban.style.display = 'none'; } catch (e) { }
          try { ban.onerror = null; } catch (e) { }
        }
        const banC = document.getElementById('profileBannerContainer');
        if (banC) {
          try { banC.style.display = 'none'; } catch (e) { }
        }
      } catch (e) { }
      modal.hidden = true;
    };
  }

  // モーダル背景クリックで閉じる
  modal.onclick = function (e) {
    if (e.target === modal) {
      try { activeUnsubs.forEach(u => { try { if (typeof u === 'function') u(); } catch (e) { } }); } catch (e) { }
      try { activeUnsubMore.forEach(u => { try { if (typeof u === 'function') u(); } catch (e) { } }); } catch (e) { }
      activeUnsubs = [];
      activeUnsubMore = [];
      // 次回表示時の画像残留を防ぐためクリア
      try {
        const pic = document.getElementById('profilePicture');
        if (pic) {
          try { pic.src = ''; } catch (e) { }
          try { pic.style.display = 'none'; } catch (e) { }
          try { pic.onerror = null; } catch (e) { }
        }
        const ban = document.getElementById('profileBanner');
        if (ban) {
          try { ban.src = ''; } catch (e) { }
          try { ban.style.display = 'none'; } catch (e) { }
          try { ban.onerror = null; } catch (e) { }
        }
        const banC = document.getElementById('profileBannerContainer');
        if (banC) {
          try { banC.style.display = 'none'; } catch (e) { }
        }
      } catch (e) { }
      modal.hidden = true;
    }
  }
}

/**
 * プロフィールモーダルの閉じるボタンセットアップ
 */
export function setupProfileModalClose() {
  const modal = $('#profileModal');
  const closeBtn = $('#profileClose');

  if (closeBtn && modal) {
    closeBtn.onclick = function () {
      // モーダル再表示時の画像残留を防ぐためクリア
      try {
        const pic = document.getElementById('profilePicture');
        if (pic) {
          try { pic.src = ''; } catch (e) { }
          try { pic.style.display = 'none'; } catch (e) { }
          try { pic.onerror = null; } catch (e) { }
        }
        const ban = document.getElementById('profileBanner');
        if (ban) {
          try { ban.src = ''; } catch (e) { }
          try { ban.style.display = 'none'; } catch (e) { }
          try { ban.onerror = null; } catch (e) { }
        }
        const banC = document.getElementById('profileBannerContainer');
        if (banC) {
          try { banC.style.display = 'none'; } catch (e) { }
        }
      } catch (e) { }
      modal.hidden = true;
    };
  }
}
