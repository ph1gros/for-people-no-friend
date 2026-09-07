import type {
  CharacterPackageFileResult,
  ConfirmCharacterPackageImportInput,
} from '../../shared/character-package-ipc';
import type { Live2DModelImportResult } from '../../shared/live2d-model-ipc';
import type {
  ConfigurableProviderId,
  ModelOperationResult,
  TestProviderConnectionInput,
  TestProviderConnectionResult,
} from '../../shared/model-ipc';
import type {
  ApplySetupProviderInput,
  SetupCharacterStatus,
  SetupProviderOption,
  SetupProviderStatus,
} from '../../shared/setup-ipc';
import type { SetupCharacterSource } from '../../core/setup/setup-flow';
import {
  confirmCharacterPackageImport,
  importLive2DModelFile,
  previewCharacterPackageFile,
  type CharacterImportDependencies,
} from '../character/character-import-operations';

/** The slice of the model runtime the wizard is allowed to touch. */
export interface SetupModelRuntime {
  getConfiguration(): Promise<{
    openAICompatibleBaseUrl: string;
    allowRemoteComplexTasks: boolean;
  }>;
  setConfiguration(configuration: {
    openAICompatibleBaseUrl: string;
    allowRemoteComplexTasks: boolean;
  }): Promise<void>;
  getConversationConfiguration(): Promise<{
    selection?: { providerId: string; modelId: string };
  }>;
  setConversationConfiguration(configuration: {
    selection?: { providerId: string; modelId: string };
  }): Promise<void>;
  getSecretStatus(): Promise<{ [provider in ConfigurableProviderId]: boolean }>;
  setSecret(providerId: ConfigurableProviderId, apiKey: string): Promise<void>;
  testConnection(input: TestProviderConnectionInput): Promise<TestProviderConnectionResult>;
  cancel(requestId: string): boolean;
}

export interface SetupCharacterLibrary {
  list(): Promise<Array<{ profile: { name: string }; active: boolean; imported: boolean }>>;
  getActiveModelManifest(): Promise<string | undefined>;
}

export interface SetupServiceDependencies {
  models?: SetupModelRuntime;
  characterLibrary?: SetupCharacterLibrary;
  characterImports: CharacterImportDependencies;
  live2DModelManifest?: () => Promise<string | undefined>;
  placeholderCharacterName: string;
}

export const SETUP_PROVIDER_OPTIONS: readonly SetupProviderOption[] = Object.freeze([
  { id: 'openai-compatible', displayName: 'OpenAI 兼容服务', requiresBaseUrl: true },
  { id: 'deepseek', displayName: 'DeepSeek', requiresBaseUrl: false },
  { id: 'anthropic', displayName: 'Anthropic', requiresBaseUrl: false },
]);

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const CONFIGURABLE_PROVIDER_IDS = new Set<string>(
  SETUP_PROVIDER_OPTIONS.map((option) => option.id),
);

const isConfigurableProvider = (value: string): value is ConfigurableProviderId =>
  CONFIGURABLE_PROVIDER_IDS.has(value);

/**
 * Adapts the wizard to the services the main application already owns.
 *
 * Setup writes through the same provider configuration, secret store and character import
 * paths as the settings panel; it never introduces a second credential or import path, and it
 * never returns a stored key to the renderer.
 */
export class SetupServices {
  private signal: AbortSignal | undefined;
  public constructor(private readonly dependencies: SetupServiceDependencies) {}
  public useSession(signal: AbortSignal): void {
    this.signal = signal;
  }

