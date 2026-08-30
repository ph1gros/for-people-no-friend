import {
  speechDataDestination,
  OpenAICompatibleSpeechAdapter,
} from '../../adapters/speech/openai-compatible-tts';
import {
  OpenAICompatibleTranscriptionAdapter,
  resolveSpeechTranscriptionUrl,
  transcriptionDataDestination,
} from '../../adapters/speech/openai-compatible-asr';
import {
  DEFAULT_SPEECH_SETTINGS,
  SPEECH_AUDIO_FORMATS,
  type SpeechOperationResult,
  type SpeechSettings,
  type SpeechStatus,
  type SpeechSynthesisInput,
  type SpeechSynthesisResult,
  type SpeechTranscriptionInput,
  type SpeechTranscriptionResult,
} from '../../shared/speech-ipc';
import type { SecretStore } from '../security/secret-store';
import type { SpeechConfigStore } from '../storage/speech-config-store';

const SPEECH_SECRET_ID = 'speech-openai-compatible';
const containsHanCharacters = (value: string): boolean => /[㐀-鿿]/u.test(value);
const japaneseKanaCount = (value: string): number => value.match(/[ぁ-ゖァ-ヺ]/gu)?.length ?? 0;

const JAPANESE_LATIN_LETTER_NAMES: Readonly<Record<string, string>> = Object.freeze({
  A: 'エー',
  B: 'ビー',
  C: 'シー',
  D: 'ディー',
  E: 'イー',
  F: 'エフ',
  G: 'ジー',
  H: 'エイチ',
  I: 'アイ',
  J: 'ジェー',
  K: 'ケー',
  L: 'エル',
  M: 'エム',
  N: 'エヌ',
  O: 'オー',
  P: 'ピー',
  Q: 'キュー',
  R: 'アール',
  S: 'エス',
  T: 'ティー',
  U: 'ユー',
  V: 'ブイ',
  W: 'ダブリュー',
  X: 'エックス',
  Y: 'ワイ',
  Z: 'ゼット',
});

const japaneseLetterName = (letter: string): string =>
  JAPANESE_LATIN_LETTER_NAMES[letter.toUpperCase()] ?? letter;

