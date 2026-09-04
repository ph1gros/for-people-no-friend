import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  app,
  dialog,
  ipcMain,
  screen,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from 'electron';

import {
  parseSetCharacterDisplayModeInput,
  type CharacterDisplayMode,
  type CharacterDisplayModeResult,
} from '../../shared/character-display-ipc';
import {
  parseCharacterIdInput,
  parseConfirmCharacterPackageImportInput,
  parseCreateLocalCharacterInput,
  type CharacterPackageFileResult,
} from '../../shared/character-package-ipc';
import { DEFAULT_CHARACTER_PROFILE } from '../../core/conversation/character-profile';
import {
  parseBuildCharacterDraftInput,
  parseCancelCharacterResearchInput,
  parseSearchCharactersInput,
  type CharacterDraftResult,
  type CharacterSearchResult,
} from '../../shared/character-research-ipc';
import {
  parseCancelConversationInput,
  parseCharacterProfileInput,
  parseConversationConfiguration,
  parseStartConversationInput,
} from '../../shared/conversation-ipc';
import {
  parseMediaCommandInput,
  parseSetDesktopIntegrationSettingsInput,
  parseSetDesktopWidgetEnabledInput,
  type DesktopIntegrationStatus,
} from '../../shared/desktop-integration-ipc';
import { IPC_CHANNELS } from '../../shared/ipc';
import {
  parseConfirmMemoryCandidateInput,
  parseMergeMemoryCandidatesInput,
  parseMemoryIdInput,
  parseSetMemorySettingsInput,
  parseUpdateMemoryCandidateInput,
  parseUpdateMemoryInput,
  type MemoryFileOperationResult,
  type MemoryOperationResult,
} from '../../shared/memory-ipc';
import type { ModelOperationResult } from '../../shared/model-ipc';
import {
  parseCancelProviderRequestInput,
  parseDeleteProviderSecretInput,
  parseProviderConfiguration,
  parseSetProviderSecretInput,
  parseTestProviderConnectionInput,
} from '../../shared/model-ipc';
import { parseSetChatPanelExpandedInput, parseSetWindowScaleInput } from '../../shared/window-ipc';
import { parseWorkGlossaryInput } from '../../shared/work-glossary-ipc';
import {
  DEFAULT_SPEECH_SETTINGS,
  parseCancelSpeechInput,
  parseSetSpeechSecretInput,
  parseSetSpeechSettingsInput,
  parseSpeechSynthesisInput,
  parseSpeechTranscriptionInput,
  type SpeechStatus,
} from '../../shared/speech-ipc';
import { parseSpeechAssetControlInput } from '../../shared/speech-asset-ipc';
import {
  parseSetViewerExSettingsInput,
  parseViewerExPresentationInput,
} from '../../shared/viewerex-ipc';
import {
  parseVTubeStudioExpressionPreviewInput,
  parseSetVTubeStudioSettingsInput,
  parseVTubeStudioPresentationInput,
} from '../../shared/vtube-studio-ipc';
import type { CharacterResearchService } from '../character/character-research-service';
import type { WorkGlossaryService } from '../glossary/work-glossary-service';
import type { ConversationRuntime } from '../conversation/conversation-runtime';
import type { CharacterPackageService } from '../character/character-package-service';
import { MAX_CHARACTER_PACKAGE_BYTES } from '../character/character-package-archive';
import type { Live2DModelImportService } from '../live2d/live2d-model-import-service';
import type { DesktopIntegrationService } from '../desktop/desktop-integration-service';
import type { ModelRuntime } from '../llm/model-runtime';
import type { MemoryService } from '../memory/memory-service';
import type { CharacterProfileStore } from '../storage/character-profile-store';
import type { CharacterDisplayConfigStore } from '../storage/character-display-config-store';
import type { DesktopLayoutStore } from '../storage/desktop-layout-store';
import {
  DEFAULT_DESKTOP_LAYOUT_SETTINGS,
  parseSetDesktopLayoutSettingsInput,
} from '../../shared/desktop-layout-ipc';
import type { SpeechService } from '../speech/speech-service';
import type { ViewerExService } from '../viewerex/viewerex-service';
import type { VTubeStudioService } from '../vtube-studio/vtube-studio-service';
import { normalizeCursorToWorkArea } from './global-tracking';
import { isTrustedIpcSender } from './sender-validation';
import type { AssistantToolService } from '../assistant/assistant-tool-service';
import {
  parseImportDroppedWorkspaceFilesInput,
  parseResolveAssistantToolApprovalInput,
} from '../../shared/assistant-tools-ipc';
import type { LocalAssetOperationResult } from '../../shared/local-asset-ipc';
import type { LocalSpeechAssetService } from '../speech/local-speech-asset-service';
import type { BundledVTubeModelInstaller } from '../vtube-studio/bundled-vtube-model-installer';
import type { SafeDiagnosticLog } from '../diagnostics/safe-diagnostic-log';
import type { SpeechAssetManager } from '../speech/speech-asset-manager';
import type { ResourceCenter } from '../resources/resource-center';
import { unavailableResourceCenter } from '../../shared/resource-catalog';
import type { ResourceCenterWindow } from '../windows/resource-center-window';

