import type { CharacterPresentationState } from '../../core/presentation/character-presentation';

export interface VTubeStudioInjectedParameter {
  id: string;
  value: number;
}

export interface VTubeStudioPointerTrackingTarget {
  x: number;
  y: number;
  headX?: number;
  headY?: number;
  weight: number;
  proximity?: number;
}

type RandomSource = () => number;

interface NormalizedPose {
  angleX: number;
  angleY: number;
  angleZ: number;
  eyeX: number;
  eyeY: number;
}

const BLINK_MIN_INTERVAL_MS = 2_800;
const BLINK_INTERVAL_RANGE_MS = 3_700;
const BLINK_DURATION_MS = 240;
const FIRST_BLINK_MIN_DELAY_MS = 1_200;
const FIRST_BLINK_DELAY_RANGE_MS = 800;
const NOD_DURATION_MS = 1_200;
const NOD_AMPLITUDE = 4;
const SHAKE_DURATION_MS = 1_400;
const SHAKE_AMPLITUDE = 5.5;
const FIRST_AUTONOMOUS_ACTION_MIN_DELAY_MS = 18_000;
const FIRST_AUTONOMOUS_ACTION_DELAY_RANGE_MS = 12_000;
const AUTONOMOUS_ACTION_MIN_INTERVAL_MS = 45_000;
const AUTONOMOUS_ACTION_INTERVAL_RANGE_MS = 30_000;
const EYE_HORIZONTAL_TRACKING_SCALE = 0.5;
const EYE_UP_TRACKING_SCALE = 0.28;
const EYE_DOWN_TRACKING_SCALE = 0.34;
const DROWSY_EYE_OPEN = 0;
const DROWSY_NEARBY_EYE_OPEN = 0.28;
const DROWSY_EYE_CLOSE_DURATION_MS = 1_800;
const DROWSY_EYE_WAKE_DURATION_MS = 2_000;
const FIRST_DROWSY_NOD_MIN_DELAY_MS = 6_000;
const FIRST_DROWSY_NOD_DELAY_RANGE_MS = 6_000;
const DROWSY_NOD_MIN_DELAY_MS = 10_000;
const DROWSY_NOD_DELAY_RANGE_MS = 14_000;
const DROWSY_NOD_MIN_DURATION_MS = 2_000;
const DROWSY_NOD_DURATION_RANGE_MS = 1_200;
const DROWSY_NOD_MIN_AMPLITUDE = 4;
const DROWSY_NOD_AMPLITUDE_RANGE = 3.5;
const ZERO_POSE: NormalizedPose = { angleX: 0, angleY: 0, angleZ: 0, eyeX: 0, eyeY: 0 };

const clampRandom = (value: number): number => Math.min(1, Math.max(0, value));

/** Produces the bounded tracking inputs owned by FPNF while AI character control is active. */
export class VTubeStudioIdleMotion {
  private readonly startedAt: number;
  private nextBlinkAt: number;
  private poseFrom: NormalizedPose = ZERO_POSE;
  private poseTo: NormalizedPose;
  private poseStartedAt: number;
  private poseEndsAt: number;
  private nodStartedAt: number | undefined;
  private shakeStartedAt: number | undefined;
  private nextAutonomousActionAt: number;
  private drowsy = false;
  private drowsyStartedAt: number | undefined;
  private drowsyNodStartedAt: number | undefined;
  private nextDrowsyNodAt: number | undefined;
  private drowsyNodDuration = DROWSY_NOD_MIN_DURATION_MS;
  private drowsyNodAmplitude = DROWSY_NOD_MIN_AMPLITUDE;
  private eyeOpen = 0.8;
  private eyeOpenUpdatedAt: number;

  public constructor(
    now = Date.now(),
    private readonly random: RandomSource = Math.random,
  ) {
    this.startedAt = now;
    this.nextBlinkAt =
      now +
      FIRST_BLINK_MIN_DELAY_MS +
      Math.round(clampRandom(this.random()) * FIRST_BLINK_DELAY_RANGE_MS);
    this.poseTo = this.randomPose();
    this.poseStartedAt = now;
    this.poseEndsAt = now + this.randomPoseDuration('idle');
    this.nextAutonomousActionAt = this.scheduleAutonomousAction(now, true);
    this.eyeOpenUpdatedAt = now;
  }

