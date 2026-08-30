import { describe, expect, it } from 'vitest';

import type { SpeechAudioChunk } from '../src/core/speech/contracts';
import {
  prepareSpeechText,
  SpeechTextSegmenter,
  SpeechTurnPipeline,
  type SpeechAudioPlayer,
  type SpeechSynthesisClient,
} from '../src/core/speech/streaming-pipeline';

describe('streaming speech pipeline', () => {
  it('cleans display markup and emits short complete speech segments', () => {
    expect(prepareSpeechText('## 你好 **朋友** [主页](https://example.com) 😀')).toBe(
      '你好 朋友 主页',
    );
    const segmenter = new SpeechTextSegmenter(20);
    expect(segmenter.append('你好，今天怎么样？后面还')).toEqual(['你好，今天怎么样？']);
    expect(segmenter.finish()).toEqual(['后面还']);
  });

  it('holds a very short opening until the next complete sentence for natural speech', () => {
    const segmenter = new SpeechTextSegmenter(260, false, 12);
    expect(segmenter.append('嗯？')).toEqual([]);
    expect(segmenter.append('你终于舍得回来了啊。')).toEqual(['嗯？你终于舍得回来了啊。']);
  });

  it('starts synthesizing a complete first sentence before the text turn finishes', async () => {
    const synthesized: string[] = [];
    const client: SpeechSynthesisClient = {
      synthesize: async (_requestId, text) => {
        synthesized.push(text);
        return { audio: new Uint8Array([1]), mimeType: 'audio/fake', text };
      },
      cancel: async () => undefined,
    };
    const player: SpeechAudioPlayer = {
      play: async () => undefined,
      stop: () => undefined,
    };
    const pipeline = new SpeechTurnPipeline('low_latency_turn', client, player, {
      maximumSegmentLength: 260,
      minimumStreamingSegmentLength: 12,
      maximumConcurrentSynthesis: 2,
    });

    pipeline.appendText('这是已经完整生成的第一句话。第二句还在生成');
    expect(synthesized).toEqual(['这是已经完整生成的第一句话。']);
    await expect(pipeline.finish()).resolves.toBe(true);
    expect(synthesized).toEqual(['这是已经完整生成的第一句话。', '第二句还在生成']);
  });

  it('generates concurrently but always plays in text order', async () => {
    const resolvers = new Map<string, (chunk: SpeechAudioChunk) => void>();
    const played: string[] = [];
    const client: SpeechSynthesisClient = {
      synthesize: (requestId, text) =>
        new Promise((resolve) => {
          resolvers.set(requestId, resolve);
          void text;
        }),
      cancel: async () => undefined,
    };
    const player: SpeechAudioPlayer = {
      play: async (chunk) => {
        played.push(chunk.text ?? '');
      },
      stop: () => undefined,
    };
    const pipeline = new SpeechTurnPipeline('speech_turn', client, player, {
      maximumConcurrentSynthesis: 2,
    });
    pipeline.appendText('第一句。第二句。');
    const completion = pipeline.finish();
    resolvers.get('speech_turn_1')?.({
      audio: new Uint8Array([2]),
      mimeType: 'audio/fake',
      text: '第二句。',
    });
    await Promise.resolve();
    expect(played).toEqual([]);
    resolvers.get('speech_turn_0')?.({
      audio: new Uint8Array([1]),
      mimeType: 'audio/fake',
      text: '第一句。',
    });
    await expect(completion).resolves.toBe(true);
    expect(played).toEqual(['第一句。', '第二句。']);
  });

  it('buffers a normal reply into one synthesis request for continuous playback', async () => {
    const synthesized: string[] = [];
    const played: string[] = [];
    const client: SpeechSynthesisClient = {
      synthesize: async (_requestId, text) => {
        synthesized.push(text);
        return { audio: new Uint8Array([1]), mimeType: 'audio/fake', text };
      },
      cancel: async () => undefined,
    };
    const player: SpeechAudioPlayer = {
      play: async (chunk) => {
        played.push(chunk.text ?? '');
      },
      stop: () => undefined,
    };
    const pipeline = new SpeechTurnPipeline('continuous_turn', client, player, {
      maximumSegmentLength: 580,
      deferUntilFinish: true,
    });

    pipeline.appendText('こんにちは。');
    pipeline.appendText('今日はいい天気ですね。');
    expect(synthesized).toEqual([]);
    await expect(pipeline.finish()).resolves.toBe(true);
    expect(synthesized).toEqual(['こんにちは。今日はいい天気ですね。']);
    expect(played).toEqual(['こんにちは。今日はいい天気ですね。']);
  });

  it('cancels pending generation and active playback as one turn', async () => {
    const cancelled: string[] = [];
    let stopped = 0;
    const client: SpeechSynthesisClient = {
      synthesize: async (_requestId, _text, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        }),
      cancel: async (requestId) => {
        cancelled.push(requestId);
      },
    };
    const player: SpeechAudioPlayer = {
      play: async () => undefined,
      stop: () => {
        stopped += 1;
      },
    };
    const pipeline = new SpeechTurnPipeline('speech_cancel', client, player);
    pipeline.appendText('等待中的句子。');
    const completion = pipeline.finish();
    pipeline.cancel();

    await expect(completion).resolves.toBe(false);
    expect(cancelled).toEqual(['speech_cancel_0']);
    expect(stopped).toBe(1);
  });
});
