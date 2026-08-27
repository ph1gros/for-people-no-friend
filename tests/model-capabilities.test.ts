import { describe, expect, it } from 'vitest';

import { inspectLive2DModelCapabilities } from '../src/renderer/live2d/model-capabilities';
import type { LocalModelManifest } from '../src/renderer/live2d/model-manifest';

const manifest: LocalModelManifest = {
  version: 1,
  name: 'Test',
  core: 'core.js',
  model: 'test.model3.json',
  controls: {
    states: { idle: { group: 'Idle' }, thinking: { group: 'Missing' } },
    actions: { wave: { group: 'Wave' } },
    emotions: { happy: 'Smile', sad: 'MissingExpression' },
  },
};

describe('Live2D model capability report', () => {
  it('reports real motion and expression mappings with safe missing fallbacks', () => {
    const report = inspectLive2DModelCapabilities(manifest, {
      FileReferences: {
        Motions: { Idle: [{}], Wave: [{}], Empty: [] },
        Expressions: [{ Name: 'Smile', File: 'smile.exp3.json' }],
      },
    });
    expect(report.motionGroups).toEqual(['Idle', 'Wave']);
    expect(report.expressionIds).toEqual(['Smile']);
    expect(report.missingStateMotions).toEqual(['thinking']);
    expect(report.missingExpressions).toEqual(['sad']);
    expect(report.summary).toContain('2 项映射');
  });
});
