import { escapeHtml, replaceBadgeEmoji } from '../../utils/utils.js';
import { t } from '../../utils/i18n.js';
import { getNip19 } from '../../core/nostr-compat.js';
import { displayName, isAvatarsEnabled } from '../profile/profile.js';
import { findEventById } from '../../core/state.js';
import { extractQuotes } from './composer-nostr-preview.js';

export function ensureHexPubkey(pk) {
  if (!pk || typeof pk !== 'string') return null;
  const clean = pk.trim();
  if (/^[0-9a-f]{64}$/i.test(clean)) return clean.toLowerCase();
  if (clean.startsWith('npub1')) {
    try {
      const nip19 = getNip19();
      if (nip19 && typeof nip19.decode === 'function') {
        const decoded = nip19.decode(clean);
        if (decoded && decoded.type === 'npub' && decoded.data) {
          return decoded.data;
        }
      }
    } catch (_e) {}
  }
  return null;
}

/**
 * 返信先イベントから通知対象（pタグ候補）を抽出
 * - author: 返信先イベントの作成者（当人。外せない・active: true）
 * - others: 返信先イベントの p タグや root 投稿者（外せる・初期値 active: false）
 */
export function extractReplyRecipients(state, targetEv) {
  if (!targetEv || typeof targetEv !== 'object') {
    return { author: null, others: [] };
  }

  const effectiveState = (typeof window !== 'undefined' && window.__nostrState) ? window.__nostrState : state;
  const targetAuthorPk = ensureHexPubkey(targetEv.pubkey);
  if (!targetAuthorPk) {
    return { author: null, others: [] };
  }

  const myPubkey = ensureHexPubkey(
    (effectiveState && effectiveState.pubkey) ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : '') ||
    ''
  );

  const isMentionETag = (t) => Array.isArray(t) && (t[3] === 'mention' || t[4] === 'mention' || t[2] === 'mention');
  const parentETags = (targetEv.tags || []).filter(t => Array.isArray(t) && t[0] === 'e' && t[1] && !isMentionETag(t));
  let rootId = null;
  let rootTagPubkey = null;
  if (parentETags.length > 0) {
    const rootTag = parentETags.find(t => t[3] === 'root' || t[4] === 'root');
    const picked = rootTag || parentETags[0];
    if (picked && picked[1] !== targetEv.id) {
      rootId = picked[1];
      rootTagPubkey = ensureHexPubkey(picked[4] || (picked[3] !== 'root' && picked[3] !== 'reply' ? picked[3] : ''));
    }
  }

  const seenPTags = new Set();
  seenPTags.add(targetAuthorPk);
  if (myPubkey) seenPTags.add(myPubkey);

  const others = [];

  // 1. targetEv に含まれる p タグ
  for (const t of (targetEv.tags || [])) {
    if (!Array.isArray(t) || t[0] !== 'p' || !t[1]) continue;
    const pk = ensureHexPubkey(t[1]);
    if (!pk || seenPTags.has(pk)) continue;
    seenPTags.add(pk);
    others.push({
      pubkey: pk,
      relayHint: t[2] || '',
      isAuthor: false,
      isQuote: false,
      active: false // デフォルト通知オフ
    });
  }

  // 2. rootId がある場合、root 投稿者の pubkey
  if (rootId && rootId !== targetEv.id) {
    let resolvedRootPk = null;
    try {
      const rootEv = findEventById(effectiveState, rootId);
      resolvedRootPk = ensureHexPubkey((rootEv && rootEv.pubkey) || rootTagPubkey || '');
    } catch (_e) {
      resolvedRootPk = rootTagPubkey;
    }
    if (resolvedRootPk && !seenPTags.has(resolvedRootPk)) {
      seenPTags.add(resolvedRootPk);
      others.push({
        pubkey: resolvedRootPk,
        relayHint: '',
        isAuthor: false,
        isQuote: false,
        active: false // デフォルト通知オフ
      });
    }
  }

  const author = {
    pubkey: targetAuthorPk,
    relayHint: '',
    isAuthor: true,
    isQuote: false,
    active: true // 返信先当人は外せない
  };

  return { author, others };
}

/**
 * 引用対象から通知対象（pタグ候補）を抽出
 * - 引用モード時の引用先（targetEv.pubkey）
 * - 本文中の引用（nostr:nevent / nostr:note）の作成者
 * すべて外せる・初期値 active: false（デフォルト通知オフ）
 */
