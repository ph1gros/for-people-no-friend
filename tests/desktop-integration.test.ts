import { describe, expect, it } from 'vitest';

import {
  validateExtensionCapabilityManifest,
  validateShortcutBindings,
} from '../src/core/desktop/integration';
import { DesktopIntegrationService } from '../src/main/desktop/desktop-integration-service';
import {
  invokeWindowsMediaSessionMethod,
  WindowsMediaController,
} from '../src/main/desktop/windows-media-controller';
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
    expect(
      validateShortcutBindings([{ accelerator: 'Ctrl+Shift+[', action: 'toggle-visibility' }]),
    ).toHaveLength(1);
    expect(
      validateShortcutBindings([{ accelerator: '\\', action: 'toggle-visibility' }]),
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
        settings: {
          globalShortcutsEnabled: true,
          mediaControlEnabled: false,
          visibilityShortcut: '\\',
        },
      }),
    ).toEqual({
      settings: {
        globalShortcutsEnabled: true,
        mediaControlEnabled: false,
        visibilityShortcut: '\\',
      },
    });
    expect(parseMediaCommandInput({ command: 'next' })).toEqual({ command: 'next' });
    expect(() =>
      parseSetDesktopIntegrationSettingsInput({
        settings: {
          globalShortcutsEnabled: 'yes',
          mediaControlEnabled: false,
          visibilityShortcut: '\\',
        },
      }),
    ).toThrow();
    expect(() => parseMediaCommandInput({ command: 'launch-player' })).toThrow();
    expect(() =>
      parseSetDesktopIntegrationSettingsInput({
        settings: {
          globalShortcutsEnabled: true,
          mediaControlEnabled: false,
          visibilityShortcut: 'A',
        },
      }),
    ).toThrow();
  });

  it('registers the shortcut only while the deskpet window is focused', async () => {
    let settings: DesktopIntegrationSettings = {
      globalShortcutsEnabled: false,
      mediaControlEnabled: false,
      visibilityShortcut: '\\',
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
    await service.setSettings({
      globalShortcutsEnabled: true,
      mediaControlEnabled: false,
      visibilityShortcut: '\\',
    });
    expect(registrations.size).toBe(0);
    service.setShortcutWindowFocused(true);
    registrations.get('\\')?.();
    expect(toggles).toBe(1);
    expect((await service.getStatus()).shortcutRegistered).toBe(true);
    service.setShortcutWindowFocused(false);
    expect(registrations.size).toBe(0);
    service.setShortcutWindowFocused(true);
    expect(registrations.has('\\')).toBe(true);
    await service.setSettings({
      globalShortcutsEnabled: false,
      mediaControlEnabled: false,
      visibilityShortcut: '\\',
    });
    expect(unregistered).toEqual(['\\', '\\']);
    expect(registrations.size).toBe(0);
  });

  it('routes enabled media actions through the bounded controller and blocks them when disabled', async () => {
    let settings: DesktopIntegrationSettings = {
      globalShortcutsEnabled: false,
      mediaControlEnabled: false,
      visibilityShortcut: '\\',
    };
    const sent: string[] = [];
    const service = new DesktopIntegrationService(
      {
        get: async () => ({ ...settings }),
        set: async (next: DesktopIntegrationSettings) => {
          settings = { ...next };
        },
      } as unknown as DesktopIntegrationStore,
      { register: () => true, unregister: () => undefined },
      () => undefined,
      {
        getState: async () => ({ supported: true }),
        send: async (command) => {
          sent.push(command);
          return true;
        },
      },
    );

    await service.initialize();
    await expect(service.sendMediaCommand('next')).resolves.toBe(false);
    await service.setSettings({
      globalShortcutsEnabled: false,
      mediaControlEnabled: true,
      visibilityShortcut: '\\',
    });
    await expect(service.sendMediaCommand('previous')).resolves.toBe(true);
    await expect(service.sendMediaCommand('play-pause')).resolves.toBe(true);
    expect(sent).toEqual(['previous', 'play-pause']);
    await expect(service.getStatus()).resolves.toMatchObject({ media: { supported: true } });
  });

  it('maps only the three fixed media commands to the current Windows session methods', async () => {
    const invoked: string[] = [];
    const controller = new WindowsMediaController('win32', async (method) => {
      invoked.push(method);
      return true;
    });

    await expect(controller.getState()).resolves.toEqual({ supported: true });
    await expect(controller.send('next')).resolves.toBe(true);
    await expect(controller.send('previous')).resolves.toBe(true);
    await expect(controller.send('play-pause')).resolves.toBe(true);
    expect(invoked).toEqual([
      'TrySkipNextAsync',
      'TrySkipPreviousAsync',
      'TryTogglePlayPauseAsync',
    ]);
  });

  it('does not invoke Windows media control on unsupported platforms', async () => {
    let calls = 0;
    const controller = new WindowsMediaController('linux', async () => {
      calls += 1;
      return true;
    });

    await expect(controller.getState()).resolves.toEqual({ supported: false });
    await expect(controller.send('next')).resolves.toBe(false);
    expect(calls).toBe(0);
  });

  it('rejects session methods outside the fixed media allowlist before starting a process', async () => {
    await expect(invokeWindowsMediaSessionMethod('Start-Process')).resolves.toBe(false);
  });

  it('degrades a thrown global shortcut registration to an explicit failed status', async () => {
    const service = new DesktopIntegrationService(
      {
        get: async () => ({
          globalShortcutsEnabled: true,
          mediaControlEnabled: false,
          visibilityShortcut: '\\',
        }),
        set: async () => undefined,
      } as unknown as DesktopIntegrationStore,
      {
        register: () => {
          throw new Error('fake registration failure');
        },
        unregister: () => undefined,
      },
      () => undefined,
    );

    await expect(service.initialize()).resolves.toBeUndefined();
    service.setShortcutWindowFocused(true);
    await expect(service.getStatus()).resolves.toMatchObject({ shortcutRegistered: false });
  });

  it('allows only one media command in flight', async () => {
    let release: ((value: boolean) => void) | undefined;
    const pending = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const service = new DesktopIntegrationService(
      {
        get: async () => ({
          globalShortcutsEnabled: false,
          mediaControlEnabled: true,
          visibilityShortcut: '\\',
        }),
        set: async () => undefined,
      } as unknown as DesktopIntegrationStore,
      { register: () => true, unregister: () => undefined },
      () => undefined,
      {
        getState: async () => ({ supported: true }),
        send: async () => {
          calls += 1;
          return pending;
        },
      },
    );
    await service.initialize();

    const first = service.sendMediaCommand('next');
    await expect(service.sendMediaCommand('next')).resolves.toBe(false);
    expect(calls).toBe(1);
    release?.(true);
    await expect(first).resolves.toBe(true);
  });

  it('re-registers a user-selected safe shortcut without keeping the old key', async () => {
    let settings: DesktopIntegrationSettings = {
      globalShortcutsEnabled: true,
      mediaControlEnabled: false,
      visibilityShortcut: '\\',
    };
    const registrations = new Set<string>();
    const unregistered: string[] = [];
    const service = new DesktopIntegrationService(
      {
        get: async () => ({ ...settings }),
        set: async (next: DesktopIntegrationSettings) => {
          settings = { ...next };
        },
      } as unknown as DesktopIntegrationStore,
      {
        register: (accelerator) => {
          registrations.add(accelerator);
          return true;
        },
        unregister: (accelerator) => {
          registrations.delete(accelerator);
          unregistered.push(accelerator);
        },
      },
      () => undefined,
    );

    await service.initialize();
    service.setShortcutWindowFocused(true);
    await service.setSettings({
      ...settings,
      visibilityShortcut: 'Ctrl+Shift+]',
    });
    expect(unregistered).toEqual(['\\']);
    expect([...registrations]).toEqual(['Ctrl+Shift+]']);
  });
});
