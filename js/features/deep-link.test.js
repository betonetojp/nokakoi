import { describe, expect, it, vi } from 'vitest';
import { nip19 } from 'nostr-tools';
import { extractDeepLinkBech32, parseDeepLinkBech32, parseDeepLinkFromPathname, appRootPathFromDeepLink } from './deep-link.js';

const PUBKEY = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
const EVENT_ID = '6c815df9b3eb2c6cf5c3c2347b81e1e9a3615b110ac30ea0343f07a866a873e7';

describe('extractDeepLinkBech32', () => {
  it('reads nevent1 from /app/ and /nokakoi/', () => {
    expect(extractDeepLinkBech32('/app/nevent1qqexample')).toBe('nevent1qqexample');
    expect(extractDeepLinkBech32('/nokakoi/nevent1qqexample')).toBe('nevent1qqexample');
  });

  it('reads npub1, note1, and nprofile1', () => {
    expect(extractDeepLinkBech32('/app/npub1abc')).toBe('npub1abc');
    expect(extractDeepLinkBech32('/app/note1abc')).toBe('note1abc');
    expect(extractDeepLinkBech32('/app/nprofile1abc')).toBe('nprofile1abc');
  });

  it('reads bech32 from url hash including prefix like #npub:', () => {
    expect(extractDeepLinkBech32('#npub:npub1abc')).toBe('npub1abc');
    expect(extractDeepLinkBech32('#nprofile:nprofile1abc')).toBe('nprofile1abc');
    expect(extractDeepLinkBech32('#npub1abc')).toBe('npub1abc');
  });

  it('strips a trailing slash and a nostr: prefix', () => {
    expect(extractDeepLinkBech32('/app/nevent1qqexample/')).toBe('nevent1qqexample');
    expect(extractDeepLinkBech32('/app/nostr:npub1abc')).toBe('npub1abc');
    expect(extractDeepLinkBech32('#nostr:npub1abc')).toBe('npub1abc');
  });

  it('ignores gyouza, assets, nsec, and naddr', () => {
    expect(extractDeepLinkBech32('/app/gyouza/')).toBeNull();
    expect(extractDeepLinkBech32('/app/assets/foo.js')).toBeNull();
    expect(extractDeepLinkBech32('/app/nsec1secret')).toBeNull();
    expect(extractDeepLinkBech32('/app/naddr1qqexample')).toBeNull();
  });
});

describe('parseDeepLinkBech32', () => {
  it('decodes npub and nprofile to a profile link', () => {
    const npub = nip19.npubEncode(PUBKEY);
    expect(parseDeepLinkBech32(npub, nip19)).toEqual({
      kind: 'profile',
      pubkey: PUBKEY,
      relays: []
    });

    const nprofile = nip19.nprofileEncode({ pubkey: PUBKEY, relays: ['wss://relay.example'] });
    expect(parseDeepLinkBech32(nprofile, nip19)).toEqual({
      kind: 'profile',
      pubkey: PUBKEY,
      relays: ['wss://relay.example']
    });
  });

  it('decodes note and nevent to an event link', () => {
    const note = nip19.noteEncode(EVENT_ID);
    expect(parseDeepLinkBech32(note, nip19)).toEqual({
      kind: 'event',
      eventId: EVENT_ID,
      relays: []
    });

    const nevent = nip19.neventEncode({
      id: EVENT_ID,
      relays: ['wss://relay.example', 'not-a-relay']
    });
    expect(parseDeepLinkBech32(nevent, nip19)).toEqual({
      kind: 'event',
      eventId: EVENT_ID,
      relays: ['wss://relay.example']
    });
  });

  it('rejects nsec even if decode would succeed', () => {
    const nsec = nip19.nsecEncode(new Uint8Array(32).fill(1));
    expect(extractDeepLinkBech32('/app/' + nsec)).toBeNull();
    expect(parseDeepLinkBech32(nsec, nip19)).toBeNull();
  });

  it('returns null for invalid bech32', () => {
    expect(parseDeepLinkBech32('nevent1notvalid', nip19)).toBeNull();
  });
});

describe('parseDeepLinkFromPathname', () => {
  it('parses a production-style npub path', () => {
    const npub = nip19.npubEncode(PUBKEY);
    expect(parseDeepLinkFromPathname('/app/' + npub, nip19)).toEqual({
      kind: 'profile',
      pubkey: PUBKEY,
      relays: []
    });
  });
});

describe('appRootPathFromDeepLink', () => {
  it('strips the bech32 segment and keeps the app base', () => {
    expect(appRootPathFromDeepLink('/app/nevent1qqexample')).toBe('/app/');
    expect(appRootPathFromDeepLink('/nokakoi/npub1abc')).toBe('/nokakoi/');
    expect(appRootPathFromDeepLink('/nevent1qqexample')).toBe('/');
    expect(appRootPathFromDeepLink('/app/nevent1qqexample/')).toBe('/app/');
  });

  it('returns null when the path is not a deep link', () => {
    expect(appRootPathFromDeepLink('/app/')).toBeNull();
    expect(appRootPathFromDeepLink('/app/gyouza/')).toBeNull();
  });
});

