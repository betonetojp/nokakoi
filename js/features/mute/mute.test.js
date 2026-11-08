import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  subOnce: vi.fn(),
  signer: {
    hasKey: vi.fn(() => false),
    nip04Decrypt: vi.fn(),
    nip44Decrypt: vi.fn()
  }
}));

vi.mock('../../core/nostr-compat.js', () => ({
  getNip04: vi.fn(() => null),
  getNip44: vi.fn(() => null),
  hexToBytes: vi.fn()
}));
vi.mock('../../core/relay.js', () => ({
  getReadRelays: vi.fn(() => ['wss://relay.example']),
  subOnce: mocks.subOnce
}));
vi.mock('../../utils/i18n.js', () => ({ t: vi.fn((key) => key), applyTranslations: vi.fn() }));
vi.mock('../../ui/ehagaki-autoclose.js', () => ({
  addAutoCloseCheckbox: vi.fn(),
  waitForEhagakiPublish: vi.fn()
}));
vi.mock('../../ui/renderers/render-helpers.js', () => ({
  refreshEventsMuteState: vi.fn(),
  invalidateMuteConfigCache: vi.fn()
}));
vi.mock('../../core/signer.js', () => ({ signer: mocks.signer }));

import {
  fetchMuteList,
  getMuteSetting,
  loadMuteListForAccount,
  setMuteSetting
} from './mute.js';

function storageMock() {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.has(key) ? values.get(key) : null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key))
  };
}

