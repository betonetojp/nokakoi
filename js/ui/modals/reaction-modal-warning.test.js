// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showReactionModal } from './modals.js';
import { registerTextShortcodeVariant } from '../../features/emoji/custom-emoji-store.js';

describe('reaction modal relative/local URL warning and confirmation', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="reactionModal" class="modal" role="dialog" hidden>
        <div class="reaction-quick-row">
          <button type="button" class="quick-reaction" data-reaction=":nokakoi:"><img src="icon/nokakoi.png"></button>
        </div>
        <textarea id="reactionInput"></textarea>
        <button id="reactionSave"></button>
        <button id="reactionSaveAndReact"></button>
        <button id="reactionReactOnly"></button>
        <button id="reactionClose"></button>
        <span id="reactionStatus"></span>
        <div id="reactionRecentList"></div>
      </div>
      <div id="confirmModal" class="modal" role="dialog" hidden>
        <h3 id="confirmTitle"></h3>
        <p id="confirmMessage"></p>
        <button id="confirmYes">はい</button>
        <button id="confirmNo">いいえ</button>
      </div>
    `;
    localStorage.clear();
  });

  it('shows warning in preview when custom emoji has a relative or local URL', () => {
    registerTextShortcodeVariant('local_emoji', { url: 'http://localhost:3000/local.png' });

    showReactionModal(':local_emoji:', vi.fn(), null, {});

    const preview = document.querySelector('[data-reaction-preview="1"]');
    expect(preview).not.toBeNull();
    expect(preview.classList.contains('d-none')).toBe(false);

    const warning = preview.querySelector('.status-warning');
    expect(warning).not.toBeNull();
    expect(warning.textContent).toContain('画像URLが外部から参照できない形式');
  });

  it('does NOT show warning in preview when custom emoji has a public HTTPS URL', () => {
    registerTextShortcodeVariant('public_emoji', { url: 'https://example.com/safe.png' });

    showReactionModal(':public_emoji:', vi.fn(), null, {});

    const preview = document.querySelector('[data-reaction-preview="1"]');
    expect(preview).not.toBeNull();
    expect(preview.classList.contains('d-none')).toBe(false);

    const warning = preview.querySelector('.status-warning');
    expect(warning).toBeNull();
  });

  it('prompts confirmation when saving a relative/local URL emoji and cancels when "いいえ" is clicked', async () => {
    registerTextShortcodeVariant('local_emoji', { url: 'icon/broken.png' });

    const onConfirm = vi.fn();
    showReactionModal(':local_emoji:', onConfirm, null, {});

    const saveBtn = document.getElementById('reactionSave');
    saveBtn.click();

    // Confirm modal should be visible
    const confirmModal = document.getElementById('confirmModal');
    expect(confirmModal.hidden).toBe(false);
    const message = document.getElementById('confirmMessage');
    expect(message.textContent).toContain('このカスタム絵文字の画像URLは外部から参照できません');

    // Click "いいえ"
    const noBtn = document.getElementById('confirmNo');
    noBtn.click();

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('saves successfully when "はい" is clicked on confirmation', async () => {
    registerTextShortcodeVariant('local_emoji', { url: 'icon/broken.png' });

    const onConfirm = vi.fn();
    showReactionModal(':local_emoji:', onConfirm, null, {});

    const saveBtn = document.getElementById('reactionSave');
    saveBtn.click();

    // Click "はい"
    const yesBtn = document.getElementById('confirmYes');
    yesBtn.click();

    // Wait a tick for promise resolution
    await Promise.resolve();
    await new Promise(r => setTimeout(r, 50));

    expect(onConfirm).toHaveBeenCalled();
  });

  it('updates :nokakoi: to absolute URL and does NOT trigger warning when quick button is clicked', () => {
    // Simulate legacy relative path being registered beforehand
    registerTextShortcodeVariant('nokakoi', { url: 'icon/nokakoi.png' });

    showReactionModal('+', vi.fn(), null, {});

    const quickBtn = document.querySelector('.reaction-quick-row .quick-reaction[data-reaction=":nokakoi:"]');
    expect(quickBtn).not.toBeNull();
    quickBtn.click();

    const input = document.getElementById('reactionInput');
    expect(input.value).toBe(':nokakoi:');

    const preview = document.querySelector('[data-reaction-preview="1"]');
    expect(preview).not.toBeNull();
    const warning = preview.querySelector('.status-warning');
    expect(warning).toBeNull();

    const img = preview.querySelector('img');
    expect(img.src).toContain('https://');
    expect(img.src).not.toContain('icon/nokakoi.png"');
  });
});
