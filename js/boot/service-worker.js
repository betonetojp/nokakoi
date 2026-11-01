import './debug-policy.js';
import { isDebugEnabled } from '../core/app-context.js';

const swDebug = isDebugEnabled();
const swLog = (...args) => {
  if (swDebug) console.info('[SW]', ...args);
};
const swWarn = (...args) => console.warn('[SW]', ...args);
const swError = (...args) => console.error('[SW]', ...args);

let refreshing = false;

const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

if (isLocal) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister().then((success) => {
          if (success) console.info('[SW] Local Service Worker unregistered.');
        });
      }
    });
  }
} else if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  window.addEventListener('load', () => {
    setTimeout(() => {
      const basePath = location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);
      navigator.serviceWorker.register(`${basePath}sw.js`, { scope: basePath })
        .then((registration) => {
          swLog('Registered:', registration.scope);
          // 新ワーカーは install 時に skipWaiting するため、確認モーダルは使わない。
          setInterval(() => registration.update(), 30 * 60 * 1000);
        })
        .catch((error) => {
          swError('Registration failed:', error);
        });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) {
          swLog('First install controller change; skipping reload');
          return;
        }
        if (refreshing) return;
        refreshing = true;
        swLog('Controller changed, reloading...');
        window.location.reload();
      });
    }, 500);
  });
} else {
  swWarn('Service Worker not supported in this browser');
}
