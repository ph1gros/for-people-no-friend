import { contextBridge, ipcRenderer } from 'electron';

import type { CharacterProfile } from '../core/conversation/character-profile';
import type {
  BuildCharacterDraftInput,
  CancelCharacterResearchInput,
  SearchCharactersInput,
} from '../shared/character-research-ipc';
import {
  parseConversationEvent,
  type CancelConversationInput,
  type ConversationConfiguration,
  type StartConversationInput,
} from '../shared/conversation-ipc';
import type {
  MediaCommandInput,
  SetDesktopIntegrationSettingsInput,
} from '../shared/desktop-integration-ipc';
import { type DeskpetApi, IPC_CHANNELS } from '../shared/ipc';
import type {
  ConfirmMemoryCandidateInput,
  MergeMemoryCandidatesInput,
  MemoryIdInput,
  SetMemorySettingsInput,
  UpdateMemoryCandidateInput,
  UpdateMemoryInput,
} from '../shared/memory-ipc';
import type {
  CancelProviderRequestInput,
  DeleteProviderSecretInput,
  ProviderConfiguration,
  SetProviderSecretInput,
  TestProviderConnectionInput,
} from '../shared/model-ipc';
import {
  MAX_WINDOW_SCALE,
  MIN_WINDOW_SCALE,
  type SetChatPanelExpandedInput,
  type SetWindowScaleInput,
} from '../shared/window-ipc';
import type { WorkGlossaryInput } from '../shared/work-glossary-ipc';

