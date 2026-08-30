import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DesktopLayoutStore } from '../src/main/storage/desktop-layout-store';
import {
  DEFAULT_DESKTOP_LAYOUT_SETTINGS,
  parseDesktopLayoutSettings,
  parseSetDesktopLayoutSettingsInput,
} from '../src/shared/desktop-layout-ipc';

describe('safe desktop layout settings', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('accepts only supported non-overlapping layout slots', () => {
    expect(
      parseDesktopLayoutSettings({ characterPane: 'right', widgetAlignment: 'center' }),
    ).toEqual({ characterPane: 'right', widgetAlignment: 'center' });
    expect(
      parseSetDesktopLayoutSettingsInput({
        settings: { characterPane: 'left', widgetAlignment: 'end' },
      }),
    ).toEqual({ settings: { characterPane: 'left', widgetAlignment: 'end' } });
    expect(() =>
      parseDesktopLayoutSettings({ characterPane: 'center', widgetAlignment: 'start' }),
    ).toThrow();
    expect(() =>
      parseDesktopLayoutSettings({ characterPane: 'left', widgetAlignment: 'top' }),
    ).toThrow();
  });

  it('defaults safely and persists the selected slots', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-layout-'));
    const store = new DesktopLayoutStore(directory);
    await expect(store.get()).resolves.toEqual(DEFAULT_DESKTOP_LAYOUT_SETTINGS);
    await store.set({ characterPane: 'right', widgetAlignment: 'end' });
    await expect(new DesktopLayoutStore(directory).get()).resolves.toEqual({
      characterPane: 'right',
      widgetAlignment: 'end',
    });
  });

  it('rejects malformed persisted layout files', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-layout-invalid-'));
    await writeFile(
      path.join(directory, 'desktop-layout.v1.json'),
      JSON.stringify({ version: 1, settings: { characterPane: 'left', widgetAlignment: 'top' } }),
      'utf8',
    );
    await expect(new DesktopLayoutStore(directory).get()).rejects.toThrow();
  });
});
