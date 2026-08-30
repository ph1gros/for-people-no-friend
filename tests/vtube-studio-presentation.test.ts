import { describe, expect, it } from 'vitest';

import {
  resolveAnimationHotkeyForAction,
  resolveExpressionForEmotion,
  resolveHotkeyForEmotion,
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
});
