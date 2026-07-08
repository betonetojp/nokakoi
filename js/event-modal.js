// ============================================================================
// 単一イベント詳細モーダル表示
// ============================================================================

import { escapeHtml, fmtTime, processHiddenTagChars, replaceBadgeEmoji } from './utils.js';
import { displayNameWithUsername } from './profile.js';
import { showJsonModal } from './json-modal.js';
import { linkifyText, fitCustomEmoji, updateNostrNpubLinks, updateNostrNoteLinks, linkifyNostrUri } from './url-parser.js';
import { parseMarkdownSafe } from './markdown.js';
import { setupReactButton, setupRepostButton, setupReplyButton, renderReplyContext, applyClientBadgeToContainer } from './renderer.js';
import { findEventById } from './state.js';
import { getNip19 as getNip19Compat } from './nostr-compat.js';
import { t } from './i18n.js';

/**
 * イベント詳細モーダルを表示（タイムラインのkind:1表示と同じレイアウト・アクション）
 */
export function showEventModal(event, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager) {
  // フォールバックでグローバルstate/nip19を使う
  if (!state) state = window.__nostrState;
  if (!nip19) nip19 = getNip19Compat() || null;
  try { window.__nokakoiEventModalEvent = event || null; } catch (e) { }

  async function openReferencedEventById(eventId) {
    try {
      if (!eventId || !state) return;
      const cached = findEventById(state, eventId);
      if (cached) {
        showEventModal(cached, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
        return;
      }
      if (!state.pool) return;
      const { getReadRelays } = await import('./relay.js');
      const relays = getReadRelays(state.relays);
      if (!relays || relays.length === 0) return;
      const fetched = await state.pool.get(relays, { ids: [eventId] });
      if (fetched) {
        showEventModal(fetched, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
      }
    } catch (e) { }
  }

  function openProfileByPubkey(pubkey) {
    try {
      if (!pubkey) return;
      if (window && typeof window.showProfileModalProxy === 'function') window.showProfileModalProxy(pubkey);
      else import('./main.js').then(mod => { if (mod.showProfileModalProxy) mod.showProfileModalProxy(pubkey); }).catch(() => { });
    } catch (e) { }
  }

  function attachReplyPreviewHandlers(root) {
    try {
      if (!root) return;

      const replyAuthorEls = root.querySelectorAll('.reply-to-author[data-pubkey], .reply-to-author[data-event-id]');
      replyAuthorEls.forEach(el => {
        el.onclick = function (e) {
          e.stopPropagation();
          const pubkey = el.getAttribute('data-pubkey');
          if (pubkey) {
            openProfileByPubkey(pubkey);
            return;
          }
          const eventId = el.getAttribute('data-event-id');
          if (eventId) {
            openReferencedEventById(eventId);
          }
        };
      });

      const replyContentEls = root.querySelectorAll('.reply-to-content[data-event-id]');
      replyContentEls.forEach(el => {
        el.onclick = function (e) {
          try {
            const a = e.target.closest('a');
            if (a) return;
            const btn = e.target.classList.contains('open-media') ? e.target : e.target.closest('.open-media');
            if (btn) return;
            const link = e.target.classList.contains('media-link') ? e.target : e.target.closest('.media-link');
            if (link) return;
          } catch (err) { }
          e.stopPropagation();
          const eventId = el.getAttribute('data-event-id');
          if (eventId) openReferencedEventById(eventId);
        };
      });
    } catch (e) { }
  }

  function normalizeNostrUrisInMarkdownRoot(root) {
    try {
      if (!root) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);

      const nostrUriRegex = /(nostr:(npub|note|nprofile|nevent|naddr|nsec)[a-z0-9]+)/gi;
      for (const textNode of textNodes) {
        try {
          const txt = textNode && typeof textNode.nodeValue === 'string' ? textNode.nodeValue : '';
          if (!txt || !nostrUriRegex.test(txt)) continue;
          nostrUriRegex.lastIndex = 0;
          const html = txt.replace(nostrUriRegex, (m) => {
            try { return linkifyNostrUri(m); } catch (e) { return m; }
          });
          const frag = document.createElement('span');
          frag.innerHTML = html;
          textNode.parentNode.replaceChild(frag, textNode);
        } catch (e) { }
      }

      const anchorEls = root.querySelectorAll('a[href^="nostr:"]');
      anchorEls.forEach((a) => {
        try {
          const href = a.getAttribute('href') || '';
          if (!href) return;
          const span = document.createElement('span');
          span.innerHTML = linkifyNostrUri(href);
          const replacement = span.firstChild;
          if (replacement) a.parentNode.replaceChild(replacement, a);
        } catch (e) { }
      });
    } catch (e) { }
  }

  const modal = document.getElementById('eventModal');
  if (!modal) return;
  try { modal.dataset.eventId = event && event.id ? event.id : ''; } catch (e) { }
  try { modal.dataset.pubkey = event && event.pubkey ? event.pubkey : ''; } catch (e) { }

  // アバター・名前・ユーザー名
  const authorWrap = modal.querySelector('#eventModalAuthorWrap');
  if (authorWrap) {
    authorWrap.innerHTML = '';
    let avatarHtml = '';
    if (state && event.pubkey) {
      const profile = state.profiles.get(event.pubkey);
      const avatarUrl = (profile && profile.picture) || '';
      if (avatarUrl) {
        avatarHtml = '<img src="' + escapeHtml(avatarUrl) + '" alt="avatar" class="avatar" style="width:32px;height:32px;border-radius:50%;object-fit:cover;background:var(--border);margin-right:6px;">';
      }
    }
    // kind:20000 はタイムライン表示と同じく n タグ優先、空なら pubkey 末尾ハッシュを即時表示
    let names;
    if (event && event.kind === 20000) {
      const pk = event.pubkey || '';
      const hash = (pk && pk.length >= 4) ? '#' + pk.slice(-4) : '';
      const nTag = Array.isArray(event.tags) ? event.tags.find(t => t && t[0] === 'n') : null;
      const nName = (nTag && nTag[1]) ? String(nTag[1]).trim() : '';
      if (nName) {
        names = { main: nName, sub: hash };
      } else {
        names = { main: hash, sub: '' };
      }
    } else {
      names = event.pubkey && state ? displayNameWithUsername(state, event.pubkey, nip19) : { main: event.pubkey, sub: '' };
    }
    let nameHtml = '<span class="name" data-pubkey="' + escapeHtml(event.pubkey || '') + '" style="font-weight:600;font-size:0.95em;color:var(--accent);cursor:pointer;">' + replaceBadgeEmoji(escapeHtml(names.main)) + '</span>';
    if (names.sub) {
      nameHtml += '<span class="username" style="font-weight:400;font-size:0.85em;color:var(--muted);margin-left:4px;">@' + escapeHtml(names.sub) + '</span>';
    }
    authorWrap.innerHTML = avatarHtml + nameHtml;
    // 名前クリックでプロフィールモーダル
    const nameEl = authorWrap.querySelector('.name');
    if (nameEl && event.pubkey) {
      nameEl.onclick = function () {
        try {
          if (window && typeof window.showProfileModalProxy === 'function') window.showProfileModalProxy(event.pubkey);
          else import('./main.js').then(mod => { if (mod.showProfileModalProxy) mod.showProfileModalProxy(event.pubkey); }).catch(() => { });
        } catch (e) { }
      };
    }
  }

  // 返信先表示（タイムラインと同じ）
  const contentEl = modal.querySelector('#eventModalContent');
  if (contentEl) {
    // 返信イベント/リアクション/リポストなら参照先を表示
    let replyHtml = '';
    if ((event.kind === 1 || event.kind === 7 || event.kind === 6 || event.kind === 16) && Array.isArray(event.tags)) {
      const hasReplyTag = event.tags.some(t => t && t[0] === 'e' && t[1]);
      if (hasReplyTag && typeof renderReplyContext === 'function') {
        replyHtml = renderReplyContext(state, event, nip19, { isModal: true });
      }
    }
    // kind:30023のみマークダウン解釈（==で型を許容）
    console.log('[EventModal] event.kind を確認', event.kind, typeof event.kind);
    if (event.kind == 30023) {
      parseMarkdownSafe(event.content || '').then(html => {
        contentEl.innerHTML = (replyHtml ? replyHtml : '') + html;
        normalizeNostrUrisInMarkdownRoot(contentEl);
        attachReplyPreviewHandlers(contentEl);
        // メディアリンクハンドラをセットアップ
        import('./url-parser.js').then(mod => {
          if (mod.setupMediaLinkHandlers) mod.setupMediaLinkHandlers(contentEl);
        });
        // npub/neventリンク解決
        try {
          try { updateNostrNpubLinks(contentEl); } catch (e) { }
          try {
            updateNostrNoteLinks(contentEl, showEventModal, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
          } catch (e) { }
        } catch (e) { }
        try { processHiddenTagChars(contentEl); } catch (e) { }
        // カスタム絵文字
        try { if (typeof fitCustomEmoji === 'function') fitCustomEmoji(contentEl, 28); } catch (e) { }
      });
    } else {
      // event.tags を linkifyText に渡し、絵文字ショートコードを画像へ置換
      contentEl.innerHTML = (replyHtml ? replyHtml : '') + linkifyText(event.content || '', event.tags || []);
      attachReplyPreviewHandlers(contentEl);
      // メディアリンクハンドラをセットアップ
      import('./url-parser.js').then(mod => {
        if (mod.setupMediaLinkHandlers) mod.setupMediaLinkHandlers(contentEl);
      });

      // reply 領域内の npub/nevent リンクを解決し、表示名と引用イベントを描画
      try {
        try { updateNostrNpubLinks(contentEl); } catch (e) { }
        try {
          updateNostrNoteLinks(contentEl, showEventModal, state, nip19, reactToEvent, replyToEvent, repostEvent, settings, settingsManager);
        } catch (e) { }
      } catch (e) { }
      try { processHiddenTagChars(contentEl); } catch (e) { }

      // モーダル内でも custom emoji のサイズ調整を適用
      try { if (typeof fitCustomEmoji === 'function') fitCustomEmoji(contentEl, 28); } catch (e) { }
    }
  }

  // 日時
  const timeEl = modal.querySelector('#eventModalTime');
  timeEl.textContent = event.created_at ? fmtTime(event.created_at) : '';

  // 古いクライアント名バッジがあれば削除
  try {
    const existingBadges = modal.querySelectorAll('.client-badge');
    existingBadges.forEach(b => b.remove());
  } catch (e) { }

  // kind（ボタンスタイル）
  const kindEl = modal.querySelector('#eventModalKind');
  kindEl.textContent = 'kind: ' + (event.kind ?? '');

  // クライアント名表示設定が有効かつイベントに client タグが存在する場合にバッジを生成
  try {
    const showClientName = !settings || settings.showClientName !== false;
    if (showClientName) {
      const clientTag = (event.tags || []).find(t => t && t[0] === 'client' && t[1]);
      if (clientTag) {
        const clientName = clientTag[1];
        if (kindEl && kindEl.parentNode) {
          const span = document.createElement('span');
          span.className = 'client-badge';
          span.setAttribute('data-client', clientName);
          kindEl.parentNode.insertBefore(span, kindEl.nextSibling);
          if (typeof applyClientBadgeToContainer === 'function') {
            applyClientBadgeToContainer(modal);
          }
        }
      }
    }
  } catch (e) { }

  // クリックでJSONモーダル、長押し/右クリックでlumilumi
  let longPressTimer = null;
  let longPressTriggered = false;
  let suppressClickUntil = 0;

  // モバイル長押しでlumilumiを開く
  kindEl.addEventListener('touchstart', function (e) {
    longPressTriggered = false;
    try { if (longPressTimer) clearTimeout(longPressTimer); } catch { }

    longPressTimer = setTimeout(function () {
      longPressTriggered = true;
      try { e.preventDefault(); } catch { }

      // 確認ダイアログを表示
      import('./modals.js').then(mod => {
        if (mod.showConfirmModal) {
          import('./i18n.js').then(i18nMod => {
            const t = i18nMod.t || ((k) => k);
            mod.showConfirmModal(
              '',
              t('lumilumi.confirm'),
              () => {
                try {
                  let nevent = null;
                  if (nip19) {
                    try {
                      if (nip19.neventEncode && typeof nip19.neventEncode === 'function') {
                        nevent = nip19.neventEncode({ id: event.id, relays: [] });
                      } else if (nip19.nevent && typeof nip19.nevent.encode === 'function') {
                        nevent = nip19.nevent.encode({ id: event.id, relays: [] });
                      }
                    } catch (ex) { }
                  }
                  if (!nevent) nevent = 'nevent1' + event.id;
                  window.open('https://lumilumi.app/' + nevent, '_blank', 'noopener,noreferrer');
                } catch (ex) { }
              }
            );
          });
        }
      });

      suppressClickUntil = Date.now() + 700;
    }, 600);
  }, { passive: false });

  const cancelLongPress = function () {
    try { if (longPressTimer) clearTimeout(longPressTimer); } catch { }
    longPressTimer = null;
  };

  kindEl.addEventListener('touchend', function (e) {
    const wasTriggered = longPressTriggered;
    cancelLongPress();
    if (wasTriggered) {
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch { }
      return false;
    }
  }, { passive: false });

  kindEl.addEventListener('touchmove', cancelLongPress, { passive: true });
  kindEl.addEventListener('touchcancel', cancelLongPress, { passive: true });

  kindEl.onclick = function () {
    if (Date.now() < suppressClickUntil) return;
    showJsonModal(event);
  };

  // 右クリックでlumilumiで開く確認ダイアログ
  kindEl.oncontextmenu = function (e) {
    e.preventDefault();
    import('./modals.js').then(mod => {
      if (mod.showConfirmModal) {
        import('./i18n.js').then(i18nMod => {
          const t = i18nMod.t || ((k) => k);
          mod.showConfirmModal(
            '',
            t('lumilumi.confirm'),
            () => {
              try {
                let nevent = null;
                if (nip19) {
                  try {
                    if (nip19.neventEncode && typeof nip19.neventEncode === 'function') {
                      nevent = nip19.neventEncode({ id: event.id, relays: [] });
                    } else if (nip19.nevent && typeof nip19.nevent.encode === 'function') {
                      nevent = nip19.nevent.encode({ id: event.id, relays: [] });
                    }
                  } catch (ex) { }
                }
                if (!nevent) nevent = 'nevent1' + event.id;
                window.open('https://lumilumi.app/' + nevent, '_blank', 'noopener,noreferrer');
              } catch (ex) { }
            }
          );
        });
      }
    });
    return false;
  };

  // タイムラインと同じボタン配置・動作
  // リアクション（名前右）
  const reactWrap = modal.querySelector('#eventModalReactWrap');
  if (reactWrap) {
    reactWrap.innerHTML = '<button class="btn-react" type="button" title="' + escapeHtml(t('reaction.button.title')) + '"><img src="icon/star.png" alt="' + escapeHtml(t('reaction.button.title')) + '" class="icon-btn"></button>';
    // setupReactButton は renderer.js から export 済みである必要がある
    if (typeof setupReactButton === 'function') {
      setupReactButton(modal, event, settings, settingsManager, reactToEvent);
    }
  }
  // リポスト・返信（下部右）
  const actionsBottom = modal.querySelector('#eventModalActionsBottom');
  if (actionsBottom) {
    const isKind1 = Number(event && event.kind) === 1;
    actionsBottom.style.display = isKind1 ? '' : 'none';
    if (isKind1) {
      actionsBottom.innerHTML = '<button class="btn-repost" type="button" title="' + escapeHtml(t('repost')) + '"><img src="icon/repost.png" alt="' + escapeHtml(t('repost')) + '" class="icon-btn"></button>' +
        '<button class="btn-reply" type="button" title="' + escapeHtml(t('reply')) + '"><img src="icon/reply.png" alt="' + escapeHtml(t('reply')) + '" class="icon-btn"></button>';
      setupRepostButton(modal, event, repostEvent);
      // 返信ボタン: モーダルを閉じてからreplyToEventを呼ぶ
      const replyBtn = actionsBottom.querySelector('.btn-reply');
      if (replyBtn && typeof replyToEvent === 'function') {
        replyBtn.onclick = function () {
          modal.hidden = true;
          replyToEvent(event);
        };
      } else {
        setupReplyButton(modal, event, replyToEvent);
      }
    } else {
      actionsBottom.innerHTML = '';
    }
  }

  // モーダル表示
  modal.hidden = false;
  // 最前面に持ってくる
  try {
    if (window.bringModalToFront) window.bringModalToFront(modal);
    else if (window.require && typeof window.require === 'function') {
      // 万一ESMでwindowに無い場合
      import('./main.js').then(mod => {
        if (mod.bringModalToFront) mod.bringModalToFront(modal);
      });
    }
  } catch (e) { }

  // 閉じるボタン
  const closeBtn = modal.querySelector('#eventModalClose');
  closeBtn.onclick = () => {
    try { window.__nokakoiEventModalEvent = null; } catch (e) { }
    modal.hidden = true;
  };

  // モーダル外クリックで閉じる
  function handleOutsideClick(e) {
    if (e.target === modal) {
      try { window.__nokakoiEventModalEvent = null; } catch (e2) { }
      modal.hidden = true;
    }
  }
  modal.addEventListener('mousedown', handleOutsideClick);
  // 表示時のみ有効、閉じたら解除
  function removeOutsideClick() {
    modal.removeEventListener('mousedown', handleOutsideClick);
  }
  modal.addEventListener('transitionend', function () {
    if (modal.hidden) removeOutsideClick();
  });
}
