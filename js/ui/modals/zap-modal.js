// ============================================================================
// Zap 入力モーダルの制御
// ============================================================================

import { $, escapeHtml } from '../../utils/utils.js';
import { t, applyTranslations } from '../../utils/i18n.js';
import { bringModalToFront } from '../setup/modal-helper.js';

let _activeConfirmHandler = null;

/**
 * Zap金額入力モーダルを開く
 * @param {string} recipientName 受取人名
 * @param {string} recipientAddress 受取人アドレス (Lightning Addressなど)
 * @param {function} onConfirm 送信決定時のコールバック (amountSats, comment) => Promise<any>
 */
export function showZapModal(recipientName, recipientAddress, onConfirm) {
  const modal = $('#zapModal');
  if (!modal) return;

  const nameEl = $('#zapRecipientName');
  const addrEl = $('#zapRecipientAddress');
  const amountInput = $('#zapAmountInput');
  const commentInput = $('#zapCommentInput');
  const confirmBtn = $('#zapConfirm');
  const cancelBtn = $('#zapCancel');
  const closeBtn = $('#zapModalClose');
  const statusEl = $('#zapStatus');

  if (nameEl) nameEl.textContent = recipientName || '';
  if (addrEl) addrEl.textContent = recipientAddress ? `(${recipientAddress})` : '';
  if (amountInput) amountInput.value = '50';
  if (commentInput) commentInput.value = '';
  if (statusEl) {
    statusEl.textContent = '';
    statusEl.style.color = '';
  }

  // プリセットボタンのバインド
  const presetBtns = modal.querySelectorAll('.zap-amount-btn');
  presetBtns.forEach(btn => {
    btn.onclick = () => {
      const amt = btn.getAttribute('data-amount');
      if (amountInput && amt) {
        amountInput.value = amt;
      }
    };
  });

  const closeModal = () => {
    modal.hidden = true;
    confirmBtn.disabled = false;
    cancelBtn.disabled = false;
    _activeConfirmHandler = null;
  };

  if (closeBtn) closeBtn.onclick = closeModal;
  if (cancelBtn) cancelBtn.onclick = closeModal;

  confirmBtn.onclick = async () => {
    const amount = parseInt(amountInput.value, 10);
    if (isNaN(amount) || amount <= 0) {
      statusEl.textContent = t('zap.modal.error_amount');
      statusEl.style.color = 'var(--danger, red)';
      return;
    }

    const comment = (commentInput.value || '').trim();

    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    statusEl.textContent = t('zap.modal.paying');
    statusEl.style.color = '';

    try {
      if (typeof onConfirm === 'function') {
        await onConfirm(amount, comment);
      }
      statusEl.textContent = t('zap.modal.success');
      statusEl.style.color = 'var(--success, green)';
      setTimeout(() => {
        closeModal();
      }, 1000);
    } catch (err) {
      console.error('[ZapModal] Payment failed:', err);
      statusEl.textContent = err.message || t('zap.modal.failed');
      statusEl.style.color = 'var(--danger, red)';
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  };

  try { applyTranslations(modal); } catch (e) {}

  modal.hidden = false;
  bringModalToFront(modal);
}
