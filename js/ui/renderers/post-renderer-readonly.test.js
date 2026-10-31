// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  setQuoteTarget: vi.fn(),
  setReplyTarget: vi.fn()
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

vi.mock('../../features/post/composer.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    setQuoteTarget: mocks.setQuoteTarget,
    setReplyTarget: mocks.setReplyTarget
  };
});

import { renderEvent } from './post-renderer.js';

describe('post-renderer read-only guards for quote and reply buttons', () => {
  let composer;
  let noteInput;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="composer" hidden>
        <textarea id="noteInput"></textarea>
      </div>
    `;
    composer = document.getElementById('composer');
    noteInput = document.getElementById('noteInput');
    localStorage.clear();
  });

  it('blocks quote button click for read-only account', () => {
    const pubkey = 'a'.repeat(64);
    localStorage.setItem('pubkey', pubkey);
    const state = { signer: 'read-only', pubkey, profiles: new Map() };
    const ev = { id: 'ev1', kind: 1, pubkey: 'b'.repeat(64), content: 'test note', tags: [] };
    const nip19 = { npubEncode: (pk) => 'npub1' + pk };
    const settings = {};
    const settingsManager = { get: vi.fn() };

    const el = renderEvent(state, ev, nip19, settings, settingsManager, vi.fn(), vi.fn(), vi.fn());
    document.body.appendChild(el);

    const quoteBtn = el.querySelector('.btn-quote');
    expect(quoteBtn).not.toBeNull();

    // Click quote button
    quoteBtn.click();

    expect(mocks.showToast).toHaveBeenCalled();
    expect(composer.hidden).toBe(true);
    expect(mocks.setQuoteTarget).not.toHaveBeenCalled();
    expect(noteInput.value).toBe('');
  });

  it('blocks reply button click for read-only account', () => {
    const pubkey = 'a'.repeat(64);
    localStorage.setItem('pubkey', pubkey);
    const state = { signer: 'read-only', pubkey, profiles: new Map() };
    const ev = { id: 'ev1', kind: 1, pubkey: 'b'.repeat(64), content: 'test note', tags: [] };
    const nip19 = { npubEncode: (pk) => 'npub1' + pk };
    const settings = {};
    const settingsManager = { get: vi.fn() };

    const el = renderEvent(state, ev, nip19, settings, settingsManager, vi.fn(), vi.fn(), vi.fn());
    document.body.appendChild(el);

    const replyBtn = el.querySelector('.btn-reply');
    expect(replyBtn).not.toBeNull();

    // Click reply button
    replyBtn.click();

    expect(mocks.showToast).toHaveBeenCalled();
    expect(composer.hidden).toBe(true);
    expect(mocks.setReplyTarget).not.toHaveBeenCalled();
    expect(noteInput.value).toBe('');
  });
});
