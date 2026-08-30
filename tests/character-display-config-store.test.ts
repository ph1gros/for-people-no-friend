import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CharacterDisplayConfigStore } from '../src/main/storage/character-display-config-store';

describe('character display configuration store', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('starts without an active display and persists one validated mode', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-character-display-'));
    const store = new CharacterDisplayConfigStore(directory);
    await expect(store.get()).resolves.toBeUndefined();
    await store.set('vtube-studio');
    await expect(store.get()).resolves.toBe('vtube-studio');
    const saved = JSON.parse(
      await readFile(path.join(directory, 'character-display.v1.json'), 'utf8'),
    ) as unknown;
    expect(saved).toEqual({ version: 1, mode: 'vtube-studio' });
  });
});
