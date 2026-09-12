import type { CharacterEmotion } from '../../core/character/character-reply';
import type {
  CharacterPresentationPort,
  CharacterPresentationState,
} from '../../core/presentation/character-presentation';
import type { DeskpetApi } from '../../shared/ipc';

/** Renderer-side intent client; Main owns validation and the actual WebSocket. */
export class ViewerExPresentationClient implements CharacterPresentationPort {
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  private hasReply = false;
  private revision = 0;
  public constructor(private readonly api: Pick<DeskpetApi, 'presentInViewerEx'>) {}

  public setState(state: CharacterPresentationState): Promise<boolean> {
    this.revision += 1;
    this.cancelTimers();
    if (state === 'idle' && this.hasReply) {
      // ExAPI exposes no motion-end event. Give the reply gesture a short bounded window
      // before returning to idle, rather than immediately interrupting it.
      this.idleTimer = setTimeout(() => {
        this.idleTimer = undefined;
        void this.api.presentInViewerEx({ state: 'idle' }).catch(() => false);
      }, 1500);
      this.resetTimer = setTimeout(() => {
        this.resetTimer = undefined;
        this.hasReply = false;
        void this.api.presentInViewerEx({ emotion: 'neutral' }).catch(() => false);
      }, 8000);
      return Promise.resolve(true);
    }
    return this.api.presentInViewerEx({ state }).catch(() => false);
  }

  public async respond(emotion: CharacterEmotion, requestedAction?: string): Promise<void> {
    const revision = ++this.revision;
    this.cancelTimers();
    const sent = await this.api
      .presentInViewerEx({
        emotion,
        ...(requestedAction ? { action: requestedAction } : {}),
      })
      .catch(() => false);
    if (revision === this.revision)
      this.hasReply = sent && (emotion !== 'neutral' || requestedAction !== undefined);
  }

  public updateSpeechLevel(level: number): void {
    void level;
    // ViewerEX audio APIs accept paths/base64, so speech remains renderer-owned.
  }

  public resetSpeech(): void {
    // ViewerEX does not receive FPNF audio in this adapter.
  }

  private cancelTimers(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    if (this.resetTimer !== undefined) clearTimeout(this.resetTimer);
    this.idleTimer = undefined;
    this.resetTimer = undefined;
  }

  public dispose(): void {
    this.revision += 1;
    this.cancelTimers();
    this.hasReply = false;
  }
}
