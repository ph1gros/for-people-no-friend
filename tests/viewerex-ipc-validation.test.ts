import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIEWEREX_SETTINGS,
  parseSetViewerExSettingsInput,
  parseViewerExPresentationInput,
} from '../src/shared/viewerex-ipc';

describe('ViewerEX IPC validation', () => {
  it('keeps the optional adapter disabled and loopback-only by default', () => {
    expect(DEFAULT_VIEWEREX_SETTINGS).toEqual({
      enabled: false,
      port: 10086,
      modelIndex: 0,
      workshopItemId: '',
      bubbleEnabled: true,
      bubbleDurationMs: 6_000,
      stateMotions: {},
      emotionExpressions: {},
      actionMotions: {},
    });
  });

  it('accepts bounded model mappings and rejects path-like motions', () => {
    expect(
      parseSetViewerExSettingsInput({
        settings: {
          ...DEFAULT_VIEWEREX_SETTINGS,
          enabled: true,
          port: 10087,
          modelIndex: 1,
          workshopItemId: '2380801353',
          stateMotions: { talking: 'talk:default' },
          emotionExpressions: { happy: 2 },
          actionMotions: { wave: 'tap:motion_1' },
        },
      }),
    ).toMatchObject({
      settings: {
        enabled: true,
        port: 10087,
        workshopItemId: '2380801353',
        stateMotions: { talking: 'talk:default' },
        emotionExpressions: { happy: 2 },
        actionMotions: { wave: 'tap:motion_1' },
      },
    });

    expect(() =>
      parseSetViewerExSettingsInput({
        settings: {
          ...DEFAULT_VIEWEREX_SETTINGS,
          actionMotions: { wave: 'C:\\model\\wave.motion3.json' },
        },
      }),
    ).toThrow();
    expect(() =>
      parseSetViewerExSettingsInput({
        settings: { ...DEFAULT_VIEWEREX_SETTINGS, workshopItemId: '../2380801353' },
      }),
    ).toThrow();
  });

  it('revalidates renderer presentation intent and bounds text', () => {
    expect(
      parseViewerExPresentationInput({
        state: 'talking',
        emotion: 'happy',
        action: 'wave',
        text: '你好',
      }),
    ).toEqual({ state: 'talking', emotion: 'happy', action: 'wave', text: '你好' });
    expect(() => parseViewerExPresentationInput({ text: 'x'.repeat(32_769) })).toThrow();
    expect(() => parseViewerExPresentationInput({ action: '../wave' })).toThrow();
    expect(() => parseViewerExPresentationInput({ emotion: 'invented' })).toThrow();
  });
});
