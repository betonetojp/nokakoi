export async function awaitAny(promises) {
  if (!promises || !promises.length) return Promise.resolve();
  // Promise.any: 1つでも成功すれば resolve。全失敗時は AggregateError を throw（偽成功にしない）
  if (typeof Promise.any === 'function') return Promise.any(promises);
  return Promise.race(promises);
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
