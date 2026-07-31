/**
 * NIP-05 Identifier Verification Helper
 * NIP-05 アドレスの検証を行うモジュール
 */

const nip05Cache = new Map();

/**
 * NIP-05 アドレスを parse して { name, domain } を返す
 * @param {string} nip05Str
 * @returns {{ name: string, domain: string } | null}
 */
export function parseNip05(nip05Str) {
  if (!nip05Str || typeof nip05Str !== 'string') return null;
  const trimmed = nip05Str.trim().toLowerCase();
  if (!trimmed) return null;

  if (trimmed.includes('@')) {
    const parts = trimmed.split('@');
    if (parts.length !== 2) return null;
    const name = parts[0].trim();
    const domain = parts[1].trim();
    if (!name || !domain) return null;
    return { name, domain };
  } else {
    return { name: '_', domain: trimmed };
  }
}

/**
 * NIP-05 表示用文字列の成形
 * NIP-05 仕様に従い `_@domain.com` の場合は `domain.com` として表示
 * @param {string} nip05Str
 * @returns {string}
 */
export function formatNip05Display(nip05Str) {
  if (!nip05Str || typeof nip05Str !== 'string') return '';
  const trimmed = nip05Str.trim();
  if (trimmed.startsWith('_@')) {
    return trimmed.slice(2);
  }
  return trimmed;
}

/**
 * NIP-05 アドレスが pubkey と一致するか検証
 * @param {string} nip05Str
 * @param {string} pubkey
 * @returns {Promise<{ valid: boolean, error?: string }>}
 */
export async function verifyNip05(nip05Str, pubkey) {
  if (!nip05Str || !pubkey) return { valid: false, error: 'invalid_params' };

  const parsed = parseNip05(nip05Str);
  if (!parsed) return { valid: false, error: 'invalid_format' };

  const cacheKey = `${pubkey.toLowerCase()}:${nip05Str.toLowerCase()}`;
  if (nip05Cache.has(cacheKey)) {
    return nip05Cache.get(cacheKey);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const url = `https://${parsed.domain}/.well-known/nostr.json?name=${encodeURIComponent(parsed.name)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const result = { valid: false, error: `HTTP ${res.status}` };
      nip05Cache.set(cacheKey, result);
      return result;
    }

    const data = await res.json();
    if (data && data.names && typeof data.names === 'object') {
      const expectedPubkey = data.names[parsed.name];
      if (expectedPubkey && String(expectedPubkey).toLowerCase() === String(pubkey).toLowerCase()) {
        const result = { valid: true };
        nip05Cache.set(cacheKey, result);
        return result;
      }
    }

    const result = { valid: false, error: 'mismatch' };
    nip05Cache.set(cacheKey, result);
    return result;
  } catch (err) {
    const result = { valid: false, error: err.name === 'AbortError' ? 'timeout' : 'fetch_error' };
    nip05Cache.set(cacheKey, result);
    return result;
  }
}
