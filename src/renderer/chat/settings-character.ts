import type { DeskpetApi } from '../../shared/ipc';
import type { CharacterLore } from '../../core/character/character-lore';
import {
  resolveAutomaticGlossarySourceWork,
  type CharacterResearchCandidate,
} from '../../core/character/character-research';
import { el, createButton, createField } from './elements';
import { createPanelLifetime } from './panel-lifetime';
interface CharacterPanelOptions {
  api:
    | Pick<
        DeskpetApi,
        | 'listCharacters'
        | 'activateCharacter'
        | 'removeCharacter'
        | 'createLocalCharacter'
        | 'clearInactiveCharacters'
        | 'previewCharacterPackage'
        | 'confirmCharacterPackageImport'
        | 'exportActiveCharacterPackage'
        | 'searchCharacters'
        | 'buildCharacterDraft'
        | 'cancelCharacterResearch'
        | 'getWorkGlossaryStatus'
        | 'syncWorkGlossary'
      >
    | undefined;
  resizeTarget: Element;
  confirmAction(input: {
    title: string;
    message: string;
    details: string;
    confirmLabel: string;
  }): Promise<boolean>;
  createRequestId(prefix: string): string;
  refreshActiveCharacter(): Promise<void>;
  setStatus(message: string): void;
  showCharacterSettings(): void;
  onNameChanged(): void;
}
export const mountCharacterSettings = (options: CharacterPanelOptions) => {
  const { api } = options;
  const lifetime = createPanelLifetime();
  let candidateLifetime = createPanelLifetime();
  let libraryLifetime = createPanelLifetime();
  const frames = new Set<number>();
  const queueFrame = (callback: () => void): void => {
    if (lifetime.disposed) return;
    const id = requestAnimationFrame(() => {
      frames.delete(id);
      if (!lifetime.disposed) callback();
    });
    frames.add(id);
  };
  const enableAutoGrowingTextarea = (textarea: HTMLTextAreaElement): (() => void) => {
    textarea.classList.add('settings-textarea--auto');
    const resize = (): void => {
      if (!textarea.isConnected || textarea.offsetParent === null) return;
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    lifetime.on(textarea, 'input', resize);
    return resize;
  };

  let loreSources: CharacterLore['sources'] = [];
  let roleplayExampleSourceIds = new Map<string, string>();
  let activeCharacterResearchId: string | undefined;
  let activeGlossarySyncWork: string | undefined;
  const automaticallyRequestedGlossaryWorks = new Set<string>();
  const characterNameInput = el('input', { maxLength: 80, autocomplete: 'off' });
  const characterSearchNameInput = document.createElement('input');
  characterSearchNameInput.maxLength = 80;
  characterSearchNameInput.autocomplete = 'off';
  characterSearchNameInput.placeholder = '要查找的角色名称';
  const characterLibrary = el('section', { className: 'character-search character-library' });
  const characterLibraryTitle = el('strong', { textContent: '角色库与角色包' });
  const characterLibraryStatus = document.createElement('p');
  characterLibraryStatus.className = 'settings-status';
  characterLibraryStatus.setAttribute('role', 'status');
  characterLibraryStatus.textContent = '角色之间的对话、记忆和模型资源彼此隔离。';
  const characterLibraryList = el('div', { className: 'character-library__list' });
  const characterLibraryActions = el('div', { className: 'settings-actions' });
  const newCharacterNameInput = document.createElement('input');
  newCharacterNameInput.maxLength = 80;
  newCharacterNameInput.autocomplete = 'off';
  newCharacterNameInput.placeholder = '新角色名称';
  newCharacterNameInput.setAttribute('aria-label', '新角色名称');
  const createLocalCharacterButton = createButton('新建本地角色', 'secondary-button');
  const importCharacterButton = createButton('预览并导入', 'secondary-button');
  const exportCharacterButton = createButton('导出当前角色', 'text-button');
  const clearCharacterLibraryButton = createButton('一键清空', 'text-button danger-button');
  characterLibraryActions.append(
    importCharacterButton,
    exportCharacterButton,
    clearCharacterLibraryButton,
  );
  characterLibrary.append(
    characterLibraryTitle,
    characterLibraryStatus,
    characterLibraryList,
    characterLibraryActions,
  );
  const localCharacterActions = document.createElement('div');
  localCharacterActions.className = 'settings-actions local-character-actions';
  localCharacterActions.append(
    createField('新角色名称', newCharacterNameInput),
    createLocalCharacterButton,
  );
  const loreSourceWorkInput = document.createElement('input');
  loreSourceWorkInput.maxLength = 300;
  loreSourceWorkInput.placeholder = '例如：明日方舟（填写后搜索更准确）';
  const characterSearch = el('section', { className: 'character-search' });
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
  const characterSearchCandidates = el('div', { className: 'character-search__candidates' });
  const characterSearchActions = el('div', { className: 'settings-actions' });
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
  const glossaryPanel = el('section', { className: 'character-search glossary-sync' });
  const glossaryStatus = document.createElement('p');
  glossaryStatus.className = 'settings-status';
  glossaryStatus.setAttribute('role', 'status');
  glossaryStatus.textContent = '作品词库只补充专有名词和社区用语，不负责角色说话风格。';
  const glossarySources = el('details', { className: 'glossary-sources', hidden: true });
  const glossarySourcesSummary = document.createElement('summary');
  const glossarySourcesPreview = el('span', { className: 'glossary-sources__preview' });
  const glossarySourcesToggle = document.createElement('span');
  glossarySourcesToggle.className = 'glossary-sources__toggle';
  glossarySourcesToggle.textContent = '.....点击展开';
  glossarySourcesSummary.append(glossarySourcesPreview, glossarySourcesToggle);
  const glossarySourcesFull = el('small', { className: 'glossary-sources__full' });
  glossarySources.append(glossarySourcesSummary, glossarySourcesFull);
  lifetime.on(glossarySources, 'toggle', () => {
    glossarySourcesToggle.textContent = glossarySources.open ? '收起来源' : '.....点击展开';
  });
  const syncGlossaryButton = createButton('同步作品词库', 'secondary-button');
  const glossaryActions = el('div', { className: 'settings-actions' });
  glossaryActions.append(syncGlossaryButton);
  glossaryPanel.append(glossaryStatus, glossarySources, glossaryActions);
  const loreEditor = el('details', { className: 'character-lore' });
  const loreSummary = el('summary', { textContent: '角色设定' });
  const loreHint = el('p', { className: 'settings-status' });
  loreHint.textContent =
    '默认称呼是“你”，并使用通用简介和人格规则。联网整理角色后，这些内容会和原作资料一起更新；点击总设置的“保存”后才生效。';
  const userNameInput = el('input', { maxLength: 80 });
  const bioInput = el('textarea', { maxLength: 2_000, rows: 2 });
  const personaInput = el('textarea', { maxLength: 16_000, rows: 5 });
  const loreAliasesInput = document.createElement('input');
  loreAliasesInput.maxLength = 2_000;
  loreAliasesInput.placeholder = '用顿号分隔，例如：昵称、别称';
  const lorePersonalityInput = el('textarea', { maxLength: 2_000, rows: 3 });
  const loreBackgroundInput = el('textarea', { maxLength: 4_000, rows: 4 });
  const loreRelationshipsInput = document.createElement('textarea');
  loreRelationshipsInput.maxLength = 6_000;
  loreRelationshipsInput.rows = 3;
  loreRelationshipsInput.placeholder = '每行一条';
  const loreSpeechStyleInput = document.createElement('textarea');
  loreSpeechStyleInput.maxLength = 2_000;
  loreSpeechStyleInput.rows = 3;
  loreSpeechStyleInput.placeholder = '对用户的称呼、语气、句式、惯用词和情绪表达';
  const loreSampleLinesInput = el('textarea', { maxLength: 6_000, rows: 6 });
  loreSampleLinesInput.placeholder =
    '每行一条：场景｜情绪｜触发条件｜角色态度｜短回应\n也兼容直接填写普通短台词';
  const loreSourcesOutput = el('small', { className: 'character-lore__sources' });
  const clearLoreButton = createButton('清空详细资料', 'text-button danger-button');
  const loreActions = el('div', { className: 'settings-actions' });
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
    queueFrame(() => {
      for (const resize of loreTextareaResizers) resize();
    });
  };
  const loreTextareaResizers = loreTextareas.map(enableAutoGrowingTextarea);
  const loreEditorResizeObserver = new ResizeObserver(() => {
    if (loreEditor.open) resizeLoreTextareas();
  });
  loreEditorResizeObserver.observe(options.resizeTarget);
  lifetime.on(loreEditor, 'toggle', () => {
    if (loreEditor.open) resizeLoreTextareas();
  });

  const characterPageBody = document.createElement('div');
  characterPageBody.className = 'display-mode-settings__body character-page__body';
  const characterPageTabs = document.createElement('nav');
  characterPageTabs.className = 'display-mode-tabs character-page__tabs';
  characterPageTabs.setAttribute('aria-label', '角色设置分类');
  const characterPageContent = document.createElement('div');
  characterPageContent.className = 'display-mode-content character-page__content';
  const characterLibraryPane = document.createElement('section');
  characterLibraryPane.className = 'display-mode-pane character-page__pane';
  characterLibraryPane.append(characterLibrary);
  const localCharacterPane = el('section', { className: 'display-mode-pane character-page__pane' });
  localCharacterPane.append(
    localCharacterActions,
    createField('角色名称', characterNameInput),
    loreEditor,
  );
  const characterResearchPane = document.createElement('section');
  characterResearchPane.className = 'display-mode-pane character-page__pane';
  characterResearchPane.append(
    createField('查找角色', characterSearchNameInput),
    createField('来源作品或游戏', loreSourceWorkInput),
    characterSearch,
    glossaryPanel,
  );
  type CharacterPage = 'library' | 'local' | 'research';
  const characterPanes = [
    ['library', '角色库与角色包', characterLibraryPane],
    ['local', '自建角色', localCharacterPane],
    ['research', '网络查找', characterResearchPane],
  ] as const satisfies readonly (readonly [CharacterPage, string, HTMLElement])[];
  const characterPageButtons = new Map<CharacterPage, HTMLButtonElement>();
  const showCharacterPage = (page: CharacterPage): void => {
    for (const [candidate, , pane] of characterPanes) {
      const selected = candidate === page;
      pane.hidden = !selected;
      const button = characterPageButtons.get(candidate);
      button?.classList.toggle('is-active', selected);
      button?.setAttribute('aria-pressed', String(selected));
    }
    if (page === 'local' && loreEditor.open) resizeLoreTextareas();
  };
  for (const [page, label, pane] of characterPanes) {
    const button = createButton(label, 'display-mode-tab character-page__tab');
    button.setAttribute('aria-pressed', 'false');
    lifetime.on(button, 'click', () => showCharacterPage(page));
    characterPageButtons.set(page, button);
    characterPageTabs.append(button);
    characterPageContent.append(pane);
  }
  characterPageBody.append(characterPageTabs, characterPageContent);

  showCharacterPage('library');

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
    candidateLifetime.dispose();
    candidateLifetime = createPanelLifetime();
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
      const title = el('strong', { textContent: candidate.name });
      const source = document.createElement('small');
      source.textContent = `${candidate.sourceName} · ${candidate.sourceWork || '作品待确认'}`;
      const description = document.createElement('span');
      description.textContent = candidate.description || candidate.matchReason;
      const reason = el('small', { textContent: candidate.matchReason });
      const action = document.createElement('strong');
      action.className = 'character-candidate__action';
      action.textContent = '选择并生成扮演设定 →';
      button.append(title, source, description, reason, action);
      candidateLifetime.on(button, 'click', () => {
        void (async () => {
          if (lifetime.disposed || !api || activeCharacterResearchId) return;
          if (candidate.sourceWork) {
            loreSourceWorkInput.value = candidate.sourceWork;
            await loadGlossaryStatus(candidate.sourceWork);
            if (lifetime.disposed) return;
            void syncWorkGlossarySeparately(candidate.sourceWork, true);
          }
          const requestId = options.createRequestId('character_draft');
          activeCharacterResearchId = requestId;
          setCharacterResearchBusy(true);
          characterResearchProgress.setAttribute('aria-label', '正在发散查找并整理角色资料');
          characterSearchStatus.textContent = `正在围绕“${candidate.name}”发散查找身份、背景、关系和台词资料，再生成扮演设定…`;
          try {
            const result = await api.buildCharacterDraft({
              requestId,
              candidateId: candidate.id,
            });
            if (lifetime.disposed) return;
            if (activeCharacterResearchId !== requestId) return;
            if (!result.ok) {
              characterSearchStatus.textContent = result.message;
              return;
            }
            characterNameInput.value = result.draft.lore.canonicalName;
            characterSearchNameInput.value = result.draft.lore.canonicalName;
            fillLoreEditor(result.draft.lore);
            userNameInput.value = result.draft.profileFields.userDisplayName;
            bioInput.value = result.draft.profileFields.bio;
            personaInput.value = result.draft.profileFields.personaPrompt;
            loreEditor.open = true;
            if (result.draft.warnings.length > 0) {
              action.textContent = '重新整理扮演设定 →';
              characterSearchStatus.textContent = `${result.draft.warnings.join(' ')} 请到“自建角色”检查角色设定。`;
            } else {
              characterSearchCandidates.replaceChildren();
              characterSearchStatus.textContent =
                '已综合角色资料和台词来源生成本地草稿；请到“自建角色”检查后保存。';
            }
            options.setStatus('联网资料已生成本地角色草稿，请检查后保存。');
            options.showCharacterSettings();
            showCharacterPage('local');
            queueFrame(() => loreEditor.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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
        })().catch(() => {
          if (!lifetime.disposed) characterLibraryStatus.textContent = '角色操作失败，请重试。';
        });
      });
      characterSearchCandidates.append(button);
    }
  };

  const loadGlossaryStatus = async (sourceWork: string): Promise<void> => {
    if (lifetime.disposed || !api || !sourceWork.trim()) {
      glossaryStatus.textContent = '作品词库只补充专有名词和社区用语，不负责角色说话风格。';
      glossarySources.hidden = true;
      syncGlossaryButton.disabled = true;
      return;
    }
    const status = await api.getWorkGlossaryStatus({ sourceWork });
    if (lifetime.disposed) return;
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
    if (lifetime.disposed || !api) return;
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
      if (lifetime.disposed) return;
      glossaryStatus.textContent = result.message;
      if (result.ok && loreSourceWorkInput.value.trim() === work) {
        await loadGlossaryStatus(work);
        if (lifetime.disposed) return;
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
    if (lifetime.disposed || !api || activeCharacterResearchId) return;
    const name = characterSearchNameInput.value.trim();
    if (!name) {
      characterSearchStatus.textContent = '请先填写角色名称。';
      return;
    }
    const sourceWork = loreSourceWorkInput.value.trim();
    if (
      !(await options.confirmAction({
        title: '联网查找角色',
        message: sourceWork ? `查找“${name}”（${sourceWork}）？` : `查找“${name}”？`,
        details:
          '角色名和已填写的作品名会发送给公开资料站点；作品留空时会从候选页正文识别。作品词库会作为另一条独立网络任务同步，不与角色整理共用模型上下文。查找结果只会生成本地草稿，点击总设置的“保存”后才会生效。',
        confirmLabel: '开始查找',
      }))
    ) {
      return;
    }
    if (lifetime.disposed) return;
    const requestId = options.createRequestId('character_search');
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
      if (lifetime.disposed) return;
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

  const loadCharacterLibrary = async (): Promise<void> => {
    if (lifetime.disposed || !api) return;
    const entries = await api.listCharacters();
    if (lifetime.disposed) return;
    libraryLifetime.dispose();
    libraryLifetime = createPanelLifetime();
    characterLibraryList.replaceChildren();
    for (const entry of entries) {
      const row = el('div', { className: 'character-library__entry' });
      const description = document.createElement('span');
      description.textContent = `${entry.profile.name}${entry.active ? '（当前）' : ''}`;
      const actions = el('div', { className: 'settings-actions' });
      if (!entry.active) {
        const activate = createButton('切换', 'text-button');
        libraryLifetime.on(activate, 'click', () => {
          void (async () => {
            const confirmed = await options.confirmAction({
              title: '切换角色',
              message: `切换到“${entry.profile.name}”？`,
              details:
                '当前未保存的设置不会带到新角色。对话历史、长期记忆和作品词库会切换到该角色自己的命名空间。',
              confirmLabel: '切换',
            });
            if (lifetime.disposed) return;
            if (!confirmed) return;
            const result = await api.activateCharacter({ characterId: entry.profile.id });
            if (lifetime.disposed) return;
            if (!result.ok) {
              characterLibraryStatus.textContent = result.error.message;
              return;
            }
            await options.refreshActiveCharacter();
            if (lifetime.disposed) return;
            characterLibraryStatus.textContent = `已切换到“${entry.profile.name}”。`;
          })().catch(() => {
            if (!lifetime.disposed) characterLibraryStatus.textContent = '角色操作失败，请重试。';
          });
        });
        actions.append(activate);
      }
      if (entry.imported) {
        const remove = createButton('删除', 'text-button danger-button');
        libraryLifetime.on(remove, 'click', () => {
          void (async () => {
            const confirmed = await options.confirmAction({
              title: '删除角色包',
              message: `删除“${entry.profile.name}”的角色资料和模型素材？`,
              details:
                '该角色的对话和长期记忆不会随角色包删除，但在重新导入同一角色前不会显示。此操作无法撤销。',
              confirmLabel: '删除',
            });
            if (lifetime.disposed) return;
            if (!confirmed) return;
            const result = await api.removeCharacter({ characterId: entry.profile.id });
            if (lifetime.disposed) return;
            if (!result.ok) {
              characterLibraryStatus.textContent = result.error.message;
              return;
            }
            await options.refreshActiveCharacter();
            if (lifetime.disposed) return;
            characterLibraryStatus.textContent = '角色包已删除。';
          })().catch(() => {
            if (!lifetime.disposed) characterLibraryStatus.textContent = '角色操作失败，请重试。';
          });
        });
        actions.append(remove);
      }
      row.append(description, actions);
      characterLibraryList.append(row);
    }
  };

  lifetime.on(clearLoreButton, 'click', () => {
    clearLoreEditor();
    options.setStatus('角色扮演资料已清空；点击“保存”后生效。');
  });
  lifetime.on(searchCharacterButton, 'click', () => void runCharacterSearch());
  lifetime.on(syncGlossaryButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      const sourceWork = loreSourceWorkInput.value.trim();
      if (!sourceWork) {
        glossaryStatus.textContent = '请先填写来源作品。';
        return;
      }
      if (
        !(await options.confirmAction({
          title: '同步作品词库',
          message: `将同步“${sourceWork}”的社区词库。`,
          details:
            '会主动搜索公开网页，核对社区梗、黑话、术语和别名后更新本地缓存；普通聊天不会因此自动联网。',
          confirmLabel: '开始同步',
        }))
      ) {
        return;
      }
      if (lifetime.disposed) return;
      syncGlossaryButton.disabled = true;
      await syncWorkGlossarySeparately(sourceWork, false);
      if (lifetime.disposed) return;
    })().catch(() => {
      if (!lifetime.disposed) characterLibraryStatus.textContent = '角色操作失败，请重试。';
    });
  });
  lifetime.on(cancelCharacterSearchButton, 'click', () => {
    if (lifetime.disposed || !api || !activeCharacterResearchId) return;
    const requestId = activeCharacterResearchId;
    activeCharacterResearchId = undefined;
    setCharacterResearchBusy(false);
    characterSearchStatus.textContent = '已取消查找。';
    void api.cancelCharacterResearch({ requestId }).catch(() => undefined);
  });
  lifetime.on(characterNameInput, 'change', () => {
    characterSearchNameInput.value = characterNameInput.value;
    options.onNameChanged();
  });
  lifetime.on(characterSearchNameInput, 'change', () => {
    characterNameInput.value = characterSearchNameInput.value;
    options.onNameChanged();
    if (characterSearchNameInput.value.trim() && characterSearchNameInput.value.trim() !== '桌宠') {
      characterSearchStatus.textContent = '要联网查找这个角色吗？填写作品名会更准确。';
    }
  });
  lifetime.on(loreSourceWorkInput, 'change', () => {
    void loadGlossaryStatus(loreSourceWorkInput.value.trim());
  });

  lifetime.on(createLocalCharacterButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      const name = newCharacterNameInput.value.trim();
      if (!name) {
        characterLibraryStatus.textContent = '请先填写新角色名称。';
        newCharacterNameInput.focus();
        return;
      }
      characterLibraryStatus.textContent = '正在创建本地角色…';
      const result = await api.createLocalCharacter({ name });
      if (lifetime.disposed) return;
      if (!result.ok) {
        characterLibraryStatus.textContent = result.error.message;
        return;
      }
      newCharacterNameInput.value = '';
      await options.refreshActiveCharacter();
      if (lifetime.disposed) return;
      characterLibraryStatus.textContent = `“${name}”已创建并切换；可以继续填写下方角色设定。`;
    })().catch(() => {
      if (!lifetime.disposed) characterLibraryStatus.textContent = '角色操作失败，请重试。';
    });
  });
  lifetime.on(clearCharacterLibraryButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      const entries = await api.listCharacters();
      if (lifetime.disposed) return;
      const removable = entries.filter(({ active }) => !active);
      if (removable.length === 0) {
        characterLibraryStatus.textContent = '角色库中只有当前角色，无需清空。';
        return;
      }
      const confirmed = await options.confirmAction({
        title: '一键清空角色库',
        message: `清除当前角色以外的 ${removable.length} 个角色及其已导入角色包？`,
        details:
          '当前角色会保留。被清除角色的资料和已导入模型素材将删除；其对话与长期记忆不会删除，但在重新创建或导入相同角色前不会显示。此操作无法撤销。',
        confirmLabel: '确认清空',
      });
      if (lifetime.disposed) return;
      if (!confirmed) return;
      clearCharacterLibraryButton.disabled = true;
      characterLibraryStatus.textContent = '正在清空角色库…';
      try {
        const result = await api.clearInactiveCharacters();
        if (lifetime.disposed) return;
        if (!result.ok) {
          characterLibraryStatus.textContent = result.error.message;
          return;
        }
        await loadCharacterLibrary();
        if (lifetime.disposed) return;
        characterLibraryStatus.textContent = `已清除 ${removable.length} 个角色；当前角色、对话和长期记忆已保留。`;
      } finally {
        clearCharacterLibraryButton.disabled = false;
      }
    })().catch(() => {
      if (!lifetime.disposed) characterLibraryStatus.textContent = '角色操作失败，请重试。';
    });
  });
  lifetime.on(importCharacterButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      characterLibraryStatus.textContent = '正在检查角色包…';
      const result = await api.previewCharacterPackage();
      if (lifetime.disposed) return;
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
      const confirmed = await options.confirmAction({
        title: preview.conflict === 'replace' ? '替换已有角色包' : '导入角色包',
        message: `角色：${preview.characterName}${preview.sourceWork ? `（${preview.sourceWork}）` : ''}\n素材：${preview.assetCount} 项，约 ${Math.ceil(preview.uncompressedBytes / 1024)} KiB${preview.hasLive2DModel ? '，含 Live2D 模型' : ''}`,
        details: `${attribution}\n\n角色包不会导入聊天、长期记忆或 API Key。`,
        confirmLabel: preview.conflict === 'replace' ? '确认替换' : '确认导入',
      });
      if (lifetime.disposed) return;
      if (!confirmed) {
        characterLibraryStatus.textContent = '已取消导入。';
        return;
      }
      const imported = await api.confirmCharacterPackageImport({
        previewId: preview.previewId,
        replaceExisting: preview.conflict === 'replace',
      });
      if (lifetime.disposed) return;
      if (!imported.ok) {
        characterLibraryStatus.textContent = imported.message;
        return;
      }
      await options.refreshActiveCharacter();
      if (lifetime.disposed) return;
      characterLibraryStatus.textContent = `“${preview.characterName}”已导入并切换。`;
    })().catch(() => {
      if (!lifetime.disposed) characterLibraryStatus.textContent = '角色操作失败，请重试。';
    });
  });
  lifetime.on(exportCharacterButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      characterLibraryStatus.textContent = '正在生成不含私人数据的角色包…';
      const result = await api.exportActiveCharacterPackage();
      if (lifetime.disposed) return;
      characterLibraryStatus.textContent = result.ok
        ? result.canceled
          ? '已取消导出。'
          : '角色包已导出；聊天、记忆和 API Key 未写入。'
        : result.message;
    })().catch(() => {
      if (!lifetime.disposed) characterLibraryStatus.textContent = '角色操作失败，请重试。';
    });
  });

  return {
    elements: {
      characterNameInput,
      characterSearchNameInput,
      characterLibrary,
      localCharacterActions,
      loreSourceWorkInput,
      characterSearch,
      characterSearchStatus,
      characterSearchCandidates,
      glossaryPanel,
      loreEditor,
      userNameInput,
      bioInput,
      personaInput,
    },
    pageBody: characterPageBody,
    fillLoreEditor,
    readLoreEditor,
    resizeLoreTextareas,
    loadCharacterLibrary,
    loadGlossaryStatus,
    renderCharacterCandidates,
    dispose(): void {
      lifetime.dispose();
      candidateLifetime.dispose();
      libraryLifetime.dispose();
      loreEditorResizeObserver.disconnect();
      for (const id of frames) cancelAnimationFrame(id);
      frames.clear();
      if (api && activeCharacterResearchId) {
        void api
          .cancelCharacterResearch({ requestId: activeCharacterResearchId })
          .catch(() => undefined);
      }
      activeCharacterResearchId = undefined;
    },
  };
};
