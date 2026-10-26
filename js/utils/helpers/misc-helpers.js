export async function awaitAny(promises, fallbackTimeoutMs = 4000) {
  if (!promises || !promises.length) return Promise.resolve();

  // nostr-tools の pool.publish は ensureRelay 接続失敗時に reject ではなく
  // "connection failure: ..." 文字列を resolve するため、エラーとして正規化
  const sanitizedPromises = promises.map(p => Promise.resolve(p).then(res => {
    if (typeof res === 'string' && res.startsWith('connection failure: ')) {
      throw new Error(res);
    }
    return res;
  }));

  // 1つでも成功すれば即座に resolve（最速）
  const anyPromise = (typeof Promise.any === 'function')
    ? Promise.any(sanitizedPromises)
    : Promise.race(sanitizedPromises);

  // fallbackTimeoutMs が先に解決した後に anyPromise が遅延 reject された際の
  // unhandledrejection（未処理例外）を確実に防止
  anyPromise.catch(() => {});

  // 指定ミリ秒（既定4秒）経過してもリレーからOK/NGが来ない、あるいは重いリレーで
  // nostr-tools の短時間タイムアウト (4.4s) により全 reject された場合のセーフティ。
  // 送信（send）自体は同期的にソケットへ書き込まれているため、遅延リレーでの「実は届いていた」を救済する。
  let timerId;
  const timeoutPromise = new Promise((resolve) => {
    timerId = setTimeout(() => {
      resolve({ delayed: true });
    }, fallbackTimeoutMs);
  });

  try {
    const res = await Promise.race([anyPromise, timeoutPromise]);
    if (timerId) clearTimeout(timerId);
    return res;
  } catch (err) {
    if (timerId) clearTimeout(timerId);
    // 全リレーが reject された場合：
    // 単に「publish timed out」または接続失敗が混在しているだけなら、リレーの応答遅延（socket には送信済み）とみなして救済。
    // ただし、全リレー接続失敗（オフライン等）や、明示的な拒絶（blocked, invalid 等）は偽成功にせず再 throw する。
    const errors = Array.isArray(err?.errors) ? err.errors : [err];
    const hasExplicitRejection = errors.some(e => {
      const msg = (e && e.message) ? e.message : String(e);
      return !msg.includes('publish timed out') && !msg.includes('timed out') && !msg.startsWith('connection failure: ');
    });
    const hasTimeout = errors.some(e => {
      const msg = (e && e.message) ? e.message : String(e);
      return msg.includes('publish timed out') || msg.includes('timed out');
    });
    if (!hasExplicitRejection && hasTimeout) {
      return { delayed: true };
    }
    throw err;
  }
}

export function uniqueRelays(list) {
  const seen = new Set();
  const out = [];
  for (const r of list) {
    if (typeof r !== 'string') continue;
    const key = r.replace(/\/$/, '');
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function logWarn(...args) {
  try {
    if (typeof window !== 'undefined' && window.__nokakoiDebug) {
      console.warn('[Debug]', ...args);
    }
  } catch (e) { }
}

export function debounce(fn, ms = 300) {
  let to = null;
  return function (...args) {
    if (to) clearTimeout(to);
    to = setTimeout(() => fn.apply(this, args), ms);
  };
}
