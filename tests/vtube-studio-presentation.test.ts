import { describe, expect, it } from 'vitest';

import {
  resolveAnimationHotkeyForAction,
  resolveConfirmedModelMapping,
  resolveExpressionForEmotion,
  resolveHotkeyForEmotion,
  selectControlledActiveExpressionFiles,
  suggestVTubeStudioModelMapping,
} from '../src/main/vtube-studio/vtube-studio-presentation';
import type {
  VTubeStudioExpressionSummary,
  VTubeStudioHotkeySummary,
} from '../src/shared/vtube-studio-ipc';

const expressions: VTubeStudioExpressionSummary[] = [
  {
    name: 'EyesLove',
    file: 'EyesLove.exp3.json',
    active: false,
    deactivateWhenKeyIsLetGo: false,
    parameters: [],
    hotkeyNames: [],
  },
  {
    name: 'EyesCry',
    file: 'EyesCry.exp3.json',
    active: false,
    deactivateWhenKeyIsLetGo: false,
    parameters: [],
    hotkeyNames: [],
  },
  {
    name: 'SignAngry',
    file: 'SignAngry.exp3.json',
    active: false,
    deactivateWhenKeyIsLetGo: false,
    parameters: [],
    hotkeyNames: [],
  },
  {
    name: 'SignShock',
    file: 'SignShock.exp3.json',
    active: false,
    deactivateWhenKeyIsLetGo: false,
    parameters: [],
    hotkeyNames: [],
  },
];

