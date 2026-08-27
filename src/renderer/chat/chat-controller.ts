import type { CharacterLore } from '../../core/character/character-lore';
import type { CharacterResearchCandidate } from '../../core/character/character-research';
import {
  DEFAULT_CHARACTER_PROFILE,
  type CharacterProfile,
} from '../../core/conversation/character-profile';
import { resolveCharacterDisplayName } from '../../core/conversation/character-identity';
import type { PublicLlmError } from '../../core/llm/contracts';
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
import type { ConversationEvent, ConversationMessage } from '../../shared/conversation-ipc';
import { MAX_WINDOW_SCALE, MIN_WINDOW_SCALE } from '../../shared/window-ipc';
import type { LoadedCharacter } from '../live2d/character-runtime';

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
  const historyButton = createButton('历史', 'chat-toolbar__button');
  const memoryButton = createButton('记忆', 'chat-toolbar__button');
  const settingsButton = createButton('设置', 'chat-toolbar__button');
  toolbar.append(historyButton, memoryButton, settingsButton);

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
    candidateTitle,
    candidateList,
    confirmedMemoryTitle,
    memoryList,
  );

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
  scaleInput.step = '0.05';
  scaleInput.value = '1';
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
  const apiKeyInput = document.createElement('input');
  apiKeyInput.type = 'password';
  apiKeyInput.maxLength = 32_768;
  apiKeyInput.autocomplete = 'off';
  apiKeyInput.placeholder = '留空则保留现有密钥';
  const characterNameInput = document.createElement('input');
  characterNameInput.maxLength = 80;
  characterNameInput.autocomplete = 'off';
  const loreSourceWorkInput = document.createElement('input');
  loreSourceWorkInput.maxLength = 300;
  loreSourceWorkInput.placeholder = '例如：明日方舟（填写后搜索更准确）';
  const characterSearch = document.createElement('section');
  characterSearch.className = 'character-search';
  const characterSearchStatus = document.createElement('p');
  characterSearchStatus.className = 'settings-status';
  characterSearchStatus.setAttribute('role', 'status');
  characterSearchStatus.textContent = '可以联网查找公开资料；结果需要你确认后才会保存。';
  const characterSearchCandidates = document.createElement('div');
  characterSearchCandidates.className = 'character-search__candidates';
  const characterSearchActions = document.createElement('div');
  characterSearchActions.className = 'settings-actions';
  const cancelCharacterSearchButton = createButton('取消查找', 'text-button');
  cancelCharacterSearchButton.hidden = true;
  const searchCharacterButton = createButton('联网查找', 'secondary-button');
  characterSearchActions.append(cancelCharacterSearchButton, searchCharacterButton);
  characterSearch.append(characterSearchStatus, characterSearchCandidates, characterSearchActions);
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
    createField('角色名称', characterNameInput),
    createField('来源作品或游戏', loreSourceWorkInput),
    characterSearch,
    glossaryPanel,
    loreEditor,
    settingsStatus,
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

  panel.append(panelHeader, subtitle, composer, toolbar, historyPanel, memoryPanel, settingsPanel);
  shell.append(launcherButton, panel);
  root.append(shell, actionDialog);

  let messages: ConversationMessage[] = [];
  let memoryRecords: MemoryRecord[] = [];
  let memoryCandidates: MemoryCandidateRecord[] = [];
  let profile: CharacterProfile | undefined;
  let loreSources: CharacterLore['sources'] = [];
  let roleplayExampleSourceIds = new Map<string, string>();
  let activeCharacterResearchId: string | undefined;
  let activeRequestId: string | undefined;
  let activeReply = '';
  let panelExpanded = false;
  let replyStateLabel = '随时可以开始聊天';

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

  const loadWindowScale = async (): Promise<void> => {
    if (api) displayScale(await api.getWindowScale());
  };
  const disposeWindowScaleListener = api?.onWindowScaleChanged(displayScale);

  const characterDisplayName = (): string =>
    resolveCharacterDisplayName(profile?.name, getCharacter()?.name);

  const setReplyStatus = (label: string): void => {
    replyStateLabel = label;
    replyStatus.textContent = `${characterDisplayName()} · ${label}`;
  };

  const updateIdentity = (): void => {
    const name = characterDisplayName();
    replyAuthor.textContent = name;
    input.placeholder = '说点什么吧......';
    setReplyStatus(replyStateLabel);
    renderHistory();
  };

  const setPanelExpanded = (expanded: boolean): void => {
    if (panelExpanded === expanded) return;
    panelExpanded = expanded;
    shell.classList.toggle('chat-shell--expanded', expanded);
    root.classList.toggle('chat-expanded', expanded);
    launcherButton.setAttribute('aria-expanded', String(expanded));
    void api?.setChatPanelExpanded({ expanded });
    if (expanded) requestAnimationFrame(() => input.focus());
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 240);
  };

  const updateProviderVisibility = (): void => {
    baseUrlField.hidden = providerSelect.value !== 'openai-compatible';
  };

  const updateSecretStatus = async (): Promise<void> => {
    if (!api) {
      return;
    }
    const secrets = await api.getProviderSecretStatus();
    const selected = providerSelect.value as 'anthropic' | 'openai-compatible';
    deleteSecretButton.hidden = !secrets[selected];
    secretStatus.textContent = secrets[selected]
      ? '已安全保存密钥；留空不会覆盖。'
      : selected === 'openai-compatible'
        ? '未保存密钥；本地 Ollama 可保持为空。'
        : '尚未保存密钥。';
  };

  const closeDrawers = (): void => {
    historyPanel.hidden = true;
    memoryPanel.hidden = true;
    settingsPanel.hidden = true;
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
    if (message?.emotion) {
      await controller.emotion.set(message.emotion);
    }
    if (message?.action) {
      void controller.action.enqueue(message.action);
    }
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
          const requestId = createRequestId('character_draft');
          activeCharacterResearchId = requestId;
          setCharacterResearchBusy(true);
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
            loreEditor.open = true;
            if (result.draft.warnings.length > 0) {
              action.textContent = '重新整理扮演设定 →';
              characterSearchStatus.textContent = result.draft.warnings.join(' ');
            } else {
              characterSearchCandidates.replaceChildren();
              characterSearchStatus.textContent =
                '已综合角色资料和台词来源生成完整扮演设定，请检查后点击“保存”。';
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
          '角色名和作品名会发送给公开资料站点。查找结果只会生成本地草稿，点击总设置的“保存”后才会生效。',
        confirmLabel: '开始查找',
      }))
    ) {
      return;
    }
    const requestId = createRequestId('character_search');
    activeCharacterResearchId = requestId;
    setCharacterResearchBusy(true);
    characterSearchCandidates.replaceChildren();
    characterSearchStatus.textContent = '正在查询公开角色资料…';
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

  const loadSettings = async (): Promise<void> => {
    if (!api) {
      settingsStatus.textContent = '桌面 API 不可用。';
      return;
    }
    const [providerConfiguration, conversationConfiguration, storedProfile, windowScale] =
      await Promise.all([
        api.getProviderConfiguration(),
        api.getConversationConfiguration(),
        api.getCharacterProfile(),
        api.getWindowScale(),
      ]);
    profile = storedProfile;
    providerSelect.value = conversationConfiguration.selection?.providerId ?? 'anthropic';
    updateProviderVisibility();
    modelInput.value = conversationConfiguration.selection?.modelId ?? '';
    baseUrlInput.value = providerConfiguration.openAICompatibleBaseUrl;
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
    updateIdentity();
    await updateSecretStatus();
  };

  const saveSettings = async (): Promise<boolean> => {
    if (!api || !profile) {
      return false;
    }
    const providerId = providerSelect.value as 'anthropic' | 'openai-compatible';
    const modelId = modelInput.value.trim();
    if (!modelId) {
      settingsStatus.textContent = '请填写模型名称。';
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
    settingsStatus.textContent = '正在保存…';
    const operations = await Promise.all([
      providerId === 'openai-compatible'
        ? api.setProviderConfiguration({ openAICompatibleBaseUrl: baseUrlInput.value.trim() })
        : Promise.resolve({ ok: true } as const),
      api.setConversationConfiguration({ selection: { providerId, modelId } }),
      api.setCharacterProfile(updatedProfile),
      apiKeyInput.value.trim()
        ? api.setProviderSecret({ providerId, apiKey: apiKeyInput.value })
        : Promise.resolve({ ok: true } as const),
    ]);
    const failed = operations.find((result) => !result.ok);
    if (failed && !failed.ok) {
      settingsStatus.textContent = failed.error.message;
      return false;
    }
    profile = updatedProfile;
    updateIdentity();
    apiKeyInput.value = '';
    settingsStatus.textContent = '已保存。';
    await loadSettings();
    messages = await api.getConversationHistory();
    renderHistory();
    return true;
  };

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
      glossaryStatus.textContent = '正在联网搜索并核对多个公开来源…';
      const result = await api.syncWorkGlossary({ sourceWork });
      glossaryStatus.textContent = result.message;
      if (result.ok) await loadGlossaryStatus(sourceWork);
      else syncGlossaryButton.disabled = false;
    })();
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
    setPanelExpanded(true);
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
    setPanelExpanded(true);
    const willOpen = historyPanel.hidden;
    closeDrawers();
    historyPanel.hidden = !willOpen;
    if (willOpen) {
      renderHistory();
    }
  });
  settingsButton.addEventListener('click', () => {
    setPanelExpanded(true);
    const willOpen = settingsPanel.hidden;
    closeDrawers();
    settingsPanel.hidden = !willOpen;
    if (willOpen) void loadWindowScale();
  });
  closeHistoryButton.addEventListener('click', closeDrawers);
  closeMemoryButton.addEventListener('click', closeDrawers);
  closeSettingsButton.addEventListener('click', closeDrawers);
  launcherButton.addEventListener('click', () => setPanelExpanded(true));
  collapseButton.addEventListener('click', () => {
    closeDrawers();
    setPanelExpanded(false);
  });
  memoryFilter.addEventListener('change', renderMemories);
  automaticMemoryInput.addEventListener('change', () => {
    if (!api) return;
    void api
      .setMemorySettings({ automaticMemoryEnabled: automaticMemoryInput.checked })
      .then((result) => {
        memoryStatus.textContent = result.ok
          ? automaticMemoryInput.checked
            ? '自动提取已开启；每累计约 10 轮在后台处理。'
            : '自动提取已关闭；主动“记住”仍然有效。'
          : result.message;
      });
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
  providerSelect.addEventListener('change', () => {
    updateProviderVisibility();
    void updateSecretStatus();
  });
  scaleInput.addEventListener('input', () => displayScale(Number(scaleInput.value)));
  scaleInput.addEventListener('change', () => {
    if (!api) return;
    void api
      .setWindowScale({ scale: Number(scaleInput.value) })
      .then((appliedScale) => displayScale(appliedScale));
  });
  settingsPanel.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveSettings();
  });
  testButton.addEventListener('click', () => {
    void (async () => {
      if (!api || !(await saveSettings())) {
        return;
      }
      settingsStatus.textContent = '正在测试连接…';
      const requestId = createRequestId('test');
      const result = await api.testProviderConnection({
        requestId,
        providerId: providerSelect.value as 'anthropic' | 'openai-compatible',
        modelId: modelInput.value.trim(),
      });
      settingsStatus.textContent = result.ok
        ? `连接成功，约 ${result.latencyMs} ms。`
        : errorMessages[result.error.code];
    })();
  });
  deleteSecretButton.addEventListener('click', () => {
    void (async () => {
      if (!api || !window.confirm('确定删除当前提供商已保存的 API Key 吗？')) {
        return;
      }
      const providerId = providerSelect.value as 'anthropic' | 'openai-compatible';
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
      [messages] = await Promise.all([api.getConversationHistory(), loadSettings()]);
      renderHistory();
      updateIdentity();
    } catch {
      subtitle.hidden = false;
      subtitle.textContent = '无法读取本地对话设置。';
    }
  } else {
    input.disabled = true;
    sendButton.disabled = true;
    input.placeholder = '请在 Electron 桌面应用中使用对话。';
  }

  const handleCharacterLoaded = (): void => updateIdentity();
  window.addEventListener('deskpet:character-loaded', handleCharacterLoaded);

  return () => {
    if (api && activeCharacterResearchId) {
      void api.cancelCharacterResearch({ requestId: activeCharacterResearchId });
    }
    disposeConversationListener?.();
    disposeWindowScaleListener?.();
    window.removeEventListener('deskpet:character-loaded', handleCharacterLoaded);
    if (panelExpanded) void api?.setChatPanelExpanded({ expanded: false });
    shell.remove();
  };
};
