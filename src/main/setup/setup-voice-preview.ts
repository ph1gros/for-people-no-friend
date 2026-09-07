import { GENIE_VOICE_PRESETS } from '../../shared/speech-ipc';
import { SETUP_VOICE_ASSETS } from '../../shared/setup-resources';
import type { SetupVoice } from '../../core/setup/setup-flow';
import type { SetupVoicePreviewResult } from '../../shared/setup-ipc';

/**
 * One fixed sentence per managed voice, written in the language that voice actually speaks.
 *
 * The renderer never supplies this text. A preview that accepted arbitrary text would turn the
 * wizard window into a text-to-speech endpoint, and the wizard is the one window in the app that
 * exists before the user has agreed to anything. Speaking each voice in its own language also
 * keeps the preview independent of the chat model, so it works before a provider is configured.
 */
const PREVIEW_TEXTS: Readonly<Record<string, string>> = Object.freeze({
  mika: 'こんにちは。今日はいい天気ですね。',
  feibi: '你好，我是你的桌面伙伴。',
  thirtyseven: 'Hello. It is nice to meet you.',
});

export interface SetupVoicePreviewDependencies {
  /** Starts the managed voice process if it is not already running. */
  ensureRunning(voiceId: string): Promise<boolean>;
  synthesize(
    request: { baseUrl: string; characterName: string; text: string },
    signal: AbortSignal,
  ): Promise<{ audio: Uint8Array; mimeType: string }>;
  /** Whether every asset this voice needs has passed verification. */
  isInstalled(voice: SetupVoice): Promise<boolean>;
}

export class SetupVoicePreviewService {
  private current: AbortController | undefined;

  public constructor(private readonly dependencies: SetupVoicePreviewDependencies) {}

  /**
   * Never rejects for an ordinary failure. A preview that throws would surface as a wizard error
   * and block a user from finishing setup over a feature that is only there to reassure them.
   */
  public async preview(voice: SetupVoice, signal: AbortSignal): Promise<SetupVoicePreviewResult> {
    this.stop();
    const preset = GENIE_VOICE_PRESETS.find(
      (candidate) => candidate.assetId === SETUP_VOICE_ASSETS[voice],
    );
    const text = preset ? PREVIEW_TEXTS[preset.voiceId] : undefined;
    if (!preset || !text) {
      return { ok: false, reason: 'unsupported', message: '这个音色暂不支持试听。' };
    }
    const controller = new AbortController();
    this.current = controller;
    const abort = (): void => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    try {
      controller.signal.throwIfAborted();
      const installed = await this.dependencies.isInstalled(voice);
      controller.signal.throwIfAborted();
      if (!installed) {
        return {
          ok: false,
          reason: 'not-installed',
          message: '组件尚未全部校验通过，暂时无法试听。',
        };
      }
      const running = await this.dependencies.ensureRunning(preset.voiceId);
      controller.signal.throwIfAborted();
      if (!running) {
        return { ok: false, reason: 'unavailable', message: '本机语音服务没有启动，可稍后重试。' };
      }
      const result = await this.dependencies.synthesize(
        { baseUrl: preset.baseUrl, characterName: preset.voiceId, text },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      return {
        ok: true,
        reason: 'played',
        audio: result.audio,
        mimeType: result.mimeType,
        text,
      };
    } catch {
      return controller.signal.aborted
        ? { ok: false, reason: 'cancelled' }
        : { ok: false, reason: 'failed', message: '试听失败，可重试；不影响继续设置。' };
    } finally {
      signal.removeEventListener('abort', abort);
      if (this.current === controller) this.current = undefined;
    }
  }

  /** Cancels an in-flight preview; safe to call when nothing is running. */
  public stop(): void {
    this.current?.abort();
    this.current = undefined;
  }
}
