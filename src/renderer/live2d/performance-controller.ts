import type { CharacterPresentationPort } from '../../core/presentation/character-presentation';
import type { EmotionChannels } from '../../core/character/emotion-channels';
import type {
  CharacterEmotion,
  CharacterState,
  Live2DControlMap,
  Live2DDriver,
  TrackingPoint,
} from './contracts';

export class StateChannel {
  private current: CharacterState = 'idle';

  public constructor(
    private readonly driver: Live2DDriver,
    private readonly motions: Live2DControlMap['states'],
    private readonly isActionActive: () => boolean,
  ) {}

  public get value(): CharacterState {
    return this.current;
  }

  public async set(state: CharacterState): Promise<boolean> {
    this.current = state;
    return this.isActionActive() ? true : this.apply();
  }

  public async restore(): Promise<boolean> {
    return this.apply();
  }

  private async apply(): Promise<boolean> {
    const motion = this.motions[this.current] ?? this.motions.idle;
    return motion ? this.driver.playState(motion) : false;
  }
}

interface QueuedAction {
  perform: () => Promise<boolean>;
  resolve: (played: boolean) => void;
}

export interface PerformanceTimingPolicy {
  actionTimeoutMs: number;
  actionCooldownMs: number;
  recoveryDelayMs: number;
}

export const DEFAULT_PERFORMANCE_TIMING: Readonly<PerformanceTimingPolicy> = Object.freeze({
  actionTimeoutMs: 10_000,
  actionCooldownMs: 1_200,
  recoveryDelayMs: 0,
});

export class ActionChannel {
  private readonly queue: QueuedAction[] = [];
  private readonly lastQueuedAt = new Map<string, number>();
  private active = false;
  private destroyed = false;
  private restoreState: () => Promise<boolean> = async () => false;

  public constructor(
    private readonly driver: Live2DDriver,
    private readonly motions: Live2DControlMap['actions'],
    private readonly timing: Readonly<PerformanceTimingPolicy> = DEFAULT_PERFORMANCE_TIMING,
    private readonly now: () => number = Date.now,
  ) {}

  public get isActive(): boolean {
    return this.active;
  }

  public bindStateRestore(restore: () => Promise<boolean>): void {
    this.restoreState = restore;
  }

  public enqueue(action: string): Promise<boolean> {
    if (this.destroyed) return Promise.resolve(false);
    const motion = this.motions[action];
    const perform = motion
      ? () => this.driver.playAction(motion)
      : (action === 'nod' || action === 'shake') && this.driver.playGesture
        ? () => this.driver.playGesture!(action)
        : undefined;
    if (!perform) {
      return Promise.resolve(false);
    }
    const queuedAt = this.now();
    const previous = this.lastQueuedAt.get(action);
    if (previous !== undefined && queuedAt - previous < this.timing.actionCooldownMs) {
      return Promise.resolve(false);
    }
    this.lastQueuedAt.set(action, queuedAt);

    return new Promise<boolean>((resolve) => {
      this.queue.push({ perform, resolve });
      void this.drain();
    });
  }

  public destroy(): void {
    this.destroyed = true;
    for (const pending of this.queue.splice(0)) pending.resolve(false);
  }

  private playWithTimeout(perform: () => Promise<boolean>): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (played: boolean): void => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(played);
      };
      const timeout = globalThis.setTimeout(() => finish(false), this.timing.actionTimeoutMs);
      void perform().then(
        (played) => finish(played),
        () => finish(false),
      );
    });
  }

  private waitForRecovery(): Promise<void> {
    if (this.timing.recoveryDelayMs <= 0) return Promise.resolve();
    return new Promise((resolve) => globalThis.setTimeout(resolve, this.timing.recoveryDelayMs));
  }

  private async drain(): Promise<void> {
    if (this.active) {
      return;
    }

    this.active = true;
    try {
      let next = this.queue.shift();
      while (next) {
        let played = false;
        try {
          played = await this.playWithTimeout(next.perform);
        } catch {
          played = false;
        } finally {
          next.resolve(played);
        }
        next = this.queue.shift();
      }
    } finally {
      this.active = false;
      await this.waitForRecovery();
      if (!this.destroyed) await this.restoreState();
    }
  }
}

export class EmotionChannel {
  private current: CharacterEmotion = 'neutral';

  public constructor(
    private readonly driver: Live2DDriver,
    private readonly expressions: Live2DControlMap['emotions'],
  ) {}

  public get value(): CharacterEmotion {
    return this.current;
  }

  public async set(emotion: CharacterEmotion): Promise<boolean> {
    this.current = emotion;
    const requested = this.expressions[emotion];
    if (!requested && emotion !== 'neutral') {
      this.current = 'neutral';
    }

    const expression = requested ?? this.expressions.neutral;
    const applied = await this.driver.setExpression(expression);
    if (!applied && emotion !== 'neutral') {
      this.current = 'neutral';
      return this.driver.setExpression(this.expressions.neutral);
    }
    return applied;
  }
}

export class TrackingChannel {
  private enabled = true;

