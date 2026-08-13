import { getClosestRelays } from '../relay/geo-relay-directory.js';

function isBitchatActive(doc) {
  const activeTabEl = doc.querySelector('.tab.active');
  return activeTabEl?.dataset?.tab === 'bitchat';
}

export function shouldConnectOmochatOnBoot(settingsManager, doc = document) {
  try {
    if (settingsManager.get('showHomeOmochat') === true) return true;
    if (settingsManager.get('showOmochat') !== false) return true;
    return isBitchatActive(doc);
  } catch (_e) {
    return false;
  }
}

export function shouldLoadOmochatHistory(settingsManager, doc = document) {
  try {
    if (settingsManager.get('showHomeOmochat') === true) return true;
    return isBitchatActive(doc);
  } catch (_e) {
    return false;
  }
}

export async function refreshClosestOmochatRelays(settingsManager, geohash) {
  if (settingsManager.get('omochatAutoRelays') === false) return false;

  const targetGeohash = geohash || settingsManager.get('omochatGeohash') || 'xn';
  try {
    const algorithm = settingsManager.get('omochatAutoRelayAlgo') || 'merged';
    const mergeParent = settingsManager.get('omochatMergeParent') === true;
    const relays = await getClosestRelays(targetGeohash, 5, algorithm, mergeParent);
    if (!Array.isArray(relays) || relays.length === 0) return false;
    settingsManager.set('omochatComputedRelays', relays);
    return true;
  } catch (error) {
    console.error('[Omochat] 最寄りリレーの取得に失敗しました:', error);
    return false;
  }
}
