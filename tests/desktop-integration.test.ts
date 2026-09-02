import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  resolveSupportedMediaPlayer,
  validateExtensionCapabilityManifest,
  validateShortcutBindings,
} from '../src/core/desktop/integration';
import { DesktopIntegrationService } from '../src/main/desktop/desktop-integration-service';
import {
  buildWindowsMediaControlScript,
  buildWindowsMediaStateScript,
  invokeWindowsMediaSessionMethod,
  parseWindowsMediaStateOutput,
  WindowsMediaController,
} from '../src/main/desktop/windows-media-controller';
import type { DesktopIntegrationStore } from '../src/main/storage/desktop-integration-store';
import {
  parseDesktopInputActivityEvent,
  parseInputOverlayKeys,
  parseMediaCommandInput,
  parseSetDesktopIntegrationSettingsInput,
  parseSetDesktopWidgetEnabledInput,
  tokenizeInputOverlayKeyDraft,
  type DesktopIntegrationSettings,
} from '../src/shared/desktop-integration-ipc';

const desktopSettings = (
  overrides: Partial<DesktopIntegrationSettings> = {},
): DesktopIntegrationSettings => ({
  globalShortcutsEnabled: false,
  mediaControlEnabled: false,
  inputOverlayEnabled: false,
  inputOverlayMouseEnabled: true,
  inputOverlayKeys: ['W', 'A', 'S', 'D'],
  widgetOrder: [],
  visibilityShortcut: '\\',
  stopGenerationShortcut: 'Ctrl+Shift+Delete',
  ...overrides,
});