describe('mute list diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const localStorage = storageMock();
    localStorage.setItem('pubkey', 'author');
    globalThis.localStorage = localStorage;
    globalThis.document = {
      documentElement: { scrollTop: 0 },
      body: { scrollTop: 0 },
      getElementById: vi.fn(() => null)
    };
    globalThis.CustomEvent = class {
      constructor(type) { this.type = type; }
    };
    globalThis.window = {
      __nokakoiDebug: true,
      scrollY: 0,
      scrollTo: vi.fn(),
      dispatchEvent: vi.fn(),
      nostr: {
        nip44: {
          decrypt: vi.fn(async () => JSON.stringify([['p', 'private-target'], ['word', 'secret-word']]))
        }
      }
    };
  });

  it('treats extension decryption as deferred and never logs private raw data', async () => {
    let handlers;
    const unsubscribe = vi.fn();
    mocks.subOnce.mockImplementation((_state, _key, _filters, callback) => {
      handlers = callback;
      return unsubscribe;
    });
    const state = {
      pool: {},
      relays: ['wss://relay.example'],
      signer: 'nip07',
      pubkey: 'author'
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const pending = fetchMuteList(state, () => null, vi.fn());
    handlers({
      id: 'encrypted-event',
      pubkey: 'author',
      created_at: 10,
      tags: [],
      content: 'encrypted-payload-that-is-not-public-and-is-long-enough'
    }, 'wss://relay.example', false);
    handlers(null, 'wss://relay.example', true);
    await pending;

    const output = [...log.mock.calls, ...debug.mock.calls, ...warn.mock.calls]
      .map((args) => JSON.stringify(args))
      .join('\n');
    expect(output).not.toContain('private-target');
    expect(output).not.toContain('secret-word');
    expect(output).not.toContain('encrypted-payload');
    expect(output).not.toContain('解析/解釈に失敗');
    expect(output).not.toContain('検出した暗号化形式');
    expect(output).not.toContain('complete');
    expect(output).not.toContain('deferred-decrypt');
    expect(output.match(/復号要約/g)).toHaveLength(1);
    expect(mocks.subOnce).toHaveBeenCalledWith(
      state,
      'mute-list:author',
      [{ kinds: [10000], authors: ['author'], limit: 10 }],
      expect.any(Function),
      ['wss://relay.example']
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    const expanded = JSON.parse(localStorage.getItem('muteList_expanded'));
    expect(expanded.pubkeys.private).toContain('private-target');
    expect(expanded.words.private).toContain('secret-word');
    expect(JSON.parse(localStorage.getItem('muteList_expanded.author'))).toEqual(expanded);
  });

  it('discards deferred decrypt completion after an account switch', async () => {
    let handlers;
    let resolveDecrypt;
    const decryptPending = new Promise(resolve => { resolveDecrypt = resolve; });
    window.nostr.nip44.decrypt.mockReturnValue(decryptPending);
    mocks.subOnce.mockImplementation((_state, _key, _filters, callback) => {
      handlers = callback;
      return vi.fn();
    });
    const state = {
      pool: {},
      relays: ['wss://relay.example'],
      signer: 'nip07',
      pubkey: 'author'
    };
    const renderFeed = vi.fn();

    const pending = fetchMuteList(state, () => null, renderFeed);
    handlers({
      id: 'encrypted-event',
      pubkey: 'author',
      created_at: 10,
      tags: [],
      content: 'encrypted-payload-that-is-not-public-and-is-long-enough'
    }, 'wss://relay.example', false);
    handlers(null, 'wss://relay.example', true);
    await vi.waitFor(() => expect(window.nostr.nip44.decrypt).toHaveBeenCalled());

    localStorage.setItem('pubkey', 'account-b');
    state.pubkey = 'account-b';
    loadMuteListForAccount('account-b');
    renderFeed.mockClear();
    localStorage.setItem.mockClear();
    window.dispatchEvent.mockClear();

    resolveDecrypt(JSON.stringify([['p', 'account-a-private']]));
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'stale' });

    expect(localStorage.setItem).not.toHaveBeenCalledWith(
      'muteList_expanded.author',
      expect.stringContaining('account-a-private')
    );
    expect(window.__nokakoiMuteList).toBeNull();
    expect(renderFeed).not.toHaveBeenCalled();
    expect(window.dispatchEvent).not.toHaveBeenCalled();
  });

  it('settles through the safety timeout when a managed request stays queued', async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    mocks.subOnce.mockReturnValue(unsubscribe);
    const state = {
      pool: {},
      relays: ['wss://relay.example'],
      signer: 'nip07',
      pubkey: 'author'
    };

    const pending = fetchMuteList(state, () => null, vi.fn());
    await vi.advanceTimersByTimeAsync(4000);

    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'not_found' });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('keeps apply settings scoped and migrates a legacy value only once', () => {
    localStorage.setItem('mute_apply', '0');

    expect(getMuteSetting('mute_apply', '1')).toBe('0');
    expect(localStorage.getItem('mute_apply.author')).toBe('0');

    localStorage.setItem('pubkey', 'account-b');
    expect(getMuteSetting('mute_apply', '1')).toBe('1');
    expect(localStorage.getItem('mute_apply.account-b')).toBeNull();

    setMuteSetting('mute_apply', '0');
    expect(localStorage.getItem('mute_apply.account-b')).toBe('0');
    expect(localStorage.getItem('mute_apply')).toBe('0');
  });

  it('fetches only public mutes without decryption challenge for read-only account', async () => {
    const pubkey = 'readonly_user_pk';
    localStorage.setItem('pubkey', pubkey);

    const kind10000Event = {
      id: 'mute_ev_1',
      kind: 10000,
      pubkey: pubkey,
      created_at: 1000,
      tags: [
        ['p', 'muted_user_1'],
        ['word', 'badword']
      ],
      content: '?iv=encrypted_content_payload'
    };

    mocks.subOnce.mockImplementation((state, subId, filters, onEvent) => {
      onEvent(kind10000Event, 'wss://relay.example', true);
      return vi.fn();
    });

    const statusEl = { textContent: '' };
    const countsWrap = { hidden: true };
    const pubPubEl = { textContent: '' };
    const pubPrivEl = { textContent: '' };
    const wordPubEl = { textContent: '' };
    const wordPrivEl = { textContent: '' };

    const state = {
      pool: {},
      relays: ['wss://relay.example'],
      signer: 'read-only',
      pubkey: pubkey
    };

    const renderFeed = vi.fn();

    await fetchMuteList(state, () => null, renderFeed, {
      status: statusEl,
      countsWrap,
      pubPubEl,
      pubPrivEl,
      wordPubEl,
      wordPrivEl
    });

    // Decryption should be skipped
    expect(mocks.signer.nip44Decrypt).not.toHaveBeenCalled();
    expect(mocks.signer.nip04Decrypt).not.toHaveBeenCalled();

    // Counts should reflect public mutes only
    expect(pubPubEl.textContent).toBe(1);
    expect(pubPrivEl.textContent).toBe(0);
    expect(wordPubEl.textContent).toBe(1);
    expect(wordPrivEl.textContent).toBe(0);
    expect(countsWrap.hidden).toBe(false);

    // Status message
    expect(statusEl.textContent).toBe('mute.fetch.done_public_only');

    // Mute list should be saved
    const savedExpandedRaw = localStorage.getItem(`muteList_expanded.${pubkey}`);
    expect(savedExpandedRaw).not.toBeNull();
    const saved = JSON.parse(savedExpandedRaw);
    expect(saved.pubkeys.public).toContain('muted_user_1');
    expect(saved.words.public).toContain('badword');
    expect(saved.pubkeys.private).toHaveLength(0);
    expect(saved.words.private).toHaveLength(0);

    // Feed should be re-rendered
    expect(renderFeed).toHaveBeenCalled();
  });

  it('preserves existing mute list in storage and memory when kind 10000 fetch returns no events', async () => {
    const existing = {
      pubkeys: { public: ['pub-user-1'], private: ['priv-user-1'] },
      words: { public: ['pub-word'], private: ['priv-word'] }
    };
    localStorage.setItem('muteList_expanded.author', JSON.stringify(existing));
    localStorage.setItem('muteList_expanded', JSON.stringify(existing));
    window.__nokakoiMuteList = existing;

    mocks.subOnce.mockImplementation((_state, _subId, _filters, onEvent) => {
      onEvent(null, 'wss://relay.example', true);
      return vi.fn();
    });

    const pubPubEl = { textContent: '' };
    const pubPrivEl = { textContent: '' };
    const wordPubEl = { textContent: '' };
    const wordPrivEl = { textContent: '' };
    const countsWrap = { hidden: true };

    const state = {
      pool: {},
      relays: ['wss://relay.example'],
      signer: 'nsec',
      pubkey: 'author'
    };

    const res = await fetchMuteList(state, () => null, vi.fn(), {
      countsWrap,
      pubPubEl,
      pubPrivEl,
      wordPubEl,
      wordPrivEl
    });

    expect(res).toMatchObject({ ok: false, reason: 'not_found' });
    expect(window.__nokakoiMuteList).toEqual(existing);
    expect(JSON.parse(localStorage.getItem('muteList_expanded.author'))).toEqual(existing);
    expect(JSON.parse(localStorage.getItem('muteList_expanded'))).toEqual(existing);
    expect(pubPubEl.textContent).toBe(1);
    expect(pubPrivEl.textContent).toBe(1);
    expect(wordPubEl.textContent).toBe(1);
    expect(wordPrivEl.textContent).toBe(1);
    expect(countsWrap.hidden).toBe(false);
  });

  it('saves synchronously decrypted private mutes to localStorage for nsec/passkey signer', async () => {
    const nostrCompat = await import('../../core/nostr-compat.js');
    nostrCompat.getNip44.mockReturnValueOnce({ v2: {} });
    mocks.signer.hasKey.mockReturnValueOnce(true).mockReturnValueOnce(true);
    mocks.signer.nip44Decrypt.mockReturnValueOnce(
      JSON.stringify([['p', 'priv-user-nsec'], ['word', 'priv-word-nsec']])
    );

    mocks.subOnce.mockImplementation((_state, _subId, _filters, onEvent) => {
      onEvent({
        id: 'nsec-mute-ev',
        kind: 10000,
        pubkey: 'author',
        created_at: 200,
        tags: [['p', 'pub-user-nsec']],
        content: 'encrypted-nip44-ciphertext-longer-than-forty-characters'
      }, 'wss://relay.example', true);
      return vi.fn();
    });

    const state = {
      pool: {},
      relays: ['wss://relay.example'],
      signer: 'nsec',
      pubkey: 'author'
    };

    const res = await fetchMuteList(state, () => null, vi.fn());
    expect(res).toMatchObject({ ok: true, reason: 'fetched' });

    const saved = JSON.parse(localStorage.getItem('muteList_expanded.author'));
    expect(saved.pubkeys.public).toEqual(['pub-user-nsec']);
    expect(saved.pubkeys.private).toEqual(['priv-user-nsec']);
    expect(saved.words.private).toEqual(['priv-word-nsec']);
    expect(window.__nokakoiMuteList).toEqual(saved);
  });

  it('preserves cached private mutes when deferred decryption fails on resume', async () => {
    const existing = {
      pubkeys: { public: ['old-pub'], private: ['cached-priv-user'] },
      words: { public: [], private: ['cached-priv-word'] }
    };
    localStorage.setItem('muteList_expanded.author', JSON.stringify(existing));
    localStorage.setItem('muteList_expanded', JSON.stringify(existing));
    window.__nokakoiMuteList = existing;

    window.nostr.nip44.decrypt.mockRejectedValue(new Error('decrypt timeout'));

    mocks.subOnce.mockImplementation((_state, _subId, _filters, onEvent) => {
      onEvent({
        id: 'encrypted-ev-2',
        kind: 10000,
        pubkey: 'author',
        created_at: 300,
        tags: [['p', 'new-pub']],
        content: 'encrypted-nip44-ciphertext-longer-than-forty-characters'
      }, 'wss://relay.example', true);
      return vi.fn();
    });

    const state = {
      pool: {},
      relays: ['wss://relay.example'],
      signer: 'nip07',
      pubkey: 'author'
    };

    await fetchMuteList(state, () => null, vi.fn());

    const saved = JSON.parse(localStorage.getItem('muteList_expanded.author'));
    expect(saved.pubkeys.public).toEqual(['new-pub']);
    expect(saved.pubkeys.private).toEqual(['cached-priv-user']);
    expect(saved.words.private).toEqual(['cached-priv-word']);
    expect(window.__nokakoiMuteList).toEqual(saved);
  });

});
