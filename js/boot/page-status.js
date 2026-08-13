function setInfo(message) {
  const element = document.getElementById('buildInfo');
  if (element && !element.textContent) element.textContent = ` · ${message}`;
}

window.addEventListener('error', (event) => {
  let errorMessage = 'error';
  if (event && event.message) {
    errorMessage += `: ${event.message}`;
    if (event.filename) errorMessage += ` at ${event.filename.split('/').pop()}`;
    if (event.lineno) errorMessage += `:${event.lineno}`;
  }
  console.error('[Global Error]', event);
  setInfo(errorMessage);
});

window.addEventListener('unhandledrejection', (event) => {
  let errorMessage = 'promise error';
  if (event && event.reason) {
    errorMessage += `: ${event.reason.message || event.reason}`;
  }
  console.error('[Promise Rejection]', event);
  setInfo(errorMessage);
});

document.addEventListener('DOMContentLoaded', () => {
  setInfo(`loaded ${new Date().toLocaleString()}`);

  try {
    const yearSpan = document.getElementById('copyrightYear');
    const currentYear = new Date().getFullYear();
    if (yearSpan && currentYear > 2025) yearSpan.textContent = `-${currentYear}`;
  } catch {
    // Footer metadata is optional.
  }

  try {
    const customEmojiCheckbox = document.getElementById('showCustomEmojiCheck');
    if (customEmojiCheckbox) {
      customEmojiCheckbox.checked = localStorage.getItem('showCustomEmoji') !== '0';
      customEmojiCheckbox.addEventListener('change', () => {
        try {
          localStorage.setItem('showCustomEmoji', customEmojiCheckbox.checked ? '1' : '0');
          window.dispatchEvent(new Event('customEmoji:changed'));
        } catch {
          // Ignore unavailable storage.
        }
      });
    }
  } catch {
    // Keep the default checkbox state when storage is unavailable.
  }

  for (const formId of ['nsecForm', 'decryptForm']) {
    document.getElementById(formId)?.addEventListener('submit', (event) => event.preventDefault());
  }
});