export interface IpcWindowController {
  getWindow(): BrowserWindow | undefined;
  getScale(): number;
  setScale(scale: number): number;
  setChatPanelExpanded(expanded: boolean, settingsExpanded?: boolean): void;
}

export interface IpcHandlerDependencies {
  windows: IpcWindowController;
  models: ModelRuntime;
  conversations: ConversationRuntime;
  profiles: CharacterProfileStore;
  memories: MemoryService;
  characterResearch: CharacterResearchService;
  workGlossary: WorkGlossaryService;
  desktopIntegrations?: DesktopIntegrationService;
  characterPackages?: CharacterPackageService;
  live2DModelImports?: Live2DModelImportService;
  speech?: SpeechService;
  viewerEx?: ViewerExService;
  vTubeStudio?: VTubeStudioService;
  characterDisplay?: CharacterDisplayConfigStore;
  onCharacterDisplayModeChanged?: (mode: CharacterDisplayMode) => void | Promise<void>;
  assistantTools?: AssistantToolService;
  desktopLayout?: DesktopLayoutStore;
  localSpeechAssets?: LocalSpeechAssetService;
  bundledVTubeModel?: BundledVTubeModelInstaller;
  diagnosticLog?: SafeDiagnosticLog;
  speechAssetManager?: SpeechAssetManager;
  resourceCenter?: ResourceCenter;
  resourceWindow?: ResourceCenterWindow;
}

const requireTrustedSender = (
  event: Parameters<typeof isTrustedIpcSender>[0],
  windows: IpcWindowController,
  additionalWindow?: BrowserWindow,
): void => {
  if (
    !isTrustedIpcSender(event, windows.getWindow()) &&
    !isTrustedIpcSender(event, additionalWindow)
  ) {
    throw new Error('Unauthorized IPC sender.');
  }
};

interface IpcHandlerRegistry {
  handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void;
}

export const createTrustedIpcHandlerRegistrar =
  (
    ipc: IpcHandlerRegistry,
    windows: IpcWindowController,
    untrustedBehavior: 'throw' | 'return-undefined' = 'throw',
    additionalWindow?: () => BrowserWindow | undefined,
  ) =>
  (channel: string, handler: (event: IpcMainInvokeEvent, ...args: never[]) => unknown): void => {
    ipc.handle(channel, (event, ...args) => {
      if (
        untrustedBehavior === 'return-undefined' &&
        !isTrustedIpcSender(event, windows.getWindow())
      ) {
        return undefined;
      }
      requireTrustedSender(event, windows, additionalWindow?.());
      return handler(event, ...(args as never[]));
    });
  };

const runModelOperation = async (
  operation: () => Promise<void>,
  failureMessage = 'The model provider settings could not be saved.',
): Promise<ModelOperationResult> => {
  try {
    await operation();
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: {
        code: 'configuration',
        message: failureMessage,
        retryable: false,
      },
    };
  }
};

const runMemoryOperation = async (
  operation: () => void | Promise<void>,
): Promise<MemoryOperationResult> => {
  try {
    await operation();
    return { ok: true };
  } catch {
    return { ok: false, message: '记忆操作失败，本轮对话仍可继续。' };
  }
};

const showSaveDialog = (
  windows: IpcWindowController,
  options: Electron.SaveDialogOptions,
): Promise<Electron.SaveDialogReturnValue> => {
  const window = windows.getWindow();
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options);
};