export function extractQuoteRecipients(state, targetEv, text = '', isQuoteMode = false, existingPubkeys = new Set(), nip19 = null) {
  const effectiveState = (typeof window !== 'undefined' && window.__nostrState) ? window.__nostrState : state;
  const myPubkey = ensureHexPubkey(
    (effectiveState && effectiveState.pubkey) ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('pubkey') : '') ||
    ''
  );

  const quotes = [];
  const seenPubkeys = new Set(existingPubkeys);
  if (myPubkey) seenPubkeys.add(myPubkey);

  // 1. 引用モード時の引用対象
  if (isQuoteMode && targetEv && targetEv.pubkey) {
    const pk = ensureHexPubkey(targetEv.pubkey);
    if (pk && !seenPubkeys.has(pk)) {
      seenPubkeys.add(pk);
      quotes.push({
        pubkey: pk,
        relayHint: '',
        isAuthor: false,
        isQuote: true,
        active: false
      });
    }
  }

  // 2. 本文中の引用 (nostr:nevent / nostr:note)
  if (text && typeof text === 'string') {
    const nip19Local = nip19 || getNip19();
    const extracted = extractQuotes(text, nip19Local);
    for (const q of extracted) {
      let pk = ensureHexPubkey(q.author);
      if (!pk && q.eventId) {
        try {
          const ev = findEventById(effectiveState, q.eventId);
          if (ev && ev.pubkey) {
            pk = ensureHexPubkey(ev.pubkey);
          }
        } catch (_e) {}
      }
      if (pk && !seenPubkeys.has(pk)) {
        seenPubkeys.add(pk);
        quotes.push({
          pubkey: pk,
          relayHint: (q.relays && q.relays[0]) || '',
          isAuthor: false,
          isQuote: true,
          active: false
        });
      }
    }
  }

  return quotes;
}

export class ReplyRecipientsManager {
  constructor() {
    this.container = null;
    this.chipsContainer = null;
    this.state = null;
    this.nip19 = null;
    this.targetEv = null;
    this.isQuoteMode = false;
    this.author = null;
    this.others = [];
    this.quotes = [];
    this.activePubkeys = new Set();
    this.profileTimer = null;
  }

  init(containerEl) {
    this.container = containerEl || (typeof document !== 'undefined' ? document.getElementById('replyRecipients') : null);
    if (this.container) {
      this.chipsContainer = this.container.querySelector('.reply-recipients-chips') ||
                            (typeof document !== 'undefined' ? document.getElementById('replyRecipientsChips') : null);
    }
    if (!this._hasBoundSettingsListener && typeof window !== 'undefined') {
      this._hasBoundSettingsListener = true;
      window.addEventListener('settings:showAvatarsUpdated', () => {
        this.updateProfiles();
      });
    }
  }

  hasOthers() {
    return (Array.isArray(this.others) && this.others.length > 0) ||
           (Array.isArray(this.quotes) && this.quotes.length > 0);
  }

  hasAny() {
    return !!this.author || this.hasOthers();
  }

  getActivePubkeys() {
    return new Set(this.activePubkeys);
  }

  setTarget(state, targetEv, nip19, isQuoteMode = false) {
    this.state = state;
    this.nip19 = nip19 || getNip19();
    this.targetEv = targetEv;
    this.isQuoteMode = !!isQuoteMode;
    this.activePubkeys.clear();

    if (!targetEv || targetEv.kind === 20000) {
      this.clear();
      return;
    }

    if (!this.container && typeof document !== 'undefined') {
      this.init();
    }

    this.update();
  }

  updateFromComposer() {
    this.update();
  }

  update() {
    if (!this.container && typeof document !== 'undefined') {
      this.init();
    }

    const state = (typeof window !== 'undefined' && window.__nostrState) ? window.__nostrState : this.state;
    this.state = state;
    if (!this.nip19) this.nip19 = getNip19();

    const noteInput = typeof document !== 'undefined' ? document.getElementById('noteInput') : null;
    const text = noteInput ? noteInput.value : '';

    // 既存のアクティブ選択状態を退避
    const prevActive = new Set(this.activePubkeys);

    const existingPks = new Set();

    // 1. 通常返信モード（targetEv かつ !isQuoteMode）
    if (this.targetEv && !this.isQuoteMode) {
      const { author, others } = extractReplyRecipients(state, this.targetEv);
      this.author = author;
      this.others = others;
      if (author && author.pubkey) {
        existingPks.add(author.pubkey);
      }
      for (const o of others) {
        existingPks.add(o.pubkey);
      }
    } else {
      this.author = null;
      this.others = [];
    }

    // 2. 引用（引用モード targetEv または 本文中の引用）
    this.quotes = extractQuoteRecipients(state, this.targetEv, text, this.isQuoteMode, existingPks, this.nip19);

    // activePubkeys を再構築
    this.activePubkeys.clear();

    // 返信先当人は常にオン
    if (this.author && this.author.pubkey) {
      this.author.active = true;
      this.activePubkeys.add(this.author.pubkey);
    }

    // その他（巻き込み候補 / 引用先）は、以前オンにしていたものだけをオンとして復元（新登場はデフォルトオフ）
    for (const o of this.others) {
      o.active = prevActive.has(o.pubkey);
      if (o.active) this.activePubkeys.add(o.pubkey);
    }
    for (const q of this.quotes) {
      q.active = prevActive.has(q.pubkey);
      if (q.active) this.activePubkeys.add(q.pubkey);
    }

    // トグル可能な候補者（返信巻き込み候補 または 引用先）が存在する場合のみ表示
    if (this.hasOthers()) {
      if (this.container) {
        this.container.classList.remove('d-none');
        this.container.hidden = false;
      }
      this.render();
      this.startProfileTimer();
    } else {
      if (this.chipsContainer) {
        this.chipsContainer.innerHTML = '';
      }
      if (this.container) {
        this.container.classList.add('d-none');
        this.container.hidden = true;
      }
      this.stopProfileTimer();
    }
  }

