import type { SpeechInputMode } from '../../shared/speech-ipc';

export type WakeWordCommandResult =
  | { kind: 'ignored' }
  | { kind: 'armed'; message: string }
  | { kind: 'draft'; text: string; message: string }
  | { kind: 'send'; text: string; message: string };

export class PendingVoiceCommandQueue {
  private readonly commands: string[] = [];

  public constructor(private readonly maximumSize = 4) {}

  public get size(): number {
    return this.commands.length;
  }

  public enqueue(text: string): boolean {
    if (!text || this.commands.length >= this.maximumSize) return false;
    this.commands.push(text);
    return true;
  }

  public shift(): string | undefined {
    return this.commands.shift();
  }

  public clear(): void {
    this.commands.length = 0;
  }
}

const WAKE_WORD = '小猫';
const OUTER_PUNCTUATION = /^[\s,，。.!！?？:：;；、~～-]+|[\s,，。.!！?？:：;；、~～-]+$/gu;
const clean = (value: string): string => value.trim().replace(OUTER_PUNCTUATION, '').trim();

export const combineFullListeningCommands = (first: string, second: string): string => {
  const before = first.trim();
  const after = second.trim();
  if (!before) return after;
  if (!after) return before;
  return /[。！？!?]$/u.test(before) ? `${before}${after}` : `${before}。${after}`;
};

export const shouldCombineFullListeningCommands = (
  previousEndedAt: number,
  currentStartedAt: number,
  maximumGapMs = 2_000,
): boolean =>
  Number.isFinite(previousEndedAt) &&
  Number.isFinite(currentStartedAt) &&
  Number.isFinite(maximumGapMs) &&
  maximumGapMs >= 0 &&
  currentStartedAt >= previousEndedAt &&
  currentStartedAt - previousEndedAt <= maximumGapMs;

export class WakeWordCommandSession {
  private mode: SpeechInputMode = 'manual';

  public setMode(mode: SpeechInputMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.reset();
  }

  public reset(): void {
    // Wake-word matching is intentionally stateless so unrelated recognition
    // segments cannot accidentally combine into one command.
  }

  public handle(rawTranscript: string): WakeWordCommandResult {
    const transcript = clean(rawTranscript);
    if (!transcript || this.mode === 'manual') return { kind: 'ignored' };
    if (this.mode === 'full') {
      return { kind: 'send', text: transcript, message: '听到完整一句话，正在发送。' };
    }

    if (!transcript.startsWith(WAKE_WORD)) return { kind: 'ignored' };
    const text = clean(transcript.slice(WAKE_WORD.length));
    return text
      ? { kind: 'send', text, message: '听到“小猫”，正在发送。' }
      : { kind: 'armed', message: '听到了“小猫”，但后面还没有内容。' };
  }
}
