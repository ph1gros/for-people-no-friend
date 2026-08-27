export interface ModelProviderCapabilities {
  streaming: boolean;
  structuredOutput: 'native' | 'prompted' | 'none';
  cancellation: boolean;
  maximumContextTokens?: number;
  suitableForComplexResearch: boolean;
}

export type ModelTaskKind = 'conversation' | 'character-research' | 'memory-maintenance';

export const selectTaskProvider = (input: {
  task: ModelTaskKind;
  currentProviderId: string;
  current: ModelProviderCapabilities;
  remoteProviderId?: string;
  remote?: ModelProviderCapabilities;
  allowRemoteComplexTasks: boolean;
}): string => {
  if (input.task === 'conversation' || !input.allowRemoteComplexTasks) {
    return input.currentProviderId;
  }
  if (input.remoteProviderId && input.remote?.suitableForComplexResearch) {
    return input.remoteProviderId;
  }
  return input.currentProviderId;
};
