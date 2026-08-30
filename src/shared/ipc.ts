import type { CharacterProfile } from '../core/conversation/character-profile';
import type {
  CharacterDisplayMode,
  CharacterDisplayModeResult,
  SetCharacterDisplayModeInput,
} from './character-display-ipc';
import type {
  CharacterIdInput,
  CharacterLibraryEntry,
  CharacterPackageFileResult,
  ConfirmCharacterPackageImportInput,
  CreateLocalCharacterInput,
} from './character-package-ipc';
import type {
  BuildCharacterDraftInput,
  CancelCharacterResearchInput,
  CharacterDraftResult,
  CharacterSearchResult,
  SearchCharactersInput,
} from './character-research-ipc';
import type {
  CancelConversationInput,
  ConversationConfiguration,
  ConversationEvent,
  ConversationMessage,
  ContextualOpeningLineResult,
  StartConversationInput,
  StartConversationResult,
} from './conversation-ipc';
import type {
  DesktopInputActivityEvent,
  DesktopIntegrationStatus,
  MediaCommandInput,
  SetDesktopWidgetEnabledInput,
  SetDesktopIntegrationSettingsInput,
} from './desktop-integration-ipc';
import type { DesktopLayoutSettings, SetDesktopLayoutSettingsInput } from './desktop-layout-ipc';
import type {
  ConfirmMemoryCandidateInput,
  MergeMemoryCandidatesInput,
  MemoryCandidateListResult,
  MemoryFileOperationResult,
  MemoryIdInput,
  MemoryListResult,
  MemoryOperationResult,
  MemorySettings,
  SetMemorySettingsInput,
  UpdateMemoryCandidateInput,
  UpdateMemoryInput,
} from './memory-ipc';
import type {
  CancelProviderRequestInput,
  DeleteProviderSecretInput,
  ModelOperationResult,
  ProviderConfiguration,
  ProviderSecretStatus,
  ProviderSummary,
  SetProviderSecretInput,
  TestProviderConnectionInput,
  TestProviderConnectionResult,
} from './model-ipc';
import type { SetChatPanelExpandedInput, SetWindowScaleInput } from './window-ipc';
import type {
  CancelSpeechInput,
  SetSpeechSecretInput,
  SetSpeechSettingsInput,
  SpeechOperationResult,
  SpeechStatus,
  SpeechSynthesisInput,
  SpeechSynthesisResult,
  SpeechTranscriptionInput,
  SpeechTranscriptionResult,
} from './speech-ipc';
import type {
  WorkGlossaryInput,
  WorkGlossaryStatus,
  WorkGlossarySyncResult,
} from './work-glossary-ipc';
import type {
  SetViewerExSettingsInput,
  ViewerExOperationResult,
  ViewerExPresentationInput,
  ViewerExStatus,
} from './viewerex-ipc';
import type {
  SetVTubeStudioSettingsInput,
  VTubeStudioInspectResult,
  VTubeStudioExpressionPreviewInput,
  VTubeStudioOperationResult,
  VTubeStudioPresentationInput,
  VTubeStudioStatus,
} from './vtube-studio-ipc';
import type { Live2DModelImportResult } from './live2d-model-ipc';
import type {
  ConfirmAuthorizedVoiceUseInput,
  Live2DModelExportResult,
  LocalAssetOperationResult,
  LocalSpeechAssetStatus,
} from './local-asset-ipc';
import type {
  AssistantToolStatus,
  AssistantWorkspaceResult,
  ImportDroppedWorkspaceFilesInput,
  ImportDroppedWorkspaceFilesResult,
  ResolveAssistantToolApprovalInput,
} from './assistant-tools-ipc';

