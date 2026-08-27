import { describe, expect, it } from 'vitest';

import { selectTaskProvider } from '../src/core/llm/provider-capabilities';

const local = {
  streaming: true,
  structuredOutput: 'prompted' as const,
  cancellation: true,
  suitableForComplexResearch: false,
};

describe('provider capability routing', () => {
  it('keeps conversation on the selected provider and routes only authorized complex work', () => {
    const remote = {
      ...local,
      structuredOutput: 'native' as const,
      suitableForComplexResearch: true,
    };
    expect(
      selectTaskProvider({
        task: 'conversation',
        currentProviderId: 'local',
        current: local,
        remoteProviderId: 'remote',
        remote,
        allowRemoteComplexTasks: true,
      }),
    ).toBe('local');
    expect(
      selectTaskProvider({
        task: 'character-research',
        currentProviderId: 'local',
        current: local,
        remoteProviderId: 'remote',
        remote,
        allowRemoteComplexTasks: true,
      }),
    ).toBe('remote');
    expect(
      selectTaskProvider({
        task: 'memory-maintenance',
        currentProviderId: 'local',
        current: local,
        remoteProviderId: 'remote',
        remote,
        allowRemoteComplexTasks: false,
      }),
    ).toBe('local');
  });
});
