import {
  speechDataDestination,
  OpenAICompatibleSpeechAdapter,
} from '../../adapters/speech/openai-compatible-tts';
import { FISH_AUDIO_BASE_URL, FishAudioSpeechAdapter } from '../../adapters/speech/fish-audio-tts';
import { GenieTtsAdapter, resolveGenieTtsUrl } from '../../adapters/speech/genie-tts';
import {
  OpenAICompatibleTranscriptionAdapter,
  resolveSpeechTranscriptionUrl,
  transcriptionDataDestination,
} from '../../adapters/speech/openai-compatible-asr';
import {
  BUNDLED_IREINA_SPEECH_PRESET,
  DEFAULT_SPEECH_SETTINGS,
  SPEECH_AUDIO_FORMATS,
  type SpeechOperationResult,
  type SpeechSettings,
  type SpeechProviderId,
  type SpeechStatus,
  type SpeechSynthesisInput,
  type SpeechSynthesisResult,
  type SpeechTranscriptionInput,
  type SpeechTranscriptionResult,
} from '../../shared/speech-ipc';
import type { SecretStore } from '../security/secret-store';
import type { SpeechConfigStore } from '../storage/speech-config-store';

const OPENAI_COMPATIBLE_SPEECH_SECRET_ID = 'speech-openai-compatible';
const speechSecretId = (providerId: SpeechProviderId): string | undefined =>
  providerId === 'fish-audio'
    ? 'speech-fish-audio'
    : providerId === 'openai-compatible'
      ? OPENAI_COMPATIBLE_SPEECH_SECRET_ID
      : undefined;

const providerDisplayName = (providerId: SpeechProviderId): string =>
  ({
    disabled: '未启用',
    'openai-compatible': 'OpenAI 兼容语音',
    'genie-tts': 'Genie-TTS 本地语音',
    'fish-audio': 'Fish Audio 在线语音',
  })[providerId];

const providerFormats = (providerId: SpeechProviderId) =>
  providerId === 'genie-tts'
    ? (['wav'] as const)
    : providerId === 'fish-audio'
      ? (['wav', 'mp3', 'opus'] as const)
      : providerId === 'openai-compatible'
        ? SPEECH_AUDIO_FORMATS
        : ([] as const);
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
export type SpeechInputReadinessProbe = (baseUrl: string) => Promise<boolean>;
export type EnsureBundledSpeechInputRuntime = () => Promise<boolean>;

export interface AdditionalSpeechAdapters {
  genieTts?: GenieTtsAdapter;
  fishAudio?: FishAudioSpeechAdapter;
}

export class SpeechService {
  private readonly activeRequests = new Map<string, AbortController>();

