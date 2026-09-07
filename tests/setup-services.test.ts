import { describe, expect, it, vi } from 'vitest';

import {
  SETUP_PROVIDER_OPTIONS,
  SetupServices,
  type SetupModelRuntime,
} from '../src/main/setup/setup-services';
import type { CharacterImportDependencies } from '../src/main/character/character-import-operations';

interface FakeModelState {
  baseUrl: string;
  allowRemoteComplexTasks: boolean;
  selection?: { providerId: string; modelId: string };
  secrets: Record<string, string>;
  tested: unknown[];
  cancelled: string[];
}

const createFakeModels = (
  overrides: Partial<FakeModelState> = {},
): { runtime: SetupModelRuntime; state: FakeModelState } => {
  const state: FakeModelState = {
    baseUrl: 'https://api.openai.com/v1',
    allowRemoteComplexTasks: false,
    secrets: {},
    tested: [],
    cancelled: [],
    ...overrides,
  };
  const runtime: SetupModelRuntime = {
    getConfiguration: async () => ({
      openAICompatibleBaseUrl: state.baseUrl,
      allowRemoteComplexTasks: state.allowRemoteComplexTasks,
    }),
    setConfiguration: async (configuration) => {
      state.baseUrl = configuration.openAICompatibleBaseUrl;
      state.allowRemoteComplexTasks = configuration.allowRemoteComplexTasks;
    },
    getConversationConfiguration: async () =>
      state.selection ? { selection: state.selection } : {},
    setConversationConfiguration: async (configuration) => {
      state.selection = configuration.selection;
    },
    getSecretStatus: async () => ({
      anthropic: Boolean(state.secrets.anthropic),
      deepseek: Boolean(state.secrets.deepseek),
      'openai-compatible': Boolean(state.secrets['openai-compatible']),
    }),
    setSecret: async (providerId, apiKey) => {
      state.secrets[providerId] = apiKey;
    },
    testConnection: async (input) => {
      state.tested.push(input);
      return { ok: true, latencyMs: 12 };
    },
    cancel: (requestId) => {
      state.cancelled.push(requestId);
      return true;
    },
  };
  return { runtime, state };
};

const emptyImports: CharacterImportDependencies = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
};

