import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  BrowserWindow: class {},
}));

import {
  EXISTING_INSTALLATION_MARKERS,
  detectExistingInstallation,
  resolveSetupLaunchDecision,
} from '../src/main/setup/first-run-detection';
import { runFirstRunSetupIfNeeded } from '../src/main/setup/first-run-setup';
import type { SetupIpcController } from '../src/main/ipc/register-setup-ipc-handlers';
import { SetupStateStore } from '../src/main/storage/setup-state-store';
import { DEFAULT_SETUP_SELECTIONS } from '../src/shared/setup-ipc';

interface FakeSetupWindow {
  destroyed: boolean;
  isDestroyed(): boolean;
  destroy(): void;
  closeFromUser(): void;
  once(event: 'closed', listener: () => void): unknown;
  webContents: { mainFrame: unknown };
}

const createFakeWindow = (): FakeSetupWindow => {
  let onClosed: (() => void) | undefined;
  const window: FakeSetupWindow = {
    destroyed: false,
    isDestroyed: () => window.destroyed,
    destroy: () => {
      if (window.destroyed) return;
      window.destroyed = true;
      onClosed?.();
    },
    closeFromUser: () => window.destroy(),
    once: (_event, listener) => {
      onClosed = listener;
      return window;
    },
    webContents: { mainFrame: {} },
  };
  return window;
};

