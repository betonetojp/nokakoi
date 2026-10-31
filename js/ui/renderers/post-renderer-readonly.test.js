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

import { renderEvent, setupReplyButton, setupRepostButton } from './post-renderer.js';

describe('post-renderer read-only UI hiding and guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="composer" hidden>
        <textarea id="noteInput"></textarea>
      </div>
    `;
    localStorage.clear();
  });

  it('hides unusable action buttons (quote, reply, repost, react, zap) for read-only account', () => {
    const pubkey = 'a'.repeat(64);
    localStorage.setItem('pubkey', pubkey);
    const state = { signer: 'read-only', pubkey, profiles: new Map() };
    const ev = { id: 'ev1', kind: 1, pubkey: 'b'.repeat(64), content: 'test note', tags: [] };
    const nip19 = { npubEncode: (pk) => 'npub1' + pk };
    const settings = {};
    const settingsManager = { get: vi.fn() };

    const el = renderEvent(state, ev, nip19, settings, settingsManager, vi.fn(), vi.fn(), vi.fn());
    document.body.appendChild(el);

    expect(el.querySelector('.btn-quote')).toBeNull();
    expect(el.querySelector('.btn-reply')).toBeNull();
    expect(el.querySelector('.btn-repost')).toBeNull();
    expect(el.querySelector('.btn-react')).toBeNull();
    expect(el.querySelector('.btn-zap')).toBeNull();
  });

  it('shows action buttons for normal logged in account', () => {
    const pubkey = 'a'.repeat(64);
    localStorage.setItem('pubkey', pubkey);
    const state = { signer: 'nsec', pubkey, profiles: new Map() };
    const ev = { id: 'ev1', kind: 1, pubkey: 'b'.repeat(64), content: 'test note', tags: [] };
    const nip19 = { npubEncode: (pk) => 'npub1' + pk };
    const settings = {};
    const settingsManager = { get: vi.fn() };

    const el = renderEvent(state, ev, nip19, settings, settingsManager, vi.fn(), vi.fn(), vi.fn());
    document.body.appendChild(el);

    expect(el.querySelector('.btn-quote')).not.toBeNull();
    expect(el.querySelector('.btn-reply')).not.toBeNull();
    expect(el.querySelector('.btn-repost')).not.toBeNull();
    expect(el.querySelector('.btn-react')).not.toBeNull();
  });

  it('prevents bubbling (stopPropagation) and displays single toast when setupReplyButton is invoked for read-only account', () => {
    const pubkey = 'a'.repeat(64);
    const state = { signer: 'read-only', pubkey, profiles: new Map() };
    const ev = { id: 'ev1', kind: 1, pubkey: 'b'.repeat(64), content: 'test note', tags: [] };

    const container = document.createElement('div');
    container.innerHTML = '<button class="btn-reply">Reply</button>';
    setupReplyButton(container, ev, vi.fn(), state);

    const btn = container.querySelector('.btn-reply');
    const fakeEvent = {
      stopPropagation: vi.fn()
    };

    btn.onclick(fakeEvent);

    expect(fakeEvent.stopPropagation).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
  });

  it('prevents bubbling (stopPropagation) and displays single toast when setupRepostButton is invoked for read-only account', async () => {
    const pubkey = 'a'.repeat(64);
    const state = { signer: 'read-only', pubkey, profiles: new Map() };
    const ev = { id: 'ev1', kind: 1, pubkey: 'b'.repeat(64), content: 'test note', tags: [] };

    const container = document.createElement('div');
    container.innerHTML = '<button class="btn-repost">Repost</button>';
    setupRepostButton(container, ev, vi.fn(), state);

    const btn = container.querySelector('.btn-repost');
    const fakeEvent = {
      stopPropagation: vi.fn()
    };

    await btn.onclick(fakeEvent);

    expect(fakeEvent.stopPropagation).toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledTimes(1);
  });
});
