import { pathToFileURL } from 'node:url';
import path from 'node:path';

import {
  app,
  globalShortcut,
  net,
  protocol,
  safeStorage,
  screen,
  shell,
  type Tray,
} from 'electron';

import { CharacterPackageService } from './character/character-package-service';
import { CharacterResearchService } from './character/character-research-service';
import { SafeDiagnosticLog } from './diagnostics/safe-diagnostic-log';
import { ConversationRuntime } from './conversation/conversation-runtime';
import { DesktopIntegrationService } from './desktop/desktop-integration-service';
import { NativeInputActivityMonitor } from './desktop/native-input-activity-monitor';
import { WindowsMediaController } from './desktop/windows-media-controller';
import { WorkGlossaryService } from './glossary/work-glossary-service';
import { registerIpcHandlers } from './ipc/register-ipc-handlers';
import { ModelRuntime } from './llm/model-runtime';
import { MemoryService } from './memory/memory-service';
import { SecretStore } from './security/secret-store';
import { CharacterProfileStore } from './storage/character-profile-store';
import { DEFAULT_CHARACTER_PROFILE } from '../core/conversation/character-profile';
import { CharacterDisplayConfigStore } from './storage/character-display-config-store';
import { CharacterKnowledgeStore } from './storage/character-knowledge-store';
import { ConversationStore } from './storage/conversation-store';
import { DeskpetDatabase } from './storage/deskpet-database';
import { DesktopIntegrationStore } from './storage/desktop-integration-store';
import { MemoryIndexConfigStore } from './storage/memory-index-config-store';
import { ProviderConfigStore } from './storage/provider-config-store';
import { createDeskpetTray } from './tray/create-tray';
import { WindowManager } from './windows/window-manager';
import { resolveBundledModelRoot } from './windows/window-assets';
import { IPC_CHANNELS } from '../shared/ipc';
import { OpenAICompatibleSpeechAdapter } from '../adapters/speech/openai-compatible-tts';
import { FishAudioSpeechAdapter } from '../adapters/speech/fish-audio-tts';
import { GenieTtsAdapter } from '../adapters/speech/genie-tts';
import { OpenAICompatibleTranscriptionAdapter } from '../adapters/speech/openai-compatible-asr';
import { SpeechService } from './speech/speech-service';
import { LocalSpeechAssetService } from './speech/local-speech-asset-service';
import {
  BundledSpeechInputRuntime,
  BundledSpeechRuntime,
  resolveBundledSpeechInputRuntimeCandidate,
  resolveBundledSpeechRuntimeSources,
} from './speech/bundled-speech-runtime';
import { probeLoopbackSpeechService } from './speech/loopback-speech-service-probe';
import { BundledVTubeModelInstaller } from './vtube-studio/bundled-vtube-model-installer';
import { SpeechConfigStore } from './storage/speech-config-store';
import { ViewerExConfigStore } from './storage/viewerex-config-store';
import { ViewerExService } from './viewerex/viewerex-service';
import { VTubeStudioConfigStore } from './storage/vtube-studio-config-store';
import { VTubeStudioService } from './vtube-studio/vtube-studio-service';
import { VTubeStudioSpoutOverlay } from './vtube-studio/vtube-studio-spout-overlay';
import { Live2DModelImportService } from './live2d/live2d-model-import-service';
import { cursorProximityToArea, normalizeCursorToWorkArea } from './ipc/global-tracking';
import { AssistantToolService } from './assistant/assistant-tool-service';
import { createProjectCheckRunner } from './assistant/project-check-runner';
import { AssistantWorkspaceStore } from './storage/assistant-workspace-store';
import { DesktopLayoutStore } from './storage/desktop-layout-store';

const PRODUCT_NAME = 'For People No Friend';
const WINDOWS_APP_USER_MODEL_ID = 'com.ph1gros.forpeoplenofriend';

