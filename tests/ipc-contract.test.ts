import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS, isAllowedIpcChannel } from '../src/shared/ipc';

describe('IPC whitelist', () => {
  it('allows every explicitly declared deskpet channel', () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      expect(isAllowedIpcChannel(channel)).toBe(true);
    }
  });

  it('keeps character generation but exposes no runtime character switch', () => {
    const channels = Object.values(IPC_CHANNELS);
    expect(channels).toContain('character:search');
    expect(channels).toContain('character:buildDraft');
    expect(channels).toContain('conversation:setCharacterProfile');
    expect(channels).not.toContain('conversation:listCharacterProfiles');
    expect(channels).not.toContain('conversation:activateCharacterProfile');
  });

  it('contains only the expected named desktop surface', () => {
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
      'conversation:generateOpeningLine',
      'conversation:start',
      'conversation:cancel',
      'conversation:event',
      'character:search',
      'character:buildDraft',
      'character:cancelResearch',
      'character:list',
      'character:previewPackage',
      'character:confirmPackageImport',
      'character:exportActivePackage',
      'character:activate',
      'character:remove',
      'character:getActiveModelManifest',
      'glossary:getStatus',
      'glossary:sync',
      'memory:getSettings',
      'memory:setSettings',
      'memory:list',
      'memory:listCandidates',
      'memory:updateCandidate',
      'memory:mergeCandidates',
      'memory:confirmCandidate',
      'memory:rejectCandidate',
      'memory:update',
      'memory:delete',
      'memory:export',
      'memory:backup',
      'memory:clear',
      'window:getScale',
      'window:setScale',
      'window:scaleChanged',
      'window:setChatPanelExpanded',
      'desktop:getIntegrationStatus',
      'desktop:setIntegrationSettings',
      'desktop:setWidgetEnabled',
      'desktop:sendMediaCommand',
      'desktop:inputActivity',
    ]);
  });

  it('rejects channels outside the whitelist', () => {
    expect(isAllowedIpcChannel('shell:execute')).toBe(false);
    expect(isAllowedIpcChannel('model:getProviderSecret')).toBe(false);
  });
});
