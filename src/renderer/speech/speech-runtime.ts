import type { SpeechAudioChunk } from '../../core/speech/contracts';
import type {
  SpeechAudioPlayer,
  SpeechSynthesisClient,
} from '../../core/speech/streaming-pipeline';
import type { DeskpetApi } from '../../shared/ipc';

export class IpcSpeechSynthesisClient implements SpeechSynthesisClient {
  public constructor(private readonly api: DeskpetApi) {}

  public async synthesize(
    requestId: string,
    text: string,
    signal: AbortSignal,
  ): Promise<SpeechAudioChunk> {
    if (signal.aborted) throw signal.reason;
    const abort = (): void => void this.api.cancelSpeech({ requestId });
    signal.addEventListener('abort', abort, { once: true });
    try {
      const result = await this.api.synthesizeSpeech({ requestId, text });
      if (!result.ok) throw new Error(result.message);
      return { audio: result.audio, mimeType: result.mimeType, text: result.text };
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }

  public async cancel(requestId: string): Promise<void> {
    await this.api.cancelSpeech({ requestId }).catch(() => false);
  }
}

export class WebAudioSpeechPlayer implements SpeechAudioPlayer {
  private context?: AudioContext;
  private activeSource?: AudioBufferSourceNode;
  private activeGain?: GainNode;
  private animationFrame?: number;
  private volume = 0.6;

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.6));
    if (this.activeGain) this.activeGain.gain.value = this.volume;
  }

  public async play(
    chunk: SpeechAudioChunk,
    signal: AbortSignal,
    onLevel: (level: number) => void,
  ): Promise<void> {
    this.stop();
    if (signal.aborted) throw signal.reason;
    const context = this.context ?? new AudioContext();
    this.context = context;
    if (context.state === 'suspended') await context.resume();
    const bytes = chunk.audio.slice();
    const audioBuffer = await context.decodeAudioData(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    if (signal.aborted) throw signal.reason;

    const source = context.createBufferSource();
    const analyser = context.createAnalyser();
    const gain = context.createGain();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.35;
    const levels = new Uint8Array(analyser.fftSize);
    source.buffer = audioBuffer;
    source.connect(analyser);
    gain.gain.value = this.volume;
    analyser.connect(gain);
    gain.connect(context.destination);
    this.activeSource = source;
    this.activeGain = gain;

    const updateLevel = (): void => {
      if (this.activeSource !== source) return;
      analyser.getByteTimeDomainData(levels);
      let sum = 0;
      for (const value of levels) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / Math.max(1, levels.length));
      onLevel(Math.max(0, Math.min(1, rms * 3.2)));
      this.animationFrame = window.requestAnimationFrame(updateLevel);
    };

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', handleAbort);
        source.removeEventListener('ended', handleEnded);
        if (this.animationFrame !== undefined) window.cancelAnimationFrame(this.animationFrame);
        this.animationFrame = undefined;
        if (this.activeSource === source) this.activeSource = undefined;
        if (this.activeGain === gain) this.activeGain = undefined;
        source.disconnect();
        analyser.disconnect();
        gain.disconnect();
        onLevel(0);
        if (error) reject(error);
        else resolve();
      };
      const handleEnded = (): void => finish();
      const handleAbort = (): void => {
        try {
          source.stop();
        } catch {
          // The source may have ended between the abort signal and this callback.
        }
        finish(signal.reason ?? new Error('Speech playback cancelled.'));
      };
      source.addEventListener('ended', handleEnded, { once: true });
      signal.addEventListener('abort', handleAbort, { once: true });
      source.start();
      updateLevel();
    });
  }

  public stop(): void {
    if (this.animationFrame !== undefined) window.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    const source = this.activeSource;
    this.activeSource = undefined;
    this.activeGain = undefined;
    if (source) {
      try {
        source.stop();
      } catch {
        // Stopping an already-ended buffer is harmless.
      }
      source.disconnect();
    }
  }

  public async dispose(): Promise<void> {
    this.stop();
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== 'closed') await context.close().catch(() => undefined);
  }
}
