import { afterEach, describe, expect, it, vi } from 'vitest';

describe('infinite scroll boot module', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('keeps requesting successful pages while the load-more target remains visible', async () => {
    let callback;
    const observe = vi.fn();
    const Observer = vi.fn((handler) => {
      callback = handler;
      return { observe };
    });
    const click = vi.fn();

    vi.stubGlobal('window', {});
    vi.stubGlobal('IntersectionObserver', Observer);
    const module = await import('./infinite-scroll.js');

    const first = module.setupInfiniteScrollObserver();
    expect(module.setupInfiniteScrollObserver()).toBe(first);
    expect(Observer).toHaveBeenCalledTimes(1);

    const entry = {
      isIntersecting: true,
      target: {
        disabled: false,
        dataset: { autoLoad: '1' },
        click,
        classList: { contains: () => true }
      }
    };
    callback([entry]);
    expect(click).toHaveBeenCalledOnce();
    callback([entry]);
    expect(click).toHaveBeenCalledTimes(2);
    expect(module.getInfiniteScrollObserver()).toBe(first);
  });

  it('does not auto-click a button switched to manual retry mode', async () => {
    let callback;
    const click = vi.fn();
    vi.stubGlobal('window', {});
    vi.stubGlobal('IntersectionObserver', vi.fn((handler) => {
      callback = handler;
      return { observe: vi.fn() };
    }));
    const module = await import('./infinite-scroll.js');
    module.setupInfiniteScrollObserver();

    callback([{
      isIntersecting: true,
      target: {
        disabled: false,
        dataset: { autoLoad: '0' },
        click,
        classList: { contains: () => true }
      }
    }]);

    expect(click).not.toHaveBeenCalled();
  });
});
