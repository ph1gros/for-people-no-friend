import { describe, expect, it } from 'vitest';

import {
  validateExtensionCapabilityManifest,
  validateShortcutBindings,
} from '../src/core/desktop/integration';
import { DesktopIntegrationService } from '../src/main/desktop/desktop-integration-service';
import type { DesktopIntegrationStore } from '../src/main/storage/desktop-integration-store';
import {
  parseMediaCommandInput,
  parseSetDesktopIntegrationSettingsInput,
  type DesktopIntegrationSettings,
} from '../src/shared/desktop-integration-ipc';

describe('desktop integration boundaries', () => {
  it('accepts explicit shortcut combinations but rejects ordinary key capture', () => {
    expect(
      validateShortcutBindings([{ accelerator: 'Ctrl+Shift+Space', action: 'toggle-visibility' }]),
    ).toHaveLength(1);
    expect(() =>
      validateShortcutBindings([{ accelerator: 'A', action: 'toggle-visibility' }]),
    ).toThrow();
  });

  it('validates declarative extension capabilities without executable entrypoints', () => {
    expect(
      validateExtensionCapabilityManifest({
        version: 1,
        id: 'media-windows',
        kind: 'media',
        permissions: ['media-control'],
        timeoutMs: 2_000,
      }),
    ).toEqual({
      version: 1,
      id: 'media-windows',
      kind: 'media',
      permissions: ['media-control'],
      timeoutMs: 2_000,
    });
    expect(() =>
      validateExtensionCapabilityManifest({
        version: 1,
        id: 'bad',
        kind: 'shell',
        permissions: ['execute'],
        timeoutMs: 2_000,
      }),
    ).toThrow();
  });

  it('validates narrow desktop IPC inputs', () => {
    expect(
      parseSetDesktopIntegrationSettingsInput({
        settings: { globalShortcutsEnabled: true, mediaControlEnabled: false },
      }),
    ).toEqual({ settings: { globalShortcutsEnabled: true, mediaControlEnabled: false } });
    expect(parseMediaCommandInput({ command: 'next' })).toEqual({ command: 'next' });
    expect(() => parseMediaCommandInput({ command: 'launch-player' })).toThrow();
  });

  it('keeps the exact global shortcut opt-in and unregisters it on disable', async () => {
    let settings: DesktopIntegrationSettings = {
      globalShortcutsEnabled: false,
      mediaControlEnabled: false,
    };
    const store = {
      get: async () => ({ ...settings }),
      set: async (next: DesktopIntegrationSettings) => {
        settings = { ...next };
      },
    } as unknown as DesktopIntegrationStore;
    const registrations = new Map<string, () => void>();
    const unregistered: string[] = [];
    let toggles = 0;
    const service = new DesktopIntegrationService(
      store,
      {
        register: (accelerator, callback) => {
          registrations.set(accelerator, callback);
          return true;
        },
        unregister: (accelerator) => {
          registrations.delete(accelerator);
          unregistered.push(accelerator);
        },
      },
      () => {
        toggles += 1;
      },
    );

    await service.initialize();
    expect(registrations.size).toBe(0);
    await service.setSettings({ globalShortcutsEnabled: true, mediaControlEnabled: false });
    registrations.get('CommandOrControl+Shift+Space')?.();
    expect(toggles).toBe(1);
    expect((await service.getStatus()).shortcutRegistered).toBe(true);
    await service.setSettings({ globalShortcutsEnabled: false, mediaControlEnabled: false });
    expect(unregistered).toEqual(['CommandOrControl+Shift+Space']);
    expect(registrations.size).toBe(0);
  });
});
