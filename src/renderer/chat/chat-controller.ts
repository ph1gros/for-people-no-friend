import type { CharacterLore } from '../../core/character/character-lore';
import type { CharacterResearchCandidate } from '../../core/character/character-research';
import type { CharacterProfile } from '../../core/conversation/character-profile';
import { resolveCharacterDisplayName } from '../../core/conversation/character-identity';
import type { PublicLlmError } from '../../core/llm/contracts';
import type { MemoryRecord, MemoryType } from '../../core/memory/contracts';
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
  input.placeholder = '和桌宠说点什么…';
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
  const memoryList = document.createElement('div');
  memoryList.className = 'memory-list';
  memoryPanel.append(memoryHeader, memoryControls, memoryStatus, memoryList);

  const settingsPanel = document.createElement('form');
  settingsPanel.className = 'chat-drawer settings-panel';
  settingsPanel.hidden = true;
  const settingsHeader = document.createElement('header');
  settingsHeader.className = 'chat-drawer__header';
  const settingsTitle = document.createElement('strong');
  settingsTitle.textContent = '模型与人格';
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
  glossaryStatus.textContent = '填写来源作品后，可查看是否有对应的社区词库。';
  const glossarySources = document.createElement('small');
  glossarySources.className = 'character-lore__sources';
  const syncGlossaryButton = createButton('同步作品词库', 'secondary-button');
  const glossaryActions = document.createElement('div');
  glossaryActions.className = 'settings-actions';
  glossaryActions.append(syncGlossaryButton);
  glossaryPanel.append(glossaryStatus, glossarySources, glossaryActions);
  const loreEditor = document.createElement('details');
  loreEditor.className = 'character-lore';
  const loreSummary = document.createElement('summary');
  loreSummary.textContent = '角色扮演资料（可选，保存在本地）';
  const loreHint = document.createElement('p');
  loreHint.className = 'settings-status';
  loreHint.textContent = '可以修改联网草稿或完全自行填写；点击总设置的“保存”后才生效。';
  const loreAliasesInput = document.createElement('input');
  loreAliasesInput.maxLength = 2_000;
  loreAliasesInput.placeholder = '用顿号分隔，例如：昵称、别称';
  const loreIdentityInput = document.createElement('textarea');
  loreIdentityInput.maxLength = 1_000;
  loreIdentityInput.rows = 2;
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
  loreSpeechStyleInput.placeholder = '对用户的称呼、语气、句式、惯用词、情绪表达和短台词示例';
  const loreSourcesOutput = document.createElement('small');
  loreSourcesOutput.className = 'character-lore__sources';
  const clearLoreButton = createButton('清空详细资料', 'text-button danger-button');
  const loreActions = document.createElement('div');
  loreActions.className = 'settings-actions';
  loreActions.append(clearLoreButton);
  loreEditor.append(
    loreSummary,
    loreHint,
    createField('别名', loreAliasesInput),
    createField('身份', loreIdentityInput),
    createField('性格', lorePersonalityInput),
    createField('背景资料', loreBackgroundInput),
    createField('重要关系', loreRelationshipsInput),
    createField('称呼与说话方式', loreSpeechStyleInput),
    loreSourcesOutput,
    loreActions,
  );
  const userNameInput = document.createElement('input');
  userNameInput.maxLength = 80;
  const bioInput = document.createElement('textarea');
  bioInput.maxLength = 2_000;
  bioInput.rows = 2;
  const personaInput = document.createElement('textarea');
  personaInput.maxLength = 16_000;
  personaInput.rows = 5;

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
  const saveButton = createButton('保存', 'primary-button');
  saveButton.type = 'submit';
  settingsActions.append(testButton, saveButton);
  settingsPanel.append(
    settingsHeader,
    scaleField,
    createField('提供商', providerSelect),
    createField('模型名称', modelInput),
    createField('兼容接口地址', baseUrlInput),
    createField('API Key', apiKeyInput),
    secretRow,
    createField('角色名称', characterNameInput),
    createField('来源作品或游戏', loreSourceWorkInput),
    characterSearch,
    glossaryPanel,
    loreEditor,
    createField('对用户的称呼', userNameInput),
    createField('角色简介', bioInput),
    createField('人格提示词', personaInput),
    settingsStatus,
    settingsActions,
  );

  panel.append(panelHeader, subtitle, composer, toolbar, historyPanel, memoryPanel, settingsPanel);
  shell.append(launcherButton, panel);
  root.append(shell);

  let messages: ConversationMessage[] = [];
  let memoryRecords: MemoryRecord[] = [];
  let profile: CharacterProfile | undefined;
  let loreSources: CharacterLore['sources'] = [];
  let activeCharacterResearchId: string | undefined;
  let activeRequestId: string | undefined;
  let activeReply = '';
  let panelExpanded = false;
  let replyStateLabel = '随时可以开始聊天';

  const displayScale = (scale: number): void => {
    scaleInput.value = scale.toFixed(2);
    scaleOutput.textContent = `${Math.round(scale * 100)}%`;
  };

  const loadWindowScale = async (): Promise<void> => {
    if (api) displayScale(await api.getWindowScale());
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
    input.placeholder = `和${name}说点什么…`;
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

  const renderMemories = (): void => {
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
      source.textContent = memory.sourceExcerpt
        ? '来源：' +
          (memory.source === 'manual' ? '用户主动记住' : '自动提取') +
          ' · ' +
          memory.sourceExcerpt
        : '来源：' + (memory.source === 'manual' ? '用户主动记住' : '自动提取');
      metrics.append(
        document.createTextNode('重要度 '),
        importance,
        document.createTextNode(' 置信度 '),
        confidence,
      );
      const actions = document.createElement('div');
      actions.className = 'memory-card__actions';
      const save = createButton('保存修改', 'text-button');
      const remove = createButton('删除', 'text-button danger-button');
      actions.append(save, remove);
      save.addEventListener('click', () => {
        void (async () => {
          if (!api) return;
          const result = await api.updateMemory({
            id: memory.id,
            type: typeSelect.value as MemoryType,
            content: content.value.trim(),
            importance: Number(importance.value),
            confidence: Number(confidence.value),
            ...(memory.expiresAt ? { expiresAt: memory.expiresAt } : {}),
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
      card.append(typeSelect, content, metrics, source, actions);
      memoryList.append(card);
    }
  };

  const loadMemories = async (): Promise<void> => {
    if (!api) return;
    const [settings, records] = await Promise.all([api.getMemorySettings(), api.listMemories()]);
    automaticMemoryInput.checked = settings.automaticMemoryEnabled;
    memoryRecords = records;
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
    loreIdentityInput.value = '';
    lorePersonalityInput.value = '';
    loreBackgroundInput.value = '';
    loreRelationshipsInput.value = '';
    loreSpeechStyleInput.value = '';
    loreSources = [];
    loreSourcesOutput.textContent = '';
  };

  const fillLoreEditor = (lore?: CharacterLore): void => {
    clearLoreEditor();
    if (!lore) return;
    loreAliasesInput.value = lore.aliases.join('、');
    loreSourceWorkInput.value = lore.sourceWork;
    loreIdentityInput.value = lore.identity;
    lorePersonalityInput.value = lore.personality;
    loreBackgroundInput.value = lore.background;
    loreRelationshipsInput.value = lore.relationships.join('\n');
    loreSpeechStyleInput.value = lore.speechStyle;
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
    const fields = {
      sourceWork: loreSourceWorkInput.value.trim(),
      identity: loreIdentityInput.value.trim(),
      personality: lorePersonalityInput.value.trim(),
      background: loreBackgroundInput.value.trim(),
      speechStyle: loreSpeechStyleInput.value.trim(),
    };
    if (
      aliases.length === 0 &&
      relationships.length === 0 &&
      Object.values(fields).every((v) => !v)
    ) {
      return undefined;
    }
    return { canonicalName, aliases, relationships, ...fields, sources: loreSources };
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
          characterSearchStatus.textContent = `正在读取“${candidate.name}”的原作台词并生成扮演设定，可能需要十几秒…`;
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
            loreEditor.open = true;
            if (result.draft.warnings.length > 0) {
              action.textContent = '重新整理扮演设定 →';
              characterSearchStatus.textContent = result.draft.warnings.join(' ');
            } else {
              characterSearchCandidates.replaceChildren();
              characterSearchStatus.textContent =
                '已从原作资料和台词生成扮演设定，请检查后点击“保存”。';
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
      glossaryStatus.textContent = '填写来源作品后，可查看是否有对应的社区词库。';
      glossarySources.textContent = '';
      syncGlossaryButton.disabled = true;
      return;
    }
    const status = await api.getWorkGlossaryStatus({ sourceWork });
    syncGlossaryButton.disabled = !status.supported;
    if (!status.supported) {
      glossaryStatus.textContent = '当前作品还没有内置社区词库；遇到未知词时会先澄清。';
      glossarySources.textContent = '';
      return;
    }
    glossaryStatus.textContent = status.lastSynced
      ? `${status.workName}社区词库已缓存，共 ${status.entryCount} 条；上次同步：${new Date(status.lastSynced).toLocaleString()}。`
      : `${status.workName}社区词库包含 ${status.entryCount} 条本地校对词条；可主动联网同步来源状态。`;
    glossarySources.textContent = status.sources.length
      ? `词库来源：${status.sources.map((source) => `${source.siteName} · ${source.title}`).join('；')}`
      : '';
  };

  const runCharacterSearch = async (): Promise<void> => {
    if (!api || activeCharacterResearchId) return;
    const name = characterNameInput.value.trim();
    if (!name) {
      characterSearchStatus.textContent = '请先填写角色名称。';
      return;
    }
    if (
      !window.confirm(
        `将把“${name}”和作品名发送给公开资料站点进行查询。结果不会自动保存，是否继续？`,
      )
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
        sourceWork: loreSourceWorkInput.value.trim(),
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
    modelInput.value = conversationConfiguration.selection?.modelId ?? '';
    baseUrlInput.value = providerConfiguration.openAICompatibleBaseUrl;
    characterNameInput.value = storedProfile.name;
    fillLoreEditor(storedProfile.lore);
    await loadGlossaryStatus(storedProfile.lore?.sourceWork ?? '');
    userNameInput.value = storedProfile.userDisplayName;
    bioInput.value = storedProfile.bio;
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
      api.setProviderConfiguration({ openAICompatibleBaseUrl: baseUrlInput.value.trim() }),
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
        !window.confirm(
          `将访问公开社区资料，交叉验证“${sourceWork}”词库并缓存到本地。普通聊天不会自动联网，是否继续？`,
        )
      ) {
        return;
      }
      syncGlossaryButton.disabled = true;
      glossaryStatus.textContent = '正在核对多个公开来源…';
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
          memoryStatus.textContent = '共 ' + memoryRecords.length + ' 条有效记忆。';
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
  providerSelect.addEventListener('change', () => void updateSecretStatus());
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
    window.removeEventListener('deskpet:character-loaded', handleCharacterLoaded);
    if (panelExpanded) void api?.setChatPanelExpanded({ expanded: false });
    shell.remove();
  };
};