  public frame(
    now: number,
    state: CharacterPresentationState,
    pointer?: VTubeStudioPointerTrackingTarget,
  ): VTubeStudioInjectedParameter[] {
    if (state !== 'idle' && this.drowsy) {
      this.drowsy = false;
      this.drowsyStartedAt = undefined;
      this.drowsyNodStartedAt = undefined;
      this.nextDrowsyNodAt = undefined;
    }
    const elapsedSeconds = (now - this.startedAt) / 1_000;
    const profile =
      state === 'thinking'
        ? { angleX: 5.2, angleY: 3.2, angleZ: 3.4 }
        : state === 'talking'
          ? { angleX: 4.4, angleY: 2.6, angleZ: 3.8 }
          : { angleX: 4.2, angleY: 2.4, angleZ: 3.2 };

    const pose = this.currentPose(now, state);
    const pointerWeight = Math.min(1, Math.max(0, pointer?.weight ?? 0));
    const pointerProximity = Math.min(1, Math.max(0, pointer?.proximity ?? 0));
    const pointerX = Math.min(1, Math.max(-1, pointer?.x ?? 0));
    const pointerY = Math.min(1, Math.max(-1, pointer?.y ?? 0));
    const pointerHeadX = Math.min(1, Math.max(-1, pointer?.headX ?? pointerX));
    const pointerHeadY = Math.min(1, Math.max(-1, pointer?.headY ?? pointerY));
    const trackedEyeY =
      pointerY >= 0 ? pointerY * EYE_UP_TRACKING_SCALE : pointerY * EYE_DOWN_TRACKING_SCALE;
    this.updateAutonomousAction(now, state, pointerWeight);
    const headX = this.mix(pose.angleX, pointerHeadX, pointerWeight * 0.75);
    const headY = this.mix(pose.angleY, pointerHeadY * 0.85, pointerWeight * 0.58);
    const blink = this.blinkOffset(now);
    const targetEyeOpen = this.drowsy
      ? this.mix(DROWSY_EYE_OPEN, DROWSY_NEARBY_EYE_OPEN, pointerProximity)
      : 0.8;
    this.updateEyeOpen(now, targetEyeOpen);
    const eyeOpen = Math.max(0, this.eyeOpen + blink);
    const nodOffset = this.nodOffset(now, pointerProximity);
    const shakeOffset = this.shakeOffset(now);
    return [
      {
        id: 'FaceAngleX',
        value:
          headX * profile.angleX * 0.86 +
          Math.sin(elapsedSeconds * 0.43) * profile.angleX * 0.08 +
          shakeOffset,
      },
      {
        id: 'FaceAngleY',
        value:
          headY * profile.angleY * 0.86 +
          Math.sin(elapsedSeconds * 0.31 + 0.8) * profile.angleY * 0.08 +
          nodOffset,
      },
      {
        id: 'FaceAngleZ',
        value:
          pose.angleZ * profile.angleZ * 0.86 +
          Math.sin(elapsedSeconds * 0.27 + 1.4) * profile.angleZ * 0.08,
      },
      {
        id: 'EyeRightX',
        value: this.mix(pose.eyeX * 0.08, pointerX * -EYE_HORIZONTAL_TRACKING_SCALE, pointerWeight),
      },
      {
        id: 'EyeRightY',
        value: this.mix(pose.eyeY * 0.04, trackedEyeY, pointerWeight),
      },
      { id: 'EyeOpenLeft', value: eyeOpen },
      { id: 'EyeOpenRight', value: eyeOpen },
    ];
  }

