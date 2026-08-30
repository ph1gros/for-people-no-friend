import type { CharacterEmotion } from '../character/character-reply';

export type CharacterPresentationState = 'idle' | 'thinking' | 'talking';

/**
 * Renderer-neutral output seam for one visible character.
 *
 * Conversation and speech clients describe character intent through this
 * interface. Live2D, ViewerEX, or another display adapter owns the concrete
 * rendering details behind it.
 */
export interface CharacterPresentationPort {
  setState(state: CharacterPresentationState): Promise<boolean>;
  respond(emotion: CharacterEmotion, requestedAction?: string): Promise<void>;
  updateSpeechLevel(level: number): void;
  resetSpeech(): void;
}

/** Fans presentation intent out while keeping optional displays isolated. */
export class CompositeCharacterPresentation implements CharacterPresentationPort {
  public constructor(private readonly ports: readonly CharacterPresentationPort[]) {}

  public async setState(state: CharacterPresentationState): Promise<boolean> {
    const results = await Promise.allSettled(this.ports.map((port) => port.setState(state)));
    return results.some((result) => result.status === 'fulfilled' && result.value);
  }

  public async respond(emotion: CharacterEmotion, requestedAction?: string): Promise<void> {
    await Promise.allSettled(this.ports.map((port) => port.respond(emotion, requestedAction)));
  }

  public updateSpeechLevel(level: number): void {
    for (const port of this.ports) {
      try {
        port.updateSpeechLevel(level);
      } catch {
        // One optional display must not interrupt another display or audio playback.
      }
    }
  }

  public resetSpeech(): void {
    for (const port of this.ports) {
      try {
        port.resetSpeech();
      } catch {
        // Optional display cleanup is best effort.
      }
    }
  }
}
