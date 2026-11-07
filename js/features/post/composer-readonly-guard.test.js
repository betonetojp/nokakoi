// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showToast: vi.fn()
}));

vi.mock('../../utils/i18n.js', () => ({
  t: (k) => k,
  applyTranslations: vi.fn()
}));

vi.mock('../../utils/utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    showToast: mocks.showToast
  };
});

import { setQuoteTarget, setReplyTarget, getQuoteMode, getReplyTarget, syncComposerAuthState } from './composer.js';

describe('composer read-only guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="composer" hidden>
        <div id="composerFormBody">
          <div id="replyContext" hidden>
            <span class="reply-context-label"></span>
            <span id="replyContextContent"></span>
            <button id="cancelReply" style="display:none;"></button>
            <span id="changeGeohashLabel" style="display:none;"></span>
          </div>
          <div id="composerTitle"></div>
          <textarea id="noteInput"></textarea>
        </div>
        <div id="composerLoginPrompt" hidden>
          <button id="composerOpenLoginBtn"></button>
        </div>
      </div>
    `;
    localStorage.clear();
  });

  it('blocks setQuoteTarget when state.signer is read-only', () => {
    const state = { signer: 'read-only', pubkey: 'a'.repeat(64), profiles: new Map() };
    const event = { id: 'ev1', pubkey: 'b'.repeat(64), content: 'test content' };

    const result = setQuoteTarget(state, event, null);

    expect(result).toBe(false);
    expect(mocks.showToast).toHaveBeenCalled();
    expect(document.getElementById('replyContext').hidden).toBe(true);
    expect(getQuoteMode()).toBe(false);
  });

  it('blocks setReplyTarget when state.signer is read-only', () => {
    const state = { signer: 'read-only', pubkey: 'a'.repeat(64), profiles: new Map() };
    const event = { id: 'ev1', pubkey: 'b'.repeat(64), content: 'test content' };

    const result = setReplyTarget(state, event, null);

    expect(result).toBe(false);
    expect(mocks.showToast).toHaveBeenCalled();
    expect(document.getElementById('replyContext').hidden).toBe(true);
  });

  it('allows setQuoteTarget for regular state', () => {
    const state = { signer: 'nsec', pubkey: 'a'.repeat(64), profiles: new Map() };
    const event = { id: 'ev1', pubkey: 'b'.repeat(64), content: 'test content' };

    const result = setQuoteTarget(state, event, null);

    expect(result).not.toBe(false);
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(document.getElementById('replyContext').hidden).toBe(false);
    expect(getQuoteMode()).toBe(true);
    expect(getReplyTarget()).toEqual(event);
  });

  it('syncComposerAuthState shows login prompt bar when unauthenticated and switches to form when logged in', () => {
    const composer = document.getElementById('composer');
    const formBody = document.getElementById('composerFormBody');
    const loginPrompt = document.getElementById('composerLoginPrompt');

    // Unauthenticated
    syncComposerAuthState({ pubkey: null, signer: 'auto' });
    expect(composer.hidden).toBe(false);
    expect(formBody.hidden).toBe(true);
    expect(loginPrompt.hidden).toBe(false);
    expect(composer.classList.contains('composer--login-prompt')).toBe(true);

    // Logged in (normal)
    const pk = 'a'.repeat(64);
    localStorage.setItem('pubkey', pk);
    syncComposerAuthState({ pubkey: pk, signer: 'nsec' });
    expect(composer.hidden).toBe(false);
    expect(formBody.hidden).toBe(false);
    expect(loginPrompt.hidden).toBe(true);
    expect(composer.classList.contains('composer--login-prompt')).toBe(false);

    // Logged in (read-only)
    syncComposerAuthState({ pubkey: pk, signer: 'read-only' });
    expect(composer.hidden).toBe(true);
    expect(loginPrompt.hidden).toBe(true);
  });
});
