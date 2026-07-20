import { t, applyTranslations } from '../../utils/i18n.js';
import { showToast, debounce } from '../../utils/utils.js';
import { POSTLINK_DEFAULT_TITLE, POSTLINK_DEFAULT_URL, EVENTLINK_DEFAULT_TITLE, EVENTLINK_DEFAULT_URL, MAX_PREVIEW_LENGTH, EVENTS_MAX } from '../../config/constants.js';
import { ensureNotificationPermission } from '../../utils/notification.js';
import { teardownDomPurge } from '../../features/timeline/feed-renderer.js';
import { applyTheme, applyColorTheme } from './theme-manager.js';
import { setMentionBlink } from './mention-blink.js';
import { renderTabSettingsUI, setupTabs } from './tab-manager.js';
import { bringModalToFront } from './modal-helper.js';

export let _settingsManagerRef = null;
export let _restartFeedsRef = null;

export function applySimpleDisplayMode(enabled) {
  try {
    if (enabled) document.body.classList.add('simple-display-mode');
    else document.body.classList.remove('simple-display-mode');
  } catch (e) { }
}

export function syncDisplayCheckbox(id, checked) {
  try {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
  } catch (e) { }
}

export function setSimpleDisplayModeEnabled(settingsManager, enabled) {
  settingsManager.set('simpleDisplayMode', enabled);
  applySimpleDisplayMode(enabled);
  syncDisplayCheckbox('simpleDisplayModeCheck', enabled);
  syncDisplayCheckbox('homeDisplayQuickCompactCheck', enabled);
}

export function setShowTimelineMediaEnabled(settingsManager, enabled, restartFeeds) {
  settingsManager.set('showTimelineMedia', enabled);
  syncDisplayCheckbox('showTimelineMediaCheck', enabled);
  syncDisplayCheckbox('homeDisplayQuickMediaCheck', enabled);
  const fn = restartFeeds || _restartFeedsRef;
  try { if (typeof fn === 'function') fn(true); } catch (e) { }
}

export function setShowHomeReactionsEnabled(settingsManager, enabled, restartFeeds) {
  settingsManager.set('showHomeReactions', enabled);
  syncDisplayCheckbox('showHomeReactionsCheck', enabled);
  syncDisplayCheckbox('homeDisplayQuickReactionsCheck', enabled);
  const fn = restartFeeds || _restartFeedsRef;
  try { if (typeof fn === 'function') fn(true); } catch (e) { }
}

export function setMuteApplyEnabled(settingsManager, enabled, restartFeeds) {
  try {
    localStorage.setItem('mute_apply', enabled ? '1' : '0');
  } catch (e) { }
  syncDisplayCheckbox('applyMuteCheckbox', enabled);
  syncDisplayCheckbox('homeDisplayQuickMuteCheck', enabled);

  try {
    const applyMuteCheckbox = document.getElementById('applyMuteCheckbox');
    if (applyMuteCheckbox) {
      const modeWrap = applyMuteCheckbox.parentNode?.nextSibling;
      if (modeWrap) {
        modeWrap.classList.toggle('d-none', !enabled);
      }
    }
  } catch (e) { }

  const fn = restartFeeds || _restartFeedsRef;
  try { if (typeof fn === 'function') fn(true); } catch (e) { }
}

export function showHomeDisplayQuickModal() {
  const settingsManager = _settingsManagerRef;
  if (!settingsManager) return;

  const modal = document.getElementById('homeDisplayQuickModal');
  const compactCheck = document.getElementById('homeDisplayQuickCompactCheck');
  const mediaCheck = document.getElementById('homeDisplayQuickMediaCheck');
  const reactionsCheck = document.getElementById('homeDisplayQuickReactionsCheck');
  const muteCheck = document.getElementById('homeDisplayQuickMuteCheck');
  const closeBtn = document.getElementById('homeDisplayQuickCloseBtn');
  if (!modal || !compactCheck || !mediaCheck || !reactionsCheck || !muteCheck) return;

  compactCheck.checked = settingsManager.settings.simpleDisplayMode === true;
  mediaCheck.checked = settingsManager.settings.showTimelineMedia === true;
  reactionsCheck.checked = settingsManager.settings.showHomeReactions === true;
  muteCheck.checked = (localStorage.getItem('mute_apply') || '1') === '1';

  compactCheck.onchange = function () {
    setSimpleDisplayModeEnabled(settingsManager, compactCheck.checked);
  };
  mediaCheck.onchange = function () {
    setShowTimelineMediaEnabled(settingsManager, mediaCheck.checked);
  };
  reactionsCheck.onchange = function () {
    setShowHomeReactionsEnabled(settingsManager, reactionsCheck.checked);
  };
  muteCheck.onchange = function () {
    setMuteApplyEnabled(settingsManager, muteCheck.checked);
  };

  modal.hidden = false;
  try { applyTranslations(modal, true); } catch (e) { }
  bringModalToFront(modal);

  const close = () => {
    modal.hidden = true;
    try { modal.style.zIndex = ''; } catch (e) { }
  };

  if (closeBtn) closeBtn.onclick = close;
  modal.onclick = (e) => {
    if (e.target === modal) close();
  };
}

