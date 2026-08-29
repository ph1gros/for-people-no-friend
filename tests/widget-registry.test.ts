import { describe, expect, it } from 'vitest';

import {
  desktopWidgetRegistry,
  DesktopWidgetRegistry,
} from '../src/renderer/widgets/widget-registry';

describe('desktop widget code registry', () => {
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