  public triggerAction(action: string, now = Date.now()): boolean {
    const normalized = action.trim().toLocaleLowerCase();
    if (normalized === 'drowsy') {
      this.drowsy = true;
      this.nodStartedAt = undefined;
      this.shakeStartedAt = undefined;
      this.drowsyStartedAt = now;
      this.drowsyNodStartedAt = undefined;
      this.nextDrowsyNodAt = this.scheduleDrowsyNod(now, true);
      this.eyeOpenUpdatedAt = now;
      return true;
    }
    if (normalized !== 'nod' && normalized !== 'shake') return false;
    this.drowsy = false;
    this.drowsyStartedAt = undefined;
    this.drowsyNodStartedAt = undefined;
    this.nextDrowsyNodAt = undefined;
    this.nodStartedAt = normalized === 'nod' ? now : undefined;
    this.shakeStartedAt = normalized === 'shake' ? now : undefined;
    this.nextAutonomousActionAt = this.scheduleAutonomousAction(now, false);
    return true;
  }

  private updateAutonomousAction(
    now: number,
    state: CharacterPresentationState,
    pointerWeight: number,
  ): void {
    if (now < this.nextAutonomousActionAt) return;
    if (
      state === 'idle' &&
      pointerWeight <= 0 &&
      this.nodStartedAt === undefined &&
      this.shakeStartedAt === undefined
    ) {
      this.nodStartedAt = now;
    }
    this.nextAutonomousActionAt = this.scheduleAutonomousAction(now, false);
  }

  private scheduleAutonomousAction(now: number, first: boolean): number {
    const minimum = first
      ? FIRST_AUTONOMOUS_ACTION_MIN_DELAY_MS
      : AUTONOMOUS_ACTION_MIN_INTERVAL_MS;
    const range = first
      ? FIRST_AUTONOMOUS_ACTION_DELAY_RANGE_MS
      : AUTONOMOUS_ACTION_INTERVAL_RANGE_MS;
    return now + minimum + Math.round(clampRandom(this.random()) * range);
  }

  private scheduleDrowsyNod(now: number, first: boolean): number {
    const minimum = first ? FIRST_DROWSY_NOD_MIN_DELAY_MS : DROWSY_NOD_MIN_DELAY_MS;
    const range = first ? FIRST_DROWSY_NOD_DELAY_RANGE_MS : DROWSY_NOD_DELAY_RANGE_MS;
    return now + minimum + Math.round(clampRandom(this.random()) * range);
  }

  private currentPose(now: number, state: CharacterPresentationState): NormalizedPose {
    let transitions = 0;
    while (now >= this.poseEndsAt && transitions < 8) {
      this.poseFrom = this.poseTo;
      this.poseTo = this.randomPose();
      this.poseStartedAt = this.poseEndsAt;
      this.poseEndsAt = this.poseStartedAt + this.randomPoseDuration(state);
      transitions += 1;
    }
    if (now >= this.poseEndsAt) {
      this.poseFrom = this.poseTo;
      this.poseTo = this.randomPose();
      this.poseStartedAt = now;
      this.poseEndsAt = now + this.randomPoseDuration(state);
    }
    const progress = Math.min(
      1,
      Math.max(0, (now - this.poseStartedAt) / (this.poseEndsAt - this.poseStartedAt)),
    );
    const eased = progress * progress * (3 - 2 * progress);
    return {
      angleX: this.mix(this.poseFrom.angleX, this.poseTo.angleX, eased),
      angleY: this.mix(this.poseFrom.angleY, this.poseTo.angleY, eased),
      angleZ: this.mix(this.poseFrom.angleZ, this.poseTo.angleZ, eased),
      eyeX: this.mix(this.poseFrom.eyeX, this.poseTo.eyeX, eased),
      eyeY: this.mix(this.poseFrom.eyeY, this.poseTo.eyeY, eased),
    };
  }

  private randomPose(): NormalizedPose {
    return {
      angleX: this.randomSigned(),
      angleY: this.randomSigned() * 0.85,
      angleZ: this.randomSigned(),
      eyeX: this.randomSigned(),
      eyeY: this.randomSigned(),
    };
  }

