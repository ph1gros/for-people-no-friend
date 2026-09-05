import { mountCharacterSettings } from './settings-character';
import { mountVTubeSettings } from './settings-vtube';
import { mountSpeechSettings } from './settings-speech';
import { createButtonFeedback } from './panel-feedback';
import { mountProviderSettings } from './settings-provider';
import type { CharacterPresentationPort } from '../../core/presentation/character-presentation';
import {
  DEFAULT_CHARACTER_PROFILE,
  type CharacterProfile,
} from '../../core/conversation/character-profile';
import { resolveCharacterDisplayName } from '../../core/conversation/character-identity';
import {
  resolveOpeningLineMode,
  type OpeningLineContext,
} from '../../core/conversation/opening-line';
import type { PublicLlmError } from '../../core/llm/contracts';
import type { CharacterDisplayMode } from '../../shared/character-display-ipc';
import type { MemoryCandidateRecord, MemoryRecord } from '../../core/memory/contracts';
import type {
  ConversationContextDebug,
  ConversationEvent,
  ConversationMessage,
} from '../../shared/conversation-ipc';
import type {
  DesktopInputActivityEvent,
  DesktopIntegrationSettings,
  DesktopIntegrationStatus,
  DesktopWidgetId,
  InputOverlayKey,
  MouseInputButton,
} from '../../shared/desktop-integration-ipc';
import { tokenizeInputOverlayKeyDraft } from '../../shared/desktop-integration-ipc';
import type { ConfigurableProviderId } from '../../shared/model-ipc';
import {
  MAX_SPEECH_INPUT_AUDIO_BYTES,
  type SpeechInputMode,
  type SpeechSettings,
  type SpeechStatus,
  type SpeechWakeWordSource,
} from '../../shared/speech-ipc';
import type { ViewerExSettings } from '../../shared/viewerex-ipc';
import { MAX_WINDOW_SCALE, MIN_WINDOW_SCALE } from '../../shared/window-ipc';
import {
  DEFAULT_DESKTOP_LAYOUT_SETTINGS,
  type DesktopLayoutSettings,
} from '../../shared/desktop-layout-ipc';
import { SpeechTurnPipeline } from '../../core/speech/streaming-pipeline';
import type { LoadedCharacter } from '../live2d/character-runtime';
import { transitionCharacterDisplayMode } from '../display/character-display-transition';
import { IpcSpeechSynthesisClient, WebAudioSpeechPlayer } from '../speech/speech-runtime';
import {
  ContinuousMicrophoneListener,
  type ContinuousListenerState,
  type ContinuousUtteranceTiming,
} from '../speech/continuous-listener';
import {
  combineFullListeningCommands,
  PendingVoiceCommandQueue,
  resolvePreciseWakeWord,
  shouldCombineFullListeningCommands,
  WakeWordCommandSession,
} from '../speech/wake-word-command';
import { WindowScaleSync } from '../settings/window-scale-sync';
import { desktopWidgetRegistry, type DesktopWidgetDefinition } from '../widgets/widget-registry';
import { calculateDesktopWidgetReserve } from '../widgets/widget-layout';
import { IdleCompanionScheduler, selectKittenDrowsyLine } from './idle-companion';
import { mountComposerPanel } from './composer';
import { el, createButton, createField } from './elements';
import { mountMemoryPanel } from './memory-panel';
import { mountConversationTimeline } from './timeline';
import { startSpeechInputAssetOnDemand } from './speech-asset-panel';
import { mountResourceCenter } from './resource-center';

interface ChatControllerOptions {
  root: HTMLElement;
  getCharacter(): LoadedCharacter | undefined;
  getPresentation(): CharacterPresentationPort | undefined;
  onDisplayModeChanged(mode: CharacterDisplayMode): void;
}

const errorMessages: Record<PublicLlmError['code'], string> = {
  authentication: 'API Key 无效，请检查模型设置。',
  'rate-limit': '请求过快或额度不足，请稍后重试。',
  network: '无法连接模型服务，请检查网络或本地服务。',
  'model-not-found': '找不到所选模型，请检查模型名称。',
  'context-too-long': '最近对话太长，请清空历史或更换上下文更大的模型。',
  'provider-response': '模型返回了无法识别的内容，请重试。',
  cancelled: '已停止生成。',
  configuration: '请先在设置中选择提供商并填写模型名称。',
};

const MAX_MICROPHONE_RECORDING_MS = 30_000;
const MAX_CAPTURED_AUDIO_BYTES = 8 * 1024 * 1024;
const TRANSCRIPTION_SAMPLE_RATE = 16_000;

const encodeMonoPcmWav = (samples: Float32Array, sampleRate: number): Uint8Array => {
  const output = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(output);
  const writeAscii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, output.byteLength - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(output);
};

const convertRecordingToTranscriptionWav = async (recording: Blob): Promise<Uint8Array> => {
  const decodingContext = new AudioContext();
  try {
    const decoded = await decodingContext.decodeAudioData(await recording.arrayBuffer());
    const frameCount = Math.max(1, Math.ceil(decoded.duration * TRANSCRIPTION_SAMPLE_RATE));
    const offlineContext = new OfflineAudioContext(1, frameCount, TRANSCRIPTION_SAMPLE_RATE);
    const source = offlineContext.createBufferSource();
    source.buffer = decoded;
    source.connect(offlineContext.destination);
    source.start();
    const resampled = await offlineContext.startRendering();
    return encodeMonoPcmWav(resampled.getChannelData(0), TRANSCRIPTION_SAMPLE_RATE);
  } finally {
    await decodingContext.close().catch(() => undefined);
  }
};

