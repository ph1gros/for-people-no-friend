import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { app, dialog, ipcMain, screen, type BrowserWindow } from 'electron';

import {
  parseCharacterIdInput,
  parseConfirmCharacterPackageImportInput,
  type CharacterPackageFileResult,
} from '../../shared/character-package-ipc';
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
import type { CharacterResearchService } from '../character/character-research-service';
import type { WorkGlossaryService } from '../glossary/work-glossary-service';
import type { ConversationRuntime } from '../conversation/conversation-runtime';
import type { CharacterPackageService } from '../character/character-package-service';
import { MAX_CHARACTER_PACKAGE_BYTES } from '../character/character-package-archive';
import type { DesktopIntegrationService } from '../desktop/desktop-integration-service';
import type { ModelRuntime } from '../llm/model-runtime';
import type { MemoryService } from '../memory/memory-service';
import type { CharacterProfileStore } from '../storage/character-profile-store';
import { normalizeCursorToWorkArea } from './global-tracking';
import { isTrustedIpcSender } from './sender-validation';

export interface IpcWindowController {
  getWindow(): BrowserWindow | undefined;
  getScale(): number;
  setScale(scale: number): number;
  setChatPanelExpanded(expanded: boolean, settingsExpanded?: boolean): void;
}

const requireTrustedSender = (
  event: Parameters<typeof isTrustedIpcSender>[0],
  windows: IpcWindowController,
): void => {
  if (!isTrustedIpcSender(event, windows.getWindow())) {
    throw new Error('Unauthorized IPC sender.');
  }
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

export const registerIpcHandlers = (
  windows: IpcWindowController,
  models: ModelRuntime,
  conversations: ConversationRuntime,
  profiles: CharacterProfileStore,
  memories: MemoryService,
  characterResearch: CharacterResearchService,
  workGlossary: WorkGlossaryService,
  desktopIntegrations?: DesktopIntegrationService,
  characterPackages?: CharacterPackageService,
): void => {
  ipcMain.handle(IPC_CHANNELS.getAppVersion, (event) => {
    requireTrustedSender(event, windows);
    return app.getVersion();
  });

  ipcMain.handle(IPC_CHANNELS.getGlobalTrackingPoint, (event) => {
    if (!isTrustedIpcSender(event, windows.getWindow())) {
      return undefined;
    }
    const window = windows.getWindow();
    if (!window) {
      return undefined;
    }
    const bounds = window.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    return normalizeCursorToWorkArea(screen.getCursorScreenPoint(), workArea);
  });

  ipcMain.handle(IPC_CHANNELS.listModelProviders, (event) => {
    requireTrustedSender(event, windows);
    return models.listProviders();
  });
  ipcMain.handle(IPC_CHANNELS.getProviderConfiguration, async (event) => {
    requireTrustedSender(event, windows);
    return models.getConfiguration();
  });
  ipcMain.handle(IPC_CHANNELS.setProviderConfiguration, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return runModelOperation(() => models.setConfiguration(parseProviderConfiguration(input)));
  });
  ipcMain.handle(IPC_CHANNELS.getProviderSecretStatus, async (event) => {
    requireTrustedSender(event, windows);
    return models.getSecretStatus();
  });
  ipcMain.handle(IPC_CHANNELS.setProviderSecret, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return runModelOperation(() => {
      const parsed = parseSetProviderSecretInput(input);
      return models.setSecret(parsed.providerId, parsed.apiKey);
    });
  });
  ipcMain.handle(IPC_CHANNELS.deleteProviderSecret, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return runModelOperation(() => {
      const parsed = parseDeleteProviderSecretInput(input);
      return models.deleteSecret(parsed.providerId);
    });
  });
  ipcMain.handle(IPC_CHANNELS.testProviderConnection, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return models.testConnection(parseTestProviderConnectionInput(input));
  });
  ipcMain.handle(IPC_CHANNELS.cancelProviderRequest, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return models.cancel(parseCancelProviderRequestInput(input).requestId);
  });

  ipcMain.handle(IPC_CHANNELS.getConversationConfiguration, async (event) => {
    requireTrustedSender(event, windows);
    return models.getConversationConfiguration();
  });
  ipcMain.handle(IPC_CHANNELS.setConversationConfiguration, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return runModelOperation(() =>
      models.setConversationConfiguration(parseConversationConfiguration(input)),
    );
  });
  ipcMain.handle(IPC_CHANNELS.getCharacterProfile, async (event) => {
    requireTrustedSender(event, windows);
    return profiles.get();
  });
  ipcMain.handle(IPC_CHANNELS.setCharacterProfile, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return runModelOperation(() =>
      conversations.setCharacterProfile(parseCharacterProfileInput(input)),
    );
  });
  ipcMain.handle(IPC_CHANNELS.getConversationHistory, async (event) => {
    requireTrustedSender(event, windows);
    return conversations.listHistory();
  });
  ipcMain.handle(IPC_CHANNELS.clearConversationHistory, (event) => {
    requireTrustedSender(event, windows);
    return runModelOperation(() => conversations.clearHistory());
  });
  ipcMain.handle(IPC_CHANNELS.startConversation, (event, input: unknown) => {
    requireTrustedSender(event, windows);
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
  ipcMain.handle(IPC_CHANNELS.cancelConversation, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return conversations.cancel(parseCancelConversationInput(input).requestId);
  });

  ipcMain.handle(
    IPC_CHANNELS.searchCharacters,
    async (event, input: unknown): Promise<CharacterSearchResult> => {
      requireTrustedSender(event, windows);
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
  ipcMain.handle(
    IPC_CHANNELS.buildCharacterDraft,
    async (event, input: unknown): Promise<CharacterDraftResult> => {
      requireTrustedSender(event, windows);
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
  ipcMain.handle(IPC_CHANNELS.cancelCharacterResearch, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return characterResearch.cancel(parseCancelCharacterResearchInput(input).requestId);
  });
  ipcMain.handle(IPC_CHANNELS.listCharacters, (event) => {
    requireTrustedSender(event, windows);
    return characterPackages?.list() ?? [];
  });
  ipcMain.handle(
    IPC_CHANNELS.previewCharacterPackage,
    async (event): Promise<CharacterPackageFileResult> => {
      requireTrustedSender(event, windows);
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
  ipcMain.handle(
    IPC_CHANNELS.confirmCharacterPackageImport,
    async (event, input: unknown): Promise<CharacterPackageFileResult> => {
      requireTrustedSender(event, windows);
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
  ipcMain.handle(
    IPC_CHANNELS.exportActiveCharacterPackage,
    async (event): Promise<CharacterPackageFileResult> => {
      requireTrustedSender(event, windows);
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
  ipcMain.handle(IPC_CHANNELS.activateCharacter, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return runModelOperation(async () => {
      if (!characterPackages) throw new Error();
      await characterPackages.activate(parseCharacterIdInput(input).characterId);
    }, '角色切换失败。');
  });
  ipcMain.handle(IPC_CHANNELS.removeCharacter, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return runModelOperation(async () => {
      if (!characterPackages) throw new Error();
      await characterPackages.remove(parseCharacterIdInput(input).characterId);
    }, '角色删除失败。');
  });
  ipcMain.handle(IPC_CHANNELS.getActiveCharacterModelManifest, async (event) => {
    requireTrustedSender(event, windows);
    return characterPackages?.getActiveModelManifest();
  });
  ipcMain.handle(IPC_CHANNELS.getWorkGlossaryStatus, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return workGlossary.getStatus(parseWorkGlossaryInput(input).sourceWork);
  });
  ipcMain.handle(IPC_CHANNELS.syncWorkGlossary, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return workGlossary.sync(parseWorkGlossaryInput(input).sourceWork);
  });

  ipcMain.handle(IPC_CHANNELS.getMemorySettings, (event) => {
    requireTrustedSender(event, windows);
    return memories.getSettings();
  });
  ipcMain.handle(IPC_CHANNELS.setMemorySettings, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return runMemoryOperation(() => {
      const parsed = parseSetMemorySettingsInput(input);
      return memories.setSettings(parsed);
    });
  });
  ipcMain.handle(IPC_CHANNELS.listMemories, async (event) => {
    requireTrustedSender(event, windows);
    const profile = await profiles.get();
    return memories.list(profile.memoryNamespace);
  });
  ipcMain.handle(IPC_CHANNELS.listMemoryCandidates, async (event) => {
    requireTrustedSender(event, windows);
    const profile = await profiles.get();
    return memories.listCandidates(profile.memoryNamespace);
  });
  ipcMain.handle(IPC_CHANNELS.updateMemoryCandidate, async (event, input: unknown) => {
    requireTrustedSender(event, windows);
    const parsed = parseUpdateMemoryCandidateInput(input);
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      if (!memories.updateCandidate(profile.memoryNamespace, parsed.id, parsed.candidate)) {
        throw new Error('Memory candidate not found.');
      }
    });
  });
  ipcMain.handle(IPC_CHANNELS.mergeMemoryCandidates, async (event, input: unknown) => {
    requireTrustedSender(event, windows);
    const parsed = parseMergeMemoryCandidatesInput(input);
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      if (!memories.mergeCandidates(profile.memoryNamespace, parsed.targetId, parsed.sourceId)) {
        throw new Error('Memory candidates cannot be merged.');
      }
    });
  });
  ipcMain.handle(IPC_CHANNELS.confirmMemoryCandidate, async (event, input: unknown) => {
    requireTrustedSender(event, windows);
    const { id, conflictResolution } = parseConfirmMemoryCandidateInput(input);
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      if (!memories.confirmCandidate(profile.memoryNamespace, id, conflictResolution)) {
        throw new Error('Memory candidate not found.');
      }
    });
  });
  ipcMain.handle(IPC_CHANNELS.rejectMemoryCandidate, async (event, input: unknown) => {
    requireTrustedSender(event, windows);
    const { id } = parseMemoryIdInput(input);
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      if (!memories.rejectCandidate(profile.memoryNamespace, id)) {
        throw new Error('Memory candidate not found.');
      }
    });
  });
  ipcMain.handle(IPC_CHANNELS.updateMemory, async (event, input: unknown) => {
    requireTrustedSender(event, windows);
    const parsed = parseUpdateMemoryInput(input);
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      if (!memories.update(profile.memoryNamespace, parsed.id, parsed.candidate)) {
        throw new Error('Memory not found.');
      }
    });
  });
  ipcMain.handle(IPC_CHANNELS.deleteMemory, async (event, input: unknown) => {
    requireTrustedSender(event, windows);
    const { id } = parseMemoryIdInput(input);
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      if (!memories.delete(profile.memoryNamespace, id)) {
        throw new Error('Memory not found.');
      }
    });
  });
  ipcMain.handle(IPC_CHANNELS.clearMemories, async (event) => {
    requireTrustedSender(event, windows);
    const profile = await profiles.get();
    return runMemoryOperation(() => {
      memories.clear(profile.memoryNamespace);
    });
  });
  ipcMain.handle(IPC_CHANNELS.exportMemories, async (event): Promise<MemoryFileOperationResult> => {
    requireTrustedSender(event, windows);
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
  ipcMain.handle(IPC_CHANNELS.backupMemory, async (event): Promise<MemoryFileOperationResult> => {
    requireTrustedSender(event, windows);
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
      return { ok: false, canceled: false, message: 'SQLite 数据库备份失败。' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.getWindowScale, (event) => {
    requireTrustedSender(event, windows);
    return windows.getScale();
  });
  ipcMain.handle(IPC_CHANNELS.setWindowScale, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return windows.setScale(parseSetWindowScaleInput(input).scale);
  });
  ipcMain.handle(IPC_CHANNELS.setChatPanelExpanded, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    const parsed = parseSetChatPanelExpandedInput(input);
    windows.setChatPanelExpanded(parsed.expanded, parsed.view === 'settings');
  });
  ipcMain.handle(
    IPC_CHANNELS.getDesktopIntegrationStatus,
    async (event): Promise<DesktopIntegrationStatus> => {
      requireTrustedSender(event, windows);
      return desktopIntegrations
        ? desktopIntegrations.getStatus()
        : {
            settings: {
              globalShortcutsEnabled: false,
              mediaControlEnabled: false,
              visibilityShortcut: '\\',
              stopGenerationShortcut: 'Ctrl+Shift+Delete',
            },
            shortcutRegistered: false,
            stopGenerationShortcutRegistered: false,
            media: { supported: false },
          };
    },
  );
  ipcMain.handle(IPC_CHANNELS.setDesktopIntegrationSettings, async (event, input: unknown) => {
    requireTrustedSender(event, windows);
    const { settings } = parseSetDesktopIntegrationSettingsInput(input);
    await desktopIntegrations?.setSettings(settings);
  });
  ipcMain.handle(IPC_CHANNELS.sendMediaCommand, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return desktopIntegrations?.sendMediaCommand(parseMediaCommandInput(input).command) ?? false;
  });
};
