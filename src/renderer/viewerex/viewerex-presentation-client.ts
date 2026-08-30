import type { CharacterEmotion } from '../../core/character/character-reply';
import type {
  CharacterPresentationPort,
  CharacterPresentationState,
} from '../../core/presentation/character-presentation';
import type { DeskpetApi } from '../../shared/ipc';

/** Renderer-side intent client; Main owns validation and the actual WebSocket. */
export class ViewerExPresentationClient implements CharacterPresentationPort {
  public constructor(private readonly api: Pick<DeskpetApi, 'presentInViewerEx'>) {}

  public setState(state: CharacterPresentationState): Promise<boolean> {
    return this.api.presentInViewerEx({ state }).catch(() => false);
  }

  public async respond(emotion: CharacterEmotion, requestedAction?: string): Promise<void> {
    await this.api
      .presentInViewerEx({
        emotion,
        ...(requestedAction ? { action: requestedAction } : {}),
      })
      .catch(() => false);
  }

  public updateSpeechLevel(level: number): void {
    void level;
    // ViewerEX audio APIs accept paths/base64, so speech remains renderer-owned.
  }

  public resetSpeech(): void {
    // ViewerEX does not receive FPNF audio in this adapter.
  }
}
