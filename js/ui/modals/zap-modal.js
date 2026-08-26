// ============================================================================
// Zap 入力モーダルの制御
// ============================================================================

import { $ } from '../../utils/utils.js';
import { t, applyTranslations } from '../../utils/i18n.js';
import { bringModalToFront } from '../setup/modal-helper.js';
import { generateQRCodeSVG } from '../../core/nip46.js';
import { hasConfiguredNwc } from '../../core/nwc.js';
import {
  loadZapAmountHistory,
  getLastZapAmount,
  rememberZapAmount,
  removeZapAmount,
  toLightningUri,
  waitForZapReceipt,
  applyZapReceiptToZappedState
} from '../../features/zap/zap.js';

let _invoiceAbort = null;

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

function resetZapModalPanels() {
  const formEl = $('#zapPayForm');
  const invoiceEl = $('#zapInvoicePanel');
  const qrEl = $('#zapInvoiceQr');
  const openEl = $('#zapInvoiceOpen');
  if (formEl) formEl.hidden = false;
  if (invoiceEl) invoiceEl.hidden = true;
  if (qrEl) qrEl.innerHTML = '';
  if (openEl) {
    openEl.removeAttribute('href');
    openEl.onclick = null;
  }
}

function abortInvoiceWait() {
  if (_invoiceAbort) {
    try { _invoiceAbort.abort(); } catch (_e) {}
    _invoiceAbort = null;
  }
}

async function showInvoicePanel(payment, statusEl) {
  const formEl = $('#zapPayForm');
  const invoiceEl = $('#zapInvoicePanel');
  const qrEl = $('#zapInvoiceQr');
  const openEl = $('#zapInvoiceOpen');
  const copyEl = $('#zapInvoiceCopy');
  const confirmBtn = $('#zapConfirm');
  const cancelBtn = $('#zapCancel');

  if (formEl) formEl.hidden = true;
  if (invoiceEl) invoiceEl.hidden = false;
  if (confirmBtn) confirmBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = false;

  const uri = toLightningUri(payment.pr);
  if (qrEl) {
    try {
      qrEl.innerHTML = generateQRCodeSVG(uri || payment.pr, { cellSize: 3, margin: 4 });
    } catch (e) {
      console.error('[ZapModal] QR generation failed:', e);
      qrEl.textContent = payment.pr;
    }
  }
  if (openEl) {
    openEl.href = uri || '#';
  }
  if (copyEl) {
    copyEl.onclick = async () => {
      try {
        await navigator.clipboard.writeText(payment.pr);
        if (statusEl) {
          statusEl.textContent = t('zap.modal.copied');
          statusEl.style.color = '';
        }
      } catch (_e) {
        if (statusEl) {
          statusEl.textContent = payment.pr;
          statusEl.style.color = '';
        }
      }
    };
  }

  if (statusEl) {
    statusEl.textContent = t('zap.modal.waiting');
    statusEl.style.color = '';
  }

  abortInvoiceWait();
  _invoiceAbort = typeof AbortController === 'function' ? new AbortController() : null;
  const waited = await waitForZapReceipt(payment, {
    timeoutMs: 180000,
    relays: payment.relays,
    signal: _invoiceAbort && _invoiceAbort.signal
  });
  return waited;
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
  const walletBtn = $('#zapWalletPay');
  const cancelBtn = $('#zapCancel');
  const closeBtn = $('#zapModalClose');
  const statusEl = $('#zapStatus');
  const historyEl = $('#zapAmountHistory');

  abortInvoiceWait();
  resetZapModalPanels();

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
    abortInvoiceWait();
    resetZapModalPanels();
    modal.hidden = true;
    if (confirmBtn) confirmBtn.disabled = false;
    if (walletBtn) walletBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  };

  if (closeBtn) closeBtn.onclick = closeModal;
  if (cancelBtn) cancelBtn.onclick = closeModal;
  if (walletBtn) walletBtn.hidden = !hasConfiguredNwc();

  const startPay = async (invoiceOnly) => {
    const amount = parseInt(amountInput.value, 10);
    if (isNaN(amount) || amount <= 0) {
      statusEl.textContent = t('zap.modal.error_amount');
      statusEl.style.color = 'var(--danger, red)';
      return;
    }

    const comment = (commentInput.value || '').trim();

    confirmBtn.disabled = true;
    if (walletBtn) walletBtn.disabled = true;
    cancelBtn.disabled = true;
    statusEl.textContent = t('zap.modal.paying');
    statusEl.style.color = '';

    try {
      let result = null;
      if (typeof onConfirm === 'function') {
        result = await onConfirm(amount, comment, { invoiceOnly: !!invoiceOnly });
      }
      rememberZapAmount(amount, { asLast: true });
      renderZapAmountHistory(historyEl, amountInput);

      if (result && result.pr && !result.paid) {
        const waited = await showInvoicePanel(result, statusEl);
        if (waited && waited.aborted) return;
        if (waited && waited.receipt) {
          try {
            const state = (typeof window !== 'undefined') ? window.__nostrState : null;
            applyZapReceiptToZappedState(state, waited.receipt);
          } catch (_e) {}
        }
      }

      statusEl.textContent = t('zap.modal.success');
      statusEl.style.color = 'var(--success, green)';
      setTimeout(() => {
        closeModal();
      }, 1000);
    } catch (err) {
      console.error('[ZapModal] Payment failed:', err);
      const timedOut = err && err.message === 'timeout';
      statusEl.textContent = timedOut
        ? t('zap.modal.invoice_timeout')
        : (err.message || t('zap.modal.failed'));
      statusEl.style.color = 'var(--danger, red)';
      confirmBtn.disabled = false;
      if (walletBtn) walletBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  };

  confirmBtn.onclick = () => startPay(false);
  if (walletBtn) walletBtn.onclick = () => startPay(true);

  try { applyTranslations(modal); } catch (e) {}

  modal.hidden = false;
  bringModalToFront(modal);
  if (amountInput && !amountInput.value) {
    try { amountInput.focus(); } catch (e) {}
  }
}
