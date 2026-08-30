import { describe, expect, it } from 'vitest';

import {
  loadLocalModelManifest,
  ModelManifestError,
  parseLocalModelManifest,
} from '../src/renderer/live2d/model-manifest';

const validManifest = {
  version: 1,
  name: 'Hiyori',
  core: 'live2dcubismcore.min.js',
  model: 'Hiyori/Hiyori.model3.json',
  parameters: { ParamBodyVariant: 1 },
  presentation: { scale: 0.85, offsetX: 0.1, offsetY: -0.2 },
  controls: {
    states: { idle: { group: 'Idle', index: 0 } },
    actions: { wave: { group: 'TapBody', index: 1 } },
    emotions: { neutral: 'neutral', happy: 'smile' },
    emotionActions: { angry: 'wave' },
    lipSync: { mouthOpenParameter: 'ParamMouthOpenY', gain: 1 },
  },
};

describe('local Live2D model manifest', () => {
  it('accepts a versioned local Cubism model and control map', () => {
    expect(parseLocalModelManifest(validManifest)).toEqual(validManifest);
  });

  it('rejects remote, absolute and traversal paths', () => {
    expect(
      parseLocalModelManifest({ ...validManifest, core: 'https://example.com/core.js' }),
    ).toBeUndefined();
    expect(
      parseLocalModelManifest({ ...validManifest, model: '/model/model3.json' }),
    ).toBeUndefined();
    expect(
      parseLocalModelManifest({ ...validManifest, model: '../secret.model3.json' }),
    ).toBeUndefined();
    expect(
      parseLocalModelManifest({ ...validManifest, model: 'legacy/legacy.model.json' }),
    ).toBeUndefined();
  });

  it('rejects unknown state or emotion channel values', () => {
    expect(
      parseLocalModelManifest({
        ...validManifest,
        controls: { ...validManifest.controls, states: { sleeping: { group: 'Idle' } } },
      }),
    ).toBeUndefined();
    expect(
      parseLocalModelManifest({
        ...validManifest,
        controls: { ...validManifest.controls, emotions: { excited: 'smile' } },
      }),
    ).toBeUndefined();
  });

  it('rejects an emotion fallback that points at an unknown action', () => {
    expect(
      parseLocalModelManifest({
        ...validManifest,
        controls: {
          ...validManifest.controls,
          emotionActions: { angry: 'missing-action' },
        },
      }),
    ).toBeUndefined();
  });

  it('rejects non-finite persistent parameter values', () => {
    expect(
      parseLocalModelManifest({ ...validManifest, parameters: { ParamAngleX: Number.NaN } }),
    ).toBeUndefined();
  });

  it('rejects unsafe or unbounded lip-sync parameter mappings', () => {
    expect(
      parseLocalModelManifest({
        ...validManifest,
        controls: {
          ...validManifest.controls,
          lipSync: { mouthOpenParameter: '../ParamMouthOpenY', gain: 1 },
        },
      }),
    ).toBeUndefined();
    expect(
      parseLocalModelManifest({
        ...validManifest,
        controls: {
          ...validManifest.controls,
          lipSync: { mouthOpenParameter: 'ParamMouthOpenY', gain: 99 },
        },
      }),
    ).toBeUndefined();
  });

  it('rejects unsafe presentation values instead of allowing an invisible model', () => {
    expect(
      parseLocalModelManifest({
        ...validManifest,
        presentation: { scale: 0, offsetX: 0, offsetY: 0 },
      }),
    ).toBeUndefined();
    expect(
      parseLocalModelManifest({
        ...validManifest,
        presentation: { scale: 1, offsetX: 3, offsetY: 0 },
      }),
    ).toBeUndefined();
  });

  it('reports a missing manifest as a recoverable model error', async () => {
    const fetcher = async (): Promise<Response> => new Response('', { status: 404 });
    await expect(loadLocalModelManifest(fetcher as typeof fetch)).rejects.toMatchObject<
      Partial<ModelManifestError>
    >({ kind: 'missing' });
  });
});