describe('extractChannelRootIdFromEvent', () => {
  it('extracts event.id for kind:40', async () => {
    const { extractChannelRootIdFromEvent } = await import('./deep-link.js');
    expect(extractChannelRootIdFromEvent({ id: 'channel_root_123', kind: 40 })).toBe('channel_root_123');
  });

  it('extracts root e-tag for kind:41', async () => {
    const { extractChannelRootIdFromEvent } = await import('./deep-link.js');
    const evWithRoot = {
      id: 'meta_41',
      kind: 41,
      tags: [['e', 'other_id', '', 'mention'], ['e', 'channel_root_456', '', 'root']]
    };
    expect(extractChannelRootIdFromEvent(evWithRoot)).toBe('channel_root_456');

    const evFirstTag = {
      id: 'meta_41_b',
      kind: 41,
      tags: [['e', 'channel_root_789']]
    };
    expect(extractChannelRootIdFromEvent(evFirstTag)).toBe('channel_root_789');
  });

  it('returns null for non-channel kinds or missing tags', async () => {
    const { extractChannelRootIdFromEvent } = await import('./deep-link.js');
    expect(extractChannelRootIdFromEvent({ id: 'note_1', kind: 1 })).toBeNull();
    expect(extractChannelRootIdFromEvent({ id: 'msg_42', kind: 42 })).toBeNull();
    expect(extractChannelRootIdFromEvent(null)).toBeNull();
  });
});

describe('openDeepLink routing', () => {
  it('calls openChannel for kind:40 event', async () => {
    const { openDeepLink } = await import('./deep-link.js');
    const rootId = '11'.repeat(32);
    const nevent = nip19.neventEncode({ id: rootId });
    const fakeState = {
      feeds: { home: { events: [], map: new Map([[rootId, { id: rootId, kind: 40 }]]) } }
    };
    const openChannel = vi.fn().mockResolvedValue(true);
    const showEventModal = vi.fn();

    const handled = await openDeepLink(fakeState, {
      pathname: '/app/' + nevent,
      nip19,
      openChannel,
      showEventModal
    });

    expect(handled).toBe(true);
    expect(openChannel).toHaveBeenCalledWith(rootId, expect.objectContaining({ id: rootId, kind: 40 }));
    expect(showEventModal).not.toHaveBeenCalled();
  });

  it('calls openChannel for kind:41 event with root e-tag', async () => {
    const { openDeepLink } = await import('./deep-link.js');
    const metaId = '22'.repeat(32);
    const rootId = '33'.repeat(32);
    const nevent = nip19.neventEncode({ id: metaId });
    const fakeState = {
      feeds: {
        home: {
          events: [],
          map: new Map([[metaId, { id: metaId, kind: 41, tags: [['e', rootId, '', 'root']] }]])
        }
      }
    };
    const openChannel = vi.fn().mockResolvedValue(true);
    const showEventModal = vi.fn();

    const handled = await openDeepLink(fakeState, {
      pathname: '/app/' + nevent,
      nip19,
      openChannel,
      showEventModal
    });

    expect(handled).toBe(true);
    expect(openChannel).toHaveBeenCalledWith(rootId, expect.objectContaining({ id: metaId, kind: 41 }));
    expect(showEventModal).not.toHaveBeenCalled();
  });

  it('calls showEventModal for kind:42 message event', async () => {
    const { openDeepLink } = await import('./deep-link.js');
    const msgId = '44'.repeat(32);
    const nevent = nip19.neventEncode({ id: msgId });
    const fakeState = {
      feeds: {
        home: {
          events: [],
          map: new Map([[msgId, { id: msgId, kind: 42, content: 'hello' }]])
        }
      }
    };
    const openChannel = vi.fn();
    const showEventModal = vi.fn();

    const handled = await openDeepLink(fakeState, {
      pathname: '/app/' + nevent,
      nip19,
      openChannel,
      showEventModal
    });

    expect(handled).toBe(true);
    expect(openChannel).not.toHaveBeenCalled();
    expect(showEventModal).toHaveBeenCalledWith(expect.objectContaining({ id: msgId, kind: 42 }));
  });

  it('calls showEventModal for standard kind:1 post', async () => {
    const { openDeepLink } = await import('./deep-link.js');
    const noteId = '55'.repeat(32);
    const nevent = nip19.neventEncode({ id: noteId });
    const fakeState = {
      feeds: {
        home: {
          events: [],
          map: new Map([[noteId, { id: noteId, kind: 1, content: 'standard note' }]])
        }
      }
    };
    const openChannel = vi.fn();
    const showEventModal = vi.fn();

    const handled = await openDeepLink(fakeState, {
      pathname: '/app/' + nevent,
      nip19,
      openChannel,
      showEventModal
    });

    expect(handled).toBe(true);
    expect(openChannel).not.toHaveBeenCalled();
    expect(showEventModal).toHaveBeenCalledWith(expect.objectContaining({ id: noteId, kind: 1 }));
  });

  it('calls showProfileModal when deep link is provided in hash', async () => {
    const { openDeepLink } = await import('./deep-link.js');
    const npub = nip19.npubEncode(PUBKEY);
    const fakeState = {};
    const showProfileModal = vi.fn();

    const handled = await openDeepLink(fakeState, {
      pathname: '/app/',
      hash: '#npub:' + npub,
      nip19,
      showProfileModal
    });

    expect(handled).toBe(true);
    expect(showProfileModal).toHaveBeenCalledWith(PUBKEY);
  });
});
