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
  refreshActiveChannelFeed,
  reloadChannelView,
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

    const aboutEl = contentEl.querySelector('#channelInfoAbout');
    expect(aboutEl).toBeTruthy();
    expect(aboutEl.classList.contains('channel-info-about')).toBe(true);
    expect(aboutEl.textContent).toContain('Channel Description');
  });

  it('linkifies URLs in channel about with long query parameters', async () => {
    const creatorPubkey = 'f'.repeat(64);
    const mockRootEvent = { id: OLD_CHANNEL, pubkey: creatorPubkey, kind: 40 };
    mocks.fetchChannelMetadata.mockResolvedValue({
      label: 'Test Channel',
      rootEvent: mockRootEvent,
      metaEvent: null,
    });

    const longUrl = 'https://lokuyow.github.io/ehagaki/?channel=nevent1qvzqqqqq9qqsuamnwvaz7tmev9382tndv5hszgthwden5te0wfjkccte9448qtnwdaehgu3wwa5hyetydejhgtn2wqhszrnhwden5te0dehhxtnvdakz7qg4waehxw309aex2mrp0yhxgctdw4eju6t09uq3yamnwvaz7tmj9e4k76nfwfsju6t09uq3uamnwvaz7tmwdaehgu3wvdhk6urfd3jj6etjwfhhytnwv46z7qpq94qllvmum7y9gvvkpe8843277ctssxk5k02ukua3vktrp0k3evasx3x9gp';
    const channelProfile = {
      name: 'Test Channel',
      about: `投稿リンク： ${longUrl}`,
      picture: '',
      relays: [],
    };
    mocks.extractChannelProfileFields.mockReturnValue(channelProfile);

    const state = { pubkey: ACCOUNT_A, profiles: new Map() };
    const container = setupView(state);
    await flushPromises();
    await selectChannel(OLD_CHANNEL);
    await flushPromises();

    const infoBtn = container.querySelector('#channelInfoBtn');
    infoBtn.click();
    await flushPromises();

    const aboutEl = document.querySelector('#channelInfoAbout');
    expect(aboutEl).toBeTruthy();
    const link = aboutEl.querySelector('a');
    expect(link).toBeTruthy();
    expect(link.href).toBe(longUrl);
  });
});

describe('channel feed reload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.body.innerHTML = `
      <div class="tabs"><button class="tab active" data-tab="channels"></button></div>
    `;
    mocks.fetchPublicChatsEntries.mockResolvedValue({ event: null, entries: [] });
  });

  it('keeps active chat open and re-subscribes when reloadChannelView is called', async () => {
    localStorage.setItem('pubkey', ACCOUNT_A);
    const state = { pubkey: ACCOUNT_A };
    const container = setupView(state);
    await flushPromises();
    await selectChannel(OLD_CHANNEL);
    await flushPromises();

    const wrapper = container.querySelector('.channel-portal-wrapper');
    expect(wrapper.classList.contains('show-chat')).toBe(true);

    mocks.subscribeChannelFeed.mockClear();
    reloadChannelView(state);
    await flushPromises();

    expect(wrapper.classList.contains('show-chat')).toBe(true);
    expect(mocks.subscribeChannelFeed).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeChannelFeed).toHaveBeenCalledWith(
      OLD_CHANNEL,
      state,
      container.querySelector('#channelMessages'),
      null
    );
  });

  it('clears search results and query on reloadChannelView and refresh button click', async () => {
    localStorage.setItem('pubkey', ACCOUNT_A);
    const state = { pubkey: ACCOUNT_A };
    const container = setupView(state);
    await flushPromises();

    const searchInput = container.querySelector('#channelSearchInput');
    const resultsEl = container.querySelector('#channelSearchResults');

    // Simulate search results displayed
    searchInput.value = 'test query';
    resultsEl.classList.remove('d-none');
    resultsEl.innerHTML = '<div class="channel-search-result-item">result</div>';

    // Test reloadChannelView clears search
    reloadChannelView(state);
    expect(searchInput.value).toBe('');
    expect(resultsEl.classList.contains('d-none')).toBe(true);
    expect(resultsEl.innerHTML).toBe('');

    // Re-simulate search results
    searchInput.value = 'another query';
    resultsEl.classList.remove('d-none');
    resultsEl.innerHTML = '<div class="channel-search-result-item">result 2</div>';

    // Test refreshBtn click clears search
    const refreshBtn = container.querySelector('#channelRefreshBtn');
    refreshBtn.click();
    expect(searchInput.value).toBe('');
    expect(resultsEl.classList.contains('d-none')).toBe(true);
    expect(resultsEl.innerHTML).toBe('');
  });

  it('hides create, edit list and refresh buttons and avoids loading text when unauthenticated', async () => {
    const container = setupView(null);
    await flushPromises();

    const createBtn = container.querySelector('#channelCreateBtn');
    const editListBtn = container.querySelector('#channelEditListBtn');
    const refreshBtn = container.querySelector('#channelRefreshBtn');
    const statusEl = container.querySelector('#channelListStatus');

    expect(createBtn.classList.contains('d-none')).toBe(true);
    expect(editListBtn.classList.contains('d-none')).toBe(true);
    expect(refreshBtn.classList.contains('d-none')).toBe(true);
    expect(statusEl.textContent).toBe('');
  });

  it('shows create, edit list and refresh buttons when authenticated', async () => {
    localStorage.setItem('pubkey', ACCOUNT_A);
    const container = setupView({ pubkey: ACCOUNT_A });
    await flushPromises();

    const createBtn = container.querySelector('#channelCreateBtn');
    const editListBtn = container.querySelector('#channelEditListBtn');
    const refreshBtn = container.querySelector('#channelRefreshBtn');

    expect(createBtn.classList.contains('d-none')).toBe(false);
    expect(editListBtn.classList.contains('d-none')).toBe(false);
    expect(refreshBtn.classList.contains('d-none')).toBe(false);
  });

  it('triggers a full non-resume reload when reloadChannelView is called while channel subscriptions are paused', async () => {
    localStorage.setItem('pubkey', ACCOUNT_A);
    const state = { pubkey: ACCOUNT_A };
    const container = setupView(state);
    await flushPromises();
    await selectChannel(OLD_CHANNEL);
    await flushPromises();

    // User navigates away to another tab
    pauseChannelSubscriptions();
    mocks.subscribeChannelFeed.mockClear();

    // User triggers soft reload while on the other tab
    reloadChannelView(state);
    await flushPromises();

    // Since paused, subscribeChannelFeed should not be called immediately during soft reload
    expect(mocks.subscribeChannelFeed).not.toHaveBeenCalled();

    // User navigates back to channels tab
    resumeChannelSubscriptions();
    await flushPromises();

    // Must be called with resume: false so it fetches fresh from latest posts
    expect(mocks.subscribeChannelFeed).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeChannelFeed).toHaveBeenCalledWith(
      OLD_CHANNEL,
      state,
      container.querySelector('#channelMessages'),
      null,
      { resume: false }
    );
  });
});


