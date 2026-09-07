import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipcState = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => unknown) => {
      ipcState.handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      ipcState.handlers.delete(channel);
    },
  },
}));

import {
  SETUP_IPC_CHANNELS,
  registerSetupIpcHandlers,
  type SetupIpcController,
} from '../src/main/ipc/register-setup-ipc-handlers';
import { IPC_CHANNELS } from '../src/shared/ipc';
import {
  DEFAULT_SETUP_SELECTIONS,
  parseAdvanceSetupInput,
  parseApplySetupProviderInput,
  parseCompleteSetupInput,
  parseSetupSelections,
  type SetupViewState,
} from '../src/shared/setup-ipc';

const viewState: SetupViewState = {
  stepId: 'welcome',
  stepIndex: 0,
  visibleSteps: ['welcome', 'mode', 'provider', 'review', 'finish'],
  canGoBack: false,
  canGoNext: true,
  isFinalStep: false,
  selections: DEFAULT_SETUP_SELECTIONS,
  stateVersion: 1,
  rerun: false,
  appVersion: '1.7.0',
};

describe('setup IPC input validation', () => {
  it('accepts only the declared selection shape', () => {
    expect(
      parseSetupSelections({
        mode: 'custom',
        characterSource: 'live2d',
        launchAfterFinish: false,
      }),
    ).toEqual({
      mode: 'custom',
      characterSource: 'live2d',
      launchAfterFinish: false,
      voice: 'none',
      speechInput: false,
    });
    expect(() => parseSetupSelections({ ...DEFAULT_SETUP_SELECTIONS, mode: 'express' })).toThrow();
    expect(() =>
      parseSetupSelections({ ...DEFAULT_SETUP_SELECTIONS, characterSource: 'vtube' }),
    ).toThrow();
    expect(() =>
      parseSetupSelections({ ...DEFAULT_SETUP_SELECTIONS, launchAfterFinish: 'yes' }),
    ).toThrow();
    expect(() => parseSetupSelections({ mode: 'custom' })).toThrow();
    expect(() => parseSetupSelections(undefined)).toThrow();
    expect(() => parseSetupSelections([DEFAULT_SETUP_SELECTIONS])).toThrow();
  });

  it('validates the provider form and refuses a masked key', () => {
    expect(
      parseApplySetupProviderInput({
        providerId: 'openai-compatible',
        baseUrl: '  https://gateway.invalid/v1  ',
        apiKey: 'sk-example',
        modelId: '  gpt-4o-mini ',
      }),
    ).toEqual({
      providerId: 'openai-compatible',
      baseUrl: 'https://gateway.invalid/v1',
      apiKey: 'sk-example',
      modelId: 'gpt-4o-mini',
    });
    // A returning page may omit the key to keep the stored one.
    expect(
      parseApplySetupProviderInput({ providerId: 'deepseek', modelId: 'deepseek-chat' }),
    ).toEqual({ providerId: 'deepseek', modelId: 'deepseek-chat' });
    expect(() =>
      parseApplySetupProviderInput({ providerId: 'deepseek', modelId: 'x', apiKey: '****' }),
    ).toThrow();
    expect(() =>
      parseApplySetupProviderInput({ providerId: 'deepseek', modelId: 'x', apiKey: '   ' }),
    ).toThrow();
    expect(() => parseApplySetupProviderInput({ providerId: 'local', modelId: 'x' })).toThrow();
    expect(() => parseApplySetupProviderInput({ providerId: 'deepseek', modelId: '  ' })).toThrow();
    expect(() =>
      parseApplySetupProviderInput({ providerId: 'deepseek', modelId: 'x', baseUrl: '' }),
    ).toThrow();
    expect(() =>
      parseApplySetupProviderInput({
        providerId: 'deepseek',
        modelId: 'x',
        apiKey: 'k'.repeat(32_769),
      }),
    ).toThrow();
  });

  it('requires a selections envelope for navigation and completion', () => {
    expect(parseAdvanceSetupInput({ selections: DEFAULT_SETUP_SELECTIONS })).toEqual({
      selections: DEFAULT_SETUP_SELECTIONS,
    });
    expect(parseCompleteSetupInput({ selections: DEFAULT_SETUP_SELECTIONS })).toEqual({
      selections: DEFAULT_SETUP_SELECTIONS,
    });
    expect(() => parseAdvanceSetupInput(DEFAULT_SETUP_SELECTIONS)).toThrow();
    expect(() => parseCompleteSetupInput({})).toThrow();
    expect(() => parseCompleteSetupInput({ selections: { mode: 'custom' } })).toThrow();
  });
});

