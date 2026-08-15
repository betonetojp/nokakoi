// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseRelaysText,
  buildChannelCreateDraft,
  openChannelCreateModal,
} from './channel-creator.js';

const mocks = vi.hoisted(() => ({
  signEventWithMode: vi.fn(),
  cacheEvent: vi.fn(),
  t: vi.fn(key => key),
}));

vi.mock('../../core/relay.js', () => ({
  getWriteRelays: vi.fn(() => ['wss://relay.example.com']),
}));

vi.mock('../post/actions.js', () => ({
  signEventWithMode: mocks.signEventWithMode,
}));

vi.mock('../../core/state.js', () => ({
  cacheEvent: mocks.cacheEvent,
}));

vi.mock('../../utils/i18n.js', () => ({
  t: mocks.t,
}));

describe('channel-creator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="channelCreateModal" hidden>
        <div class="modal-body">
          <div id="channelCreateStatus"></div>
          <div id="channelCreateContent"></div>
          <button id="channelCreateSubmitBtn">作成</button>
          <button id="channelCreateCancelBtn">キャンセル</button>
          <button id="channelCreateClose">✕</button>
        </div>
      </div>
    `;
    localStorage.clear();
  });

  describe('parseRelaysText', () => {
    it('parses multiple relay urls separated by newline or comma and adds wss:// prefix', () => {
      const input = `
        relay1.example.com
        wss://relay2.example.com, ws://relay3.example.com
        relay1.example.com
      `;
      const result = parseRelaysText(input);
      expect(result).toEqual([
        'wss://relay1.example.com',
        'wss://relay2.example.com',
        'ws://relay3.example.com',
      ]);
    });

    it('returns empty array for empty string or whitespace', () => {
      expect(parseRelaysText('')).toEqual([]);
      expect(parseRelaysText('   \n  ')).toEqual([]);
    });
  });

  describe('buildChannelCreateDraft', () => {
    it('throws error when name is empty', () => {
      expect(() => buildChannelCreateDraft({ name: '' })).toThrow();
      expect(() => buildChannelCreateDraft({ name: '   ' })).toThrow();
    });

    it('creates valid kind:40 draft with full metadata', () => {
      const draft = buildChannelCreateDraft({
        name: 'My New Channel',
        about: 'Description of the channel',
        picture: 'https://example.com/icon.png',
        relays: ['wss://relay1.example.com'],
        pubkey: 'npub_or_hex_pubkey',
      });

      expect(draft.kind).toBe(40);
      expect(draft.tags).toEqual([]);
      expect(draft.pubkey).toBe('npub_or_hex_pubkey');
      expect(typeof draft.created_at).toBe('number');

      const parsedContent = JSON.parse(draft.content);
      expect(parsedContent).toEqual({
        name: 'My New Channel',
        about: 'Description of the channel',
        picture: 'https://example.com/icon.png',
        relays: ['wss://relay1.example.com'],
      });
    });

    it('omits optional fields if not provided or empty', () => {
      const draft = buildChannelCreateDraft({
        name: 'Simple Channel',
        pubkey: 'my_pubkey',
      });

      const parsedContent = JSON.parse(draft.content);
      expect(parsedContent).toEqual({
        name: 'Simple Channel',
      });
    });
  });

  describe('openChannelCreateModal', () => {
    it('shows login required when no pubkey is set', async () => {
      const state = { pubkey: null };
      await openChannelCreateModal(state);

      const statusEl = document.getElementById('channelCreateStatus');
      expect(statusEl.textContent).toBe('editor.common.no_login');
    });

    it('renders creation form and handles cancel/close', async () => {
      const state = {
        pubkey: '11'.repeat(32),
        relays: { 'wss://relay.example.com': { write: true } },
      };
      await openChannelCreateModal(state);

      const modal = document.getElementById('channelCreateModal');
      expect(modal.hidden).toBe(false);

      const nameInput = document.getElementById('channelCreateName');
      expect(nameInput).not.toBeNull();

      const cancelBtn = document.getElementById('channelCreateCancelBtn');
      cancelBtn.click();
      expect(modal.hidden).toBe(true);
    });

    it('successfully creates channel, signs, publishes and calls onCreated', async () => {
      const myPubkey = '22'.repeat(32);
      const publishMock = vi.fn(() => [Promise.resolve()]);
      const state = {
        pubkey: myPubkey,
        relays: { 'wss://relay.example.com': { write: true } },
        pool: { publish: publishMock },
      };

      mocks.signEventWithMode.mockImplementation(async (_st, draft) => ({
        ...draft,
        id: 'new_channel_event_id_' + '33'.repeat(20),
        sig: 'signature_xxx',
      }));

      const onCreated = vi.fn();
      await openChannelCreateModal(state, { onCreated });

      const nameInput = document.getElementById('channelCreateName');
      const aboutInput = document.getElementById('channelCreateAbout');
      nameInput.value = 'Test Channel';
      aboutInput.value = 'Hello World';

      const submitBtn = document.getElementById('channelCreateSubmitBtn');
      submitBtn.click();

      // Confirm dialog overlay is created
      const confirmOkBtn = document.querySelector('.editor-confirm-actions button:last-child');
      expect(confirmOkBtn).not.toBeNull();
      confirmOkBtn.click();

      await vi.waitFor(() => {
        expect(mocks.signEventWithMode).toHaveBeenCalled();
        expect(publishMock).toHaveBeenCalled();
        expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({
          rootId: expect.stringContaining('new_channel_event_id_'),
          profile: expect.objectContaining({
            name: 'Test Channel',
            about: 'Hello World',
          }),
        }));
      });
    });
  });
});