  public async getProviderStatus(): Promise<SetupProviderStatus> {
    const models = this.dependencies.models;
    if (!models) {
      return {
        options: [...SETUP_PROVIDER_OPTIONS],
        providerId: 'openai-compatible',
        baseUrl: DEFAULT_BASE_URL,
        modelId: '',
        configuredProviders: [],
        hasSecret: false,
      };
    }
    const [configuration, conversation, secrets] = await Promise.all([
      models.getConfiguration(),
      models.getConversationConfiguration(),
      models.getSecretStatus(),
    ]);
    const configuredProviders = Object.entries(secrets)
      .filter(([providerId, configured]) => configured && isConfigurableProvider(providerId))
      .map(([providerId]) => providerId as ConfigurableProviderId);
    const selected = conversation.selection?.providerId;
    const providerId: ConfigurableProviderId =
      selected && isConfigurableProvider(selected)
        ? selected
        : (configuredProviders[0] ?? 'openai-compatible');
    return {
      options: [...SETUP_PROVIDER_OPTIONS],
      providerId,
      baseUrl: configuration.openAICompatibleBaseUrl,
      modelId: conversation.selection?.modelId ?? '',
      configuredProviders,
      hasSecret: secrets[providerId] === true,
    };
  }

  /**
   * Stores the endpoint, key and conversation model through the existing services. The key is
   * only written when the page actually supplied a new one.
   */
  public async applyProvider(input: ApplySetupProviderInput): Promise<ModelOperationResult> {
    const models = this.dependencies.models;
    if (!models) {
      return {
        ok: false,
        error: { code: 'configuration', message: '模型服务不可用。', retryable: false },
      };
    }
    try {
      this.signal?.throwIfAborted();
      if (input.baseUrl && input.providerId === 'openai-compatible') {
        const configuration = await models.getConfiguration();
        this.signal?.throwIfAborted();
        await models.setConfiguration({
          ...configuration,
          openAICompatibleBaseUrl: input.baseUrl,
        });
      }
      if (input.apiKey) {
        this.signal?.throwIfAborted();
        await models.setSecret(input.providerId, input.apiKey);
      }
      this.signal?.throwIfAborted();
      await models.setConversationConfiguration({
        selection: { providerId: input.providerId, modelId: input.modelId },
      });
      return { ok: true };
    } catch {
      return {
        ok: false,
        error: {
          code: 'configuration',
          message: '模型服务商设置未能保存，可稍后在设置中重试。',
          retryable: false,
        },
      };
    }
  }

  public async testProvider(
    input: TestProviderConnectionInput,
  ): Promise<TestProviderConnectionResult> {
    const models = this.dependencies.models;
    if (!models) {
      return {
        ok: false,
        error: { code: 'configuration', message: '模型服务不可用。', retryable: false },
      };
    }
    return models.testConnection(input);
  }

  public cancelProviderTest(requestId: string): boolean {
    return this.dependencies.models?.cancel(requestId) ?? false;
  }

  public async getCharacterStatus(): Promise<SetupCharacterStatus> {
    const entries = (await this.dependencies.characterLibrary?.list()) ?? [];
    const imported = entries.filter((entry) => entry.imported);
    const active = entries.find((entry) => entry.active);
    const live2DManifest = await this.dependencies.live2DModelManifest?.();
    const source: SetupCharacterSource = imported.some((entry) => entry.active)
      ? 'package'
      : live2DManifest
        ? 'live2d'
        : 'placeholder';
    return {
      source,
      activeCharacterName: active?.profile.name ?? this.dependencies.placeholderCharacterName,
      importedCharacterCount: imported.length,
      hasLive2DModel: Boolean(live2DManifest),
    };
  }

  public previewCharacterPackage(): Promise<CharacterPackageFileResult> {
    return previewCharacterPackageFile({
      ...this.dependencies.characterImports,
      isActive: () => !this.signal?.aborted,
    });
  }

  public confirmCharacterPackage(
    input: ConfirmCharacterPackageImportInput,
  ): Promise<CharacterPackageFileResult> {
    this.signal?.throwIfAborted();
    return confirmCharacterPackageImport(this.dependencies.characterImports, input);
  }

  public importLive2DModel(): Promise<Live2DModelImportResult> {
    return importLive2DModelFile({
      ...this.dependencies.characterImports,
      isActive: () => !this.signal?.aborted,
    });
  }
}
