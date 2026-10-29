import { escapeHtml, replaceBadgeEmoji } from '../../utils/utils.js';
import { t } from '../../utils/i18n.js';
import { getNip19 } from '../../core/nostr-compat.js';
import { displayName, isAvatarsEnabled } from '../profile/profile.js';
import { invokeShowProfileModalProxy, getEventCwReason, formatEventCwLabel, isCwExpandedForEvent } from '../../ui/renderers/render-helpers.js';
import { findEventById } from '../../core/state.js';

// nostr: プレフィックス付きの正規表現 (actions.js と同一パターン)
const NOSTR_MENTION_REGEX = /(?:^|\s)nostr:(npub1[a-z0-9]+|nprofile1[a-z0-9]+)/gi;
const NOSTR_QUOTE_REGEX = /(?:^|\s)nostr:(nevent1[a-z0-9]+|note1[a-z0-9]+)/gi;

// nostr: プレフィックスなしの独立した識別子の正規表現 (前後に英数字やコロンがないもの)
const PLAIN_IDENTIFIER_REGEX = /(^|[^a-zA-Z0-9:])(npub1[a-z0-9]{58,}|nprofile1[a-z0-9]+|nevent1[a-z0-9]+|note1[a-z0-9]{58,})\b/gi;

/**
 * 本文中の nostr:npub1... / nostr:nprofile1... を抽出
 */
export function extractMentions(text, nip19 = null) {
  if (!text || typeof text !== 'string') return [];
  const nip19Local = nip19 || getNip19();
  if (!nip19Local || typeof nip19Local.decode !== 'function') return [];

  const mentions = [];
  const seenPubkeys = new Set();
  let match;
  const regex = new RegExp(NOSTR_MENTION_REGEX.source, NOSTR_MENTION_REGEX.flags);

  while ((match = regex.exec(text)) !== null) {
    const raw = match[1];
    try {
      const decoded = nip19Local.decode(raw);
      let pubkey = null;
      let relays = [];
      if (decoded.type === 'npub') {
        pubkey = decoded.data;
      } else if (decoded.type === 'nprofile') {
        pubkey = decoded.data.pubkey;
        if (Array.isArray(decoded.data.relays)) relays = decoded.data.relays;
      }
      if (pubkey && !seenPubkeys.has(pubkey)) {
        seenPubkeys.add(pubkey);
        mentions.push({ raw, pubkey, relays, type: decoded.type });
      }
    } catch (_e) { }
  }
  return mentions;
}

/**
 * 本文中の nostr:nevent1... / nostr:note1... を抽出
 */
export function extractQuotes(text, nip19 = null) {
  if (!text || typeof text !== 'string') return [];
  const nip19Local = nip19 || getNip19();
  if (!nip19Local || typeof nip19Local.decode !== 'function') return [];

  const quotes = [];
  const seenIds = new Set();
  let match;
  const regex = new RegExp(NOSTR_QUOTE_REGEX.source, NOSTR_QUOTE_REGEX.flags);

  while ((match = regex.exec(text)) !== null) {
    const raw = match[1];
    try {
      const decoded = nip19Local.decode(raw);
      let eventId = null;
      let relays = [];
      let author = null;
      if (decoded.type === 'nevent') {
        eventId = decoded.data.id;
        if (Array.isArray(decoded.data.relays)) relays = decoded.data.relays;
        if (decoded.data.author) author = decoded.data.author;
      } else if (decoded.type === 'note') {
        eventId = typeof decoded.data === 'string' ? decoded.data : (decoded.data && decoded.data.id);
      }
      if (eventId && !seenIds.has(eventId)) {
        seenIds.add(eventId);
        quotes.push({ raw, eventId, relays, author, type: decoded.type });
      }
    } catch (_e) { }
  }
  return quotes;
}

/**
 * 本文中の nostr: が付いていない平文の Nostr 識別子を抽出 (nostr: 付与アシスト対象)
 */
export function extractConvertibleIdentifiers(text, nip19 = null) {
  if (!text || typeof text !== 'string') return [];
  const nip19Local = nip19 || getNip19();
  if (!nip19Local || typeof nip19Local.decode !== 'function') return [];

  const convertibles = [];
  const seen = new Set();
  let match;
  const regex = new RegExp(PLAIN_IDENTIFIER_REGEX.source, PLAIN_IDENTIFIER_REGEX.flags);

  while ((match = regex.exec(text)) !== null) {
    const raw = match[2];
    if (seen.has(raw)) continue;
    try {
      const decoded = nip19Local.decode(raw);
      if (decoded && ['npub', 'nprofile', 'nevent', 'note'].includes(decoded.type)) {
        seen.add(raw);
        convertibles.push({
          raw,
          type: decoded.type,
          isUser: decoded.type === 'npub' || decoded.type === 'nprofile'
        });
      }
    } catch (_e) { }
  }
  return convertibles;
}

