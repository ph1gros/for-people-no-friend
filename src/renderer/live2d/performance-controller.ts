import type {
  CharacterEmotion,
  CharacterState,
  Live2DControlMap,
  Live2DDriver,
  MotionReference,
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
  motion: MotionReference;
  resolve: (played: boolean) => void;
}

export interface PerformanceTimingPolicy {
  actionTimeoutMs: number;
  actionCooldownMs: number;
  recoveryDelayMs: number;
}

export const DEFAULT_PERFORMANCE_TIMING: Readonly<PerformanceTimingPolicy> = Object.freeze({
  actionTimeoutMs: 12_000,
  actionCooldownMs: 1_200,
  recoveryDelayMs: 0,
});

export class ActionChannel {
  private readonly queue: QueuedAction[] = [];
  private readonly lastQueuedAt = new Map<string, number>();
  private active = false;
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
    const motion = this.motions[action];
    if (!motion) {
      return Promise.resolve(false);
    }
    const queuedAt = this.now();
    const previous = this.lastQueuedAt.get(action);
    if (previous !== undefined && queuedAt - previous < this.timing.actionCooldownMs) {
      return Promise.resolve(false);
    }
    this.lastQueuedAt.set(action, queuedAt);

    return new Promise<boolean>((resolve) => {
      this.queue.push({ motion, resolve });
      void this.drain();
    });
  }

  private playWithTimeout(motion: MotionReference): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (played: boolean): void => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(played);
      };
      const timeout = globalThis.setTimeout(() => finish(false), this.timing.actionTimeoutMs);
      void this.driver.playAction(motion).then(
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
          played = await this.playWithTimeout(next.motion);
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
      await this.restoreState();
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

export class Live2DPerformanceController {
  public readonly state: StateChannel;
  public readonly action: ActionChannel;
  public readonly emotion: EmotionChannel;
  public readonly tracking: TrackingChannel;
  private readonly emotionActions: Live2DControlMap['emotionActions'];

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
    this.tracking = new TrackingChannel(driver);
  }

  public async respond(emotion: CharacterEmotion, requestedAction?: string): Promise<void> {
    await this.emotion.set(emotion);
    const action = requestedAction ?? this.emotionActions?.[emotion];
    if (action) void this.action.enqueue(action);
  }

  public async start(): Promise<void> {
    await Promise.all([this.state.restore(), this.emotion.set('neutral')]);
  }

  public destroy(): void {
    this.driver.destroy();
  }
}
