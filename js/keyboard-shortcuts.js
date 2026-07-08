// ============================================================================
// キーボードショートカット管理
// ============================================================================

let _selectedEventEl = null;

export function getSelectedEventEl() {
  return _selectedEventEl;
}

export function setSelectedEventEl(el) {
  if (_selectedEventEl && _selectedEventEl.classList) _selectedEventEl.classList.remove('event-selected');
  _selectedEventEl = el || null;
  if (_selectedEventEl && _selectedEventEl.classList) {
    _selectedEventEl.classList.add('event-selected');
    if (typeof _selectedEventEl.scrollIntoView === 'function') {
      _selectedEventEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

export function setupKeyboardShortcuts(state, options) {
  const {
    nip19,
    reactToEvent,
    repostEvent,
    setReplyTarget,
    clearReplyTarget,
    findEventById,
    revealComposer,
    setQuoteTarget,
    showProfileModalProxy,
    bringModalToFront,
    $,
    $$
  } = options;

  function getTopShortcutModal() {
    try {
      const candidates = ['profileModal', 'eventModal']
        .map(id => document.getElementById(id))
        .filter(modal => modal && !modal.hidden);
      if (!candidates.length) return null;
      return candidates.reduce((top, current) => {
        if (!top) return current;
        const topZ = parseInt(window.getComputedStyle(top).zIndex, 10);
        const currentZ = parseInt(window.getComputedStyle(current).zIndex, 10);
        const safeTopZ = isNaN(topZ) ? 0 : topZ;
        const safeCurrentZ = isNaN(currentZ) ? 0 : currentZ;
        return safeCurrentZ >= safeTopZ ? current : top;
      }, null);
    } catch (e) { }
    return null;
  }

  function getVisibleEvents() {
    const topModal = getTopShortcutModal();
    if (topModal && topModal.id === 'eventModal') {
      return [topModal];
    }
    if (topModal && topModal.id === 'profileModal') {
      const profileEvents = document.getElementById('profileEvents');
      if (profileEvents) {
        return Array.from(profileEvents.querySelectorAll('.event')).filter(el =>
          el.style.display !== 'none' && !el.classList.contains('muted-hidden')
        );
      }
      return [];
    }
    const activeFeed = document.querySelector('.feed.active');
    if (!activeFeed) return [];
    return Array.from(activeFeed.querySelectorAll('.event')).filter(el =>
      el.style.display !== 'none' && !el.classList.contains('muted-hidden')
    );
  }

  function selectEvent(el) {
    setSelectedEventEl(el);
  }

  async function openEventDetailByReference(refEl) {
    // .nostr-quote（未解決の引用プレースホルダー）を含め、クリック可能な参照要素は
    // すべて click() に一本化する。取得・モーダル表示ロジックは url-parser.js の
    // attachQuoteRetryHandler / event-modal.js 側のハンドラーに集約済み。
    try {
      if (!refEl || typeof refEl.click !== 'function') return false;
      refEl.click();
      return true;
    } catch (e) { }
    return false;
  }

  async function openSelectedReferencedEvent() {
    try {
      if (!_selectedEventEl) return false;
      const refEl = _selectedEventEl.querySelector('.reply-to-author[data-event-id], .reply-to-content[data-event-id], .event-quote-content[data-event-id], .nostr-quote[data-event-id], .nostr-quote[data-naddr-kind]');
      if (!refEl) return false;
      return await openEventDetailByReference(refEl);
    } catch (e) { }
    return false;
  }

  async function openSelectedAuthorProfile() {
    try {
      if (!_selectedEventEl) return false;
      const nameEl = _selectedEventEl.querySelector('.name[data-pubkey]');
      const pubkey = nameEl && nameEl.dataset ? nameEl.dataset.pubkey : (_selectedEventEl.dataset ? _selectedEventEl.dataset.pubkey : null);
      if (!pubkey) return false;
      showProfileModalProxy(pubkey);
      return true;
    } catch (e) { }
    return false;
  }

  function syncSelectionToVisibleContext() {
    try {
      const visible = getVisibleEvents();
      if (!visible.length) {
        selectEvent(null);
        return;
      }
      const topModal = getTopShortcutModal();
      if (topModal && topModal.id === 'eventModal') {
        if (_selectedEventEl !== topModal) selectEvent(topModal);
        return;
      }
      if (!_selectedEventEl || !visible.includes(_selectedEventEl)) {
        selectEvent(visible[0]);
      }
    } catch (e) { }
  }

  function closeShortcutTargetModals() {
    try {
      const eventModal = document.getElementById('eventModal');
      if (eventModal && !eventModal.hidden) {
        try { window.__nokakoiEventModalEvent = null; } catch (e) { }
        eventModal.hidden = true;
      }
    } catch (e) { }
    try {
      const profileModal = document.getElementById('profileModal');
      if (profileModal && !profileModal.hidden) {
        profileModal.hidden = true;
      }
    } catch (e) { }
  }

  function revealComposerForShortcut() {
    try {
      return revealComposer();
    } catch (e) { }
    return null;
  }

  function focusComposerInputForShortcut() {
    try {
      const composer = revealComposerForShortcut();
      if (!composer) return null;
      const ni = $('#noteInput');
      if (!ni) return null;
      ni.focus();
      return ni;
    } catch (e) { }
    return null;
  }

  function getShortcutQuoteTarget() {
    try {
      const eventModal = document.getElementById('eventModal');
      if (eventModal && !eventModal.hidden) {
        return window.__nokakoiEventModalEvent || null;
      }
      if (!_selectedEventEl) return null;
      const eventId = _selectedEventEl.dataset ? _selectedEventEl.dataset.eventId : null;
      if (!eventId) return null;
      return findEventById(state, eventId) || null;
    } catch (e) { }
    return null;
  }

  // タブ切り替え時に選択をリセット（フィードdivのclass変更のみ監視）
  try {
    const feedDivs = document.querySelectorAll('#feeds > .feed');
    const tabObserver = new MutationObserver(() => {
      if (_selectedEventEl && !_selectedEventEl.closest('.feed.active')) {
        selectEvent(null);
      }
    });
    feedDivs.forEach(fd => tabObserver.observe(fd, { attributes: true, attributeFilter: ['class'] }));
  } catch (e) { }

  document.addEventListener('keydown', (e) => {
    // ESCキー: 投稿窓からフォーカスを外し、返信/引用を解除（入力中でも動作）
    if (e.key === 'Escape') {
      const ni = $('#noteInput');
      if (ni && document.activeElement === ni) {
        e.preventDefault();
        ni.blur();
        clearReplyTarget();
        return;
      }
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable)) return;
    const visibleModals = Array.from(document.querySelectorAll('.modal:not([hidden])'));
    if (visibleModals.some(modal => modal.id !== 'profileModal' && modal.id !== 'eventModal')) return;
    const isNavKey = e.key === 'w' || e.key === 'W' || e.key === 's' || e.key === 'S';
    const eventsBeforeSync = isNavKey ? getVisibleEvents() : null;
    const hadValidSelectionBeforeSync = !!(eventsBeforeSync && _selectedEventEl && eventsBeforeSync.includes(_selectedEventEl));
    if (!isNavKey) syncSelectionToVisibleContext();

    // N/Cキー: 投稿欄にフォーカス
    if (e.key === 'n' || e.key === 'N' || e.key === 'c' || e.key === 'C') {
      const composer = $('#composer');
      if (!composer || composer.hidden) return;
      if (composer.dataset && composer.dataset._settingsHidden) return;
      e.preventDefault();
      closeShortcutTargetModals();
      focusComposerInputForShortcut();
      return;
    }

    // Rキー: ソフトリロード
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      try {
        if (typeof window.softReload === 'function') {
          window.softReload();
        } else {
          window.dispatchEvent(new CustomEvent('softReloadRequest'));
        }
      } catch (ex) { }
      try {
        const tabs = Array.from(document.querySelectorAll('.tab'));
        if (tabs && tabs.length) {
          const activeIdx = tabs.findIndex(t => t.classList.contains('active'));
          const srcTab = tabs[activeIdx >= 0 ? activeIdx : 0];
          if (srcTab) srcTab.click();
        }
      } catch (ex) { }
      return;
    }

    // Aキー: 左隣のタブを選択
    if (e.key === 'a' || e.key === 'A') {
      const tabs = Array.from(document.querySelectorAll('.tab'));
      if (tabs.length > 1) {
        const activeIdx = tabs.findIndex(t => t.classList.contains('active'));
        const prevIdx = activeIdx > 0 ? activeIdx - 1 : tabs.length - 1;
        e.preventDefault();
        tabs[prevIdx].click();
      }
      return;
    }

    // Dキー: 右隣のタブを選択
    if (e.key === 'd' || e.key === 'D') {
      const tabs = Array.from(document.querySelectorAll('.tab'));
      if (tabs.length > 1) {
        const activeIdx = tabs.findIndex(t => t.classList.contains('active'));
        const nextIdx = activeIdx < tabs.length - 1 ? activeIdx + 1 : 0;
        e.preventDefault();
        tabs[nextIdx].click();
      }
      return;
    }

    // Wキー: フィード内の投稿を上に移動 / Shift+W: 最上部を選択
    if (e.key === 'w' || e.key === 'W') {
      const events = getVisibleEvents();
      if (!events.length) return;
      e.preventDefault();
      if (e.shiftKey) {
        selectEvent(events[0]);
      } else if (!hadValidSelectionBeforeSync) {
        selectEvent(events[0]);
      } else if (!events.includes(_selectedEventEl)) {
        selectEvent(events[0]);
      } else {
        const idx = events.indexOf(_selectedEventEl);
        if (idx > 0) selectEvent(events[idx - 1]);
      }
      return;
    }

    // Sキー: フィード内の投稿を下に移動 / Shift+S: 最下部を選択
    if (e.key === 's' || e.key === 'S') {
      const events = getVisibleEvents();
      if (!events.length) return;
      e.preventDefault();
      if (e.shiftKey) {
        selectEvent(events[events.length - 1]);
      } else if (!hadValidSelectionBeforeSync) {
        selectEvent(events[0]);
      } else if (!events.includes(_selectedEventEl)) {
        selectEvent(events[0]);
      } else {
        const idx = events.indexOf(_selectedEventEl);
        if (idx < events.length - 1) selectEvent(events[idx + 1]);
      }
      return;
    }

    // Fキー: 選択中の投稿にリアクション
    if (e.key === 'f' || e.key === 'F') {
      if (!_selectedEventEl) return;
      const btn = _selectedEventEl.querySelector('.btn-react');
      if (btn) { e.preventDefault(); btn.click(); }
      return;
    }

    // Qキー: 選択中の投稿を引用
    if (e.key === 'q' || e.key === 'Q') {
      const quoteTarget = getShortcutQuoteTarget();
      if (!quoteTarget) return;
      e.preventDefault();
      closeShortcutTargetModals();
      revealComposerForShortcut();
      try { setQuoteTarget(state, quoteTarget, nip19); window.__nokakoiQuoteMode = true; } catch (ex) { }
      focusComposerInputForShortcut();
      return;
    }

    // Bキー: 選択中の投稿をリポスト
    if (e.key === 'b' || e.key === 'B') {
      if (!_selectedEventEl) return;
      const btn = _selectedEventEl.querySelector('.btn-repost');
      if (btn) { e.preventDefault(); btn.click(); }
      return;
    }

    // Eキー: 選択中の投稿に返信
    if (e.key === 'e' || e.key === 'E') {
      if (!_selectedEventEl) return;
      const btn = _selectedEventEl.querySelector('.btn-reply');
      if (btn) { e.preventDefault(); btn.click(); }
      return;
    }

    // Vキー: 選択中の投稿の最上部参照先をイベント詳細で開く
    if (e.key === 'v' || e.key === 'V') {
      if (!_selectedEventEl) return;
      e.preventDefault();
      openSelectedReferencedEvent();
      return;
    }

    // Gキー: 選択中の投稿者のプロフィールを開く
    if (e.key === 'g' || e.key === 'G') {
      if (!_selectedEventEl) return;
      e.preventDefault();
      openSelectedAuthorProfile();
      return;
    }

    // Xキー: 選択中の投稿をlumilumiで開く
    if (e.key === 'x' || e.key === 'X') {
      if (!_selectedEventEl) return;
      e.preventDefault();
      const eventId = _selectedEventEl.dataset ? _selectedEventEl.dataset.eventId : null;
      if (!eventId) return;
      try {
        const nip19 = options.getNip19();
        let nevent = null;
        if (nip19) {
          try {
            if (nip19.neventEncode && typeof nip19.neventEncode === 'function') {
              nevent = nip19.neventEncode({ id: eventId, relays: [] });
            } else if (nip19.nevent && typeof nip19.nevent.encode === 'function') {
              nevent = nip19.nevent.encode({ id: eventId, relays: [] });
            }
          } catch (ex) { }
        }
        if (!nevent) nevent = 'nevent1' + eventId;
        window.open('https://lumilumi.app/' + nevent, '_blank', 'noopener,noreferrer');
      } catch (ex) { }
      return;
    }
  });
}
