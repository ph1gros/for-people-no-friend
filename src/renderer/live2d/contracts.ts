export type CharacterState = 'idle' | 'thinking' | 'talking';

export type CharacterEmotion =
  'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'shy' | 'playful';

export interface MotionReference {
  group: string;
  index?: number;
}

export interface Live2DControlMap {
  states: Partial<Record<CharacterState, MotionReference>>;
  actions: Record<string, MotionReference>;
  emotions: Partial<Record<CharacterEmotion, string>>;
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
  destroy(): void;
}
