import type { CharacterEmotion } from '../../core/character/character-reply';
import type { CharacterState } from '../live2d/contracts';

export interface CharacterPerformanceController {
  readonly state: {
    set(state: CharacterState): Promise<boolean>;
  };
  readonly action: {
    enqueue(action: string): Promise<boolean>;
  };
  readonly emotion: {
    set(emotion: CharacterEmotion): Promise<boolean>;
  };
  destroy(): void;
}
