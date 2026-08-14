// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchPublicChatsEntries: vi.fn(),
  fetchChannelMetadata: vi.fn(async () => ({ label: 'Channel', rootEvent: null, metaEvent: null })),
  extractChannelProfileFields: vi.fn(() => ({})),
  revealComposerForSelectedChannel: vi.fn(),
  setChannelTarget: vi.fn(),
  subscribeChannelFeed: vi.fn(),
}));

vi.mock('./public-chats.js', () => ({
  fetchPublicChatsEntries: mocks.fetchPublicChatsEntries,
  togglePublicChatMembership: vi.fn(),
}));
vi.mock('./channel.js', () => ({
  buildChannelEmbedContext: vi.fn(async () => null),
  extractChannelProfileFields: mocks.extractChannelProfileFields,
  fetchChannelMetadata: mocks.fetchChannelMetadata,
  shortenChannelEventId: vi.fn(id => String(id || '').slice(0, 8)),
}));
vi.mock('./channel-feed.js', () => ({
  subscribeChannelFeed: mocks.subscribeChannelFeed,
  unsubscribeAllChannelFeeds: vi.fn(),
  unsubscribeChannelFeed: vi.fn(),
}));
vi.mock('./channel-search.js', () => ({
  resolveChannelRootIdInput: vi.fn(),
  searchChannels: vi.fn(async () => ({ results: [], mode: 'search' })),
}));
vi.mock('../post/postlink.js', () => ({ openEhagakiWithChannel: vi.fn() }));
vi.mock('../post/composer.js', () => ({
  hideComposerForUnselectedChannel: vi.fn(),
  revealComposerForSelectedChannel: mocks.revealComposerForSelectedChannel,
  setChannelTarget: mocks.setChannelTarget,
}));
vi.mock('../../ui/modals/modals.js', () => ({ showConfirmModal: vi.fn() }));
vi.mock('../../utils/i18n.js', () => ({ t: key => key }));

import {
  initChannelView,
  pauseChannelSubscriptions,
  resetChannelViewForAccount,
  resumeChannelSubscriptions,
  selectChannel,
  syncChannelComposerState,
} from './channel-ui.js';

const ACCOUNT_A = 'a'.repeat(64);
const ACCOUNT_B = 'b'.repeat(64);
const OLD_CHANNEL = 'c'.repeat(64);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function setupView(state) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  initChannelView(container, state);
  return container;
}

describe('channel list account loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('keeps loading status while an empty-cache request is pending', () => {
    const request = deferred();
    mocks.fetchPublicChatsEntries.mockReturnValueOnce(request.promise);
    localStorage.setItem('pubkey', ACCOUNT_A);

    const container = setupView({ pubkey: ACCOUNT_A });

    expect(container.querySelector('#channelList').children).toHaveLength(0);
    expect(container.querySelector('#channelListStatus').textContent).toBe('channel.loading_list');
  });

  it('clears old rows and search state synchronously on account reset', () => {
    mocks.fetchPublicChatsEntries.mockReturnValue(new Promise(() => {}));
    localStorage.setItem('pubkey', ACCOUNT_A);
    const state = { pubkey: ACCOUNT_A };
    const container = setupView(state);
    const listEl = container.querySelector('#channelList');
    const searchInput = container.querySelector('#channelSearchInput');
    const resultsEl = container.querySelector('#channelSearchResults');
    const wrapper = container.querySelector('.channel-portal-wrapper');

    listEl.innerHTML = '<div class="channel-list-item-row">old account</div>';
    searchInput.value = 'old search';
    resultsEl.classList.remove('d-none');
    resultsEl.innerHTML = '<div>old result</div>';
    wrapper.classList.add('show-chat');

    state.pubkey = ACCOUNT_B;
    localStorage.setItem('pubkey', ACCOUNT_B);
    resetChannelViewForAccount(state);

    expect(listEl.children).toHaveLength(0);
    expect(searchInput.value).toBe('');
    expect(resultsEl.innerHTML).toBe('');
    expect(resultsEl.classList.contains('d-none')).toBe(true);
    expect(wrapper.classList.contains('show-chat')).toBe(false);
    expect(container.querySelector('#channelListStatus').textContent).toBe('channel.loading_list');
  });

  it('ignores stale previous-account completion without rendering or saving', async () => {
    const oldRequest = deferred();
    const targetRequest = deferred();
    mocks.fetchPublicChatsEntries
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(targetRequest.promise);
    localStorage.setItem('pubkey', ACCOUNT_A);
    const state = { pubkey: ACCOUNT_A };
    const container = setupView(state);

    state.pubkey = ACCOUNT_B;
    localStorage.setItem('pubkey', ACCOUNT_B);
    resetChannelViewForAccount(state);
    oldRequest.resolve({
      event: { id: 'old-event' },
      entries: [{ rootId: OLD_CHANNEL, label: 'old channel' }],
    });
    await flushPromises();

    expect(container.querySelector(`[data-root-id="${OLD_CHANNEL}"]`)).toBeNull();
    expect(localStorage.getItem(`nokakoi_public_chats_cache_v1.${ACCOUNT_A}`)).toBeNull();
    expect(localStorage.getItem(`nokakoi_public_chats_cache_v1.${ACCOUNT_B}`)).toBeNull();
    expect(container.querySelector('#channelListStatus').textContent).toBe('channel.loading_list');

    targetRequest.resolve({ event: null, entries: [] });
    await flushPromises();
  });

  it('transitions from loading to none joined after a successful empty fetch', async () => {
    const request = deferred();
    mocks.fetchPublicChatsEntries.mockReturnValueOnce(request.promise);
    localStorage.setItem('pubkey', ACCOUNT_B);
    const container = setupView({ pubkey: ACCOUNT_B });

    expect(container.querySelector('#channelListStatus').textContent).toBe('channel.loading_list');

    request.resolve({ event: null, entries: [] });
    await flushPromises();

    expect(container.querySelector('#channelListStatus').textContent).toBe('channel.none_joined');
    expect(container.querySelector('#channelList').children).toHaveLength(0);
  });
});

