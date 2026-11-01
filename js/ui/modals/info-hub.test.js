// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupInfoHubModal } from './info-hub.js';

describe('info-hub modal', () => {
  let reloadMock = null;
  const originalLocation = window.location;

  beforeEach(() => {
    vi.useFakeTimers();
    reloadMock = vi.fn();
    delete window.location;
    window.location = {
      reload: reloadMock,
      href: 'http://localhost/'
    };

    document.body.innerHTML = `
      <div class="brand">nokakoi</div>
      <div id="infoHubModal" hidden>
        <span id="infoHubVersion"></span>
        <button id="infoHubClose" type="button">✕</button>
        <button id="openDebugFromInfoHubBtn" type="button">debug</button>
        <button id="fullReloadFromInfoHubBtn" type="button">reload</button>
      </div>
      <div id="debugModal" hidden></div>
    `;
  });

  afterEach(() => {
    window.location = originalLocation;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens infoHubModal when brand is clicked', () => {
    setupInfoHubModal();
    const brand = document.querySelector('.brand');
    const modal = document.getElementById('infoHubModal');

    expect(modal.hidden).toBe(true);
    brand.click();
    expect(modal.hidden).toBe(false);
  });

  it('triggers window.location.reload when fullReloadFromInfoHubBtn is clicked', () => {
    setupInfoHubModal();
    const reloadBtn = document.getElementById('fullReloadFromInfoHubBtn');

    reloadBtn.click();
    vi.advanceTimersByTime(350);

    expect(reloadMock).toHaveBeenCalled();
  });
});
