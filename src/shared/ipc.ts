import type {
  CharacterProfile,
  CharacterProfileOption,
} from '../core/conversation/character-profile';
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
  StartConversationInput,
  StartConversationResult,
} from './conversation-ipc';
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
  WorkGlossaryInput,
  WorkGlossaryStatus,
  WorkGlossarySyncResult,
} from './work-glossary-ipc';

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
  listCharacterProfiles: 'conversation:listCharacterProfiles',
  activateCharacterProfile: 'conversation:activateCharacterProfile',
  setCharacterProfile: 'conversation:setCharacterProfile',
  getConversationHistory: 'conversation:getHistory',
  clearConversationHistory: 'conversation:clearHistory',
  startConversation: 'conversation:start',
  cancelConversation: 'conversation:cancel',
  conversationEvent: 'conversation:event',
  searchCharacters: 'character:search',
  buildCharacterDraft: 'character:buildDraft',
  cancelCharacterResearch: 'character:cancelResearch',
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
  listCharacterProfiles(): Promise<CharacterProfileOption[]>;
  activateCharacterProfile(input: { id: string }): Promise<ModelOperationResult>;
  setCharacterProfile(profile: CharacterProfile): Promise<ModelOperationResult>;
  getConversationHistory(): Promise<ConversationMessage[]>;
  clearConversationHistory(): Promise<ModelOperationResult>;
  startConversation(input: StartConversationInput): Promise<StartConversationResult>;
  cancelConversation(input: CancelConversationInput): Promise<boolean>;
  onConversationEvent(listener: (event: ConversationEvent) => void): () => void;
  searchCharacters(input: SearchCharactersInput): Promise<CharacterSearchResult>;
  buildCharacterDraft(input: BuildCharacterDraftInput): Promise<CharacterDraftResult>;
  cancelCharacterResearch(input: CancelCharacterResearchInput): Promise<boolean>;
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
}
