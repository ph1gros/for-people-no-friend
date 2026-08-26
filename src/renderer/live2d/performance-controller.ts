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

export class ActionChannel {
  private readonly queue: QueuedAction[] = [];
  private active = false;
  private restoreState: () => Promise<boolean> = async () => false;

  public constructor(
    private readonly driver: Live2DDriver,
    private readonly motions: Live2DControlMap['actions'],
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

    return new Promise<boolean>((resolve) => {
      this.queue.push({ motion, resolve });
      void this.drain();
    });
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
          played = await this.driver.playAction(next.motion);
        } catch {
          played = false;
        } finally {
          next.resolve(played);
        }
        next = this.queue.shift();
      }
    } finally {
      this.active = false;
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

  public constructor(
    private readonly driver: Live2DDriver,
    controls: Live2DControlMap,
  ) {
    this.action = new ActionChannel(driver, controls.actions);
    this.state = new StateChannel(driver, controls.states, () => this.action.isActive);
    this.action.bindStateRestore(() => this.state.restore());
    this.emotion = new EmotionChannel(driver, controls.emotions);
    this.tracking = new TrackingChannel(driver);
  }

  public async start(): Promise<void> {
    await Promise.all([this.state.restore(), this.emotion.set('neutral')]);
  }

  public destroy(): void {
    this.driver.destroy();
  }
}