describe('VTube Studio presentation mapping', () => {
  it('keeps confirmed mappings isolated by model while exposing new-model matches only as suggestions', () => {
    const suggested = suggestVTubeStudioModelMapping({
      model: {
        loaded: true,
        name: 'new-model',
        id: 'model-b',
        vtsModelName: 'new-model.vtube.json',
        live2DModelName: 'new-model.model3.json',
        parameterCount: 0,
        artmeshCount: 0,
        textureCount: 0,
        textureResolution: 0,
      },
      expressions,
      hotkeys: [
        {
          name: '点头',
          type: 'TriggerAnimation',
          file: 'Nod.motion3.json',
          hotkeyId: 'nod-hotkey',
          onScreenButtonId: 1,
        },
      ],
      parameters: [],
    });

    expect(suggested).toEqual({
      emotionExpressions: {
        happy: 'EyesLove.exp3.json',
        sad: 'EyesCry.exp3.json',
        angry: 'SignAngry.exp3.json',
        surprised: 'SignShock.exp3.json',
      },
      actionHotkeys: { nod: 'nod-hotkey' },
    });
    expect(
      resolveConfirmedModelMapping(
        {
          'model-a': {
            modelName: 'old-model',
            emotionExpressions: { happy: 'OldHappy.exp3.json' },
            actionHotkeys: { shake: 'old-shake-hotkey' },
          },
        },
        'model-b',
      ),
    ).toBeUndefined();
  });

  it('finds active confirmed expressions after reconnect so neutral can clear a stuck face', () => {
    expect(
      selectControlledActiveExpressionFiles(
        expressions.map((expression) => ({
          ...expression,
          active: expression.file === 'SignAngry.exp3.json',
        })),
        {
          modelName: 'new-model',
          emotionExpressions: { angry: 'SignAngry.exp3.json' },
          actionHotkeys: {},
        },
      ),
    ).toEqual(['SignAngry.exp3.json']);
  });

  it('uses API hotkey and parameter details while refusing a filename-only guess', () => {
    const suggested = suggestVTubeStudioModelMapping({
      model: {
        loaded: true,
        name: 'generic-model',
        id: 'generic-model-id',
        vtsModelName: 'generic.vtube.json',
        live2DModelName: 'generic.model3.json',
        parameterCount: 2,
        artmeshCount: 0,
        textureCount: 0,
        textureResolution: 0,
      },
      hotkeys: [],
      expressions: [
        {
          name: 'Param100',
          file: 'Param100.exp3.json',
          active: false,
          deactivateWhenKeyIsLetGo: false,
          hotkeyNames: ['开心切换'],
          parameters: [{ name: 'ParamEyeOpen', value: 0.8 }],
        },
        {
          name: 'Param101',
          file: 'Angry.exp3.json',
          active: false,
          deactivateWhenKeyIsLetGo: false,
          hotkeyNames: [],
          parameters: [{ name: 'ParamEyeOpen', value: 0.8 }],
        },
        {
          name: 'Param102',
          file: 'Param102.exp3.json',
          active: false,
          deactivateWhenKeyIsLetGo: false,
          hotkeyNames: [],
          parameters: [{ name: 'FaceBlush', value: 1 }],
        },
      ],
      parameters: [],
    });

    expect(suggested.emotionExpressions).toEqual({
      happy: 'Param100.exp3.json',
      shy: 'Param102.exp3.json',
    });
  });

  it('maps known emotions only to expressions exposed by the current model', () => {
    expect(resolveExpressionForEmotion(expressions, 'happy')?.file).toBe('EyesLove.exp3.json');
    expect(resolveExpressionForEmotion(expressions, 'sad')?.file).toBe('EyesCry.exp3.json');
    expect(resolveExpressionForEmotion(expressions, 'angry')?.file).toBe('SignAngry.exp3.json');
    expect(resolveExpressionForEmotion(expressions, 'surprised')?.file).toBe('SignShock.exp3.json');
    expect(resolveExpressionForEmotion(expressions, 'neutral')).toBeUndefined();
    expect(resolveExpressionForEmotion(expressions, 'shy')).toBeUndefined();
  });

  it('matches generic expression files through detailed parameter and hotkey names', () => {
    const generic: VTubeStudioExpressionSummary[] = [
      {
        name: 'Param103',
        file: 'Param103.exp3.json',
        active: false,
        deactivateWhenKeyIsLetGo: false,
        parameters: [{ name: '害羞', value: 1 }],
        hotkeyNames: [],
      },
    ];
    expect(resolveExpressionForEmotion(generic, 'shy')?.file).toBe('Param103.exp3.json');
  });

  it('matches requested actions only to animation hotkeys', () => {
    const hotkeys: VTubeStudioHotkeySummary[] = [
      {
        name: 'Wave',
        type: 'TriggerAnimation',
        file: 'Wave.motion3.json',
        hotkeyId: 'wave-id',
        onScreenButtonId: 1,
      },
      {
        name: 'Wave expression',
        type: 'ToggleExpression',
        file: 'Wave.exp3.json',
        hotkeyId: 'unsafe-match',
        onScreenButtonId: 2,
      },
    ];
    expect(resolveAnimationHotkeyForAction(hotkeys, 'wave')?.hotkeyId).toBe('wave-id');
    expect(resolveAnimationHotkeyForAction(hotkeys, 'dance')).toBeUndefined();
  });

  it('uses semantic Chinese VTube Studio hotkey names without allowing unrelated switches', () => {
    const hotkeys: VTubeStudioHotkeySummary[] = [
      {
        name: '星星眼',
        type: 'ToggleExpression',
        file: 'Param100.exp3.json',
        hotkeyId: 'star-eyes',
        onScreenButtonId: 1,
      },
      {
        name: '流泪动画',
        type: 'TriggerAnimation',
        file: 'Cry.motion3.json',
        hotkeyId: 'cry-animation',
        onScreenButtonId: 2,
      },
      {
        name: '身体Z切换',
        type: 'ToggleExpression',
        file: 'ParamshentiZ.exp3.json',
        hotkeyId: 'body-switch',
        onScreenButtonId: 3,
      },
    ];

    expect(resolveHotkeyForEmotion(hotkeys, 'happy')?.hotkeyId).toBe('star-eyes');
    expect(resolveHotkeyForEmotion(hotkeys, 'sad')?.hotkeyId).toBe('cry-animation');
    expect(resolveHotkeyForEmotion(hotkeys, 'surprised')).toBeUndefined();
    expect(resolveHotkeyForEmotion(hotkeys, 'neutral')).toBeUndefined();
  });

  it('recognizes the bundled kitten model emotion hotkeys', () => {
    const hotkeys: VTubeStudioHotkeySummary[] = [
      ['星星眼', 'Param105.exp3.json', 'happy'],
      ['哭哭', 'Param101.exp3.json', 'sad'],
      ['黑脸', 'Param102.exp3.json', 'angry'],
      ['害羞', 'Param103.exp3.json', 'shy'],
      ['白眼', 'Param104.exp3.json', 'playful'],
    ].map(([name, file, hotkeyId]) => ({
      name,
      file,
      hotkeyId,
      type: 'ToggleExpression',
      onScreenButtonId: -1,
    }));

    expect(resolveHotkeyForEmotion(hotkeys, 'happy')?.file).toBe('Param105.exp3.json');
    expect(resolveHotkeyForEmotion(hotkeys, 'sad')?.file).toBe('Param101.exp3.json');
    expect(resolveHotkeyForEmotion(hotkeys, 'angry')?.file).toBe('Param102.exp3.json');
    expect(resolveHotkeyForEmotion(hotkeys, 'shy')?.file).toBe('Param103.exp3.json');
    expect(resolveHotkeyForEmotion(hotkeys, 'playful')?.file).toBe('Param104.exp3.json');
  });
});
