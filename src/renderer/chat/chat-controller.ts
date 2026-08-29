import type { CharacterLore } from '../../core/character/character-lore';
import {
  resolveAutomaticGlossarySourceWork,
  type CharacterResearchCandidate,
} from '../../core/character/character-research';
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
import { SUPPORTED_MEDIA_PLAYERS } from '../../core/desktop/integration';
import type {
  MemoryCandidateRecord,
  MemoryRecord,
  MemoryReviewReason,
  MemoryType,
} from '../../core/memory/contracts';
import {
  AUTOMATIC_MEMORY_BATCH_MESSAGES,
  AUTOMATIC_MEMORY_MAX_CANDIDATES,
  AUTOMATIC_MEMORY_MIN_CONFIDENCE,
  AUTOMATIC_MEMORY_MIN_IMPORTANCE,
} from '../../core/memory/memory-policy';
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
import { MAX_WINDOW_SCALE, MIN_WINDOW_SCALE } from '../../shared/window-ipc';
import type { LoadedCharacter } from '../live2d/character-runtime';
import { WindowScaleSync } from '../settings/window-scale-sync';
import { desktopWidgetRegistry, type DesktopWidgetDefinition } from '../widgets/widget-registry';

interface ChatControllerOptions {
  root: HTMLElement;
  getCharacter(): LoadedCharacter | undefined;
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

const createButton = (label: string, className = ''): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
};

const createField = (
  labelText: string,
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): HTMLLabelElement => {
  const label = document.createElement('label');
  label.className = 'settings-field';
  const text = document.createElement('span');
  text.textContent = labelText;
  label.append(text, input);
  return label;
};

