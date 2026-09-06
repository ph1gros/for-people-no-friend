import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SetupController, type SetupWindowHandle } from '../src/main/setup/setup-controller';
import { SetupStateStore } from '../src/main/storage/setup-state-store';
import { DEFAULT_SETUP_SELECTIONS } from '../src/shared/setup-ipc';

/** Walks the recommended path to the final page. */
const advanceToFinalStep = async (controller: {
  advance: (selections: typeof DEFAULT_SETUP_SELECTIONS) => Promise<{ isFinalStep: boolean }>;
}): Promise<void> => {
  for (let step = 0; step < 8; step += 1) {
    if ((await controller.advance(DEFAULT_SETUP_SELECTIONS)).isFinalStep) return;
  }
  throw new Error('The setup flow never reached its final step.');
};

const createWindowHandle = (): SetupWindowHandle & { closeFromUser(): void } => {
  let onClosed: (() => void) | undefined;
  let destroyed = false;
  const handle = {
    isDestroyed: () => destroyed,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      onClosed?.();
    },
    closeFromUser: () => handle.destroy(),
    once: (_event: 'closed', listener: () => void) => {
      onClosed = listener;
      return handle;
    },
    webContents: { mainFrame: {} },
  };
  return handle;
};

describe('setup controller lifecycle', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  const createController = async (
    overrides: Partial<{
      confirmCancel: (window: SetupWindowHandle) => Promise<boolean>;
      rerun: boolean;
    }> = {},
  ): Promise<{
    controller: SetupController;
    store: SetupStateStore;
    windows: (SetupWindowHandle & { closeFromUser(): void })[];
  }> => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-setup-controller-'));
    const store = new SetupStateStore(directory);
    const windows: (SetupWindowHandle & { closeFromUser(): void })[] = [];
    const controller = new SetupController<SetupWindowHandle & { closeFromUser(): void }>({
      store,
      appVersion: '1.7.0',
      createWindow: () => {
        const window = createWindowHandle();
        windows.push(window);
        return window;
      },
      ...(overrides.confirmCancel ? { confirmCancel: overrides.confirmCancel } : {}),
      ...(overrides.rerun === undefined ? {} : { rerun: overrides.rerun }),
      now: () => new Date('2026-03-04T05:06:07.000Z'),
    });
    return { controller, store, windows };
  };

  it('opens a single window and reports the initial page', async () => {
    const { controller, windows } = await createController({ rerun: true });

    const first = controller.open();
    const second = controller.open();

    expect(first).toBe(second);
    expect(windows).toHaveLength(1);
    expect(controller.getViewState()).toMatchObject({
      stepId: 'welcome',
      rerun: true,
      appVersion: '1.7.0',
      stateVersion: 2,
    });
  });

  it('keeps the renderer from finishing early', async () => {
    const { controller, store } = await createController();
    controller.open();

    await expect(controller.complete(DEFAULT_SETUP_SELECTIONS)).rejects.toThrow(/final step/u);
    await expect(store.get()).resolves.toMatchObject({ completed: false });
  });

  it('persists completion once the final page is reached', async () => {
    const { controller, store, windows } = await createController();
    controller.open();
    await advanceToFinalStep(controller);

    await expect(
      controller.complete({ ...DEFAULT_SETUP_SELECTIONS, launchAfterFinish: false }),
    ).resolves.toEqual({ completed: true, launchApp: false });

    await expect(controller.waitForOutcome()).resolves.toEqual({
      completed: true,
      launchApp: false,
    });
    expect(windows[0]?.isDestroyed()).toBe(true);
    await expect(store.get()).resolves.toEqual({
      version: 2,
      completed: true,
      completedAt: '2026-03-04T05:06:07.000Z',
      completedBy: 'wizard',
    });
  });

  it('keeps setup open when the cancellation prompt is declined', async () => {
    const { controller, windows } = await createController({ confirmCancel: async () => false });
    controller.open();

    await expect(controller.cancel()).resolves.toBe(false);

    expect(windows[0]?.isDestroyed()).toBe(false);
  });

  it('settles a cancellation that arrives after the window is already gone', async () => {
    const { controller, store } = await createController({
      confirmCancel: async () => true,
    });
    const window = controller.open();
    window.closeFromUser();

    await expect(controller.cancel()).resolves.toBe(true);
    await expect(controller.waitForOutcome()).resolves.toEqual({
      completed: false,
      launchApp: false,
    });
    await expect(store.get()).resolves.toMatchObject({ completed: false });
  });

  it('refuses navigation and completion that arrive after disposal', async () => {
    const { controller, store } = await createController();
    controller.open();
    await advanceToFinalStep(controller);
    controller.dispose();

    await expect(controller.complete(DEFAULT_SETUP_SELECTIONS)).rejects.toThrow(/already ended/u);
    await expect(controller.advance(DEFAULT_SETUP_SELECTIONS)).rejects.toThrow(/already ended/u);
    await expect(controller.back()).rejects.toThrow(/already ended/u);

    await expect(controller.waitForOutcome()).resolves.toEqual({
      completed: false,
      launchApp: false,
    });
    await expect(store.get()).resolves.toMatchObject({ completed: false });
    expect(controller.getWindow()).toBeUndefined();
    expect(() => controller.open()).toThrow(/disposed/u);
  });

  it('does not move past the last page when the renderer keeps advancing', async () => {
    const { controller } = await createController();
    controller.open();

    for (let index = 0; index < 8; index += 1) {
      await controller.advance(DEFAULT_SETUP_SELECTIONS);
    }

    expect(controller.getViewState()).toMatchObject({ stepId: 'finish', isFinalStep: true });
    expect(await controller.back()).toMatchObject({ stepId: 'review' });
  });
});
