import type { SpeechAudioChunk } from './contracts';

export interface SpeechSynthesisClient {
  synthesize(requestId: string, text: string, signal: AbortSignal): Promise<SpeechAudioChunk>;
  cancel(requestId: string): Promise<void>;
}

export interface SpeechAudioPlayer {
  play(
    chunk: SpeechAudioChunk,
    signal: AbortSignal,
    onLevel: (level: number) => void,
  ): Promise<void>;
  stop(): void;
}

export interface SpeechTurnPipelineOptions {
  maximumSegmentLength?: number;
  minimumStreamingSegmentLength?: number;
  maximumConcurrentSynthesis?: number;
  deferUntilFinish?: boolean;
  onLevel?: (level: number) => void;
  onSegmentStart?: (text: string) => void;
  onSegmentEnd?: (text: string) => void;
  onError?: (message: string) => void;
}

const HARD_BOUNDARY = new Set(['。', '！', '？', '!', '?', ';', '；', '\n']);
const SOFT_BOUNDARY = new Set(['，', ',', '、', '：', ':', ' ']);
const CLOSING_PUNCTUATION = new Set(['”', '’', '"', "'", '》', '）', ')', '】', ']']);

export const prepareSpeechText = (text: string): string =>
  text
    .normalize('NFC')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, ' ')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/^\s*>\s?/gmu, '')
    .replace(/^\s*(?:[-*+] |\d+[.)] )/gmu, '')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\u200d|\ufe0e|\ufe0f/gu, ' ')
    .replace(/[*_~]/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();

const consumeClosingPunctuation = (text: string, boundary: number): number => {
  let index = boundary + 1;
  while (index < text.length && CLOSING_PUNCTUATION.has(text[index] ?? '')) index += 1;
  while (index < text.length && /\s/u.test(text[index] ?? '')) index += 1;
  return index;
};

const isDecimalPoint = (text: string, index: number): boolean =>
  text[index] === '.' && /\d/u.test(text[index - 1] ?? '') && /\d/u.test(text[index + 1] ?? '');

const findBoundary = (text: string, maximumLength: number, minimumLength = 0): number => {
  const searchLimit = Math.min(text.length, maximumLength);
  for (let index = 0; index < searchLimit; index += 1) {
    if (
      index + 1 >= minimumLength &&
      HARD_BOUNDARY.has(text[index] ?? '') &&
      !isDecimalPoint(text, index)
    ) {
      return consumeClosingPunctuation(text, index);
    }
  }
  if (text.length < maximumLength) return -1;
  for (let index = searchLimit - 1; index >= 0; index -= 1) {
    if (SOFT_BOUNDARY.has(text[index] ?? '')) return consumeClosingPunctuation(text, index);
  }
  return searchLimit;
};

export class SpeechTextSegmenter {
  private pending = '';

  public constructor(
    private readonly maximumLength = 220,
    private readonly deferUntilFinish = false,
    private readonly minimumStreamingLength = 0,
  ) {}

  public append(delta: string): string[] {
    this.pending += delta;
    if (this.deferUntilFinish) return [];
    return this.drain(false);
  }

  public finish(): string[] {
    if (this.deferUntilFinish) return this.drainDeferred();
    return this.drain(true);
  }

  public clear(): void {
    this.pending = '';
  }

  private drain(force: boolean): string[] {
    const segments: string[] = [];
    while (this.pending) {
      const boundary = findBoundary(
        this.pending,
        this.maximumLength,
        force ? 0 : this.minimumStreamingLength,
      );
      if (boundary < 0) break;
      const prepared = prepareSpeechText(this.pending.slice(0, boundary));
      this.pending = this.pending.slice(boundary);
      if (prepared) segments.push(prepared);
    }
    if (force && this.pending) {
      const prepared = prepareSpeechText(this.pending);
      this.pending = '';
      if (prepared) segments.push(prepared);
    }
    return segments;
  }

  private drainDeferred(): string[] {
    const prepared = prepareSpeechText(this.pending);
    this.pending = '';
    if (!prepared) return [];
    if (prepared.length <= this.maximumLength) return [prepared];

    const segments: string[] = [];
    let remaining = prepared;
    while (remaining) {
      const boundary = findBoundary(remaining, this.maximumLength);
      if (boundary < 0) {
        segments.push(remaining);
        break;
      }
      const segment = prepareSpeechText(remaining.slice(0, boundary));
      remaining = remaining.slice(boundary);
      if (segment) segments.push(segment);
    }
    return segments;
  }
}

interface QueuedSegment {
  sequence: number;
  requestId: string;
  text: string;
}

export class SpeechTurnPipeline {
  private readonly controller = new AbortController();
  private readonly segmenter: SpeechTextSegmenter;
  private readonly queued: QueuedSegment[] = [];
  private readonly completed = new Map<number, SpeechAudioChunk | undefined>();
  private readonly activeRequestIds = new Set<string>();
  private readonly maximumConcurrentSynthesis: number;
  private readonly onLevel: (level: number) => void;
  private sequence = 0;
  private nextPlaybackSequence = 0;
  private inFlight = 0;
  private playing = false;
  private finalized = false;
  private settled = false;
  private readonly completion: Promise<boolean>;
  private resolveCompletion!: (completed: boolean) => void;

  public constructor(
    private readonly turnId: string,
    private readonly synthesis: SpeechSynthesisClient,
    private readonly player: SpeechAudioPlayer,
    private readonly options: SpeechTurnPipelineOptions = {},
  ) {
    this.segmenter = new SpeechTextSegmenter(
      options.maximumSegmentLength ?? 220,
      options.deferUntilFinish ?? false,
      Math.max(
        0,
        Math.min(options.maximumSegmentLength ?? 220, options.minimumStreamingSegmentLength ?? 0),
      ),
    );
    this.maximumConcurrentSynthesis = Math.max(
      1,
      Math.min(4, options.maximumConcurrentSynthesis ?? 2),
    );
    this.onLevel = options.onLevel ?? (() => undefined);
    this.completion = new Promise<boolean>((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  public appendText(delta: string): void {
    if (this.finalized || this.controller.signal.aborted || !delta) return;
    this.enqueue(this.segmenter.append(delta));
  }

  public finish(): Promise<boolean> {
    if (!this.finalized) {
      this.finalized = true;
      this.enqueue(this.segmenter.finish());
      this.settleIfDone();
    }
    return this.completion;
  }

  public cancel(reason = 'cancelled'): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort(reason);
    this.segmenter.clear();
    this.queued.length = 0;
    this.completed.clear();
    this.player.stop();
    this.onLevel(0);
    for (const requestId of this.activeRequestIds) void this.synthesis.cancel(requestId);
    this.activeRequestIds.clear();
    this.settle(false);
  }

  private enqueue(texts: string[]): void {
    for (const text of texts) {
      const sequence = this.sequence++;
      this.queued.push({ sequence, requestId: `${this.turnId}_${sequence}`, text });
    }
    this.pumpSynthesis();
  }

  private pumpSynthesis(): void {
    while (
      !this.controller.signal.aborted &&
      this.inFlight < this.maximumConcurrentSynthesis &&
      this.queued.length > 0
    ) {
      const segment = this.queued.shift();
      if (!segment) break;
      this.inFlight += 1;
      this.activeRequestIds.add(segment.requestId);
      void this.synthesis
        .synthesize(segment.requestId, segment.text, this.controller.signal)
        .then((chunk) => {
          if (!this.controller.signal.aborted) this.completed.set(segment.sequence, chunk);
        })
        .catch(() => {
          if (!this.controller.signal.aborted) {
            this.completed.set(segment.sequence, undefined);
            this.options.onError?.('语音生成失败，已继续保留文字回复。');
          }
        })
        .finally(() => {
          this.activeRequestIds.delete(segment.requestId);
          this.inFlight -= 1;
          this.pumpSynthesis();
          void this.pumpPlayback();
          this.settleIfDone();
        });
    }
  }

  private async pumpPlayback(): Promise<void> {
    if (this.playing || this.controller.signal.aborted) return;
    this.playing = true;
    try {
      while (this.completed.has(this.nextPlaybackSequence) && !this.controller.signal.aborted) {
        const chunk = this.completed.get(this.nextPlaybackSequence);
        this.completed.delete(this.nextPlaybackSequence);
        this.nextPlaybackSequence += 1;
        if (!chunk) continue;
        this.options.onSegmentStart?.(chunk.text ?? '');
        try {
          await this.player.play(chunk, this.controller.signal, this.onLevel);
        } catch {
          if (!this.controller.signal.aborted) {
            this.options.onError?.('音频播放失败，已继续保留文字回复。');
          }
        } finally {
          this.onLevel(0);
          this.options.onSegmentEnd?.(chunk.text ?? '');
        }
      }
    } finally {
      this.playing = false;
      this.settleIfDone();
    }
  }

  private settleIfDone(): void {
    if (
      this.finalized &&
      !this.playing &&
      this.inFlight === 0 &&
      this.queued.length === 0 &&
      this.completed.size === 0
    ) {
      this.settle(true);
    }
  }

  private settle(completed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveCompletion(completed);
  }
}
