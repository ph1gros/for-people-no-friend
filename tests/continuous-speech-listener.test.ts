import { describe, expect, it } from 'vitest';

import {
  encodeMonoPcmWav,
  resampleMonoPcm,
  VoiceActivitySegmenter,
} from '../src/renderer/speech/continuous-listener';
import {
  combineFullListeningCommands,
  PendingVoiceCommandQueue,
  resolvePreciseWakeWord,
  shouldCombineFullListeningCommands,
  WakeWordCommandSession,
} from '../src/renderer/speech/wake-word-command';

describe('continuous speech listening', () => {
  it('segments one bounded utterance after trailing silence', () => {
    const segmenter = new VoiceActivitySegmenter({
      threshold: 0.01,
      preRollMs: 20,
      minimumVoiceMs: 20,
      silenceMs: 40,
      maximumUtteranceMs: 1_000,
    });
    const quiet = new Float32Array(20);
    const voice = new Float32Array(20).fill(0.2);
    expect(segmenter.push(quiet, 1_000)).toBeUndefined();
    expect(segmenter.push(voice, 1_000)).toBeUndefined();
    expect(segmenter.push(quiet, 1_000)).toBeUndefined();
    expect(segmenter.push(quiet, 1_000)?.length).toBeGreaterThanOrEqual(60);
    expect(segmenter.hearing).toBe(false);
  });

  it('creates bounded 16 kHz mono WAV data without a device', () => {
    const resampled = resampleMonoPcm(new Float32Array(48_000).fill(0.1), 48_000, 16_000);
    expect(resampled).toHaveLength(16_000);
    const wav = encodeMonoPcmWav(resampled, 16_000);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(wav.byteLength).toBe(44 + 16_000 * 2);
  });

  it('sends every complete full-listening utterance without a wake word', () => {
    const session = new WakeWordCommandSession();
    session.setMode('full');
    expect(session.handle('今天天气怎么样')).toMatchObject({
      kind: 'send',
      text: '今天天气怎么样',
    });
  });

  it('combines full-listening follow-ups when the spoken pause is at most two seconds', () => {
    expect(shouldCombineFullListeningCommands(1_000, 2_999)).toBe(true);
    expect(shouldCombineFullListeningCommands(1_000, 3_000)).toBe(true);
    expect(shouldCombineFullListeningCommands(1_000, 3_001)).toBe(false);
    expect(shouldCombineFullListeningCommands(3_000, 2_999)).toBe(false);
    expect(combineFullListeningCommands('帮我看看这个文件', '再总结重点')).toBe(
      '帮我看看这个文件。再总结重点',
    );
    expect(combineFullListeningCommands('先看这个！', '还有旁边那个')).toBe(
      '先看这个！还有旁边那个',
    );
  });

  it('bounds delayed full-listening commands', () => {
    const queue = new PendingVoiceCommandQueue(2);
    expect(queue.enqueue('第一句')).toBe(true);
    expect(queue.enqueue('第二句')).toBe(true);
    expect(queue.enqueue('第三句')).toBe(false);
    expect(queue.shift()).toBe('第一句');
    expect(queue.size).toBe(1);
    queue.clear();
    expect(queue.size).toBe(0);
  });

  it('requires one wake word in a precise-listening command', () => {
    const session = new WakeWordCommandSession();
    session.setMode('half');
    expect(session.handle('帮我看看这个文件')).toEqual({ kind: 'ignored' });
    expect(session.handle('芙莉莲，帮我看看这个文件', '芙莉莲')).toMatchObject({
      kind: 'send',
      text: '帮我看看这个文件',
      message: '听到“芙莉莲”，正在发送。',
    });
    expect(session.handle('小猫，帮我看看这个文件', '芙莉莲')).toEqual({ kind: 'ignored' });
  });

  it('follows the active character name unless a custom precise name is selected', () => {
    expect(resolvePreciseWakeWord('character-name', '', '芙莉莲')).toBe('芙莉莲');
    expect(resolvePreciseWakeWord('custom', '阿响', '芙莉莲')).toBe('阿响');
    expect(resolvePreciseWakeWord('character-name', '', '  ')).toBe('桌宠');
  });
});