const deskpetApi: DeskpetApi = Object.freeze({
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion) as Promise<string>,
  getGlobalTrackingPoint: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getGlobalTrackingPoint) as Promise<
      { x: number; y: number } | undefined
    >,
  listModelProviders: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listModelProviders) as ReturnType<
      DeskpetApi['listModelProviders']
    >,
  getProviderConfiguration: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getProviderConfiguration) as ReturnType<
      DeskpetApi['getProviderConfiguration']
    >,
  setProviderConfiguration: (configuration: ProviderConfiguration) =>
    ipcRenderer.invoke(IPC_CHANNELS.setProviderConfiguration, configuration) as ReturnType<
      DeskpetApi['setProviderConfiguration']
    >,
  getProviderSecretStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getProviderSecretStatus) as ReturnType<
      DeskpetApi['getProviderSecretStatus']
    >,
  setProviderSecret: (input: SetProviderSecretInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setProviderSecret, input) as ReturnType<
      DeskpetApi['setProviderSecret']
    >,
  deleteProviderSecret: (input: DeleteProviderSecretInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteProviderSecret, input) as ReturnType<
      DeskpetApi['deleteProviderSecret']
    >,
  testProviderConnection: (input: TestProviderConnectionInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.testProviderConnection, input) as ReturnType<
      DeskpetApi['testProviderConnection']
    >,
  cancelProviderRequest: (input: CancelProviderRequestInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelProviderRequest, input) as ReturnType<
      DeskpetApi['cancelProviderRequest']
    >,
  getConversationConfiguration: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getConversationConfiguration) as ReturnType<
      DeskpetApi['getConversationConfiguration']
    >,
  setConversationConfiguration: (configuration: ConversationConfiguration) =>
    ipcRenderer.invoke(IPC_CHANNELS.setConversationConfiguration, configuration) as ReturnType<
      DeskpetApi['setConversationConfiguration']
    >,
  getCharacterProfile: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getCharacterProfile) as ReturnType<
      DeskpetApi['getCharacterProfile']
    >,
  setCharacterProfile: (profile: CharacterProfile) =>
    ipcRenderer.invoke(IPC_CHANNELS.setCharacterProfile, profile) as ReturnType<
      DeskpetApi['setCharacterProfile']
    >,
  getConversationHistory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getConversationHistory) as ReturnType<
      DeskpetApi['getConversationHistory']
    >,
  clearConversationHistory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.clearConversationHistory) as ReturnType<
      DeskpetApi['clearConversationHistory']
    >,
  startConversation: (input: StartConversationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.startConversation, input) as ReturnType<
      DeskpetApi['startConversation']
    >,
  cancelConversation: (input: CancelConversationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelConversation, input) as ReturnType<
      DeskpetApi['cancelConversation']
    >,
  onConversationEvent: (listener: Parameters<DeskpetApi['onConversationEvent']>[0]) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const parsed = parseConversationEvent(payload);
      if (parsed) {
        listener(parsed);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.conversationEvent, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.conversationEvent, wrapped);
  },
  searchCharacters: (input: SearchCharactersInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.searchCharacters, input) as ReturnType<
      DeskpetApi['searchCharacters']
    >,
  buildCharacterDraft: (input: BuildCharacterDraftInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.buildCharacterDraft, input) as ReturnType<
      DeskpetApi['buildCharacterDraft']
    >,
  cancelCharacterResearch: (input: CancelCharacterResearchInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelCharacterResearch, input) as ReturnType<
      DeskpetApi['cancelCharacterResearch']
    >,
  getWorkGlossaryStatus: (input: WorkGlossaryInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorkGlossaryStatus, input) as ReturnType<
      DeskpetApi['getWorkGlossaryStatus']
    >,
  syncWorkGlossary: (input: WorkGlossaryInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.syncWorkGlossary, input) as ReturnType<
      DeskpetApi['syncWorkGlossary']
    >,
  getMemorySettings: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getMemorySettings) as ReturnType<
      DeskpetApi['getMemorySettings']
    >,
  setMemorySettings: (input: SetMemorySettingsInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setMemorySettings, input) as ReturnType<
      DeskpetApi['setMemorySettings']
    >,
  listMemories: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listMemories) as ReturnType<DeskpetApi['listMemories']>,
  listMemoryCandidates: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listMemoryCandidates) as ReturnType<
      DeskpetApi['listMemoryCandidates']
    >,
  updateMemoryCandidate: (input: UpdateMemoryCandidateInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateMemoryCandidate, input) as ReturnType<
      DeskpetApi['updateMemoryCandidate']
    >,
  mergeMemoryCandidates: (input: MergeMemoryCandidatesInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.mergeMemoryCandidates, input) as ReturnType<
      DeskpetApi['mergeMemoryCandidates']
    >,
  confirmMemoryCandidate: (input: ConfirmMemoryCandidateInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.confirmMemoryCandidate, input) as ReturnType<
      DeskpetApi['confirmMemoryCandidate']
    >,
  rejectMemoryCandidate: (input: MemoryIdInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.rejectMemoryCandidate, input) as ReturnType<
      DeskpetApi['rejectMemoryCandidate']
    >,
  updateMemory: (input: UpdateMemoryInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateMemory, input) as ReturnType<DeskpetApi['updateMemory']>,
  deleteMemory: (input: MemoryIdInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteMemory, input) as ReturnType<DeskpetApi['deleteMemory']>,
  exportMemories: () =>
    ipcRenderer.invoke(IPC_CHANNELS.exportMemories) as ReturnType<DeskpetApi['exportMemories']>,
  backupMemory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.backupMemory) as ReturnType<DeskpetApi['backupMemory']>,
  clearMemories: () =>
    ipcRenderer.invoke(IPC_CHANNELS.clearMemories) as ReturnType<DeskpetApi['clearMemories']>,
  getWindowScale: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getWindowScale) as ReturnType<DeskpetApi['getWindowScale']>,
  setWindowScale: (input: SetWindowScaleInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setWindowScale, input) as ReturnType<
      DeskpetApi['setWindowScale']
    >,
  onWindowScaleChanged: (listener: Parameters<DeskpetApi['onWindowScaleChanged']>[0]) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      if (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= MIN_WINDOW_SCALE &&
        value <= MAX_WINDOW_SCALE
      ) {
        listener(value);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.windowScaleChanged, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.windowScaleChanged, wrapped);
  },
  setChatPanelExpanded: (input: SetChatPanelExpandedInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setChatPanelExpanded, input) as ReturnType<
      DeskpetApi['setChatPanelExpanded']
    >,
  getDesktopIntegrationStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getDesktopIntegrationStatus) as ReturnType<
      DeskpetApi['getDesktopIntegrationStatus']
    >,
  setDesktopIntegrationSettings: (input: SetDesktopIntegrationSettingsInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setDesktopIntegrationSettings, input) as ReturnType<
      DeskpetApi['setDesktopIntegrationSettings']
    >,
  sendMediaCommand: (input: MediaCommandInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.sendMediaCommand, input) as ReturnType<
      DeskpetApi['sendMediaCommand']
    >,
});

contextBridge.exposeInMainWorld('deskpet', deskpetApi);
