import type { CharacterEmotion } from '../../core/character/character-reply';
import type {
  CharacterPresentationPort,
  CharacterPresentationState,
} from '../../core/presentation/character-presentation';
import type { DeskpetApi } from '../../shared/ipc';

/** Renderer sends character intent only; Main owns authorization, mapping, and WebSocket commands. */
export class VTubeStudioPresentationClient implements CharacterPresentationPort {
  public constructor(private readonly api: Pick<DeskpetApi, 'presentInVTubeStudio'>) {}

  public async setState(state: CharacterPresentationState): Promise<boolean> {
    return this.api.presentInVTubeStudio({ state }).catch(() => false);
  }

  public async respond(emotion: CharacterEmotion, requestedAction?: string): Promise<void> {
    await this.api
      .presentInVTubeStudio({
        emotion,
        ...(requestedAction ? { action: requestedAction } : {}),
      })
      .catch(() => false);
  }

  public updateSpeechLevel(level: number): void {
    void level;
    // Audio playback and lip sync remain owned by FPNF.
  }

  public resetSpeech(): void {
    // VTube Studio receives no audio data from this adapter.
  }
}
