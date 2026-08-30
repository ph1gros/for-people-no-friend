import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ViewerExConfigStore } from '../src/main/storage/viewerex-config-store';
import { DEFAULT_VIEWEREX_SETTINGS } from '../src/shared/viewerex-ipc';

describe('ViewerEX config store', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('migrates the first adapter file without guessing model mappings', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-viewerex-'));
    await writeFile(
      path.join(directory, 'viewerex.v1.json'),
      JSON.stringify({
        version: 1,
        settings: {
          enabled: true,
          port: 10086,
          modelIndex: 0,
          bubbleEnabled: true,
          bubbleDurationMs: 6_000,
          emotionExpressions: {},
          actionMotions: {},
        },
      }),
    );

    await expect(new ViewerExConfigStore(directory).get()).resolves.toMatchObject({
      workshopItemId: '',
      stateMotions: {},
    });
  });

  it('persists Workshop identity and validated semantic mappings atomically', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-viewerex-'));
    const store = new ViewerExConfigStore(directory);
    await store.set({
      ...DEFAULT_VIEWEREX_SETTINGS,
      enabled: true,
      workshopItemId: '2380801353',
      stateMotions: { talking: 'talk' },
      emotionExpressions: { happy: 0 },
      actionMotions: { wave: 'tap:wave' },
    });

    await expect(store.get()).resolves.toMatchObject({
      workshopItemId: '2380801353',
      stateMotions: { talking: 'talk' },
      emotionExpressions: { happy: 0 },
      actionMotions: { wave: 'tap:wave' },
    });
    expect(await readFile(path.join(directory, 'viewerex.v1.json'), 'utf8')).not.toContain(
      '.motion3.json',
    );
  });
});
