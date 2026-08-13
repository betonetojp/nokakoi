import { setDebugEnabled } from '../core/app-context.js';

const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
let storedDebug = false;

try {
  storedDebug = localStorage.getItem('nokakoiDebug') === '1';
} catch {
  // Ignore unavailable storage.
}

const debugEnabled = isLocal || storedDebug;
setDebugEnabled(debugEnabled);

try {
  if (!window.__nokakoiConsoleWrapped) {
    const hasPrefix = (message) => typeof message === 'string' && /^\[[^\]]+\]/.test(message);
    const withDefaultPrefix = (args) => {
      if (!args || args.length === 0) return ['[App]'];
      if (hasPrefix(args[0])) return args;
      if (typeof args[0] === 'string') return [`[App] ${args[0]}`, ...args.slice(1)];
      return ['[App]', ...args];
    };
    const originalWarn = typeof console.warn === 'function' ? console.warn.bind(console) : null;
    const originalError = typeof console.error === 'function' ? console.error.bind(console) : null;
    if (originalWarn) console.warn = (...args) => originalWarn(...withDefaultPrefix(args));
    if (originalError) console.error = (...args) => originalError(...withDefaultPrefix(args));
    window.__nokakoiConsoleWrapped = true;
  }
} catch {
  // Keep the native console when it cannot be wrapped.
}

if (!debugEnabled) {
  try {
    if (typeof console.log === 'function') console.log = () => {};
    if (typeof console.debug === 'function') console.debug = () => {};
  } catch {
    // Keep the native console when it cannot be changed.
  }
}