app.setName(PRODUCT_NAME);
if (process.platform === 'win32') app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
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
  let live2DModelImports: Live2DModelImportService | undefined;
  let speechService: SpeechService | undefined;
  let localSpeechAssets: LocalSpeechAssetService | undefined;
  let bundledSpeechRuntime: BundledSpeechRuntime | undefined;
  let bundledSpeechInputRuntime: BundledSpeechInputRuntime | undefined;
  let bundledVTubeModel: BundledVTubeModelInstaller | undefined;
  let viewerExService: ViewerExService | undefined;
  let vTubeStudioService: VTubeStudioService | undefined;
  let vTubeStudioSpoutOverlay: VTubeStudioSpoutOverlay | undefined;
  let characterDisplayConfiguration: CharacterDisplayConfigStore | undefined;
  let assistantTools: AssistantToolService | undefined;
  let desktopLayout: DesktopLayoutStore | undefined;

  app.on('second-instance', () => windowManager?.show());

  void app.whenReady().then(async () => {
    windowManager = new WindowManager((expanded) =>
      vTubeStudioSpoutOverlay?.setSettingsPanelExpanded(expanded),
    );
    vTubeStudioSpoutOverlay = new VTubeStudioSpoutOverlay(
      () => windowManager?.getWindow(),
      undefined,
      (event) => vTubeStudioService?.setDisplayTransportDiagnostic(event),
    );
    const userDataPath = app.getPath('userData');
    desktopLayout = new DesktopLayoutStore(userDataPath);
    const providerConfiguration = new ProviderConfigStore(userDataPath);
    const characterProfiles = new CharacterProfileStore(userDataPath, DEFAULT_CHARACTER_PROFILE);
    characterDisplayConfiguration = new CharacterDisplayConfigStore(userDataPath);
    characterPackages = new CharacterPackageService(
      userDataPath,
      characterProfiles,
      app.getVersion(),
      resolveBundledModelRoot(__dirname),
    );
    live2DModelImports = new Live2DModelImportService(userDataPath, characterProfiles);
    protocol.handle('deskpet-model', async (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'active' || request.method !== 'GET')
          return new Response(null, { status: 404 });
        const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
        const assetPath =
          (await live2DModelImports?.resolveActiveAsset(relativePath)) ??
          (await characterPackages?.resolveActiveAsset(relativePath));
        return assetPath
          ? net.fetch(pathToFileURL(assetPath).toString())
          : new Response(null, { status: 404 });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    database = new DeskpetDatabase(userDataPath);
    const secrets = new SecretStore(userDataPath, safeStorage);
    modelRuntime = new ModelRuntime(
      secrets,
      providerConfiguration,
      new SafeDiagnosticLog(userDataPath),
    );
    bundledSpeechRuntime = new BundledSpeechRuntime(
      resolveBundledSpeechRuntimeSources({
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        packaged: app.isPackaged,
      }),
    );
    const bundledSpeechRoot = await bundledSpeechRuntime.resolveAvailableRoot();
    bundledSpeechInputRuntime = new BundledSpeechInputRuntime(
      resolveBundledSpeechInputRuntimeCandidate({
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
        packaged: app.isPackaged,
      }),
    );
    bundledVTubeModel = new BundledVTubeModelInstaller(
      path.join(process.resourcesPath, 'character-suite', 'vtube-model'),
      [
        path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam'),
        path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Steam'),
      ],
    );
    localSpeechAssets = new LocalSpeechAssetService(
      path.join(app.getAppPath(), 'data'),
      path.join(
        bundledSpeechRoot ?? path.join(process.resourcesPath, 'voice-runtime'),
        'voice',
        'ireina',
      ),
    );
    const bundledVoiceAvailable = (await localSpeechAssets.getStatus()).voiceAvailable;
    speechService = new SpeechService(
      new SpeechConfigStore(userDataPath, bundledVoiceAvailable),
      secrets,
      new OpenAICompatibleSpeechAdapter({
        fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
      }),
      new OpenAICompatibleTranscriptionAdapter({
        fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
      }),
      (text, signal) => modelRuntime!.translateSpeechToJapanese(text, signal),
      () => bundledSpeechRuntime!.ensureRunning(),
      {
        genieTts: new GenieTtsAdapter({
          fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
        }),
        fishAudio: new FishAudioSpeechAdapter({
          fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
        }),
      },
      (baseUrl) => probeLoopbackSpeechService(baseUrl, (input, init) => net.fetch(input, init)),
      () => bundledSpeechInputRuntime!.ensureRunning(),
    );
    viewerExService = new ViewerExService(new ViewerExConfigStore(userDataPath));
    vTubeStudioService = new VTubeStudioService(
      new VTubeStudioConfigStore(userDataPath),
      secrets,
      undefined,
      () => {
        const window = windowManager?.getWindow();
        if (!window) return undefined;
        const bounds = window.getBounds();
        const cursor = screen.getCursorScreenPoint();
        return {
          ...normalizeCursorToWorkArea(cursor, screen.getDisplayMatching(bounds).workArea),
          proximity: cursorProximityToArea(cursor, bounds),
        };
      },
    );
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
    assistantTools = new AssistantToolService(
      modelRuntime,
      new AssistantWorkspaceStore(userDataPath),
      (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
      {
        openPath: (target) => shell.openPath(target),
        sendMediaCommand: (command) =>
          desktopIntegrations?.sendMediaCommand(command) ?? Promise.resolve(false),
        runProjectCheck: createProjectCheckRunner(),
      },
    );
    conversationRuntime = new ConversationRuntime(
      modelRuntime,
      characterProfiles,
      new ConversationStore(database),
      memoryService,
      workGlossary,
      new CharacterKnowledgeStore(database),
      assistantTools,
    );
    desktopIntegrations = new DesktopIntegrationService(
      new DesktopIntegrationStore(userDataPath),
      globalShortcut,
      () => windowManager?.toggleVisibility(),
      new WindowsMediaController(),
      () => conversationRuntime?.cancelAll(),
      new NativeInputActivityMonitor(),
      (event) => {
        const window = windowManager?.getWindow();
        if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.desktopInputActivity, event);
        }
      },
    );
    await desktopIntegrations.initialize();
    const initialSpeechStatus = await speechService.getStatus();
    await desktopIntegrations.setPushToTalkKey(
      initialSpeechStatus.settings.inputEnabled &&
        initialSpeechStatus.settings.inputMode === 'manual'
        ? initialSpeechStatus.settings.pushToTalkKey
        : undefined,
    );
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
      live2DModelImports,
      speechService,
      viewerExService,
      vTubeStudioService,
      characterDisplayConfiguration,
      (mode) => vTubeStudioSpoutOverlay?.setMode(mode),
      assistantTools,
      desktopLayout,
      localSpeechAssets,
      bundledVTubeModel,
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
    live2DModelImports = undefined;
    conversationRuntime?.dispose();
    conversationRuntime = undefined;
    memoryService?.dispose();
    memoryService = undefined;
    characterResearch?.dispose();
    characterResearch = undefined;
    modelRuntime?.dispose();
    modelRuntime = undefined;
    speechService?.dispose();
    speechService = undefined;
    bundledSpeechRuntime?.dispose();
    bundledSpeechRuntime = undefined;
    bundledSpeechInputRuntime?.dispose();
    bundledSpeechInputRuntime = undefined;
    bundledVTubeModel = undefined;
    viewerExService?.dispose();
    viewerExService = undefined;
    vTubeStudioService?.dispose();
    vTubeStudioService = undefined;
    vTubeStudioSpoutOverlay?.dispose();
    vTubeStudioSpoutOverlay = undefined;
    characterDisplayConfiguration = undefined;
    assistantTools = undefined;
    desktopLayout = undefined;
    database?.close();
    database = undefined;
    windowManager?.prepareToQuit();
    tray?.destroy();
    tray = undefined;
  });
}
