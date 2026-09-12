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
      'app:openDiagnosticLog',
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
      'assistant:getToolStatus',
      'assistant:selectWorkspace',
      'assistant:importDroppedWorkspaceFiles',
      'assistant:resolveToolApproval',
      'character:search',
      'character:buildDraft',
      'character:cancelResearch',
      'character:list',
      'character:createLocal',
      'character:clearInactive',
      'character:previewPackage',
      'character:confirmPackageImport',
      'character:exportActivePackage',
      'character:activate',
      'character:remove',
      'character:getActiveModelManifest',
      'live2d:importModel',
      'live2d:exportActiveModel',
      'characterDisplay:getMode',
      'characterDisplay:setMode',
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
      'window:getDesktopLayoutSettings',
      'window:setDesktopLayoutSettings',
      'desktop:getIntegrationStatus',
      'desktop:setIntegrationSettings',
      'desktop:setWidgetEnabled',
      'desktop:installClockWidget',
      'desktop:sendMediaCommand',
      'desktop:inputActivity',
      'speech:getStatus',
      'speech:setSettings',
      'speech:setSecret',
      'speech:deleteSecret',
      'speech:synthesize',
      'speech:transcribe',
      'speech:cancel',
      'speechAssets:getStatus',
      'speechAssets:getDownloadStatus',
      'resources:getStatus',
      'resources:openWindow',
      'resources:refreshCatalog',
      'speechAssets:controlDownload',
      'speechAssets:exportVoice',
      'speechAssets:openTrainingSources',
      'speechAssets:launchTrainer',
      'viewerex:getStatus',
      'viewerex:openWorkshop',
      'viewerex:setSettings',
      'viewerex:present',
      'vtubeStudio:getStatus',
      'vtubeStudio:launchSteam',
      'vtubeStudio:openWorkshop',
      'vtubeStudio:installBundledModel',
      'vtubeStudio:setSettings',
      'vtubeStudio:authorize',
      'vtubeStudio:inspect',
      'vtubeStudio:previewExpression',
      'vtubeStudio:present',
      'setup:getState',
      'setup:getResources',
      'setup:controlResources',
      'setup:advance',
      'setup:back',
      'setup:cancel',
      'setup:complete',
      'setup:getProviderStatus',
      'setup:applyProvider',
      'setup:testProvider',
      'setup:cancelProviderTest',
      'setup:getCharacterStatus',
      'setup:previewCharacterPackage',
      'setup:confirmCharacterPackage',
      'setup:importLive2DModel',
      'setup:previewVoice',
      'setup:stopVoicePreview',
    ]);
  });

  it('keeps the setup wizard limited to configuration, imports and fixed voice previews', () => {
    const setupChannels = Object.values(IPC_CHANNELS).filter((channel) =>
      channel.startsWith('setup:'),
    );
    expect(setupChannels).toEqual([
      'setup:getState',
      'setup:getResources',
      'setup:controlResources',
      'setup:advance',
      'setup:back',
      'setup:cancel',
      'setup:complete',
      'setup:getProviderStatus',
      'setup:applyProvider',
      'setup:testProvider',
      'setup:cancelProviderTest',
      'setup:getCharacterStatus',
      'setup:previewCharacterPackage',
      'setup:confirmCharacterPackage',
      'setup:importLive2DModel',
      'setup:previewVoice',
      'setup:stopVoicePreview',
    ]);
    // Setup never reads a stored secret back, and never downloads resources on its own.
    expect(setupChannels).not.toContain('setup:getProviderSecret');
    expect(setupChannels).not.toContain('setup:download');
  });

  it('rejects channels outside the whitelist', () => {
    expect(isAllowedIpcChannel('shell:execute')).toBe(false);
    expect(isAllowedIpcChannel('model:getProviderSecret')).toBe(false);
  });
});