describe('desktop integration boundaries', () => {
  it('wires the fixed stop-generation action to the conversation runtime in Main', () => {
    const source = readFileSync(resolve('src/main/index.ts'), 'utf8');
    expect(source).toContain('() => conversationRuntime?.cancelAll()');
  });

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
          inputOverlayEnabled: true,
          inputOverlayMouseEnabled: true,
          inputOverlayKeys: ['w', 'A', 'w'],
          visibilityShortcut: '\\',
          stopGenerationShortcut: 'Ctrl+Shift+Delete',
        },
      }),
    ).toEqual({
      settings: {
        globalShortcutsEnabled: true,
        mediaControlEnabled: false,
        inputOverlayEnabled: true,
        inputOverlayMouseEnabled: true,
        inputOverlayKeys: ['W', 'A'],
        widgetOrder: ['input'],
        visibilityShortcut: '\\',
        stopGenerationShortcut: 'Ctrl+Shift+Delete',
      },
    });
    expect(parseMediaCommandInput({ command: 'next' })).toEqual({ command: 'next' });
    expect(parseSetDesktopWidgetEnabledInput({ widgetId: 'media', enabled: true })).toEqual({
      widgetId: 'media',
      enabled: true,
    });
    expect(parseInputOverlayKeys(['w', 'ArrowUp', 'w'])).toEqual(['W', 'ArrowUp']);
    expect(tokenizeInputOverlayKeyDraft('W A、S；D, Q')).toEqual(['W', 'A', 'S', 'D', 'Q']);
    expect(parseInputOverlayKeys(['esc', '[', 'comma'])).toEqual([
      'Escape',
      'BracketLeft',
      'Comma',
    ]);
    expect(
      parseDesktopInputActivityEvent({ type: 'mouse-direction', direction: 'up-left' }),
    ).toEqual({ type: 'mouse-direction', direction: 'up-left' });
    expect(() => parseInputOverlayKeys(['Password'])).toThrow();
    expect(() => parseInputOverlayKeys([])).toThrow();
    expect(() =>
      parseDesktopInputActivityEvent({ type: 'mouse-direction', direction: 'up', x: 1, y: 2 }),
    ).toThrow();
    expect(() =>
      parseSetDesktopIntegrationSettingsInput({
        settings: {
          globalShortcutsEnabled: 'yes',
          mediaControlEnabled: false,
          visibilityShortcut: '\\',
          stopGenerationShortcut: 'Ctrl+Shift+Delete',
        },
      }),
    ).toThrow();
    expect(() =>
      parseSetDesktopIntegrationSettingsInput({
        settings: {
          globalShortcutsEnabled: true,
          mediaControlEnabled: false,
          visibilityShortcut: 'Ctrl+Shift+Delete',
          stopGenerationShortcut: 'Ctrl+Shift+Delete',
        },
      }),
    ).toThrow();
    expect(() => parseMediaCommandInput({ command: 'launch-player' })).toThrow();
    expect(() =>
      parseSetDesktopWidgetEnabledInput({ widgetId: 'media', enabled: true, command: 'launch' }),
    ).toThrow();
    expect(() =>
      parseSetDesktopIntegrationSettingsInput({
        settings: {
          ...desktopSettings({ inputOverlayEnabled: true, mediaControlEnabled: true }),
          widgetOrder: ['media', 'media'],
        },
      }),
    ).toThrow();
    expect(() =>
      parseSetDesktopIntegrationSettingsInput({
        settings: {
          globalShortcutsEnabled: true,
          mediaControlEnabled: false,
          visibilityShortcut: 'A',
          stopGenerationShortcut: 'Ctrl+Shift+Delete',
        },
      }),
    ).toThrow();
  });

  it('registers the shortcut only while the deskpet window is focused', async () => {
    let settings = desktopSettings();
    const store = {
      get: async () => ({ ...settings }),
      set: async (next: DesktopIntegrationSettings) => {
        settings = { ...next };
      },
    } as unknown as DesktopIntegrationStore;
    const registrations = new Map<string, () => void>();
    const unregistered: string[] = [];
    let toggles = 0;
    let stops = 0;
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
      undefined,
      () => {
        stops += 1;
      },
    );

    await service.initialize();
    expect(registrations.size).toBe(0);
    await service.setSettings(desktopSettings({ globalShortcutsEnabled: true }));
    expect(registrations.size).toBe(0);
    service.setShortcutWindowFocused(true);
    registrations.get('\\')?.();
    registrations.get('Ctrl+Shift+Delete')?.();
    expect(toggles).toBe(1);
    expect(stops).toBe(1);
    expect(await service.getStatus()).toMatchObject({
      shortcutRegistered: true,
      stopGenerationShortcutRegistered: true,
    });
    service.setShortcutWindowFocused(false);
    expect(registrations.size).toBe(0);
    service.setShortcutWindowFocused(true);
    expect(registrations.has('\\')).toBe(true);
    expect(registrations.has('Ctrl+Shift+Delete')).toBe(true);
    await service.setSettings(desktopSettings());
    expect(unregistered).toEqual(['\\', 'Ctrl+Shift+Delete', '\\', 'Ctrl+Shift+Delete']);
    expect(registrations.size).toBe(0);
  });

  it('starts the optional input monitor only when enabled and forwards its bounded events', async () => {
    let settings = desktopSettings();
    let starts = 0;
    let stops = 0;
    const forwarded: unknown[] = [];
    const service = new DesktopIntegrationService(
      {
        get: async () => ({ ...settings }),
        set: async (next: DesktopIntegrationSettings) => {
          settings = { ...next };
        },
      } as unknown as DesktopIntegrationStore,
      { register: () => true, unregister: () => undefined },
      () => undefined,
      undefined,
      undefined,
      {
        start: async (monitorSettings, emit) => {
          starts += 1;
          expect(monitorSettings).toMatchObject({
            inputOverlayKeys: ['W', 'A', 'S', 'D'],
            inputOverlayMouseEnabled: true,
          });
          emit({ type: 'key', key: 'W', pressed: true });
          return true;
        },
        stop: () => {
          stops += 1;
        },
      },
      (event) => forwarded.push(event),
    );

    await service.initialize();
    expect(starts).toBe(0);
    await expect(service.getStatus()).resolves.toMatchObject({ inputOverlayActive: false });

    await service.setSettings(desktopSettings({ inputOverlayEnabled: true }));
    expect(starts).toBe(1);
    expect(forwarded).toEqual([{ type: 'key', key: 'W', pressed: true }]);
    await expect(service.getStatus()).resolves.toMatchObject({ inputOverlayActive: true });

    service.dispose();
    expect(stops).toBe(3);
  });

  it('keeps the native key monitor bounded to the selected push-to-talk key without enabling the input widget', async () => {
    const starts: Array<{ inputOverlayKeys: string[]; inputOverlayMouseEnabled: boolean }> = [];
    const forwarded: unknown[] = [];
    const service = new DesktopIntegrationService(
      {
        get: async () => desktopSettings(),
        set: async () => undefined,
      } as unknown as DesktopIntegrationStore,
      { register: () => true, unregister: () => undefined },
      () => undefined,
      undefined,
      undefined,
      {
        start: async (settings, emit) => {
          starts.push({
            inputOverlayKeys: [...settings.inputOverlayKeys],
            inputOverlayMouseEnabled: settings.inputOverlayMouseEnabled,
          });
          emit({ type: 'key', key: 'F8', pressed: true });
          return true;
        },
        stop: () => undefined,
      },
      (event) => forwarded.push(event),
    );

    await service.initialize();
    await service.setPushToTalkKey('F8');
    expect(starts).toEqual([
      {
        inputOverlayKeys: ['W', 'A', 'S', 'D', 'F8'],
        inputOverlayMouseEnabled: false,
      },
    ]);
    expect(forwarded).toEqual([{ type: 'key', key: 'F8', pressed: true }]);
    await expect(service.getStatus()).resolves.toMatchObject({ inputOverlayActive: false });
  });

  it('routes enabled media actions through the bounded controller and blocks them when disabled', async () => {
    let settings = desktopSettings();
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
    await service.setSettings(desktopSettings({ mediaControlEnabled: true }));
    await expect(service.sendMediaCommand('previous')).resolves.toBe(true);
    await expect(service.sendMediaCommand('play-pause')).resolves.toBe(true);
    expect(sent).toEqual(['previous', 'play-pause']);
    await expect(service.getStatus()).resolves.toMatchObject({ media: { supported: true } });
  });

  it('routes only fixed declarative actions', async () => {
    let visibilityToggles = 0;
    let generationStops = 0;
    const service = new DesktopIntegrationService(
      {
        get: async () => desktopSettings(),
        set: async () => undefined,
      } as unknown as DesktopIntegrationStore,
      { register: () => true, unregister: () => undefined },
      () => {
        visibilityToggles += 1;
      },
      undefined,
      () => {
        generationStops += 1;
      },
    );
    await service.initialize();

    await expect(service.triggerAction('toggle-visibility')).resolves.toBe(true);
    await expect(service.triggerAction('stop-generation')).resolves.toBe(true);
    await expect(service.triggerAction('shell-execute' as never)).resolves.toBe(false);
    expect(visibilityToggles).toBe(1);
    expect(generationStops).toBe(1);
  });

  it('enables registered widgets through fixed Main settings routes and preserves order', async () => {
    let settings = desktopSettings();
    const service = new DesktopIntegrationService(
      {
        get: async () => settings,
        set: async (next: DesktopIntegrationSettings) => {
          settings = { ...next, widgetOrder: [...next.widgetOrder] };
        },
      } as unknown as DesktopIntegrationStore,
      { register: () => true, unregister: () => undefined },
      () => undefined,
    );
    await service.initialize();

    await service.setWidgetEnabled('media', true);
    expect(settings).toMatchObject({ mediaControlEnabled: true, widgetOrder: ['media'] });
    await service.setWidgetEnabled('input', true);
    expect(settings).toMatchObject({
      mediaControlEnabled: true,
      inputOverlayEnabled: true,
      widgetOrder: ['media', 'input'],
    });
    await service.setWidgetEnabled('media', false);
    expect(settings).toMatchObject({ mediaControlEnabled: false, widgetOrder: ['input'] });
  });

  it('maps only the three fixed media commands to the current Windows session methods', async () => {
    const invoked: string[] = [];
    const controller = new WindowsMediaController(
      'win32',
      async (method) => {
        invoked.push(method);
        return true;
      },
      async () => ({ supported: true }),
    );

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

  it('reads bounded current-track metadata from the Windows media session', async () => {
    const controller = new WindowsMediaController(
      'win32',
      async () => true,
      async () => ({
        supported: true,
        playing: true,
        title: 'Test Track',
        artist: 'Fake Artist',
        source: 'fake.player',
      }),
    );

    await expect(controller.getState()).resolves.toEqual({
      supported: true,
      playing: true,
      title: 'Test Track',
      artist: 'Fake Artist',
      source: 'fake.player',
    });
    expect(
      parseWindowsMediaStateOutput(
        JSON.stringify({
          supported: true,
          sessions: [
            {
              current: true,
              playing: false,
              title: `  Track\u0000${'x'.repeat(400)}  `,
              artist: '  Fake\nArtist  ',
              source: 'cloudmusic.exe',
            },
          ],
        }),
      ),
    ).toEqual({
      supported: true,
      sessionAvailable: true,
      playerId: 'netease-cloud-music',
      playerName: '网易云音乐',
      playing: false,
      title: `Track ${'x'.repeat(294)}`,
      artist: 'Fake Artist',
      source: 'cloudmusic.exe',
    });
    expect(
      parseWindowsMediaStateOutput(
        JSON.stringify({
          supported: true,
          sessions: [
            {
              current: true,
              playing: true,
              title: '栀子花般的她',
              artist: '中文歌手',
              source: 'QQMusic.exe',
            },
          ],
        }),
      ),
    ).toMatchObject({
      playerId: 'qq-music',
      title: '栀子花般的她',
      artist: '中文歌手',
    });
    expect(
      parseWindowsMediaStateOutput(
        JSON.stringify({
          supported: true,
          sessions: [
            {
              current: true,
              playing: true,
              title: 'Browser Video',
              artist: '',
              source: 'chrome.exe',
            },
          ],
        }),
      ),
    ).toEqual({
      supported: true,
      sessionAvailable: true,
      playing: true,
      title: 'Browser Video',
      source: 'chrome.exe',
    });
    expect(
      parseWindowsMediaStateOutput(
        JSON.stringify({
          supported: true,
          sessions: [
            {
              current: true,
              playing: true,
              title: '新版网易云歌曲',
              artist: '测试歌手',
              source: 'com.ncm.desktop',
            },
          ],
        }),
      ),
    ).toMatchObject({
      sessionAvailable: true,
      playing: true,
      title: '新版网易云歌曲',
      artist: '测试歌手',
      source: 'com.ncm.desktop',
    });
    expect(resolveSupportedMediaPlayer('SpotifyAB.SpotifyMusic!Spotify')?.name).toBe('Spotify');
    expect(resolveSupportedMediaPlayer('AppleInc.AppleMusic.exe')?.name).toBe('Apple Music');
    expect(() => parseWindowsMediaStateOutput('{"supported":"yes"}')).toThrow();
  });

  it('queries only the Windows media-session read APIs without launching arbitrary programs', () => {
    const script = buildWindowsMediaStateScript();
    expect(script).toContain('GlobalSystemMediaTransportControlsSessionManager');
    expect(script).toContain('TryGetMediaPropertiesAsync');
    expect(script).toContain('GetPlaybackInfo');
    expect(script).toContain('Select-Object -First 16');
    expect(script).toContain('ConvertTo-Json -Compress');
    expect(script).toContain('[Console]::OutputEncoding = $utf8Output');
    expect(script).toContain('$OutputEncoding = $utf8Output');
    expect(script).not.toContain('Start-Process');
  });

  it('enumerates Windows media sessions and uses only fixed media-key fallbacks', () => {
    const playPause = buildWindowsMediaControlScript('TryTogglePlayPauseAsync');
    const previous = buildWindowsMediaControlScript('TrySkipPreviousAsync');
    const next = buildWindowsMediaControlScript('TrySkipNextAsync');

    expect(playPause).toContain('$manager.GetSessions()');
    expect(playPause).toContain('$current = $manager.GetCurrentSession()');
    expect(playPause).not.toContain('$supportedSourcePattern');
    expect(playPause).toContain('TryTogglePlayPauseAsync');
    expect(playPause).toContain('keybd_event(0xB3');
    expect(previous).toContain('keybd_event(0xB1');
    expect(next).toContain('keybd_event(0xB0');
    expect(playPause).not.toContain('Start-Process');
  });

  it('keeps a current NetEase session visible when other media sessions make the response large', () => {
    const sessions = Array.from({ length: 16 }, (_value, index) => ({
      current: index === 15,
      playing: index === 15,
      title: index === 15 ? '当前网易云歌曲' : `后台媒体 ${index} ${'曲'.repeat(300)}`,
      artist: `测试歌手 ${'手'.repeat(300)}`,
      source: index === 15 ? 'cloudmusic.exe' : `browser-${index}-${'x'.repeat(250)}.exe`,
    }));

    expect(
      parseWindowsMediaStateOutput(JSON.stringify({ supported: true, sessions })),
    ).toMatchObject({
      playerId: 'netease-cloud-music',
      playing: true,
      title: '当前网易云歌曲',
    });
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
        get: async () => desktopSettings({ globalShortcutsEnabled: true }),
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
        get: async () => desktopSettings({ mediaControlEnabled: true }),
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
    let settings = desktopSettings({ globalShortcutsEnabled: true });
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
      stopGenerationShortcut: 'Ctrl+Shift+Delete',
    });
    expect(unregistered).toEqual(['\\', 'Ctrl+Shift+Delete']);
    expect([...registrations]).toEqual(['Ctrl+Shift+]', 'Ctrl+Shift+Delete']);
  });
});