const enableAutoGrowingTextarea = (textarea: HTMLTextAreaElement): (() => void) => {
  textarea.classList.add('settings-textarea--auto');
  const resize = (): void => {
    if (!textarea.isConnected || textarea.offsetParent === null) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  textarea.addEventListener('input', resize);
  return resize;
};

const formatLocalDateTime = (timestamp?: number): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const readFutureExpiration = (
  input: HTMLInputElement,
): { ok: true; expiresAt?: number } | { ok: false } => {
  if (!input.value) return { ok: true };
  const expiresAt = new Date(input.value).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
    ? { ok: true, expiresAt }
    : { ok: false };
};

const createRequestId = (prefix: string): string =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '_')}`;

export const initializeChat = async ({
  root,
  getCharacter,
}: ChatControllerOptions): Promise<() => void> => {
  const api = window.deskpet;
  const shell = document.createElement('section');
  shell.className = 'chat-shell';
  shell.setAttribute('aria-label', '文字对话');

  const desktopOverlayStack = document.createElement('section');
  desktopOverlayStack.className = 'desktop-overlay-stack';
  desktopOverlayStack.setAttribute('aria-label', '桌面小组件显示');

  const mediaOverlay = document.createElement('section');
  mediaOverlay.className = 'media-overlay';
  mediaOverlay.hidden = true;
  mediaOverlay.setAttribute('aria-label', '当前媒体');
  const mediaOverlayControls = document.createElement('div');
  mediaOverlayControls.className = 'media-overlay__controls';
  const previousMediaOverlayButton = createButton('◀', 'media-overlay__control');
  previousMediaOverlayButton.setAttribute('aria-label', '上一首');
  const playPauseMediaOverlayButton = createButton('⏸', 'media-overlay__control');
  playPauseMediaOverlayButton.setAttribute('aria-label', '播放或暂停');
  const nextMediaOverlayButton = createButton('▶', 'media-overlay__control');
  nextMediaOverlayButton.setAttribute('aria-label', '下一首');
  const mediaTrack = document.createElement('span');
  mediaTrack.className = 'media-overlay__track';
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
  const inputOverlayLabel = document.createElement('small');
  inputOverlayLabel.textContent = 'INPUT';
  const inputOverlayKeys = document.createElement('div');
  inputOverlayKeys.className = 'input-overlay__keys';
  const inputOverlayKeyElements = new Map<InputOverlayKey, HTMLElement>();
  const inputOverlayReleaseTimers = new Map<string, number>();
  let mouseDirectionTimer: number | undefined;
  const inputOverlayMouse = document.createElement('div');
  inputOverlayMouse.className = 'input-overlay__mouse';
  const mouseDirection = document.createElement('span');
  mouseDirection.className = 'input-overlay__direction';
  mouseDirection.textContent = '•';
  const mouseButtons = new Map<MouseInputButton, HTMLElement>();
  for (const [button, label] of [
    ['left', 'L'],
    ['middle', 'M'],
    ['right', 'R'],
  ] as const) {
    const element = document.createElement('span');
    element.className = 'input-overlay__mouse-button';
    element.textContent = label;
    element.dataset.button = button;
    mouseButtons.set(button, element);
    inputOverlayMouse.append(element);
  }
  inputOverlayMouse.append(mouseDirection);
  inputOverlay.append(inputOverlayLabel, inputOverlayKeys, inputOverlayMouse);
  desktopOverlayStack.append(mediaOverlay, inputOverlay);

  const launcherButton = createButton('>>>', 'chat-launcher');
  launcherButton.setAttribute('aria-label', '打开对话面板');
  launcherButton.title = '向右拉开对话面板';

  const panel = document.createElement('section');
  panel.className = 'chat-panel';

  const panelHeader = document.createElement('header');
  panelHeader.className = 'chat-panel__header';
  const identity = document.createElement('div');
  identity.className = 'chat-identity';
  const replyAuthor = document.createElement('strong');
  replyAuthor.textContent = '桌宠';
  const replyStatus = document.createElement('small');
  replyStatus.setAttribute('role', 'status');
  replyStatus.setAttribute('aria-live', 'polite');
  replyStatus.textContent = '随时可以开始聊天';
  identity.append(replyAuthor, replyStatus);
  const collapseButton = createButton('<<<', 'text-button chat-collapse');
  collapseButton.setAttribute('aria-label', '收起对话面板');
  collapseButton.title = '收起对话面板';
  panelHeader.append(identity, collapseButton);

  const toolbar = document.createElement('div');
  toolbar.className = 'chat-toolbar';
  const recordsMenu = document.createElement('details');
  recordsMenu.className = 'chat-tools-menu';
  const recordsMenuButton = document.createElement('summary');
  recordsMenuButton.className = 'chat-toolbar__button';
  recordsMenuButton.textContent = '资料';
  recordsMenuButton.setAttribute('aria-label', '打开历史、记忆和上下文');
  const recordsMenuItems = document.createElement('div');
  recordsMenuItems.className = 'chat-tools-menu__items';
  const historyButton = createButton('历史', 'chat-toolbar__button');
  const memoryButton = createButton('记忆', 'chat-toolbar__button');
  const debugButton = createButton('上下文', 'chat-toolbar__button');
  const widgetsButton = createButton('小组件', 'chat-toolbar__button');
  const settingsButton = createButton('设置', 'chat-toolbar__button');
  recordsMenuItems.append(historyButton, memoryButton, debugButton);
  recordsMenu.append(recordsMenuButton, recordsMenuItems);
  toolbar.append(recordsMenu, widgetsButton, settingsButton);

  const subtitle = document.createElement('div');
  subtitle.className = 'subtitle-bubble';
  subtitle.hidden = true;
  subtitle.setAttribute('aria-label', '当前回复正文');

  const composer = document.createElement('form');
  composer.className = 'chat-composer';
  const input = document.createElement('textarea');
  input.className = 'chat-composer__input';
  input.placeholder = '说点什么吧......';
  input.maxLength = 8_000;
  input.rows = 1;
  input.setAttribute('aria-label', '对话内容');
  const sendButton = createButton('发送', 'chat-composer__send');
  sendButton.type = 'submit';
  const stopButton = createButton('停止', 'chat-composer__stop');
  stopButton.hidden = true;
  composer.append(input, sendButton, stopButton);

  const historyPanel = document.createElement('section');
  historyPanel.className = 'chat-drawer';
  historyPanel.hidden = true;
  const historyHeader = document.createElement('header');
  historyHeader.className = 'chat-drawer__header';
  const historyTitle = document.createElement('strong');
  historyTitle.textContent = '最近对话';
  const clearHistoryButton = createButton('清空', 'text-button');
  const closeHistoryButton = createButton('关闭', 'text-button');
  historyHeader.append(historyTitle, clearHistoryButton, closeHistoryButton);
  const historyList = document.createElement('div');
  historyList.className = 'history-list';
  historyPanel.append(historyHeader, historyList);

  const memoryPanel = document.createElement('section');
  memoryPanel.className = 'chat-drawer memory-panel';
  memoryPanel.hidden = true;
  const memoryHeader = document.createElement('header');
  memoryHeader.className = 'chat-drawer__header memory-header';
  const memoryTitle = document.createElement('strong');
  memoryTitle.textContent = '长期记忆';
  const exportMemoryButton = createButton('导出', 'text-button');
  const backupMemoryButton = createButton('备份', 'text-button');
  const closeMemoryButton = createButton('关闭', 'text-button');
  memoryHeader.append(memoryTitle, exportMemoryButton, backupMemoryButton, closeMemoryButton);
  const memoryControls = document.createElement('div');
  memoryControls.className = 'memory-controls';
  const automaticMemoryInput = document.createElement('input');
  automaticMemoryInput.type = 'checkbox';
  const automaticMemoryLabel = document.createElement('label');
  automaticMemoryLabel.className = 'memory-toggle';
  automaticMemoryLabel.append(automaticMemoryInput, document.createTextNode(' 自动提取'));
  const memoryFilter = document.createElement('select');
  memoryFilter.setAttribute('aria-label', '记忆分类');
  for (const [value, label] of [
    ['', '全部分类'],
    ['preference', '偏好'],
    ['person', '人物关系'],
    ['event', '事件'],
    ['plan', '计划'],
    ['fact', '事实'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    memoryFilter.append(option);
  }
  const clearMemoriesButton = createButton('清空全部', 'text-button danger-button');
  memoryControls.append(automaticMemoryLabel, memoryFilter, clearMemoriesButton);
  const memoryStatus = document.createElement('p');
  memoryStatus.className = 'settings-status';
  memoryStatus.setAttribute('role', 'status');
  const automaticPolicy = document.createElement('details');
  automaticPolicy.className = 'memory-policy';
  const automaticPolicyTitle = document.createElement('summary');
  automaticPolicyTitle.textContent = '自动提取按什么判断？';
  const automaticPolicyIntro = document.createElement('p');
  automaticPolicyIntro.textContent = `开启后，每累计约 ${AUTOMATIC_MEMORY_BATCH_MESSAGES / 2} 轮完整对话，模型会在后台提出最多 ${AUTOMATIC_MEMORY_MAX_CANDIDATES} 条候选。候选不会直接生效。`;
  const automaticPolicyRules = document.createElement('ul');
  for (const rule of [
    '只考虑稳定偏好、人物关系、重要事件、计划目标和明确事实。',
    `本地规则要求重要度至少 ${AUTOMATIC_MEMORY_MIN_IMPORTANCE}、置信度至少 ${AUTOMATIC_MEMORY_MIN_CONFIDENCE}，并且必须能对应到真实用户消息。`,
    '寒暄、玩笑、推测、密码或 API Key 会被忽略；偏好、习惯、关系、冲突和时间不明确的未来事件必须由你确认。',
  ]) {
    const item = document.createElement('li');
    item.textContent = rule;
    automaticPolicyRules.append(item);
  }
  automaticPolicy.append(automaticPolicyTitle, automaticPolicyIntro, automaticPolicyRules);
  const memoryIndexSettings = document.createElement('details');
  memoryIndexSettings.className = 'memory-policy';
  const memoryIndexSummary = document.createElement('summary');
  memoryIndexSummary.textContent = '混合记忆索引（可选）';
  const semanticIndexSelect = document.createElement('select');
  for (const [value, label] of [
    ['local', '本机向量（默认）'],
    ['qdrant', 'Qdrant'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    semanticIndexSelect.append(option);
  }
  const relationshipIndexSelect = document.createElement('select');
  for (const [value, label] of [
    ['local', '本机关系（默认）'],
    ['neo4j', 'Neo4j'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    relationshipIndexSelect.append(option);
  }
  const qdrantUrlInput = document.createElement('input');
  qdrantUrlInput.type = 'url';
  qdrantUrlInput.maxLength = 2_048;
  const qdrantCollectionInput = document.createElement('input');
  qdrantCollectionInput.maxLength = 64;
  const qdrantApiKeyInput = document.createElement('input');
  qdrantApiKeyInput.type = 'password';
  qdrantApiKeyInput.maxLength = 32_768;
  qdrantApiKeyInput.placeholder = '留空保留已保存密钥';
  const neo4jUrlInput = document.createElement('input');
  neo4jUrlInput.type = 'url';
  neo4jUrlInput.maxLength = 2_048;
  const neo4jDatabaseInput = document.createElement('input');
  neo4jDatabaseInput.maxLength = 64;
  const neo4jUsernameInput = document.createElement('input');
  neo4jUsernameInput.maxLength = 128;
  const neo4jPasswordInput = document.createElement('input');
  neo4jPasswordInput.type = 'password';
  neo4jPasswordInput.maxLength = 32_768;
  neo4jPasswordInput.placeholder = '留空保留已保存密码';
  const saveMemoryIndexesButton = createButton('保存索引设置', 'secondary-button');
  const memoryIndexHint = document.createElement('p');
  memoryIndexHint.className = 'settings-status';
  memoryIndexHint.textContent =
    '外部索引默认关闭。启用时会发送向量或关系词与随机记忆 ID，不把外部服务当作唯一正文；断线会自动回退关键词。只允许 HTTPS 或本机 HTTP。';
  memoryIndexSettings.append(
    memoryIndexSummary,
    memoryIndexHint,
    createField('语义索引', semanticIndexSelect),
    createField('Qdrant 地址', qdrantUrlInput),
    createField('Qdrant 集合', qdrantCollectionInput),
    createField('Qdrant API Key', qdrantApiKeyInput),
    createField('关系索引', relationshipIndexSelect),
    createField('Neo4j HTTP 地址', neo4jUrlInput),
    createField('Neo4j 数据库', neo4jDatabaseInput),
    createField('Neo4j 用户名', neo4jUsernameInput),
    createField('Neo4j 密码', neo4jPasswordInput),
    saveMemoryIndexesButton,
  );
  const candidateTitle = document.createElement('strong');
  candidateTitle.className = 'memory-section-title';
  candidateTitle.textContent = '待你确认';
  const candidateList = document.createElement('div');
  candidateList.className = 'memory-list memory-candidate-list';
  const confirmedMemoryTitle = document.createElement('strong');
  confirmedMemoryTitle.className = 'memory-section-title';
  confirmedMemoryTitle.textContent = '已确认记忆';
  const memoryList = document.createElement('div');
  memoryList.className = 'memory-list';
  memoryPanel.append(
    memoryHeader,
    memoryControls,
    memoryStatus,
    automaticPolicy,
    memoryIndexSettings,
    candidateTitle,
    candidateList,
    confirmedMemoryTitle,
    memoryList,
  );

  const debugPanel = document.createElement('section');
  debugPanel.className = 'chat-drawer context-debug-panel';
  debugPanel.hidden = true;
  const debugHeader = document.createElement('header');
  debugHeader.className = 'chat-drawer__header';
  const debugTitle = document.createElement('strong');
  debugTitle.textContent = '本轮上下文说明';
  const closeDebugButton = createButton('关闭', 'text-button');
  debugHeader.append(debugTitle, closeDebugButton);
  const debugContent = document.createElement('div');
  debugContent.className = 'context-debug__content';
  debugPanel.append(debugHeader, debugContent);

  const settingsPanel = document.createElement('form');
  settingsPanel.className = 'chat-drawer settings-panel';
  settingsPanel.hidden = true;
  const settingsHeader = document.createElement('header');
  settingsHeader.className = 'chat-drawer__header';
  const settingsTitle = document.createElement('strong');
  settingsTitle.textContent = '模型、角色与人格';
  const closeSettingsButton = createButton('关闭', 'text-button');
  settingsHeader.append(settingsTitle, closeSettingsButton);

  const scaleInput = document.createElement('input');
  scaleInput.type = 'range';
  scaleInput.min = String(MIN_WINDOW_SCALE);
  scaleInput.max = String(MAX_WINDOW_SCALE);
  scaleInput.step = '0.01';
  scaleInput.value = '0.85';
  scaleInput.setAttribute('aria-label', '桌宠大小');
  const scaleOutput = document.createElement('output');
  scaleOutput.className = 'scale-output';
  scaleOutput.textContent = '100%';
  const scaleControl = document.createElement('div');
  scaleControl.className = 'scale-control';
  scaleControl.append(scaleInput, scaleOutput);
  const scaleField = document.createElement('label');
  scaleField.className = 'settings-field';
  const scaleLabel = document.createElement('span');
  scaleLabel.textContent = '桌宠大小';
  scaleField.append(scaleLabel, scaleControl);

  const providerSelect = document.createElement('select');
  for (const [value, label] of [
    ['anthropic', 'Anthropic Claude'],
    ['deepseek', 'DeepSeek'],
    ['openai-compatible', 'OpenAI / Ollama 兼容'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    providerSelect.append(option);
  }
  const modelInput = document.createElement('input');
  modelInput.maxLength = 256;
  modelInput.placeholder = '例如 Claude 或本地模型 ID';
  const baseUrlInput = document.createElement('input');
  baseUrlInput.type = 'url';
  baseUrlInput.maxLength = 2_048;
  baseUrlInput.placeholder = '例如：http://127.0.0.1:11434/v1';
  const modelCollaborationPanel = document.createElement('section');
  modelCollaborationPanel.className = 'character-search';
  const modelCollaborationHeading = document.createElement('label');
  modelCollaborationHeading.className = 'settings-toggle-heading';
  const modelCollaborationTitle = document.createElement('strong');
  modelCollaborationTitle.textContent = '本地 / 远端模型协作';
  const allowRemoteComplexTasksInput = document.createElement('input');
  allowRemoteComplexTasksInput.type = 'checkbox';
  allowRemoteComplexTasksInput.setAttribute('aria-label', '允许复杂整理使用指定远端模型');
  modelCollaborationHeading.append(modelCollaborationTitle, allowRemoteComplexTasksInput);
  const modelCollaborationHint = document.createElement('small');
  modelCollaborationHint.className = 'settings-hint settings-toggle-hint';
  modelCollaborationHint.textContent = '允许复杂整理使用指定远端模型';
  const remoteProviderSelect = document.createElement('select');
  for (const [value, label] of [
    ['anthropic', 'Anthropic Claude'],
    ['deepseek', 'DeepSeek'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    remoteProviderSelect.append(option);
  }
  const remoteModelInput = document.createElement('input');
  remoteModelInput.maxLength = 256;
  remoteModelInput.placeholder = '远端模型 ID';
  const remoteApiKeyInput = document.createElement('input');
  remoteApiKeyInput.type = 'password';
  remoteApiKeyInput.maxLength = 32_768;
  remoteApiKeyInput.autocomplete = 'off';
  remoteApiKeyInput.placeholder = '留空则保留远端提供商已有密钥';
  const remoteSecretStatus = document.createElement('p');
  remoteSecretStatus.className = 'settings-status';
  const modelCollaborationStatus = document.createElement('p');
  modelCollaborationStatus.className = 'settings-status';
  modelCollaborationStatus.textContent =
    '资料检索对所有模型使用同一来源与超时策略。默认关闭时，角色整理、摘要和记忆候选都由当前模型处理，本地 Ollama 无需联网；开启后才会发送给指定远端模型，失败会回退当前模型。';
  modelCollaborationPanel.append(
    modelCollaborationHeading,
    modelCollaborationHint,
    createField('远端提供商', remoteProviderSelect),
    createField('远端模型', remoteModelInput),
    createField('远端 API Key', remoteApiKeyInput),
    remoteSecretStatus,
    modelCollaborationStatus,
  );
  const apiKeyInput = document.createElement('input');
  apiKeyInput.type = 'password';
  apiKeyInput.maxLength = 32_768;
  apiKeyInput.autocomplete = 'off';
  apiKeyInput.placeholder = '留空则保留现有密钥';
  const characterNameInput = document.createElement('input');
  characterNameInput.maxLength = 80;
  characterNameInput.autocomplete = 'off';
  const characterLibrary = document.createElement('section');
  characterLibrary.className = 'character-search character-library';
  const characterLibraryTitle = document.createElement('strong');
  characterLibraryTitle.textContent = '角色库与角色包';
  const characterLibraryStatus = document.createElement('p');
  characterLibraryStatus.className = 'settings-status';
  characterLibraryStatus.setAttribute('role', 'status');
  characterLibraryStatus.textContent = '角色之间的对话、记忆和模型资源彼此隔离。';
  const characterLibraryList = document.createElement('div');
  characterLibraryList.className = 'character-library__list';
  const characterLibraryActions = document.createElement('div');
  characterLibraryActions.className = 'settings-actions';
  const importCharacterButton = createButton('预览并导入', 'secondary-button');
  const exportCharacterButton = createButton('导出当前角色', 'text-button');
  characterLibraryActions.append(importCharacterButton, exportCharacterButton);
  characterLibrary.append(
    characterLibraryTitle,
    characterLibraryStatus,
    characterLibraryList,
    characterLibraryActions,
  );
  const loreSourceWorkInput = document.createElement('input');
  loreSourceWorkInput.maxLength = 300;
  loreSourceWorkInput.placeholder = '例如：明日方舟（填写后搜索更准确）';
  const characterSearch = document.createElement('section');
  characterSearch.className = 'character-search';
  const characterSearchStatus = document.createElement('p');
  characterSearchStatus.className = 'settings-status';
  characterSearchStatus.setAttribute('role', 'status');
  characterSearchStatus.textContent = '可以联网查找公开资料；结果需要你确认后才会保存。';
  const characterResearchProgress = document.createElement('div');
  characterResearchProgress.className = 'character-research-progress';
  characterResearchProgress.hidden = true;
  characterResearchProgress.setAttribute('role', 'progressbar');
  characterResearchProgress.setAttribute('aria-label', '联网角色资料处理进度');
  characterResearchProgress.setAttribute('aria-valuetext', '正在处理');
  const characterSearchCandidates = document.createElement('div');
  characterSearchCandidates.className = 'character-search__candidates';
  const characterSearchActions = document.createElement('div');
  characterSearchActions.className = 'settings-actions';
  const cancelCharacterSearchButton = createButton('取消查找', 'text-button');
  cancelCharacterSearchButton.hidden = true;
  const searchCharacterButton = createButton('联网查找', 'secondary-button');
  characterSearchActions.append(cancelCharacterSearchButton, searchCharacterButton);
  characterSearch.append(
    characterSearchStatus,
    characterResearchProgress,
    characterSearchCandidates,
    characterSearchActions,
  );
  const glossaryPanel = document.createElement('section');
  glossaryPanel.className = 'character-search glossary-sync';
  const glossaryStatus = document.createElement('p');
  glossaryStatus.className = 'settings-status';
  glossaryStatus.setAttribute('role', 'status');
  glossaryStatus.textContent = '作品词库只补充专有名词和社区用语，不负责角色说话风格。';
  const glossarySources = document.createElement('details');
  glossarySources.className = 'glossary-sources';
  glossarySources.hidden = true;
  const glossarySourcesSummary = document.createElement('summary');
  const glossarySourcesPreview = document.createElement('span');
  glossarySourcesPreview.className = 'glossary-sources__preview';
  const glossarySourcesToggle = document.createElement('span');
  glossarySourcesToggle.className = 'glossary-sources__toggle';
  glossarySourcesToggle.textContent = '.....点击展开';
  glossarySourcesSummary.append(glossarySourcesPreview, glossarySourcesToggle);
  const glossarySourcesFull = document.createElement('small');
  glossarySourcesFull.className = 'glossary-sources__full';
  glossarySources.append(glossarySourcesSummary, glossarySourcesFull);
  glossarySources.addEventListener('toggle', () => {
    glossarySourcesToggle.textContent = glossarySources.open ? '收起来源' : '.....点击展开';
  });
  const syncGlossaryButton = createButton('同步作品词库', 'secondary-button');
  const glossaryActions = document.createElement('div');
  glossaryActions.className = 'settings-actions';
  glossaryActions.append(syncGlossaryButton);
  glossaryPanel.append(glossaryStatus, glossarySources, glossaryActions);
  const loreEditor = document.createElement('details');
  loreEditor.className = 'character-lore';
  const loreSummary = document.createElement('summary');
  loreSummary.textContent = '角色设定';
  const loreHint = document.createElement('p');
  loreHint.className = 'settings-status';
  loreHint.textContent =
    '默认称呼是“你”，并使用通用简介和人格规则。联网整理角色后，这些内容会和原作资料一起更新；点击总设置的“保存”后才生效。';
  const userNameInput = document.createElement('input');
  userNameInput.maxLength = 80;
  const bioInput = document.createElement('textarea');
  bioInput.maxLength = 2_000;
  bioInput.rows = 2;
  const personaInput = document.createElement('textarea');
  personaInput.maxLength = 16_000;
  personaInput.rows = 5;
  const loreAliasesInput = document.createElement('input');
  loreAliasesInput.maxLength = 2_000;
  loreAliasesInput.placeholder = '用顿号分隔，例如：昵称、别称';
  const lorePersonalityInput = document.createElement('textarea');
  lorePersonalityInput.maxLength = 2_000;
  lorePersonalityInput.rows = 3;
  const loreBackgroundInput = document.createElement('textarea');
  loreBackgroundInput.maxLength = 4_000;
  loreBackgroundInput.rows = 4;
  const loreRelationshipsInput = document.createElement('textarea');
  loreRelationshipsInput.maxLength = 6_000;
  loreRelationshipsInput.rows = 3;
  loreRelationshipsInput.placeholder = '每行一条';
  const loreSpeechStyleInput = document.createElement('textarea');
  loreSpeechStyleInput.maxLength = 2_000;
  loreSpeechStyleInput.rows = 3;
  loreSpeechStyleInput.placeholder = '对用户的称呼、语气、句式、惯用词和情绪表达';
  const loreSampleLinesInput = document.createElement('textarea');
  loreSampleLinesInput.maxLength = 6_000;
  loreSampleLinesInput.rows = 6;
  loreSampleLinesInput.placeholder =
    '每行一条：场景｜情绪｜触发条件｜角色态度｜短回应\n也兼容直接填写普通短台词';
  const loreSourcesOutput = document.createElement('small');
  loreSourcesOutput.className = 'character-lore__sources';
  const clearLoreButton = createButton('清空详细资料', 'text-button danger-button');
  const loreActions = document.createElement('div');
  loreActions.className = 'settings-actions';
  loreActions.append(clearLoreButton);
  loreEditor.append(
    loreSummary,
    loreHint,
    createField('对用户的称呼', userNameInput),
    createField('角色简介', bioInput),
    createField('人格规则', personaInput),
    createField('别名', loreAliasesInput),
    createField('性格', lorePersonalityInput),
    createField('背景资料', loreBackgroundInput),
    createField('重要关系', loreRelationshipsInput),
    createField('称呼与说话方式', loreSpeechStyleInput),
    createField('情境对话示例', loreSampleLinesInput),
    loreSourcesOutput,
    loreActions,
  );

  const secretStatus = document.createElement('small');
  secretStatus.className = 'settings-status';
  const secretRow = document.createElement('div');
  secretRow.className = 'settings-secret-row';
  const deleteSecretButton = createButton('删除当前密钥', 'text-button');
  deleteSecretButton.hidden = true;
  secretRow.append(secretStatus, deleteSecretButton);
  const settingsStatus = document.createElement('p');
  settingsStatus.className = 'settings-status';
  settingsStatus.setAttribute('role', 'status');
  const connectionStatus = document.createElement('p');
  connectionStatus.className = 'settings-status connection-status';
  connectionStatus.setAttribute('role', 'status');
  connectionStatus.setAttribute('aria-live', 'polite');
  const modelCapabilityStatus = document.createElement('p');
  modelCapabilityStatus.className = 'settings-status';
  const desktopIntegrationPanel = document.createElement('section');
  desktopIntegrationPanel.className = 'character-search';
  const desktopIntegrationHeading = document.createElement('label');
  desktopIntegrationHeading.className = 'settings-toggle-heading';
  const desktopIntegrationTitle = document.createElement('strong');
  desktopIntegrationTitle.textContent = '桌面快捷操作';
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
  const visibilityShortcutHint = document.createElement('small');
  visibilityShortcutHint.className = 'settings-hint';
  visibilityShortcutHint.textContent =
    '默认是 、 键（系统记作 \\）；切到其他程序后不会占用。隐藏后请点击托盘图标重新显示。';
  visibilityShortcutField.append(visibilityShortcutHint);
  const stopGenerationShortcutInput = document.createElement('input');
  stopGenerationShortcutInput.maxLength = 64;
  stopGenerationShortcutInput.autocomplete = 'off';
  stopGenerationShortcutInput.spellcheck = false;
  const stopGenerationShortcutField = createField('停止生成快捷键', stopGenerationShortcutInput);
  const stopGenerationShortcutHint = document.createElement('small');
  stopGenerationShortcutHint.className = 'settings-hint';
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
  const inputOverlayHint = document.createElement('small');
  inputOverlayHint.className = 'settings-hint';
  inputOverlayHint.textContent =
    '默认 W, A, S, D；可用逗号、顿号、分号或空格添加最多 24 个按键，输入时不会被状态刷新覆盖。只显示选定按键，不保存输入内容或轨迹，也不会发送给模型。';
  inputOverlayKeysField.append(inputOverlayHint);
  const inputOverlayMouseInput = document.createElement('input');
  inputOverlayMouseInput.type = 'checkbox';
  const inputOverlayMouseField = document.createElement('label');
  inputOverlayMouseField.className = 'settings-field';
  inputOverlayMouseField.append(inputOverlayMouseInput, ' 显示鼠标三键和移动方向');
  const mediaControlInput = document.createElement('input');
  mediaControlInput.type = 'checkbox';
  mediaControlInput.setAttribute('aria-label', '启用系统媒体控制');
  const desktopIntegrationStatus = document.createElement('p');
  desktopIntegrationStatus.className = 'settings-status';
  desktopIntegrationStatus.textContent = '窗口快捷键默认关闭。';
  const mediaActions = document.createElement('div');
  mediaActions.className = 'settings-actions widget-media-actions';
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
  const widgetsPanel = document.createElement('section');
  widgetsPanel.className = 'chat-drawer widgets-panel';
  widgetsPanel.hidden = true;
  const widgetsHeader = document.createElement('header');
  widgetsHeader.className = 'chat-drawer__header';
  const widgetsTitle = document.createElement('strong');
  widgetsTitle.textContent = '小组件';
  const closeWidgetsButton = createButton('关闭', 'text-button');
  widgetsHeader.append(widgetsTitle, closeWidgetsButton);
  const widgetsContent = document.createElement('div');
  widgetsContent.className = 'widgets-panel__content';
  const widgetsCatalog = document.createElement('div');
  widgetsCatalog.className = 'widget-catalog';
  let widgetOrder: DesktopWidgetId[] = [];
  const createWidgetCatalogCard = (
    definition: DesktopWidgetDefinition,
  ): {
    card: HTMLElement;
    toggleButton: HTMLButtonElement;
    settingsButton: HTMLButtonElement;
  } => {
    const card = document.createElement('article');
    card.className = 'widget-catalog-card';
    const icon = document.createElement('span');
    icon.className = 'widget-catalog-card__icon';
    icon.textContent = definition.iconText;
    const copy = document.createElement('span');
    copy.className = 'widget-catalog-card__copy';
    const title = document.createElement('strong');
    title.textContent = definition.title;
    const description = document.createElement('small');
    description.textContent = definition.description;
    copy.append(title, description);
    const actions = document.createElement('span');
    actions.className = 'widget-catalog-card__actions';
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
  const inputWidget = document.createElement('section');
  inputWidget.className = 'widget-detail';
  inputWidget.hidden = true;
  const inputWidgetHeader = document.createElement('div');
  inputWidgetHeader.className = 'widget-detail__header';
  const backFromInputWidgetButton = createButton('返回', 'text-button');
  const inputWidgetTitle = document.createElement('strong');
  inputWidgetTitle.textContent = '输入显示';
  inputWidgetHeader.append(backFromInputWidgetButton, inputWidgetTitle, inputOverlayEnabledInput);
  inputWidget.append(inputWidgetHeader, inputOverlayKeysField, inputOverlayMouseField);
  const mediaWidget = document.createElement('section');
  mediaWidget.className = 'widget-detail';
  mediaWidget.hidden = true;
  const mediaWidgetHeader = document.createElement('div');
  mediaWidgetHeader.className = 'widget-detail__header';
  const backFromMediaWidgetButton = createButton('返回', 'text-button');
  const mediaWidgetTitle = document.createElement('strong');
  mediaWidgetTitle.textContent = '听歌控制';
  const mediaWidgetHint = document.createElement('small');
  mediaWidgetHint.className = 'settings-hint';
  mediaWidgetHint.textContent = `当前适配：${SUPPORTED_MEDIA_PLAYERS.map(({ name }) => name).join('、')}。开启后悬浮控制条会固定保留。`;
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
  const settingsActions = document.createElement('div');
  settingsActions.className = 'settings-actions';
  const testButton = createButton('测试连接', 'secondary-button');
  const connectionActions = document.createElement('div');
  connectionActions.className = 'settings-actions connection-actions';
  connectionActions.append(testButton);
  const saveButton = createButton('保存', 'primary-button');
  saveButton.type = 'submit';
  settingsActions.append(saveButton);
  const baseUrlField = createField('兼容接口地址（仅 OpenAI / Ollama）', baseUrlInput);
  const baseUrlHint = document.createElement('small');
  baseUrlHint.className = 'settings-hint';
  baseUrlHint.textContent = '用于连接本地 Ollama 或其他 OpenAI 兼容服务；Claude 不使用此地址。';
  baseUrlField.append(baseUrlHint);
  baseUrlField.hidden = true;
  settingsPanel.append(
    settingsHeader,
    scaleField,
    createField('提供商', providerSelect),
    createField('模型名称', modelInput),
    baseUrlField,
    createField('API Key', apiKeyInput),
    secretRow,
    connectionActions,
    connectionStatus,
    modelCollaborationPanel,
    characterLibrary,
    createField('角色名称', characterNameInput),
    createField('来源作品或游戏', loreSourceWorkInput),
    characterSearch,
    glossaryPanel,
    loreEditor,
    desktopIntegrationPanel,
    settingsStatus,
    modelCapabilityStatus,
    settingsActions,
  );

  const actionDialog = document.createElement('dialog');
  actionDialog.className = 'app-dialog';
  const actionDialogForm = document.createElement('form');
  actionDialogForm.method = 'dialog';
  const actionDialogTitle = document.createElement('strong');
  actionDialogTitle.className = 'app-dialog__title';
  const actionDialogMessage = document.createElement('p');
  actionDialogMessage.className = 'app-dialog__message';
  const actionDialogDetails = document.createElement('details');
  actionDialogDetails.className = 'app-dialog__details';
  const actionDialogDetailsSummary = document.createElement('summary');
  actionDialogDetailsSummary.textContent = '.....点击展开';
  const actionDialogDetailsText = document.createElement('p');
  actionDialogDetails.append(actionDialogDetailsSummary, actionDialogDetailsText);
  const actionDialogActions = document.createElement('div');
  actionDialogActions.className = 'app-dialog__actions';
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
    subtitle,
    composer,
    toolbar,
    historyPanel,
    memoryPanel,
    debugPanel,
    widgetsPanel,
    settingsPanel,
  );
  shell.append(launcherButton, panel);
  root.append(shell, desktopOverlayStack, actionDialog);

  const loreTextareas = [
    bioInput,
    personaInput,
    lorePersonalityInput,
    loreBackgroundInput,
    loreRelationshipsInput,
    loreSpeechStyleInput,
    loreSampleLinesInput,
  ];
  const resizeLoreTextareas = (): void => {
    requestAnimationFrame(() => {
      for (const resize of loreTextareaResizers) resize();
    });
  };
  const loreTextareaResizers = loreTextareas.map(enableAutoGrowingTextarea);
  const loreEditorResizeObserver = new ResizeObserver(() => {
    if (loreEditor.open) resizeLoreTextareas();
  });
  loreEditorResizeObserver.observe(settingsPanel);
  loreEditor.addEventListener('toggle', () => {
    if (loreEditor.open) resizeLoreTextareas();
  });

  let messages: ConversationMessage[] = [];
  let memoryRecords: MemoryRecord[] = [];
  let memoryCandidates: MemoryCandidateRecord[] = [];
  let profile: CharacterProfile | undefined;
  let loreSources: CharacterLore['sources'] = [];
  let roleplayExampleSourceIds = new Map<string, string>();
  let activeCharacterResearchId: string | undefined;
  let activeGlossarySyncWork: string | undefined;
  const automaticallyRequestedGlossaryWorks = new Set<string>();
  let activeRequestId: string | undefined;
  let activeReply = '';
  let panelExpanded = false;
  let panelView: 'chat' | 'settings' = 'chat';
  let openingLineShown = false;
  let openingLineContext: OpeningLineContext = 'resume';
  let openingLineGeneration = 0;
  let replyStateLabel = '随时可以开始聊天';
  let latestContextDebug: ConversationContextDebug | undefined;

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

  const updateIdentity = (): void => {
    const name = characterDisplayName();
    replyAuthor.textContent = name;
    modelCapabilityStatus.textContent =
      getCharacter()?.capabilityReport.summary ?? 'Live2D 能力报告将在模型加载后显示。';
    input.placeholder = '说点什么吧......';
    setReplyStatus(replyStateLabel);
    renderHistory();
  };

  const getDefaultOpeningLine = (): string =>
    profile?.lore?.sampleLines?.find((line) => line.trim().length > 0)?.trim() ||
    `${profile?.userDisplayName || '你'}，我在。`;

  const displayOpeningLine = (line: string): void => {
    subtitle.hidden = false;
    subtitle.textContent = line;
    setReplyStatus('先和你说了一句');
  };

  const showOpeningLineIfReady = async (): Promise<void> => {
    if (openingLineShown || !profile || !getCharacter()) return;
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
      void getCharacter()
        ?.controller.respond(result.emotion)
        .then(() => getCharacter()?.controller.state.set('idle'));
    }
  };

  const resetCharacterSessionView = (): void => {
    openingLineGeneration += 1;
    openingLineShown = false;
    activeReply = '';
    latestContextDebug = undefined;
    memoryRecords = [];
    memoryCandidates = [];
    subtitle.hidden = true;
    subtitle.textContent = '';
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

  const loadCharacterLibrary = async (): Promise<void> => {
    if (!api) return;
    const entries = await api.listCharacters();
    characterLibraryList.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement('div');
      row.className = 'character-library__entry';
      const description = document.createElement('span');
      description.textContent = `${entry.profile.name}${entry.active ? '（当前）' : ''}`;
      const actions = document.createElement('div');
      actions.className = 'settings-actions';
      if (!entry.active) {
        const activate = createButton('切换', 'text-button');
        activate.addEventListener('click', () => {
          void (async () => {
            const confirmed = await confirmAction({
              title: '切换角色',
              message: `切换到“${entry.profile.name}”？`,
              details:
                '当前未保存的设置不会带到新角色。对话历史、长期记忆和作品词库会切换到该角色自己的命名空间。',
              confirmLabel: '切换',
            });
            if (!confirmed) return;
            const result = await api.activateCharacter({ characterId: entry.profile.id });
            if (!result.ok) {
              characterLibraryStatus.textContent = result.error.message;
              return;
            }
            await refreshActiveCharacter();
            characterLibraryStatus.textContent = `已切换到“${entry.profile.name}”。`;
          })();
        });
        actions.append(activate);
      }
      if (entry.imported) {
        const remove = createButton('删除', 'text-button danger-button');
        remove.addEventListener('click', () => {
          void (async () => {
            const confirmed = await confirmAction({
              title: '删除角色包',
              message: `删除“${entry.profile.name}”的角色资料和模型素材？`,
              details:
                '该角色的对话和长期记忆不会随角色包删除，但在重新导入同一角色前不会显示。此操作无法撤销。',
              confirmLabel: '删除',
            });
            if (!confirmed) return;
            const result = await api.removeCharacter({ characterId: entry.profile.id });
            if (!result.ok) {
              characterLibraryStatus.textContent = result.error.message;
              return;
            }
            await refreshActiveCharacter();
            characterLibraryStatus.textContent = '角色包已删除。';
          })();
        });
        actions.append(remove);
      }
      row.append(description, actions);
      characterLibraryList.append(row);
    }
  };

  const displayPanelExpanded = (expanded: boolean): void => {
    shell.classList.toggle('chat-shell--expanded', expanded);
    root.classList.toggle('chat-expanded', expanded);
    launcherButton.setAttribute('aria-expanded', String(expanded));
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

  const updateProviderVisibility = (): void => {
    baseUrlField.hidden = providerSelect.value !== 'openai-compatible';
    modelInput.placeholder =
      providerSelect.value === 'deepseek'
        ? '例如：deepseek-v4-flash'
        : providerSelect.value === 'anthropic'
          ? '例如：Claude 模型 ID'
          : '例如：OpenAI 或本地模型 ID';
  };

  const updateCollaborationVisibility = (): void => {
    const enabled = allowRemoteComplexTasksInput.checked;
    const sharesProvider = remoteProviderSelect.value === providerSelect.value;
    remoteProviderSelect.disabled = !enabled;
    remoteModelInput.disabled = !enabled;
    remoteApiKeyInput.disabled = !enabled || sharesProvider;
    remoteApiKeyInput.placeholder = sharesProvider
      ? '与上方当前提供商共用密钥'
      : '留空则保留远端提供商已有密钥';
  };

  const updateSecretStatus = async (): Promise<void> => {
    if (!api) {
      return;
    }
    const secrets = await api.getProviderSecretStatus();
    const selected = providerSelect.value as ConfigurableProviderId;
    deleteSecretButton.hidden = !secrets[selected];
    secretStatus.textContent = secrets[selected]
      ? '已安全保存密钥；留空不会覆盖。'
      : selected === 'openai-compatible'
        ? '未保存密钥；本地 Ollama 可保持为空。'
        : '尚未保存密钥。';
    const remoteSelected = remoteProviderSelect.value as ConfigurableProviderId;
    const sharesProvider = remoteSelected === selected;
    remoteSecretStatus.textContent = sharesProvider
      ? '远端模型与上方使用同一提供商，将共用该提供商的密钥。'
      : secrets[remoteSelected]
        ? '远端提供商的密钥已安全保存；留空不会覆盖。'
        : '远端提供商尚未保存密钥。';
    updateCollaborationVisibility();
  };

  const closeDrawers = (): void => {
    const wasSettingsOpen = !settingsPanel.hidden;
    recordsMenu.open = false;
    historyPanel.hidden = true;
    memoryPanel.hidden = true;
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
      const item = document.createElement('p');
      item.className = 'settings-status';
      item.textContent = `回退：${fallback}`;
      debugContent.append(item);
    }
  };

  const renderHistory = (): void => {
    historyList.replaceChildren();
    if (messages.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = '还没有对话，开始聊吧。';
      historyList.append(empty);
      return;
    }
    for (const message of messages) {
      const item = document.createElement('article');
      item.className = `history-message history-message--${message.role}`;
      const author = document.createElement('strong');
      author.textContent =
        message.role === 'user' ? (profile?.userDisplayName ?? '你') : characterDisplayName();
      const content = document.createElement('p');
      content.textContent = message.content;
      item.append(author, content);
      if (message.status === 'cancelled') {
        const status = document.createElement('small');
        status.textContent = '已停止';
        item.append(status);
      }
      historyList.append(item);
    }
    historyList.scrollTop = historyList.scrollHeight;
  };

  const memoryTypeLabels: Record<MemoryType, string> = {
    preference: '偏好',
    person: '人物关系',
    event: '事件',
    plan: '计划',
    fact: '事实',
  };

  const memoryReviewLabels: Record<MemoryReviewReason, string> = {
    legacy_automatic: '旧版自动记忆，升级后等待确认',
    conflict: '与现有记忆冲突',
    time_uncertain: '未来时间还不明确',
    profile_claim: '偏好、习惯或关系信息不会自动生效',
  };

  const renderMemoryCandidates = (): void => {
    candidateList.replaceChildren();
    const selectedType = memoryFilter.value;
    const filtered = selectedType
      ? memoryCandidates.filter((candidate) => candidate.type === selectedType)
      : memoryCandidates;
    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = '没有待确认项。自动提取会先来这里排队，不会偷偷混进聊天。';
      candidateList.append(empty);
      return;
    }
    for (const candidate of filtered) {
      const card = document.createElement('article');
      card.className = 'memory-card memory-card--candidate';
      const heading = document.createElement('div');
      heading.className = 'memory-candidate-heading';
      const type = document.createElement('strong');
      type.textContent = memoryTypeLabels[candidate.type];
      const state = document.createElement('span');
      state.className = 'memory-badge';
      state.textContent = candidate.status === 'conflict' ? '有冲突' : '待确认';
      heading.append(type, state);
      const typeSelect = document.createElement('select');
      typeSelect.setAttribute('aria-label', '候选记忆分类');
      for (const memoryType of Object.keys(memoryTypeLabels) as MemoryType[]) {
        const option = document.createElement('option');
        option.value = memoryType;
        option.textContent = memoryTypeLabels[memoryType];
        typeSelect.append(option);
      }
      typeSelect.value = candidate.type;
      const content = document.createElement('textarea');
      content.className = 'memory-candidate-content';
      content.value = candidate.content;
      content.maxLength = 1_000;
      content.rows = 2;
      content.setAttribute('aria-label', '候选记忆内容');
      const metrics = document.createElement('div');
      metrics.className = 'memory-metrics';
      const importance = document.createElement('input');
      importance.type = 'range';
      importance.min = '0';
      importance.max = '1';
      importance.step = '0.05';
      importance.value = candidate.importance.toFixed(2);
      importance.setAttribute('aria-label', '候选重要度');
      const confidence = document.createElement('input');
      confidence.type = 'range';
      confidence.min = '0';
      confidence.max = '1';
      confidence.step = '0.05';
      confidence.value = candidate.confidence.toFixed(2);
      confidence.setAttribute('aria-label', '候选置信度');
      metrics.append(
        document.createTextNode('重要度 '),
        importance,
        document.createTextNode(' 置信度 '),
        confidence,
      );
      const expirationField = document.createElement('label');
      expirationField.className = 'memory-expiration';
      const expirationLabel = document.createElement('span');
      expirationLabel.textContent = '有效期（可不填）';
      const expiration = document.createElement('input');
      expiration.type = 'datetime-local';
      expiration.value = formatLocalDateTime(candidate.expiresAt);
      expirationField.append(expirationLabel, expiration);
      const updateExpirationVisibility = (): void => {
        expirationField.hidden = !['event', 'plan'].includes(typeSelect.value);
        if (expirationField.hidden) expiration.value = '';
      };
      updateExpirationVisibility();
      const reasons = document.createElement('p');
      reasons.className = 'memory-source';
      reasons.textContent = candidate.reviewReasons.length
        ? candidate.reviewReasons.map((reason) => memoryReviewLabels[reason]).join('；')
        : '自动提取结果，需要你点头才会生效。';
      card.append(heading, typeSelect, content, metrics, expirationField, reasons);
      if (candidate.conflictingMemory) {
        const conflict = document.createElement('p');
        conflict.className = 'memory-conflict';
        conflict.textContent = `现有记忆：${candidate.conflictingMemory.content}`;
        card.append(conflict);
      }
      const evidenceSummary = document.createElement('small');
      evidenceSummary.className = 'memory-source';
      evidenceSummary.textContent = `证据 ${candidate.evidence.length} 条，来自 ${candidate.evidenceDateCount} 个日期`;
      const evidenceList = document.createElement('ul');
      evidenceList.className = 'memory-evidence-list';
      for (const evidence of candidate.evidence.slice(0, 3)) {
        const item = document.createElement('li');
        const date = new Date(evidence.observedAt).toLocaleDateString();
        item.textContent = evidence.sourceExcerpt
          ? `${date} · ${evidence.sourceExcerpt}`
          : `${date} · 原消息已从对话历史清除`;
        evidenceList.append(item);
      }
      const actions = document.createElement('div');
      actions.className = 'memory-card__actions';
      const saveDraft = createButton('保存候选修改', 'text-button');
      const confirm = createButton('确认记住', 'text-button');
      const reject = createButton('拒绝', 'text-button danger-button');
      actions.append(saveDraft, confirm, reject);
      let dirty = false;
      const markDirty = (): void => {
        dirty = true;
        saveDraft.textContent = '保存候选修改 *';
      };
      for (const control of [typeSelect, content, importance, confidence, expiration]) {
        control.addEventListener('input', markDirty);
      }
      typeSelect.addEventListener('change', () => {
        updateExpirationVisibility();
        markDirty();
      });
      saveDraft.addEventListener('click', () => {
        void (async () => {
          if (!api) return;
          if (!content.value.trim()) {
            memoryStatus.textContent = '候选内容不能为空。';
            return;
          }
          const parsedExpiration = readFutureExpiration(expiration);
          if (!parsedExpiration.ok) {
            memoryStatus.textContent = '有效期必须是将来的时间，或者留空。';
            return;
          }
          const result = await api.updateMemoryCandidate({
            id: candidate.id,
            type: typeSelect.value as MemoryType,
            content: content.value.trim(),
            importance: Number(importance.value),
            confidence: Number(confidence.value),
            ...('expiresAt' in parsedExpiration ? { expiresAt: parsedExpiration.expiresAt } : {}),
          });
          memoryStatus.textContent = result.ok ? '候选修改已保存。' : result.message;
          if (result.ok) await loadMemories();
        })();
      });
      let conflictResolution: HTMLSelectElement | undefined;
      if (candidate.conflictingMemory) {
        conflictResolution = document.createElement('select');
        conflictResolution.setAttribute('aria-label', '冲突处理方式');
        for (const [value, label] of [
          ['replace', '用新记忆替换旧记忆'],
          ['keep-both', '新旧两条都保留'],
        ] as const) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          conflictResolution.append(option);
        }
        card.append(conflictResolution);
      }
      const mergeableCandidates = memoryCandidates.filter(
        (other) =>
          other.id !== candidate.id &&
          other.type === candidate.type &&
          other.normalizedKey === candidate.normalizedKey,
      );
      if (mergeableCandidates.length > 0) {
        const mergeRow = document.createElement('div');
        mergeRow.className = 'memory-merge-row';
        const mergeSelect = document.createElement('select');
        mergeSelect.setAttribute('aria-label', '要合并的候选');
        for (const other of mergeableCandidates) {
          const option = document.createElement('option');
          option.value = other.id;
          option.textContent = other.content.slice(0, 60);
          mergeSelect.append(option);
        }
        const mergeButton = createButton('合并证据到本条', 'text-button');
        mergeButton.addEventListener('click', () => {
          void (async () => {
            if (!api) return;
            if (dirty) {
              memoryStatus.textContent = '请先保存候选修改，再合并证据。';
              return;
            }
            const result = await api.mergeMemoryCandidates({
              targetId: candidate.id,
              sourceId: mergeSelect.value,
            });
            memoryStatus.textContent = result.ok ? '候选及其来源证据已合并。' : result.message;
            if (result.ok) await loadMemories();
          })();
        });
        mergeRow.append(mergeSelect, mergeButton);
        card.append(mergeRow);
      }
      confirm.addEventListener('click', () => {
        void (async () => {
          if (!api) return;
          if (dirty) {
            memoryStatus.textContent = '请先保存候选修改，再确认记忆。';
            return;
          }
          const result = await api.confirmMemoryCandidate({
            id: candidate.id,
            conflictResolution: conflictResolution?.value === 'keep-both' ? 'keep-both' : 'replace',
          });
          memoryStatus.textContent = result.ok
            ? '候选已经确认，会在相关对话中生效。'
            : result.message;
          if (result.ok) await loadMemories();
        })();
      });
      reject.addEventListener('click', () => {
        void (async () => {
          if (!api) return;
          const result = await api.rejectMemoryCandidate({ id: candidate.id });
          memoryStatus.textContent = result.ok ? '候选已拒绝，不会进入长期记忆。' : result.message;
          if (result.ok) await loadMemories();
        })();
      });
      card.append(evidenceSummary, evidenceList, actions);
      candidateList.append(card);
    }
  };

  const renderMemories = (): void => {
    renderMemoryCandidates();
    memoryList.replaceChildren();
    const selectedType = memoryFilter.value;
    const filtered = selectedType
      ? memoryRecords.filter((memory) => memory.type === selectedType)
      : memoryRecords;
    if (filtered.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = '当前分类还没有长期记忆。你可以在对话中说“记住：……”。';
      memoryList.append(empty);
      return;
    }
    for (const memory of filtered) {
      const card = document.createElement('article');
      card.className = 'memory-card';
      const typeSelect = document.createElement('select');
      for (const type of Object.keys(memoryTypeLabels) as MemoryType[]) {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = memoryTypeLabels[type];
        typeSelect.append(option);
      }
      typeSelect.value = memory.type;
      const content = document.createElement('textarea');
      content.value = memory.content;
      content.maxLength = 1_000;
      content.rows = 2;
      content.setAttribute('aria-label', '记忆内容');
      const metrics = document.createElement('div');
      metrics.className = 'memory-metrics';
      const importance = document.createElement('input');
      importance.type = 'number';
      importance.min = '0';
      importance.max = '1';
      importance.step = '0.05';
      importance.value = memory.importance.toFixed(2);
      importance.setAttribute('aria-label', '重要度');
      const confidence = document.createElement('input');
      confidence.type = 'number';
      confidence.min = '0';
      confidence.max = '1';
      confidence.step = '0.05';
      confidence.value = memory.confidence.toFixed(2);
      confidence.setAttribute('aria-label', '置信度');
      const source = document.createElement('small');
      source.className = 'memory-source';
      const sourceLabel =
        memory.source === 'manual'
          ? '用户主动记住'
          : memory.lastConfirmedAt
            ? '自动提取，经用户确认'
            : '自动提取';
      source.textContent = memory.sourceExcerpt
        ? '来源：' + sourceLabel + ' · ' + memory.sourceExcerpt
        : '来源：' + sourceLabel;
      metrics.append(
        document.createTextNode('重要度 '),
        importance,
        document.createTextNode(' 置信度 '),
        confidence,
      );
      const expirationField = document.createElement('label');
      expirationField.className = 'memory-expiration';
      const expirationLabel = document.createElement('span');
      expirationLabel.textContent = '有效期（可不填）';
      const expiration = document.createElement('input');
      expiration.type = 'datetime-local';
      expiration.value = formatLocalDateTime(memory.expiresAt);
      expirationField.append(expirationLabel, expiration);
      const updateExpirationVisibility = (): void => {
        expirationField.hidden = !['event', 'plan'].includes(typeSelect.value);
        if (expirationField.hidden) expiration.value = '';
      };
      updateExpirationVisibility();
      typeSelect.addEventListener('change', updateExpirationVisibility);
      const actions = document.createElement('div');
      actions.className = 'memory-card__actions';
      const save = createButton('保存修改', 'text-button');
      const remove = createButton('删除', 'text-button danger-button');
      actions.append(save, remove);
      save.addEventListener('click', () => {
        void (async () => {
          if (!api) return;
          if (!content.value.trim()) {
            memoryStatus.textContent = '记忆内容不能为空。';
            return;
          }
          const parsedExpiration = readFutureExpiration(expiration);
          if (!parsedExpiration.ok) {
            memoryStatus.textContent = '有效期必须是将来的时间，或者留空。';
            return;
          }
          const result = await api.updateMemory({
            id: memory.id,
            type: typeSelect.value as MemoryType,
            content: content.value.trim(),
            importance: Number(importance.value),
            confidence: Number(confidence.value),
            ...('expiresAt' in parsedExpiration ? { expiresAt: parsedExpiration.expiresAt } : {}),
          });
          memoryStatus.textContent = result.ok ? '记忆已更新。' : result.message;
          if (result.ok) await loadMemories();
        })();
      });
      remove.addEventListener('click', () => {
        void (async () => {
          if (!api || !window.confirm('确定彻底忘掉这条记忆吗？')) return;
          const result = await api.deleteMemory({ id: memory.id });
          memoryStatus.textContent = result.ok ? '记忆已删除。' : result.message;
          if (result.ok) await loadMemories();
        })();
      });
      card.append(typeSelect, content, metrics, expirationField, source, actions);
      memoryList.append(card);
    }
  };

  const loadMemories = async (): Promise<void> => {
    if (!api) return;
    const [settings, records, candidates] = await Promise.all([
      api.getMemorySettings(),
      api.listMemories(),
      api.listMemoryCandidates(),
    ]);
    automaticMemoryInput.checked = settings.automaticMemoryEnabled;
    semanticIndexSelect.value = settings.semanticIndex;
    relationshipIndexSelect.value = settings.relationshipIndex;
    qdrantUrlInput.value = settings.qdrantUrl;
    qdrantCollectionInput.value = settings.qdrantCollection;
    qdrantApiKeyInput.placeholder = settings.qdrantApiKeySaved ? '已安全保存；留空保留' : '可留空';
    neo4jUrlInput.value = settings.neo4jUrl;
    neo4jDatabaseInput.value = settings.neo4jDatabase;
    neo4jUsernameInput.value = settings.neo4jUsername;
    neo4jPasswordInput.placeholder = settings.neo4jPasswordSaved
      ? '已安全保存；留空保留'
      : '可留空';
    memoryRecords = records;
    memoryCandidates = candidates;
    renderMemories();
  };

  const setGenerating = (generating: boolean): void => {
    input.disabled = generating;
    sendButton.hidden = generating;
    stopButton.hidden = !generating;
  };

  const finishPerformance = async (message?: ConversationMessage): Promise<void> => {
    const controller = getCharacter()?.controller;
    if (!controller) {
      return;
    }
    if (message?.emotion) await controller.respond(message.emotion, message.action);
    await controller.state.set('idle');
  };

  const handleConversationEvent = (event: ConversationEvent): void => {
    if (event.requestId !== activeRequestId) {
      return;
    }
    if (event.type === 'started') {
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
      subtitle.hidden = false;
      subtitle.textContent = activeReply;
      subtitle.scrollTop = subtitle.scrollHeight;
      setReplyStatus('正在回复…');
      void getCharacter()?.controller.state.set('talking');
      return;
    }
    if (event.type === 'completed') {
      subtitle.hidden = false;
      subtitle.textContent = event.assistantMessage.content;
      setReplyStatus('回复完成');
      messages.push(event.assistantMessage);
      renderHistory();
      activeRequestId = undefined;
      setGenerating(false);
      void finishPerformance(event.assistantMessage);
      input.focus();
      return;
    }
    if (event.type === 'cancelled') {
      if (event.assistantMessage) {
        subtitle.hidden = false;
        subtitle.textContent = event.assistantMessage.content;
        messages.push(event.assistantMessage);
        renderHistory();
      }
      setReplyStatus('已停止生成');
      activeRequestId = undefined;
      setGenerating(false);
      void finishPerformance();
      input.focus();
      return;
    }
    subtitle.hidden = !activeReply;
    if (activeReply) subtitle.textContent = activeReply;
    setReplyStatus(errorMessages[event.error.code] ?? event.error.message);
    activeRequestId = undefined;
    setGenerating(false);
    void finishPerformance();
    if (event.error.code === 'configuration' || event.error.code === 'authentication') {
      historyPanel.hidden = true;
      settingsPanel.hidden = false;
      setPanelExpanded(true);
    }
  };

  const disposeConversationListener = api?.onConversationEvent(handleConversationEvent);

  const clearLoreEditor = (): void => {
    loreAliasesInput.value = '';
    loreSourceWorkInput.value = '';
    lorePersonalityInput.value = '';
    loreBackgroundInput.value = '';
    loreRelationshipsInput.value = '';
    loreSpeechStyleInput.value = '';
    loreSampleLinesInput.value = '';
    loreSources = [];
    roleplayExampleSourceIds = new Map();
    loreSourcesOutput.textContent = '';
  };

  const fillLoreEditor = (lore?: CharacterLore): void => {
    clearLoreEditor();
    if (!lore) return;
    loreAliasesInput.value = lore.aliases.join('、');
    loreSourceWorkInput.value = lore.sourceWork;
    lorePersonalityInput.value = lore.personality;
    loreBackgroundInput.value = lore.background;
    loreRelationshipsInput.value = lore.relationships.join('\n');
    loreSpeechStyleInput.value = lore.speechStyle;
    loreSampleLinesInput.value = [
      ...(lore.roleplayExamples ?? []).map((example) =>
        [example.scene, example.emotion, example.trigger, example.attitude, example.line].join(
          '｜',
        ),
      ),
      ...(lore.sampleLines ?? []),
    ].join('\n');
    roleplayExampleSourceIds = new Map(
      (lore.roleplayExamples ?? []).flatMap((example) => {
        if (!example.sourceId) return [];
        const key = [
          example.scene,
          example.emotion,
          example.trigger,
          example.attitude,
          example.line,
        ].join('｜');
        return [[key, example.sourceId]];
      }),
    );
    loreSources = [...lore.sources];
    loreSourcesOutput.textContent = lore.sources.length
      ? `参考来源：${lore.sources.map((source) => `${source.siteName} · ${source.title}`).join('；')}`
      : '';
  };

  const readLoreEditor = (canonicalName: string): CharacterLore | undefined => {
    const aliases = loreAliasesInput.value
      .split(/[、,，]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const relationships = loreRelationshipsInput.value
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    const exampleRows = loreSampleLinesInput.value
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 20);
    const roleplayExamples = exampleRows.flatMap((row) => {
      const parts = row.split(/[|｜]/u).map((part) => part.trim());
      if (parts.length !== 5 || parts.some((part) => !part)) return [];
      const [scene, emotion, trigger, attitude, line] = parts;
      return scene && emotion && trigger && attitude && line
        ? [
            {
              scene,
              emotion,
              trigger,
              attitude,
              line,
              ...(roleplayExampleSourceIds.get(parts.join('｜'))
                ? { sourceId: roleplayExampleSourceIds.get(parts.join('｜')) }
                : {}),
            },
          ]
        : [];
    });
    const sampleLines = exampleRows.filter((row) => !/[|｜]/u.test(row));
    const fields = {
      sourceWork: loreSourceWorkInput.value.trim(),
      personality: lorePersonalityInput.value.trim(),
      background: loreBackgroundInput.value.trim(),
      speechStyle: loreSpeechStyleInput.value.trim(),
    };
    if (
      aliases.length === 0 &&
      relationships.length === 0 &&
      sampleLines.length === 0 &&
      roleplayExamples.length === 0 &&
      loreSources.length === 0 &&
      Object.values(fields).every((v) => !v)
    ) {
      return undefined;
    }
    return {
      canonicalName,
      aliases,
      identity: bioInput.value.trim(),
      relationships,
      sampleLines,
      roleplayExamples,
      ...fields,
      sources: loreSources,
    };
  };

  const setCharacterResearchBusy = (busy: boolean): void => {
    searchCharacterButton.disabled = busy;
    cancelCharacterSearchButton.hidden = !busy;
    characterResearchProgress.hidden = !busy;
    characterSearch.setAttribute('aria-busy', busy ? 'true' : 'false');
    for (const button of characterSearchCandidates.querySelectorAll('button')) {
      button.disabled = busy;
    }
  };

  const renderCharacterCandidates = (candidates: CharacterResearchCandidate[]): void => {
    characterSearchCandidates.replaceChildren();
    if (candidates.length === 0) {
      characterSearchStatus.textContent = '没有找到候选。可以补充作品名后重试，或直接手动填写。';
      return;
    }
    characterSearchStatus.textContent =
      candidates.length === 1
        ? '找到一个高度匹配的角色，点击下方按钮生成扮演设定。'
        : '请选择正确角色，再生成扮演设定。';
    for (const candidate of candidates) {
      const button = createButton('', 'character-candidate');
      const title = document.createElement('strong');
      title.textContent = candidate.name;
      const source = document.createElement('small');
      source.textContent = `${candidate.sourceName} · ${candidate.sourceWork || '作品待确认'}`;
      const description = document.createElement('span');
      description.textContent = candidate.description || candidate.matchReason;
      const reason = document.createElement('small');
      reason.textContent = candidate.matchReason;
      const action = document.createElement('strong');
      action.className = 'character-candidate__action';
      action.textContent = '选择并生成扮演设定 →';
      button.append(title, source, description, reason, action);
      button.addEventListener('click', () => {
        void (async () => {
          if (!api || activeCharacterResearchId) return;
          if (candidate.sourceWork) {
            loreSourceWorkInput.value = candidate.sourceWork;
            await loadGlossaryStatus(candidate.sourceWork);
            void syncWorkGlossarySeparately(candidate.sourceWork, true);
          }
          const requestId = createRequestId('character_draft');
          activeCharacterResearchId = requestId;
          setCharacterResearchBusy(true);
          characterResearchProgress.setAttribute('aria-label', '正在发散查找并整理角色资料');
          characterSearchStatus.textContent = `正在围绕“${candidate.name}”发散查找身份、背景、关系和台词资料，再生成扮演设定…`;
          try {
            const result = await api.buildCharacterDraft({
              requestId,
              candidateId: candidate.id,
            });
            if (activeCharacterResearchId !== requestId) return;
            if (!result.ok) {
              characterSearchStatus.textContent = result.message;
              return;
            }
            characterNameInput.value = result.draft.lore.canonicalName;
            fillLoreEditor(result.draft.lore);
            userNameInput.value = result.draft.profileFields.userDisplayName;
            bioInput.value = result.draft.profileFields.bio;
            personaInput.value = result.draft.profileFields.personaPrompt;
            loreEditor.open = false;
            if (result.draft.warnings.length > 0) {
              action.textContent = '重新整理扮演设定 →';
              characterSearchStatus.textContent = `${result.draft.warnings.join(' ')} 点击“角色设定”展开检查。`;
            } else {
              characterSearchCandidates.replaceChildren();
              characterSearchStatus.textContent =
                '已综合角色资料和台词来源生成扮演设定；点击“角色设定”完整展开，检查后再保存。';
            }
            requestAnimationFrame(() =>
              loreEditor.scrollIntoView({ behavior: 'smooth', block: 'start' }),
            );
          } catch {
            if (activeCharacterResearchId === requestId) {
              characterSearchStatus.textContent = '角色资料读取失败，请稍后重试。';
            }
          } finally {
            if (activeCharacterResearchId === requestId) {
              activeCharacterResearchId = undefined;
              setCharacterResearchBusy(false);
            }
          }
        })();
      });
      characterSearchCandidates.append(button);
    }
  };

  const loadGlossaryStatus = async (sourceWork: string): Promise<void> => {
    if (!api || !sourceWork.trim()) {
      glossaryStatus.textContent = '作品词库只补充专有名词和社区用语，不负责角色说话风格。';
      glossarySources.hidden = true;
      syncGlossaryButton.disabled = true;
      return;
    }
    const status = await api.getWorkGlossaryStatus({ sourceWork });
    syncGlossaryButton.disabled = !status.supported;
    if (!status.supported) {
      glossaryStatus.textContent = '当前作品不需要额外词库；角色语气由已确认的角色资料控制。';
      glossarySources.hidden = true;
      return;
    }
    glossaryStatus.textContent = status.lastSynced
      ? `${status.workName}社区词库使用已同步缓存，共 ${status.entryCount} 条；上次同步：${new Date(status.lastSynced).toLocaleString()}。`
      : status.entryCount > 0
        ? `${status.workName}社区词库有 ${status.entryCount} 条内置校对内容；可点击同步，主动联网搜索更多社区术语。`
        : `${status.workName}还没有本地作品词库；可点击同步，主动联网搜索社区梗、黑话、术语和别名。`;
    const sourceLabels = status.sources.map((source) => `${source.siteName} · ${source.title}`);
    glossarySources.open = false;
    glossarySources.hidden = sourceLabels.length === 0;
    glossarySourcesPreview.textContent = sourceLabels.length
      ? `词库来源：${sourceLabels.slice(0, 6).join('；')}${sourceLabels.length > 6 ? '……' : ''}`
      : '';
    glossarySourcesFull.textContent = sourceLabels.length
      ? `全部来源：${sourceLabels.join('；')}`
      : '';
  };

  const syncWorkGlossarySeparately = async (
    sourceWork: string,
    automatic: boolean,
  ): Promise<void> => {
    if (!api) return;
    const work = sourceWork.normalize('NFKC').trim();
    if (!work) return;
    const workKey = work.toLocaleLowerCase();
    if (
      activeGlossarySyncWork === workKey ||
      (automatic && automaticallyRequestedGlossaryWorks.has(workKey))
    ) {
      return;
    }
    activeGlossarySyncWork = workKey;
    if (automatic) automaticallyRequestedGlossaryWorks.add(workKey);
    syncGlossaryButton.disabled = true;
    glossaryStatus.textContent = `正在单独联网搜索“${work}”的社区词库；不会占用角色整理的模型上下文…`;
    try {
      const result = await api.syncWorkGlossary({ sourceWork: work });
      glossaryStatus.textContent = result.message;
      if (result.ok && loreSourceWorkInput.value.trim() === work) {
        await loadGlossaryStatus(work);
      } else if (!result.ok && automatic) {
        automaticallyRequestedGlossaryWorks.delete(workKey);
      }
    } catch {
      glossaryStatus.textContent = '作品词库联网同步失败；角色资料查找仍可继续。';
      if (automatic) automaticallyRequestedGlossaryWorks.delete(workKey);
    } finally {
      if (activeGlossarySyncWork === workKey) {
        activeGlossarySyncWork = undefined;
        syncGlossaryButton.disabled = !loreSourceWorkInput.value.trim();
      }
    }
  };

  const runCharacterSearch = async (): Promise<void> => {
    if (!api || activeCharacterResearchId) return;
    const name = characterNameInput.value.trim();
    if (!name) {
      characterSearchStatus.textContent = '请先填写角色名称。';
      return;
    }
    const sourceWork = loreSourceWorkInput.value.trim();
    if (
      !(await confirmAction({
        title: '联网查找角色',
        message: sourceWork ? `查找“${name}”（${sourceWork}）？` : `查找“${name}”？`,
        details:
          '角色名和已填写的作品名会发送给公开资料站点；作品留空时会从候选页正文识别。作品词库会作为另一条独立网络任务同步，不与角色整理共用模型上下文。查找结果只会生成本地草稿，点击总设置的“保存”后才会生效。',
        confirmLabel: '开始查找',
      }))
    ) {
      return;
    }
    const requestId = createRequestId('character_search');
    activeCharacterResearchId = requestId;
    setCharacterResearchBusy(true);
    characterResearchProgress.setAttribute('aria-label', '正在查询公开角色资料');
    characterSearchCandidates.replaceChildren();
    characterSearchStatus.textContent = '正在查询公开角色资料…';
    if (sourceWork) void syncWorkGlossarySeparately(sourceWork, true);
    try {
      const result = await api.searchCharacters({
        requestId,
        name,
        sourceWork,
      });
      if (activeCharacterResearchId !== requestId) return;
      if (!result.ok) {
        characterSearchStatus.textContent = result.message;
        return;
      }
      renderCharacterCandidates(result.candidates);
      const inferredGlossaryWork = resolveAutomaticGlossarySourceWork(
        sourceWork,
        result.candidates,
      );
      if (!sourceWork && inferredGlossaryWork) {
        void syncWorkGlossarySeparately(inferredGlossaryWork, true);
      }
    } catch {
      if (activeCharacterResearchId === requestId) {
        characterSearchStatus.textContent = '联网查询失败，请检查网络后重试。';
      }
    } finally {
      if (activeCharacterResearchId === requestId) {
        activeCharacterResearchId = undefined;
        setCharacterResearchBusy(false);
      }
    }
  };

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
    for (const key of settings.inputOverlayKeys) {
      const element = document.createElement('kbd');
      element.className = 'input-overlay__key';
      element.textContent = key;
      element.dataset.key = key;
      inputOverlayKeyElements.set(key, element);
      inputOverlayKeys.append(element);
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
    const overlays: Record<DesktopWidgetId, HTMLElement> = {
      input: inputOverlay,
      media: mediaOverlay,
    };
    for (const widget of widgetOrder) {
      desktopOverlayStack.append(overlays[widget]);
    }
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
    displayInputOverlay(desktopStatus.settings, desktopStatus.inputOverlayActive);
    displayMediaOverlay(desktopStatus);
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
    ] = await Promise.all([
      api.getProviderConfiguration(),
      api.getConversationConfiguration(),
      api.getCharacterProfile(),
      api.getWindowScale(),
      api.getDesktopIntegrationStatus(),
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
    if (!modelId) {
      statusTarget.textContent = '请填写模型名称。';
      return false;
    }
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
      api.setConversationConfiguration({ selection: { providerId, modelId } }),
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
    apiKeyInput.value = '';
    remoteApiKeyInput.value = '';
    statusTarget.textContent = '已保存。';
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

  clearLoreButton.addEventListener('click', () => {
    clearLoreEditor();
    settingsStatus.textContent = '角色扮演资料已清空；点击“保存”后生效。';
  });
  searchCharacterButton.addEventListener('click', () => void runCharacterSearch());
  syncGlossaryButton.addEventListener('click', () => {
    void (async () => {
      if (!api) return;
      const sourceWork = loreSourceWorkInput.value.trim();
      if (!sourceWork) {
        glossaryStatus.textContent = '请先填写来源作品。';
        return;
      }
      if (
        !(await confirmAction({
          title: '同步作品词库',
          message: `将同步“${sourceWork}”的社区词库。`,
          details:
            '会主动搜索公开网页，核对社区梗、黑话、术语和别名后更新本地缓存；普通聊天不会因此自动联网。',
          confirmLabel: '开始同步',
        }))
      ) {
        return;
      }
      syncGlossaryButton.disabled = true;
      await syncWorkGlossarySeparately(sourceWork, false);
    })();
  });
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
  cancelCharacterSearchButton.addEventListener('click', () => {
    if (!api || !activeCharacterResearchId) return;
    const requestId = activeCharacterResearchId;
    activeCharacterResearchId = undefined;
    setCharacterResearchBusy(false);
    characterSearchStatus.textContent = '已取消查找。';
    void api.cancelCharacterResearch({ requestId });
  });
  characterNameInput.addEventListener('change', () => {
    if (characterNameInput.value.trim() && characterNameInput.value.trim() !== '桌宠') {
      characterSearchStatus.textContent = '要联网查找这个角色吗？填写作品名会更准确。';
    }
  });
  loreSourceWorkInput.addEventListener('change', () => {
    void loadGlossaryStatus(loreSourceWorkInput.value.trim());
  });

  memoryButton.addEventListener('click', () => {
    setPanelExpanded(true, 'chat');
    const willOpen = memoryPanel.hidden;
    closeDrawers();
    memoryPanel.hidden = !willOpen;
    if (willOpen) {
      memoryStatus.textContent = '正在读取本地记忆…';
      void loadMemories()
        .then(() => {
          memoryStatus.textContent =
            memoryRecords.length + ' 条已确认，' + memoryCandidates.length + ' 条待确认。';
        })
        .catch(() => {
          memoryStatus.textContent = '无法读取本地记忆。';
        });
    }
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
    const willOpen = widgetsPanel.hidden;
    closeDrawers();
    widgetsPanel.hidden = !willOpen;
    setPanelExpanded(true, 'chat');
    if (willOpen) showWidgetView('catalog');
    if (willOpen && api) {
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
      void loadWindowScale();
      if (loreEditor.open) resizeLoreTextareas();
    }
  });
  closeHistoryButton.addEventListener('click', closeDrawers);
  closeMemoryButton.addEventListener('click', closeDrawers);
  closeDebugButton.addEventListener('click', closeDrawers);
  closeWidgetsButton.addEventListener('click', closeDrawers);
  closeSettingsButton.addEventListener('click', closeDrawers);
  launcherButton.addEventListener('click', () => {
    void showOpeningLineIfReady();
    setPanelExpanded(true, 'chat');
  });
  collapseButton.addEventListener('click', () => {
    closeDrawers();
    setPanelExpanded(false);
  });
  memoryFilter.addEventListener('change', renderMemories);
  automaticMemoryInput.addEventListener('change', () => {
    if (!api) return;
    void api
      .setMemorySettings({
        automaticMemoryEnabled: automaticMemoryInput.checked,
        semanticIndex: semanticIndexSelect.value as 'local' | 'qdrant',
        relationshipIndex: relationshipIndexSelect.value as 'local' | 'neo4j',
        qdrantUrl: qdrantUrlInput.value,
        qdrantCollection: qdrantCollectionInput.value,
        neo4jUrl: neo4jUrlInput.value,
        neo4jDatabase: neo4jDatabaseInput.value,
        neo4jUsername: neo4jUsernameInput.value,
      })
      .then((result) => {
        memoryStatus.textContent = result.ok
          ? automaticMemoryInput.checked
            ? '自动提取已开启；每累计约 10 轮在后台处理。'
            : '自动提取已关闭；主动“记住”仍然有效。'
          : result.message;
      });
  });
  saveMemoryIndexesButton.addEventListener('click', () => {
    void (async () => {
      if (!api) return;
      memoryStatus.textContent = '正在保存混合记忆索引设置…';
      const result = await api.setMemorySettings({
        automaticMemoryEnabled: automaticMemoryInput.checked,
        semanticIndex: semanticIndexSelect.value as 'local' | 'qdrant',
        relationshipIndex: relationshipIndexSelect.value as 'local' | 'neo4j',
        qdrantUrl: qdrantUrlInput.value.trim(),
        qdrantCollection: qdrantCollectionInput.value.trim(),
        ...(qdrantApiKeyInput.value ? { qdrantApiKey: qdrantApiKeyInput.value } : {}),
        neo4jUrl: neo4jUrlInput.value.trim(),
        neo4jDatabase: neo4jDatabaseInput.value.trim(),
        neo4jUsername: neo4jUsernameInput.value.trim(),
        ...(neo4jPasswordInput.value ? { neo4jPassword: neo4jPasswordInput.value } : {}),
      });
      memoryStatus.textContent = result.ok
        ? '混合记忆索引设置已保存；连接失败时会自动回退关键词。'
        : result.message;
      if (result.ok) {
        qdrantApiKeyInput.value = '';
        neo4jPasswordInput.value = '';
        await loadMemories();
      }
    })();
  });
  exportMemoryButton.addEventListener('click', () => {
    if (!api) return;
    void api.exportMemories().then((result) => {
      memoryStatus.textContent = result.ok
        ? result.canceled
          ? '已取消导出。'
          : '记忆 JSON 已导出。'
        : result.message;
    });
  });
  backupMemoryButton.addEventListener('click', () => {
    if (!api) return;
    void api.backupMemory().then((result) => {
      memoryStatus.textContent = result.ok
        ? result.canceled
          ? '已取消备份。'
          : '本地数据库已备份。'
        : result.message;
    });
  });
  clearMemoriesButton.addEventListener('click', () => {
    void (async () => {
      if (!api || !window.confirm('确定清空全部长期记忆吗？此操作无法撤销，对话历史不会被清空。')) {
        return;
      }
      const result = await api.clearMemories();
      memoryStatus.textContent = result.ok ? '全部长期记忆已清空。' : result.message;
      if (result.ok) await loadMemories();
    })();
  });
  importCharacterButton.addEventListener('click', () => {
    void (async () => {
      if (!api) return;
      characterLibraryStatus.textContent = '正在检查角色包…';
      const result = await api.previewCharacterPackage();
      if (!result.ok) {
        characterLibraryStatus.textContent = result.message;
        return;
      }
      if (result.canceled || !result.preview) {
        characterLibraryStatus.textContent = '已取消导入。';
        return;
      }
      const preview = result.preview;
      if (preview.conflict === 'blocked') {
        characterLibraryStatus.textContent =
          '角色 ID、包 ID 或记忆命名空间与其他角色冲突，不能导入。';
        return;
      }
      const attribution = preview.attribution.length
        ? preview.attribution
            .map((item) => `${item.title}：${item.licenseNote || '未提供额外许可说明'}`)
            .join('\n')
        : '未附署名；请确认你有权使用和分发其中的角色及模型素材。';
      const confirmed = await confirmAction({
        title: preview.conflict === 'replace' ? '替换已有角色包' : '导入角色包',
        message: `角色：${preview.characterName}${preview.sourceWork ? `（${preview.sourceWork}）` : ''}\n素材：${preview.assetCount} 项，约 ${Math.ceil(preview.uncompressedBytes / 1024)} KiB${preview.hasLive2DModel ? '，含 Live2D 模型' : ''}`,
        details: `${attribution}\n\n角色包不会导入聊天、长期记忆或 API Key。`,
        confirmLabel: preview.conflict === 'replace' ? '确认替换' : '确认导入',
      });
      if (!confirmed) {
        characterLibraryStatus.textContent = '已取消导入。';
        return;
      }
      const imported = await api.confirmCharacterPackageImport({
        previewId: preview.previewId,
        replaceExisting: preview.conflict === 'replace',
      });
      if (!imported.ok) {
        characterLibraryStatus.textContent = imported.message;
        return;
      }
      await refreshActiveCharacter();
      characterLibraryStatus.textContent = `“${preview.characterName}”已导入并切换。`;
    })();
  });
  exportCharacterButton.addEventListener('click', () => {
    void (async () => {
      if (!api) return;
      characterLibraryStatus.textContent = '正在生成不含私人数据的角色包…';
      const result = await api.exportActiveCharacterPackage();
      characterLibraryStatus.textContent = result.ok
        ? result.canceled
          ? '已取消导出。'
          : '角色包已导出；聊天、记忆和 API Key 未写入。'
        : result.message;
    })();
  });
  providerSelect.addEventListener('change', () => {
    updateProviderVisibility();
    remoteApiKeyInput.value = '';
    connectionStatus.textContent = '';
    void updateSecretStatus();
  });
  allowRemoteComplexTasksInput.addEventListener('change', () => {
    updateCollaborationVisibility();
    void updateSecretStatus();
  });
  remoteProviderSelect.addEventListener('change', () => {
    remoteApiKeyInput.value = '';
    void updateSecretStatus();
  });
  modelInput.addEventListener('input', () => {
    connectionStatus.textContent = '';
  });
  baseUrlInput.addEventListener('input', () => {
    connectionStatus.textContent = '';
  });
  apiKeyInput.addEventListener('input', () => {
    connectionStatus.textContent = '';
  });
  scaleInput.addEventListener('input', () => windowScaleSync?.preview(Number(scaleInput.value)));
  scaleInput.addEventListener('change', () => {
    void windowScaleSync?.commit(Number(scaleInput.value));
  });
  settingsPanel.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveSettings();
  });
  testButton.addEventListener('click', () => {
    void (async () => {
      if (!api || !(await saveSettings(connectionStatus, false))) {
        return;
      }
      connectionStatus.textContent = '正在测试连接…';
      testButton.disabled = true;
      const requestId = createRequestId('test');
      try {
        const result = await api.testProviderConnection({
          requestId,
          providerId: providerSelect.value as ConfigurableProviderId,
          modelId: modelInput.value.trim(),
        });
        connectionStatus.textContent = result.ok
          ? `连接成功，约 ${result.latencyMs} ms。`
          : errorMessages[result.error.code];
      } catch {
        connectionStatus.textContent = '连接测试失败，请检查配置后重试。';
      } finally {
        testButton.disabled = false;
      }
    })();
  });
  deleteSecretButton.addEventListener('click', () => {
    void (async () => {
      if (!api || !window.confirm('确定删除当前提供商已保存的 API Key 吗？')) {
        return;
      }
      const providerId = providerSelect.value as ConfigurableProviderId;
      const result = await api.deleteProviderSecret({ providerId });
      settingsStatus.textContent = result.ok ? '密钥已删除。' : result.error.message;
      await updateSecretStatus();
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
        subtitle.hidden = true;
        subtitle.textContent = '';
        setReplyStatus('对话已清空');
        renderHistory();
      }
    })();
  });
  stopButton.addEventListener('click', () => {
    if (api && activeRequestId) {
      stopButton.disabled = true;
      void api.cancelConversation({ requestId: activeRequestId }).finally(() => {
        stopButton.disabled = false;
      });
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });
  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!api || !message || activeRequestId) {
      return;
    }
    closeDrawers();
    activeRequestId = createRequestId('chat');
    openingLineGeneration += 1;
    activeReply = '';
    input.value = '';
    subtitle.hidden = false;
    subtitle.textContent = '';
    setReplyStatus('正在思考…');
    setGenerating(true);
    void getCharacter()?.controller.state.set('thinking');
    const requestId = activeRequestId;
    void api
      .startConversation({
        requestId,
        message,
        availableActions: getCharacter()?.availableActions ?? [],
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
  });

  if (api) {
    try {
      const [loadedMessages, loadedMemories] = await Promise.all([
        api.getConversationHistory(),
        api.listMemories().catch(() => []),
        loadSettings(),
      ]);
      messages = loadedMessages;
      memoryRecords = loadedMemories;
      renderHistory();
      updateIdentity();
      void showOpeningLineIfReady();
    } catch {
      subtitle.hidden = false;
      subtitle.textContent = '无法读取本地对话设置。';
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
    if (api && activeCharacterResearchId) {
      void api.cancelCharacterResearch({ requestId: activeCharacterResearchId });
    }
    disposeConversationListener?.();
    disposeDesktopInputActivity?.();
    clearInputOverlayTimers();
    window.clearInterval(mediaStatusRefreshTimer);
    loreEditorResizeObserver.disconnect();
    windowScaleSync?.dispose();
    window.removeEventListener('deskpet:character-loaded', handleCharacterLoaded);
    if (panelExpanded) void api?.setChatPanelExpanded({ expanded: false });
    shell.remove();
    desktopOverlayStack.remove();
  };
};
