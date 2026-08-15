/**
 * Channel creator (kind:40) — NIP-28 public chat creation
 */

import { getWriteRelays } from '../../core/relay.js';
import { signEventWithMode } from '../post/actions.js';
import { awaitAny } from '../../utils/utils.js';
import { cacheEvent } from '../../core/state.js';
import { t } from '../../utils/i18n.js';

export function parseRelaysText(raw) {
  const lines = String(raw || '').split(/[\n,]+/);
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    let url = String(line || '').trim();
    if (!url) continue;
    if (!/^wss?:\/\//i.test(url)) url = 'wss://' + url;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

export function buildChannelCreateDraft({ name, about = '', picture = '', relays = [], pubkey = '' } = {}) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    throw new Error(t('channel.name_required') || 'チャンネル名を入力してください');
  }

  const contentObj = { name: trimmedName };
  const trimmedAbout = String(about || '').trim();
  const trimmedPicture = String(picture || '').trim();

  if (trimmedAbout) contentObj.about = trimmedAbout;
  if (trimmedPicture) contentObj.picture = trimmedPicture;
  if (Array.isArray(relays) && relays.length > 0) {
    contentObj.relays = relays;
  }

  return {
    kind: 40,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(contentObj),
    pubkey: pubkey || '',
  };
}

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
    okBtn.textContent = okBtnKey
      ? (t(okBtnKey) || okBtnKey)
      : (t('editor.common.confirm_publish') || 'Publish');
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
 * チャンネル新規作成モーダルを開く
 */
export async function openChannelCreateModal(state, options = {}) {
  const modal = document.getElementById('channelCreateModal');
  if (!modal) return;

  modal.hidden = false;

  const statusEl = document.getElementById('channelCreateStatus');
  const contentEl = document.getElementById('channelCreateContent');
  const submitBtn = document.getElementById('channelCreateSubmitBtn');
  const cancelBtn = document.getElementById('channelCreateCancelBtn');
  const closeBtn = document.getElementById('channelCreateClose');

  if (statusEl) statusEl.textContent = '';
  if (contentEl) contentEl.innerHTML = '';

  const myPubkey = (state && state.pubkey) || localStorage.getItem('pubkey');
  if (!myPubkey) {
    if (statusEl) statusEl.textContent = t('editor.common.no_login') || 'Login required';
    return;
  }

  const newSubmitBtn = submitBtn ? submitBtn.cloneNode(true) : null;
  const newCancelBtn = cancelBtn ? cancelBtn.cloneNode(true) : null;
  const newCloseBtn = closeBtn ? closeBtn.cloneNode(true) : null;
  if (submitBtn && newSubmitBtn) submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
  if (cancelBtn && newCancelBtn) cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  if (closeBtn && newCloseBtn) closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

  const closeModal = () => { modal.hidden = true; };
  if (newCancelBtn) newCancelBtn.onclick = closeModal;
  if (newCloseBtn) newCloseBtn.onclick = closeModal;

  const defaultRelays = (state && getWriteRelays(state.relays)) || [];
  const defaultRelaysText = defaultRelays.slice(0, 3).join('\n');

  contentEl.innerHTML = `
    <label class="mb-8" style="display:block">
      <span class="muted text-sm">${t('channel.meta.name') || '名前'} *</span>
      <input type="text" id="channelCreateName" class="w-full" placeholder="${t('channel.meta.name') || '名前'}" autofocus>
    </label>
    <label class="mb-8" style="display:block">
      <span class="muted text-sm">${t('channel.meta.about') || '説明'}</span>
      <textarea id="channelCreateAbout" class="w-full" rows="3" placeholder="${t('channel.meta.about') || '説明'}"></textarea>
    </label>
    <label class="mb-8" style="display:block">
      <span class="muted text-sm">${t('channel.meta.picture') || '画像URL'}</span>
      <input type="url" id="channelCreatePicture" class="w-full" placeholder="https://...">
    </label>
    <label class="mb-8" style="display:block">
      <span class="muted text-sm">${t('channel.meta.relays_hint') || t('channel.meta.relays') || 'リレー（1行に1つ）'}</span>
      <textarea id="channelCreateRelays" class="w-full" rows="3" placeholder="wss://..."></textarea>
    </label>
  `;

  const nameInput = contentEl.querySelector('#channelCreateName');
  const aboutInput = contentEl.querySelector('#channelCreateAbout');
  const pictureInput = contentEl.querySelector('#channelCreatePicture');
  const relaysInput = contentEl.querySelector('#channelCreateRelays');

  if (relaysInput && defaultRelaysText) {
    relaysInput.value = defaultRelaysText;
  }

  if (nameInput) {
    setTimeout(() => nameInput.focus(), 50);
  }

  if (newSubmitBtn) {
    newSubmitBtn.onclick = async () => {
      const name = (nameInput && nameInput.value || '').trim();
      if (!name) {
        if (statusEl) statusEl.textContent = t('channel.name_required') || 'チャンネル名を入力してください';
        if (nameInput) nameInput.focus();
        return;
      }

      newSubmitBtn.disabled = true;
      try {
        const confirmed = await showConfirmDialog(
          modal.querySelector('.modal-body') || modal,
          'channel.create_confirm',
          'channel.create_btn',
        );
        if (!confirmed) return;

        if (statusEl) statusEl.textContent = t('editor.common.publishing') || 'Publishing...';

        const about = (aboutInput && aboutInput.value || '').trim();
        const picture = (pictureInput && pictureInput.value || '').trim();
        const relays = parseRelaysText(relaysInput && relaysInput.value);

        const draft = buildChannelCreateDraft({
          name,
          about,
          picture,
          relays,
          pubkey: myPubkey,
        });

        const signed = await signEventWithMode(state, draft);
        if (!signed || !signed.id || (!signed.sig && !signed.signature)) {
          if (statusEl) {
            statusEl.textContent = (t('editor.common.sign_failed') || 'Sign failed: {msg}')
              .replace('{msg}', 'invalid event');
          }
          return;
        }

        const writeRelays = getWriteRelays(state.relays) || [];
        const publishTargets = [];
        const seen = new Set();
        for (const url of writeRelays.concat(relays)) {
          const key = String(url || '').toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          publishTargets.push(url);
        }

        if (!publishTargets.length) {
          if (statusEl) {
            statusEl.textContent = (t('editor.common.failed') || 'Failed: {msg}')
              .replace('{msg}', 'No write relays');
          }
          return;
        }

        const pubs = state.pool.publish(publishTargets, signed);
        await awaitAny(pubs);
        try { cacheEvent(state, signed); } catch (_e) { }

        if (statusEl) statusEl.textContent = t('channel.created_success') || 'Channel created';
        if (typeof options.onCreated === 'function') {
          try {
            let profileObj = {};
            try { profileObj = JSON.parse(signed.content); } catch (_e) { }
            options.onCreated({
              rootId: signed.id,
              event: signed,
              profile: profileObj,
            });
          } catch (_e) { }
        }
        setTimeout(closeModal, 500);
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = (t('editor.common.failed') || 'Failed: {msg}')
            .replace('{msg}', err && err.message ? err.message : 'unknown');
        }
      } finally {
        newSubmitBtn.disabled = false;
      }
    };
  }
}