export function setupDisplaySettings(settingsManager, restartFeeds, resetScrollToTopButtonPosition, updatePostLinkButtonAndModal) {
  _settingsManagerRef = settingsManager;
  _restartFeedsRef = restartFeeds;

  const $ = (s) => document.getElementById(s);
  const showAvatarsCheck = $('showAvatarsCheck');
  if (!showAvatarsCheck) return;

  const showTimelineMediaCheck = $('showTimelineMediaCheck');
  const showCustomEmojiCheck = $('showCustomEmojiCheck');
  const showMusicStatusCheck = $('showMusicStatusCheck');
  const useDomPurgeCheck = $('useDomPurgeCheck');
  const showHomeOmochatCheck = $('showHomeOmochatCheck');
  if (showHomeOmochatCheck) {
    showHomeOmochatCheck.checked = settingsManager.settings.showHomeOmochat === true;
    showHomeOmochatCheck.onchange = function () {
      settingsManager.set('showHomeOmochat', showHomeOmochatCheck.checked);
      try { restartFeeds(true); } catch (e) { }
    };
  }
  const showHomeReactionsCheck = $('showHomeReactionsCheck');
  const showProfileReactionsCheck = $('showProfileReactionsCheck');
  const showProfileBannerCheck = $('showProfileBannerCheck');

  const simpleDisplayModeCheck = $('simpleDisplayModeCheck');
  if (simpleDisplayModeCheck) {
    simpleDisplayModeCheck.checked = settingsManager.settings.simpleDisplayMode === true;
    applySimpleDisplayMode(simpleDisplayModeCheck.checked);
    simpleDisplayModeCheck.onchange = function () {
      setSimpleDisplayModeEnabled(settingsManager, simpleDisplayModeCheck.checked);
    };
  }

  showAvatarsCheck.checked = settingsManager.settings.showAvatars !== false;
  if (showTimelineMediaCheck) showTimelineMediaCheck.checked = settingsManager.settings.showTimelineMedia === true;
  if (showCustomEmojiCheck) showCustomEmojiCheck.checked = settingsManager.settings.showCustomEmoji !== false;

  if (showMusicStatusCheck) {
    showMusicStatusCheck.checked = settingsManager.settings.showMusicStatus !== false;
  }
  if (useDomPurgeCheck) {
    useDomPurgeCheck.checked = settingsManager.settings.useDomPurge === true;
  }

  renderTabSettingsUI(settingsManager, $('tabSettingsList'));

  if (showHomeReactionsCheck) showHomeReactionsCheck.checked = settingsManager.settings.showHomeReactions === true;
  const showHomeChannelCheck = $('showHomeChannelCheck');
  if (showHomeChannelCheck) showHomeChannelCheck.checked = settingsManager.settings.showHomeChannel === true;
  const showHomeRepost16Check = $('showHomeRepost16Check');
  if (showHomeRepost16Check) showHomeRepost16Check.checked = settingsManager.settings.showHomeRepost16 === true;
  const disableBlinkCheck = $('disableBlinkCheck');
  if (disableBlinkCheck) disableBlinkCheck.checked = settingsManager.settings.disableBlink === true;
  const mentionBackgroundNotificationCheck = $('mentionBackgroundNotificationCheck');
  if (mentionBackgroundNotificationCheck) {
    mentionBackgroundNotificationCheck.checked = settingsManager.settings.mentionNotificationMode === 'background';
  }
  const fetchFollowEmojiCheck = $('fetchFollowEmojiCheck');
  if (fetchFollowEmojiCheck) fetchFollowEmojiCheck.checked = settingsManager.settings.fetchFollowEmoji === true;
  if (showProfileReactionsCheck) showProfileReactionsCheck.checked = settingsManager.settings.showProfileReactions === true;
  const showProfileChannelCheck = $('showProfileChannelCheck');
  if (showProfileChannelCheck) showProfileChannelCheck.checked = settingsManager.settings.showProfileChannel === true;
  const showProfileRepost16Check = $('showProfileRepost16Check');
  if (showProfileRepost16Check) showProfileRepost16Check.checked = settingsManager.settings.showProfileRepost16 === true;
  if (showProfileBannerCheck) showProfileBannerCheck.checked = settingsManager.settings.showProfileBanner === true;

  const showClientNameCheck = $('showClientNameCheck');
  const attachClientNameCheck = $('attachClientNameCheck');
  const clientNameInput = $('clientNameInput');
  if (showClientNameCheck) showClientNameCheck.checked = settingsManager.settings.showClientName !== false;
  if (attachClientNameCheck) attachClientNameCheck.checked = settingsManager.settings.attachClientName !== false;
  if (clientNameInput) clientNameInput.value = settingsManager.settings.clientName || 'nokakoi';

  try { if (window && window.settingsComposerManager) window.settingsComposerManager.registerContainer(document.getElementById('displayPanel')); } catch (e) { }

  if (showClientNameCheck) {
    showClientNameCheck.onchange = function () {
      settingsManager.set('showClientName', showClientNameCheck.checked);
      try { restartFeeds(true); } catch (e) { }
    };
  }
  if (attachClientNameCheck) {
    attachClientNameCheck.onchange = function () {
      settingsManager.set('attachClientName', attachClientNameCheck.checked);
    };
  }
  if (clientNameInput) {
    clientNameInput.onchange = function () {
      settingsManager.set('clientName', clientNameInput.value || 'nokakoi');
    };
  }

  if (showHomeReactionsCheck) {
    showHomeReactionsCheck.onchange = function () {
      setShowHomeReactionsEnabled(settingsManager, showHomeReactionsCheck.checked, restartFeeds);
    };
  }

  if (showHomeChannelCheck) {
    showHomeChannelCheck.onchange = function () {
      settingsManager.set('showHomeChannel', showHomeChannelCheck.checked);
      try { restartFeeds(true); } catch (e) { }
    };
  }

  if (showHomeRepost16Check) {
    showHomeRepost16Check.onchange = function () {
      settingsManager.set('showHomeRepost16', showHomeRepost16Check.checked);
      try { restartFeeds(true); } catch (e) { }
    };
  }

  if (fetchFollowEmojiCheck) {
    fetchFollowEmojiCheck.onchange = function () {
      settingsManager.set('fetchFollowEmoji', fetchFollowEmojiCheck.checked);
      try { window.dispatchEvent(new Event('softReloadRequest')); } catch (e) { }
    };
  }

  if (disableBlinkCheck) {
    disableBlinkCheck.onchange = function () {
      settingsManager.set('disableBlink', disableBlinkCheck.checked);
      if (disableBlinkCheck.checked) {
        setMentionBlink(false);
        try {
          const topBtn = document.getElementById('scrollToTopBtn');
          if (topBtn) topBtn.classList.remove('has-new');
        } catch (e) { }
      }
    };
  }

  if (mentionBackgroundNotificationCheck) {
    mentionBackgroundNotificationCheck.onchange = async function () {
      const enabled = mentionBackgroundNotificationCheck.checked;
      if (!enabled) {
        settingsManager.set('mentionNotificationMode', 'off');
        return;
      }
      try {
        const permOk = await ensureNotificationPermission();
        if (!permOk) {
          mentionBackgroundNotificationCheck.checked = false;
          settingsManager.set('mentionNotificationMode', 'off');
          try {
            showToast(t('mentionBackgroundNotification.permission_denied'), { type: 'info', duration: 4000 });
          } catch (e) { }
          return;
        }
        settingsManager.set('mentionNotificationMode', 'background');
      } catch (e) {
        mentionBackgroundNotificationCheck.checked = false;
        settingsManager.set('mentionNotificationMode', 'off');
      }
    };
  }

  if (showProfileReactionsCheck) {
    showProfileReactionsCheck.onchange = function () {
      settingsManager.set('showProfileReactions', showProfileReactionsCheck.checked);
    };
  }

  if (showProfileChannelCheck) {
    showProfileChannelCheck.onchange = function () {
      settingsManager.set('showProfileChannel', showProfileChannelCheck.checked);
    };
  }

  if (showProfileRepost16Check) {
    showProfileRepost16Check.onchange = function () {
      settingsManager.set('showProfileRepost16', showProfileRepost16Check.checked);
    };
  }

  if (showProfileBannerCheck) {
    showProfileBannerCheck.onchange = function () {
      settingsManager.set('showProfileBanner', showProfileBannerCheck.checked);
    };
  }

  showAvatarsCheck.onchange = function () {
    settingsManager.set('showAvatars', showAvatarsCheck.checked);
    try { restartFeeds(true); } catch (e) { }
  };

  if (showTimelineMediaCheck) {
    showTimelineMediaCheck.onchange = function () {
      setShowTimelineMediaEnabled(settingsManager, showTimelineMediaCheck.checked, restartFeeds);
    };
  }

  if (showCustomEmojiCheck) {
    showCustomEmojiCheck.addEventListener('change', () => {
       settingsManager.set('showCustomEmoji', showCustomEmojiCheck.checked);
    });
  }

  if (showMusicStatusCheck) {
    showMusicStatusCheck.onchange = function() {
      settingsManager.set('showMusicStatus', showMusicStatusCheck.checked);
      try { restartFeeds(true); } catch (e) { }
    };
  }

  if (useDomPurgeCheck) {
    useDomPurgeCheck.onchange = function () {
      const enabled = useDomPurgeCheck.checked;
      settingsManager.set('useDomPurge', enabled);
      if (!enabled) {
        try { teardownDomPurge(); } catch (e) { }
      }
      try { restartFeeds(true); } catch (e) { }
    };
  }

  const themeSelect = $('themeSelect');
  if (themeSelect) {
    const current = settingsManager.settings.theme || 'light';
    themeSelect.value = current;
    const resolveInitial = (val) => {
      if (val === 'system') {
        if (window.matchMedia && typeof window.matchMedia === 'function') {
          return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        }
        return 'light';
      }
      return val || 'light';
    };
    applyTheme(resolveInitial(current));

    let mq = null;
    const systemListener = (e) => { if (settingsManager.get('theme') === 'system') applyTheme(e.matches ? 'light' : 'dark'); };
    const setupSystemListener = () => {
      if (mq) mq.removeEventListener('change', systemListener);
      if (window.matchMedia) {
        mq = window.matchMedia('(prefers-color-scheme: light)');
        mq.addEventListener('change', systemListener);
      }
    };
    if (current === 'system') setupSystemListener();

    themeSelect.onchange = function () {
      const v = themeSelect.value;
      settingsManager.set('theme', v);
      if (v === 'system') { applyTheme(resolveInitial('system')); setupSystemListener(); }
      else { applyTheme(v); if (mq) { try { mq.removeEventListener('change', systemListener); } catch (e) { try { mq.removeListener(systemListener); } catch { } } mq = null; } }
    };
  }

  const colorThemeSelect = $('colorThemeSelect');
  if (colorThemeSelect) {
    const currentColor = settingsManager.settings.colorTheme || 'pink';
    colorThemeSelect.value = currentColor;
    applyColorTheme(currentColor);
    colorThemeSelect.onchange = function () {
      const v = colorThemeSelect.value;
      settingsManager.set('colorTheme', v);
      applyColorTheme(v);
    };
  }

  const eventLinkTitleInput = $('eventLinkTitleInput');
  const eventLinkUrlInput = $('eventLinkUrlInput');
  const eventLinkSaveStatus = $('eventLinkSaveStatus');

  if (eventLinkTitleInput && eventLinkUrlInput) {
    const rawTitle = (typeof settingsManager.getRaw === 'function') ? settingsManager.getRaw('eventLinkTitle') : null;
    const rawUrl = (typeof settingsManager.getRaw === 'function') ? settingsManager.getRaw('eventLinkUrl') : null;

    const effectiveTitle = (rawTitle === null || typeof rawTitle === 'undefined') ? (settingsManager.get('eventLinkTitle') || EVENTLINK_DEFAULT_TITLE) : rawTitle;
    const effectiveUrl = (rawUrl === null || typeof rawUrl === 'undefined') ? (settingsManager.get('eventLinkUrl') || EVENTLINK_DEFAULT_URL) : rawUrl;

    eventLinkTitleInput.value = effectiveTitle;
    eventLinkUrlInput.value = effectiveUrl;

    const persistEventLink = debounce(() => {
      try {
        const tval = eventLinkTitleInput.value || '';
        const uval = eventLinkUrlInput.value || '';

        settingsManager.set('eventLinkTitle', tval);
        settingsManager.set('eventLinkUrl', uval);

        if (eventLinkSaveStatus) {
          eventLinkSaveStatus.textContent = t('eventlink.saved');
          setTimeout(() => {
            try { if (eventLinkSaveStatus && eventLinkSaveStatus.textContent === t('eventlink.saved')) eventLinkSaveStatus.textContent = ''; } catch (e) { }
          }, 1200);
        }
      } catch (e) {
        console.warn('[UI] event link 設定の保存に失敗', e);
      }
    }, 400);

    eventLinkTitleInput.addEventListener('input', persistEventLink);
    eventLinkUrlInput.addEventListener('input', persistEventLink);
  }

  const clearCacheBtn = $('clearCacheBtn');
  const clearCacheStatus = $('clearCacheStatus');
  if (clearCacheBtn) {
    clearCacheBtn.onclick = async function () {
      try {
        if (clearCacheStatus) {
          clearCacheStatus.dataset.i18nKey = 'clear.inprogress';
          try { clearCacheStatus.dataset.i18nParams = ''; } catch (e) { }
          clearCacheStatus.textContent = t('clear.inprogress');
        }
        settingsManager.set('postLinkTitle', POSTLINK_DEFAULT_TITLE);
        settingsManager.set('postLinkUrl', POSTLINK_DEFAULT_URL);
        settingsManager.set('eventLinkTitle', EVENTLINK_DEFAULT_TITLE);
        settingsManager.set('eventLinkUrl', EVENTLINK_DEFAULT_URL);
        try {
          settingsManager.set('showClientName', true);
          settingsManager.set('attachClientName', true);
          settingsManager.set('clientName', 'nokakoi');
        } catch (e) { }
        if (typeof updatePostLinkButtonAndModal === 'function') updatePostLinkButtonAndModal(POSTLINK_DEFAULT_TITLE, POSTLINK_DEFAULT_URL);
        if (typeof resetScrollToTopButtonPosition === 'function') resetScrollToTopButtonPosition();
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) await registration.unregister();
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        if (clearCacheStatus) {
          clearCacheStatus.dataset.i18nKey = 'clear.done';
          try { clearCacheStatus.dataset.i18nParams = ''; } catch (e) { }
          clearCacheStatus.textContent = t('clear.done');
        }
        try {
          const toastDur = 3000;
          showToast(t('clear.done'), { type: 'success', duration: toastDur });
          setTimeout(() => { try { window.location.reload(true); } catch (e) { } }, toastDur + 200);
        } catch (e) { try { window.location.reload(true); } catch (ee) { } }
      } catch (e) {
        console.error('[UI] キャッシュクリア失敗:', e);
        if (clearCacheStatus) {
          try { clearCacheStatus.dataset.i18nKey = 'clear.error'; clearCacheStatus.dataset.i18nParams = JSON.stringify({ msg: (e && e.message) }); } catch (ee) { }
          try { clearCacheStatus.textContent = t('clear.error', { msg: (e && e.message) }); } catch (ee) { clearCacheStatus.textContent = (e && e.message) || String(e); }
        }
        try { showToast(t('clear.error', { msg: (e && e.message) }), { type: 'error', duration: 5000 }); } catch (ee) { }
      }
    };
  }

  try {
    const langSelect = document.getElementById('langSelect');
    if (langSelect) {
      try { langSelect.value = (localStorage.getItem('lang') || 'ja'); } catch (e) { }
      langSelect.onchange = function () {
        try {
          const v = langSelect.value || 'ja';
          import('../../utils/i18n.js').then(m => {
            try {
              if (m && m.setLang) m.setLang(v);
            } catch (e) { }
            try {
              const toastDur = 3000;
              showToast(t('lang.changed_reload'), { type: 'info', duration: toastDur });
              setTimeout(() => { try { window.location.reload(); } catch (e) { } }, toastDur);
            } catch (e) {
              try { window.location.reload(); } catch (e) { }
            }
          }).catch(() => { try { window.location.reload(); } catch (e) { } });
        } catch (e) { try { window.location.reload(); } catch (e) { } }
      };
    }
  } catch (e) { }

  const previewMaxLengthInput = document.getElementById('previewMaxLengthInput');
  if (previewMaxLengthInput) {
    const val = settingsManager.get('previewMaxLength');
    previewMaxLengthInput.value = val && !isNaN(val) ? val : MAX_PREVIEW_LENGTH;
    previewMaxLengthInput.onchange = function () {
      let v = parseInt(previewMaxLengthInput.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      if (v > 100000) v = 100000;
      settingsManager.set('previewMaxLength', v);
    };
  }

  const maxEventsInput = document.getElementById('maxEventsInput');
  if (maxEventsInput) {
    const val = settingsManager.get('maxEvents');
    maxEventsInput.value = val && !isNaN(val) ? val : EVENTS_MAX;
    maxEventsInput.onchange = function () {
      let v = parseInt(maxEventsInput.value, 10);
      if (isNaN(v) || v < 50) v = 50;
      if (v > 5000) v = 5000;
      settingsManager.set('maxEvents', v);
    };
  }
}