  public constructor(
    private readonly store: SpeechConfigStore,
    private readonly secrets: SecretStore,
    private readonly adapter: OpenAICompatibleSpeechAdapter,
    private readonly transcriptionAdapter?: OpenAICompatibleTranscriptionAdapter,
    private readonly translateToJapanese?: SpeechTextTranslator,
    private readonly ensureBundledRuntime?: EnsureBundledSpeechRuntime,
    private readonly additionalAdapters: AdditionalSpeechAdapters = {},
    private readonly inputReadinessProbe?: SpeechInputReadinessProbe,
    private readonly ensureBundledInputRuntime?: EnsureBundledSpeechInputRuntime,
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
    } else if (settings.providerId === 'genie-tts') {
      try {
        resolveGenieTtsUrl(settings.baseUrl);
        dataDestination = 'this-device';
        endpointValid = true;
      } catch {
        endpointValid = false;
      }
    } else if (settings.providerId === 'fish-audio') {
      endpointValid = settings.baseUrl.replace(/\/+$/gu, '') === FISH_AUDIO_BASE_URL;
      dataDestination = 'remote-service';
    }
    const secretId = speechSecretId(settings.providerId);
    const apiKeySaved = secretId ? await this.secrets.has(secretId).catch(() => false) : false;
    const adapterAvailable =
      settings.providerId === 'openai-compatible' ||
      (settings.providerId === 'genie-tts' && Boolean(this.additionalAdapters.genieTts)) ||
      (settings.providerId === 'fish-audio' && Boolean(this.additionalAdapters.fishAudio));
    const configured =
      settings.providerId !== 'disabled' &&
      endpointValid &&
      adapterAvailable &&
      Boolean(settings.modelId.trim()) &&
      Boolean(settings.voiceId.trim()) &&
      (settings.providerId !== 'fish-audio' || apiKeySaved);
    const bundledLocalVoiceSelected =
      settings.providerId === 'openai-compatible' &&
      settings.baseUrl === BUNDLED_IREINA_SPEECH_PRESET.baseUrl &&
      settings.modelId === BUNDLED_IREINA_SPEECH_PRESET.modelId &&
      settings.voiceId === BUNDLED_IREINA_SPEECH_PRESET.voiceId &&
      settings.language === BUNDLED_IREINA_SPEECH_PRESET.language;
    const bundledLocalVoiceReady =
      !bundledLocalVoiceSelected || !settings.enabled || !configured
        ? true
        : await this.ensureBundledRuntime?.().catch(() => false);
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
    if (
      inputDataDestination === 'this-device' &&
      settings.inputEnabled &&
      inputConfigured &&
      this.transcriptionAdapter
    ) {
      await this.ensureBundledInputRuntime?.().catch(() => false);
    }
    const localInputServiceReady =
      inputDataDestination !== 'this-device' ||
      !settings.inputEnabled ||
      !inputConfigured ||
      !this.transcriptionAdapter
        ? true
        : await this.inputReadinessProbe?.(settings.transcriptionBaseUrl).catch(() => false);
    const inputAvailable =
      settings.inputEnabled &&
      inputConfigured &&
      this.transcriptionAdapter !== undefined &&
      localInputServiceReady === true;
    return {
      settings,
      apiKeySaved,
      output: {
        providerId: settings.providerId,
        displayName: providerDisplayName(settings.providerId),
        configured,
        available: settings.enabled && configured && bundledLocalVoiceReady === true,
        transport: settings.providerId === 'disabled' ? 'none' : 'rest',
        dataDestination,
        supportsStreamingInput: false,
        supportedFormats: [...providerFormats(settings.providerId)],
        detail: !endpointValid
          ? '语音接口地址无效，语音保持关闭；文字聊天不受影响。'
          : settings.providerId === 'disabled'
            ? '语音输出默认关闭，文字聊天不受影响。'
            : settings.providerId === 'fish-audio' && !apiKeySaved
              ? 'Fish Audio API Key 尚未保存，文字不会发送到远端。'
              : bundledLocalVoiceSelected && bundledLocalVoiceReady !== true
                ? '本机 Style-Bert-VITS2 运行时未就绪；文字回复仍可正常使用。'
                : dataDestination === 'this-device'
                  ? `声音来源：本机 ${providerDisplayName(settings.providerId)} 的“${settings.voiceId}”；数据去向：仅本机接口。失败会保留完整文字回复。`
                  : `声音来源：${providerDisplayName(settings.providerId)} 的“${settings.voiceId}”；文字会发送到 Fish Audio。失败会保留完整文字回复。`,
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
              : inputDataDestination === 'this-device' && !localInputServiceReady
                ? '本机语音识别服务未安装或未启动；文字聊天和语音输出不受影响。'
                : inputDataDestination === 'this-device'
                  ? settings.inputMode === 'manual'
                    ? `中文录音只发送到本机识别服务；点击录音或按住 ${settings.pushToTalkKey}，结果只填入输入框。`
                    : `中文录音只发送到本机识别服务；${settings.inputMode === 'full' ? '识别到完整一句话就会自动发送' : '先说已设置的精准称呼才会自动发送'}。`
                  : settings.inputMode === 'manual'
                    ? `中文录音会发送到已配置的远端识别服务；点击录音或按住 ${settings.pushToTalkKey}，结果只填入输入框。`
                    : `检测到语音后，会将分段录音发送到已配置的远端识别服务；${settings.inputMode === 'full' ? '识别到完整一句话就会自动发送' : '先说已设置的精准称呼才会自动发送'}。`,
      },
    };
  }

  public async setSettings(settings: SpeechSettings): Promise<SpeechOperationResult> {
    try {
      if (settings.providerId === 'openai-compatible') {
        speechDataDestination(settings.baseUrl);
      } else if (settings.providerId === 'genie-tts') {
        resolveGenieTtsUrl(settings.baseUrl);
        if (settings.responseFormat !== 'wav') throw new Error('Genie-TTS 只支持 WAV。');
      } else if (settings.providerId === 'fish-audio') {
        if (settings.baseUrl.replace(/\/+$/gu, '') !== FISH_AUDIO_BASE_URL) {
          throw new Error('Fish Audio 地址不可更改。');
        }
        if (!['s1', 's2-pro'].includes(settings.modelId)) throw new Error('Fish Audio 模型无效。');
        if (!['wav', 'mp3', 'opus'].includes(settings.responseFormat)) {
          throw new Error('Fish Audio 音频格式无效。');
        }
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
      const secretId = speechSecretId((await this.store.get()).providerId);
      if (!secretId) throw new Error('The selected provider does not use an API key.');
      await this.secrets.set(secretId, apiKey);
      return { ok: true };
    } catch {
      return { ok: false, message: '语音 API Key 无法安全保存。' };
    }
  }

  public async deleteSecret(): Promise<SpeechOperationResult> {
    try {
      const secretId = speechSecretId((await this.store.get()).providerId);
      if (!secretId) return { ok: true };
      await this.secrets.delete(secretId);
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
        settings.providerId === 'disabled' ||
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
      const selectedSecretId = speechSecretId(settings.providerId);
      const apiKey = selectedSecretId ? await this.secrets.get(selectedSecretId) : undefined;
      if (
        settings.providerId === 'openai-compatible' &&
        settings.baseUrl === BUNDLED_IREINA_SPEECH_PRESET.baseUrl &&
        settings.modelId === BUNDLED_IREINA_SPEECH_PRESET.modelId &&
        settings.voiceId === BUNDLED_IREINA_SPEECH_PRESET.voiceId &&
        settings.language === BUNDLED_IREINA_SPEECH_PRESET.language &&
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
      const japaneseOutput = settings.language.toLowerCase().startsWith('ja');
      const translatedText =
        japaneseOutput && containsHanCharacters(input.text) && japaneseKanaCount(input.text) < 2
          ? await this.translateToJapanese?.(input.text, controller.signal)
          : input.text;
      const spokenText = translatedText
        ? japaneseOutput
          ? normalizeJapaneseSpeechText(translatedText)
          : translatedText.trim()
        : '';
      if (!spokenText) {
        return {
          ok: false,
          requestId: input.requestId,
          cancelled: false,
          message: '日语转换失败；已停止错误语音，文字回复仍会保留。',
        };
      }
      const result =
        settings.providerId === 'genie-tts'
          ? await this.additionalAdapters.genieTts!.synthesize(
              {
                baseUrl: settings.baseUrl,
                characterName: settings.voiceId,
                text: spokenText,
              },
              controller.signal,
            )
          : settings.providerId === 'fish-audio'
            ? await this.additionalAdapters.fishAudio!.synthesize(
                {
                  apiKey,
                  modelId: settings.modelId,
                  referenceId: settings.voiceId,
                  responseFormat: settings.responseFormat,
                  speed: settings.speed,
                  text: spokenText,
                },
                controller.signal,
              )
            : await this.adapter.synthesize(
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
          apiKey: await this.secrets.get(OPENAI_COMPATIBLE_SPEECH_SECRET_ID),
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