describe('setup IPC handlers', () => {
  const mainFrame = {};
  const webContents = { mainFrame };
  const window = { isDestroyed: () => false, webContents };
  const trustedEvent = { sender: webContents, senderFrame: mainFrame };

  let controller: SetupIpcController;
  let advanced: unknown;
  let completed: unknown;
  let applied: unknown;
  let dispose: () => void;

  beforeEach(() => {
    ipcState.handlers.clear();
    advanced = undefined;
    completed = undefined;
    applied = undefined;
    controller = {
      getResources: async () => ({
        resources: [],
        downloads: { sourceConfigured: false, busy: false, metered: false, tiers: [] },
      }),
      controlResources: async () => viewState,
      getWindow: () => window as never,
      getViewState: () => viewState,
      advance: (selections) => {
        advanced = selections;
        return viewState;
      },
      back: () => viewState,
      cancel: async () => true,
      complete: async (selections) => {
        completed = selections;
        return { completed: true, launchApp: true };
      },
      getProviderStatus: async () => ({
        options: [],
        providerId: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        modelId: 'deepseek-chat',
        configuredProviders: ['deepseek'],
        hasSecret: true,
      }),
      applyProvider: async (input) => {
        applied = input;
        return { ok: true };
      },
      testProvider: async () => ({ ok: true, latencyMs: 5 }),
      cancelProviderTest: () => true,
      getCharacterStatus: async () => ({
        source: 'placeholder',
        activeCharacterName: 'placeholder',
        importedCharacterCount: 0,
        hasLive2DModel: false,
      }),
      previewCharacterPackage: async () => ({ ok: true, canceled: true }),
      confirmCharacterPackage: async () => ({ ok: true, canceled: false }),
      importLive2DModel: async () => ({ ok: true, canceled: true }),
    };
    dispose = registerSetupIpcHandlers(controller);
  });

  const invoke = (channel: string, event: unknown, input?: unknown): unknown => {
    const handler = ipcState.handlers.get(channel);
    if (!handler) throw new Error(`Missing handler for ${channel}.`);
    return handler(event, input);
  };

  it('registers exactly the wizard channels', () => {
    expect([...ipcState.handlers.keys()]).toEqual([...SETUP_IPC_CHANNELS]);
  });

  it('serves the current view state to the setup window', () => {
    expect(invoke(IPC_CHANNELS.getSetupState, trustedEvent)).toEqual(viewState);
  });

  it('re-validates navigation input in the main process', () => {
    invoke(IPC_CHANNELS.advanceSetup, trustedEvent, { selections: DEFAULT_SETUP_SELECTIONS });
    expect(advanced).toEqual(DEFAULT_SETUP_SELECTIONS);
    expect(() =>
      invoke(IPC_CHANNELS.advanceSetup, trustedEvent, { selections: { mode: 'sudo' } }),
    ).toThrow();
    expect(() => invoke(IPC_CHANNELS.completeSetup, trustedEvent, undefined)).toThrow();
    const finalSelections = { ...DEFAULT_SETUP_SELECTIONS, launchAfterFinish: false };
    invoke(IPC_CHANNELS.completeSetup, trustedEvent, { selections: finalSelections });
    expect(completed).toEqual(finalSelections);
  });

  it('rejects a sender that is not the live setup window', () => {
    for (const channel of SETUP_IPC_CHANNELS) {
      expect(() =>
        invoke(
          channel,
          { sender: {}, senderFrame: mainFrame },
          { selections: DEFAULT_SETUP_SELECTIONS },
        ),
      ).toThrow(/Unauthorized/u);
      expect(() =>
        invoke(
          channel,
          { sender: webContents, senderFrame: {} },
          { selections: DEFAULT_SETUP_SELECTIONS },
        ),
      ).toThrow(/Unauthorized/u);
    }
  });

  it('rejects every channel once the setup window is gone', () => {
    controller.getWindow = () => undefined;

    for (const channel of SETUP_IPC_CHANNELS) {
      expect(() => invoke(channel, trustedEvent, { selections: DEFAULT_SETUP_SELECTIONS })).toThrow(
        /Unauthorized/u,
      );
    }
  });

  it('re-validates the provider form in the main process', () => {
    invoke(IPC_CHANNELS.applySetupProvider, trustedEvent, {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      apiKey: 'sk-example',
    });
    expect(applied).toEqual({
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      apiKey: 'sk-example',
    });
    expect(() =>
      invoke(IPC_CHANNELS.applySetupProvider, trustedEvent, { providerId: 'x', modelId: 'y' }),
    ).toThrow();
    expect(() =>
      invoke(IPC_CHANNELS.testSetupProvider, trustedEvent, { requestId: '..', modelId: 'y' }),
    ).toThrow();
    expect(() =>
      invoke(IPC_CHANNELS.confirmSetupCharacterPackage, trustedEvent, { previewId: 'nope' }),
    ).toThrow();
  });

  it('never exposes a stored key through the provider status', async () => {
    const status = await (invoke(IPC_CHANNELS.getSetupProviderStatus, trustedEvent) as Promise<
      Record<string, unknown>
    >);

    expect(status).toMatchObject({ hasSecret: true });
    expect(Object.keys(status)).not.toContain('apiKey');
  });

  it('removes its handlers when setup ends', () => {
    dispose();

    expect(ipcState.handlers.size).toBe(0);
  });
});