describe('setup provider configuration', () => {
  it('describes the current endpoint and stored key without returning the key', async () => {
    const { runtime, state } = createFakeModels({
      baseUrl: 'https://example.invalid/v1',
      selection: { providerId: 'deepseek', modelId: 'deepseek-chat' },
      secrets: { deepseek: 'stored-key' },
    });
    const services = new SetupServices({
      models: runtime,
      characterImports: emptyImports,
      placeholderCharacterName: '桌宠',
    });

    const status = await services.getProviderStatus();

    expect(status).toEqual({
      options: [...SETUP_PROVIDER_OPTIONS],
      providerId: 'deepseek',
      baseUrl: 'https://example.invalid/v1',
      modelId: 'deepseek-chat',
      configuredProviders: ['deepseek'],
      hasSecret: true,
    });
    expect(JSON.stringify(status)).not.toContain(state.secrets.deepseek);
  });

  it('falls back to a configurable provider when the stored selection is unknown', async () => {
    const { runtime } = createFakeModels({
      selection: { providerId: 'local-experiment', modelId: 'x' },
      secrets: { anthropic: 'k' },
    });
    const services = new SetupServices({
      models: runtime,
      characterImports: emptyImports,
      placeholderCharacterName: '桌宠',
    });

    await expect(services.getProviderStatus()).resolves.toMatchObject({
      providerId: 'anthropic',
      configuredProviders: ['anthropic'],
    });
  });

  it('writes the endpoint, key and model through the existing stores', async () => {
    const { runtime, state } = createFakeModels();
    const services = new SetupServices({
      models: runtime,
      characterImports: emptyImports,
      placeholderCharacterName: '桌宠',
    });

    await expect(
      services.applyProvider({
        providerId: 'openai-compatible',
        baseUrl: 'https://gateway.invalid/v1',
        apiKey: 'secret-value',
        modelId: 'gpt-4o-mini',
      }),
    ).resolves.toEqual({ ok: true });

    expect(state.baseUrl).toBe('https://gateway.invalid/v1');
    expect(state.secrets['openai-compatible']).toBe('secret-value');
    expect(state.selection).toEqual({ providerId: 'openai-compatible', modelId: 'gpt-4o-mini' });
  });

  it('keeps a stored key when the page submits no new one', async () => {
    const { runtime, state } = createFakeModels({ secrets: { deepseek: 'existing' } });
    const services = new SetupServices({
      models: runtime,
      characterImports: emptyImports,
      placeholderCharacterName: '桌宠',
    });

    await services.applyProvider({ providerId: 'deepseek', modelId: 'deepseek-chat' });

    expect(state.secrets.deepseek).toBe('existing');
    expect(state.selection).toEqual({ providerId: 'deepseek', modelId: 'deepseek-chat' });
  });

  it('ignores a base URL for providers that do not expose an endpoint', async () => {
    const { runtime, state } = createFakeModels();
    const services = new SetupServices({
      models: runtime,
      characterImports: emptyImports,
      placeholderCharacterName: '桌宠',
    });

    await services.applyProvider({
      providerId: 'anthropic',
      baseUrl: 'https://attacker.invalid/v1',
      modelId: 'claude-sonnet-5',
    });

    expect(state.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('reports a failed write instead of throwing at the IPC boundary', async () => {
    const { runtime } = createFakeModels();
    runtime.setConversationConfiguration = async () => {
      throw new Error('disk full');
    };
    const services = new SetupServices({
      models: runtime,
      characterImports: emptyImports,
      placeholderCharacterName: '桌宠',
    });

    const result = await services.applyProvider({
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error.message).not.toContain('disk full');
  });

  it('delegates connection tests and cancellation to the model runtime', async () => {
    const { runtime, state } = createFakeModels();
    const services = new SetupServices({
      models: runtime,
      characterImports: emptyImports,
      placeholderCharacterName: '桌宠',
    });

    await expect(
      services.testProvider({
        requestId: 'setup-1',
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
      }),
    ).resolves.toEqual({ ok: true, latencyMs: 12 });
    expect(services.cancelProviderTest('setup-1')).toBe(true);
    expect(state.tested).toHaveLength(1);
    expect(state.cancelled).toEqual(['setup-1']);
  });

  it('degrades safely when the model runtime is unavailable', async () => {
    const services = new SetupServices({
      characterImports: emptyImports,
      placeholderCharacterName: '桌宠',
    });

    await expect(services.getProviderStatus()).resolves.toMatchObject({
      hasSecret: false,
      configuredProviders: [],
    });
    await expect(
      services.applyProvider({ providerId: 'deepseek', modelId: 'deepseek-chat' }),
    ).resolves.toMatchObject({ ok: false });
    expect(services.cancelProviderTest('setup-1')).toBe(false);
  });
});

describe('setup character status', () => {
  const services = (
    entries: Array<{ profile: { name: string }; active: boolean; imported: boolean }>,
    manifest?: string,
  ): SetupServices =>
    new SetupServices({
      characterLibrary: {
        list: async () => entries,
        getActiveModelManifest: async () => manifest,
      },
      ...(manifest === undefined ? {} : { live2DModelManifest: async () => manifest }),
      characterImports: emptyImports,
      placeholderCharacterName: '桌宠',
    });

  it('reports the placeholder when nothing was imported', async () => {
    await expect(
      services([{ profile: { name: '桌宠' }, active: true, imported: false }]).getCharacterStatus(),
    ).resolves.toEqual({
      source: 'placeholder',
      activeCharacterName: '桌宠',
      importedCharacterCount: 0,
      hasLive2DModel: false,
    });
  });

  it('reports an imported package as the active source', async () => {
    await expect(
      services([
        { profile: { name: '桌宠' }, active: false, imported: false },
        { profile: { name: '示例角色' }, active: true, imported: true },
      ]).getCharacterStatus(),
    ).resolves.toMatchObject({
      source: 'package',
      activeCharacterName: '示例角色',
      importedCharacterCount: 1,
    });
  });

  it('reports an imported Live2D model when no package is active', async () => {
    await expect(
      services(
        [{ profile: { name: '桌宠' }, active: true, imported: false }],
        'model.model3.json',
      ).getCharacterStatus(),
    ).resolves.toMatchObject({ source: 'live2d', hasLive2DModel: true });
  });

  it('routes imports through the shared character import path', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] as string[] }));
    const setupServices = new SetupServices({
      characterImports: { showOpenDialog },
      placeholderCharacterName: '桌宠',
    });

    await expect(setupServices.previewCharacterPackage()).resolves.toMatchObject({ ok: false });
    await expect(setupServices.importLive2DModel()).resolves.toMatchObject({ ok: false });
    expect(showOpenDialog).not.toHaveBeenCalled();
  });
});