export const IPC_CHANNELS = {
  getAppVersion: 'app:getVersion',
  getGlobalTrackingPoint: 'tracking:getGlobalPoint',
  listModelProviders: 'model:listProviders',
  getProviderConfiguration: 'model:getProviderConfiguration',
  setProviderConfiguration: 'model:setProviderConfiguration',
  getProviderSecretStatus: 'model:getProviderSecretStatus',
  setProviderSecret: 'model:setProviderSecret',
  deleteProviderSecret: 'model:deleteProviderSecret',
  testProviderConnection: 'model:testProviderConnection',
  cancelProviderRequest: 'model:cancelProviderRequest',
  getConversationConfiguration: 'conversation:getConfiguration',
  setConversationConfiguration: 'conversation:setConfiguration',
  getCharacterProfile: 'conversation:getCharacterProfile',
  setCharacterProfile: 'conversation:setCharacterProfile',
  getConversationHistory: 'conversation:getHistory',
  clearConversationHistory: 'conversation:clearHistory',
  generateContextualOpeningLine: 'conversation:generateOpeningLine',
  startConversation: 'conversation:start',
  cancelConversation: 'conversation:cancel',
  conversationEvent: 'conversation:event',
  getAssistantToolStatus: 'assistant:getToolStatus',
  selectAssistantWorkspace: 'assistant:selectWorkspace',
  importDroppedWorkspaceFiles: 'assistant:importDroppedWorkspaceFiles',
  resolveAssistantToolApproval: 'assistant:resolveToolApproval',
  searchCharacters: 'character:search',
  buildCharacterDraft: 'character:buildDraft',
  cancelCharacterResearch: 'character:cancelResearch',
  listCharacters: 'character:list',
  createLocalCharacter: 'character:createLocal',
  clearInactiveCharacters: 'character:clearInactive',
  previewCharacterPackage: 'character:previewPackage',
  confirmCharacterPackageImport: 'character:confirmPackageImport',
  exportActiveCharacterPackage: 'character:exportActivePackage',
  activateCharacter: 'character:activate',
  removeCharacter: 'character:remove',
  getActiveCharacterModelManifest: 'character:getActiveModelManifest',
  importLive2DModel: 'live2d:importModel',
  exportActiveLive2DModel: 'live2d:exportActiveModel',
  getCharacterDisplayMode: 'characterDisplay:getMode',
  setCharacterDisplayMode: 'characterDisplay:setMode',
  getWorkGlossaryStatus: 'glossary:getStatus',
  syncWorkGlossary: 'glossary:sync',
  getMemorySettings: 'memory:getSettings',
  setMemorySettings: 'memory:setSettings',
  listMemories: 'memory:list',
  listMemoryCandidates: 'memory:listCandidates',
  updateMemoryCandidate: 'memory:updateCandidate',
  mergeMemoryCandidates: 'memory:mergeCandidates',
  confirmMemoryCandidate: 'memory:confirmCandidate',
  rejectMemoryCandidate: 'memory:rejectCandidate',
  updateMemory: 'memory:update',
  deleteMemory: 'memory:delete',
  exportMemories: 'memory:export',
  backupMemory: 'memory:backup',
  clearMemories: 'memory:clear',
  getWindowScale: 'window:getScale',
  setWindowScale: 'window:setScale',
  windowScaleChanged: 'window:scaleChanged',
  setChatPanelExpanded: 'window:setChatPanelExpanded',
  getDesktopLayoutSettings: 'window:getDesktopLayoutSettings',
  setDesktopLayoutSettings: 'window:setDesktopLayoutSettings',
  getDesktopIntegrationStatus: 'desktop:getIntegrationStatus',
  setDesktopIntegrationSettings: 'desktop:setIntegrationSettings',
  setDesktopWidgetEnabled: 'desktop:setWidgetEnabled',
  sendMediaCommand: 'desktop:sendMediaCommand',
  desktopInputActivity: 'desktop:inputActivity',
  getSpeechStatus: 'speech:getStatus',
  setSpeechSettings: 'speech:setSettings',
  setSpeechSecret: 'speech:setSecret',
  deleteSpeechSecret: 'speech:deleteSecret',
  synthesizeSpeech: 'speech:synthesize',
  transcribeSpeech: 'speech:transcribe',
  cancelSpeech: 'speech:cancel',
  getLocalSpeechAssetStatus: 'speechAssets:getStatus',
  exportLocalVoice: 'speechAssets:exportVoice',
  openSpeechTrainingSources: 'speechAssets:openTrainingSources',
  launchSpeechTrainer: 'speechAssets:launchTrainer',
  getViewerExStatus: 'viewerex:getStatus',
  setViewerExSettings: 'viewerex:setSettings',
  presentInViewerEx: 'viewerex:present',
  getVTubeStudioStatus: 'vtubeStudio:getStatus',
  launchVTubeStudio: 'vtubeStudio:launchSteam',
  installBundledVTubeStudioModel: 'vtubeStudio:installBundledModel',
  setVTubeStudioSettings: 'vtubeStudio:setSettings',
  authorizeVTubeStudio: 'vtubeStudio:authorize',
  inspectVTubeStudio: 'vtubeStudio:inspect',
  previewVTubeStudioExpression: 'vtubeStudio:previewExpression',
  presentInVTubeStudio: 'vtubeStudio:present',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const isAllowedIpcChannel = (channel: string): channel is IpcChannel =>
  Object.values(IPC_CHANNELS).includes(channel as IpcChannel);

export interface DeskpetApi {
  getAppVersion(): Promise<string>;
  getGlobalTrackingPoint(): Promise<{ x: number; y: number } | undefined>;
  listModelProviders(): Promise<ProviderSummary[]>;
  getProviderConfiguration(): Promise<ProviderConfiguration>;
  setProviderConfiguration(configuration: ProviderConfiguration): Promise<ModelOperationResult>;
  getProviderSecretStatus(): Promise<ProviderSecretStatus>;
  setProviderSecret(input: SetProviderSecretInput): Promise<ModelOperationResult>;
  deleteProviderSecret(input: DeleteProviderSecretInput): Promise<ModelOperationResult>;
  testProviderConnection(input: TestProviderConnectionInput): Promise<TestProviderConnectionResult>;
  cancelProviderRequest(input: CancelProviderRequestInput): Promise<boolean>;
  getConversationConfiguration(): Promise<ConversationConfiguration>;
  setConversationConfiguration(
    configuration: ConversationConfiguration,
  ): Promise<ModelOperationResult>;
  getCharacterProfile(): Promise<CharacterProfile>;
  setCharacterProfile(profile: CharacterProfile): Promise<ModelOperationResult>;
  getConversationHistory(): Promise<ConversationMessage[]>;
  clearConversationHistory(): Promise<ModelOperationResult>;
  generateContextualOpeningLine(): Promise<ContextualOpeningLineResult | undefined>;
  startConversation(input: StartConversationInput): Promise<StartConversationResult>;
  cancelConversation(input: CancelConversationInput): Promise<boolean>;
  onConversationEvent(listener: (event: ConversationEvent) => void): () => void;
  getAssistantToolStatus(): Promise<AssistantToolStatus>;
  selectAssistantWorkspace(): Promise<AssistantWorkspaceResult>;
  importDroppedWorkspaceFiles(
    input: ImportDroppedWorkspaceFilesInput,
  ): Promise<ImportDroppedWorkspaceFilesResult>;
  resolveAssistantToolApproval(input: ResolveAssistantToolApprovalInput): Promise<boolean>;
  searchCharacters(input: SearchCharactersInput): Promise<CharacterSearchResult>;
  buildCharacterDraft(input: BuildCharacterDraftInput): Promise<CharacterDraftResult>;
  cancelCharacterResearch(input: CancelCharacterResearchInput): Promise<boolean>;
  listCharacters(): Promise<CharacterLibraryEntry[]>;
  createLocalCharacter(input: CreateLocalCharacterInput): Promise<ModelOperationResult>;
  clearInactiveCharacters(): Promise<ModelOperationResult>;
  previewCharacterPackage(): Promise<CharacterPackageFileResult>;
  confirmCharacterPackageImport(
    input: ConfirmCharacterPackageImportInput,
  ): Promise<CharacterPackageFileResult>;
  exportActiveCharacterPackage(): Promise<CharacterPackageFileResult>;
  activateCharacter(input: CharacterIdInput): Promise<ModelOperationResult>;
  removeCharacter(input: CharacterIdInput): Promise<ModelOperationResult>;
  getActiveCharacterModelManifest(): Promise<string | undefined>;
  importLive2DModel(): Promise<Live2DModelImportResult>;
  exportActiveLive2DModel(): Promise<Live2DModelExportResult>;
  getCharacterDisplayMode(): Promise<CharacterDisplayMode>;
  setCharacterDisplayMode(input: SetCharacterDisplayModeInput): Promise<CharacterDisplayModeResult>;
  getWorkGlossaryStatus(input: WorkGlossaryInput): Promise<WorkGlossaryStatus>;
  syncWorkGlossary(input: WorkGlossaryInput): Promise<WorkGlossarySyncResult>;
  getMemorySettings(): Promise<MemorySettings>;
  setMemorySettings(input: SetMemorySettingsInput): Promise<MemoryOperationResult>;
  listMemories(): Promise<MemoryListResult>;
  listMemoryCandidates(): Promise<MemoryCandidateListResult>;
  updateMemoryCandidate(input: UpdateMemoryCandidateInput): Promise<MemoryOperationResult>;
  mergeMemoryCandidates(input: MergeMemoryCandidatesInput): Promise<MemoryOperationResult>;
  confirmMemoryCandidate(input: ConfirmMemoryCandidateInput): Promise<MemoryOperationResult>;
  rejectMemoryCandidate(input: MemoryIdInput): Promise<MemoryOperationResult>;
  updateMemory(input: UpdateMemoryInput): Promise<MemoryOperationResult>;
  deleteMemory(input: MemoryIdInput): Promise<MemoryOperationResult>;
  exportMemories(): Promise<MemoryFileOperationResult>;
  backupMemory(): Promise<MemoryFileOperationResult>;
  clearMemories(): Promise<MemoryOperationResult>;
  getWindowScale(): Promise<number>;
  setWindowScale(input: SetWindowScaleInput): Promise<number>;
  onWindowScaleChanged(listener: (scale: number) => void): () => void;
  setChatPanelExpanded(input: SetChatPanelExpandedInput): Promise<void>;
  getDesktopLayoutSettings(): Promise<DesktopLayoutSettings>;
  setDesktopLayoutSettings(input: SetDesktopLayoutSettingsInput): Promise<DesktopLayoutSettings>;
  getDesktopIntegrationStatus(): Promise<DesktopIntegrationStatus>;
  setDesktopIntegrationSettings(input: SetDesktopIntegrationSettingsInput): Promise<void>;
  setDesktopWidgetEnabled(input: SetDesktopWidgetEnabledInput): Promise<void>;
  sendMediaCommand(input: MediaCommandInput): Promise<boolean>;
  onDesktopInputActivity(listener: (event: DesktopInputActivityEvent) => void): () => void;
  getSpeechStatus(): Promise<SpeechStatus>;
  setSpeechSettings(input: SetSpeechSettingsInput): Promise<SpeechOperationResult>;
  setSpeechSecret(input: SetSpeechSecretInput): Promise<SpeechOperationResult>;
  deleteSpeechSecret(): Promise<SpeechOperationResult>;
  synthesizeSpeech(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult>;
  transcribeSpeech(input: SpeechTranscriptionInput): Promise<SpeechTranscriptionResult>;
  cancelSpeech(input: CancelSpeechInput): Promise<boolean>;
  getLocalSpeechAssetStatus(): Promise<LocalSpeechAssetStatus>;
  exportLocalVoice(): Promise<LocalAssetOperationResult>;
  openSpeechTrainingSources(
    input: ConfirmAuthorizedVoiceUseInput,
  ): Promise<LocalAssetOperationResult>;
  launchSpeechTrainer(input: ConfirmAuthorizedVoiceUseInput): Promise<LocalAssetOperationResult>;
  getViewerExStatus(): Promise<ViewerExStatus>;
  setViewerExSettings(input: SetViewerExSettingsInput): Promise<ViewerExOperationResult>;
  presentInViewerEx(input: ViewerExPresentationInput): Promise<boolean>;
  getVTubeStudioStatus(): Promise<VTubeStudioStatus>;
  launchVTubeStudio(): Promise<VTubeStudioOperationResult>;
  installBundledVTubeStudioModel(): Promise<VTubeStudioOperationResult>;
  setVTubeStudioSettings(input: SetVTubeStudioSettingsInput): Promise<VTubeStudioOperationResult>;
  authorizeVTubeStudio(): Promise<VTubeStudioOperationResult>;
  inspectVTubeStudio(): Promise<VTubeStudioInspectResult>;
  previewVTubeStudioExpression(
    input: VTubeStudioExpressionPreviewInput,
  ): Promise<VTubeStudioOperationResult>;
  presentInVTubeStudio(input: VTubeStudioPresentationInput): Promise<boolean>;
}
