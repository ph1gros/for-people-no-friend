import { pathToFileURL } from 'node:url';

import { app, globalShortcut, net, protocol, safeStorage, type Tray } from 'electron';

import { CharacterPackageService } from './character/character-package-service';
import { CharacterResearchService } from './character/character-research-service';
import { ConversationRuntime } from './conversation/conversation-runtime';
import { DesktopIntegrationService } from './desktop/desktop-integration-service';
import { WindowsMediaController } from './desktop/windows-media-controller';
import { WorkGlossaryService } from './glossary/work-glossary-service';
import { registerIpcHandlers } from './ipc/register-ipc-handlers';
import { ModelRuntime } from './llm/model-runtime';
import { MemoryService } from './memory/memory-service';
import { SecretStore } from './security/secret-store';
import { CharacterProfileStore } from './storage/character-profile-store';
import { CharacterKnowledgeStore } from './storage/character-knowledge-store';
import { ConversationStore } from './storage/conversation-store';
import { DeskpetDatabase } from './storage/deskpet-database';
import { DesktopIntegrationStore } from './storage/desktop-integration-store';
import { MemoryIndexConfigStore } from './storage/memory-index-config-store';
import { ProviderConfigStore } from './storage/provider-config-store';
import { createDeskpetTray } from './tray/create-tray';
import { WindowManager } from './windows/window-manager';
import { resolveBundledModelRoot } from './windows/window-assets';

app.setName('For People No Friend');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'deskpet-model',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  let windowManager: WindowManager | undefined;
  let modelRuntime: ModelRuntime | undefined;
  let conversationRuntime: ConversationRuntime | undefined;
  let memoryService: MemoryService | undefined;
  let characterResearch: CharacterResearchService | undefined;
  let database: DeskpetDatabase | undefined;
  let workGlossary: WorkGlossaryService | undefined;
  let tray: Tray | undefined;
  let desktopIntegrations: DesktopIntegrationService | undefined;
  let characterPackages: CharacterPackageService | undefined;

  app.on('second-instance', () => windowManager?.show());

  void app.whenReady().then(async () => {
    windowManager = new WindowManager();
    const userDataPath = app.getPath('userData');
    const providerConfiguration = new ProviderConfigStore(userDataPath);
    const characterProfiles = new CharacterProfileStore(userDataPath);
    characterPackages = new CharacterPackageService(
      userDataPath,
      characterProfiles,
      app.getVersion(),
      resolveBundledModelRoot(__dirname),
    );
    protocol.handle('deskpet-model', async (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'active' || request.method !== 'GET')
          return new Response(null, { status: 404 });
        const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
        const assetPath = await characterPackages?.resolveActiveAsset(relativePath);
        return assetPath
          ? net.fetch(pathToFileURL(assetPath).toString())
          : new Response(null, { status: 404 });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    database = new DeskpetDatabase(userDataPath);
    const secrets = new SecretStore(userDataPath, safeStorage);
    modelRuntime = new ModelRuntime(secrets, providerConfiguration);
    memoryService = new MemoryService(
      database,
      modelRuntime,
      new MemoryIndexConfigStore(userDataPath),
      secrets,
      (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
    );
    characterResearch = new CharacterResearchService(
      (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
      modelRuntime,
    );
    workGlossary = new WorkGlossaryService(userDataPath, (input, init) => net.fetch(input, init));
    conversationRuntime = new ConversationRuntime(
      modelRuntime,
      characterProfiles,
      new ConversationStore(database),
      memoryService,
      workGlossary,
      new CharacterKnowledgeStore(database),
    );
    desktopIntegrations = new DesktopIntegrationService(
      new DesktopIntegrationStore(userDataPath),
      globalShortcut,
      () => windowManager?.toggleVisibility(),
      new WindowsMediaController(),
    );
    await desktopIntegrations.initialize();
    registerIpcHandlers(
      windowManager,
      modelRuntime,
      conversationRuntime,
      characterProfiles,
      memoryService,
      characterResearch,
      workGlossary,
      desktopIntegrations,
      characterPackages,
    );
    const mainWindow = windowManager.create();
    desktopIntegrations.setShortcutWindowFocused(mainWindow.isFocused());
    mainWindow.on('focus', () => desktopIntegrations?.setShortcutWindowFocused(true));
    mainWindow.on('blur', () => desktopIntegrations?.setShortcutWindowFocused(false));
    mainWindow.on('closed', () => desktopIntegrations?.setShortcutWindowFocused(false));
    tray = createDeskpetTray({
      getWindow: () => windowManager?.getWindow(),
      show: () => windowManager?.show(),
      hide: () => windowManager?.hide(),
      toggleVisibility: () => windowManager?.toggleVisibility(),
    });

    app.on('activate', () => windowManager?.show());
  });

  app.on('before-quit', () => {
    desktopIntegrations?.dispose();
    desktopIntegrations = undefined;
    protocol.unhandle('deskpet-model');
    characterPackages = undefined;
    conversationRuntime?.dispose();
    conversationRuntime = undefined;
    memoryService?.dispose();
    memoryService = undefined;
    characterResearch?.dispose();
    characterResearch = undefined;
    modelRuntime?.dispose();
    modelRuntime = undefined;
    database?.close();
    database = undefined;
    windowManager?.prepareToQuit();
    tray?.destroy();
    tray = undefined;
  });
}
