import { describe, expect, it } from 'vitest';
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

  it('strips a trailing slash and a nostr: prefix', () => {
    expect(extractDeepLinkBech32('/app/nevent1qqexample/')).toBe('nevent1qqexample');
    expect(extractDeepLinkBech32('/app/nostr:npub1abc')).toBe('npub1abc');
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
