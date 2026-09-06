import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SetupStateStore } from '../src/main/storage/setup-state-store';
import { SETUP_STATE_VERSION, parseSetupState } from '../src/shared/setup-ipc';

describe('setup state store', () => {
  let directory: string | undefined;

  const createDirectory = async (): Promise<string> => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-setup-state-'));
    return directory;
  };

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('reports an incomplete setup before the first run', async () => {
    const store = new SetupStateStore(await createDirectory());

    await expect(store.get()).resolves.toEqual({
      version: SETUP_STATE_VERSION,
      completed: false,
    });
  });

  it('persists an explicit completion marker with its source', async () => {
    const root = await createDirectory();
    const store = new SetupStateStore(root);

    const saved = await store.markCompleted('wizard', new Date('2026-01-02T03:04:05.000Z'));

    expect(saved).toEqual({
      version: SETUP_STATE_VERSION,
      completed: true,
      completedAt: '2026-01-02T03:04:05.000Z',
      completedBy: 'wizard',
    });
    expect(JSON.parse(await readFile(path.join(root, 'setup.v1.json'), 'utf8'))).toEqual(saved);
    await expect(new SetupStateStore(root).get()).resolves.toEqual(saved);
  });

  it('records an upgraded installation separately from a wizard completion', async () => {
    const store = new SetupStateStore(await createDirectory());

    await store.markCompleted('existing-installation');

    await expect(store.get()).resolves.toMatchObject({
      completed: true,
      completedBy: 'existing-installation',
    });
  });

  it('treats a damaged or future marker as an incomplete setup instead of failing', async () => {
    const root = await createDirectory();
    const filePath = path.join(root, 'setup.v1.json');

    await writeFile(filePath, '{ not json', 'utf8');
    await expect(new SetupStateStore(root).get()).resolves.toEqual({
      version: SETUP_STATE_VERSION,
      completed: false,
    });

    await writeFile(filePath, JSON.stringify({ version: 99, completed: true }), 'utf8');
    await expect(new SetupStateStore(root).get()).resolves.toEqual({
      version: SETUP_STATE_VERSION,
      completed: false,
    });
  });

  it('can reset the marker so setup runs again', async () => {
    const store = new SetupStateStore(await createDirectory());
    await store.markCompleted('wizard');

    await store.reset();

    await expect(store.get()).resolves.toEqual({
      version: SETUP_STATE_VERSION,
      completed: false,
    });
  });

  it('rejects unknown completion sources and malformed timestamps', () => {
    expect(() =>
      parseSetupState({ version: 1, completed: true, completedBy: 'installer' }),
    ).toThrow();
    expect(() =>
      parseSetupState({ version: 1, completed: true, completedAt: 'yesterday' }),
    ).toThrow();
    expect(() => parseSetupState({ version: 0, completed: false })).toThrow();
    expect(() => parseSetupState({ completed: true })).toThrow();
  });
});
