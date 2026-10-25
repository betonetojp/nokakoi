// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { reconcileFeedDom, PRELOAD_EVENT_OFFSET } from './feed-diff.js';

describe('reconcileFeedDom', () => {
  function createTestNode(id, text = '') {
    const el = document.createElement('div');
    el.className = 'event';
    el.dataset.eventId = id;
    el.textContent = text || id;
    return el;
  }

  function mockBuildNode(ev) {
    return createTestNode(ev.id, ev.content || ev.id);
  }

  it('handles noop when DOM and render list match exactly', () => {
    const container = document.createElement('div');
    const n1 = createTestNode('id-1');
    const n2 = createTestNode('id-2');
    container.appendChild(n1);
    container.appendChild(n2);

    const events = [{ id: 'id-1' }, { id: 'id-2' }];
    const res = reconcileFeedDom({
      container,
      eventsToRender: events,
      buildNode: mockBuildNode
    });

    expect(res.modified).toBe(false);
    expect(res.appendOnly).toBe(false);
    expect(container.children.length).toBe(2);
    expect(container.children[0]).toBe(n1);
    expect(container.children[1]).toBe(n2);
  });

  it('prepends new events while keeping existing DOM nodes unchanged', () => {
    const container = document.createElement('div');
    const n1 = createTestNode('id-1');
    const n2 = createTestNode('id-2');
    container.appendChild(n1);
    container.appendChild(n2);

    const events = [{ id: 'id-new' }, { id: 'id-1' }, { id: 'id-2' }];
    const res = reconcileFeedDom({
      container,
      eventsToRender: events,
      buildNode: mockBuildNode,
      animateNewItems: true
    });

    expect(res.modified).toBe(true);
    expect(res.appendOnly).toBe(false);
    expect(res.prependedCount).toBe(1);
    expect(container.children.length).toBe(3);
    expect(container.children[0].dataset.eventId).toBe('id-new');
    expect(container.children[0].classList.contains('event-slide-in')).toBe(true);
    expect(container.children[1]).toBe(n1);
    expect(container.children[2]).toBe(n2);
  });

  it('appends older events at the bottom before sentinels', () => {
    const container = document.createElement('div');
    const n1 = createTestNode('id-1');
    const sentinel = document.createElement('div');
    sentinel.className = 'feed-scroll-sentinel';
    const bottomBar = document.createElement('button');
    bottomBar.className = 'feed-bar-bottom';

    container.appendChild(n1);
    container.appendChild(sentinel);
    container.appendChild(bottomBar);

    const events = [{ id: 'id-1' }, { id: 'id-2' }];
    const res = reconcileFeedDom({
      container,
      eventsToRender: events,
      buildNode: mockBuildNode,
      scrollSentinel: sentinel,
      bottomBar
    });

    expect(res.modified).toBe(true);
    expect(res.appendOnly).toBe(true);
    expect(res.appendedCount).toBe(1);
    expect(container.children.length).toBe(4);
    expect(container.children[0]).toBe(n1);
    expect(container.children[1].dataset.eventId).toBe('id-2');
    expect(container.children[2]).toBe(sentinel);
    expect(container.children[3]).toBe(bottomBar);
  });

  it('handles prepend + trim (fixed window size / 500 limit)', () => {
    const container = document.createElement('div');
    const n1 = createTestNode('id-1');
    const n2 = createTestNode('id-2');
    const n3 = createTestNode('id-3');
    container.appendChild(n1);
    container.appendChild(n2);
    container.appendChild(n3);

    // List is trimmed to keep length 3: [new-0, id-1, id-2], trimming id-3
    const events = [{ id: 'new-0' }, { id: 'id-1' }, { id: 'id-2' }];
    const obs = { unobserve: vi.fn(), observe: vi.fn() };

    const res = reconcileFeedDom({
      container,
      eventsToRender: events,
      buildNode: mockBuildNode,
      obs
    });

    expect(res.modified).toBe(true);
    expect(res.prependedCount).toBe(1);
    expect(res.removedCount).toBe(1);
    expect(container.children.length).toBe(3);
    expect(container.children[0].dataset.eventId).toBe('new-0');
    expect(container.children[1]).toBe(n1);
    expect(container.children[2]).toBe(n2);
    expect(obs.unobserve).toHaveBeenCalledWith(n3);
  });

  it('removes nodes not present in render list', () => {
    const container = document.createElement('div');
    const n1 = createTestNode('id-1');
    const n2 = createTestNode('id-2');
    const n3 = createTestNode('id-3');
    container.appendChild(n1);
    container.appendChild(n2);
    container.appendChild(n3);

    const events = [{ id: 'id-1' }, { id: 'id-3' }];
    const res = reconcileFeedDom({
      container,
      eventsToRender: events,
      buildNode: mockBuildNode
    });

    expect(res.modified).toBe(true);
    expect(res.removedCount).toBe(1);
    expect(container.children.length).toBe(2);
    expect(container.children[0]).toBe(n1);
    expect(container.children[1]).toBe(n3);
  });

  it('removes old bottom bars and sentinels and keeps them strictly at the end', () => {
    const container = document.createElement('div');
    const n1 = createTestNode('id-1');
    const oldSentinel = document.createElement('div');
    oldSentinel.className = 'feed-scroll-sentinel';
    const oldBottomBar = document.createElement('button');
    oldBottomBar.className = 'feed-bar feed-bar-bottom';
    oldBottomBar.textContent = '読み込み中...';

    container.appendChild(n1);
    container.appendChild(oldSentinel);
    container.appendChild(oldBottomBar);

    // 新しいイベントが追加され、新しい bottomBar と sentinel が渡される
    const newSentinel = document.createElement('div');
    newSentinel.className = 'feed-scroll-sentinel';
    const newBottomBar = document.createElement('button');
    newBottomBar.className = 'feed-bar feed-bar-bottom';
    newBottomBar.textContent = 'もっと読む';

    const events = [{ id: 'id-1' }, { id: 'id-2' }];
    reconcileFeedDom({
      container,
      eventsToRender: events,
      buildNode: mockBuildNode,
      scrollSentinel: newSentinel,
      bottomBar: newBottomBar
    });

    // 古い sentinel や古い bottomBar は削除され、新しい要素が最後に来る
    expect(container.querySelectorAll('.feed-bar-bottom').length).toBe(1);
    expect(container.querySelectorAll('.feed-scroll-sentinel').length).toBe(1);
    expect(container.lastElementChild).toBe(newBottomBar);
    expect(container.children[0].dataset.eventId).toBe('id-1');
    expect(container.children[1].dataset.eventId).toBe('id-2');
    expect(container.children[2]).toBe(newSentinel);
    expect(container.children[3]).toBe(newBottomBar);
  });

  it('cleans up old bottom bars when load more is disabled (null bottomBar)', () => {
    const container = document.createElement('div');
    const n1 = createTestNode('id-1');
    const oldBottomBar = document.createElement('button');
    oldBottomBar.className = 'feed-bar feed-bar-bottom';
    oldBottomBar.textContent = '読み込み中...';
    container.appendChild(n1);
    container.appendChild(oldBottomBar);

    reconcileFeedDom({
      container,
      eventsToRender: [{ id: 'id-1' }],
      buildNode: mockBuildNode,
      bottomBar: null,
      scrollSentinel: null
    });

    expect(container.querySelectorAll('.feed-bar-bottom').length).toBe(0);
    expect(container.children.length).toBe(1);
    expect(container.children[0]).toBe(n1);
  });

  it('places scrollSentinel PRELOAD_EVENT_OFFSET items before the end when there are enough items', () => {
    const container = document.createElement('div');
    const sentinel = document.createElement('div');
    sentinel.className = 'feed-scroll-sentinel';
    const bottomBar = document.createElement('button');
    bottomBar.className = 'feed-bar feed-bar-bottom';

    const totalItems = PRELOAD_EVENT_OFFSET + 5;
    const events = Array.from({ length: totalItems }, (_, i) => ({ id: `id-${i}` }));
    reconcileFeedDom({
      container,
      eventsToRender: events,
      buildNode: mockBuildNode,
      scrollSentinel: sentinel,
      bottomBar
    });

    const eventNodes = container.querySelectorAll('.event');
    expect(eventNodes.length).toBe(totalItems);
    // container children: items 0..4 (5 items), sentinel (1 item), items 5..totalItems-1 (PRELOAD_EVENT_OFFSET items), bottomBar (1 item)
    expect(container.children[5]).toBe(sentinel);
    expect(container.children[6].dataset.eventId).toBe('id-5');
    expect(container.lastElementChild).toBe(bottomBar);
  });
});