const showOpenDialog = (
  windows: IpcWindowController,
  options: Electron.OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> => {
  const window = windows.getWindow();
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
};

export const registerIpcHandlers = ({
  windows,
  models,
  conversations,
  profiles,
  memories,
  characterResearch,
  workGlossary,
  desktopIntegrations,
  characterPackages,
  live2DModelImports,
  speech,
  viewerEx,
  vTubeStudio,
  characterDisplay,
  onCharacterDisplayModeChanged,
  assistantTools,
  desktopLayout,
  localSpeechAssets,
  bundledVTubeModel,
  diagnosticLog,
  speechAssetManager,
  resourceCenter,
  resourceWindow,
}: IpcHandlerDependencies): void => {
  const handle = createTrustedIpcHandlerRegistrar(ipcMain, windows);
  const handleResource = createTrustedIpcHandlerRegistrar(ipcMain, windows, 'throw', () =>
    resourceWindow?.getWindow(),
  );
  handle(IPC_CHANNELS.openResourceCenter, async () => {
    if (!resourceWindow) throw new Error('资源中心窗口不可用。');
    await resourceWindow.open();
  });
  const handleSilent = createTrustedIpcHandlerRegistrar(ipcMain, windows, 'return-undefined');
  const notifyCharacterDisplayModeChanged = async (mode: CharacterDisplayMode): Promise<void> => {
    try {
      await onCharacterDisplayModeChanged?.(mode);
    } catch (error) {
      console.warn('Unable to update the character display runtime.', error);
    }
  };

  const resolveCharacterDisplayMode = async (): Promise<CharacterDisplayMode> => {
    const stored = await characterDisplay?.get();
    if (stored) {
      await notifyCharacterDisplayModeChanged(stored);
      return stored;
    }

    const [viewerStatus, vTubeStudioStatus] = await Promise.all([
      viewerEx?.getStatus(),
      vTubeStudio?.getStatus(),
    ]);
    const migrated: CharacterDisplayMode = vTubeStudioStatus?.settings.enabled
      ? 'vtube-studio'
      : viewerStatus?.settings.enabled
        ? 'viewerex'
        : 'off';
    await characterDisplay?.set(migrated);
    await notifyCharacterDisplayModeChanged(migrated);
    return migrated;
  };

  const applyCharacterDisplayMode = async (
    mode: CharacterDisplayMode,
  ): Promise<CharacterDisplayModeResult> => {
    try {
      const [viewerStatus, vTubeStudioStatus] = await Promise.all([
        viewerEx?.getStatus(),
        vTubeStudio?.getStatus(),
      ]);
      if (viewerEx && viewerStatus) {
        const result = await viewerEx.setSettings({
          ...viewerStatus.settings,
          enabled: mode === 'viewerex',
        });
        if (!result.ok) return { ok: false, mode, message: result.message };
      }
      if (vTubeStudio && vTubeStudioStatus) {
        const result = await vTubeStudio.setSettings({
          ...vTubeStudioStatus.settings,
          enabled: mode === 'vtube-studio',
        });
        if (!result.ok) return { ok: false, mode, message: result.message };
      }
      await characterDisplay?.set(mode);
      await notifyCharacterDisplayModeChanged(mode);
      return { ok: true, mode };
    } catch {
      return { ok: false, mode, message: '角色显示方式无法保存。' };
    }
  };

  handle(IPC_CHANNELS.getAppVersion, (event) => {
    return app.getVersion();
  });
  handle(IPC_CHANNELS.openDiagnosticLog, async (): Promise<LocalAssetOperationResult> => {
    if (!diagnosticLog) return { ok: false, canceled: false, message: '诊断日志不可用。' };
    await diagnosticLog.ensureFile();
    const errorMessage = await shell.openPath(diagnosticLog.filePath);
    return errorMessage
      ? { ok: false, canceled: false, message: '诊断日志无法打开。' }
      : { ok: true, canceled: false, message: '已打开诊断日志。' };
  });

  handleSilent(IPC_CHANNELS.getGlobalTrackingPoint, () => {
    const window = windows.getWindow();
    if (!window) {
      return undefined;
    }
    const bounds = window.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    return normalizeCursorToWorkArea(screen.getCursorScreenPoint(), workArea);
  });
  handle(IPC_CHANNELS.getCharacterDisplayMode, async (event) => {
    return resolveCharacterDisplayMode();
  });
  handle(IPC_CHANNELS.setCharacterDisplayMode, async (event, input: unknown) => {
    return applyCharacterDisplayMode(parseSetCharacterDisplayModeInput(input).mode);
  });

  handle(IPC_CHANNELS.listModelProviders, (event) => {
    return models.listProviders();
  });
  handle(IPC_CHANNELS.getProviderConfiguration, async (event) => {
    return models.getConfiguration();
  });
  handle(IPC_CHANNELS.setProviderConfiguration, (event, input: unknown) => {
    return runModelOperation(() => models.setConfiguration(parseProviderConfiguration(input)));
  });
  handle(IPC_CHANNELS.getProviderSecretStatus, async (event) => {
    return models.getSecretStatus();
  });
  handle(IPC_CHANNELS.setProviderSecret, (event, input: unknown) => {
    return runModelOperation(() => {
      const parsed = parseSetProviderSecretInput(input);
      return models.setSecret(parsed.providerId, parsed.apiKey);
    });
  });
  handle(IPC_CHANNELS.deleteProviderSecret, (event, input: unknown) => {
    return runModelOperation(() => {
      const parsed = parseDeleteProviderSecretInput(input);
      return models.deleteSecret(parsed.providerId);
    });
  });
  handle(IPC_CHANNELS.testProviderConnection, (event, input: unknown) => {
    return models.testConnection(parseTestProviderConnectionInput(input));
  });
  handle(IPC_CHANNELS.cancelProviderRequest, (event, input: unknown) => {
    return models.cancel(parseCancelProviderRequestInput(input).requestId);
  });

  handle(IPC_CHANNELS.getConversationConfiguration, async (event) => {
    return models.getConversationConfiguration();
  });
  handle(IPC_CHANNELS.setConversationConfiguration, (event, input: unknown) => {
    return runModelOperation(() =>
      models.setConversationConfiguration(parseConversationConfiguration(input)),
    );
  });
  handle(IPC_CHANNELS.getCharacterProfile, async (event) => {
    return profiles.get();
  });
  handle(IPC_CHANNELS.setCharacterProfile, (event, input: unknown) => {
    return runModelOperation(() =>
      conversations.setCharacterProfile(parseCharacterProfileInput(input)),
    );
  });
  handle(IPC_CHANNELS.getConversationHistory, async (event) => {
    return conversations.listHistory();
  });
  handle(IPC_CHANNELS.clearConversationHistory, (event) => {
    return runModelOperation(() => conversations.clearHistory());
  });
  handle(IPC_CHANNELS.generateContextualOpeningLine, (event) => {
    return conversations.generateContextualOpeningLine();
  });
  handle(IPC_CHANNELS.startConversation, (event, input: unknown) => {
    const sender = event.sender;
    return conversations.start(parseStartConversationInput(input), (conversationEvent) => {
      const window = windows.getWindow();
      if (
        window &&
        !window.isDestroyed() &&
        window.webContents === sender &&
        !sender.isDestroyed()
      ) {
        sender.send(IPC_CHANNELS.conversationEvent, conversationEvent);
      }
    });
  });
  handle(IPC_CHANNELS.cancelConversation, (event, input: unknown) => {
    return conversations.cancel(parseCancelConversationInput(input).requestId);
  });
  handle(IPC_CHANNELS.getAssistantToolStatus, (event) => {
    return (
      assistantTools?.getStatus() ?? {
        workspaceConfigured: false,
        webAvailable: false,
      }
    );
  });
  handle(IPC_CHANNELS.selectAssistantWorkspace, async (event) => {
    if (!assistantTools) {
      return { workspaceConfigured: false, webAvailable: false, canceled: true };
    }
    const selection = await showOpenDialog(windows, {
      title: '选择助手可以处理的工作文件夹',
      properties: ['openDirectory'],
    });
    const selected = selection.filePaths[0];
    if (selection.canceled || !selected) {
      return { ...(await assistantTools.getStatus()), canceled: true };
    }
    const info = await stat(selected);
    if (!info.isDirectory()) throw new Error('The assistant workspace is invalid.');
    await assistantTools.setWorkspace(selected);
    return { ...(await assistantTools.getStatus()), canceled: false };
  });
  handle(IPC_CHANNELS.importDroppedWorkspaceFiles, async (event, input: unknown) => {
    if (!assistantTools) {
      return { ok: false, imported: [], message: '工作区文件服务不可用。' };
    }
    return assistantTools.importDroppedFiles(parseImportDroppedWorkspaceFilesInput(input));
  });
  handle(IPC_CHANNELS.resolveAssistantToolApproval, (event, input: unknown) => {
    const parsed = parseResolveAssistantToolApprovalInput(input);
    return conversations.resolveToolApproval(parsed.requestId, parsed.approvalId, parsed.approved);
  });

  handle(
    IPC_CHANNELS.searchCharacters,
    async (event, input: unknown): Promise<CharacterSearchResult> => {
      try {
        const parsed = parseSearchCharactersInput(input);
        return {
          ok: true,
          candidates: await characterResearch.search(
            parsed.requestId,
            parsed.name,
            parsed.sourceWork,
          ),
        };
      } catch {
        return { ok: false, message: '暂时无法查询角色资料，请稍后重试。' };
      }
    },
  );
  handle(
    IPC_CHANNELS.buildCharacterDraft,
    async (event, input: unknown): Promise<CharacterDraftResult> => {
      try {
        const parsed = parseBuildCharacterDraftInput(input);
        return {
          ok: true,
          draft: await characterResearch.buildDraft(parsed.requestId, parsed.candidateId),
        };
      } catch {
        return { ok: false, message: '没有取得可用的角色资料，请选择其他候选。' };
      }
    },
  );
  handle(IPC_CHANNELS.cancelCharacterResearch, (event, input: unknown) => {
    return characterResearch.cancel(parseCancelCharacterResearchInput(input).requestId);
  });
  handle(IPC_CHANNELS.listCharacters, (event) => {
    return characterPackages?.list() ?? [];
  });
  handle(IPC_CHANNELS.createLocalCharacter, (event, input: unknown) => {
    return runModelOperation(async () => {
      const { name } = parseCreateLocalCharacterInput(input);
      const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
      conversations.cancelOpeningLine();
      await profiles.add({
        ...DEFAULT_CHARACTER_PROFILE,
        id: `local-${suffix}`,
        name,
        memoryNamespace: `character-${suffix}`,
      });
      await profiles.activate(`local-${suffix}`);
    }, '本地角色创建失败。');
  });
  handle(IPC_CHANNELS.clearInactiveCharacters, (event) => {
    return runModelOperation(async () => {
      if (!characterPackages) throw new Error();
      await characterPackages.clearInactive();
    }, '角色库无法清空，当前角色和已有资料均已保留。');
  });
  handle(
    IPC_CHANNELS.previewCharacterPackage,
    async (event): Promise<CharacterPackageFileResult> => {
      if (!characterPackages) {
        return { ok: false, canceled: false, message: '角色包服务不可用。' };
      }
      const selection = await showOpenDialog(windows, {
        title: '预览角色包',
        properties: ['openFile'],
        filters: [{ name: 'For People No Friend 角色包', extensions: ['zip'] }],
      });
      if (selection.canceled || !selection.filePaths[0]) return { ok: true, canceled: true };
      try {
        const filePath = selection.filePaths[0];
        if ((await stat(filePath)).size > MAX_CHARACTER_PACKAGE_BYTES) throw new Error();
        return {
          ok: true,
          canceled: false,
          preview: await characterPackages.preview(new Uint8Array(await readFile(filePath))),
        };
      } catch {
        return {
          ok: false,
          canceled: false,
          message: '角色包无效、不兼容、过大，或包含不安全文件。',
        };
      }
    },
  );
  handle(
    IPC_CHANNELS.confirmCharacterPackageImport,
    async (event, input: unknown): Promise<CharacterPackageFileResult> => {
      if (!characterPackages) {
        return { ok: false, canceled: false, message: '角色包服务不可用。' };
      }
      try {
        const parsed = parseConfirmCharacterPackageImportInput(input);
        await characterPackages.confirmImport(parsed.previewId, parsed.replaceExisting);
        return { ok: true, canceled: false };
      } catch (error) {
        return {
          ok: false,
          canceled: false,
          message: error instanceof Error ? error.message : '角色包导入失败。',
        };
      }
    },
  );
  handle(
    IPC_CHANNELS.exportActiveCharacterPackage,
    async (event): Promise<CharacterPackageFileResult> => {
      if (!characterPackages) {
        return { ok: false, canceled: false, message: '角色包服务不可用。' };
      }
      try {
        const exported = await characterPackages.exportActive();
        const destination = await showSaveDialog(windows, {
          title: '导出当前角色包',
          defaultPath: path.join(app.getPath('documents'), exported.fileName),
          filters: [{ name: 'For People No Friend 角色包', extensions: ['zip'] }],
        });
        if (destination.canceled || !destination.filePath) return { ok: true, canceled: true };
        await writeFile(destination.filePath, exported.bytes, { mode: 0o600 });
        return { ok: true, canceled: false };
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        const message =
          code === 'ENOENT'
            ? '内置模型资源不完整，无法导出角色包。'
            : code === 'EACCES' || code === 'EPERM'
              ? '无法写入所选位置，请换一个文件夹或文件名。'
              : '当前角色包导出失败，请重试。';
        return { ok: false, canceled: false, message };
      }
    },
  );
  handle(IPC_CHANNELS.activateCharacter, (event, input: unknown) => {
    return runModelOperation(async () => {
      if (!characterPackages) throw new Error();
      conversations.cancelOpeningLine();
      await characterPackages.activate(parseCharacterIdInput(input).characterId);
    }, '角色切换失败。');
  });
  handle(IPC_CHANNELS.removeCharacter, (event, input: unknown) => {
    return runModelOperation(async () => {
      if (!characterPackages) throw new Error();
      conversations.cancelOpeningLine();
      await characterPackages.remove(parseCharacterIdInput(input).characterId);
    }, '角色删除失败。');
  });
  handle(IPC_CHANNELS.getActiveCharacterModelManifest, async (event) => {
    return (
      (await live2DModelImports?.getActiveModelManifest()) ??
      (await characterPackages?.getActiveModelManifest())
    );
  });
  handle(IPC_CHANNELS.importLive2DModel, async (event) => {
    if (!live2DModelImports) {
      return { ok: false, canceled: false, message: 'Live2D 模型导入服务不可用。' } as const;
    }
    const selection = await showOpenDialog(windows, {
      title: '导入 Live2D 模型',
      properties: ['openFile'],
      filters: [{ name: 'Live2D Cubism 模型（.model3.json）', extensions: ['json'] }],
    });
    if (selection.canceled || !selection.filePaths[0]) {
      return { ok: true, canceled: true } as const;
    }
    try {
      const imported = await live2DModelImports.importModel(selection.filePaths[0]);
      return { ok: true, canceled: false, ...imported } as const;
    } catch (error) {
      return {
        ok: false,
        canceled: false,
        message: error instanceof Error ? error.message : 'Live2D 模型导入失败。',
      } as const;
    }
  });
  handle(IPC_CHANNELS.exportActiveLive2DModel, async (event) => {
    if (!live2DModelImports) {
      return { ok: false, canceled: false, message: 'Live2D 模型导出服务不可用。' } as const;
    }
    const selection = await showOpenDialog(windows, {
      title: '选择 Live2D 模型导出位置',
      buttonLabel: '导出到这里',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) {
      return { ok: true, canceled: true } as const;
    }
    try {
      const exported = await live2DModelImports.exportActiveModel(selection.filePaths[0]);
      return {
        ok: true,
        canceled: false,
        ...exported,
        message: `已导出到“${exported.directoryName}”。`,
      } as const;
    } catch (error) {
      return {
        ok: false,
        canceled: false,
        message: error instanceof Error ? error.message : 'Live2D 模型导出失败。',
      } as const;
    }
  });
  handle(IPC_CHANNELS.getWorkGlossaryStatus, (event, input: unknown) => {
    return workGlossary.getStatus(parseWorkGlossaryInput(input).sourceWork);
  });
  handle(IPC_CHANNELS.syncWorkGlossary, (event, input: unknown) => {
    return workGlossary.sync(parseWorkGlossaryInput(input).sourceWork);
  });

  handle(IPC_CHANNELS.getMemorySettings, (event) => {
    return memories.getSettings();
  });
  handle(IPC_CHANNELS.setMemorySettings, (event, input: unknown) => {
    return runMemoryOperation(() => {
      const parsed = parseSetMemorySettingsInput(input);
      return memories.setSettings(parsed);
    });
  });
  handle(IPC_CHANNELS.listMemories, async (event) => {
    const profile = await profiles.get();
    return memories.list(profile.memoryNamespace);
  });
  handle(IPC_CHANNELS.listMemoryCandidates, async (event) => {
    const profile = await profiles.get();
    return memories.listCandidates(profile.memoryNamespace);
  });
  handle(IPC_CHANNELS.updateMemoryCandidate, async (event, input: unknown) => {
    const parsed = parseUpdateMemoryCandidateInput(input);
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      if (!memories.updateCandidate(profile.memoryNamespace, parsed.id, parsed.candidate)) {
        throw new Error('Memory candidate not found.');
      }
    });
  });
  handle(IPC_CHANNELS.mergeMemoryCandidates, async (event, input: unknown) => {
    const parsed = parseMergeMemoryCandidatesInput(input);
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      if (!memories.mergeCandidates(profile.memoryNamespace, parsed.targetId, parsed.sourceId)) {
        throw new Error('Memory candidates cannot be merged.');
      }
    });
  });
  handle(IPC_CHANNELS.confirmMemoryCandidate, async (event, input: unknown) => {
    const { id, conflictResolution } = parseConfirmMemoryCandidateInput(input);
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      if (!memories.confirmCandidate(profile.memoryNamespace, id, conflictResolution)) {
        throw new Error('Memory candidate not found.');
      }
    });
  });
  handle(IPC_CHANNELS.rejectMemoryCandidate, async (event, input: unknown) => {
    const { id } = parseMemoryIdInput(input);
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      if (!memories.rejectCandidate(profile.memoryNamespace, id)) {
        throw new Error('Memory candidate not found.');
      }
    });
  });
  handle(IPC_CHANNELS.updateMemory, async (event, input: unknown) => {
    const parsed = parseUpdateMemoryInput(input);
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      if (!memories.update(profile.memoryNamespace, parsed.id, parsed.candidate)) {
        throw new Error('Memory not found.');
      }
    });
  });
  handle(IPC_CHANNELS.deleteMemory, async (event, input: unknown) => {
    const { id } = parseMemoryIdInput(input);
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      if (!memories.delete(profile.memoryNamespace, id)) {
        throw new Error('Memory not found.');
      }
    });
  });
  handle(IPC_CHANNELS.clearMemories, async (event) => {
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      memories.clear(profile.memoryNamespace);
    });
  });
  handle(IPC_CHANNELS.exportMemories, async (event): Promise<MemoryFileOperationResult> => {
    const result = await showSaveDialog(windows, {
      title: '导出 For People No Friend 记忆',
      defaultPath: path.join(app.getPath('documents'), 'for-people-no-friend-memories.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: true, canceled: true };
    }
    try {
      const profile = await profiles.get();
      await writeFile(
        result.filePath,
        JSON.stringify(memories.exportData(profile.memoryNamespace), null, 2),
        { encoding: 'utf8', mode: 0o600 },
      );
      return { ok: true, canceled: false };
    } catch {
      return { ok: false, canceled: false, message: '记忆 JSON 导出失败。' };
    }
  });
  handle(IPC_CHANNELS.backupMemory, async (event): Promise<MemoryFileOperationResult> => {
    const result = await showSaveDialog(windows, {
      title: '备份 For People No Friend 本地数据库',
      defaultPath: path.join(app.getPath('documents'), 'for-people-no-friend-memory-backup.sqlite'),
      filters: [{ name: 'SQLite', extensions: ['sqlite'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: true, canceled: true };
    }
    try {
      await memories.backup(result.filePath);
      return { ok: true, canceled: false };
    } catch {
      return {
        ok: false,
        canceled: false,
        message: '当前运行环境不支持数据库备份，或备份文件无法写入。',
      };
    }
  });

  handle(IPC_CHANNELS.getWindowScale, (event) => {
    return windows.getScale();
  });
  handle(IPC_CHANNELS.setWindowScale, (event, input: unknown) => {
    return windows.setScale(parseSetWindowScaleInput(input).scale);
  });
  handle(IPC_CHANNELS.setChatPanelExpanded, (event, input: unknown) => {
    const parsed = parseSetChatPanelExpandedInput(input);
    windows.setChatPanelExpanded(parsed.expanded, parsed.view === 'settings');
  });
  handle(IPC_CHANNELS.getDesktopLayoutSettings, async (event) => {
    return desktopLayout?.get() ?? { ...DEFAULT_DESKTOP_LAYOUT_SETTINGS };
  });
  handle(IPC_CHANNELS.setDesktopLayoutSettings, async (event, input: unknown) => {
    const { settings } = parseSetDesktopLayoutSettingsInput(input);
    await desktopLayout?.set(settings);
    return settings;
  });
  handle(
    IPC_CHANNELS.getDesktopIntegrationStatus,
    async (event): Promise<DesktopIntegrationStatus> => {
      return desktopIntegrations
        ? desktopIntegrations.getStatus()
        : {
            settings: {
              globalShortcutsEnabled: false,
              mediaControlEnabled: false,
              inputOverlayEnabled: false,
              inputOverlayMouseEnabled: true,
              inputOverlayKeys: ['W', 'A', 'S', 'D'],
              widgetOrder: [],
              visibilityShortcut: '\\',
              stopGenerationShortcut: 'Ctrl+Shift+Delete',
            },
            shortcutRegistered: false,
            stopGenerationShortcutRegistered: false,
            inputOverlayActive: false,
            media: { supported: false },
          };
    },
  );
  handle(IPC_CHANNELS.setDesktopIntegrationSettings, async (event, input: unknown) => {
    const { settings } = parseSetDesktopIntegrationSettingsInput(input);
    await desktopIntegrations?.setSettings(settings);
  });
  handle(IPC_CHANNELS.setDesktopWidgetEnabled, async (event, input: unknown) => {
    const { widgetId, enabled } = parseSetDesktopWidgetEnabledInput(input);
    await desktopIntegrations?.setWidgetEnabled(widgetId, enabled);
  });
  handle(IPC_CHANNELS.sendMediaCommand, (event, input: unknown) => {
    return desktopIntegrations?.sendMediaCommand(parseMediaCommandInput(input).command) ?? false;
  });
  handle(IPC_CHANNELS.getSpeechStatus, async (event): Promise<SpeechStatus> => {
    return speech
      ? speech.getStatus({ waitForRuntime: false })
      : {
          settings: { ...DEFAULT_SPEECH_SETTINGS },
          apiKeySaved: false,
          output: {
            providerId: 'disabled',
            displayName: '未启用',
            configured: false,
            available: false,
            transport: 'none',
            dataDestination: 'none',
            supportsStreamingInput: false,
            supportedFormats: [],
            detail: '语音服务不可用；文字聊天不受影响。',
          },
          input: {
            available: false,
            modes: [],
            dataDestination: 'none',
            detail: '麦克风尚未开启。',
          },
        };
  });
  handle(IPC_CHANNELS.setSpeechSettings, async (event, input: unknown) => {
    const { settings } = parseSetSpeechSettingsInput(input);
    const result = await (speech?.setSettings(settings) ??
      Promise.resolve({ ok: false as const, message: '语音服务不可用。' }));
    if (result.ok) {
      await desktopIntegrations?.setPushToTalkKey(
        settings.inputEnabled && settings.inputMode === 'manual'
          ? settings.pushToTalkKey
          : undefined,
      );
    }
    return result;
  });
  handle(IPC_CHANNELS.setSpeechSecret, (event, input: unknown) => {
    const { apiKey } = parseSetSpeechSecretInput(input);
    return speech?.setSecret(apiKey) ?? { ok: false, message: '语音服务不可用。' };
  });
  handle(IPC_CHANNELS.deleteSpeechSecret, (event) => {
    return speech?.deleteSecret() ?? { ok: false, message: '语音服务不可用。' };
  });
  handle(IPC_CHANNELS.synthesizeSpeech, (event, input: unknown) => {
    const parsed = parseSpeechSynthesisInput(input);
    return (
      speech?.synthesize(parsed) ?? {
        ok: false,
        requestId: parsed.requestId,
        cancelled: false,
        message: '语音服务不可用；文字回复仍可正常使用。',
      }
    );
  });
  handle(IPC_CHANNELS.transcribeSpeech, (event, input: unknown) => {
    const parsed = parseSpeechTranscriptionInput(input);
    return (
      speech?.transcribe(parsed) ?? {
        ok: false,
        requestId: parsed.requestId,
        cancelled: false,
        message: '中文语音识别服务不可用。',
      }
    );
  });
  handle(IPC_CHANNELS.cancelSpeech, (event, input: unknown) => {
    return speech?.cancel(parseCancelSpeechInput(input).requestId) ?? false;
  });
  handle(IPC_CHANNELS.getLocalSpeechAssetStatus, async (event) => {
    return (
      (await localSpeechAssets?.getStatus()) ?? {
        voiceName: '本地音色',
        voiceAvailable: false,
        voiceFileCount: 0,
        voiceBytes: 0,
        styles: [],
        trainingToolAvailable: false,
        trainingSourceReady: false,
      }
    );
  });
  handle(IPC_CHANNELS.getSpeechAssetDownloadStatus, async () => {
    return (
      (await speechAssetManager?.getStatus()) ?? {
        sourceConfigured: false,
        metered: false,
        busy: false,
        tiers: [],
        message: '尚未配置语音资产下载源。',
      }
    );
  });
  handleResource(
    IPC_CHANNELS.getResourceCenterStatus,
    async () => (await resourceCenter?.getStatus()) ?? unavailableResourceCenter(),
  );
  handleResource(
    IPC_CHANNELS.refreshResourceCatalog,
    async () => (await resourceCenter?.refresh()) ?? unavailableResourceCenter(),
  );
  handleResource(IPC_CHANNELS.controlSpeechAssetDownload, async (event, input: unknown) => {
    const parsed = parseSpeechAssetControlInput(input);
    return (
      (await speechAssetManager?.control(parsed)) ?? {
        sourceConfigured: false,
        metered: false,
        busy: false,
        tiers: [],
        message: '尚未配置语音资产下载源。',
      }
    );
  });
  handle(IPC_CHANNELS.exportLocalVoice, async (event): Promise<LocalAssetOperationResult> => {
    if (!localSpeechAssets) {
      return { ok: false, canceled: false, message: '本地音色导出服务不可用。' };
    }
    const selection = await showOpenDialog(windows, {
      title: '选择音色导出位置',
      buttonLabel: '导出到这里',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) return { ok: true, canceled: true };
    try {
      const exported = await localSpeechAssets.exportVoice(selection.filePaths[0]);
      return {
        ok: true,
        canceled: false,
        message: `已导出到“${exported.directoryName}”（${exported.fileCount} 个文件，约 ${Math.ceil(exported.exportedBytes / 1024 / 1024)} MiB）。`,
      };
    } catch (error) {
      return {
        ok: false,
        canceled: false,
        message: error instanceof Error ? error.message : '本地音色导出失败。',
      };
    }
  });
  const openSpeechAsset = async (
    resolvePath: () => string,
    unavailableMessage: string,
  ): Promise<LocalAssetOperationResult> => {
    try {
      if (!localSpeechAssets) throw new Error(unavailableMessage);
      const errorMessage = await shell.openPath(resolvePath());
      if (errorMessage) throw new Error(errorMessage);
      return { ok: true, canceled: false, message: '已打开。' };
    } catch (error) {
      return {
        ok: false,
        canceled: false,
        message: error instanceof Error ? error.message : unavailableMessage,
      };
    }
  };
  handle(IPC_CHANNELS.openSpeechTrainingSources, (event) => {
    return openSpeechAsset(
      () => localSpeechAssets!.getTrainingSourcePath(),
      '训练音源文件夹不可用。',
    );
  });
  handle(IPC_CHANNELS.launchSpeechTrainer, (event) => {
    return openSpeechAsset(() => localSpeechAssets!.getTrainerPath(), '本地训练工具不可用。');
  });
  handle(IPC_CHANNELS.getViewerExStatus, (event) => {
    return viewerEx?.getStatus();
  });
  handle(IPC_CHANNELS.setViewerExSettings, async (event, input: unknown) => {
    const { settings } = parseSetViewerExSettingsInput(input);
    const mode = await resolveCharacterDisplayMode();
    return (
      viewerEx?.setSettings({ ...settings, enabled: mode === 'viewerex' }) ?? {
        ok: false,
        message: 'ViewerEX 适配器不可用。',
      }
    );
  });
  handle(IPC_CHANNELS.presentInViewerEx, (event, input: unknown) => {
    return viewerEx?.present(parseViewerExPresentationInput(input)) ?? false;
  });
  handle(IPC_CHANNELS.getVTubeStudioStatus, async (event) => {
    const status = await vTubeStudio?.getStatus();
    return status
      ? {
          ...status,
          bundledModelAvailable: (await bundledVTubeModel?.isAvailable()) ?? false,
        }
      : undefined;
  });
  handle(IPC_CHANNELS.launchVTubeStudio, async (event) => {
    try {
      await shell.openExternal('steam://rungameid/1325860');
      return { ok: true, message: '已请求 Steam 启动 VTube Studio。' };
    } catch {
      return { ok: false, message: '无法通过 Steam 启动 VTube Studio，请确认已安装 Steam。' };
    }
  });
  handle(IPC_CHANNELS.installBundledVTubeStudioModel, (event) => {
    return (
      bundledVTubeModel?.install() ?? {
        ok: false,
        message: '安装包没有提供可安装的 VTube Studio 模型。',
      }
    );
  });
  handle(IPC_CHANNELS.setVTubeStudioSettings, async (event, input: unknown) => {
    const { settings } = parseSetVTubeStudioSettingsInput(input);
    const mode = await resolveCharacterDisplayMode();
    return (
      vTubeStudio?.setSettings({ ...settings, enabled: mode === 'vtube-studio' }) ?? {
        ok: false,
        message: 'VTube Studio 适配器不可用。',
      }
    );
  });
  handle(IPC_CHANNELS.authorizeVTubeStudio, (event) => {
    return (
      vTubeStudio?.authorize() ?? {
        ok: false,
        message: 'VTube Studio 适配器不可用。',
      }
    );
  });
  handle(IPC_CHANNELS.inspectVTubeStudio, (event) => {
    return (
      vTubeStudio?.inspect() ?? {
        ok: false,
        message: 'VTube Studio 适配器不可用。',
      }
    );
  });
  handle(IPC_CHANNELS.previewVTubeStudioExpression, (event, input: unknown) => {
    return (
      vTubeStudio?.previewExpression(parseVTubeStudioExpressionPreviewInput(input)) ?? {
        ok: false,
        message: 'VTube Studio 适配器不可用。',
      }
    );
  });
  handle(IPC_CHANNELS.presentInVTubeStudio, (event, input: unknown) => {
    return (
      vTubeStudio?.present(parseVTubeStudioPresentationInput(input)) ?? {
        ok: false,
        reason: 'connection-failed',
        message: 'VTube Studio 适配器不可用。',
      }
    );
  });
};
