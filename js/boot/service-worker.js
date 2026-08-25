import './debug-policy.js';
import { isDebugEnabled } from '../core/app-context.js';

const swDebug = isDebugEnabled();
const swLog = (...args) => {
  if (swDebug) console.info('[SW]', ...args);
};
const swWarn = (...args) => console.warn('[SW]', ...args);
const swError = (...args) => console.error('[SW]', ...args);

let refreshing = false;

function showUpdateModal(registration, worker, delay) {
  setTimeout(() => {
    const modal = document.getElementById('swUpdateModal');
    const yesButton = document.getElementById('swUpdateYes');
    const noButton = document.getElementById('swUpdateNo');
    if (!modal || !yesButton || !noButton) return;

    modal.hidden = false;
    yesButton.onclick = () => {
      modal.hidden = true;
      const workerToNotify = registration.waiting || worker;
      try {
        workerToNotify?.postMessage({ type: 'SKIP_WAITING' });
      } catch (error) {
        swWarn('postMessage to worker failed', error);
      }
      setTimeout(() => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      }, 1000);
    };
    noButton.onclick = () => {
      modal.hidden = true;
    };
  }, delay);
}

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

          try {
            if (hadController && registration.waiting) {
              swLog('registration.waiting present on register');
              showUpdateModal(registration, registration.waiting, 1000);
            }
          } catch (error) {
            swWarn('waiting check failed', error);
          }

          setInterval(() => registration.update(), 30 * 60 * 1000);

          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            swLog('Update found');

            newWorker.addEventListener('statechange', () => {
              if (newWorker.state !== 'installed') return;

              const isUpdate = Boolean(hadController && (navigator.serviceWorker.controller || registration.waiting));
              swLog('installing state=installed, isUpdate=', isUpdate);
              if (isUpdate) {
                showUpdateModal(registration, newWorker, 2000);
              } else {
                swLog('First install detected; not showing update modal');
              }
            });
          });
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