  public constructor(private readonly driver: Live2DDriver) {}

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.driver.resetTracking();
    }
  }

  public move(point: TrackingPoint, instant = false): void {
    if (!this.enabled) {
      return;
    }
    this.driver.setTracking(
      {
        x: Math.max(-1, Math.min(1, point.x)),
        y: Math.max(-1, Math.min(1, point.y)),
      },
      instant,
    );
  }
}

export class LipSyncChannel {
  private value = 0;

  public constructor(
    private readonly driver: Live2DDriver,
    private readonly enabled: boolean,
    private readonly gain: number,
  ) {}

  public update(level: number): void {
    if (!this.enabled || !Number.isFinite(level)) {
      this.reset();
      return;
    }
    const gated = level <= 0.025 ? 0 : (level - 0.025) / 0.975;
    const target = Math.max(0, Math.min(1, gated * this.gain));
    const smoothing = target >= this.value ? 0.68 : 0.24;
    this.value += (target - this.value) * smoothing;
    if (this.value < 0.005) this.value = 0;
    this.driver.setLipSync(this.value);
  }

  public reset(): void {
    this.value = 0;
    this.driver.setLipSync(0);
  }
}

export class Live2DPerformanceController implements CharacterPresentationPort {
  public readonly state: StateChannel;
  public readonly action: ActionChannel;
  public readonly emotion: EmotionChannel;
  public readonly tracking: TrackingChannel;
  public readonly lipSync: LipSyncChannel;
  private readonly emotionActions: Live2DControlMap['emotionActions'];
  private readonly expressions: Live2DControlMap['emotions'];
  private channelExpressionActive = false;
  private expressionResetTimer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private responseRevision = 0;

  public constructor(
    private readonly driver: Live2DDriver,
    controls: Live2DControlMap,
    timing: Readonly<PerformanceTimingPolicy> = DEFAULT_PERFORMANCE_TIMING,
    now: () => number = Date.now,
  ) {
    this.action = new ActionChannel(driver, controls.actions, timing, now);
    this.state = new StateChannel(driver, controls.states, () => this.action.isActive);
    this.action.bindStateRestore(() => this.state.restore());
    this.emotion = new EmotionChannel(driver, controls.emotions);
    this.emotionActions = controls.emotionActions;
    this.expressions = controls.emotions;
    this.tracking = new TrackingChannel(driver);
    this.lipSync = new LipSyncChannel(
      driver,
      Boolean(controls.lipSync),
      controls.lipSync?.gain ?? 1,
    );
  }

  public async respond(
    emotion: CharacterEmotion,
    requestedAction?: string,
    channels?: EmotionChannels,
  ): Promise<void> {
    if (this.destroyed) return;
    const revision = ++this.responseRevision;
    this.cancelExpressionReset();
    const basic = { happy: 'joy', sad: 'sadness', angry: 'anger', surprised: 'surprise' } as const;
    const matching = Object.hasOwn(basic, emotion)
      ? basic[emotion as keyof typeof basic]
      : undefined;
    const active = channels
      ? ['joy', 'sadness', 'anger', 'fear', 'disgust', 'surprise', 'guilt'].filter(
          (key) => channels[key as keyof EmotionChannels] > 0,
        )
      : [];
    const mapped =
      matching && active.length === 1 && active[0] === matching && this.expressions[emotion];
    this.channelExpressionActive = false;
    if (channels && !mapped && this.driver.setEmotionChannels) {
      await this.driver.setExpression(undefined);
      if (this.destroyed || revision !== this.responseRevision) return;
      this.channelExpressionActive = this.driver.setEmotionChannels(channels);
      if (!this.channelExpressionActive) await this.emotion.set(emotion);
    } else {
      this.driver.setEmotionChannels?.(undefined);
      await this.emotion.set(emotion);
    }
    if (this.destroyed || revision !== this.responseRevision) return;
    const action = requestedAction ?? this.emotionActions?.[emotion];
    if (action) void this.action.enqueue(action);
  }

  public setState(state: CharacterState): Promise<boolean> {
    if (this.destroyed) return Promise.resolve(false);
    this.driver.setGestureState?.(state);
    this.cancelExpressionReset();
    if (state === 'idle' && this.channelExpressionActive) {
      this.expressionResetTimer = setTimeout(() => {
        this.expressionResetTimer = undefined;
        this.channelExpressionActive = false;
        this.driver.setEmotionChannels?.(undefined);
      }, 8000);
    }
    return this.state.set(state);
  }

  private cancelExpressionReset(): void {
    if (this.expressionResetTimer !== undefined) clearTimeout(this.expressionResetTimer);
    this.expressionResetTimer = undefined;
  }

  public updateSpeechLevel(level: number): void {
    this.lipSync.update(level);
  }

  public resetSpeech(): void {
    this.lipSync.reset();
  }

  public async start(): Promise<void> {
    await Promise.all([this.state.restore(), this.emotion.set('neutral')]);
  }

  public destroy(): void {
    this.destroyed = true;
    this.responseRevision += 1;
    this.cancelExpressionReset();
    this.lipSync.reset();
    this.action.destroy();
    this.driver.destroy();
  }
}
