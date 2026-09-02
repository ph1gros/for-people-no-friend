import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VTUBE_STUDIO_SETTINGS,
  parseVTubeStudioExpressionPreviewInput,
  parseSetVTubeStudioSettingsInput,
  parseVTubeStudioPresentationInput,
} from '../src/shared/vtube-studio-ipc';

describe('VTube Studio IPC validation', () => {
  it('keeps the adapter disabled on the official local port by default', () => {
    expect(DEFAULT_VTUBE_STUDIO_SETTINGS).toEqual({
      enabled: false,
      port: 8001,
      mouseTrackingEnabled: false,
      emotionExpressions: {},
      modelMappings: {},
    });
  });

  it('accepts a bounded port and rejects renderer-controlled addresses', () => {
    expect(parseSetVTubeStudioSettingsInput({ settings: { enabled: true, port: 8123 } })).toEqual({
      settings: {
        enabled: true,
        port: 8123,
        mouseTrackingEnabled: false,
        emotionExpressions: {},
        modelMappings: {},
      },
    });
    expect(
      parseSetVTubeStudioSettingsInput({
        settings: { enabled: true, port: 8123, mouseTrackingEnabled: true },
      }),
    ).toEqual({
      settings: {
        enabled: true,
        port: 8123,
        mouseTrackingEnabled: true,
        emotionExpressions: {},
        modelMappings: {},
      },
    });
    expect(
      parseSetVTubeStudioSettingsInput({
        settings: {
          enabled: true,
          port: 8123,
          emotionExpressions: { happy: 'expression1.exp3.json' },
        },
      }),
    ).toEqual({
      settings: {
        enabled: true,
        port: 8123,
        mouseTrackingEnabled: false,
        emotionExpressions: { happy: 'expression1.exp3.json' },
        modelMappings: {},
      },
    });
    expect(
      parseSetVTubeStudioSettingsInput({
        settings: {
          enabled: true,
          port: 8123,
          modelMappings: {
            'model-a': {
              modelName: 'Akari',
              emotionExpressions: { angry: 'Angry.exp3.json' },
              actionHotkeys: { nod: 'hotkey-nod' },
            },
            'model-b': {
              modelName: 'MaoMao',
              emotionExpressions: { happy: 'Happy.exp3.json' },
              actionHotkeys: { shake: 'hotkey-shake' },
            },
          },
        },
      }),
    ).toMatchObject({
      settings: {
        modelMappings: {
          'model-a': { emotionExpressions: { angry: 'Angry.exp3.json' } },
          'model-b': { emotionExpressions: { happy: 'Happy.exp3.json' } },
        },
      },
    });
    expect(() =>
      parseSetVTubeStudioSettingsInput({
        settings: {
          enabled: true,
          port: 8123,
          emotionExpressions: { happy: '../unsafe.exp3.json' },
        },
      }),
    ).toThrow();
    expect(() =>
      parseSetVTubeStudioSettingsInput({
        settings: { enabled: true, port: 8001, host: '192.168.1.5' },
      }),
    ).toThrow();
    expect(() =>
      parseSetVTubeStudioSettingsInput({ settings: { enabled: true, port: 80 } }),
    ).toThrow();
    expect(() =>
      parseSetVTubeStudioSettingsInput({ settings: { enabled: 'yes', port: 8001 } }),
    ).toThrow();
    expect(() =>
      parseSetVTubeStudioSettingsInput({
        settings: { enabled: true, port: 8001, mouseTrackingEnabled: 'yes' },
      }),
    ).toThrow();
  });

  it('revalidates narrow character presentation intent in Main', () => {
    expect(
      parseVTubeStudioPresentationInput({
        state: 'idle',
        emotion: 'happy',
        action: 'wave',
      }),
    ).toEqual({ state: 'idle', emotion: 'happy', action: 'wave' });
    expect(() => parseVTubeStudioPresentationInput({ emotion: 'invented' })).toThrow();
    expect(() => parseVTubeStudioPresentationInput({ action: '../wave' })).toThrow();
    expect(() => parseVTubeStudioPresentationInput({ emotion: 'happy', host: 'remote' })).toThrow();
  });

  it('allows only a bounded current-inventory expression index for preview', () => {
    expect(parseVTubeStudioExpressionPreviewInput({ active: true, expressionIndex: 11 })).toEqual({
      active: true,
      expressionIndex: 11,
    });
    expect(parseVTubeStudioExpressionPreviewInput({ active: false })).toEqual({ active: false });
    expect(() =>
      parseVTubeStudioExpressionPreviewInput({ active: true, expressionIndex: -1 }),
    ).toThrow();
    expect(() =>
      parseVTubeStudioExpressionPreviewInput({ active: true, expressionIndex: 256 }),
    ).toThrow();
    expect(() =>
      parseVTubeStudioExpressionPreviewInput({
        active: true,
        expressionIndex: 0,
        expressionFile: '../unsafe.exp3.json',
      }),
    ).toThrow();
  });
});
