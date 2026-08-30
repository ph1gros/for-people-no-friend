import type { CharacterEmotion } from '../../core/character/character-reply';
import type {
  CharacterPresentationPort,
  CharacterPresentationState,
} from '../../core/presentation/character-presentation';

type RandomSource = () => number;

export interface AutonomousActivityTiming {
  firstDelayMinMs: number;
  firstDelayRangeMs: number;
  repeatDelayMinMs: number;
  repeatDelayRangeMs: number;
}

const DEFAULT_TIMING: Readonly<AutonomousActivityTiming> = Object.freeze({
  firstDelayMinMs: 10_000,
  firstDelayRangeMs: 8_000,
  repeatDelayMinMs: 18_000,
  repeatDelayRangeMs: 20_000,
});

const SAFE_ACTION_NAMES = new Set([
  'blink',
  'breathe',
  'breathing',
  'ear',
  'ears',
  'earwiggle',
  'idleaccent',
  'lookaround',
  'nod',
  'sway',
  '眼睛',
  '眼睛动',
  '看看',
  '看向四周',
  '眨眼',
  '点头',
  '耳朵',
  '耳朵动',
  '轻微晃动',
]);

const normalizeActionName = (action: string): string =>
  action
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_-]+/gu, '');

/** Only model-declared, emotionally neutral actions may run without a user request. */
export const selectSafeAutonomousActions = (actions: readonly string[]): string[] =>
  actions.filter((action) => SAFE_ACTION_NAMES.has(normalizeActionName(action)));

/**
 * Adds sparse, local-only activity around an existing Live2D presentation.
 * Conversation state always resets the timer, so autonomous actions only begin
 * after the character has been idle for a while.
 */
export class AutonomousActivityPresentation implements CharacterPresentationPort {
  private readonly actions: readonly string[];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private state: CharacterPresentationState = 'idle';
  private destroyed = false;
  private started = false;

  public constructor(
    private readonly base: CharacterPresentationPort,
    availableActions: readonly string[],
    private readonly perform: (action: string) => Promise<boolean>,
    private readonly random: RandomSource = Math.random,
    private readonly timing: Readonly<AutonomousActivityTiming> = DEFAULT_TIMING,
  ) {
    this.actions = selectSafeAutonomousActions(availableActions);
  }

  public start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.schedule(true);
  }

  public async setState(state: CharacterPresentationState): Promise<boolean> {
    this.state = state;
    this.defer();
    return this.base.setState(state);
  }

  public async respond(emotion: CharacterEmotion, requestedAction?: string): Promise<void> {
    this.defer();
    await this.base.respond(emotion, requestedAction);
  }

  public updateSpeechLevel(level: number): void {
    if (Number.isFinite(level) && level > 0.025) this.defer();
    this.base.updateSpeechLevel(level);
  }

  public resetSpeech(): void {
    this.base.resetSpeech();
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.timer !== undefined) globalThis.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private defer(): void {
    if (!this.started || this.destroyed) return;
    if (this.timer !== undefined) globalThis.clearTimeout(this.timer);
    this.timer = undefined;
    this.schedule(false);
  }

  private schedule(first: boolean): void {
    if (this.destroyed || this.actions.length === 0) return;
    const minimum = first ? this.timing.firstDelayMinMs : this.timing.repeatDelayMinMs;
    const range = first ? this.timing.firstDelayRangeMs : this.timing.repeatDelayRangeMs;
    const delay = minimum + Math.round(Math.min(1, Math.max(0, this.random())) * range);
    this.timer = globalThis.setTimeout(() => {
      this.timer = undefined;
      void this.run();
    }, delay);
  }

  private async run(): Promise<void> {
    if (this.destroyed) return;
    if (this.state === 'idle') {
      const index = Math.min(
        this.actions.length - 1,
        Math.floor(Math.min(1, Math.max(0, this.random())) * this.actions.length),
      );
      const action = this.actions[index];
      if (action) await this.perform(action).catch(() => false);
    }
    this.schedule(false);
  }
}
