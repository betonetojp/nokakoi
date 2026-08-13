/**
 * Channel metadata editor (kind:41) — creator only
 */

import {
  extractChannelProfileFields,
  fetchChannelMetadata,
  invalidateChannelLabelCache,
} from './channel.js';
import { getReadRelays, getWriteRelays } from '../../core/relay.js';
import { signEventWithMode } from '../post/actions.js';
import { awaitAny } from '../../utils/utils.js';
import { cacheEvent } from '../../core/state.js';
import { t } from '../../utils/i18n.js';

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

function parseRelaysText(raw) {
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

function pickRelayHint(state, relays) {
  try {
    const write = getWriteRelays(state && state.relays) || [];
    if (write[0]) return write[0];
  } catch (_e) { }
  try {
    const read = getReadRelays(state && state.relays) || [];
    if (read[0]) return read[0];
  } catch (_e) { }
  if (Array.isArray(relays) && relays[0]) return relays[0];
  return 'wss://yabu.me/';
}

/**
 * 自分が作成したチャンネルのメタデータ編集モーダル
 */
export async function openChannelMetaEditor(state, rootId, options = {}) {
  const modal = document.getElementById('channelMetaEditModal');
  if (!modal || !rootId) return;

  modal.hidden = false;

  const statusEl = document.getElementById('channelMetaEditStatus');
  const contentEl = document.getElementById('channelMetaEditContent');
  const saveBtn = document.getElementById('channelMetaEditSaveBtn');
  const cancelBtn = document.getElementById('channelMetaEditCancelBtn');
  const closeBtn = document.getElementById('channelMetaEditClose');

  if (statusEl) statusEl.textContent = t('editor.common.fetching') || 'Fetching...';
  if (contentEl) contentEl.innerHTML = '';

  const myPubkey = (state && state.pubkey) || localStorage.getItem('pubkey');
  if (!myPubkey) {
    if (statusEl) statusEl.textContent = t('editor.common.no_login') || 'Login required';
    return;
  }

  const newSaveBtn = saveBtn ? saveBtn.cloneNode(true) : null;
  const newCancelBtn = cancelBtn ? cancelBtn.cloneNode(true) : null;
  const newCloseBtn = closeBtn ? closeBtn.cloneNode(true) : null;
  if (saveBtn && newSaveBtn) saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  if (cancelBtn && newCancelBtn) cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
  if (closeBtn && newCloseBtn) closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

  const closeModal = () => { modal.hidden = true; };
  if (newCancelBtn) newCancelBtn.onclick = closeModal;
  if (newCloseBtn) newCloseBtn.onclick = closeModal;

  const meta = await fetchChannelMetadata(state, rootId);
  const rootEvent = meta && meta.rootEvent;
  if (!rootEvent || typeof rootEvent.pubkey !== 'string'
    || rootEvent.pubkey.toLowerCase() !== myPubkey.toLowerCase()) {
    if (statusEl) statusEl.textContent = t('channel.meta.not_owner') || 'このチャンネルの作成者のみ編集できます';
    return;
  }

  const profile = extractChannelProfileFields(rootEvent, meta && meta.metaEvent);
  const name = profile.name || meta.label || '';
  const about = profile.about || '';
  const picture = profile.picture || '';
  const relaysText = Array.isArray(profile.relays) ? profile.relays.join('\n') : '';

  if (statusEl) statusEl.textContent = '';
  contentEl.innerHTML = `
    <label class="mb-8" style="display:block">
      <span class="muted text-sm">${t('channel.meta.name') || '名前'}</span>
      <input type="text" id="channelMetaName" class="w-full" value="">
    </label>
    <label class="mb-8" style="display:block">
      <span class="muted text-sm">${t('channel.meta.about') || '説明'}</span>
      <textarea id="channelMetaAbout" class="w-full" rows="3"></textarea>
    </label>
    <label class="mb-8" style="display:block">
      <span class="muted text-sm">${t('channel.meta.picture') || '画像URL'}</span>
      <input type="url" id="channelMetaPicture" class="w-full" value="">
    </label>
    <label class="mb-8" style="display:block">
      <span class="muted text-sm">${t('channel.meta.relays_hint') || t('channel.meta.relays') || 'リレー（1行に1つ）'}</span>
      <textarea id="channelMetaRelays" class="w-full" rows="4" placeholder="wss://..."></textarea>
    </label>
  `;

  const nameInput = contentEl.querySelector('#channelMetaName');
  const aboutInput = contentEl.querySelector('#channelMetaAbout');
  const pictureInput = contentEl.querySelector('#channelMetaPicture');
  const relaysInput = contentEl.querySelector('#channelMetaRelays');
  if (nameInput) nameInput.value = name;
  if (aboutInput) aboutInput.value = about;
  if (pictureInput) pictureInput.value = picture;
  if (relaysInput) relaysInput.value = relaysText;

  if (newSaveBtn) {
    newSaveBtn.onclick = async () => {
      newSaveBtn.disabled = true;
      try {
        const confirmed = await showConfirmDialog(
          modal.querySelector('.modal-body') || modal,
          'channel.meta.confirm',
        );
        if (!confirmed) return;

        if (statusEl) statusEl.textContent = t('editor.common.publishing') || 'Publishing...';

        const nextRelays = parseRelaysText(relaysInput && relaysInput.value);
        const contentObj = {};
        const nextName = (nameInput && nameInput.value || '').trim();
        const nextAbout = (aboutInput && aboutInput.value || '').trim();
        const nextPicture = (pictureInput && pictureInput.value || '').trim();
        if (nextName) contentObj.name = nextName;
        if (nextAbout) contentObj.about = nextAbout;
        if (nextPicture) contentObj.picture = nextPicture;
        if (nextRelays.length) contentObj.relays = nextRelays;

        const relayHint = pickRelayHint(state, nextRelays);
        const draft = {
          kind: 41,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['e', rootId, relayHint, 'root']],
          content: JSON.stringify(contentObj),
          pubkey: myPubkey,
        };

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
        for (const url of writeRelays.concat(nextRelays)) {
          const key = String(url || '').toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          publishTargets.push(url);
        }
        if (!publishTargets.length) {
          if (statusEl) statusEl.textContent = t('editor.common.failed').replace('{msg}', 'No write relays') || 'No write relays';
          return;
        }

        const pubs = state.pool.publish(publishTargets, signed);
        await awaitAny(pubs);
        try { cacheEvent(state, signed); } catch (_e) { }
        invalidateChannelLabelCache(rootId);

        if (statusEl) statusEl.textContent = t('editor.common.success') || 'Updated';
        if (typeof options.onSaved === 'function') {
          try {
            options.onSaved({
              rootId,
              event: signed,
              profile: extractChannelProfileFields(rootEvent, signed),
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
        newSaveBtn.disabled = false;
      }
    };
  }
}