describe('channel tab re-entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.body.innerHTML = `
      <div class="tabs"><button class="tab active" data-tab="channels"></button></div>
    `;
    mocks.fetchPublicChatsEntries.mockResolvedValue({ event: null, entries: [] });
  });

  it('reveals the selected composer and resumes exactly one subscription', async () => {
    localStorage.setItem('pubkey', ACCOUNT_A);
    const container = setupView({ pubkey: ACCOUNT_A });
    await flushPromises();
    await selectChannel(OLD_CHANNEL);
    expect(container.querySelector('.channel-portal-wrapper').classList.contains('show-chat')).toBe(true);
    pauseChannelSubscriptions();
    mocks.subscribeChannelFeed.mockClear();
    mocks.setChannelTarget.mockClear();
    mocks.revealComposerForSelectedChannel.mockClear();

    resumeChannelSubscriptions();
    syncChannelComposerState();
    await flushPromises();

    expect(mocks.subscribeChannelFeed).toHaveBeenCalledTimes(1);
    expect(mocks.setChannelTarget).toHaveBeenCalledWith(expect.objectContaining({
      rootId: OLD_CHANNEL,
    }));
    expect(mocks.revealComposerForSelectedChannel).toHaveBeenCalledTimes(1);
  });
});

describe('channel info modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.body.innerHTML = `
      <div id="channelInfoModal" hidden>
        <div id="channelInfoTitle"></div>
        <div id="channelInfoContent"></div>
        <button id="channelInfoClose"></button>
        <button id="channelInfoOkBtn"></button>
      </div>
    `;
    mocks.fetchPublicChatsEntries.mockResolvedValue({ event: null, entries: [] });
  });

  it('renders creator row and channel image in channel info modal', async () => {
    const creatorPubkey = 'f'.repeat(64);
    const mockRootEvent = { id: OLD_CHANNEL, pubkey: creatorPubkey, kind: 40 };
    mocks.fetchChannelMetadata.mockResolvedValue({
      label: 'Test Channel',
      rootEvent: mockRootEvent,
      metaEvent: null,
    });

    const channelProfile = {
      name: 'Test Channel',
      about: 'Channel Description',
      picture: 'https://example.com/channel.png',
      relays: ['wss://relay.example.com'],
    };
    mocks.extractChannelProfileFields.mockReturnValue(channelProfile);

    const state = {
      pubkey: ACCOUNT_A,
      profiles: new Map([[creatorPubkey, { display_name: 'Creator Name', name: 'creator', picture: 'https://example.com/avatar.png', loaded: true }]]),
    };

    const container = setupView(state);
    await flushPromises();
    await selectChannel(OLD_CHANNEL);
    await flushPromises();

    // Trigger openChannelInfoModal via info button
    const infoBtn = container.querySelector('#channelInfoBtn');
    expect(infoBtn).toBeTruthy();
    infoBtn.click();
    await flushPromises();

    const modal = document.getElementById('channelInfoModal');
    expect(modal.hidden).toBe(false);

    const contentEl = document.getElementById('channelInfoContent');
    const creatorRow = contentEl.querySelector('#channelInfoCreatorRow');
    expect(creatorRow).toBeTruthy();
    expect(creatorRow.getAttribute('data-pubkey')).toBe(creatorPubkey);
    expect(creatorRow.textContent).toContain('Creator Name');
    expect(creatorRow.textContent).not.toContain('npub1');

    const copyBtn = contentEl.querySelector('#channelInfoCopyIdBtn');
    expect(copyBtn).toBeNull();

    const pictureImg = contentEl.querySelector('.channel-info-picture');
    expect(pictureImg).toBeTruthy();
    expect(pictureImg.src).toContain('https://example.com/channel.png');
  });
});

