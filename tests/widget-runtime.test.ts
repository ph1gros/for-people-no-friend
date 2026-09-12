import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DesktopIntegrationStore } from '../src/main/storage/desktop-integration-store';
import { DesktopIntegrationService } from '../src/main/desktop/desktop-integration-service';
import { WidgetRuntime } from '../src/main/widgets/widget-runtime';
import { manifest } from './fixtures/widget-clock';
import {
  parseDesktopIntegrationSettings,
  parseSetDesktopWidgetEnabledInput,
} from '../src/shared/desktop-integration-ipc';

describe('registered widget routing', () => {
  it('persists clock toggles through the real store and retains built-ins when the package disappears', async () => {
    await mkdir(resolve('.release'), { recursive: true });
    const root = await mkdtemp(join(resolve('.release'), 'widget-settings-'));
    try {
      const runtime = new WidgetRuntime();
      runtime.register(manifest);
      const store = new DesktopIntegrationStore(root, () => runtime.knownIds());
      const service = new DesktopIntegrationService(
        store,
        { register: () => true, unregister: () => undefined },
        () => undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        runtime,
      );
      await service.initialize();
      await service.setWidgetEnabled('clock', true);
      await service.setWidgetEnabled('media', true);
      expect((await store.get()).widgetOrder).toEqual(['clock', 'media']);
      expect((await service.getStatus()).widgets?.[0]).toMatchObject({
        enabled: true,
        available: true,
      });
      const missing = await new DesktopIntegrationStore(root).get();
      expect(missing.widgetOrder).toEqual(['media']);
      expect(missing.mediaControlEnabled).toBe(true);
      await service.setWidgetEnabled('clock', false);
      expect((await service.getStatus()).widgets?.[0].values).toEqual({});
      await expect(service.setWidgetEnabled('unknown', true)).rejects.toThrow();
      service.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('accepts only IDs registered by Main and preserves enabled widget order', () => {
    expect(
      parseSetDesktopWidgetEnabledInput({ widgetId: 'clock', enabled: true }, [
        'input',
        'media',
        'clock',
      ]),
    ).toEqual({ widgetId: 'clock', enabled: true });
    expect(() => parseSetDesktopWidgetEnabledInput({ widgetId: 'clock', enabled: true })).toThrow();
    const settings = parseDesktopIntegrationSettings(
      {
        globalShortcutsEnabled: false,
        mediaControlEnabled: true,
        inputOverlayEnabled: false,
        inputOverlayMouseEnabled: false,
        inputOverlayKeys: ['W'],
        visibilityShortcut: '\\',
        stopGenerationShortcut: 'Ctrl+Shift+Delete',
        declarativeWidgetIds: ['clock'],
        widgetOrder: ['clock', 'media'],
      },
      ['input', 'media', 'clock'],
    );
    expect(settings.widgetOrder).toEqual(['clock', 'media']);
    expect(settings.declarativeWidgetIds).toEqual(['clock']);
  });
});