/**
 * 本文中の指定した識別子の直前に nostr: を付与する
 */
export function applyNostrPrefixToText(text, identifier) {
  if (!text || !identifier) return text;
  // 単語境界かつ直前に nostr: がない箇所のみ置換
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const targetRegex = new RegExp(`(^|[^a-zA-Z0-9:])(${escaped})\\b`, 'g');
  return text.replace(targetRegex, '$1nostr:$2');
}

/**
 * 投稿入力欄 (composer) に Nostr プレビュー＆アシストUIをセットアップ
 */
export function setupComposerNostrPreview(state, noteInput, composer) {
  if (!noteInput || !composer) return null;

  let container = composer.querySelector('.composer-nostr-preview-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'composer-nostr-preview-container d-none';
    const insertAnchor = composer.querySelector('.emoji-preview-container') ||
                         composer.querySelector('.emoji-shortcode-suggest') ||
                         noteInput;
    noteInput.parentNode.insertBefore(container, insertAnchor);
  }

  let profileUpdateTimer = null;

  function renderPreview() {
    const text = noteInput.value || '';
    const nip19 = getNip19();

    const mentions = extractMentions(text, nip19);
    const quotes = extractQuotes(text, nip19);
    const convertibles = extractConvertibleIdentifiers(text, nip19);

    if (mentions.length === 0 && quotes.length === 0 && convertibles.length === 0) {
      container.classList.add('d-none');
      container.innerHTML = '';
      if (profileUpdateTimer) {
        clearInterval(profileUpdateTimer);
        profileUpdateTimer = null;
      }
      return;
    }

    container.classList.remove('d-none');
    container.innerHTML = '';

    // 1. メンションプレビュー
    if (mentions.length > 0) {
      const mentionRow = document.createElement('div');
      mentionRow.className = 'nostr-preview-row';

      const label = document.createElement('span');
      label.className = 'nostr-preview-label';
      label.textContent = t('composer.mentionPreviewLabel') || 'メンション:';
      mentionRow.appendChild(label);

      const list = document.createElement('div');
      list.className = 'nostr-preview-chips';

      for (const m of mentions) {
        const chip = document.createElement('span');
        chip.className = 'nostr-preview-chip nostr-mention-chip';
        chip.dataset.pubkey = m.pubkey;
        chip.title = m.raw;

        const prof = state.profiles ? state.profiles.get(m.pubkey) : null;
        const nameText = displayName(state, m.pubkey, nip19);
        const showAvatars = isAvatarsEnabled(state);
        const pictureUrl = (showAvatars && prof && prof.picture) ? prof.picture : '';

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

        chip.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          invokeShowProfileModalProxy(m.pubkey);
        };

        list.appendChild(chip);
      }
      mentionRow.appendChild(list);
      container.appendChild(mentionRow);
    }

    // 2. 引用プレビュー
    if (quotes.length > 0) {
      const quoteRow = document.createElement('div');
      quoteRow.className = 'nostr-preview-row';

      const label = document.createElement('span');
      label.className = 'nostr-preview-label';
      label.textContent = t('composer.quotePreviewLabel') || '引用:';
      quoteRow.appendChild(label);

      const list = document.createElement('div');
      list.className = 'nostr-preview-chips';

      for (const q of quotes) {
        const chip = document.createElement('span');
        chip.className = 'nostr-preview-chip nostr-quote-chip';
        chip.title = q.raw;

        const icon = document.createElement('span');
        icon.className = 'nostr-preview-icon';
        icon.textContent = '💬';
        chip.appendChild(icon);

        const ev = findEventById(state, q.eventId);
        let summaryText;
        if (ev) {
          const authorName = displayName(state, ev.pubkey, nip19);
          const cwReason = getEventCwReason(ev);
          if (cwReason !== null && !(ev.id && isCwExpandedForEvent(ev.id))) {
            summaryText = `${authorName}: [${formatEventCwLabel(cwReason)}]`;
          } else {
            const firstLine = (ev.content || '').split('\n')[0].trim();
            const shortLine = firstLine.length > 30 ? firstLine.slice(0, 30) + '...' : firstLine;
            summaryText = `${authorName}: ${shortLine || '...'}`;
          }
        } else {
          const shortId = q.eventId.slice(0, 8);
          summaryText = q.type === 'nevent' ? `nevent (${shortId})` : `note (${shortId})`;
        }

        const textSpan = document.createElement('span');
        textSpan.className = 'nostr-preview-text';
        textSpan.innerHTML = replaceBadgeEmoji(escapeHtml(summaryText));
        chip.appendChild(textSpan);

        chip.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const targetEv = findEventById(state, q.eventId);
          if (targetEv) {
            try {
              const [{ showEventModal }, { reactToEvent, repostEvent }, { setReplyTarget }, { getSettingsManager }] = await Promise.all([
                import('../../ui/modals/event-modal.js'),
                import('./actions.js'),
                import('./composer.js'),
                import('../../core/app-context.js')
              ]);
              const sm = getSettingsManager();
              const settings = (sm && sm.settings) || {};
              showEventModal(
                targetEv,
                state,
                nip19,
                (evObj, sym) => reactToEvent(state, evObj, sym),
                (evObj) => setReplyTarget(state, evObj, nip19),
                (evObj) => repostEvent(state, evObj),
                settings,
                sm
              );
            } catch (_err) { }
          }
        };

        list.appendChild(chip);
      }
      quoteRow.appendChild(list);
      container.appendChild(quoteRow);
    }

    // 3. nostr: 付与アシスト (平文の Nostr 識別子がある場合)
    if (convertibles.length > 0) {
      const convertRow = document.createElement('div');
      convertRow.className = 'nostr-preview-row nostr-convert-row';

      const hint = document.createElement('span');
      hint.className = 'nostr-preview-label nostr-convert-hint';
      hint.textContent = t('composer.convertHint') || '💡 nostr: を付与';
      convertRow.appendChild(hint);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'nostr-convert-buttons';

      for (const item of convertibles) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nostr-convert-btn secondary small';
        const shortRaw = item.raw.length > 16 ? item.raw.slice(0, 8) + '...' + item.raw.slice(-4) : item.raw;
        const kindLabel = item.isUser
          ? (t('composer.typeMention') || 'メンション')
          : (t('composer.typeQuote') || '引用');
        btn.textContent = `＋ nostr:${shortRaw} (${kindLabel})`;
        btn.title = `nostr:${item.raw}`;

        btn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const updated = applyNostrPrefixToText(noteInput.value || '', item.raw);
          noteInput.value = updated;
          noteInput.dispatchEvent(new Event('input', { bubbles: true }));
        };

        btnGroup.appendChild(btn);
      }
      convertRow.appendChild(btnGroup);
      container.appendChild(convertRow);
    }

    // プロフィール非同期ロード後の再描画監視 (必要に応じて)
    if (mentions.length > 0 && !profileUpdateTimer) {
      profileUpdateTimer = setInterval(() => {
        // コンテナが消えていたらタイマー停止
        if (!container || container.classList.contains('d-none')) {
          clearInterval(profileUpdateTimer);
          profileUpdateTimer = null;
          return;
        }
        // 名前を更新（常に最新チップの data-pubkey を参照し、古いクロージャ配列のズレを防ぐ）
        const latestNip19 = getNip19();
        const chips = container.querySelectorAll('.nostr-mention-chip[data-pubkey]');
        const showAvatars = isAvatarsEnabled(state);
        chips.forEach((chip) => {
          const pk = chip.dataset.pubkey;
          if (!pk) return;
          const prof = state.profiles ? (state.profiles.get(pk) || state.profiles.get(pk.toLowerCase())) : null;
          const currentName = displayName(state, pk, latestNip19);
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
      }, 1000);
    }
  }

  // 入力イベントリスナー登録
  noteInput.addEventListener('input', renderPreview);

  // 設定変更時の即時反映リスナー
  const handleAvatarsSettingUpdated = () => {
    if (container && !container.classList.contains('d-none')) {
      renderPreview();
    }
  };
  try {
    if (typeof window !== 'undefined') {
      window.addEventListener('settings:showAvatarsUpdated', handleAvatarsSettingUpdated);
    }
  } catch (_e) {}

  return {
    render: renderPreview,
    clear: () => {
      container.classList.add('d-none');
      container.innerHTML = '';
      if (profileUpdateTimer) {
        clearInterval(profileUpdateTimer);
        profileUpdateTimer = null;
      }
      try {
        if (typeof window !== 'undefined') {
          window.removeEventListener('settings:showAvatarsUpdated', handleAvatarsSettingUpdated);
        }
      } catch (_e) {}
    }
  };
}
