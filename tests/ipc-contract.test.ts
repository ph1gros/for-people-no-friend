import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS, isAllowedIpcChannel } from '../src/shared/ipc';

describe('IPC whitelist', () => {
  it('allows every explicitly declared deskpet channel', () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      expect(isAllowedIpcChannel(channel)).toBe(true);
    }
  });

  it('contains only the expected M1 to V1.1a surface', () => {
    expect(Object.values(IPC_CHANNELS)).toEqual([
      'app:getVersion',
      'tracking:getGlobalPoint',
      'model:listProviders',
      'model:getProviderConfiguration',
      'model:setProviderConfiguration',
      'model:getProviderSecretStatus',
      'model:setProviderSecret',
      'model:deleteProviderSecret',
      'model:testProviderConnection',
      'model:cancelProviderRequest',
      'conversation:getConfiguration',
      'conversation:setConfiguration',
      'conversation:getCharacterProfile',
      'conversation:setCharacterProfile',
      'conversation:getHistory',
      'conversation:clearHistory',
      'conversation:start',
      'conversation:cancel',
      'conversation:event',
      'character:search',
      'character:buildDraft',
      'character:cancelResearch',
      'glossary:getStatus',
      'glossary:sync',
      'memory:getSettings',
      'memory:setSettings',
      'memory:list',
      'memory:listCandidates',
      'memory:confirmCandidate',
      'memory:rejectCandidate',
      'memory:update',
      'memory:delete',
      'memory:export',
      'memory:backup',
      'memory:clear',
      'window:getScale',
      'window:setScale',
      'window:setChatPanelExpanded',
    ]);
  });

  it('rejects channels outside the whitelist', () => {
    expect(isAllowedIpcChannel('shell:execute')).toBe(false);
    expect(isAllowedIpcChannel('model:getProviderSecret')).toBe(false);
  });
});
