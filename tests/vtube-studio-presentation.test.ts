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

    expect(suggested.emotionExpressions).toEqual({
      happy: 'EyesLove.exp3.json',
      sad: 'EyesCry.exp3.json',
      angry: 'SignAngry.exp3.json',
      surprised: 'SignShock.exp3.json',
    });
    expect(suggested.actionHotkeys).toEqual({ nod: 'nod-hotkey' });
    expect(suggested.sources.emotionExpressions).toEqual({
      happy: 'name',
      sad: 'name',
      angry: 'name',
      surprised: 'name',
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

const expression = (
  file: string,
  parameters: ReadonlyArray<{ name: string; value: number }> = [],
  hotkeyNames: readonly string[] = [],
): VTubeStudioExpressionSummary => ({
  name: file.replace('.exp3.json', ''),
  file,
  active: false,
  deactivateWhenKeyIsLetGo: false,
  parameters: [...parameters],
  hotkeyNames: [...hotkeyNames],
});

const inventoryOf = (
  expressions: readonly VTubeStudioExpressionSummary[],
  hotkeys: readonly VTubeStudioHotkeySummary[] = [],
) => ({
  model: {
    loaded: true,
    name: 'm',
    id: 'm',
    vtsModelName: 'm',
    live2DModelName: 'm',
    parameterCount: 0,
    artmeshCount: 0,
    textureCount: 0,
    textureResolution: 0,
  },
  expressions: [...expressions],
  hotkeys: [...hotkeys],
  parameters: [],
});

const toggle = (name: string, file: string): VTubeStudioHotkeySummary => ({
  name,
  type: 'ToggleExpression',
  file,
  hotkeyId: `${file}-id`,
  onScreenButtonId: -1,
});

describe('VTube Studio mapping against the models on this machine', () => {
  // heibaiMaoMao ships twelve expressions named Param100…Param109; every one of them writes a
  // single opaque toggle (`Param103: 1`) and nothing standard, so the only thing that can be read
  // is the Chinese hotkey name VTube Studio attaches to the file.
  it('maps the bundled kitten from its hotkey names alone', () => {
    const files = [
      ['星星眼', 'Param100.exp3.json'],
      ['哭哭', 'Param101.exp3.json'],
      ['黑脸', 'Param102.exp3.json'],
      ['害羞', 'Param103.exp3.json'],
      ['白眼', 'Param104.exp3.json'],
      ['生气', 'Param105.exp3.json'],
      ['麦克风', 'Param106.exp3.json'],
      ['兽耳兽尾', 'Param107.exp3.json'],
      ['身体Z切换', 'ParamshentiZ.exp3.json'],
    ] as const;
    const suggested = suggestVTubeStudioModelMapping(
      inventoryOf(
        files.map(([name, file]) =>
          expression(file, [{ name: file.split('.')[0], value: 1 }], [name]),
        ),
        files.map(([name, file]) => toggle(name, file)),
      ),
    );

    expect(suggested.emotionExpressions).toEqual({
      happy: 'Param100.exp3.json',
      sad: 'Param101.exp3.json',
      angry: 'Param102.exp3.json',
      shy: 'Param103.exp3.json',
      playful: 'Param104.exp3.json',
    });
    // The model has nothing for "surprised", and inventing one would be worse than leaving it out.
    expect(suggested.emotionExpressions.surprised).toBeUndefined();
    // 黑脸 and 生气 both mean anger; the first decisive winner keeps the slot instead of the two
    // cancelling each other out.
    expect(Object.values(suggested.emotionExpressions)).not.toContain('Param105.exp3.json');
    // 麦克风 and 兽耳兽尾 are props, not feelings.
    expect(Object.values(suggested.emotionExpressions)).not.toContain('Param106.exp3.json');
    expect(Object.values(suggested.emotionExpressions)).not.toContain('Param107.exp3.json');
  });

  // ATRI's sixteen "expressions" are costumes and props — dress1, shoe2, Blood, Bird — plus one
  // blush. The right answer is almost entirely "nothing", and claiming otherwise would put a
  // costume change on the character's face every time it felt something.
  it('refuses to read costumes and props as emotions', () => {
    const suggested = suggestVTubeStudioModelMapping(
      inventoryOf(
        [
          expression('expression1.exp3.json', [{ name: 'ParamCheek', value: 1 }], ['blush']),
          expression('expression3.exp3.json', [{ name: 'Param18', value: 30 }], ['dress1']),
          expression('expression5.exp3.json', [{ name: 'Param19', value: 30 }], ['shoe1']),
          expression('expression9.exp3.json', [{ name: 'Param36', value: 30 }], ['Blood']),
          expression('expression10.exp3.json', [{ name: 'Param37', value: 30 }], ['Bird']),
          expression('expression13.exp3.json', [{ name: 'Param39', value: 30 }], ['YES']),
        ],
        [
          toggle('blush', 'expression1.exp3.json'),
          toggle('dress1', 'expression3.exp3.json'),
          toggle('shoe1', 'expression5.exp3.json'),
          toggle('Blood', 'expression9.exp3.json'),
          toggle('Bird', 'expression10.exp3.json'),
          toggle('YES', 'expression13.exp3.json'),
        ],
      ),
    );
    expect(suggested.emotionExpressions).toEqual({ shy: 'expression1.exp3.json' });
    // YES toggles a pose and would stay stuck on; a nod must stay with the programmatic motion.
    expect(suggested.actionHotkeys.nod).toBeUndefined();
  });

  it('reads a nameless model through its standard Cubism parameters', () => {
    const suggested = suggestVTubeStudioModelMapping(
      inventoryOf([
        expression('a.exp3.json', [
          { name: 'ParamMouthForm', value: 1 },
          { name: 'ParamEyeLSmile', value: 1 },
          { name: 'ParamEyeRSmile', value: 1 },
        ]),
        expression('b.exp3.json', [
          { name: 'ParamMouthForm', value: -0.8 },
          { name: 'ParamBrowLY', value: -0.7 },
          { name: 'ParamBrowRY', value: -0.7 },
        ]),
        expression('c.exp3.json', [
          { name: 'ParamBrowLForm', value: -1 },
          { name: 'ParamBrowRForm', value: -1 },
        ]),
        expression('d.exp3.json', [
          { name: 'ParamMouthOpenY', value: 1 },
          { name: 'ParamBrowLY', value: 0.8 },
          { name: 'ParamBrowRY', value: 0.8 },
        ]),
        expression('e.exp3.json', [{ name: 'ParamCheek', value: 1 }]),
        expression('f.exp3.json', [
          { name: 'ParamEyeLOpen', value: 0 },
          { name: 'ParamEyeROpen', value: 1 },
        ]),
        // A parameter no standard covers must contribute nothing at all.
        expression('g.exp3.json', [{ name: 'Param77', value: 1 }]),
      ]),
    );

    expect(suggested.emotionExpressions).toEqual({
      happy: 'a.exp3.json',
      sad: 'b.exp3.json',
      angry: 'c.exp3.json',
      surprised: 'd.exp3.json',
      shy: 'e.exp3.json',
      playful: 'f.exp3.json',
    });
    expect(suggested.sources.emotionExpressions.sad).toBe('parameters');
    expect(suggested.sources.emotionExpressions.angry).toBe('parameters');
  });

  it('never lets one expression file stand for two emotions', () => {
    const suggested = suggestVTubeStudioModelMapping(
      inventoryOf([
        expression('only.exp3.json', [
          { name: 'ParamCheek', value: 1 },
          { name: 'ParamMouthForm', value: 1 },
          { name: 'ParamEyeLSmile', value: 1 },
        ]),
      ]),
    );
    const files = Object.values(suggested.emotionExpressions);
    expect(new Set(files).size).toBe(files.length);
  });

  it('prefers the more specific word when two emotions share a shorter one', () => {
    // 坏笑 (a smirk) contains 笑 (a smile); the longer word is the one the author meant.
    const suggested = suggestVTubeStudioModelMapping(
      inventoryOf([expression('x.exp3.json', [], ['坏笑'])]),
    );
    expect(suggested.emotionExpressions.playful).toBe('x.exp3.json');
    expect(suggested.emotionExpressions.happy).toBeUndefined();
  });

  it('reads Japanese and Korean expression names', () => {
    const suggested = suggestVTubeStudioModelMapping(
      inventoryOf([
        expression('j1.exp3.json', [], ['嬉しい']),
        expression('j2.exp3.json', [], ['悲しい']),
        expression('j3.exp3.json', [], ['怒り']),
        expression('j4.exp3.json', [], ['びっくり']),
        expression('j5.exp3.json', [], ['照れ']),
        expression('k1.exp3.json', [], ['윙크']),
      ]),
    );
    expect(suggested.emotionExpressions).toEqual({
      happy: 'j1.exp3.json',
      sad: 'j2.exp3.json',
      angry: 'j3.exp3.json',
      surprised: 'j4.exp3.json',
      shy: 'j5.exp3.json',
      playful: 'k1.exp3.json',
    });
  });
});
