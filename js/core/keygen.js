/**
 * Key Generation Module
 * 新しいNostr秘密鍵ペアを生成
 */

import { getNip19, getPublicKey as getPublicKeyFn, generateSecretKey } from './nostr-compat.js';
import { bytesToHex } from './crypto.js';

/**
 * 新しい秘密鍵ペアを生成
 * @returns {{ skHex: string, nsec: string, pubkey: string, npub: string }}
 */
export function generateKeyPair() {
  const nip19 = getNip19();
  const getPublicKey = getPublicKeyFn();

  if (!generateSecretKey || !nip19 || !getPublicKey) {
    throw new Error('Nostr tools library is not ready');
  }

  const skBytes = generateSecretKey();
  const skHex = bytesToHex(skBytes);
  const nsec = nip19.nsecEncode(skBytes);
  const pubkey = getPublicKey(skBytes);
  const npub = nip19.npubEncode(pubkey);

  return { skHex, nsec, pubkey, npub };
}