  clear() {
    this.stopProfileTimer();
    this.targetEv = null;
    this.isQuoteMode = false;
    this.author = null;
    this.others = [];
    this.quotes = [];
    this.activePubkeys.clear();
    if (this.chipsContainer) {
      this.chipsContainer.innerHTML = '';
    }
    if (this.container) {
      this.container.classList.add('d-none');
      this.container.hidden = true;
    }
  }

  toggle(pubkey) {
    if (!pubkey) return;
    if (this.author && pubkey === this.author.pubkey) {
      // 返信先の当人は外せない
      return;
    }

    if (this.activePubkeys.has(pubkey)) {
      this.activePubkeys.delete(pubkey);
    } else {
      this.activePubkeys.add(pubkey);
    }

    // others / quotes の active フラグも同期
    for (const o of this.others) {
      if (o.pubkey === pubkey) o.active = this.activePubkeys.has(pubkey);
    }
    for (const q of this.quotes) {
      if (q.pubkey === pubkey) q.active = this.activePubkeys.has(pubkey);
    }

    this.updateChipState(pubkey);
  }

  updateChipState(pubkey) {
    if (!this.chipsContainer) return;
    const chip = this.chipsContainer.querySelector(`.reply-recipient-chip[data-pubkey="${pubkey}"]`);
    if (!chip) return;

    const isActive = this.activePubkeys.has(pubkey);
    const isQuote = chip.classList.contains('is-quote');

    if (isActive) {
      chip.classList.remove('is-muted');
      chip.classList.add('is-active');
      chip.title = isQuote
        ? (t('composer.quoteRecipientToggleOff') || '引用先（クリックして通知をオフ）')
        : (t('composer.replyRecipientToggleOff') || 'クリックして通知をオフ');
      const badge = chip.querySelector('.reply-recipient-badge');
      if (badge) badge.textContent = '🔔';
    } else {
      chip.classList.remove('is-active');
      chip.classList.add('is-muted');
      chip.title = isQuote
        ? (t('composer.quoteRecipientToggleOn') || '引用先（クリックして通知をオン）')
        : (t('composer.replyRecipientToggleOn') || 'クリックして通知をオン');
      const badge = chip.querySelector('.reply-recipient-badge');
      if (badge) badge.textContent = '🔕';
    }
  }

  render() {
    if (!this.chipsContainer) return;
    this.chipsContainer.innerHTML = '';

    const list = [];
    if (this.author) list.push(this.author);
    if (Array.isArray(this.others)) list.push(...this.others);
    if (Array.isArray(this.quotes)) list.push(...this.quotes);

    for (const item of list) {
      const isAuthor = !!item.isAuthor;
      const isQuote = !!item.isQuote;
      const isActive = this.activePubkeys.has(item.pubkey);

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.dataset.pubkey = item.pubkey;

      if (isAuthor) {
        chip.className = 'nostr-preview-chip reply-recipient-chip is-author is-active';
        chip.title = t('composer.replyRecipientAuthorTooltip') || '返信先（必須）';
      } else if (isQuote) {
        chip.className = 'nostr-preview-chip reply-recipient-chip is-quote ' + (isActive ? 'is-active' : 'is-muted');
        chip.title = isActive
          ? (t('composer.quoteRecipientToggleOff') || '引用先（クリックして通知をオフ）')
          : (t('composer.quoteRecipientToggleOn') || '引用先（クリックして通知をオン）');
      } else {
        chip.className = 'nostr-preview-chip reply-recipient-chip ' + (isActive ? 'is-active' : 'is-muted');
        chip.title = isActive
          ? (t('composer.replyRecipientToggleOff') || 'クリックして通知をオフ')
          : (t('composer.replyRecipientToggleOn') || 'クリックして通知をオン');
      }

      // フォーカス維持
      chip.addEventListener('mousedown', (e) => e.preventDefault());

      // クリックでトグル
      if (!isAuthor) {
        chip.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.toggle(item.pubkey);
        });
      }

