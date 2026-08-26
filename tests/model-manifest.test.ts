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
  controls: {
    states: { idle: { group: 'Idle', index: 0 } },
    actions: { wave: { group: 'TapBody', index: 1 } },
    emotions: { neutral: 'neutral', happy: 'smile' },
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

  it('rejects non-finite persistent parameter values', () => {
    expect(
      parseLocalModelManifest({ ...validManifest, parameters: { ParamAngleX: Number.NaN } }),
    ).toBeUndefined();
  });

  it('reports a missing manifest as a recoverable model error', async () => {
    const fetcher = async (): Promise<Response> => new Response('', { status: 404 });
    await expect(loadLocalModelManifest(fetcher as typeof fetch)).rejects.toMatchObject<
      Partial<ModelManifestError>
    >({ kind: 'missing' });
  });
});
