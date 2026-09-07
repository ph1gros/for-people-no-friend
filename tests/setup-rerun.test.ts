import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveSetupLaunchDecision } from '../src/main/setup/first-run-detection';
import { SetupStateStore } from '../src/main/storage/setup-state-store';
import { DEFAULT_SETUP_SELECTIONS } from '../src/core/setup/setup-flow';

/**
 * Rerunning the wizard from the tray must not put a configured installation back into
 * first-run state: an abandoned rerun would otherwise force setup on the next launch.
 */
describe('rerunning setup on a configured installation', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  const createStore = async (): Promise<SetupStateStore> => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-setup-rerun-'));
    return new SetupStateStore(directory);
  };

  const startRerun = (store: SetupStateStore): Promise<unknown> =>
    store.saveProgress({
      stepId: 'welcome',
      selections: { ...DEFAULT_SETUP_SELECTIONS },
      rerun: true,
    });

  it('keeps the completion marker while a rerun is in progress', async () => {
    const store = await createStore();
    await store.markCompleted('existing-installation');

    await startRerun(store);

    const state = await store.get();
    expect(state.completed).toBe(true);
    expect(state.completedBy).toBe('existing-installation');
    expect(state.progress?.rerun).toBe(true);
  });

  it('does not force setup at the next launch after an abandoned rerun', async () => {
    const store = await createStore();
    await store.markCompleted('wizard');
    await startRerun(store);

    // The user closes the wizard without finishing; nothing else is written.
    const decision = resolveSetupLaunchDecision({
      state: await store.get(),
      hasExistingConfiguration: true,
    });

    expect(decision).toEqual({ runSetup: false, adoptExistingInstallation: false });
  });

  it('still resumes an interrupted first run', async () => {
    const store = await createStore();
    await store.saveProgress({
      stepId: 'provider',
      selections: { ...DEFAULT_SETUP_SELECTIONS },
      rerun: false,
    });

    const state = await store.get();
    expect(state.completed).toBe(false);
    // A first run that already wrote provider configuration must return to the wizard rather
    // than be mistaken for an existing installation.
    expect(resolveSetupLaunchDecision({ state, hasExistingConfiguration: true })).toEqual({
      runSetup: true,
      adoptExistingInstallation: false,
    });
  });
});