export const normalizeJapaneseSpeechText = (value: string): string =>
  value
    .replace(/^[\s…⋯]+/u, '')
    .replace(/([。！？!?])\s*[…⋯]+/gu, '$1')
    .replace(/[.…⋯]{2,}/gu, '、')
    .replace(
      /(?<![A-Za-z])([A-Za-z])['′](?![A-Za-z])/gu,
      (_match, letter: string) => `${japaneseLetterName(letter)}ダッシュ`,
    )
    .replace(/(?<![A-Za-z])([A-Za-z])(?![A-Za-z])/gu, (_match, letter: string) =>
      japaneseLetterName(letter),
    )
    .replace(/、{2,}/gu, '、')
    .trim();

export type SpeechTextTranslator = (text: string, signal: AbortSignal) => Promise<string>;
export type EnsureBundledSpeechRuntime = () => Promise<boolean>;

export class SpeechService {
  private readonly activeRequests = new Map<string, AbortController>();

  public constructor(
    private readonly store: SpeechConfigStore,
    private readonly secrets: SecretStore,
    private readonly adapter: OpenAICompatibleSpeechAdapter,
    private readonly transcriptionAdapter?: OpenAICompatibleTranscriptionAdapter,
    private readonly translateToJapanese?: SpeechTextTranslator,
    private readonly ensureBundledRuntime?: EnsureBundledSpeechRuntime,
  ) {}

  public async getStatus(): Promise<SpeechStatus> {
    const settings = await this.store.get().catch(() => ({ ...DEFAULT_SPEECH_SETTINGS }));
    let dataDestination: 'none' | 'this-device' | 'remote-service' = 'none';
    let endpointValid = settings.providerId === 'disabled';
    if (settings.providerId === 'openai-compatible') {
      try {
        dataDestination = speechDataDestination(settings.baseUrl);
        endpointValid = true;
      } catch {
        endpointValid = false;
      }
    }
    const configured =
      settings.providerId === 'openai-compatible' &&
      endpointValid &&
      Boolean(settings.modelId.trim()) &&
      Boolean(settings.voiceId.trim());
    let inputDataDestination: 'none' | 'this-device' | 'remote-service' = 'none';
    let inputEndpointValid = false;
    try {
      resolveSpeechTranscriptionUrl(settings.transcriptionBaseUrl);
      inputDataDestination = transcriptionDataDestination(settings.transcriptionBaseUrl);
      inputEndpointValid = true;
    } catch {
      // Keep speech input unavailable when the configured endpoint is invalid.
    }
    const inputConfigured = inputEndpointValid && Boolean(settings.transcriptionModelId.trim());
    const inputAvailable =
      settings.inputEnabled && inputConfigured && this.transcriptionAdapter !== undefined;
    return {
      settings,
      apiKeySaved: await this.secrets.has(SPEECH_SECRET_ID).catch(() => false),
      output: {
        providerId: settings.providerId,
        displayName: settings.providerId === 'openai-compatible' ? 'OpenAI 兼容语音' : '未启用',
        configured,
        available: settings.enabled && configured,
        transport: settings.providerId === 'openai-compatible' ? 'rest' : 'none',
        dataDestination,
        supportsStreamingInput: false,
        supportedFormats: [...SPEECH_AUDIO_FORMATS],
        detail: !endpointValid
          ? '语音接口地址无效，语音保持关闭；文字聊天不受影响。'
          : settings.providerId === 'disabled'
            ? '语音输出默认关闭，文字聊天不受影响。'
            : dataDestination === 'this-device'
              ? `声音来源：本机兼容服务的“${settings.voiceId}”；数据去向：仅本机接口。失败会保留完整文字回复。`
              : `声音来源：远端兼容服务的“${settings.voiceId}”；数据去向：你配置的远端接口。失败会保留完整文字回复。`,
      },
      input: {
        available: inputAvailable,
        modes: inputAvailable ? ['full', 'half', 'manual'] : [],
        dataDestination: inputDataDestination,
        detail: !inputEndpointValid
          ? '中文语音识别接口地址无效，麦克风保持关闭。'
          : !settings.inputEnabled
            ? '中文麦克风输入默认关闭；开启后可选择完全、精准或手动模式。'
            : !this.transcriptionAdapter
              ? '中文语音识别适配器不可用。'
              : inputDataDestination === 'this-device'
                ? settings.inputMode === 'manual'
                  ? `中文录音只发送到本机识别服务；点击录音或按住 ${settings.pushToTalkKey}，结果只填入输入框。`
                  : `中文录音只发送到本机识别服务；${settings.inputMode === 'full' ? '识别到完整一句话就会自动发送' : '说“小猫 + 内容”才会自动发送'}。`
                : settings.inputMode === 'manual'
                  ? `中文录音会发送到已配置的远端识别服务；点击录音或按住 ${settings.pushToTalkKey}，结果只填入输入框。`
                  : `检测到语音后，会将分段录音发送到已配置的远端识别服务；${settings.inputMode === 'full' ? '识别到完整一句话就会自动发送' : '说“小猫 + 内容”才会自动发送'}。`,
      },
    };
  }

  public async setSettings(settings: SpeechSettings): Promise<SpeechOperationResult> {
    try {
      if (settings.providerId === 'openai-compatible') {
        speechDataDestination(settings.baseUrl);
      }
      if (settings.inputEnabled) {
        transcriptionDataDestination(settings.transcriptionBaseUrl);
      }
      if (!settings.enabled && !settings.inputEnabled) this.cancelAll();
      await this.store.set(settings);
      return { ok: true };
    } catch {
      return { ok: false, message: '语音设置无效或无法保存。' };
    }
  }

  public async setSecret(apiKey: string): Promise<SpeechOperationResult> {
    try {
      await this.secrets.set(SPEECH_SECRET_ID, apiKey);
      return { ok: true };
    } catch {
      return { ok: false, message: '语音 API Key 无法安全保存。' };
    }
  }

  public async deleteSecret(): Promise<SpeechOperationResult> {
    try {
      await this.secrets.delete(SPEECH_SECRET_ID);
      return { ok: true };
    } catch {
      return { ok: false, message: '语音 API Key 删除失败。' };
    }
  }

  public async synthesize(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
    this.cancel(input.requestId);
    const controller = new AbortController();
    this.activeRequests.set(input.requestId, controller);
    try {
      const settings = await this.store.get();
      if (
        !settings.enabled ||
        settings.providerId !== 'openai-compatible' ||
        !settings.modelId ||
        !settings.voiceId
      ) {
        return {
          ok: false,
          requestId: input.requestId,
          cancelled: false,
          message: '语音输出尚未配置；文字回复仍可正常使用。',
        };
      }
      const apiKey = await this.secrets.get(SPEECH_SECRET_ID);
      if (
        settings.baseUrl === DEFAULT_SPEECH_SETTINGS.baseUrl &&
        settings.modelId === 'ireina' &&
        settings.voiceId === 'ireina' &&
        this.ensureBundledRuntime &&
        !(await this.ensureBundledRuntime())
      ) {
        return {
          ok: false,
          requestId: input.requestId,
          cancelled: false,
          message: '内置日语语音尚未就绪；文字回复仍会保留。',
        };
      }
      const translatedText =
        containsHanCharacters(input.text) && japaneseKanaCount(input.text) < 2
          ? await this.translateToJapanese?.(input.text, controller.signal)
          : input.text;
      const spokenText = translatedText ? normalizeJapaneseSpeechText(translatedText) : '';
      if (!spokenText) {
        return {
          ok: false,
          requestId: input.requestId,
          cancelled: false,
          message: '日语转换失败；已停止错误语音，文字回复仍会保留。',
        };
      }
      const result = await this.adapter.synthesize(
        {
          baseUrl: settings.baseUrl,
          apiKey,
          modelId: settings.modelId,
          voiceId: settings.voiceId,
          responseFormat: settings.responseFormat,
          speed: settings.speed,
          text: spokenText,
        },
        controller.signal,
      );
      if (controller.signal.aborted) {
        return {
          ok: false,
          requestId: input.requestId,
          cancelled: true,
          message: '语音生成已取消。',
        };
      }
      return {
        ok: true,
        requestId: input.requestId,
        audio: result.audio,
        mimeType: result.mimeType,
        text: spokenText,
      };
    } catch {
      return {
        ok: false,
        requestId: input.requestId,
        cancelled: controller.signal.aborted,
        message: controller.signal.aborted
          ? '语音生成已取消。'
          : '语音生成失败；文字回复仍可正常使用。',
      };
    } finally {
      if (this.activeRequests.get(input.requestId) === controller) {
        this.activeRequests.delete(input.requestId);
      }
    }
  }

  public async transcribe(input: SpeechTranscriptionInput): Promise<SpeechTranscriptionResult> {
    this.cancel(input.requestId);
    const controller = new AbortController();
    this.activeRequests.set(input.requestId, controller);
    try {
      const settings = await this.store.get();
      if (!settings.inputEnabled || !settings.transcriptionModelId || !this.transcriptionAdapter) {
        return {
          ok: false,
          requestId: input.requestId,
          cancelled: false,
          message: '中文语音识别尚未配置。',
        };
      }
      const result = await this.transcriptionAdapter.transcribe(
        {
          ...input,
          baseUrl: settings.transcriptionBaseUrl,
          apiKey: await this.secrets.get(SPEECH_SECRET_ID),
          modelId: settings.transcriptionModelId,
          language: settings.transcriptionLanguage,
        },
        controller.signal,
      );
      if (controller.signal.aborted) {
        return {
          ok: false,
          requestId: input.requestId,
          cancelled: true,
          message: '语音识别已取消。',
        };
      }
      return { ok: true, requestId: input.requestId, text: result.text };
    } catch {
      return {
        ok: false,
        requestId: input.requestId,
        cancelled: controller.signal.aborted,
        message: controller.signal.aborted ? '语音识别已取消。' : '中文语音识别失败。',
      };
    } finally {
      if (this.activeRequests.get(input.requestId) === controller) {
        this.activeRequests.delete(input.requestId);
      }
    }
  }

  public cancel(requestId: string): boolean {
    const controller = this.activeRequests.get(requestId);
    if (!controller) return false;
    this.activeRequests.delete(requestId);
    controller.abort('cancelled');
    return true;
  }

  public cancelAll(): void {
    for (const controller of this.activeRequests.values()) controller.abort('cancelled');
    this.activeRequests.clear();
  }

  public dispose(): void {
    this.cancelAll();
  }
}
