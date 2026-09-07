import { BUNDLED_RESOURCE_CATALOG, RESOURCE_DEFINITIONS } from '../../shared/resource-catalog';
import {
  setupResourceIds,
  SETUP_VOICE_ASSETS,
  type SetupResourceStatus,
  type SetupResourceControl,
} from '../../shared/setup-resources';
import type { SetupSelections } from '../../core/setup/setup-flow';
import { BUNDLED_IREINA_SPEECH_PRESET, GENIE_VOICE_PRESETS } from '../../shared/speech-ipc';
import { SPEECH_ASSET_INTEGRITY } from '../speech/speech-asset-integrity';
import type { ResourceCenter } from '../resources/resource-center';
import type { SpeechAssetManager } from '../speech/speech-asset-manager';
import type { SpeechConfigStore } from '../storage/speech-config-store';

export class SetupResourceService {
  public constructor(
    private readonly center: Pick<ResourceCenter, 'getStatus'>,
    private readonly downloads: Pick<SpeechAssetManager, 'control'>,
    private readonly settings: Pick<SpeechConfigStore, 'get' | 'set'>,
  ) {}

  public async getStatus(): Promise<SetupResourceStatus> {
    const status = await this.center.getStatus();
    return {
      downloads: status.downloads,
      resources: BUNDLED_RESOURCE_CATALOG.resources.map((entry) => {
        const pin = SPEECH_ASSET_INTEGRITY[entry.id];
        const metadata = status.catalog.resources.find((r) => r.id === entry.id) ?? entry;
        return {
          id: entry.id,
          name: metadata.name,
          license: RESOURCE_DEFINITIONS[entry.id].usageRestriction ?? metadata.license,
          language: RESOURCE_DEFINITIONS[entry.id].language,
          downloadBytes: pin?.compressedBytes ?? 0,
          installedBytes: pin?.extractedBytes ?? 0,
          available: Boolean(pin && status.downloads.tiers.some((t) => t.id === entry.id)),
        };
      }),
    };
  }

  public async control(
    selections: SetupSelections,
    input: SetupResourceControl,
    signal: AbortSignal,
  ): Promise<void> {
    const status = await this.getStatus();
    signal.throwIfAborted();
    const ids = setupResourceIds(selections);
    const starting = input.action === 'start' || input.action === 'resume';
    if (starting && ids.some((id) => !status.resources.find((r) => r.id === id)?.available)) {
      throw new Error('所选组件暂不可下载。可重试或跳过，稍后在资源中心处理。');
    }
    for (const id of ids) {
      signal.throwIfAborted();
      const tier = status.downloads.tiers.find((t) => t.id === id);
      if (tier?.state === 'ready') continue;
      if (!starting && tier?.state !== 'downloading') continue;
      await this.downloads.control(
        {
          tierId: id,
          action: starting ? (input.action as 'start' | 'resume') : 'pause',
        },
        { allowMetered: input.allowMetered, signal },
      );
    }
  }

  public async requireReady(selections: SetupSelections): Promise<void> {
    const ids = setupResourceIds(selections);
    if (!ids.length) return;
    const status = await this.getStatus();
    if (ids.some((id) => status.downloads.tiers.find((t) => t.id === id)?.state !== 'ready')) {
      throw new Error('组件尚未通过完整校验。请等待、重试，或跳过语音组件。');
    }
  }

  public async apply(selections: SetupSelections, signal: AbortSignal): Promise<void> {
    if (!setupResourceIds(selections).length) return;
    await this.requireReady(selections);
    signal.throwIfAborted();
    const current = await this.settings.get();
    signal.throwIfAborted();
    // Resolve through the managed voice table so each Genie voice gets its own port and language
    // instead of every Genie option landing on Mika's preset.
    const genie = GENIE_VOICE_PRESETS.find(
      (candidate) => candidate.assetId === SETUP_VOICE_ASSETS[selections.voice],
    );
    const preset = genie ?? BUNDLED_IREINA_SPEECH_PRESET;
    await this.settings.set({
      ...current,
      ...(selections.voice !== 'none'
        ? {
            enabled: true,
            providerId: preset.providerId,
            baseUrl: preset.baseUrl,
            modelId: preset.modelId,
            voiceId: preset.voiceId,
            language: preset.language,
            responseFormat: preset.responseFormat,
            speed: preset.speed,
          }
        : {}),
      ...(selections.speechInput
        ? {
            inputEnabled: true,
            inputMode: 'manual' as const,
            transcriptionBaseUrl: 'http://127.0.0.1:9880/v1',
            transcriptionModelId: 'SenseVoiceSmall',
            transcriptionLanguage: 'zh-CN',
          }
        : {}),
    });
  }
}
