import { contextBridge, ipcRenderer } from 'electron';

import type { CharacterProfile } from '../core/conversation/character-profile';
import type { SetCharacterDisplayModeInput } from '../shared/character-display-ipc';
import type {
  CharacterIdInput,
  ConfirmCharacterPackageImportInput,
  CreateLocalCharacterInput,
} from '../shared/character-package-ipc';
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
import {
  parseDesktopInputActivityEvent,
  type MediaCommandInput,
  type SetDesktopWidgetEnabledInput,
  type SetDesktopIntegrationSettingsInput,
} from '../shared/desktop-integration-ipc';
import type { SetDesktopLayoutSettingsInput } from '../shared/desktop-layout-ipc';
import { type DeskpetApi, IPC_CHANNELS } from '../shared/ipc';
import {
  SOCIAL_IPC_CHANNELS,
  type DeskpetSocialApi,
  type KookPresenceApi,
  type OopzPresenceApi,
  type QqPresenceApi,
} from '../shared/social-ipc';
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
import {
  parseSpeechSynthesisResult,
  parseSpeechTranscriptionResult,
  type CancelSpeechInput,
  type SetSpeechSecretInput,
  type SetSpeechSettingsInput,
  type SpeechSynthesisInput,
  type SpeechTranscriptionInput,
} from '../shared/speech-ipc';
import type { SpeechAssetControlInput } from '../shared/speech-asset-ipc';
import type { SetViewerExSettingsInput, ViewerExPresentationInput } from '../shared/viewerex-ipc';
import type {
  SetVTubeStudioSettingsInput,
  VTubeStudioExpressionPreviewInput,
  VTubeStudioPresentationInput,
} from '../shared/vtube-studio-ipc';
import type {
  ImportDroppedWorkspaceFilesInput,
  ResolveAssistantToolApprovalInput,
} from '../shared/assistant-tools-ipc';

const social: DeskpetSocialApi = Object.freeze({
  getQqPresence: () =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.getQqPresence) as ReturnType<
      QqPresenceApi['getQqPresence']
    >,
  saveQqPresence: (input: Parameters<QqPresenceApi['saveQqPresence']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.saveQqPresence, input) as ReturnType<
      QqPresenceApi['saveQqPresence']
    >,
  connectQqPresence: (input: Parameters<QqPresenceApi['connectQqPresence']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.connectQqPresence, input) as ReturnType<
      QqPresenceApi['connectQqPresence']
    >,
  disconnectQqPresence: (input: Parameters<QqPresenceApi['disconnectQqPresence']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.disconnectQqPresence, input) as ReturnType<
      QqPresenceApi['disconnectQqPresence']
    >,
  deleteQqSecret: (input: Parameters<QqPresenceApi['deleteQqSecret']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.deleteQqSecret, input) as ReturnType<
      QqPresenceApi['deleteQqSecret']
    >,
  getKookPresence: () =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.getKookPresence) as ReturnType<
      KookPresenceApi['getKookPresence']
    >,
  saveKookPresence: (input: Parameters<KookPresenceApi['saveKookPresence']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.saveKookPresence, input) as ReturnType<
      KookPresenceApi['saveKookPresence']
    >,
  connectKookPresence: (input: Parameters<KookPresenceApi['connectKookPresence']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.connectKookPresence, input) as ReturnType<
      KookPresenceApi['connectKookPresence']
    >,
  disconnectKookPresence: (input: Parameters<KookPresenceApi['disconnectKookPresence']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.disconnectKookPresence, input) as ReturnType<
      KookPresenceApi['disconnectKookPresence']
    >,
  deleteKookSecret: (input: Parameters<KookPresenceApi['deleteKookSecret']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.deleteKookSecret, input) as ReturnType<
      KookPresenceApi['deleteKookSecret']
    >,
  controlKookVoice: (input: Parameters<NonNullable<KookPresenceApi['controlKookVoice']>>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.controlKookVoice, input) as Promise<
      Awaited<ReturnType<KookPresenceApi['getKookPresence']>>
    >,
  getOopzPresence: () =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.getOopzPresence) as ReturnType<
      OopzPresenceApi['getOopzPresence']
    >,
  saveOopzPresence: (input: Parameters<OopzPresenceApi['saveOopzPresence']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.saveOopzPresence, input) as ReturnType<
      OopzPresenceApi['saveOopzPresence']
    >,
  startOopzBridge: (input: Parameters<OopzPresenceApi['startOopzBridge']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.startOopzBridge, input) as ReturnType<
      OopzPresenceApi['startOopzBridge']
    >,
  stopOopzBridge: (input: Parameters<OopzPresenceApi['stopOopzBridge']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.stopOopzBridge, input) as ReturnType<
      OopzPresenceApi['stopOopzBridge']
    >,
  connectOopzPresence: (input: Parameters<OopzPresenceApi['connectOopzPresence']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.connectOopzPresence, input) as ReturnType<
      OopzPresenceApi['connectOopzPresence']
    >,
  disconnectOopzPresence: (input: Parameters<OopzPresenceApi['disconnectOopzPresence']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.disconnectOopzPresence, input) as ReturnType<
      OopzPresenceApi['disconnectOopzPresence']
    >,
  deleteOopzSecret: (input: Parameters<OopzPresenceApi['deleteOopzSecret']>[0]) =>
    ipcRenderer.invoke(SOCIAL_IPC_CHANNELS.deleteOopzSecret, input) as ReturnType<
      OopzPresenceApi['deleteOopzSecret']
    >,
});