const createRequestId = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '_')}`;

export const initializeChat = async ({
  root,
  getCharacter,
  getPresentation,
  onDisplayModeChanged,
}: ChatControllerOptions): Promise<() => void> => {
  const feedback = createButtonFeedback();
  const { showButtonFeedback } = feedback;
  const api = window.deskpet;
  const shell = el('section', { className: 'chat-shell', attrs: { 'aria-label': '文字对话' } });

  const desktopOverlayStack = document.createElement('section');
  desktopOverlayStack.className = 'desktop-overlay-stack';
  desktopOverlayStack.setAttribute('aria-label', '桌面小组件显示');
  let desktopWidgetsActive = false;
  let desktopWidgetReserve = 0;
  const syncDesktopWidgetReserve = (): void => {
    const nextReserve = desktopWidgetsActive
      ? calculateDesktopWidgetReserve(
          desktopOverlayStack.getBoundingClientRect().height,
          root.getBoundingClientRect().height,
        )
      : 0;
    if (nextReserve === desktopWidgetReserve) return;
    desktopWidgetReserve = nextReserve;
    if (nextReserve > 0) {
      root.style.setProperty('--desktop-widget-reserve', `${nextReserve}px`);
    } else {
      root.style.removeProperty('--desktop-widget-reserve');
    }
    window.dispatchEvent(new Event('resize'));
  };
  const desktopWidgetResizeObserver = new ResizeObserver(syncDesktopWidgetReserve);
  desktopWidgetResizeObserver.observe(desktopOverlayStack);
  window.addEventListener('resize', syncDesktopWidgetReserve);

  const mediaOverlay = document.createElement('section');
  mediaOverlay.className = 'media-overlay';
  mediaOverlay.hidden = true;
  mediaOverlay.setAttribute('aria-label', '当前媒体');
  const mediaOverlayControls = el('div', { className: 'media-overlay__controls' });
  const previousMediaOverlayButton = createButton('◀', 'media-overlay__control');
  previousMediaOverlayButton.setAttribute('aria-label', '上一首');
  const playPauseMediaOverlayButton = createButton('⏸', 'media-overlay__control');
  playPauseMediaOverlayButton.setAttribute('aria-label', '播放或暂停');
  const nextMediaOverlayButton = createButton('▶', 'media-overlay__control');
  nextMediaOverlayButton.setAttribute('aria-label', '下一首');
  const mediaTrack = el('span', { className: 'media-overlay__track' });
  mediaOverlayControls.append(
    previousMediaOverlayButton,
    playPauseMediaOverlayButton,
    nextMediaOverlayButton,
    mediaTrack,
  );
  mediaOverlay.append(mediaOverlayControls);

  const inputOverlay = document.createElement('section');
  inputOverlay.className = 'input-overlay';
  inputOverlay.hidden = true;
  inputOverlay.setAttribute('aria-label', '本机输入显示');
  const inputOverlayLabel = el('small', { textContent: 'INPUT' });
  const inputOverlayKeys = el('div', { className: 'input-overlay__keys' });
  const inputOverlayKeyElements = new Map<InputOverlayKey, HTMLElement>();
  const inputOverlayReleaseTimers = new Map<string, number>();
  let mouseDirectionTimer: number | undefined;
  const inputOverlayMouse = el('div', { className: 'input-overlay__mouse' });
  const mouseDirection = el('span', { className: 'input-overlay__direction', textContent: '•' });
  const mouseButtons = new Map<MouseInputButton, HTMLElement>();
  for (const [button, label] of [
    ['left', 'L'],
    ['middle', 'M'],
    ['right', 'R'],
  ] as const) {
    const element = el('span', { className: 'input-overlay__mouse-button', textContent: label });
    element.dataset.button = button;
    mouseButtons.set(button, element);
    inputOverlayMouse.append(element);
  }
  inputOverlayMouse.append(mouseDirection);
  inputOverlay.append(inputOverlayLabel, inputOverlayKeys, inputOverlayMouse);
  desktopOverlayStack.append(mediaOverlay, inputOverlay);

  const panel = el('section', { className: 'chat-panel' });

  const panelHeader = el('header', { className: 'chat-panel__header' });
  const identity = el('div', { className: 'chat-identity' });
  const replyAuthor = el('strong', { textContent: '桌宠' });
  const replyStatus = document.createElement('small');
  replyStatus.setAttribute('role', 'status');
  replyStatus.setAttribute('aria-live', 'polite');
  replyStatus.textContent = '随时可以开始聊天';
  identity.append(replyAuthor, replyStatus);
  const assistantModeButton = createButton('工作模式 OFF', 'text-button assistant-mode-button');
  assistantModeButton.setAttribute('aria-pressed', 'false');
  assistantModeButton.title = '开启后可做普通问答、联网查资料和已批准工作区任务';
  const assistantWorkspaceButton = createButton(
    '选择工作区',
    'secondary-button assistant-workspace-button',
  );
  assistantWorkspaceButton.title = '选择助手可以读取和修改的文件夹';
  panelHeader.append(identity, assistantModeButton);

  const toolbar = el('div', { className: 'chat-toolbar' });
  const soundButton = createButton('声音', 'chat-toolbar__button');
  soundButton.setAttribute('aria-label', '调整角色语音音量');
  const speechInputModeToolbar = document.createElement('div');
  speechInputModeToolbar.className = 'chat-toolbar__mode-switch';
  speechInputModeToolbar.setAttribute('role', 'radiogroup');
  speechInputModeToolbar.setAttribute('aria-label', '麦克风模式');
  const speechInputModeToolbarButtons = new Map<SpeechInputMode, HTMLButtonElement>();
  for (const [mode, label, title] of [
    ['full', '完全', '完全：自动发送；2 秒内继续说会合并并重新思考'],
    ['half', '精准', '精准：先说设定的称呼才自动发送'],
    ['manual', '手动', '手动：点击说话或按住设置的键位录音'],
  ] as const) {
    const button = createButton(label, 'chat-toolbar__mode-button');
    button.type = 'button';
    button.dataset.mode = mode;
    button.title = title;
    button.setAttribute('role', 'radio');
    speechInputModeToolbarButtons.set(mode, button);
    speechInputModeToolbar.append(button);
  }
  const renderToolbarSpeechInputMode = (mode: SpeechInputMode): void => {
    for (const [candidate, button] of speechInputModeToolbarButtons) {
      const selected = candidate === mode;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-checked', String(selected));
    }
  };
  renderToolbarSpeechInputMode('manual');
  const historyButton = createButton('历史', 'chat-toolbar__button');
  const debugButton = createButton('上下文', 'chat-toolbar__button');
  const widgetsButton = createButton('小组件', 'chat-toolbar__button');
  const settingsButton = createButton('设置', 'chat-toolbar__button');
  toolbar.append(soundButton, speechInputModeToolbar, widgetsButton, settingsButton);

  const conversationList = document.createElement('div');
  conversationList.className = 'conversation-list';
  conversationList.setAttribute('aria-label', '当前对话');
  conversationList.setAttribute('aria-live', 'polite');
  const conversationTimeline = mountConversationTimeline(conversationList);
  const speechAssetProgressStrip = document.createElement('aside');
  speechAssetProgressStrip.className = 'speech-asset-progress-strip';
  speechAssetProgressStrip.hidden = true;

  const composerPanel = mountComposerPanel(panel, {
    isChatView: () => panelView === 'chat',
    isAssistantModeEnabled: () => assistantModeEnabled,
    isWorkspaceConfigured: () => assistantWorkspaceConfigured,
    importFiles: async (files) => {
      if (!api) throw new Error('Workspace import is unavailable.');
      return api.importDroppedWorkspaceFiles({ assistantMode: assistantModeEnabled, files });
    },
    onFilesImported: (result) =>
      setReplyStatus(result.ok ? `已接收 ${result.imported.length} 个文件` : '文件未导入'),
    onSubmit: handleComposerSubmit,
    onStop: handleComposerStop,
    onStopSpeech: handleComposerStopSpeech,
    onMicrophone: handleComposerMicrophone,
  });
  const {
    root: composer,
    input,
    sendButton,
    microphoneButton,
    stopButton,
    stopSpeechButton,
    showDropStatus: showComposerDropStatus,
  } = composerPanel;

  const historyPanel = el('section', { className: 'chat-drawer', hidden: true });
  const historyHeader = el('header', { className: 'chat-drawer__header' });
  const historyTitle = el('strong', { textContent: '最近对话' });
  const clearHistoryButton = createButton('清空', 'text-button');
  const closeHistoryButton = createButton('关闭', 'text-button');
  historyHeader.append(historyTitle, clearHistoryButton, closeHistoryButton);
  const historyList = el('div', { className: 'history-list' });
  historyPanel.append(historyHeader, historyList);

  const soundPanel = el('section', { className: 'chat-drawer sound-panel', hidden: true });
  const soundHeader = el('header', { className: 'chat-drawer__header' });
  const soundTitle = el('strong', { textContent: '声音' });
  const closeSoundButton = createButton('关闭', 'text-button');
  soundHeader.append(soundTitle, closeSoundButton);
  const speechVolumeInput = document.createElement('input');
  speechVolumeInput.type = 'range';
  speechVolumeInput.min = '0';
  speechVolumeInput.max = '1';
  speechVolumeInput.step = '0.01';
  speechVolumeInput.value = '0.6';
  speechVolumeInput.setAttribute('aria-label', '角色语音音量');
  const speechVolumeOutput = el('output', { className: 'sound-panel__value', textContent: '60%' });
  const speechVolumeControl = el('div', { className: 'sound-panel__control' });
  speechVolumeControl.append(speechVolumeInput, speechVolumeOutput);
  const soundHint = document.createElement('p');
  soundHint.className = 'settings-status';
  soundHint.textContent = '只调整角色 TTS 播放音量，不改变系统总音量。';
  soundPanel.append(soundHeader, speechVolumeControl, soundHint);

  const memoryPanel = mountMemoryPanel({
    api,
    getRecords: () => memoryRecords,
    getCandidates: () => memoryCandidates,
    reload: () => loadMemories(),
  });
  const {
    exportMemoryButton,
    backupMemoryButton,
    memoryControls,
    memoryStatus,
    automaticPolicy,
    memoryIndexSettings,
    candidateTitle,
    candidateList,
    confirmedMemoryTitle,
    memoryList,
  } = memoryPanel.elements;
  const debugPanel = el('section', { className: 'chat-drawer context-debug-panel', hidden: true });
  const debugHeader = el('header', { className: 'chat-drawer__header' });
  const debugTitle = el('strong', { textContent: '本轮上下文说明' });
  const closeDebugButton = createButton('关闭', 'text-button');
  debugHeader.append(debugTitle, closeDebugButton);
  const debugContent = el('div', { className: 'context-debug__content' });
  debugPanel.append(debugHeader, debugContent);

  const settingsPanel = el('form', { className: 'chat-drawer settings-panel', hidden: true });
  const settingsHeader = el('header', { className: 'chat-drawer__header' });
  const settingsTitle = el('strong', { textContent: '设置' });
  const closeSettingsButton = createButton('关闭', 'text-button');
  settingsHeader.append(settingsTitle);

  const scaleInput = document.createElement('input');
  scaleInput.type = 'range';
  scaleInput.min = String(MIN_WINDOW_SCALE);
  scaleInput.max = String(MAX_WINDOW_SCALE);
  scaleInput.step = '0.01';
  scaleInput.value = '0.78';
  scaleInput.setAttribute('aria-label', '桌宠大小');
  const scaleOutput = el('output', { className: 'scale-output', textContent: '78%' });
  const scaleControl = el('div', { className: 'scale-control' });
  scaleControl.append(scaleInput, scaleOutput);
  const scaleField = el('label', { className: 'settings-field' });
  const scaleLabel = el('span', { textContent: '桌宠大小' });
  scaleField.append(scaleLabel, scaleControl);

  const providerPanel = mountProviderSettings({
    api,
    save: (status) => saveSettings(status, false),
    setStatus: (message) => {
      settingsStatus.textContent = message;
    },
    formatError: (error) => errorMessages[error.code],
    createRequestId: () => createRequestId('test'),
  });
  const {
    providerSelect,
    modelInput,
    baseUrlInput,
    allowRemoteComplexTasksInput,
    remoteProviderSelect,
    remoteModelInput,
    remoteApiKeyInput,
    apiKeyInput,
    modelCollaborationPanel,
    baseUrlField,
    secretRow,
    connectionActions,
    connectionStatus,
  } = providerPanel.elements;
  const { updateProviderVisibility, updateCollaborationVisibility, updateSecretStatus } =
    providerPanel;
  const characterPanel = mountCharacterSettings({
    api,
    resizeTarget: settingsPanel,
    confirmAction: (input) => confirmAction(input),
    createRequestId,
    refreshActiveCharacter: () => refreshActiveCharacter(),
    setStatus: (message) => {
      settingsStatus.textContent = message;
    },
    showCharacterSettings: () => showSettingsPage('character'),
    onNameChanged: () => updatePreciseWakeWordFields(),
  });
  const {
    characterNameInput,
    characterSearchNameInput,
    characterSearchStatus,
    characterSearchCandidates,
    loreEditor,
    userNameInput,
    bioInput,
    personaInput,
  } = characterPanel.elements;
  const {
    fillLoreEditor,
    readLoreEditor,
    resizeLoreTextareas,
    loadCharacterLibrary,
    loadGlossaryStatus,
  } = characterPanel;
  const settingsStatus = el('p', { className: 'settings-status', attrs: { role: 'status' } });
  const modelCapabilityStatus = el('p', { className: 'settings-status' });
  const speechPanel = mountSpeechSettings({
    api,
    onStatus: (status) => displaySpeechStatus(status),
    getStatus: () => currentSpeechStatus,
    setReadiness: (status) => {
      currentSpeechStatus = status;
    },
  });
  const {
    speechSettingsPanel,
    speechEnabledInput,
    speechProviderSelect,
    speechBaseUrlInput,
    speechModelInput,
    speechVoiceInput,
    speechFormatSelect,
    speechSpeedInput,
    speechInputEnabledInput,
    speechInputModeInputs,
    readSpeechInputMode,
    speechWakeWordSourceSelect,
    speechCustomWakeWordInput,
    speechCustomWakeWordField,
    speechWakeWordHint,
    speechPushToTalkKeySelect,
    speechTranscriptionBaseUrlInput,
    speechTranscriptionModelInput,
    speechTranscriptionLanguageInput,
    speechApiKeyInput,
    deleteSpeechSecretButton,
    speechStatus,
    displaySpeechLanguage,
    readSpeechLanguage,
    resourceCenterRoot,
    updateSpeechProviderFields,
  } = speechPanel.elements;
  const { displayLocalSpeechAssetStatus } = speechPanel;
  const vtubePanel = mountVTubeSettings({
    api,
    setDisplayModeInputs: (mode) => setDisplayModeInputs(mode),
    persistCharacterDisplayMode: (mode) => persistCharacterDisplayMode(mode),
    closeDrawers: () => closeDrawers(),
  });
  const {
    viewerExSettingsPanel,
    viewerExEnabledInput,
    readViewerExSettings,
    vTubeStudioSettingsPanel,
    vTubeStudioEnabledInput,
    readVTubeStudioSettings,
  } = vtubePanel.elements;
  const { displayViewerExStatus, displayVTubeStudioStatus, inspectSelectedVTubeStudio } =
    vtubePanel;
  const live2DSettingsPanel = el('section', { className: 'display-mode-pane' });
  const live2DSettingsHeading = el('label', { className: 'settings-toggle-heading' });
  const live2DSettingsTitle = el('strong', { textContent: '启用纯 Live2D' });
  const live2DEnabledInput = document.createElement('input');
  live2DEnabledInput.type = 'checkbox';
  live2DEnabledInput.setAttribute('aria-label', '启用纯 Live2D');
  live2DSettingsHeading.append(live2DSettingsTitle, live2DEnabledInput);
  const live2DHint = el('small', { className: 'settings-hint' });
  live2DHint.textContent =
    '由 FPNF 直接加载当前角色包中的 Live2D 模型。关闭或改用外部显示时会立即卸载内置模型。';
  const importLive2DModelButton = createButton('导入 Live2D 模型', 'secondary-button');
  const exportLive2DModelButton = createButton('导出当前导入模型', 'secondary-button');
  const live2DImportHint = el('small', { className: 'settings-hint' });
  live2DImportHint.textContent =
    '选择模型主目录中的 .model3.json；程序会检查并复制它引用的纹理、动作、表情和物理文件。';
  const live2DImportStatus = el('p', { className: 'settings-status', attrs: { role: 'status' } });
  live2DSettingsPanel.append(
    live2DSettingsHeading,
    live2DHint,
    importLive2DModelButton,
    exportLive2DModelButton,
    live2DImportHint,
    live2DImportStatus,
    modelCapabilityStatus,
  );

  const displayModeSettings = el('section', { className: 'display-mode-settings' });
  const displayModeHeader = el('header', { className: 'settings-section__header' });
  const displayModeTitle = el('strong', { textContent: '角色显示方式' });
  const displayModeDescription = document.createElement('small');
  displayModeDescription.textContent = '三个方式默认关闭；同一时间最多启用一个。';
  displayModeHeader.append(displayModeTitle, displayModeDescription);
  const displayModeBody = el('div', { className: 'display-mode-settings__body' });
  const displayModeTabs = document.createElement('nav');
  displayModeTabs.className = 'display-mode-tabs';
  displayModeTabs.setAttribute('aria-label', '角色显示方式');
  const displayModeContent = el('div', { className: 'display-mode-content' });
  displayModeContent.append(live2DSettingsPanel, viewerExSettingsPanel, vTubeStudioSettingsPanel);
  const displayTabButtons = new Map<Exclude<CharacterDisplayMode, 'off'>, HTMLButtonElement>();
  for (const [mode, label] of [
    ['live2d', '纯 Live2D'],
    ['viewerex', 'ViewerEX'],
    ['vtube-studio', 'VTube Studio'],
  ] as const) {
    const button = createButton(label, 'display-mode-tab');
    button.setAttribute('aria-pressed', 'false');
    displayTabButtons.set(mode, button);
    displayModeTabs.append(button);
  }
  displayModeBody.append(displayModeTabs, displayModeContent);
  displayModeSettings.append(displayModeHeader, displayModeBody);

  let selectedDisplayTab: Exclude<CharacterDisplayMode, 'off'> = 'live2d';
  let activeCharacterDisplayMode: CharacterDisplayMode = 'off';
  let currentDesktopLayoutSettings: DesktopLayoutSettings = {
    ...DEFAULT_DESKTOP_LAYOUT_SETTINGS,
  };
  const showDisplayTab = (mode: Exclude<CharacterDisplayMode, 'off'>): void => {
    selectedDisplayTab = mode;
    live2DSettingsPanel.hidden = mode !== 'live2d';
    viewerExSettingsPanel.hidden = mode !== 'viewerex';
    vTubeStudioSettingsPanel.hidden = mode !== 'vtube-studio';
    for (const [candidate, button] of displayTabButtons) {
      const selected = candidate === mode;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  };
  const setDisplayModeInputs = (mode: CharacterDisplayMode): void => {
    live2DEnabledInput.checked = mode === 'live2d';
    viewerExEnabledInput.checked = mode === 'viewerex';
    vTubeStudioEnabledInput.checked = mode === 'vtube-studio';
  };
  const readCharacterDisplayMode = (): CharacterDisplayMode =>
    live2DEnabledInput.checked
      ? 'live2d'
      : viewerExEnabledInput.checked
        ? 'viewerex'
        : vTubeStudioEnabledInput.checked
          ? 'vtube-studio'
          : 'off';
  const readAvailablePresentationActions = (): string[] =>
    readCharacterDisplayMode() === 'vtube-studio'
      ? ['nod', 'shake']
      : (getCharacter()?.availableActions ?? []);
  const displayCharacterDisplayMode = (mode: CharacterDisplayMode): void => {
    activeCharacterDisplayMode = mode;
    setDisplayModeInputs(mode);
    showDisplayTab(mode === 'off' ? selectedDisplayTab : mode);
    root.dataset.characterPane =
      mode === 'vtube-studio' ? 'left' : currentDesktopLayoutSettings.characterPane;
    onDisplayModeChanged(mode);
  };
  const persistCharacterDisplayMode = (mode: CharacterDisplayMode) =>
    api
      ? transitionCharacterDisplayMode({
          currentMode: activeCharacterDisplayMode,
          targetMode: mode,
          applyLocalMode: displayCharacterDisplayMode,
          persistMode: (targetMode) => api.setCharacterDisplayMode({ mode: targetMode }),
        })
      : Promise.resolve({ ok: false, mode, message: '角色显示方式不可用。' });
  for (const [mode, button] of displayTabButtons) {
    button.addEventListener('click', () => showDisplayTab(mode));
  }
  for (const [mode, input] of [
    ['live2d', live2DEnabledInput],
    ['viewerex', viewerExEnabledInput],
    ['vtube-studio', vTubeStudioEnabledInput],
  ] as const) {
    input.addEventListener('change', () => {
      setDisplayModeInputs(input.checked ? mode : 'off');
      settingsStatus.textContent = input.checked
        ? `将切换到${displayTabButtons.get(mode)?.textContent ?? '所选'}显示；点击“保存”后生效。`
        : '角色显示将关闭；点击“保存”后生效。';
    });
  }
  showDisplayTab('live2d');
  const desktopIntegrationPanel = el('section', { className: 'character-search' });
  const desktopIntegrationHeading = el('label', { className: 'settings-toggle-heading' });
  const desktopIntegrationTitle = el('strong', { textContent: '桌面快捷操作' });
  const globalShortcutInput = document.createElement('input');
  globalShortcutInput.type = 'checkbox';
  globalShortcutInput.setAttribute('aria-label', '仅在桌宠窗口被选中时启用快捷键');
  desktopIntegrationHeading.append(desktopIntegrationTitle, globalShortcutInput);
  const globalShortcutHint = document.createElement('small');
  globalShortcutHint.className = 'settings-hint settings-toggle-hint';
  globalShortcutHint.textContent = '仅在桌宠窗口被选中时启用快捷键';
  const visibilityShortcutInput = document.createElement('input');
  visibilityShortcutInput.maxLength = 64;
  visibilityShortcutInput.autocomplete = 'off';
  visibilityShortcutInput.spellcheck = false;
  const visibilityShortcutField = createField('切换快捷键', visibilityShortcutInput);
  const visibilityShortcutHint = el('small', { className: 'settings-hint' });
  visibilityShortcutHint.textContent =
    '默认是 、 键（系统记作 \\）；切到其他程序后不会占用。隐藏后请点击托盘图标重新显示。';
  visibilityShortcutField.append(visibilityShortcutHint);
  const stopGenerationShortcutInput = document.createElement('input');
  stopGenerationShortcutInput.maxLength = 64;
  stopGenerationShortcutInput.autocomplete = 'off';
  stopGenerationShortcutInput.spellcheck = false;
  const stopGenerationShortcutField = createField('停止生成快捷键', stopGenerationShortcutInput);
  const stopGenerationShortcutHint = el('small', { className: 'settings-hint' });
  stopGenerationShortcutHint.textContent =
    '默认 Ctrl+Shift+Delete；只在桌宠窗口被选中时生效，不记录普通按键。';
  stopGenerationShortcutField.append(stopGenerationShortcutHint);
  const inputOverlayEnabledInput = document.createElement('input');
  inputOverlayEnabledInput.type = 'checkbox';
  inputOverlayEnabledInput.setAttribute('aria-label', '启用本机输入显示');
  const inputOverlayKeysInput = document.createElement('input');
  inputOverlayKeysInput.maxLength = 256;
  inputOverlayKeysInput.autocomplete = 'off';
  inputOverlayKeysInput.spellcheck = false;
  const inputOverlayKeysField = createField('显示按键', inputOverlayKeysInput);
  const inputOverlayHint = el('small', { className: 'settings-hint' });
  inputOverlayHint.textContent =
    '默认 W, A, S, D；可用逗号、顿号、分号或空格添加最多 24 个按键，输入时不会被状态刷新覆盖。只显示选定按键，不保存输入内容或轨迹，也不会发送给模型。';
  inputOverlayKeysField.append(inputOverlayHint);
  const inputOverlayMouseInput = el('input', { type: 'checkbox' });
  const inputOverlayMouseField = el('label', { className: 'settings-field' });
  inputOverlayMouseField.append(inputOverlayMouseInput, ' 显示鼠标三键和移动方向');
  const mediaControlInput = document.createElement('input');
  mediaControlInput.type = 'checkbox';
  mediaControlInput.setAttribute('aria-label', '启用系统媒体控制');
  const desktopIntegrationStatus = document.createElement('p');
  desktopIntegrationStatus.className = 'settings-status';
  desktopIntegrationStatus.textContent = '窗口快捷键默认关闭。';
  const mediaActions = el('div', { className: 'settings-actions widget-media-actions' });
  const previousMediaButton = createButton('上一首', 'text-button');
  const playPauseMediaButton = createButton('播放 / 暂停', 'text-button');
  const nextMediaButton = createButton('下一首', 'text-button');
  mediaActions.append(previousMediaButton, playPauseMediaButton, nextMediaButton);
  let mediaCommandInFlight = false;
  let mediaControlsAvailable = false;
  let mediaStatusRefreshInFlight = false;
  desktopIntegrationPanel.append(
    desktopIntegrationHeading,
    globalShortcutHint,
    visibilityShortcutField,
    stopGenerationShortcutField,
    desktopIntegrationStatus,
  );
  const widgetsPanel = el('section', { className: 'chat-drawer widgets-panel', hidden: true });
  const widgetsHeader = el('header', { className: 'chat-drawer__header' });
  const widgetsTitle = el('strong', { textContent: '小组件' });
  const closeWidgetsButton = createButton('关闭', 'text-button');
  widgetsHeader.append(widgetsTitle, closeWidgetsButton);
  const widgetsContent = el('div', { className: 'widgets-panel__content' });
  const widgetsCatalog = el('div', { className: 'widget-catalog' });
  let widgetOrder: DesktopWidgetId[] = [];
  const createWidgetCatalogCard = (
    definition: DesktopWidgetDefinition,
  ): {
    card: HTMLElement;
    toggleButton: HTMLButtonElement;
    settingsButton: HTMLButtonElement;
  } => {
    const card = el('article', { className: 'widget-catalog-card' });
    const icon = document.createElement('span');
    icon.className = 'widget-catalog-card__icon';
    icon.textContent = definition.iconText;
    const copy = el('span', { className: 'widget-catalog-card__copy' });
    const title = el('strong', { textContent: definition.title });
    const description = el('small', { textContent: definition.description });
    copy.append(title, description);
    const actions = el('span', { className: 'widget-catalog-card__actions' });
    const toggleButton = createButton('已关闭', 'widget-catalog-card__status');
    toggleButton.title = `启用${definition.title}`;
    const settingsButton = createButton('设置', 'widget-catalog-card__settings');
    settingsButton.title = `${definition.title}的额外设置`;
    actions.append(toggleButton, settingsButton);
    card.append(icon, copy, actions);
    return { card, toggleButton, settingsButton };
  };
  const widgetCards = new Map<DesktopWidgetId, ReturnType<typeof createWidgetCatalogCard>>();
  for (const definition of desktopWidgetRegistry.list()) {
    const card = createWidgetCatalogCard(definition);
    widgetCards.set(definition.id, card);
    widgetsCatalog.append(card.card);
  }
  const inputWidget = el('section', { className: 'widget-detail', hidden: true });
  const inputWidgetHeader = el('div', { className: 'widget-detail__header' });
  const backFromInputWidgetButton = createButton('返回', 'text-button');
  const inputWidgetTitle = el('strong', { textContent: '输入显示' });
  inputWidgetHeader.append(backFromInputWidgetButton, inputWidgetTitle, inputOverlayEnabledInput);
  inputWidget.append(inputWidgetHeader, inputOverlayKeysField, inputOverlayMouseField);
  const mediaWidget = el('section', { className: 'widget-detail', hidden: true });
  const mediaWidgetHeader = el('div', { className: 'widget-detail__header' });
  const backFromMediaWidgetButton = createButton('返回', 'text-button');
  const mediaWidgetTitle = el('strong', { textContent: '听歌控制' });
  const mediaWidgetHint = el('small', { className: 'settings-hint' });
  mediaWidgetHint.textContent =
    '读取并控制 Windows 当前媒体会话，包括网易云音乐、QQ 音乐、Spotify、Apple Music 和支持系统媒体控制的其他播放器。开启后悬浮控制条会固定保留。';
  mediaWidgetHeader.append(backFromMediaWidgetButton, mediaWidgetTitle, mediaControlInput);
  mediaWidget.append(mediaWidgetHeader, mediaWidgetHint, mediaActions);
  const widgetsStatus = document.createElement('p');
  widgetsStatus.className = 'settings-status widgets-panel__status';
  widgetsStatus.textContent = '输入显示和听歌控制默认关闭。';
  widgetsContent.append(widgetsCatalog, inputWidget, mediaWidget, widgetsStatus);
  widgetsPanel.append(widgetsHeader, widgetsContent);
  const showWidgetView = (view: 'catalog' | DesktopWidgetId): void => {
    widgetsCatalog.hidden = view !== 'catalog';
    inputWidget.hidden = view !== 'input';
    mediaWidget.hidden = view !== 'media';
    widgetsTitle.textContent =
      view === 'input' ? '小组件 · 输入显示' : view === 'media' ? '小组件 · 听歌控制' : '小组件';
  };
  for (const definition of desktopWidgetRegistry.list()) {
    widgetCards
      .get(definition.id)
      ?.settingsButton.addEventListener('click', () => showWidgetView(definition.settingsView));
  }
  backFromInputWidgetButton.addEventListener('click', () => showWidgetView('catalog'));
  backFromMediaWidgetButton.addEventListener('click', () => showWidgetView('catalog'));
  const settingsActions = el('div', { className: 'settings-actions' });
  const saveButton = createButton('保存', 'primary-button');
  saveButton.type = 'submit';
  settingsActions.append(saveButton);
  const createSettingsSection = (title: string, description: string): HTMLElement => {
    const section = el('section', { className: 'settings-section' });
    const heading = el('header', { className: 'settings-section__header' });
    const sectionTitle = el('strong', { textContent: title });
    const sectionDescription = el('small', { textContent: description });
    heading.append(sectionTitle, sectionDescription);
    section.append(heading);
    return section;
  };

  const modelSettingsSection = createSettingsSection(
    '模型与窗口',
    '管理聊天模型、连接方式、密钥、桌宠大小和安全布局位置。',
  );
  const diagnosticLogButton = createButton('打开诊断日志', 'secondary-button');
  const diagnosticLogStatus = el('p', { className: 'settings-status', attrs: { role: 'status' } });
  const assistantWorkspacePanel = document.createElement('section');
  assistantWorkspacePanel.className = 'character-search assistant-workspace-settings';
  const assistantWorkspaceHeading = el('strong', { textContent: '工作区与权限' });
  const assistantWorkspaceHint = el('small', { className: 'settings-hint' });
  assistantWorkspaceHint.textContent =
    '选择工作区即授权助手直接读取、搜索、修改和打开其中的安全文件。工作模式开启后，可把文本或文件拖到整个对话区。工作区外文件操作、脚本或程序打开、固定项目检查仍会显示实际目标并逐次确认；主动拖入文件不会覆盖同名文件。';
  const assistantWorkspaceStatus = document.createElement('p');
  assistantWorkspaceStatus.className = 'settings-status';
  assistantWorkspaceStatus.setAttribute('role', 'status');
  assistantWorkspacePanel.append(
    assistantWorkspaceHeading,
    assistantWorkspaceHint,
    assistantWorkspaceStatus,
    assistantWorkspaceButton,
  );
  modelSettingsSection.append(
    scaleField,
    createField('提供商', providerSelect),
    createField('模型名称', modelInput),
    baseUrlField,
    createField('API Key', apiKeyInput),
    secretRow,
    connectionActions,
    connectionStatus,
    modelCollaborationPanel,
    diagnosticLogButton,
    diagnosticLogStatus,
  );

  const readDesktopLayoutSettings = (): DesktopLayoutSettings => ({
    ...currentDesktopLayoutSettings,
  });
  const displayDesktopLayoutSettings = (settings: DesktopLayoutSettings): void => {
    currentDesktopLayoutSettings = settings;
    root.dataset.characterPane =
      activeCharacterDisplayMode === 'vtube-studio' ? 'left' : settings.characterPane;
    root.dataset.widgetAlignment = settings.widgetAlignment;
  };

  const assistantSettingsSection = createSettingsSection(
    '工作模式',
    '像小型 Agent 一样处理问答、资料和代码；工作区与已启用小组件采用范围授权，越界和高风险操作逐次确认。',
  );
  const assistantModeComparison = el('div', { className: 'mode-comparison' });
  const createModeComparisonCard = (
    title: string,
    badge: string,
    description: string,
    capabilities: readonly string[],
  ): HTMLElement => {
    const card = el('article', { className: 'mode-comparison__card' });
    const heading = document.createElement('header');
    const name = el('strong', { textContent: title });
    const state = el('span', { textContent: badge });
    heading.append(name, state);
    const detail = el('p', { textContent: description });
    const list = document.createElement('ul');
    for (const capability of capabilities) {
      const item = el('li', { textContent: capability });
      list.append(item);
    }
    card.append(heading, detail, list);
    return card;
  };
  assistantModeComparison.append(
    createModeComparisonCard('普通聊天', 'OFF', '只作为角色陪你对话，不会调用工具。', [
      '普通对话与角色表现',
      '使用对话记忆',
      '不读写工作区，不查网页',
    ]),
    createModeComparisonCard(
      '工作模式',
      'ON',
      '在对话中拆解任务，并使用已授权的代码、文件和网页工具完成实际工作。',
      [
        '普通问答、联网搜索与公开网页阅读',
        '所选工作区内文件操作直接执行',
        '工作区外文件、脚本和项目检查前确认',
        '已启用小组件的固定能力直接执行',
      ],
    ),
  );
  const assistantInterfacePanel = document.createElement('section');
  assistantInterfacePanel.className = 'character-search assistant-interface';
  const assistantInterfaceTitle = el('strong', { textContent: '当前工作接口' });
  const assistantInterfaceList = document.createElement('ul');
  for (const description of [
    '文件接口：列出、搜索、读取、新建、精确修改或打开文件。',
    '网页接口：搜索网页、读取 HTTPS 公开页面。',
    '授权边界：工作区内直接操作；工作区外真实路径与可执行文件逐次确认。',
    '小组件边界：启用听歌控制即授权上一首、播放/暂停和下一首。',
  ]) {
    const item = el('li', { textContent: description });
    assistantInterfaceList.append(item);
  }
  assistantInterfacePanel.append(assistantInterfaceTitle, assistantInterfaceList);
  assistantSettingsSection.append(
    assistantModeComparison,
    assistantInterfacePanel,
    assistantWorkspacePanel,
  );

  const characterSettingsSection = createSettingsSection(
    '角色',
    '集中管理角色库、角色包、自建资料和联网查找。',
  );
  characterSettingsSection.append(characterPanel.pageBody);
  const speechSettingsSection = createSettingsSection(
    '语音和语音输入',
    '分开管理语音生成与中文麦克风输入，并为本地语音模型和在线 TTS 保留扩展位置。',
  );
  speechSettingsSection.append(speechSettingsPanel);

  const resourceSettingsSection = createSettingsSection(
    '资源中心',
    '在独立窗口中管理引擎、基础模型、音色模型和语音识别。',
  );
  const openResourceCenterButton = createButton('打开资源中心', 'primary-button');
  const resourceWindowStatus = el('p', { className: 'settings-status', attrs: { role: 'status' } });
  openResourceCenterButton.addEventListener('click', () => {
    if (!api) return;
    openResourceCenterButton.disabled = true;
    void api
      .openResourceCenter()
      .then(() => {
        resourceWindowStatus.textContent = '资源中心已在独立窗口打开。';
      })
      .catch(() => {
        resourceWindowStatus.textContent = '资源中心打开失败，请重试。';
      })
      .finally(() => {
        openResourceCenterButton.disabled = false;
      });
  });
  resourceSettingsSection.append(openResourceCenterButton, resourceWindowStatus);

  const displaySettingsSection = createSettingsSection(
    '模型显示方式',
    '选择内嵌 Live2D、ViewerEX 或 VTube Studio，并保持同一时间只显示一个角色。',
  );
  displaySettingsSection.append(displayModeSettings);

  const desktopSettingsSection = createSettingsSection(
    '桌面快捷操作',
    '管理桌宠窗口快捷键和其他桌面集成。',
  );
  desktopSettingsSection.append(desktopIntegrationPanel);

  const widgetsSettingsSection = createSettingsSection(
    '小组件',
    '集中管理桌面输入显示、听歌控制，并为以后的新组件保留统一接入方式。',
  );
  const widgetsInterfacePanel = el('section', { className: 'character-search widgets-interface' });
  const widgetsInterfaceTitle = el('strong', { textContent: '小组件接口' });
  const widgetsInterfaceDescription = document.createElement('p');
  widgetsInterfaceDescription.textContent =
    '当前组件通过统一目录注册名称、图标、说明和设置页；开关状态会由 Main Process 验证后保存。以后可继续增加日历、待办、系统状态等组件，无需挤进桌面快捷操作页。';
  widgetsInterfacePanel.append(widgetsInterfaceTitle, widgetsInterfaceDescription);
  widgetsSettingsSection.append(widgetsInterfacePanel, widgetsContent);

  const memorySettingsSection = createSettingsSection(
    '记忆',
    '独立管理最近对话、长期记忆、待确认候选和本地记忆索引。',
  );
  const memorySettingsActions = document.createElement('div');
  memorySettingsActions.className = 'settings-actions memory-settings-actions';
  memorySettingsActions.append(historyButton, debugButton, exportMemoryButton, backupMemoryButton);
  memorySettingsSection.append(
    memorySettingsActions,
    memoryControls,
    memoryStatus,
    automaticPolicy,
    memoryIndexSettings,
    candidateTitle,
    candidateList,
    confirmedMemoryTitle,
    memoryList,
  );

  const settingsLayout = el('div', { className: 'settings-layout' });
  const settingsNavigation = document.createElement('nav');
  settingsNavigation.className = 'settings-navigation';
  settingsNavigation.setAttribute('aria-label', '设置分类');
  const settingsContent = el('div', { className: 'settings-content' });
  type SettingsPage =
    | 'model'
    | 'assistant'
    | 'speech'
    | 'resources'
    | 'character'
    | 'display'
    | 'widgets'
    | 'desktop'
    | 'memory';
  const settingsPages = [
    ['model', '模型与窗口', modelSettingsSection],
    ['assistant', '工作模式', assistantSettingsSection],
    ['speech', '语音和语音输入', speechSettingsSection],
    ['resources', '资源中心', resourceSettingsSection],
    ['character', '角色', characterSettingsSection],
    ['display', '模型显示方式', displaySettingsSection],
    ['widgets', '小组件', widgetsSettingsSection],
    ['desktop', '桌面快捷操作', desktopSettingsSection],
    ['memory', '记忆', memorySettingsSection],
  ] as const satisfies readonly (readonly [SettingsPage, string, HTMLElement])[];
  const settingsTabButtons = new Map<SettingsPage, HTMLButtonElement>();
  let selectedSettingsPage: SettingsPage = 'model';
  const showSettingsPage = (page: SettingsPage): void => {
    selectedSettingsPage = page;
    for (const [candidate, , section] of settingsPages) {
      const selected = candidate === page;
      section.hidden = !selected;
      const button = settingsTabButtons.get(candidate);
      button?.classList.toggle('is-active', selected);
      button?.setAttribute('aria-pressed', String(selected));
    }
    settingsPanel.scrollTop = 0;
    if (page === 'character' && loreEditor.open) resizeLoreTextareas();
  };
  for (const [page, label, section] of settingsPages) {
    section.classList.add('settings-page');
    const button = createButton(label, 'settings-navigation__tab');
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => showSettingsPage(page));
    settingsTabButtons.set(page, button);
    settingsNavigation.append(button);
    settingsContent.append(section);
  }
  settingsLayout.append(settingsNavigation, settingsContent);
  showSettingsPage(selectedSettingsPage);

  const settingsHeaderActions = el('div', { className: 'settings-header-actions' });
  settingsHeaderActions.append(settingsStatus, settingsActions, closeSettingsButton);
  settingsHeader.append(settingsHeaderActions);
  settingsPanel.append(settingsHeader, settingsLayout);
  const resourceCenterPanel = api
    ? mountResourceCenter(resourceCenterRoot, speechAssetProgressStrip, {
        getStatus: () => api.getResourceCenterStatus(),
        refreshCatalog: () => api.refreshResourceCatalog(),
        control: (input) => api.controlSpeechAssetDownload(input),
      })
    : undefined;

  const actionDialog = el('dialog', { className: 'app-dialog' });
  const actionDialogForm = el('form', { method: 'dialog' });
  const actionDialogTitle = el('strong', { className: 'app-dialog__title' });
  const actionDialogMessage = el('p', { className: 'app-dialog__message' });
  const actionDialogDetails = el('details', { className: 'app-dialog__details' });
  const actionDialogDetailsSummary = el('summary', { textContent: '.....点击展开' });
  const actionDialogDetailsText = document.createElement('p');
  actionDialogDetails.append(actionDialogDetailsSummary, actionDialogDetailsText);
  const actionDialogActions = el('div', { className: 'app-dialog__actions' });
  const actionDialogCancel = createButton('取消', 'secondary-button');
  actionDialogCancel.type = 'submit';
  actionDialogCancel.value = 'cancel';
  const actionDialogConfirm = createButton('继续', 'primary-button');
  actionDialogConfirm.type = 'submit';
  actionDialogConfirm.value = 'confirm';
  actionDialogActions.append(actionDialogCancel, actionDialogConfirm);
  actionDialogForm.append(
    actionDialogTitle,
    actionDialogMessage,
    actionDialogDetails,
    actionDialogActions,
  );
  actionDialog.append(actionDialogForm);

  panel.append(
    panelHeader,
    conversationList,
    speechAssetProgressStrip,
    composer,
    toolbar,
    soundPanel,
    historyPanel,
    debugPanel,
    settingsPanel,
  );
  shell.append(panel);
  root.append(shell, desktopOverlayStack, actionDialog);

  let messages: ConversationMessage[] = [];
  let memoryRecords: MemoryRecord[] = [];
  let memoryCandidates: MemoryCandidateRecord[] = [];
  let profile: CharacterProfile | undefined;
  let activeRequestId: string | undefined;
  let activeReply = '';
  const resetActiveReply = (): void => {
    activeReply = '';
    conversationTimeline.clearActiveReply();
  };
  let assistantModeEnabled = false;
  let assistantWorkspaceConfigured = false;
  let panelExpanded = false;
  let panelView: 'chat' | 'settings' = 'chat';
  let openingLineShown = false;
  let openingLineContext: OpeningLineContext = 'resume';
  let openingLineGeneration = 0;
  let replyStateLabel = '随时可以开始聊天';
  let latestContextDebug: ConversationContextDebug | undefined;
  let currentSpeechStatus: SpeechStatus | undefined;
  let activeSpeechTurn: SpeechTurnPipeline | undefined;
  let microphoneRecorder: MediaRecorder | undefined;
  let microphoneStream: MediaStream | undefined;
  let microphoneChunks: Blob[] = [];
  let microphoneBytes = 0;
  let microphoneOverflowed = false;
  let microphoneLimitTimer: number | undefined;
  let microphoneStarting = false;
  let activeTranscriptionId: string | undefined;
  let continuousMicrophoneListener: ContinuousMicrophoneListener | undefined;
  let continuousMicrophoneStarting = false;
  let pushToTalkPressed = false;
  let companionDrowsy = false;
  const wakeWordCommands = new WakeWordCommandSession();
  const pendingVoiceCommands = new PendingVoiceCommandQueue(4);
  let lastFullVoiceCommand: { text: string; endedAt: number } | undefined;
  let pendingCombinedVoiceCommand: { text: string; endedAt: number } | undefined;
  let controllerDisposed = false;
  const currentPreciseWakeWord = (): string =>
    resolvePreciseWakeWord(
      currentSpeechStatus?.settings.wakeWordSource ?? 'character-name',
      currentSpeechStatus?.settings.customWakeWord ?? '',
      profile?.name ?? '桌宠',
    );
  const updatePreciseWakeWordFields = (): void => {
    const custom = speechWakeWordSourceSelect.value === 'custom';
    speechCustomWakeWordField.hidden = !custom;
    speechCustomWakeWordInput.disabled = !custom;
    const draft = resolvePreciseWakeWord(
      speechWakeWordSourceSelect.value as SpeechWakeWordSource,
      speechCustomWakeWordInput.value,
      characterNameInput.value.trim() || profile?.name || '桌宠',
    );
    speechWakeWordHint.textContent = `精准模式当前称呼：“${draft}”。请在同一句开头先说这个称呼。`;
    const toolbarButton = speechInputModeToolbarButtons.get('half');
    if (toolbarButton) toolbarButton.title = `精准：说“${draft} + 内容”才自动发送`;
  };
  const speechPlayer = new WebAudioSpeechPlayer();
  const speechClient = api ? new IpcSpeechSynthesisClient(api) : undefined;
  const isKittenProfile = (): boolean =>
    profile?.name === '小猫' || profile?.lore?.canonicalName === '小猫';
  const idleCompanion = new IdleCompanionScheduler(() => {
    if (activeRequestId || !isKittenProfile()) {
      idleCompanion.reset();
      return;
    }
    const line = selectKittenDrowsyLine();
    companionDrowsy = true;
    messages.push({
      id: createRequestId('idle'),
      role: 'assistant',
      content: line.displayText,
      createdAt: Date.now(),
      status: 'complete',
      emotion: 'neutral',
      action: 'drowsy',
    });
    setReplyStatus('有点困了');
    renderHistory();
    const speechTurn = beginSpeechTurn(createRequestId('idle-speech'));
    if (speechTurn) {
      speechTurn.appendText(line.speechText);
      void speechTurn.finish().then(() => {
        if (activeSpeechTurn === speechTurn) {
          activeSpeechTurn = undefined;
          stopSpeechButton.hidden = true;
          getPresentation()?.resetSpeech();
          if (!activeRequestId) void getPresentation()?.respond('neutral', 'drowsy');
        }
      });
    } else {
      void getPresentation()?.respond('neutral', 'drowsy');
    }
  });

  const resetMicrophoneButton = (): void => {
    const inputMode = currentSpeechStatus?.settings.inputMode ?? 'manual';
    if (inputMode !== 'manual') {
      const listening = continuousMicrophoneListener?.active === true;
      microphoneButton.textContent = listening ? '在听...' : '开启监听';
      microphoneButton.setAttribute('aria-pressed', String(listening));
      microphoneButton.disabled =
        !currentSpeechStatus?.input.available ||
        Boolean(activeRequestId) ||
        continuousMicrophoneStarting;
      return;
    }
    microphoneButton.textContent = '说话';
    microphoneButton.setAttribute('aria-pressed', 'false');
    microphoneButton.disabled =
      !currentSpeechStatus?.input.available || Boolean(activeRequestId) || microphoneStarting;
  };

  const transcribeMicrophoneAudio = async (audio: Uint8Array): Promise<string | undefined> => {
    if (!api || audio.byteLength === 0 || audio.byteLength > MAX_SPEECH_INPUT_AUDIO_BYTES) {
      speechStatus.textContent = '录音太长或为空，请缩短后重试。';
      return undefined;
    }
    const requestId = createRequestId('asr');
    activeTranscriptionId = requestId;
    try {
      const result = await api.transcribeSpeech({ requestId, audio, mimeType: 'audio/wav' });
      if (activeTranscriptionId !== requestId) return undefined;
      if (!result.ok) {
        if (!result.cancelled) speechStatus.textContent = result.message;
        return undefined;
      }
      return result.text;
    } finally {
      if (activeTranscriptionId === requestId) activeTranscriptionId = undefined;
    }
  };

  const releaseMicrophone = (): void => {
    if (microphoneLimitTimer !== undefined) {
      window.clearTimeout(microphoneLimitTimer);
      microphoneLimitTimer = undefined;
    }
    for (const track of microphoneStream?.getTracks() ?? []) track.stop();
    microphoneStream = undefined;
    microphoneRecorder = undefined;
    resetMicrophoneButton();
  };

  const processMicrophoneRecording = async (recording: Blob): Promise<void> => {
    releaseMicrophone();
    if (controllerDisposed) return;
    if (!api || recording.size === 0 || recording.size > MAX_CAPTURED_AUDIO_BYTES) {
      speechStatus.textContent =
        recording.size > MAX_CAPTURED_AUDIO_BYTES ? '录音太大，请缩短后重试。' : '没有录到声音。';
      return;
    }
    microphoneButton.textContent = '识别中…';
    microphoneButton.disabled = true;
    try {
      const audio = await convertRecordingToTranscriptionWav(recording);
      const transcript = await transcribeMicrophoneAudio(audio);
      if (!transcript) return;
      input.value = transcript;
      input.focus();
      speechStatus.textContent = '中文已经填入输入框；确认后再点“发送”。';
    } catch {
      speechStatus.textContent = '录音处理失败；仍可直接输入文字。';
    } finally {
      resetMicrophoneButton();
    }
  };

  const stopMicrophoneRecording = (): void => {
    if (microphoneRecorder?.state === 'recording') {
      microphoneButton.textContent = '处理中…';
      microphoneButton.disabled = true;
      microphoneRecorder.stop();
    }
  };

  const startMicrophoneRecording = async (pushToTalk = false): Promise<void> => {
    if (
      !api ||
      !currentSpeechStatus?.input.available ||
      currentSpeechStatus.settings.inputMode !== 'manual' ||
      microphoneRecorder ||
      microphoneStarting ||
      activeRequestId
    ) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      speechStatus.textContent = '当前系统不支持麦克风录音；仍可直接输入文字。';
      return;
    }
    microphoneStarting = true;
    microphoneButton.disabled = true;
    stopSpeech('microphone-started');
    if (activeTranscriptionId) {
      void api.cancelSpeech({ requestId: activeTranscriptionId });
      activeTranscriptionId = undefined;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (pushToTalk && !pushToTalkPressed) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      microphoneStream = stream;
      microphoneChunks = [];
      microphoneBytes = 0;
      microphoneOverflowed = false;
      const recorder = new MediaRecorder(stream);
      microphoneRecorder = recorder;
      recorder.addEventListener('dataavailable', (event) => {
        if (!event.data.size) return;
        microphoneBytes += event.data.size;
        if (microphoneBytes <= MAX_CAPTURED_AUDIO_BYTES) microphoneChunks.push(event.data);
        if (microphoneBytes > MAX_CAPTURED_AUDIO_BYTES) {
          microphoneOverflowed = true;
          stopMicrophoneRecording();
        }
      });
      recorder.addEventListener(
        'stop',
        () => {
          const recording = new Blob(microphoneChunks, {
            type: recorder.mimeType || microphoneChunks[0]?.type || 'audio/webm',
          });
          microphoneChunks = [];
          if (microphoneOverflowed) {
            releaseMicrophone();
            speechStatus.textContent = '录音太大，请缩短后重试。';
            return;
          }
          void processMicrophoneRecording(recording);
        },
        { once: true },
      );
      recorder.start(250);
      microphoneButton.textContent = '结束录音';
      microphoneButton.setAttribute('aria-pressed', 'true');
      microphoneButton.disabled = false;
      speechStatus.textContent = pushToTalk
        ? `正在听你说中文；松开 ${currentSpeechStatus.settings.pushToTalkKey} 后识别，最多 30 秒。`
        : '正在听你说中文；再次点击“结束录音”，最多 30 秒。';
      microphoneLimitTimer = window.setTimeout(
        stopMicrophoneRecording,
        MAX_MICROPHONE_RECORDING_MS,
      );
    } catch {
      releaseMicrophone();
      speechStatus.textContent = '无法使用麦克风，请检查 Windows 麦克风权限。';
    } finally {
      microphoneStarting = false;
      if (!microphoneRecorder) resetMicrophoneButton();
    }
  };

  const displayContinuousListenerState = (state: ContinuousListenerState): void => {
    const inputMode = currentSpeechStatus?.settings.inputMode ?? 'manual';
    const preciseWakeWord = currentPreciseWakeWord();
    microphoneButton.textContent = state === 'processing' ? '识别...' : '在听...';
    microphoneButton.setAttribute('aria-pressed', 'true');
    speechStatus.textContent =
      state === 'hearing'
        ? '听到声音了；请自然说完。'
        : state === 'processing'
          ? '正在识别这一句话…'
          : inputMode === 'full'
            ? '完全模式：自动发送；2 秒内继续说会合并并重新思考。点击按钮可暂停。'
            : `精准模式：必须说“${preciseWakeWord} + 内容”才自动发送。点击按钮可暂停。`;
  };

  const stopContinuousListening = async (message?: string): Promise<void> => {
    const listener = continuousMicrophoneListener;
    continuousMicrophoneListener = undefined;
    wakeWordCommands.reset();
    pendingVoiceCommands.clear();
    lastFullVoiceCommand = undefined;
    pendingCombinedVoiceCommand = undefined;
    await listener?.stop();
    resetMicrophoneButton();
    if (message) speechStatus.textContent = message;
  };

  const submitRecognizedVoiceCommand = (
    text: string,
    message: string,
    endedAt = Date.now(),
  ): void => {
    if (currentSpeechStatus?.settings.inputMode === 'full') {
      lastFullVoiceCommand = { text, endedAt };
    }
    input.value = text;
    speechStatus.textContent = message;
    composer.requestSubmit();
  };

  const drainPendingVoiceCommand = (): void => {
    if (
      controllerDisposed ||
      activeRequestId ||
      activeSpeechTurn ||
      currentSpeechStatus?.settings.inputMode !== 'full' ||
      !continuousMicrophoneListener?.active
    ) {
      return;
    }
    const text = pendingVoiceCommands.shift();
    if (!text) return;
    submitRecognizedVoiceCommand(
      text,
      pendingVoiceCommands.size > 0
        ? `正在发送排队语句；后面还有 ${pendingVoiceCommands.size} 句。`
        : '上一轮声音已结束，正在发送排队语句。',
    );
  };

  const submitPendingCombinedVoiceCommand = (): boolean => {
    const pending = pendingCombinedVoiceCommand;
    pendingCombinedVoiceCommand = undefined;
    if (
      !pending ||
      currentSpeechStatus?.settings.inputMode !== 'full' ||
      !continuousMicrophoneListener?.active
    ) {
      return false;
    }
    submitRecognizedVoiceCommand(
      pending.text,
      '已合并刚才连续说的内容，正在重新思考。',
      pending.endedAt,
    );
    return true;
  };

  const handleContinuousUtterance = async (
    audio: Uint8Array,
    timing: ContinuousUtteranceTiming,
  ): Promise<void> => {
    const transcript = await transcribeMicrophoneAudio(audio);
    if (!transcript) return;
    const preciseWakeWord = currentPreciseWakeWord();
    const command = wakeWordCommands.handle(transcript, preciseWakeWord);
    if (command.kind === 'ignored') {
      speechStatus.textContent = `没有听到开头的“${preciseWakeWord}”，未发送。`;
      return;
    }
    if (command.kind === 'armed') {
      speechStatus.textContent = command.message;
      return;
    }
    if (command.kind !== 'send') return;
    const previousFullVoiceCommand = lastFullVoiceCommand;
    const shouldCombineWithActiveFullTurn =
      currentSpeechStatus?.settings.inputMode === 'full' &&
      previousFullVoiceCommand !== undefined &&
      shouldCombineFullListeningCommands(previousFullVoiceCommand.endedAt, timing.startedAt) &&
      Boolean(activeRequestId || activeSpeechTurn);
    if (shouldCombineWithActiveFullTurn && previousFullVoiceCommand) {
      const text = combineFullListeningCommands(previousFullVoiceCommand.text, command.text);
      if (text.length > 16_000) {
        speechStatus.textContent = '连续语音合并后过长；请等当前回复结束后再说。';
        return;
      }
      pendingVoiceCommands.clear();
      lastFullVoiceCommand = { text, endedAt: timing.endedAt };
      stopSpeech('merged-full-listening-command');
      if (activeRequestId) {
        pendingCombinedVoiceCommand = { text, endedAt: timing.endedAt };
        speechStatus.textContent = '两句话间隔很短，已合并；正在停止旧回复并重新思考。';
        void api?.cancelConversation({ requestId: activeRequestId });
      } else {
        submitRecognizedVoiceCommand(
          text,
          '已合并刚才连续说的内容，正在重新思考。',
          timing.endedAt,
        );
      }
      return;
    }
    if (activeRequestId || activeSpeechTurn) {
      if (currentSpeechStatus?.settings.inputMode !== 'full') {
        speechStatus.textContent = '当前回复尚未结束；精准监听不会覆盖正在进行的对话。';
        return;
      }
      const queued = pendingVoiceCommands.enqueue(command.text);
      speechStatus.textContent = queued
        ? `上一轮还在回复或说话；这一句已排队（共 ${pendingVoiceCommands.size} 句）。`
        : '语音等待队列已满；请等上一轮结束后再说。';
      return;
    }
    submitRecognizedVoiceCommand(command.text, command.message, timing.endedAt);
  };

  const startContinuousListening = async (): Promise<void> => {
    const status = currentSpeechStatus;
    if (
      !api ||
      !status?.input.available ||
      status.settings.inputMode === 'manual' ||
      continuousMicrophoneListener?.active ||
      continuousMicrophoneStarting
    ) {
      return;
    }
    continuousMicrophoneStarting = true;
    microphoneButton.disabled = true;
    wakeWordCommands.setMode(status.settings.inputMode);
    const listener = new ContinuousMicrophoneListener({
      onUtterance: handleContinuousUtterance,
      onState: displayContinuousListenerState,
      onError: (message) => {
        speechStatus.textContent = message;
      },
    });
    continuousMicrophoneListener = listener;
    try {
      await listener.start();
    } catch {
      if (continuousMicrophoneListener === listener) continuousMicrophoneListener = undefined;
      await listener.stop();
      speechStatus.textContent = '无法持续监听，请检查 Windows 麦克风权限或改用手动模式。';
    } finally {
      continuousMicrophoneStarting = false;
      resetMicrophoneButton();
    }
  };

  const syncMicrophoneInputMode = (status: SpeechStatus): void => {
    wakeWordCommands.setMode(status.settings.inputMode);
    if (status.settings.inputMode !== 'full') {
      pendingVoiceCommands.clear();
      lastFullVoiceCommand = undefined;
      pendingCombinedVoiceCommand = undefined;
    }
    if (!status.input.available || status.settings.inputMode === 'manual') {
      void stopContinuousListening();
      if (!status.input.available && pushToTalkPressed) {
        pushToTalkPressed = false;
        stopMicrophoneRecording();
      }
      return;
    }
    pushToTalkPressed = false;
    stopMicrophoneRecording();
    releaseMicrophone();
    void startContinuousListening();
  };

  const stopSpeech = (reason = 'user-interrupt'): void => {
    activeSpeechTurn?.cancel(reason);
    activeSpeechTurn = undefined;
    stopSpeechButton.hidden = true;
    getPresentation()?.resetSpeech();
  };

  const beginSpeechTurn = (turnId: string): SpeechTurnPipeline | undefined => {
    stopSpeech('new-turn');
    if (!speechClient || !currentSpeechStatus?.output.available) return undefined;
    const turn = new SpeechTurnPipeline(turnId, speechClient, speechPlayer, {
      maximumSegmentLength: 260,
      minimumStreamingSegmentLength: 12,
      maximumConcurrentSynthesis: 2,
      onLevel: (level) => getPresentation()?.updateSpeechLevel(level),
      onSegmentStart: () => {
        stopSpeechButton.hidden = false;
      },
      onError: (message) => {
        speechStatus.textContent = message;
      },
    });
    activeSpeechTurn = turn;
    return turn;
  };

  const confirmAction = (options: {
    title: string;
    message: string;
    details?: string;
    confirmLabel?: string;
  }): Promise<boolean> => {
    actionDialogTitle.textContent = options.title;
    actionDialogMessage.textContent = options.message;
    actionDialogDetailsText.textContent = options.details ?? '';
    actionDialogDetails.hidden = !options.details;
    actionDialogDetails.open = false;
    actionDialogConfirm.textContent = options.confirmLabel ?? '继续';
    actionDialog.returnValue = 'cancel';
    return new Promise((resolve) => {
      actionDialog.addEventListener(
        'close',
        () => resolve(actionDialog.returnValue === 'confirm'),
        { once: true },
      );
      actionDialog.showModal();
    });
  };

  const displayScale = (scale: number): void => {
    scaleInput.value = scale.toFixed(2);
    scaleOutput.textContent = `${Math.round(scale * 100)}%`;
  };
  const windowScaleSync = api ? new WindowScaleSync(api, displayScale) : undefined;
  const loadWindowScale = async (): Promise<void> => {
    await windowScaleSync?.load();
  };

  const characterDisplayName = (): string =>
    resolveCharacterDisplayName(profile?.name, getCharacter()?.name);

  const setReplyStatus = (label: string): void => {
    replyStateLabel = label;
    replyStatus.textContent = `${characterDisplayName()} · ${label}`;
  };

  const displayAssistantMode = (workspaceName?: string): void => {
    assistantWorkspaceConfigured = Boolean(workspaceName);
    assistantModeButton.textContent = assistantModeEnabled ? '工作模式 ON' : '工作模式 OFF';
    assistantModeButton.classList.toggle('is-active', assistantModeEnabled);
    assistantModeButton.setAttribute('aria-pressed', String(assistantModeEnabled));
    assistantWorkspaceButton.textContent = workspaceName
      ? `工作区：${workspaceName}`
      : '选择工作区';
    assistantWorkspaceStatus.textContent = workspaceName
      ? `当前工作区：${workspaceName}。网页查找可用。`
      : '尚未选择工作区；网页查找仍可用，文件工具暂不可用。';
    assistantWorkspaceButton.title = workspaceName
      ? `当前文件工具只允许访问“${workspaceName}”；点击更换`
      : '选择助手可以读取和修改的文件夹；未选择时仍可查网页';
    showComposerDropStatus('');
  };

  const loadAssistantToolStatus = async (): Promise<void> => {
    if (!api) return;
    const status = await api.getAssistantToolStatus();
    displayAssistantMode(status.workspaceName);
  };

  const updateIdentity = (): void => {
    const name = characterDisplayName();
    replyAuthor.textContent = name;
    modelCapabilityStatus.textContent =
      getCharacter()?.capabilityReport.summary ?? 'Live2D 能力报告将在模型加载后显示。';
    input.placeholder = '输入消息或任务…';
    setReplyStatus(replyStateLabel);
    renderHistory();
  };

  const getDefaultOpeningLine = (): string =>
    profile?.lore?.sampleLines?.find((line) => line.trim().length > 0)?.trim() ||
    `${profile?.userDisplayName || '你'}，我在。`;

  const displayOpeningLine = (line: string): void => {
    activeReply = line;
    renderConversationTimeline();
    setReplyStatus('先和你说了一句');
  };

  const showOpeningLineIfReady = async (): Promise<void> => {
    if (openingLineShown || !profile) return;
    const mode = resolveOpeningLineMode({
      context: openingLineContext,
      conversationMessages: messages.length,
    });
    const generation = ++openingLineGeneration;
    openingLineShown = true;
    openingLineContext = 'resume';
    if (mode === 'default' || !api) {
      displayOpeningLine(getDefaultOpeningLine());
      return;
    }

    setReplyStatus('正在想起上次对话…');
    const result = await api.generateContextualOpeningLine().catch(() => undefined);
    if (generation !== openingLineGeneration || activeRequestId) return;
    displayOpeningLine(result?.line ?? getDefaultOpeningLine());
    if (result) {
      void getPresentation()
        ?.respond(result.emotion)
        .then(() => getPresentation()?.setState('idle'));
    }
  };

  const resetCharacterSessionView = (): void => {
    stopSpeech('character-refresh');
    openingLineGeneration += 1;
    openingLineShown = false;
    resetActiveReply();
    latestContextDebug = undefined;
    memoryRecords = [];
    memoryCandidates = [];
    renderConversationTimeline();
    replyStateLabel = '随时可以开始聊天';
    renderContextDebug();
    renderMemories();
  };

  const refreshActiveCharacter = async (): Promise<void> => {
    if (!api) return;
    resetCharacterSessionView();
    openingLineContext = 'character-refresh';
    messages = await api.getConversationHistory();
    await loadSettings();
    renderHistory();
    reloadActiveCharacter();
  };

  const reloadActiveCharacter = (): void => {
    window.dispatchEvent(new Event('deskpet:reload-character'));
  };

  const displayPanelExpanded = (expanded: boolean): void => {
    shell.classList.toggle('chat-shell--expanded', expanded);
    root.classList.toggle('chat-expanded', expanded);
    root.classList.toggle('settings-expanded', expanded && panelView === 'settings');
    if (expanded) requestAnimationFrame(() => input.focus());
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 240);
  };

  const setPanelExpanded = (expanded: boolean, view: 'chat' | 'settings' = 'chat'): void => {
    if (panelExpanded === expanded && (!expanded || panelView === view)) return;
    panelExpanded = expanded;
    panelView = expanded ? view : 'chat';
    if (!api) {
      displayPanelExpanded(expanded);
      return;
    }

    // Grow the native window before revealing the side panel; hide the panel
    // before shrinking. This keeps the character stage at its stable width
    // instead of exposing one distorted intermediate frame.
    if (!expanded) displayPanelExpanded(false);
    void api
      .setChatPanelExpanded({ expanded, ...(expanded ? { view } : {}) })
      .then(() => {
        if (panelExpanded === expanded && expanded) displayPanelExpanded(true);
      })
      .catch(() => {
        if (panelExpanded !== expanded) return;
        panelExpanded = !expanded;
        displayPanelExpanded(!expanded);
      });
  };

  const closeDrawers = (): void => {
    const wasSettingsOpen = !settingsPanel.hidden;
    soundPanel.hidden = true;
    historyPanel.hidden = true;
    debugPanel.hidden = true;
    widgetsPanel.hidden = true;
    settingsPanel.hidden = true;
    if (wasSettingsOpen && panelExpanded) setPanelExpanded(true, 'chat');
  };

  const renderContextDebug = (): void => {
    debugContent.replaceChildren();
    if (!latestContextDebug) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = '发送一条消息后，这里会显示实际使用的资料、命中原因和回退。';
      debugContent.append(empty);
      return;
    }
    const summary = document.createElement('p');
    summary.textContent = `模型：${latestContextDebug.providerId} / ${latestContextDebug.modelId}；最近消息 ${latestContextDebug.recentMessageCount} 条。`;
    debugContent.append(summary);
    for (const source of latestContextDebug.sources) {
      const item = document.createElement('p');
      item.textContent = `${source.name} · ${source.characters} 字符：${source.reason}`;
      debugContent.append(item);
    }
    for (const example of latestContextDebug.roleplayExamples) {
      const item = document.createElement('p');
      item.textContent = `情境“${example.scene}”（${example.score} 分）：${example.reasons.join('；')}。示例只供学习语气：“${example.line}”`;
      debugContent.append(item);
    }
    for (const fallback of latestContextDebug.fallbacks) {
      const item = el('p', { className: 'settings-status', textContent: `回退：${fallback}` });
      debugContent.append(item);
    }
  };

  const renderConversationTimeline = (): void => {
    conversationTimeline.render(messages, activeReply);
  };

  const renderHistory = (): void => {
    renderConversationTimeline();
    historyList.replaceChildren();
    if (messages.length === 0) {
      const empty = el('p', { className: 'history-empty', textContent: '还没有对话，开始聊吧。' });
      historyList.append(empty);
      return;
    }
    for (const message of messages) {
      const item = el('article', { className: `history-message history-message--${message.role}` });
      const content = el('p', { textContent: message.content });
      item.append(content);
      if (message.status === 'cancelled') {
        const status = el('small', { textContent: '已停止' });
        item.append(status);
      }
      historyList.append(item);
    }
    historyList.scrollTop = historyList.scrollHeight;
  };

  const renderMemories = (): void => memoryPanel.render();

  const loadMemories = async (): Promise<void> => {
    if (!api) return;
    const [settings, records, candidates] = await Promise.all([
      api.getMemorySettings(),
      api.listMemories(),
      api.listMemoryCandidates(),
    ]);
    if (controllerDisposed) return;
    memoryPanel.showSettings(settings);
    memoryRecords = records;
    memoryCandidates = candidates;
    renderMemories();
  };

  const setGenerating = (generating: boolean): void => {
    input.disabled = generating;
    sendButton.hidden = generating;
    stopButton.hidden = !generating;
    microphoneButton.disabled = generating || !currentSpeechStatus?.input.available;
    if (!generating) resetMicrophoneButton();
  };

  const finishPerformance = async (message?: ConversationMessage): Promise<void> => {
    if (message?.role === 'assistant' && message.emotion) {
      void api?.presentInViewerEx({ text: message.content }).catch(() => undefined);
    }
    const presentation = getPresentation();
    if (!presentation) {
      return;
    }
    if (message?.emotion) await presentation.respond(message.emotion, message.action);
    await presentation.setState('idle');
  };

  const handleConversationEvent = (event: ConversationEvent): void => {
    if (event.requestId !== activeRequestId) {
      return;
    }
    if (event.type === 'started') {
      beginSpeechTurn(event.requestId);
      messages.push(event.userMessage);
      renderHistory();
      setReplyStatus('正在思考…');
      return;
    }
    if (event.type === 'context-debug') {
      latestContextDebug = event.debug;
      renderContextDebug();
      return;
    }
    if (event.type === 'text-delta') {
      activeReply += event.text;
      activeSpeechTurn?.appendText(event.text);
      conversationTimeline.appendDelta(event.text);
      setReplyStatus('正在回复…');
      void getPresentation()?.setState('talking');
      return;
    }
    if (event.type === 'tool-status') {
      setReplyStatus(event.label);
      return;
    }
    if (event.type === 'tool-approval') {
      void (async () => {
        const approved = await confirmAction({
          title: event.title,
          message: event.description,
          details:
            '这是一次超出当前范围授权或可能执行代码的操作。Main Process 已解析实际目标；本次允许不会自动授权其他路径或操作。',
          confirmLabel: '允许本次操作',
        });
        await api?.resolveAssistantToolApproval({
          requestId: event.requestId,
          approvalId: event.approvalId,
          approved,
        });
      })();
      return;
    }
    if (event.type === 'completed') {
      resetActiveReply();
      setReplyStatus('回复完成');
      messages.push(event.assistantMessage);
      renderHistory();
      activeRequestId = undefined;
      idleCompanion.reset();
      setGenerating(false);
      if (submitPendingCombinedVoiceCommand()) {
        input.focus();
        return;
      }
      const completedSpeechTurn = activeSpeechTurn;
      if (completedSpeechTurn) {
        void completedSpeechTurn.finish().then(() => {
          if (activeSpeechTurn === completedSpeechTurn) {
            activeSpeechTurn = undefined;
            stopSpeechButton.hidden = true;
            getPresentation()?.resetSpeech();
            drainPendingVoiceCommand();
          }
        });
      } else {
        drainPendingVoiceCommand();
      }
      void finishPerformance(event.assistantMessage);
      input.focus();
      return;
    }
    if (event.type === 'cancelled') {
      if (!pendingCombinedVoiceCommand) pendingVoiceCommands.clear();
      stopSpeech('conversation-cancelled');
      resetActiveReply();
      if (event.assistantMessage) {
        messages.push(event.assistantMessage);
        renderHistory();
      }
      setReplyStatus('已停止生成');
      activeRequestId = undefined;
      idleCompanion.reset();
      setGenerating(false);
      if (submitPendingCombinedVoiceCommand()) {
        input.focus();
        return;
      }
      void finishPerformance();
      input.focus();
      return;
    }
    pendingVoiceCommands.clear();
    pendingCombinedVoiceCommand = undefined;
    stopSpeech('conversation-error');
    renderConversationTimeline();
    setReplyStatus(errorMessages[event.error.code] ?? event.error.message);
    activeRequestId = undefined;
    idleCompanion.reset();
    setGenerating(false);
    void finishPerformance();
    if (event.error.code === 'configuration' || event.error.code === 'authentication') {
      historyPanel.hidden = true;
      settingsPanel.hidden = false;
      setPanelExpanded(true);
    }
  };

  const disposeConversationListener = api?.onConversationEvent(handleConversationEvent);

  const clearInputOverlayTimers = (): void => {
    for (const timer of inputOverlayReleaseTimers.values()) window.clearTimeout(timer);
    inputOverlayReleaseTimers.clear();
    if (mouseDirectionTimer !== undefined) window.clearTimeout(mouseDirectionTimer);
    mouseDirectionTimer = undefined;
  };

  const displayInputOverlay = (settings: DesktopIntegrationSettings, active: boolean): void => {
    clearInputOverlayTimers();
    inputOverlayKeyElements.clear();
    inputOverlayKeys.replaceChildren();
    const renderedKeys = new Map<InputOverlayKey, HTMLElement>();
    for (const key of settings.inputOverlayKeys) {
      const element = el('kbd', { className: 'input-overlay__key', textContent: key });
      element.dataset.key = key;
      inputOverlayKeyElements.set(key, element);
      renderedKeys.set(key, element);
    }
    if (['W', 'A', 'S', 'D'].every((key) => renderedKeys.has(key as InputOverlayKey))) {
      const movementKeys = el('div', { className: 'input-overlay__movement' });
      for (const key of ['W', 'A', 'S', 'D'] as const) {
        const element = renderedKeys.get(key);
        if (!element) continue;
        element.dataset.movement = key.toLowerCase();
        movementKeys.append(element);
        renderedKeys.delete(key);
      }
      inputOverlayKeys.append(movementKeys);
    }
    if (renderedKeys.size > 0) {
      const additionalKeys = el('div', { className: 'input-overlay__additional-keys' });
      additionalKeys.append(...renderedKeys.values());
      inputOverlayKeys.append(additionalKeys);
    }
    for (const element of mouseButtons.values()) element.classList.remove('is-active');
    mouseDirection.textContent = '•';
    inputOverlayMouse.hidden = !settings.inputOverlayMouseEnabled;
    inputOverlay.hidden = !settings.inputOverlayEnabled || !active;
  };

  const scheduleInputRelease = (id: string, release: () => void): void => {
    const previous = inputOverlayReleaseTimers.get(id);
    if (previous !== undefined) window.clearTimeout(previous);
    inputOverlayReleaseTimers.set(
      id,
      window.setTimeout(() => {
        release();
        inputOverlayReleaseTimers.delete(id);
      }, 1_500),
    );
  };

  const handleDesktopInputActivity = (event: DesktopInputActivityEvent): void => {
    const speechSettings = currentSpeechStatus?.settings;
    const isPushToTalkEvent =
      event.type === 'key' &&
      currentSpeechStatus?.input.available === true &&
      speechSettings?.inputMode === 'manual' &&
      event.key === speechSettings.pushToTalkKey;
    if (isPushToTalkEvent && event.type === 'key') {
      if (event.pressed && !pushToTalkPressed) {
        pushToTalkPressed = true;
        void startMicrophoneRecording(true);
      } else if (!event.pressed && pushToTalkPressed) {
        pushToTalkPressed = false;
        stopMicrophoneRecording();
      }
      return;
    }
    if (inputOverlay.hidden) return;
    if (event.type === 'key') {
      const element = inputOverlayKeyElements.get(event.key);
      if (!element) return;
      const timerId = `key:${event.key}`;
      element.classList.toggle('is-active', event.pressed);
      if (event.pressed) {
        element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        scheduleInputRelease(timerId, () => element.classList.remove('is-active'));
      } else {
        const timer = inputOverlayReleaseTimers.get(timerId);
        if (timer !== undefined) window.clearTimeout(timer);
        inputOverlayReleaseTimers.delete(timerId);
      }
      return;
    }
    if (event.type === 'mouse-button') {
      const element = mouseButtons.get(event.button);
      if (!element) return;
      const timerId = `mouse:${event.button}`;
      element.classList.toggle('is-active', event.pressed);
      if (event.pressed) {
        scheduleInputRelease(timerId, () => element.classList.remove('is-active'));
      } else {
        const timer = inputOverlayReleaseTimers.get(timerId);
        if (timer !== undefined) window.clearTimeout(timer);
        inputOverlayReleaseTimers.delete(timerId);
      }
      return;
    }
    const glyphs = {
      up: '↑',
      'up-right': '↗',
      right: '→',
      'down-right': '↘',
      down: '↓',
      'down-left': '↙',
      left: '←',
      'up-left': '↖',
    } as const;
    mouseDirection.textContent = glyphs[event.direction];
    mouseDirection.classList.add('is-active');
    if (mouseDirectionTimer !== undefined) window.clearTimeout(mouseDirectionTimer);
    mouseDirectionTimer = window.setTimeout(() => {
      mouseDirection.textContent = '•';
      mouseDirection.classList.remove('is-active');
      mouseDirectionTimer = undefined;
    }, 160);
  };

  const disposeDesktopInputActivity = api?.onDesktopInputActivity(handleDesktopInputActivity);

  const displayMediaOverlay = (desktopStatus: DesktopIntegrationStatus): void => {
    mediaOverlay.hidden = !desktopStatus.settings.mediaControlEnabled;
    const trackText = [desktopStatus.media.title, desktopStatus.media.artist]
      .filter(Boolean)
      .join(' — ');
    mediaTrack.textContent = trackText;
    mediaTrack.title = trackText;
    mediaTrack.hidden = !trackText;
    playPauseMediaOverlayButton.textContent = desktopStatus.media.playing ? '⏸' : '▶';
    for (const button of [
      previousMediaOverlayButton,
      playPauseMediaOverlayButton,
      nextMediaOverlayButton,
    ]) {
      button.disabled = !mediaControlsAvailable || mediaCommandInFlight;
    }
  };

  const displayDesktopIntegrationStatus = (desktopStatus: DesktopIntegrationStatus): void => {
    globalShortcutInput.checked = desktopStatus.settings.globalShortcutsEnabled;
    mediaControlInput.checked = desktopStatus.settings.mediaControlEnabled;
    inputOverlayEnabledInput.checked = desktopStatus.settings.inputOverlayEnabled;
    inputOverlayMouseInput.checked = desktopStatus.settings.inputOverlayMouseEnabled;
    if (document.activeElement !== inputOverlayKeysInput) {
      inputOverlayKeysInput.value = desktopStatus.settings.inputOverlayKeys.join(', ');
    }
    if (document.activeElement !== visibilityShortcutInput) {
      visibilityShortcutInput.value = desktopStatus.settings.visibilityShortcut;
    }
    if (document.activeElement !== stopGenerationShortcutInput) {
      stopGenerationShortcutInput.value = desktopStatus.settings.stopGenerationShortcut;
    }
    mediaControlsAvailable =
      desktopStatus.settings.mediaControlEnabled && desktopStatus.media.supported;
    previousMediaButton.disabled = !mediaControlsAvailable || mediaCommandInFlight;
    playPauseMediaButton.disabled = !mediaControlsAvailable || mediaCommandInFlight;
    nextMediaButton.disabled = !mediaControlsAvailable || mediaCommandInFlight;
    for (const definition of desktopWidgetRegistry.list()) {
      const card = widgetCards.get(definition.id);
      if (!card) continue;
      const state = definition.getCardState(desktopStatus);
      card.toggleButton.textContent = state.label;
      card.toggleButton.title = state.enabled
        ? `关闭${definition.title}`
        : `按默认设置启用${definition.title}`;
      card.toggleButton.classList.toggle('is-active', state.active);
    }
    widgetOrder = [...desktopStatus.settings.widgetOrder];
    const mediaWidgetVisible = desktopStatus.settings.mediaControlEnabled;
    const inputWidgetVisible =
      desktopStatus.settings.inputOverlayEnabled && desktopStatus.inputOverlayActive;
    const overlays: Record<DesktopWidgetId, HTMLElement> = {
      input: inputOverlay,
      media: mediaOverlay,
    };
    for (const widget of widgetOrder) {
      desktopOverlayStack.append(overlays[widget]);
    }
    displayInputOverlay(desktopStatus.settings, desktopStatus.inputOverlayActive);
    displayMediaOverlay(desktopStatus);
    desktopWidgetsActive = mediaWidgetVisible || inputWidgetVisible;
    root.classList.toggle('desktop-widgets-active', desktopWidgetsActive);
    syncDesktopWidgetReserve();
    const shortcutMessage = desktopStatus.settings.globalShortcutsEnabled
      ? desktopStatus.shortcutRegistered
        ? desktopStatus.stopGenerationShortcutRegistered
          ? `${desktopStatus.settings.visibilityShortcut} 切换窗口；${desktopStatus.settings.stopGenerationShortcut} 停止生成`
          : '窗口快捷键已启用；停止生成快捷键注册失败，可能已被占用'
        : '窗口快捷键注册失败，可能已被其他程序占用'
      : '窗口隐藏快捷键未启用';
    const mediaMessage = desktopStatus.settings.mediaControlEnabled
      ? desktopStatus.media.supported
        ? desktopStatus.media.title
          ? `${desktopStatus.media.playing === true ? '正在播放' : desktopStatus.media.playing === false ? '已暂停' : '当前媒体'}：${desktopStatus.media.title}${desktopStatus.media.artist ? ` — ${desktopStatus.media.artist}` : ''}`
          : '系统媒体控制已启用；当前未检测到可显示的曲目信息'
        : '当前系统不支持媒体控制'
      : '系统媒体控制未启用';
    const inputMessage = desktopStatus.settings.inputOverlayEnabled
      ? desktopStatus.inputOverlayActive
        ? `输入显示已开启（${desktopStatus.settings.inputOverlayKeys.join('、')}）`
        : '输入显示启动失败；当前不会监听键盘或鼠标'
      : '输入显示未启用';
    desktopIntegrationStatus.textContent = `${shortcutMessage}。`;
    widgetsStatus.textContent = `${mediaMessage}；${inputMessage}。`;
  };

  const refreshMediaStatus = async (): Promise<void> => {
    if (!api || mediaStatusRefreshInFlight) return;
    mediaStatusRefreshInFlight = true;
    try {
      displayDesktopIntegrationStatus(await api.getDesktopIntegrationStatus());
    } catch {
      // The media widget is optional; keep the last safe state when refresh fails.
    } finally {
      mediaStatusRefreshInFlight = false;
    }
  };

  const mediaStatusRefreshTimer = window.setInterval(() => void refreshMediaStatus(), 5_000);

  const displaySpeechStatus = (status: SpeechStatus): void => {
    currentSpeechStatus = status;
    speechEnabledInput.checked = status.settings.enabled;
    speechProviderSelect.value = status.settings.providerId;
    speechBaseUrlInput.value = status.settings.baseUrl;
    speechModelInput.value = status.settings.modelId;
    speechVoiceInput.value = status.settings.voiceId;
    displaySpeechLanguage(status.settings.language);
    speechFormatSelect.value = status.settings.responseFormat;
    speechSpeedInput.value = String(status.settings.speed);
    speechVolumeInput.value = String(status.settings.volume);
    speechVolumeOutput.textContent = `${Math.round(status.settings.volume * 100)}%`;
    speechPlayer.setVolume(status.settings.volume);
    speechInputEnabledInput.checked = status.settings.inputEnabled;
    renderToolbarSpeechInputMode(status.settings.inputMode);
    speechWakeWordSourceSelect.value = status.settings.wakeWordSource;
    speechCustomWakeWordInput.value = status.settings.customWakeWord;
    updatePreciseWakeWordFields();
    speechPushToTalkKeySelect.value = status.settings.pushToTalkKey;
    const speechInputMode = speechInputModeInputs.get(status.settings.inputMode);
    if (speechInputMode) speechInputMode.checked = true;
    speechTranscriptionBaseUrlInput.value = status.settings.transcriptionBaseUrl;
    speechTranscriptionModelInput.value = status.settings.transcriptionModelId;
    speechTranscriptionLanguageInput.value = status.settings.transcriptionLanguage;
    updateSpeechProviderFields();
    speechApiKeyInput.placeholder = status.apiKeySaved
      ? '已安全保存；留空保留'
      : status.settings.providerId === 'fish-audio'
        ? 'Fish Audio API Key（必填）'
        : status.settings.providerId === 'genie-tts'
          ? 'Genie-TTS 本机服务不使用密钥'
          : '本机免密接口可留空';
    deleteSpeechSecretButton.hidden = !status.apiKeySaved;
    speechStatus.textContent = `${status.output.detail} ${status.input.detail}`;
    microphoneButton.hidden = !status.input.available;
    resetMicrophoneButton();
    syncMicrophoneInputMode(status);
    if (!status.output.available) stopSpeech('speech-disabled');
  };

  const inspectVTubeStudioWhenSelected = (): void => {
    if (readCharacterDisplayMode() === 'vtube-studio') {
      void inspectSelectedVTubeStudio();
    }
  };
  vtubePanel.listenForSelection(settingsTabButtons.get('display'), inspectVTubeStudioWhenSelected);
  vtubePanel.listenForSelection(
    displayTabButtons.get('vtube-studio'),
    inspectVTubeStudioWhenSelected,
  );

  const loadSettings = async (): Promise<void> => {
    if (!api) {
      settingsStatus.textContent = '桌面 API 不可用。';
      return;
    }
    const [
      providerConfiguration,
      conversationConfiguration,
      storedProfile,
      windowScale,
      desktopStatus,
      loadedSpeechStatus,
      loadedLocalSpeechAssetStatus,
      loadedViewerExStatus,
      loadedVTubeStudioStatus,
      loadedCharacterDisplayMode,
      loadedDesktopLayout,
    ] = await Promise.all([
      api.getProviderConfiguration(),
      api.getConversationConfiguration(),
      api.getCharacterProfile(),
      api.getWindowScale(),
      api.getDesktopIntegrationStatus(),
      api.getSpeechStatus(),
      api.getLocalSpeechAssetStatus(),
      api.getViewerExStatus(),
      api.getVTubeStudioStatus(),
      api.getCharacterDisplayMode(),
      api.getDesktopLayoutSettings(),
    ]);
    profile = storedProfile;
    providerSelect.value = conversationConfiguration.selection?.providerId ?? 'anthropic';
    updateProviderVisibility();
    modelInput.value = conversationConfiguration.selection?.modelId ?? '';
    baseUrlInput.value = providerConfiguration.openAICompatibleBaseUrl;
    allowRemoteComplexTasksInput.checked = providerConfiguration.allowRemoteComplexTasks;
    remoteProviderSelect.value = providerConfiguration.remoteSelection?.providerId ?? 'anthropic';
    remoteModelInput.value = providerConfiguration.remoteSelection?.modelId ?? '';
    updateCollaborationVisibility();
    characterNameInput.value = storedProfile.name;
    characterSearchNameInput.value = storedProfile.name;
    fillLoreEditor(storedProfile.lore);
    await loadGlossaryStatus(storedProfile.lore?.sourceWork ?? '');
    userNameInput.value = storedProfile.userDisplayName;
    bioInput.value =
      storedProfile.bio !== DEFAULT_CHARACTER_PROFILE.bio
        ? storedProfile.bio
        : storedProfile.lore?.identity || storedProfile.bio;
    personaInput.value = storedProfile.personaPrompt;
    characterSearchCandidates.replaceChildren();
    characterSearchStatus.textContent = storedProfile.lore?.sources.length
      ? '正在使用已确认的联网角色资料；可以重新查找或手动修改。'
      : '可以联网查找公开资料；结果需要你确认后才会保存。';
    displayScale(windowScale);
    displayDesktopIntegrationStatus(desktopStatus);
    displaySpeechStatus(loadedSpeechStatus);
    displayLocalSpeechAssetStatus(loadedLocalSpeechAssetStatus);
    displayViewerExStatus(loadedViewerExStatus);
    displayVTubeStudioStatus(loadedVTubeStudioStatus);
    displayCharacterDisplayMode(loadedCharacterDisplayMode);
    displayDesktopLayoutSettings(loadedDesktopLayout);
    if (loadedCharacterDisplayMode === 'vtube-studio' && loadedVTubeStudioStatus.authorized) {
      await inspectSelectedVTubeStudio();
    }
    updateIdentity();
    await loadCharacterLibrary();
    await updateSecretStatus();
    resizeLoreTextareas();
  };

  const saveSettings = async (
    statusTarget = settingsStatus,
    refreshCharacter = true,
  ): Promise<boolean> => {
    if (!api || !profile) {
      return false;
    }
    const providerId = providerSelect.value as ConfigurableProviderId;
    const modelId = modelInput.value.trim();
    const updatedName = characterNameInput.value.trim();
    const updatedProfile: CharacterProfile = {
      ...profile,
      name: updatedName,
      userDisplayName: userNameInput.value.trim(),
      bio: bioInput.value.trim(),
      personaPrompt: personaInput.value.trim(),
      lore: readLoreEditor(updatedName),
    };
    const characterProfileChanged = JSON.stringify(updatedProfile) !== JSON.stringify(profile);
    statusTarget.textContent = '正在保存…';
    const operations = await Promise.all([
      api.setProviderConfiguration({
        openAICompatibleBaseUrl: baseUrlInput.value.trim(),
        allowRemoteComplexTasks: allowRemoteComplexTasksInput.checked,
        ...(allowRemoteComplexTasksInput.checked
          ? {
              remoteSelection: {
                providerId: remoteProviderSelect.value,
                modelId: remoteModelInput.value.trim(),
              },
            }
          : {}),
      }),
      modelId
        ? api.setConversationConfiguration({ selection: { providerId, modelId } })
        : Promise.resolve({ ok: true } as const),
      api.setCharacterProfile(updatedProfile),
      apiKeyInput.value.trim()
        ? api.setProviderSecret({ providerId, apiKey: apiKeyInput.value })
        : Promise.resolve({ ok: true } as const),
      allowRemoteComplexTasksInput.checked &&
      remoteProviderSelect.value !== providerId &&
      remoteApiKeyInput.value.trim()
        ? api.setProviderSecret({
            providerId: remoteProviderSelect.value as ConfigurableProviderId,
            apiKey: remoteApiKeyInput.value,
          })
        : Promise.resolve({ ok: true } as const),
    ]);
    const failed = operations.find((result) => !result.ok);
    if (failed && !failed.ok) {
      statusTarget.textContent = failed.error.message;
      return false;
    }
    const speechSettings: SpeechSettings = {
      enabled: speechEnabledInput.checked,
      providerId: speechProviderSelect.value as SpeechSettings['providerId'],
      baseUrl: speechBaseUrlInput.value.trim(),
      modelId: speechModelInput.value.trim(),
      voiceId: speechVoiceInput.value.trim(),
      language: readSpeechLanguage(),
      responseFormat: speechFormatSelect.value as SpeechSettings['responseFormat'],
      speed: Number(speechSpeedInput.value),
      volume: Number(speechVolumeInput.value),
      inputEnabled: speechInputEnabledInput.checked,
      inputMode: readSpeechInputMode(),
      wakeWordSource: speechWakeWordSourceSelect.value as SpeechWakeWordSource,
      customWakeWord: speechCustomWakeWordInput.value.trim(),
      pushToTalkKey: speechPushToTalkKeySelect.value as SpeechSettings['pushToTalkKey'],
      transcriptionBaseUrl: speechTranscriptionBaseUrlInput.value.trim(),
      transcriptionModelId: speechTranscriptionModelInput.value.trim(),
      transcriptionLanguage: speechTranscriptionLanguageInput.value.trim(),
    };
    const speechSettingsResult = await api.setSpeechSettings({ settings: speechSettings });
    if (!speechSettingsResult.ok) {
      statusTarget.textContent = speechSettingsResult.message;
      return false;
    }
    if (speechApiKeyInput.value.trim()) {
      const secretResult = await api.setSpeechSecret({ apiKey: speechApiKeyInput.value });
      if (!secretResult.ok) {
        statusTarget.textContent = secretResult.message;
        return false;
      }
    }
    let viewerExSettings: ViewerExSettings;
    try {
      viewerExSettings = readViewerExSettings();
    } catch (error) {
      statusTarget.textContent = error instanceof Error ? error.message : 'ViewerEX 映射格式无效。';
      return false;
    }
    const viewerExSettingsResult = await api.setViewerExSettings({ settings: viewerExSettings });
    if (!viewerExSettingsResult.ok) {
      statusTarget.textContent = viewerExSettingsResult.message ?? 'ViewerEX 设置无法保存。';
      return false;
    }
    const vTubeStudioSettingsResult = await api.setVTubeStudioSettings({
      settings: readVTubeStudioSettings(),
    });
    if (!vTubeStudioSettingsResult.ok) {
      statusTarget.textContent = vTubeStudioSettingsResult.message ?? 'VTube Studio 设置无法保存。';
      return false;
    }
    const displayModeResult = await persistCharacterDisplayMode(readCharacterDisplayMode());
    if (!displayModeResult.ok) {
      statusTarget.textContent = displayModeResult.message ?? '角色显示方式无法保存。';
      return false;
    }
    try {
      displayDesktopLayoutSettings(
        await api.setDesktopLayoutSettings({ settings: readDesktopLayoutSettings() }),
      );
    } catch {
      statusTarget.textContent = '界面位置无法保存，请重试。';
      return false;
    }
    if (displayModeResult.mode === 'vtube-studio') {
      await inspectSelectedVTubeStudio();
    }
    apiKeyInput.value = '';
    remoteApiKeyInput.value = '';
    speechApiKeyInput.value = '';
    statusTarget.textContent = modelId ? '已保存。' : '其他设置已保存；AI 对话模型尚未配置。';
    if (refreshCharacter || characterProfileChanged) {
      await refreshActiveCharacter();
    } else {
      await loadSettings();
      messages = await api.getConversationHistory();
      renderHistory();
    }
    return true;
  };

  const saveDesktopIntegrationSettings = async (): Promise<void> => {
    if (!api) return;
    const inputKeys = tokenizeInputOverlayKeyDraft(inputOverlayKeysInput.value);
    const widgetEnabled: Record<DesktopWidgetId, boolean> = {
      input: inputOverlayEnabledInput.checked,
      media: mediaControlInput.checked,
    };
    widgetOrder = widgetOrder.filter((widget) => widgetEnabled[widget]);
    for (const widget of ['input', 'media'] as const) {
      if (widgetEnabled[widget] && !widgetOrder.includes(widget)) widgetOrder.push(widget);
    }
    const requestedSettings = {
      globalShortcutsEnabled: globalShortcutInput.checked,
      mediaControlEnabled: mediaControlInput.checked,
      inputOverlayEnabled: inputOverlayEnabledInput.checked,
      inputOverlayMouseEnabled: inputOverlayMouseInput.checked,
      inputOverlayKeys: inputKeys,
      widgetOrder,
      visibilityShortcut: visibilityShortcutInput.value.trim(),
      stopGenerationShortcut: stopGenerationShortcutInput.value.trim(),
    };
    globalShortcutInput.disabled = true;
    mediaControlInput.disabled = true;
    inputOverlayEnabledInput.disabled = true;
    inputOverlayMouseInput.disabled = true;
    inputOverlayKeysInput.disabled = true;
    for (const card of widgetCards.values()) card.toggleButton.disabled = true;
    visibilityShortcutInput.disabled = true;
    stopGenerationShortcutInput.disabled = true;
    desktopIntegrationStatus.textContent = '正在应用桌面快捷操作设置…';
    widgetsStatus.textContent = '正在应用小组件设置…';
    try {
      await api.setDesktopIntegrationSettings({ settings: requestedSettings });
      displayDesktopIntegrationStatus(await api.getDesktopIntegrationStatus());
    } catch {
      const failureMessage = '桌面与小组件设置保存失败，请重试。';
      try {
        displayDesktopIntegrationStatus(await api.getDesktopIntegrationStatus());
        desktopIntegrationStatus.textContent = `${failureMessage}${desktopIntegrationStatus.textContent}`;
        widgetsStatus.textContent = `${failureMessage}${widgetsStatus.textContent}`;
      } catch {
        desktopIntegrationStatus.textContent = failureMessage;
        widgetsStatus.textContent = failureMessage;
      }
    } finally {
      globalShortcutInput.disabled = false;
      mediaControlInput.disabled = false;
      inputOverlayEnabledInput.disabled = false;
      inputOverlayMouseInput.disabled = false;
      inputOverlayKeysInput.disabled = false;
      for (const card of widgetCards.values()) card.toggleButton.disabled = false;
      visibilityShortcutInput.disabled = false;
      stopGenerationShortcutInput.disabled = false;
    }
  };

  const toggleWidget = async (widget: DesktopWidgetId): Promise<void> => {
    if (!api) return;
    const enabled =
      widget === 'input' ? inputOverlayEnabledInput.checked : mediaControlInput.checked;
    for (const card of widgetCards.values()) card.toggleButton.disabled = true;
    widgetsStatus.textContent = enabled ? '正在关闭小组件…' : '正在启用小组件…';
    try {
      await api.setDesktopWidgetEnabled({ widgetId: widget, enabled: !enabled });
      displayDesktopIntegrationStatus(await api.getDesktopIntegrationStatus());
    } catch {
      widgetsStatus.textContent = '小组件状态切换失败，请重试。';
    } finally {
      for (const card of widgetCards.values()) card.toggleButton.disabled = false;
    }
  };
  for (const definition of desktopWidgetRegistry.list()) {
    widgetCards
      .get(definition.id)
      ?.toggleButton.addEventListener('click', () => void toggleWidget(definition.id));
  }

  const mediaControlButtons = [
    previousMediaButton,
    playPauseMediaButton,
    nextMediaButton,
    previousMediaOverlayButton,
    playPauseMediaOverlayButton,
    nextMediaOverlayButton,
  ];
  for (const [button, command] of [
    [previousMediaButton, 'previous'],
    [playPauseMediaButton, 'play-pause'],
    [nextMediaButton, 'next'],
    [previousMediaOverlayButton, 'previous'],
    [playPauseMediaOverlayButton, 'play-pause'],
    [nextMediaOverlayButton, 'next'],
  ] as const) {
    button.addEventListener('click', () => {
      void (async () => {
        if (!api || mediaCommandInFlight) return;
        mediaCommandInFlight = true;
        for (const control of mediaControlButtons) control.disabled = true;
        widgetsStatus.textContent = '正在控制当前媒体会话…';
        try {
          const handled = await api.sendMediaCommand({ command });
          widgetsStatus.textContent = handled
            ? '媒体指令已发送到当前活动会话。'
            : '当前没有可控制的活动媒体会话，未执行操作。';
        } catch {
          widgetsStatus.textContent = '媒体控制失败，桌宠和聊天仍可继续。';
        } finally {
          mediaCommandInFlight = false;
          for (const control of mediaControlButtons) {
            control.disabled = !mediaControlsAvailable;
          }
          await refreshMediaStatus();
        }
      })();
    });
  }
  globalShortcutInput.addEventListener('change', () => {
    void saveDesktopIntegrationSettings();
  });
  mediaControlInput.addEventListener('change', () => {
    void saveDesktopIntegrationSettings();
  });
  inputOverlayEnabledInput.addEventListener('change', () => {
    void saveDesktopIntegrationSettings();
  });
  inputOverlayMouseInput.addEventListener('change', () => {
    void saveDesktopIntegrationSettings();
  });
  inputOverlayKeysInput.addEventListener('change', () => {
    void saveDesktopIntegrationSettings();
  });
  visibilityShortcutInput.addEventListener('change', () => {
    void saveDesktopIntegrationSettings();
  });
  stopGenerationShortcutInput.addEventListener('change', () => {
    void saveDesktopIntegrationSettings();
  });
  speechVolumeInput.addEventListener('input', () => {
    const volume = Number(speechVolumeInput.value);
    speechVolumeOutput.textContent = `${Math.round(volume * 100)}%`;
    speechPlayer.setVolume(volume);
  });
  speechPanel.onWakeWordChanged(updatePreciseWakeWordFields);
  speechVolumeInput.addEventListener('change', () => {
    void (async () => {
      if (!api || !currentSpeechStatus) return;
      const volume = Number(speechVolumeInput.value);
      const result = await api.setSpeechSettings({
        settings: { ...currentSpeechStatus.settings, volume },
      });
      if (!result.ok) {
        soundHint.textContent = result.message;
        return;
      }
      displaySpeechStatus(await api.getSpeechStatus());
      soundHint.textContent = '音量已保存；只影响角色 TTS，不改变系统总音量。';
    })();
  });

  for (const [inputMode, button] of speechInputModeToolbarButtons) {
    button.addEventListener('click', () => {
      void (async () => {
        if (!api || !currentSpeechStatus) return;
        const previousMode = currentSpeechStatus.settings.inputMode;
        if (inputMode === previousMode && currentSpeechStatus.settings.inputEnabled) return;
        for (const modeButton of speechInputModeToolbarButtons.values()) {
          modeButton.disabled = true;
        }
        const result = await api.setSpeechSettings({
          settings: {
            ...currentSpeechStatus.settings,
            inputEnabled: true,
            inputMode,
          },
        });
        if (!result.ok) {
          renderToolbarSpeechInputMode(previousMode);
          speechStatus.textContent = result.message;
          for (const modeButton of speechInputModeToolbarButtons.values()) {
            modeButton.disabled = false;
          }
          return;
        }
        const status = await api.getSpeechStatus();
        displaySpeechStatus(status);
        for (const modeButton of speechInputModeToolbarButtons.values()) {
          modeButton.disabled = false;
        }
        speechStatus.textContent =
          inputMode === 'full'
            ? '完全模式已开启：自动发送；2 秒内继续说会合并并重新思考。'
            : inputMode === 'half'
              ? `精准模式已开启：必须在同一句中说“${currentPreciseWakeWord()} + 内容”才会自动发送。`
              : `已切换为手动模式：点击“说话”或按住 ${status.settings.pushToTalkKey} 录音，只会填入输入框。`;
      })();
    });
  }

  soundButton.addEventListener('click', () => {
    setPanelExpanded(true, 'chat');
    const willOpen = soundPanel.hidden;
    closeDrawers();
    soundPanel.hidden = !willOpen;
  });
  settingsTabButtons.get('memory')?.addEventListener('click', () => {
    memoryStatus.textContent = '正在读取本地记忆…';
    void loadMemories()
      .then(() => {
        memoryStatus.textContent =
          memoryRecords.length + ' 条已确认，' + memoryCandidates.length + ' 条待确认。';
      })
      .catch(() => {
        memoryStatus.textContent = '无法读取本地记忆。';
      });
  });
  historyButton.addEventListener('click', () => {
    setPanelExpanded(true, 'chat');
    const willOpen = historyPanel.hidden;
    closeDrawers();
    historyPanel.hidden = !willOpen;
    if (willOpen) {
      renderHistory();
    }
  });
  debugButton.addEventListener('click', () => {
    setPanelExpanded(true, 'chat');
    const willOpen = debugPanel.hidden;
    closeDrawers();
    debugPanel.hidden = !willOpen;
    if (willOpen) renderContextDebug();
  });
  widgetsButton.addEventListener('click', () => {
    closeDrawers();
    settingsPanel.hidden = false;
    showSettingsPage('widgets');
    showWidgetView('catalog');
    setPanelExpanded(true, 'settings');
    if (api) {
      widgetsStatus.textContent = '正在读取小组件状态…';
      void api
        .getDesktopIntegrationStatus()
        .then(displayDesktopIntegrationStatus)
        .catch(() => {
          widgetsStatus.textContent = '无法读取小组件状态，聊天仍可继续。';
        });
    }
  });
  settingsButton.addEventListener('click', () => {
    const willOpen = settingsPanel.hidden;
    closeDrawers();
    settingsPanel.hidden = !willOpen;
    setPanelExpanded(true, willOpen ? 'settings' : 'chat');
    if (willOpen) {
      settingsPanel.scrollTop = 0;
      void loadWindowScale();
      if (loreEditor.open) resizeLoreTextareas();
    }
  });
  closeHistoryButton.addEventListener('click', closeDrawers);
  closeSoundButton.addEventListener('click', closeDrawers);
  closeDebugButton.addEventListener('click', closeDrawers);
  closeSettingsButton.addEventListener('click', closeDrawers);
  diagnosticLogButton.addEventListener('click', () => {
    if (!api) {
      diagnosticLogStatus.textContent = '诊断日志不可用。';
      return;
    }
    diagnosticLogStatus.textContent = '正在打开诊断日志…';
    void api
      .openDiagnosticLog()
      .then((result) => {
        diagnosticLogStatus.textContent =
          ('message' in result ? result.message : undefined) ??
          (result.ok ? '已打开。' : '无法打开。');
      })
      .catch(() => {
        diagnosticLogStatus.textContent = '诊断日志无法打开。';
      });
  });
  assistantModeButton.addEventListener('click', () => {
    assistantModeEnabled = !assistantModeEnabled;
    displayAssistantMode(
      assistantWorkspaceButton.textContent?.startsWith('工作区：')
        ? assistantWorkspaceButton.textContent.slice('工作区：'.length)
        : undefined,
    );
    setReplyStatus(assistantModeEnabled ? '工作模式已开启' : '普通聊天模式');
  });
  assistantWorkspaceButton.addEventListener('click', () => {
    void (async () => {
      if (!api) return;
      assistantWorkspaceButton.disabled = true;
      try {
        const result = await api.selectAssistantWorkspace();
        displayAssistantMode(result.workspaceName);
        if (!result.canceled) {
          assistantModeEnabled = true;
          displayAssistantMode(result.workspaceName);
          setReplyStatus(`工作区已设为 ${result.workspaceName ?? '所选文件夹'}`);
        }
      } finally {
        assistantWorkspaceButton.disabled = false;
      }
    })();
  });
  scaleInput.addEventListener('input', () => windowScaleSync?.preview(Number(scaleInput.value)));
  scaleInput.addEventListener('change', () => {
    void windowScaleSync?.commit(Number(scaleInput.value));
  });
  settingsPanel.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      saveButton.disabled = true;
      showButtonFeedback(saveButton, '保存中…', 'pending');
      try {
        const saved = await saveSettings();
        if (saved) {
          showButtonFeedback(saveButton, '已保存 ✓', 'success', 1_500);
        } else {
          showButtonFeedback(saveButton, '保存失败', 'error', 1_500);
        }
      } catch {
        settingsStatus.textContent = '保存失败，请重试。';
        showButtonFeedback(saveButton, '保存失败', 'error', 1_500);
      } finally {
        saveButton.disabled = false;
      }
    })();
  });
  importLive2DModelButton.addEventListener('click', () => {
    void (async () => {
      if (!api) return;
      importLive2DModelButton.disabled = true;
      live2DImportStatus.textContent = '正在检查并导入模型素材…';
      try {
        const result = await api.importLive2DModel();
        if (!result.ok) {
          live2DImportStatus.textContent = result.message;
          return;
        }
        if (result.canceled) {
          live2DImportStatus.textContent = '已取消导入。';
          return;
        }
        setDisplayModeInputs('live2d');
        const displayResult = await persistCharacterDisplayMode('live2d');
        if (!displayResult.ok) {
          live2DImportStatus.textContent = `“${result.modelName}”已导入，但纯 Live2D 显示未能启用。`;
          return;
        }
        live2DImportStatus.textContent = `已导入“${result.modelName}”（${result.assetCount} 个素材，约 ${Math.ceil(result.importedBytes / 1024)} KiB）。`;
      } finally {
        importLive2DModelButton.disabled = false;
      }
    })();
  });
  exportLive2DModelButton.addEventListener('click', () => {
    void (async () => {
      if (!api) return;
      exportLive2DModelButton.disabled = true;
      live2DImportStatus.textContent = '正在导出当前由 FPNF 导入的模型…';
      try {
        const result = await api.exportActiveLive2DModel();
        live2DImportStatus.textContent = result.ok
          ? result.canceled
            ? '已取消模型导出。'
            : `${result.message} 共 ${result.assetCount} 个素材，约 ${Math.ceil(result.exportedBytes / 1024)} KiB。`
          : result.message;
      } finally {
        exportLive2DModelButton.disabled = false;
      }
    })();
  });
  clearHistoryButton.addEventListener('click', () => {
    void (async () => {
      if (!api || !window.confirm('确定清空当前最近对话吗？此操作无法撤销。')) {
        return;
      }
      const result = await api.clearConversationHistory();
      if (result.ok) {
        messages = [];
        resetActiveReply();
        setReplyStatus('对话已清空');
        renderHistory();
      }
    })();
  });
  function handleComposerStop(): void {
    pendingVoiceCommands.clear();
    pendingCombinedVoiceCommand = undefined;
    lastFullVoiceCommand = undefined;
    stopSpeech('stop-generation');
    if (api && activeRequestId) {
      stopButton.disabled = true;
      void api.cancelConversation({ requestId: activeRequestId }).finally(() => {
        stopButton.disabled = false;
      });
    }
  }
  function handleComposerStopSpeech(): void {
    stopSpeech('user-stop-audio');
    drainPendingVoiceCommand();
  }
  async function handleComposerMicrophone(): Promise<void> {
    if (api) {
      const assetResult = await startSpeechInputAssetOnDemand(
        () => api.getSpeechAssetDownloadStatus(),
        (input) => api.controlSpeechAssetDownload(input),
      ).catch(() => 'unavailable' as const);
      if (assetResult === 'started') {
        speechStatus.textContent = '正在后台准备本地语音识别；完成后即可使用麦克风。';
        await resourceCenterPanel?.refresh();
        return;
      }
    }
    if (currentSpeechStatus?.settings.inputMode !== 'manual') {
      if (continuousMicrophoneListener?.active) {
        await stopContinuousListening('持续监听已暂停；点击“开启监听”可恢复。');
      } else {
        await startContinuousListening();
      }
      return;
    }
    if (microphoneRecorder?.state === 'recording') {
      stopMicrophoneRecording();
      return;
    }
    await startMicrophoneRecording();
  }
  function handleComposerSubmit(message: string): boolean {
    if (!api || !message || activeRequestId) {
      return false;
    }
    closeDrawers();
    const wakeFromDrowsy = companionDrowsy;
    companionDrowsy = false;
    idleCompanion.reset();
    stopMicrophoneRecording();
    stopSpeech('user-started-new-turn');
    activeRequestId = createRequestId('chat');
    openingLineGeneration += 1;
    resetActiveReply();
    renderConversationTimeline();
    setReplyStatus('正在思考…');
    setGenerating(true);
    void getPresentation()?.setState('thinking');
    const requestId = activeRequestId;
    void api
      .startConversation({
        requestId,
        message,
        availableActions: readAvailablePresentationActions(),
        assistantMode: assistantModeEnabled,
        wakeFromDrowsy,
      })
      .then((result) => {
        if (!result.ok && activeRequestId === requestId) {
          handleConversationEvent({ requestId, type: 'error', error: result.error });
        }
      })
      .catch(() => {
        if (activeRequestId === requestId) {
          handleConversationEvent({
            requestId,
            type: 'error',
            error: { code: 'network', message: 'IPC unavailable.', retryable: true },
          });
        }
      });
    return true;
  }

  setPanelExpanded(true, 'chat');

  if (api) {
    try {
      const [loadedMessages, loadedMemories] = await Promise.all([
        api.getConversationHistory(),
        api.listMemories().catch(() => []),
        loadSettings(),
        loadAssistantToolStatus(),
      ]);
      messages = loadedMessages;
      memoryRecords = loadedMemories;
      renderHistory();
      updateIdentity();
      void showOpeningLineIfReady();
      idleCompanion.start();
    } catch {
      activeReply = '无法读取本地对话设置。';
      renderConversationTimeline();
    }
  } else {
    input.disabled = true;
    sendButton.disabled = true;
    input.placeholder = '请在 Electron 桌面应用中使用对话。';
  }

  const handleCharacterLoaded = (): void => {
    updateIdentity();
    void showOpeningLineIfReady();
  };
  window.addEventListener('deskpet:character-loaded', handleCharacterLoaded);

  return () => {
    controllerDisposed = true;
    // Each step is isolated: one panel throwing must not strand the listeners, timers and IPC
    // subscriptions that come after it, which would leak across a window rebuild.
    for (const step of [
      () => composerPanel.dispose(),
      () => memoryPanel.dispose(),
      () => providerPanel.dispose(),
      () => characterPanel.dispose(),
      () => speechPanel.dispose(),
      () => vtubePanel.dispose(),
      () => conversationTimeline.dispose(),
      () => resourceCenterPanel?.dispose(),
      () => windowScaleSync?.dispose(),
      () => feedback.dispose(),
      () => {
        pushToTalkPressed = false;
        if (microphoneRecorder?.state === 'recording') microphoneRecorder.stop();
        releaseMicrophone();
      },
      () => void stopContinuousListening(),
      () => {
        if (api && activeTranscriptionId) {
          void api.cancelSpeech({ requestId: activeTranscriptionId });
          activeTranscriptionId = undefined;
        }
      },
      () => stopSpeech('window-dispose'),
      () => idleCompanion.destroy(),
      () => void speechPlayer.dispose(),
      () => disposeConversationListener?.(),
      () => disposeDesktopInputActivity?.(),
      () => clearInputOverlayTimers(),
      () => window.clearInterval(mediaStatusRefreshTimer),
      () => desktopWidgetResizeObserver.disconnect(),
      () => window.removeEventListener('resize', syncDesktopWidgetReserve),
      () => window.removeEventListener('deskpet:character-loaded', handleCharacterLoaded),
      () => {
        if (panelExpanded) void api?.setChatPanelExpanded({ expanded: false });
      },
      () => shell.remove(),
      () => desktopOverlayStack.remove(),
    ]) {
      try {
        step();
      } catch {
        // A cleanup failure is already terminal for that resource; keep releasing the rest.
      }
    }
  };
};
