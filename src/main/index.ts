import { app, net, safeStorage, type Tray } from 'electron';

import { CharacterResearchService } from './character/character-research-service';
import { ConversationRuntime } from './conversation/conversation-runtime';
import { WorkGlossaryService } from './glossary/work-glossary-service';
import { registerIpcHandlers } from './ipc/register-ipc-handlers';
import { ModelRuntime } from './llm/model-runtime';
import { MemoryService } from './memory/memory-service';
import { SecretStore } from './security/secret-store';
import { CharacterProfileStore } from './storage/character-profile-store';
import { CharacterKnowledgeStore } from './storage/character-knowledge-store';
import { ConversationStore } from './storage/conversation-store';
import { DeskpetDatabase } from './storage/deskpet-database';
import { ProviderConfigStore } from './storage/provider-config-store';
import { createDeskpetTray } from './tray/create-tray';
import { WindowManager } from './windows/window-manager';

app.setName('For People No Friend');

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

  app.on('second-instance', () => windowManager?.show());

  void app.whenReady().then(() => {
    windowManager = new WindowManager();
    const userDataPath = app.getPath('userData');
    const providerConfiguration = new ProviderConfigStore(userDataPath);
    const characterProfiles = new CharacterProfileStore(userDataPath);
    database = new DeskpetDatabase(userDataPath);
    modelRuntime = new ModelRuntime(
      new SecretStore(userDataPath, safeStorage),
      providerConfiguration,
    );
    memoryService = new MemoryService(database, modelRuntime);
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
    registerIpcHandlers(
      windowManager,
      modelRuntime,
      conversationRuntime,
      characterProfiles,
      memoryService,
      characterResearch,
      workGlossary,
    );
    windowManager.create();
    tray = createDeskpetTray({
      getWindow: () => windowManager?.getWindow(),
      show: () => windowManager?.show(),
      hide: () => windowManager?.hide(),
      toggleVisibility: () => windowManager?.toggleVisibility(),
    });

    app.on('activate', () => windowManager?.show());
  });

  app.on('before-quit', () => {
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
