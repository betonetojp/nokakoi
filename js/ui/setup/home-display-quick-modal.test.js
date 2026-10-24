// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showHomeDisplayQuickModal, setupDisplaySettings } from './display-settings.js';
import { getMuteSetting, setMuteSetting } from '../../features/mute/mute.js';

describe('Home Display Quick Settings Modal', () => {
  let settingsManager;
  let restartFeedsMock;

  beforeEach(() => {
    localStorage.clear();
    restartFeedsMock = vi.fn();

    settingsManager = {
      settings: {
        simpleDisplayMode: false,
        showTimelineMedia: true,
        autoExpandSteganography: false,
        showHomeReactions: true,
        showReceivedDelta: true
      },
      get: vi.fn((key) => settingsManager.settings[key]),
      set: vi.fn((key, val) => {
        settingsManager.settings[key] = val;
      })
    };

    document.body.innerHTML = `
      <div id="homeDisplayQuickModal" class="modal" role="dialog" hidden>
        <input type="checkbox" id="homeDisplayQuickCompactCheck">
        <input type="checkbox" id="homeDisplayQuickMediaCheck">
        <input type="checkbox" id="homeDisplayQuickAutoExpandSteganographyCheck">
        <input type="checkbox" id="homeDisplayQuickReactionsCheck">
        <button id="openFollowEditModalQuickBtn" type="button"></button>
        <button id="openMuteEditModalQuickBtn" type="button"></button>
        <input type="checkbox" id="homeDisplayQuickMuteCheck">
        <div id="homeDisplayQuickMuteChildren" class="mt-8 flex-col items-start d-none" hidden>
          <input type="checkbox" id="homeDisplayQuickMuteKind0Check">
          <input type="radio" name="homeDisplayQuickMuteDisplayMode" value="hide" id="homeDisplayQuickMuteModeHide">
          <input type="radio" name="homeDisplayQuickMuteDisplayMode" value="collapse" id="homeDisplayQuickMuteModeCollapse">
          <div id="homeDisplayQuickMuteHidePublicWrap" class="mt-4 ml-16 flex-row">
            <label id="homeDisplayQuickMuteHidePublicLabel">
              <input type="checkbox" id="homeDisplayQuickMuteHidePublicCheck">
            </label>
          </div>
        </div>
        <button id="homeDisplayQuickCloseBtn" type="button"></button>
      </div>

      <!-- 通常設定画面側の要素（同期確認用） -->
      <input type="checkbox" id="showAvatarsCheck">
      <input type="checkbox" id="applyMuteCheckbox">
      <input type="checkbox" id="muteApplyKind0Checkbox">
      <input type="radio" name="muteDisplayMode" value="hide" id="muteModeHide">
      <input type="radio" name="muteDisplayMode" value="collapse" id="muteModeCollapse">
      <input type="checkbox" id="muteHidePublicCheckbox">
    `;

    setupDisplaySettings(settingsManager, restartFeedsMock, vi.fn(), vi.fn());
  });

  it('does not contain homeDisplayQuickDeltaCheck', () => {
    const deltaCheck = document.getElementById('homeDisplayQuickDeltaCheck');
    expect(deltaCheck).toBeNull();
  });

  it('initializes mute and child settings with defaults and toggles children visibility on mute apply change', () => {
    showHomeDisplayQuickModal();

    const muteCheck = document.getElementById('homeDisplayQuickMuteCheck');
    const muteChildren = document.getElementById('homeDisplayQuickMuteChildren');
    const muteKind0Check = document.getElementById('homeDisplayQuickMuteKind0Check');
    const muteModeHide = document.getElementById('homeDisplayQuickMuteModeHide');
    const muteModeCollapse = document.getElementById('homeDisplayQuickMuteModeCollapse');
    const muteHidePublicCheck = document.getElementById('homeDisplayQuickMuteHidePublicCheck');

    // Default values
    expect(muteCheck.checked).toBe(true);
    expect(muteChildren.hidden).toBe(false);
    expect(muteChildren.classList.contains('d-none')).toBe(false);
    expect(muteKind0Check.checked).toBe(false);
    expect(muteModeCollapse.checked).toBe(true);
    expect(muteModeHide.checked).toBe(false);
    expect(muteHidePublicCheck.checked).toBe(false);
    expect(muteHidePublicCheck.disabled).toBe(false);

    // Uncheck mute apply
    muteCheck.checked = false;
    muteCheck.dispatchEvent(new Event('change'));
    expect(muteChildren.hidden).toBe(true);
    expect(muteChildren.classList.contains('d-none')).toBe(true);
    expect(getMuteSetting('mute_apply')).toBe('0');

    // Check mute apply again
    muteCheck.checked = true;
    muteCheck.dispatchEvent(new Event('change'));
    expect(muteChildren.hidden).toBe(false);
    expect(muteChildren.classList.contains('d-none')).toBe(false);
    expect(getMuteSetting('mute_apply')).toBe('1');
  });

  it('updates kind0 setting and syncs with normal setting', () => {
    showHomeDisplayQuickModal();

    const kind0Check = document.getElementById('homeDisplayQuickMuteKind0Check');
    const normalKind0Check = document.getElementById('muteApplyKind0Checkbox');

    kind0Check.checked = true;
    kind0Check.dispatchEvent(new Event('change'));

    expect(getMuteSetting('mute_apply_kind0')).toBe('1');
    expect(normalKind0Check.checked).toBe(true);
    expect(restartFeedsMock).toHaveBeenCalled();
  });

  it('updates display mode and toggles hide_public disabled state', () => {
    showHomeDisplayQuickModal();

    const modeHide = document.getElementById('homeDisplayQuickMuteModeHide');
    const modeCollapse = document.getElementById('homeDisplayQuickMuteModeCollapse');
    const hidePublicCheck = document.getElementById('homeDisplayQuickMuteHidePublicCheck');
    const hidePublicLabel = document.getElementById('homeDisplayQuickMuteHidePublicLabel');
    const normalHide = document.getElementById('muteModeHide');
    const normalCollapse = document.getElementById('muteModeCollapse');

    // Switch to hide
    modeHide.checked = true;
    modeCollapse.checked = false;
    modeHide.dispatchEvent(new Event('change'));

    expect(getMuteSetting('mute_display_mode')).toBe('hide');
    expect(normalHide.checked).toBe(true);
    expect(hidePublicCheck.disabled).toBe(true);
    expect(hidePublicLabel.style.opacity).toBe('0.5');

    // Switch back to collapse
    modeCollapse.checked = true;
    modeHide.checked = false;
    modeCollapse.dispatchEvent(new Event('change'));

    expect(getMuteSetting('mute_display_mode')).toBe('collapse');
    expect(normalCollapse.checked).toBe(true);
    expect(hidePublicCheck.disabled).toBe(false);
    expect(hidePublicLabel.style.opacity).toBe('1');
  });

  it('updates hide_public setting and syncs with normal setting', () => {
    showHomeDisplayQuickModal();

    const hidePublicCheck = document.getElementById('homeDisplayQuickMuteHidePublicCheck');
    const normalHidePublicCheck = document.getElementById('muteHidePublicCheckbox');

    hidePublicCheck.checked = true;
    hidePublicCheck.dispatchEvent(new Event('change'));

    expect(getMuteSetting('mute_hide_public')).toBe('1');
    expect(normalHidePublicCheck.checked).toBe(true);
    expect(restartFeedsMock).toHaveBeenCalled();
  });
});
