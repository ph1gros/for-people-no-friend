import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const layoutState = vi.hoisted(() => ({ expanded: false }));

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\fake-window-state',
  },
  screen: {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

vi.mock('../src/main/windows/create-main-window', () => ({
  configureMainWindowLayout: (_window: unknown, expanded: boolean) => {
    layoutState.expanded = expanded;
  },
  createMainWindow: vi.fn(),
}));

import { WindowManager } from '../src/main/windows/window-manager';

describe('window manager scale transitions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    layoutState.expanded = false;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('keeps an 80 percent scale after opening and collapsing the conversation window', () => {
    let bounds = { x: 100, y: 100, width: 288, height: 416 };
    const window = {
      getBounds: () => ({ ...bounds }),
      setBounds: (requested: typeof bounds) => {
        bounds =
          layoutState.expanded && requested.width < 715
            ? { ...requested, width: 715, height: 494 }
            : { ...requested };
      },
      isDestroyed: () => false,
      isMinimized: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
    };
    const manager = new WindowManager();
    (manager as unknown as { window: typeof window }).window = window;

    manager.setChatPanelExpanded(true);
    expect(manager.getScale()).toBe(0.8);

    manager.setChatPanelExpanded(false);

    expect(manager.getScale()).toBe(0.8);
  });

  it('reports the explicit settings panel state independently of the window aspect ratio', () => {
    const onSettingsPanelExpandedChanged = vi.fn();
    const manager = new WindowManager(onSettingsPanelExpandedChanged);
    const window = {
      getBounds: () => ({ x: 100, y: 100, width: 858, height: 593 }),
      setBounds: vi.fn(),
      isDestroyed: () => false,
      isMinimized: () => false,
      webContents: { isDestroyed: () => false, send: vi.fn() },
    };
    (manager as unknown as { window: typeof window }).window = window;

    manager.setChatPanelExpanded(true, true);
    manager.setChatPanelExpanded(true, false);

    expect(onSettingsPanelExpandedChanged).toHaveBeenNthCalledWith(1, true);
    expect(onSettingsPanelExpandedChanged).toHaveBeenNthCalledWith(2, false);
  });
});
