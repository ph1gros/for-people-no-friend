import type { CharacterEmotion } from '../../core/character/character-reply';
import type { EmotionChannels } from '../../core/character/emotion-channels';
import type {
  CharacterPresentationPort,
  CharacterPresentationState,
} from '../../core/presentation/character-presentation';
import type { DeskpetApi } from '../../shared/ipc';

/** Renderer sends character intent only; Main owns authorization, mapping, and WebSocket commands. */
export class VTubeStudioPresentationClient implements CharacterPresentationPort {
  private expressionResetTimer: ReturnType<typeof setTimeout> | undefined;
  private lastEmotion: CharacterEmotion = 'neutral';
  private hasEmotionChannels = false;
  private revision = 0;

  public constructor(private readonly api: Pick<DeskpetApi, 'presentInVTubeStudio'>) {}

  public async setState(state: CharacterPresentationState): Promise<boolean> {
    const revision = ++this.revision;
    if (state !== 'idle') this.cancelExpressionReset();
    const updated = await this.api
      .presentInVTubeStudio({ state })
      .then((result) => result.ok)
      .catch(() => false);
    if (
      revision === this.revision &&
      state === 'idle' &&
      (this.lastEmotion !== 'neutral' || this.hasEmotionChannels)
    )
      this.scheduleExpressionReset();
    return updated;
  }

  public async respond(
    emotion: CharacterEmotion,
    requestedAction?: string,
    emotionChannels?: EmotionChannels,
  ): Promise<void> {
    this.revision += 1;
    this.cancelExpressionReset();
    this.lastEmotion = emotion;
    this.hasEmotionChannels = emotionChannels !== undefined;
    await this.api
      .presentInVTubeStudio({
        emotion,
        ...(emotionChannels ? { emotionChannels } : {}),
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
      this.hasEmotionChannels = false;
      void this.api.presentInVTubeStudio({ emotion: 'neutral' }).catch(() => undefined);
    }, 8_000);
  }

  private cancelExpressionReset(): void {
    if (this.expressionResetTimer === undefined) return;
    clearTimeout(this.expressionResetTimer);
    this.expressionResetTimer = undefined;
  }

  public dispose(): void {
    this.revision += 1;
    this.cancelExpressionReset();
    this.lastEmotion = 'neutral';
    this.hasEmotionChannels = false;
  }
}
