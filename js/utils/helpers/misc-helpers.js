export async function awaitAny(promises, fallbackTimeoutMs = 4000) {
  if (!promises || !promises.length) return Promise.resolve();

  // 1つでも成功すれば即座に resolve（最速）
  const anyPromise = (typeof Promise.any === 'function')
    ? Promise.any(promises)
    : Promise.race(promises);

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
    // 全リレーが即時 reject（エラー）された場合：
    // 単に「publish timed out」で reject されただけなら、リレーの応答遅延（実は受理されている）とみなして救済
    const isTimeoutOnly = err && (
      err.message === 'publish timed out' ||
      (Array.isArray(err.errors) && err.errors.length > 0 && err.errors.every(e => (e && e.message === 'publish timed out') || String(e).includes('timed out')))
    );
    if (isTimeoutOnly) {
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