  private randomPoseDuration(state: CharacterPresentationState): number {
    const minimum = state === 'thinking' ? 1_400 : state === 'talking' ? 1_700 : 2_200;
    const range = state === 'thinking' ? 1_800 : state === 'talking' ? 2_000 : 2_600;
    return minimum + Math.round(clampRandom(this.random()) * range);
  }

  private randomSigned(): number {
    return clampRandom(this.random()) * 2 - 1;
  }

  private mix(from: number, to: number, progress: number): number {
    if (progress <= 0) return from;
    if (progress >= 1) return to;
    return from + (to - from) * progress;
  }

  private blinkOffset(now: number): number {
    if (now < this.nextBlinkAt) return 0;
    const progress = (now - this.nextBlinkAt) / BLINK_DURATION_MS;
    if (progress <= 1) return -Math.sin(Math.PI * progress) * 0.95;
    this.nextBlinkAt = this.scheduleBlink(now);
    return 0;
  }

  private scheduleBlink(now: number): number {
    return (
      now + BLINK_MIN_INTERVAL_MS + Math.round(clampRandom(this.random()) * BLINK_INTERVAL_RANGE_MS)
    );
  }

  private updateEyeOpen(now: number, target: number): void {
    const elapsed = Math.max(0, now - this.eyeOpenUpdatedAt);
    this.eyeOpenUpdatedAt = now;
    const duration =
      target < this.eyeOpen ? DROWSY_EYE_CLOSE_DURATION_MS : DROWSY_EYE_WAKE_DURATION_MS;
    const maximumChange = (0.8 * elapsed) / duration;
    if (Math.abs(target - this.eyeOpen) <= maximumChange) {
      this.eyeOpen = target;
      return;
    }
    this.eyeOpen += Math.sign(target - this.eyeOpen) * maximumChange;
  }

  private nodOffset(now: number, pointerProximity: number): number {
    if (this.drowsyStartedAt !== undefined) {
      if (
        this.drowsyNodStartedAt === undefined &&
        this.nextDrowsyNodAt !== undefined &&
        now >= this.nextDrowsyNodAt
      ) {
        this.drowsyNodStartedAt = now;
        this.nextDrowsyNodAt = undefined;
        this.drowsyNodDuration =
          DROWSY_NOD_MIN_DURATION_MS +
          Math.round(clampRandom(this.random()) * DROWSY_NOD_DURATION_RANGE_MS);
        this.drowsyNodAmplitude =
          DROWSY_NOD_MIN_AMPLITUDE + clampRandom(this.random()) * DROWSY_NOD_AMPLITUDE_RANGE;
      }
      if (this.drowsyNodStartedAt === undefined) return 0;
      const progress = (now - this.drowsyNodStartedAt) / this.drowsyNodDuration;
      if (progress >= 1) {
        this.drowsyNodStartedAt = undefined;
        this.nextDrowsyNodAt = this.scheduleDrowsyNod(now, false);
        return 0;
      }
      const proximityDamping = 1 - pointerProximity * 0.25;
      return -(Math.sin(progress * Math.PI) ** 2 * this.drowsyNodAmplitude * proximityDamping);
    }
    if (this.nodStartedAt === undefined) return 0;
    const progress = (now - this.nodStartedAt) / NOD_DURATION_MS;
    if (progress < 0) return 0;
    if (progress >= 1) {
      this.nodStartedAt = undefined;
      return 0;
    }
    return -(Math.sin(progress * Math.PI) ** 2) * NOD_AMPLITUDE;
  }

  private shakeOffset(now: number): number {
    if (this.shakeStartedAt === undefined) return 0;
    const progress = (now - this.shakeStartedAt) / SHAKE_DURATION_MS;
    if (progress < 0) return 0;
    if (progress >= 1) {
      this.shakeStartedAt = undefined;
      return 0;
    }
    const envelope = Math.sin(progress * Math.PI);
    return Math.sin(progress * Math.PI * 4) * envelope * SHAKE_AMPLITUDE;
  }
}
