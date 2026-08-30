import type { CharacterEmotion } from '../../core/character/character-reply';
import type { CharacterPresentationState } from '../../core/presentation/character-presentation';

export type { CharacterEmotion } from '../../core/character/character-reply';
export type CharacterState = CharacterPresentationState;

export interface MotionReference {
  group: string;
  index?: number;
}

export interface Live2DControlMap {
  states: Partial<Record<CharacterState, MotionReference>>;
  actions: Record<string, MotionReference>;
  emotions: Partial<Record<CharacterEmotion, string>>;
  emotionActions?: Partial<Record<CharacterEmotion, string>>;
  lipSync?: Live2DLipSyncControl;
}

export interface Live2DLipSyncControl {
  mouthOpenParameter: string;
  gain: number;
}

export interface TrackingPoint {
  x: number;
  y: number;
}

export interface Live2DDriver {
  playState(motion: MotionReference): Promise<boolean>;
  playAction(motion: MotionReference): Promise<boolean>;
  setExpression(expressionId?: string): Promise<boolean>;
  setTracking(point: TrackingPoint, instant?: boolean): void;
  resetTracking(): void;
  setLipSync(value: number): void;
  destroy(): void;
}
