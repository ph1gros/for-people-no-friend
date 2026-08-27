import { describe, expect, it } from 'vitest';

import type { SpeechAudioChunk, SpeechOutput } from '../src/core/speech/contracts';
import { SpeechTurnCoordinator } from '../src/core/speech/contracts';

class FakeSpeechOutput implements SpeechOutput {
  public stopped = 0;

  public async *synthesize(text: string): AsyncIterable<SpeechAudioChunk> {
    yield { audio: new Uint8Array([1]), mimeType: 'audio/fake', text };
  }

  public async stop(): Promise<void> {
    this.stopped += 1;
  }
}

describe('speech contracts', () => {
  it('streams fake audio and keeps stopping safe when speech is unavailable', async () => {
    const output = new FakeSpeechOutput();
    const coordinator = new SpeechTurnCoordinator(output);
    const chunks: SpeechAudioChunk[] = [];
    await expect(
      coordinator.speak('你好', async (chunk) => {
        chunks.push(chunk);
      }),
    ).resolves.toBe(true);
    expect(chunks[0]?.text).toBe('你好');
    await expect(coordinator.stop()).resolves.toBeUndefined();
    expect(output.stopped).toBeGreaterThan(0);
  });
});
