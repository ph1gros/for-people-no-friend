import { describe, expect, it } from 'vitest';

import {
  desktopWidgetRegistry,
  DesktopWidgetRegistry,
  resolveWidgetCardState,
} from '../src/renderer/widgets/widget-registry';
import { parseDesktopIntegrationSettings } from '../src/shared/desktop-integration-ipc';

describe('desktop widget code registry', () => {
  it('rejects inherited paths and oversized labels', () => {
    const definition = desktopWidgetRegistry.list()[0]!;
    for (const cardState of [
      { ...definition.cardState, enabledFrom: 'constructor' },
      { ...definition.cardState, labels: { ...definition.cardState.labels, active: '123456789' } },
    ]) {
      expect(() =>
        new DesktopWidgetRegistry().register({ ...definition, cardState } as typeof definition),
      ).toThrow();
    }
  });
  it.each([
    ['input', true, true, '运行中', true],
    ['input', true, false, '启动失败', false],
    ['input', false, true, '已关闭', false],
    ['input', false, false, '已关闭', false],
    ['media', true, true, '已开启', true],
    ['media', true, false, '不可用', false],
    ['media', false, true, '已关闭', false],
    ['media', false, false, '已关闭', false],
  ] as const)('resolves %s enabled=%s available=%s', (id, enabled, available, label, active) => {
    const settings = parseDesktopIntegrationSettings({
      globalShortcutsEnabled: false,
      mediaControlEnabled: enabled,
      inputOverlayEnabled: enabled,
      inputOverlayMouseEnabled: false,
      inputOverlayKeys: ['W'],
      visibilityShortcut: '\\',
      stopGenerationShortcut: 'Ctrl+Shift+Delete',
    });
    expect(
      resolveWidgetCardState(
        desktopWidgetRegistry.list().find((item) => item.id === id)!,
        {
          settings,
          inputOverlayActive: available,
          media: { supported: available },
          shortcutRegistered: false,
          stopGenerationShortcutRegistered: false,
        },
      ),
    ).toEqual({ enabled, active, label });
  });
  it('registers the built-in widgets as declarative code definitions', () => {
    expect(desktopWidgetRegistry.list().map((widget) => widget.id)).toEqual(['input', 'media']);
    expect(desktopWidgetRegistry.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'input',
          capability: expect.objectContaining({
            kind: 'widget',
            permissions: ['input-activity'],
          }),
        }),
        expect.objectContaining({
          id: 'media',
          capability: expect.objectContaining({
            kind: 'widget',
            permissions: ['media-control'],
          }),
        }),
      ]),
    );
  });

  it('rejects duplicate or mismatched widget declarations', () => {
    const registry = new DesktopWidgetRegistry();
    const definition = desktopWidgetRegistry.list()[0]!;
    registry.register(definition);
    expect(() => registry.register(definition)).toThrow();
    expect(() =>
      registry.register({
        ...definition,
        id: 'media',
        settingsView: 'media',
      }),
    ).toThrow();
  });
});
