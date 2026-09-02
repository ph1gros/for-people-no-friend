import type { CharacterEmotion } from '../../core/character/character-reply';
import type {
  CharacterPresentationPort,
  CharacterPresentationState,
} from '../../core/presentation/character-presentation';
import type { DeskpetApi } from '../../shared/ipc';

/** Renderer sends character intent only; Main owns authorization, mapping, and WebSocket commands. */
export class VTubeStudioPresentationClient implements CharacterPresentationPort {
  private expressionResetTimer: ReturnType<typeof setTimeout> | undefined;
  private lastEmotion: CharacterEmotion = 'neutral';

  public constructor(private readonly api: Pick<DeskpetApi, 'presentInVTubeStudio'>) {}

  public async setState(state: CharacterPresentationState): Promise<boolean> {
    if (state !== 'idle') this.cancelExpressionReset();
    const updated = await this.api
      .presentInVTubeStudio({ state })
      .then((result) => result.ok)
      .catch(() => false);
    if (state === 'idle' && this.lastEmotion !== 'neutral') this.scheduleExpressionReset();
    return updated;
  }

  public async respond(emotion: CharacterEmotion, requestedAction?: string): Promise<void> {
    this.cancelExpressionReset();
    this.lastEmotion = emotion;
    await this.api
      .presentInVTubeStudio({
        emotion,
        ...(requestedAction ? { action: requestedAction } : {}),
      })
      .catch(() => undefined);
  }

  public updateSpeechLevel(level: number): void {
    void level;
    // Audio playback and lip sync remain owned by FPNF.
  }

  public resetSpeech(): void {
    // VTube Studio receives no audio data from this adapter.
  }

  private scheduleExpressionReset(): void {
    this.cancelExpressionReset();
    this.expressionResetTimer = setTimeout(() => {
      this.expressionResetTimer = undefined;
      this.lastEmotion = 'neutral';
      void this.api.presentInVTubeStudio({ emotion: 'neutral' }).catch(() => undefined);
    }, 8_000);
  }

  private cancelExpressionReset(): void {
    if (this.expressionResetTimer === undefined) return;
    clearTimeout(this.expressionResetTimer);
    this.expressionResetTimer = undefined;
  }
}
