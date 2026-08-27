import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseLocalModelManifest } from '../src/renderer/live2d/model-manifest';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelsRoot = resolve(repositoryRoot, 'assets/models');
const exampleManifestPath = resolve(modelsRoot, 'kaltsit-work.example.json');
const modelRoot = resolve(modelsRoot, 'local/kaltsit-work');

describe('authorized Kaltsit Live2D example', () => {
  it('provides a safe activation manifest whose model exists', () => {
    const manifest = parseLocalModelManifest(
      JSON.parse(readFileSync(exampleManifestPath, 'utf8')) as unknown,
    );

    expect(manifest).toBeDefined();
    expect(manifest?.name).toContain('凯尔希');
    expect(existsSync(resolve(modelsRoot, 'local', manifest?.model ?? ''))).toBe(true);
  });

  it('keeps every runtime reference complete without bundling Core or editor sources', () => {
    const model = JSON.parse(
      readFileSync(resolve(modelRoot, '凯尔希直播版1.model3.json'), 'utf8'),
    ) as {
      FileReferences: {
        Moc: string;
        Textures: string[];
        Physics?: string;
        DisplayInfo?: string;
        Motions?: Record<string, { File: string }[]>;
      };
    };
    const references = [
      model.FileReferences.Moc,
      ...model.FileReferences.Textures,
      model.FileReferences.Physics,
      model.FileReferences.DisplayInfo,
      ...Object.values(model.FileReferences.Motions ?? {}).flatMap((motions) =>
        motions.map((motion) => motion.File),
      ),
    ].filter((path): path is string => Boolean(path));

    expect(references.every((path) => existsSync(resolve(modelRoot, path)))).toBe(true);
    expect(existsSync(resolve(modelRoot, 'live2dcubismcore.min.js'))).toBe(false);
    expect(existsSync(resolve(modelRoot, '凯尔希直播版1.cmo3'))).toBe(false);
  });

  it('records the author, source and noncommercial boundary next to the model', () => {
    const attribution = readFileSync(resolve(modelRoot, 'ATTRIBUTION.md'), 'utf8');

    expect(attribution).toContain('什行在要');
    expect(attribution).toContain('BV1Le411976u');
    expect(attribution).toContain('不得用于盈利');
  });
});