const deskpetApi: DeskpetApi = Object.freeze({
  social,
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion) as Promise<string>,
  openDiagnosticLog: () =>
    ipcRenderer.invoke(IPC_CHANNELS.openDiagnosticLog) as ReturnType<
      DeskpetApi['openDiagnosticLog']
    >,
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
  generateContextualOpeningLine: () =>
    ipcRenderer.invoke(IPC_CHANNELS.generateContextualOpeningLine) as ReturnType<
      DeskpetApi['generateContextualOpeningLine']
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
  getAssistantToolStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getAssistantToolStatus) as ReturnType<
      DeskpetApi['getAssistantToolStatus']
    >,
  selectAssistantWorkspace: () =>
    ipcRenderer.invoke(IPC_CHANNELS.selectAssistantWorkspace) as ReturnType<
      DeskpetApi['selectAssistantWorkspace']
    >,
  importDroppedWorkspaceFiles: (input: ImportDroppedWorkspaceFilesInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.importDroppedWorkspaceFiles, input) as ReturnType<
      DeskpetApi['importDroppedWorkspaceFiles']
    >,
  resolveAssistantToolApproval: (input: ResolveAssistantToolApprovalInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.resolveAssistantToolApproval, input) as ReturnType<
      DeskpetApi['resolveAssistantToolApproval']
    >,
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
  listCharacters: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listCharacters) as ReturnType<DeskpetApi['listCharacters']>,
  createLocalCharacter: (input: CreateLocalCharacterInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.createLocalCharacter, input) as ReturnType<
      DeskpetApi['createLocalCharacter']
    >,
  clearInactiveCharacters: () =>
    ipcRenderer.invoke(IPC_CHANNELS.clearInactiveCharacters) as ReturnType<
      DeskpetApi['clearInactiveCharacters']
    >,
  previewCharacterPackage: () =>
    ipcRenderer.invoke(IPC_CHANNELS.previewCharacterPackage) as ReturnType<
      DeskpetApi['previewCharacterPackage']
    >,
  confirmCharacterPackageImport: (input: ConfirmCharacterPackageImportInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.confirmCharacterPackageImport, input) as ReturnType<
      DeskpetApi['confirmCharacterPackageImport']
    >,
  exportActiveCharacterPackage: () =>
    ipcRenderer.invoke(IPC_CHANNELS.exportActiveCharacterPackage) as ReturnType<
      DeskpetApi['exportActiveCharacterPackage']
    >,
  activateCharacter: (input: CharacterIdInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.activateCharacter, input) as ReturnType<
      DeskpetApi['activateCharacter']
    >,
  removeCharacter: (input: CharacterIdInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.removeCharacter, input) as ReturnType<
      DeskpetApi['removeCharacter']
    >,
  getActiveCharacterModelManifest: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getActiveCharacterModelManifest) as ReturnType<
      DeskpetApi['getActiveCharacterModelManifest']
    >,
  importLive2DModel: () =>
    ipcRenderer.invoke(IPC_CHANNELS.importLive2DModel) as ReturnType<
      DeskpetApi['importLive2DModel']
    >,
  exportActiveLive2DModel: () =>
    ipcRenderer.invoke(IPC_CHANNELS.exportActiveLive2DModel) as ReturnType<
      DeskpetApi['exportActiveLive2DModel']
    >,
  getCharacterDisplayMode: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getCharacterDisplayMode) as ReturnType<
      DeskpetApi['getCharacterDisplayMode']
    >,
  setCharacterDisplayMode: (input: SetCharacterDisplayModeInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setCharacterDisplayMode, input) as ReturnType<
      DeskpetApi['setCharacterDisplayMode']
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
  getDesktopLayoutSettings: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getDesktopLayoutSettings) as ReturnType<
      DeskpetApi['getDesktopLayoutSettings']
    >,
  setDesktopLayoutSettings: (input: SetDesktopLayoutSettingsInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setDesktopLayoutSettings, input) as ReturnType<
      DeskpetApi['setDesktopLayoutSettings']
    >,
  getDesktopIntegrationStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getDesktopIntegrationStatus) as ReturnType<
      DeskpetApi['getDesktopIntegrationStatus']
    >,
  setDesktopIntegrationSettings: (input: SetDesktopIntegrationSettingsInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setDesktopIntegrationSettings, input) as ReturnType<
      DeskpetApi['setDesktopIntegrationSettings']
    >,
  setDesktopWidgetEnabled: (input: SetDesktopWidgetEnabledInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setDesktopWidgetEnabled, input) as ReturnType<
      DeskpetApi['setDesktopWidgetEnabled']
    >,
  sendMediaCommand: (input: MediaCommandInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.sendMediaCommand, input) as ReturnType<
      DeskpetApi['sendMediaCommand']
    >,
  onDesktopInputActivity: (listener: Parameters<DeskpetApi['onDesktopInputActivity']>[0]) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      try {
        listener(parseDesktopInputActivityEvent(value));
      } catch {
        // Ignore malformed Main-to-Renderer input activity events.
      }
    };
    ipcRenderer.on(IPC_CHANNELS.desktopInputActivity, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.desktopInputActivity, wrapped);
  },
  getSpeechStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getSpeechStatus) as ReturnType<DeskpetApi['getSpeechStatus']>,
  setSpeechSettings: (input: SetSpeechSettingsInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setSpeechSettings, input) as ReturnType<
      DeskpetApi['setSpeechSettings']
    >,
  setSpeechSecret: (input: SetSpeechSecretInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setSpeechSecret, input) as ReturnType<
      DeskpetApi['setSpeechSecret']
    >,
  deleteSpeechSecret: () =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteSpeechSecret) as ReturnType<
      DeskpetApi['deleteSpeechSecret']
    >,
  synthesizeSpeech: async (input: SpeechSynthesisInput) =>
    parseSpeechSynthesisResult(await ipcRenderer.invoke(IPC_CHANNELS.synthesizeSpeech, input)),
  transcribeSpeech: async (input: SpeechTranscriptionInput) =>
    parseSpeechTranscriptionResult(await ipcRenderer.invoke(IPC_CHANNELS.transcribeSpeech, input)),
  cancelSpeech: (input: CancelSpeechInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelSpeech, input) as ReturnType<DeskpetApi['cancelSpeech']>,
  getLocalSpeechAssetStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getLocalSpeechAssetStatus) as ReturnType<
      DeskpetApi['getLocalSpeechAssetStatus']
    >,
  getSpeechAssetDownloadStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getSpeechAssetDownloadStatus) as ReturnType<
      DeskpetApi['getSpeechAssetDownloadStatus']
    >,
  openResourceCenter: () => ipcRenderer.invoke(IPC_CHANNELS.openResourceCenter) as Promise<void>,
  getResourceCenterStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getResourceCenterStatus) as ReturnType<
      DeskpetApi['getResourceCenterStatus']
    >,
  refreshResourceCatalog: () =>
    ipcRenderer.invoke(IPC_CHANNELS.refreshResourceCatalog) as ReturnType<
      DeskpetApi['refreshResourceCatalog']
    >,
  controlSpeechAssetDownload: (input: SpeechAssetControlInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.controlSpeechAssetDownload, input) as ReturnType<
      DeskpetApi['controlSpeechAssetDownload']
    >,
  exportLocalVoice: () =>
    ipcRenderer.invoke(IPC_CHANNELS.exportLocalVoice) as ReturnType<DeskpetApi['exportLocalVoice']>,
  openSpeechTrainingSources: () =>
    ipcRenderer.invoke(IPC_CHANNELS.openSpeechTrainingSources) as ReturnType<
      DeskpetApi['openSpeechTrainingSources']
    >,
  launchSpeechTrainer: () =>
    ipcRenderer.invoke(IPC_CHANNELS.launchSpeechTrainer) as ReturnType<
      DeskpetApi['launchSpeechTrainer']
    >,
  getViewerExStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getViewerExStatus) as ReturnType<
      DeskpetApi['getViewerExStatus']
    >,
  setViewerExSettings: (input: SetViewerExSettingsInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setViewerExSettings, input) as ReturnType<
      DeskpetApi['setViewerExSettings']
    >,
  presentInViewerEx: (input: ViewerExPresentationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.presentInViewerEx, input) as ReturnType<
      DeskpetApi['presentInViewerEx']
    >,
  getVTubeStudioStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getVTubeStudioStatus) as ReturnType<
      DeskpetApi['getVTubeStudioStatus']
    >,
  launchVTubeStudio: () =>
    ipcRenderer.invoke(IPC_CHANNELS.launchVTubeStudio) as ReturnType<
      DeskpetApi['launchVTubeStudio']
    >,
  installBundledVTubeStudioModel: () =>
    ipcRenderer.invoke(IPC_CHANNELS.installBundledVTubeStudioModel) as ReturnType<
      DeskpetApi['installBundledVTubeStudioModel']
    >,
  setVTubeStudioSettings: (input: SetVTubeStudioSettingsInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.setVTubeStudioSettings, input) as ReturnType<
      DeskpetApi['setVTubeStudioSettings']
    >,
  authorizeVTubeStudio: () =>
    ipcRenderer.invoke(IPC_CHANNELS.authorizeVTubeStudio) as ReturnType<
      DeskpetApi['authorizeVTubeStudio']
    >,
  inspectVTubeStudio: () =>
    ipcRenderer.invoke(IPC_CHANNELS.inspectVTubeStudio) as ReturnType<
      DeskpetApi['inspectVTubeStudio']
    >,
  previewVTubeStudioExpression: (input: VTubeStudioExpressionPreviewInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.previewVTubeStudioExpression, input) as ReturnType<
      DeskpetApi['previewVTubeStudioExpression']
    >,
  presentInVTubeStudio: (input: VTubeStudioPresentationInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.presentInVTubeStudio, input) as ReturnType<
      DeskpetApi['presentInVTubeStudio']
    >,
});

contextBridge.exposeInMainWorld('deskpet', deskpetApi);
