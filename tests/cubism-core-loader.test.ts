import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCubismCore } from '../src/renderer/live2d/cubism-core-loader';

const setup = () => {
  const scripts: Array<EventTarget & { src: string; remove: ReturnType<typeof vi.fn> }> = [];
  const browser: { location: { href: string }; Live2DCubismCore?: object } = {
    location: { href: 'file:///app/dist/renderer/index.html' },
  };
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', {
    createElement: () => Object.assign(new EventTarget(), { src: '', remove: vi.fn() }),
    head: { append: (script: (typeof scripts)[number]) => scripts.push(script) },
  });
  return { browser, scripts };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('application-owned Cubism Core loader', () => {
  it('loads only the application runtime and shares a concurrent request', async () => {
    const { browser, scripts } = setup();
    const first = loadCubismCore();
    const second = loadCubismCore();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe('file:///app/dist/renderer/runtime/cubism/live2dcubismcore.min.js');
    browser.Live2DCubismCore = {};
    scripts[0].dispatchEvent(new Event('load'));
    await Promise.all([first, second]);
    await loadCubismCore();
    expect(scripts).toHaveLength(1);
  });

  it('reports missing Core separately and permits retry after a failed script', async () => {
    const { browser, scripts } = setup();
    const first = loadCubismCore();
    const failure = expect(first).rejects.toMatchObject({ kind: 'unavailable' });
    scripts[0].dispatchEvent(new Event('error'));
    await failure;
    expect(scripts[0].remove).toHaveBeenCalledOnce();
    const retry = loadCubismCore();
    browser.Live2DCubismCore = {};
    scripts[1].dispatchEvent(new Event('load'));
    await retry;
  });

  it('rejects a script that loaded without providing Core', async () => {
    const { scripts } = setup();
    const request = loadCubismCore();
    const failure = expect(request).rejects.toMatchObject({ kind: 'invalid' });
    scripts[0].dispatchEvent(new Event('load'));
    await failure;
    expect(scripts[0].remove).toHaveBeenCalledOnce();
  });

  it('bounds a script that never completes and removes it for a later retry', async () => {
    vi.useFakeTimers();
    const { scripts } = setup();
    const request = loadCubismCore();
    const failure = expect(request).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(scripts[0].remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
