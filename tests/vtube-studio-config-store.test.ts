import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { VTubeStudioConfigStore } from '../src/main/storage/vtube-studio-config-store';

describe('VTube Studio config store', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('defaults to a disabled local adapter', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-vtube-studio-'));
    await expect(new VTubeStudioConfigStore(directory).get()).resolves.toEqual({
      enabled: false,
      port: 8001,
      mouseTrackingEnabled: false,
      emotionExpressions: {},
      modelMappings: {},
    });
  });

  it('persists only validated non-secret settings', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-vtube-studio-'));
    const store = new VTubeStudioConfigStore(directory);
    await store.set({ enabled: true, port: 8123, mouseTrackingEnabled: true });

    await expect(store.get()).resolves.toEqual({
      enabled: true,
      port: 8123,
      mouseTrackingEnabled: true,
      emotionExpressions: {},
      modelMappings: {},
    });
    const text = await readFile(path.join(directory, 'vtube-studio.v1.json'), 'utf8');
    expect(text).not.toContain('authenticationToken');
    expect(text).not.toContain('127.0.0.1');
  });

  it('keeps confirmed presentation mappings in separate model namespaces', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-vtube-studio-'));
    const store = new VTubeStudioConfigStore(directory);
    await store.set({
      enabled: true,
      port: 8001,
      mouseTrackingEnabled: false,
      emotionExpressions: {},
      modelMappings: {
        'model-a': {
          modelName: 'Akari',
          emotionExpressions: { angry: 'Angry.exp3.json' },
          actionHotkeys: { nod: 'nod-a' },
        },
        'model-b': {
          modelName: 'MaoMao',
          emotionExpressions: { happy: 'Happy.exp3.json' },
          actionHotkeys: { shake: 'shake-b' },
        },
      },
    });

    await expect(store.get()).resolves.toMatchObject({
      modelMappings: {
        'model-a': { emotionExpressions: { angry: 'Angry.exp3.json' } },
        'model-b': { emotionExpressions: { happy: 'Happy.exp3.json' } },
      },
    });
  });
});
