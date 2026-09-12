import { expect, it } from 'vitest';
import { parseCharacterReply } from '../src/core/character/character-reply';
import { parseVTubeStudioPresentationInput } from '../src/shared/vtube-studio-ipc';
import { VTubeStudioIdleMotion } from '../src/main/vtube-studio/vtube-studio-idle-motion';
import { parseEmotionChannels } from '../src/core/character/emotion-channels';
import { emotionChannelsBias } from '../src/main/vtube-studio/vtube-studio-emotion-parameters';

it('keeps mixed fear and surprise through reply parsing and the VTS boundary', () => {
  const reply = parseCharacterReply(
    JSON.stringify({
      text: '让我缓一缓。',
      emotion: 'surprised',
      emotionChannels: { fear: 0.7, surprise: 0.3 },
    }),
  );
  const intent = parseVTubeStudioPresentationInput({
    emotion: reply.emotion,
    emotionChannels: reply.emotionChannels,
  });
  expect(intent.emotionChannels).toMatchObject({ fear: 0.7, surprise: 0.3, love: 0, trust: 0 });
});

it.each([
  { fear: NaN },
  { joy: Infinity },
  { anger: -0.1 },
  { guilt: 1.01 },
  { unknown: 1 },
  { love: '1' },
])('rejects invalid IPC intensities while preserving dialogue text: %j', (channels) => {
  expect(() => parseVTubeStudioPresentationInput({ emotionChannels: channels })).toThrow();
  const reply = parseCharacterReply(
    JSON.stringify({ text: '正文保留', emotion: 'sad', emotionChannels: channels }),
  );
  expect(reply).toEqual({ text: '正文保留', emotion: 'sad' });
});

it('keeps relationship-only input neutral and scales a weak expression without winner-take-all', () => {
  expect(emotionChannelsBias(parseEmotionChannels({ trust: 1, love: 1, longing: 1 }))).toEqual(
    emotionChannelsBias(parseEmotionChannels({})),
  );
  expect(emotionChannelsBias(parseEmotionChannels({ joy: 0.5 })).absolute.MouthSmile).toBeCloseTo(
    0.35,
  );
  const mixed = emotionChannelsBias(parseEmotionChannels({ joy: 1, sadness: 1 }));
  expect(mixed.absolute.MouthSmile).toBeCloseTo(0.05);
  expect(mixed.absolute.CheekPuff).toBe(0);
});

it('drives fear directly, preserves mid-fade continuity, and releases the face at neutral', () => {
  const motion = new VTubeStudioIdleMotion(1000, () => 0.5);
  motion.setEmotionChannels(parseEmotionChannels({ fear: 1 }), 1000);
  const before = motion.frame(1160, 'idle');
  expect(before.find((p) => p.id === 'MouthSmile')?.value).toBeLessThan(0);
  motion.setEmotionChannels(parseEmotionChannels({ joy: 1 }), 1160);
  expect(motion.frame(1160, 'idle')).toEqual(before);
  expect(motion.frame(1480, 'idle').find((p) => p.id === 'MouthSmile')?.value).toBeGreaterThan(0);
  motion.setEmotion('neutral', 1480);
  expect(motion.frame(1800, 'idle').some((p) => p.id === 'MouthSmile')).toBe(false);
});