      const showAvatars = isAvatarsEnabled(this.state);
      const prof = this.state?.profiles ? (this.state.profiles.get(item.pubkey) || this.state.profiles.get(item.pubkey.toLowerCase())) : null;
      const pictureUrl = (showAvatars && prof && prof.picture) ? prof.picture : '';
      const nameText = displayName(this.state, item.pubkey, this.nip19);

      if (pictureUrl) {
        const avatar = document.createElement('img');
        avatar.className = 'nostr-preview-avatar';
        avatar.src = pictureUrl;
        avatar.alt = '';
        avatar.loading = 'lazy';
        chip.appendChild(avatar);
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'nostr-preview-name';
      nameSpan.innerHTML = replaceBadgeEmoji(escapeHtml(nameText));
      chip.appendChild(nameSpan);

      const badge = document.createElement('span');
      badge.className = 'reply-recipient-badge';
      badge.textContent = isAuthor ? '🔔' : (isActive ? '🔔' : '🔕');
      chip.appendChild(badge);

      this.chipsContainer.appendChild(chip);
    }
  }

  updateProfiles() {
    if (!this.chipsContainer || !this.state) return;
    const chips = this.chipsContainer.querySelectorAll('.reply-recipient-chip[data-pubkey]');
    const latestNip19 = getNip19() || this.nip19;
    const showAvatars = isAvatarsEnabled(this.state);
    chips.forEach(chip => {
      const pk = chip.dataset.pubkey;
      if (!pk) return;
      const prof = this.state.profiles ? (this.state.profiles.get(pk) || this.state.profiles.get(pk.toLowerCase())) : null;
      const currentName = displayName(this.state, pk, latestNip19);
      const nameSpan = chip.querySelector('.nostr-preview-name');
      if (nameSpan && nameSpan.textContent !== currentName) {
        nameSpan.innerHTML = replaceBadgeEmoji(escapeHtml(currentName));
      }

      const existingAvatar = chip.querySelector('.nostr-preview-avatar');

      if (showAvatars && prof && prof.picture) {
        if (!existingAvatar) {
          const avatar = document.createElement('img');
          avatar.className = 'nostr-preview-avatar';
          avatar.src = prof.picture;
          avatar.alt = '';
          avatar.loading = 'lazy';
          if (nameSpan) {
            chip.insertBefore(avatar, nameSpan);
          } else {
            chip.prepend(avatar);
          }
        } else if (existingAvatar.src !== prof.picture) {
          existingAvatar.src = prof.picture;
        }
      } else {
        if (existingAvatar) {
          existingAvatar.remove();
        }
      }
    });
  }

  updateTranslations() {
    if (!this.container) return;
    const label = this.container.querySelector('.reply-recipients-label');
    if (label) {
      label.textContent = t('composer.replyRecipientsLabel') || '通知:';
    }
    if (this.chipsContainer) {
      const chips = this.chipsContainer.querySelectorAll('.reply-recipient-chip');
      chips.forEach(chip => {
        const pk = chip.dataset.pubkey;
        if (!pk) return;
        if (this.author && pk === this.author.pubkey) {
          chip.title = t('composer.replyRecipientAuthorTooltip') || '返信先（必須）';
        } else {
          const isActive = this.activePubkeys.has(pk);
          const isQuote = chip.classList.contains('is-quote');
          if (isQuote) {
            chip.title = isActive
              ? (t('composer.quoteRecipientToggleOff') || '引用先（クリックして通知をオフ）')
              : (t('composer.quoteRecipientToggleOn') || '引用先（クリックして通知をオン）');
          } else {
            chip.title = isActive
              ? (t('composer.replyRecipientToggleOff') || 'クリックして通知をオフ')
              : (t('composer.replyRecipientToggleOn') || 'クリックして通知をオン');
          }
        }
      });
    }
  }

  startProfileTimer() {
    if (this.profileTimer) return;
    this.profileTimer = setInterval(() => {
      if (!this.container || this.container.classList.contains('d-none')) {
        this.stopProfileTimer();
        return;
      }
      this.updateProfiles();
    }, 2000);
  }

  stopProfileTimer() {
    if (this.profileTimer) {
      clearInterval(this.profileTimer);
      this.profileTimer = null;
    }
  }
}

let defaultManager = null;
export function getReplyRecipientsManager() {
  if (!defaultManager) {
    defaultManager = new ReplyRecipientsManager();
    defaultManager.init();
  }
  return defaultManager;
}

export function resetReplyRecipientsManagerForTests() {
  if (defaultManager) {
    defaultManager.clear();
  }
  defaultManager = null;
}