describe('existing installation detection', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('finds no configuration in an empty profile', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-setup-detect-'));

    await expect(detectExistingInstallation(directory)).resolves.toBe(false);
  });

  it('recognises every marker written by earlier releases', async () => {
    for (const marker of EXISTING_INSTALLATION_MARKERS) {
      const root = await mkdtemp(path.join(os.tmpdir(), 'fpnf-setup-marker-'));
      try {
        await writeFile(path.join(root, marker), '{}', 'utf8');
        await expect(detectExistingInstallation(root)).resolves.toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it('runs setup only for a profile that has neither a marker nor configuration', () => {
    expect(
      resolveSetupLaunchDecision({
        state: { version: 1, completed: false },
        hasExistingConfiguration: false,
      }),
    ).toEqual({ runSetup: true, adoptExistingInstallation: false });
    expect(
      resolveSetupLaunchDecision({
        state: { version: 1, completed: false },
        hasExistingConfiguration: true,
      }),
    ).toEqual({ runSetup: false, adoptExistingInstallation: true });
    expect(
      resolveSetupLaunchDecision({
        state: { version: 1, completed: true, completedBy: 'wizard' },
        hasExistingConfiguration: false,
      }),
    ).toEqual({ runSetup: false, adoptExistingInstallation: false });
  });
});

describe('first run setup lifecycle', () => {
  it('preserves cancellation when closing the window aborts its page load', async () => {
    const window = createFakeWindow();
    const result = await runFirstRunSetupIfNeeded({
      userDataPath: 'unused-fixture',
      appVersion: '1.8.1',
      store: {
        get: async () => ({ version: 2, completed: false }),
        saveProgress: async () => undefined,
      } as never,
      hasExistingConfiguration: async () => false,
      createWindow: () => window as never,
      waitForWindowLoad: async () => {
        window.closeFromUser();
        throw new Error('fixture load aborted');
      },
      registerHandlers: () => () => undefined,
    });
    expect(result).toMatchObject({ startApplication: false, ranWizard: true });
  });
  it('falls back and cleans up when the page fails to load asynchronously', async () => {
    const window = createFakeWindow();
    const unregister = vi.fn();
    const run = runFirstRunSetupIfNeeded({
      userDataPath: 'unused-fixture',
      appVersion: '1.8.1',
      store: {
        get: async () => ({ version: 2, completed: false }),
        saveProgress: async () => undefined,
      } as never,
      hasExistingConfiguration: async () => false,
      createWindow: () => window as never,
      waitForWindowLoad: async () => {
        throw new Error('fixture load failure');
      },
      registerHandlers: () => unregister,
    });
    try {
      const result = await Promise.race([
        run,
        new Promise((resolve) => setTimeout(() => resolve('still waiting'), 100)),
      ]);
      expect(result).toMatchObject({ startApplication: true, ranWizard: false });
      expect(window.destroyed).toBe(true);
      expect(unregister).toHaveBeenCalledTimes(1);
    } finally {
      window.destroy();
      await run;
    }
  });
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  const createDirectory = async (): Promise<string> => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-setup-run-'));
    return directory;
  };

  const runWizard = async (
    userDataPath: string,
    drive: (controller: SetupIpcController, window: FakeSetupWindow) => void | Promise<void>,
    options: { hasExistingConfiguration?: boolean } = {},
  ): Promise<{
    result: Awaited<ReturnType<typeof runFirstRunSetupIfNeeded>>;
    window: FakeSetupWindow;
    unregistered: () => number;
  }> => {
    const window = createFakeWindow();
    let unregisterCalls = 0;
    const pending = runFirstRunSetupIfNeeded({
      userDataPath,
      appVersion: '1.7.0',
      hasExistingConfiguration: async () => options.hasExistingConfiguration ?? false,
      createWindow: () => window as never,
      confirmCancel: async () => true,
      registerHandlers: (controller) => {
        void Promise.resolve().then(() => drive(controller, window));
        return () => {
          unregisterCalls += 1;
        };
      },
    });
    return { result: await pending, window, unregistered: () => unregisterCalls };
  };

  it('completes a new installation and starts the application', async () => {
    const root = await createDirectory();

    const { result, window, unregistered } = await runWizard(root, async (controller) => {
      expect(controller.getViewState()).toMatchObject({
        stepId: 'welcome',
        rerun: false,
        appVersion: '1.7.0',
      });
      const custom = { ...DEFAULT_SETUP_SELECTIONS, mode: 'custom' as const };
      expect((await controller.advance(custom)).stepId).toBe('mode');
      expect((await controller.advance(custom)).stepId).toBe('provider');
      expect((await controller.advance(custom)).stepId).toBe('character');
      expect((await controller.advance(custom)).stepId).toBe('voice');
      expect((await controller.advance(custom)).stepId).toBe('speechInput');
      expect((await controller.advance(custom)).stepId).toBe('review');
      expect(await controller.advance(custom)).toMatchObject({
        stepId: 'finish',
        isFinalStep: true,
      });
      await controller.complete({ ...custom, launchAfterFinish: true });
    });

    expect(result).toEqual({
      startApplication: true,
      ranWizard: true,
      adoptedExistingInstallation: false,
    });
    expect(window.destroyed).toBe(true);
    expect(unregistered()).toBe(1);
    await expect(new SetupStateStore(root).get()).resolves.toMatchObject({
      completed: true,
      completedBy: 'wizard',
    });
  });

  it('records completion but stays closed when the user clears the launch option', async () => {
    const root = await createDirectory();

    const { result } = await runWizard(root, async (controller) => {
      while (!(await controller.advance(DEFAULT_SETUP_SELECTIONS)).isFinalStep) {
        // Walk the recommended path to the final page.
      }
      await controller.complete({ ...DEFAULT_SETUP_SELECTIONS, launchAfterFinish: false });
    });

    expect(result.startApplication).toBe(false);
    await expect(new SetupStateStore(root).get()).resolves.toMatchObject({ completed: true });
  });

  it('leaves setup incomplete when the user cancels', async () => {
    const root = await createDirectory();

    const { result, window } = await runWizard(root, async (controller) => {
      await controller.cancel();
    });

    expect(result).toEqual({
      startApplication: false,
      ranWizard: true,
      adoptedExistingInstallation: false,
    });
    expect(window.destroyed).toBe(true);
    await expect(new SetupStateStore(root).get()).resolves.toMatchObject({ completed: false });
  });

  it('treats closing the setup window as a cancellation', async () => {
    const root = await createDirectory();

    const { result } = await runWizard(root, (_controller, window) => {
      window.closeFromUser();
    });

    expect(result.startApplication).toBe(false);
    await expect(new SetupStateStore(root).get()).resolves.toMatchObject({ completed: false });
  });

  it('rejects completion requested before the final page', async () => {
    const root = await createDirectory();

    await runWizard(root, async (controller) => {
      await expect(controller.complete(DEFAULT_SETUP_SELECTIONS)).rejects.toThrow();
      await controller.cancel();
    });

    await expect(new SetupStateStore(root).get()).resolves.toMatchObject({ completed: false });
  });

  it('adopts an installation that predates the wizard without showing it', async () => {
    const root = await createDirectory();
    let created = 0;

    const result = await runFirstRunSetupIfNeeded({
      userDataPath: root,
      appVersion: '1.7.0',
      hasExistingConfiguration: async () => true,
      createWindow: () => {
        created += 1;
        return createFakeWindow() as never;
      },
    });

    expect(result).toEqual({
      startApplication: true,
      ranWizard: false,
      adoptedExistingInstallation: true,
    });
    expect(created).toBe(0);
    await expect(new SetupStateStore(root).get()).resolves.toMatchObject({
      completed: true,
      completedBy: 'existing-installation',
    });
  });

  it('does not show the wizard again after it completed once', async () => {
    const root = await createDirectory();
    await new SetupStateStore(root).markCompleted('wizard');
    let created = 0;

    const result = await runFirstRunSetupIfNeeded({
      userDataPath: root,
      appVersion: '1.7.0',
      hasExistingConfiguration: async () => false,
      createWindow: () => {
        created += 1;
        return createFakeWindow() as never;
      },
    });

    expect(result).toEqual({
      startApplication: true,
      ranWizard: false,
      adoptedExistingInstallation: false,
    });
    expect(created).toBe(0);
  });

  it('starts the application when the setup window cannot be created', async () => {
    const root = await createDirectory();
    let unregisterCalls = 0;

    const result = await runFirstRunSetupIfNeeded({
      userDataPath: root,
      appVersion: '1.7.0',
      hasExistingConfiguration: async () => false,
      createWindow: () => {
        throw new Error('display unavailable');
      },
      registerHandlers: () => () => {
        unregisterCalls += 1;
      },
    });

    expect(result).toEqual({
      startApplication: true,
      ranWizard: false,
      adoptedExistingInstallation: false,
    });
    expect(unregisterCalls).toBe(1);
    await expect(new SetupStateStore(root).get()).resolves.toMatchObject({ completed: false });
  });
});
