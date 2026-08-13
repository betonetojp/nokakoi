// Application-wide references that cannot yet be passed through every call boundary.
// Keep this module free of secrets: private keys remain inside signer.js closures.

const context = {
  state: null,
  settingsManager: null,
  updateTabVisibility: null,
  customEmojis: new Map(),
  scroll: {
    anchor: null,
    programmatic: false
  },
  debug: {
    enabled: false,
    buildInfo: '',
    relayInspector: null,
    relayConnectionLog: []
  }
};

export function configureAppContext(values = {}) {
  if (Object.prototype.hasOwnProperty.call(values, 'state')) context.state = values.state;
  if (Object.prototype.hasOwnProperty.call(values, 'settingsManager')) context.settingsManager = values.settingsManager;
  if (Object.prototype.hasOwnProperty.call(values, 'updateTabVisibility')) {
    context.updateTabVisibility = values.updateTabVisibility;
  }
  if (values.customEmojis instanceof Map) context.customEmojis = values.customEmojis;
  return context;
}

export function getAppState() {
  return context.state;
}

export function getSettingsManager() {
  return context.settingsManager;
}

export function updateTabVisibility(isLoggedIn) {
  if (typeof context.updateTabVisibility === 'function') {
    return context.updateTabVisibility(isLoggedIn);
  }
}

export function setCustomEmojis(customEmojis) {
  context.customEmojis = customEmojis instanceof Map ? customEmojis : new Map();
}

export function getCustomEmojis() {
  return context.customEmojis;
}

export function setScrollAnchor(anchor) {
  context.scroll.anchor = anchor || null;
}

export function getScrollAnchor() {
  return context.scroll.anchor;
}

export function setProgrammaticScroll(active) {
  context.scroll.programmatic = active === true;
}

export function isProgrammaticScroll() {
  return context.scroll.programmatic;
}

export function setDebugEnabled(enabled) {
  context.debug.enabled = enabled === true;
}

export function isDebugEnabled() {
  return context.debug.enabled;
}

export function setBuildInfo(buildInfo) {
  context.debug.buildInfo = String(buildInfo || '');
}

export function getBuildInfo() {
  return context.debug.buildInfo;
}

export function setRelayInspector(inspector) {
  context.debug.relayInspector = typeof inspector === 'function' ? inspector : null;
}

export function getRelayDebugInfo() {
  if (!context.debug.relayInspector) return null;
  return context.debug.relayInspector();
}

export function appendRelayConnectionLog(entry) {
  context.debug.relayConnectionLog.push(entry);
}

export function getRelayConnectionLog() {
  return context.debug.relayConnectionLog;
}

function defineDeprecatedBridge(target, name, get, set) {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  if (descriptor && descriptor.configurable === false) return;
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: false,
    get,
    set
  });
}

/**
 * Temporary compatibility for modules and browser-console tooling not migrated yet.
 * New application code must use this module's API instead of these window properties.
 */
export function installDeprecatedWindowBridges(target = typeof window !== 'undefined' ? window : null) {
  if (!target) return;

  if (target.__nostrState != null) context.state = target.__nostrState;
  if (target.settingsManager != null) context.settingsManager = target.settingsManager;
  if (typeof target.updateTabVisibility === 'function') context.updateTabVisibility = target.updateTabVisibility;
  if (target.__customEmojis instanceof Map) context.customEmojis = target.__customEmojis;
  if (typeof target.__nokakoiProgrammaticScroll === 'boolean') {
    context.scroll.programmatic = target.__nokakoiProgrammaticScroll;
  }
  if (target.__nokakoiScrollAnchor) context.scroll.anchor = target.__nokakoiScrollAnchor;
  if (typeof target.__nokakoiDebug === 'boolean') context.debug.enabled = target.__nokakoiDebug;
  if (target.__buildInfo) context.debug.buildInfo = String(target.__buildInfo);
  if (typeof target.__relayDebug === 'function') context.debug.relayInspector = target.__relayDebug;
  if (Array.isArray(target.__relayConnectionLog)) context.debug.relayConnectionLog = target.__relayConnectionLog;

  defineDeprecatedBridge(target, '__nostrState', () => context.state, value => { context.state = value; });
  defineDeprecatedBridge(target, 'settingsManager', () => context.settingsManager, value => { context.settingsManager = value; });
  defineDeprecatedBridge(target, 'updateTabVisibility', () => context.updateTabVisibility, value => { context.updateTabVisibility = value; });
  defineDeprecatedBridge(target, '__customEmojis', () => context.customEmojis, setCustomEmojis);
  defineDeprecatedBridge(target, '__nokakoiProgrammaticScroll', isProgrammaticScroll, setProgrammaticScroll);
  defineDeprecatedBridge(target, '__nokakoiScrollAnchor', getScrollAnchor, setScrollAnchor);
  defineDeprecatedBridge(target, '__nokakoiDebug', isDebugEnabled, setDebugEnabled);
  defineDeprecatedBridge(target, '__buildInfo', getBuildInfo, setBuildInfo);
  defineDeprecatedBridge(target, '__relayDebug', () => context.debug.relayInspector, setRelayInspector);
  defineDeprecatedBridge(target, '__relayConnectionLog', getRelayConnectionLog, value => {
    context.debug.relayConnectionLog = Array.isArray(value) ? value : [];
  });
}

export function resetAppContextForTests() {
  context.state = null;
  context.settingsManager = null;
  context.updateTabVisibility = null;
  context.customEmojis = new Map();
  context.scroll.anchor = null;
  context.scroll.programmatic = false;
  context.debug.enabled = false;
  context.debug.buildInfo = '';
  context.debug.relayInspector = null;
  context.debug.relayConnectionLog = [];
}
