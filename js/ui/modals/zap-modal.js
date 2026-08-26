// ============================================================================
// Zap 入力モーダルの制御
// ============================================================================

import { $ } from '../../utils/utils.js';
import { t, applyTranslations } from '../../utils/i18n.js';
import { bringModalToFront } from '../setup/modal-helper.js';
import {
  loadZapAmountHistory,
  getLastZapAmount,
  rememberZapAmount,
  removeZapAmount
} from '../../features/zap/zap.js';

let _activeConfirmHandler = null;

function renderZapAmountHistory(container, amountInput) {
  if (!container) return;
  const amounts = loadZapAmountHistory();
  container.innerHTML = '';
  if (!amounts.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const removeLabel = t('zap.amount_history.remove') || '履歴から削除';

  amounts.forEach((amount) => {
    const chip = document.createElement('span');
    chip.className = 'zap-amount-chip';

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'secondary zap-amount-btn';
    selectBtn.dataset.amount = String(amount);
    selectBtn.textContent = String(amount);
    selectBtn.onclick = () => {
      if (amountInput) {
        amountInput.value = String(amount);
        amountInput.focus();
      }
    };

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'secondary zap-amount-remove';
    removeBtn.dataset.amount = String(amount);
    removeBtn.title = removeLabel;
    removeBtn.setAttribute('aria-label', removeLabel);
    removeBtn.textContent = '×';
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      removeZapAmount(amount);
      renderZapAmountHistory(container, amountInput);
    };

    chip.appendChild(selectBtn);
    chip.appendChild(removeBtn);
    container.appendChild(chip);
  });
}

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
  const historyEl = $('#zapAmountHistory');

  if (nameEl) nameEl.textContent = recipientName || '';
  if (addrEl) addrEl.textContent = recipientAddress ? `(${recipientAddress})` : '';
  if (amountInput) {
    const last = getLastZapAmount();
    amountInput.value = last ? String(last) : '';
  }
  if (commentInput) commentInput.value = '';
  if (statusEl) {
    statusEl.textContent = '';
    statusEl.style.color = '';
  }

  renderZapAmountHistory(historyEl, amountInput);

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
      rememberZapAmount(amount, { asLast: true });
      renderZapAmountHistory(historyEl, amountInput);
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
  if (amountInput && !amountInput.value) {
    try { amountInput.focus(); } catch (e) {}
  }
}
