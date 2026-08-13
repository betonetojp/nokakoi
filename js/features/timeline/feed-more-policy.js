// in-flight 排他と枯渇判定で暴走を防ぐため、成功ページ間に固定待機は設けない。
export const AUTO_MORE_COOLDOWN_MS = 0;

export function canStartMore(loadState, manual = false, now = Date.now()) {
  if (!loadState || loadState.loadingMore) return false;
  if (manual) return true;
  if (loadState.autoFetchFailed) return false;
  return now >= (loadState.nextAutoMoreAt || 0);
}

export function markMoreStarted(loadState, manual = false, now = Date.now()) {
  if (!loadState) return;
  loadState.loadingMore = true;
  if (manual) loadState.autoFetchFailed = false;
  else loadState.nextAutoMoreAt = now + AUTO_MORE_COOLDOWN_MS;
}

export function markMoreFinished(loadState, appendedCount, now = Date.now()) {
  if (!loadState) return;
  loadState.loadingMore = false;
  if (!(appendedCount > 0)) {
    loadState.autoFetchFailed = true;
    return;
  }
  loadState.autoFetchFailed = false;
  loadState.nextAutoMoreAt = now + AUTO_MORE_COOLDOWN_MS;
}

export function resetAutoMoreState(loadState, now = Date.now(), afterHistory = false) {
  if (!loadState) return;
  loadState.autoFetchFailed = false;
  loadState.nextAutoMoreAt = afterHistory ? now + AUTO_MORE_COOLDOWN_MS : 0;
}
