export interface SpeechAudioChunk {
  audio: Uint8Array;
  mimeType: string;
  text?: string;
}

export interface SpeechInput {
  readonly mode: 'push-to-talk' | 'manual' | 'vad';
  start(signal: AbortSignal): AsyncIterable<Uint8Array>;
}

export interface SpeechRecognizer {
  transcribe(chunks: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<string>;
}

export interface SpeechOutput {
  synthesize(text: string, signal: AbortSignal): AsyncIterable<SpeechAudioChunk>;
  stop(): Promise<void>;
}

export class SpeechTurnCoordinator {
  private active?: AbortController;

  public constructor(private readonly output: SpeechOutput) {}

  public async speak(
    text: string,
    consume: (chunk: SpeechAudioChunk) => Promise<void>,
  ): Promise<boolean> {
    await this.stop();
    const controller = new AbortController();
    this.active = controller;
    try {
      for await (const chunk of this.output.synthesize(text, controller.signal)) {
        if (controller.signal.aborted) return false;
        await consume(chunk);
      }
      return true;
    } catch {
      return false;
    } finally {
      if (this.active === controller) this.active = undefined;
    }
  }

  public async stop(): Promise<void> {
    this.active?.abort();
    this.active = undefined;
    await this.output.stop().catch(() => undefined);
  }
}
