import type { CharacterPackagePreview } from '../../shared/character-package-ipc';
import { setupResourceIds } from '../../shared/setup-resources';
import { formatSetupBytes, setupVoiceLabel } from './resource-pages';
import type {
  DeskpetSetupApi,
  SetupCharacterSource,
  SetupSelections,
  SetupViewState,
} from '../../shared/setup-ipc';

export interface SetupPageContext {
  api: DeskpetSetupApi;
  getSelections(): SetupSelections;
  updateSelections(patch: Partial<SetupSelections>): void;
  setStatus(message?: string, tone?: 'info' | 'error'): void;
  setNextEnabled(enabled: boolean): void;
  showView(view: SetupViewState): Promise<void>;
  run(operation: () => Promise<void>): Promise<void>;
}

export interface SetupPage {
  render(host: HTMLElement, view: SetupViewState, context: SetupPageContext): Promise<void> | void;
  /** Runs before the wizard leaves the page. Throwing keeps the user on the page. */
  commit?(context: SetupPageContext): Promise<void>;
  dispose?(): void;
}

const createParagraph = (text: string, className = 'wizard__text'): HTMLParagraphElement => {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
};

const createField = (label: string, control: HTMLElement, hint?: string): HTMLLabelElement => {
  const field = document.createElement('label');
  field.className = 'wizard__field';
  const caption = document.createElement('span');
  caption.className = 'wizard__field-label';
  caption.textContent = label;
  field.append(caption, control);
  if (hint) field.append(createParagraph(hint, 'wizard__field-hint'));
  return field;
};

const createTextInput = (value: string, type: 'text' | 'password' = 'text'): HTMLInputElement => {
  const input = document.createElement('input');
  input.className = 'wizard__input';
  input.type = type;
  input.value = value;
  input.autocomplete = 'off';
  input.spellcheck = false;
  return input;
};

const createChoice = (
  name: string,
  value: string,
  label: string,
  detail: string,
  checked: boolean,
  onSelect: () => void,
): HTMLLabelElement => {
  const option = document.createElement('label');
  option.className = 'wizard__choice';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.addEventListener('change', () => {
    if (input.checked) onSelect();
  });
  const text = document.createElement('span');
  text.className = 'wizard__choice-text';
  const title = document.createElement('span');
  title.className = 'wizard__choice-title';
  title.textContent = label;
  text.append(title, createParagraph(detail, 'wizard__choice-detail'));
  option.append(input, text);
  return option;
};

const createSummary = (rows: Array<[string, string]>): HTMLDListElement => {
  const summary = document.createElement('dl');
  summary.className = 'wizard__summary';
  for (const [term, value] of rows) {
    const key = document.createElement('dt');
    key.textContent = term;
    const detail = document.createElement('dd');
    detail.textContent = value;
    summary.append(key, detail);
  }
  return summary;
};

const createRequestId = (): string =>
  `setup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const createWelcomePage = (): SetupPage => ({
  render: (host, view) => {
    const notice = view.rerun
      ? '检测到已有配置。本向导只会写入你在这里确认的项目，不会清除现有设置。'
      : '完成后会打开主界面，其余高级设置仍留在应用内的设置面板中。';
    host.replaceChildren(
      createParagraph('本向导会准备首次运行所需的基础设置。'),
      createParagraph(notice),
      createParagraph(`程序版本 ${view.appVersion}`, 'wizard__text wizard__text--muted'),
    );
  },
});

export const createModePage = (): SetupPage => ({
  render: (host, _view, context) => {
    const selections = context.getSelections();
    const group = document.createElement('fieldset');
    group.className = 'wizard__group';
    const legend = document.createElement('legend');
    legend.textContent = '选择设置方式';
    group.append(
      legend,
      createChoice(
        'setup-mode',
        'recommended',
        '推荐设置',
        '只准备模型连接，角色保持中性占位，其余选项保持默认值。',
        selections.mode === 'recommended',
        () => context.updateSelections({ mode: 'recommended', voice: 'none', speechInput: false }),
      ),
      createChoice(
        'setup-mode',
        'custom',
        '自定义设置',
        '选择角色、本地朗读与语音识别；确认组件和体积后再下载。',
        selections.mode === 'custom',
        () => context.updateSelections({ mode: 'custom' }),
      ),
    );
    host.replaceChildren(group);
  },
});

/**
 * Credential page. The stored key is never read back: the field starts empty and an existing
 * key is only described by a hint, so leaving it blank keeps whatever is already saved.
 */
export const createProviderPage = (): SetupPage => {
  let providerInput: HTMLSelectElement | undefined;
  let baseUrlInput: HTMLInputElement | undefined;
  let apiKeyInput: HTMLInputElement | undefined;
  let modelInput: HTMLInputElement | undefined;
  let hasStoredSecret = false;
  let configureLater: HTMLInputElement | undefined;
  let continueUntested: HTMLInputElement | undefined;
  let tested = false;
  let requestInFlight: string | undefined;
  let activeApi: DeskpetSetupApi | undefined;
  let generation = 0;

  const readDraft = (): {
    providerId: string;
    baseUrl: string;
    apiKey: string;
    modelId: string;
  } => ({
    providerId: providerInput?.value ?? 'openai-compatible',
    baseUrl: baseUrlInput?.value.trim() ?? '',
    apiKey: apiKeyInput?.value ?? '',
    modelId: modelInput?.value.trim() ?? '',
  });

  return {
    dispose: () => {
      generation += 1;
      if (apiKeyInput) apiKeyInput.value = '';
      if (requestInFlight)
        void activeApi
          ?.cancelSetupProviderTest({ requestId: requestInFlight })
          .catch(() => undefined);
      requestInFlight = undefined;
    },
    render: async (host, _view, context) => {
      const currentGeneration = ++generation;
      activeApi = context.api;
      tested = false;
      const status = await context.api.getSetupProviderStatus();
      hasStoredSecret = status.hasSecret;

      const providerSelect = document.createElement('select');
      providerSelect.className = 'wizard__input';
      for (const option of status.options) {
        const item = document.createElement('option');
        item.value = option.id;
        item.textContent = option.displayName;
        item.selected = option.id === status.providerId;
        providerSelect.append(item);
      }
      providerInput = providerSelect;

      const baseUrlField = createField(
        '服务地址（Base URL）',
        (baseUrlInput = createTextInput(status.baseUrl)),
        '使用服务商提供的 OpenAI 兼容地址。除非服务商另有要求，保持默认值即可。',
      );
      const apiKeyField = createField(
        'API Key',
        (apiKeyInput = createTextInput('', 'password')),
        hasStoredSecret
          ? '已保存一个密钥。留空表示继续使用它；填写新值会覆盖。'
          : '用于向所选服务商验证请求。只保存在本机的加密存储中，不会再次显示。',
      );
      const modelField = createField(
        '对话模型',
        (modelInput = createTextInput(status.modelId)),
        '日常对话使用的模型。更大或偏推理的模型可能更慢、费用更高，之后可在设置里更改。',
      );

      const applyProviderVisibility = (): void => {
        const option = status.options.find((entry) => entry.id === providerSelect.value);
        baseUrlField.hidden = !option?.requiresBaseUrl;
      };
      providerSelect.addEventListener('change', applyProviderVisibility);
      applyProviderVisibility();

      const testButton = document.createElement('button');
      testButton.type = 'button';
      testButton.className = 'wizard__button';
      testButton.textContent = '测试连接';
      const testResult = createParagraph('', 'wizard__field-hint');
      testResult.setAttribute('role', 'status');

      configureLater = document.createElement('input');
      configureLater.type = 'checkbox';
      configureLater.checked = !status.modelId;
      const laterField = createField('稍后配置（保留已有配置）', configureLater);
      continueUntested = document.createElement('input');
      continueUntested.type = 'checkbox';
      const untestedField = createField(
        '暂不测试，确认保存并继续',
        continueUntested,
        '网络不可用时也能继续；之后可在设置里重新测试。',
      );
      const updateEnabled = (): void => {
        const later = configureLater?.checked ?? false;
        const testing = Boolean(requestInFlight);
        for (const input of [providerSelect, baseUrlInput!, apiKeyInput!, modelInput!])
          input.disabled = later || testing;
        testButton.disabled = later || testing;
        configureLater!.disabled = testing;
        continueUntested!.disabled = testing;
        untestedField.hidden = later;
      };
      configureLater.addEventListener('change', updateEnabled);
      for (const input of [providerSelect, baseUrlInput!, apiKeyInput!, modelInput!])
        input.addEventListener('input', () => {
          tested = false;
        });
      updateEnabled();

      testButton.addEventListener('click', () => {
        const draft = readDraft();
        if (!draft.modelId) {
          testResult.textContent = '请先填写对话模型。';
          return;
        }
        testButton.disabled = true;
        testResult.textContent = '正在测试连接…';
        const requestId = createRequestId();
        requestInFlight = requestId;
        updateEnabled();
        context.setNextEnabled(false);
        void (async () => {
          try {
            const applied = await context.api.applySetupProvider({
              providerId: draft.providerId as never,
              modelId: draft.modelId,
              ...(draft.baseUrl ? { baseUrl: draft.baseUrl } : {}),
              ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
            });
            if (!applied.ok) {
              testResult.textContent = applied.error.message;
              return;
            }
            if (currentGeneration !== generation) return;
            if (draft.apiKey) {
              hasStoredSecret = true;
              apiKeyInput?.setAttribute('placeholder', '已保存');
              if (apiKeyInput) apiKeyInput.value = '';
            }
            const result = await context.api.testSetupProvider({
              requestId,
              providerId: draft.providerId as never,
              modelId: draft.modelId,
            });
            if (currentGeneration !== generation) return;
            tested = result.ok;
            testResult.textContent = result.ok
              ? `连接成功，用时 ${result.latencyMs} 毫秒。`
              : `连接失败：${result.error.message}`;
          } catch {
            testResult.textContent = '连接测试失败，请稍后重试。';
          } finally {
            if (requestInFlight === requestId) requestInFlight = undefined;
            if (currentGeneration === generation) {
              updateEnabled();
              context.setNextEnabled(true);
            }
          }
        })();
      });

      const actions = document.createElement('div');
      actions.className = 'wizard__inline-actions';
      actions.append(testButton);

      host.replaceChildren(
        createParagraph(
          '填写模型服务商信息后即可开始对话。也可以留空，稍后在「设置 → AI」中补齐。',
        ),
        createField('服务商', providerSelect),
        laterField,
        baseUrlField,
        apiKeyField,
        modelField,
        actions,
        testResult,
        untestedField,
      );
    },
    commit: async (context) => {
      if (requestInFlight) throw new Error('请等待连接测试结束。');
      if (configureLater?.checked) return;
      if (!tested && !continueUntested?.checked) {
        context.setStatus('请先测试连接，或勾选「暂不测试，确认保存并继续」。', 'error');
        throw new Error('请确认是否跳过连接测试。');
      }
      const draft = readDraft();
      if (!draft.modelId && !draft.apiKey) {
        return;
      }
      if (!draft.modelId) {
        context.setStatus('请填写对话模型，或清空 API Key 以稍后配置。', 'error');
        throw new Error('The conversation model is required.');
      }
      const result = await context.api.applySetupProvider({
        providerId: draft.providerId as never,
        modelId: draft.modelId,
        ...(draft.baseUrl ? { baseUrl: draft.baseUrl } : {}),
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
      });
      if (!result.ok) {
        context.setStatus(result.error.message, 'error');
        throw new Error(result.error.message);
      }
      if (apiKeyInput) apiKeyInput.value = '';
    },
  };
};

/** Character page. Imports run through the same services the settings panel uses. */
export const createCharacterPage = (): SetupPage => ({
  render: async (host, _view, context) => {
    const status = await context.api.getSetupCharacterStatus();
    const selections = context.getSelections();
    const detail = createParagraph('', 'wizard__field-hint');
    detail.setAttribute('role', 'status');

    const packageActions = document.createElement('div');
    packageActions.className = 'wizard__inline-actions';
    const live2DActions = document.createElement('div');
    live2DActions.className = 'wizard__inline-actions';

    const applyVisibility = (source: SetupCharacterSource): void => {
      packageActions.hidden = source !== 'package';
      live2DActions.hidden = source !== 'live2d';
    };

    const selectPackageButton = document.createElement('button');
    selectPackageButton.type = 'button';
    selectPackageButton.className = 'wizard__button';
    selectPackageButton.textContent = '选择角色包…';
    let pendingPreview: CharacterPackagePreview | undefined;
    const confirmPackageButton = document.createElement('button');
    confirmPackageButton.type = 'button';
    confirmPackageButton.className = 'wizard__button';
    confirmPackageButton.hidden = true;
    confirmPackageButton.addEventListener('click', () => {
      const summary = pendingPreview;
      if (!summary) return;
      void context.run(async () => {
        confirmPackageButton.disabled = true;
        try {
          const confirmed = await context.api.confirmSetupCharacterPackage({
            previewId: summary.previewId,
            replaceExisting: summary.conflict === 'replace',
          });
          detail.textContent = confirmed.ok
            ? `已导入角色「${summary.characterName}」。`
            : confirmed.message;
          if (confirmed.ok) {
            pendingPreview = undefined;
            confirmPackageButton.hidden = true;
          }
        } finally {
          confirmPackageButton.disabled = false;
        }
      });
    });
    selectPackageButton.addEventListener('click', () => {
      selectPackageButton.disabled = true;
      pendingPreview = undefined;
      confirmPackageButton.hidden = true;
      detail.textContent = '正在读取角色包…';
      void context.run(async () => {
        try {
          const preview = await context.api.previewSetupCharacterPackage();
          if (!preview.ok) {
            detail.textContent = preview.message;
            return;
          }
          if (preview.canceled || !preview.preview) {
            detail.textContent = '';
            return;
          }
          const summary: CharacterPackagePreview = preview.preview;
          if (summary.conflict === 'blocked') {
            detail.textContent = `「${summary.characterName}」与现有角色冲突，无法导入。`;
            return;
          }
          pendingPreview = summary;
          detail.textContent = [
            `角色：${summary.characterName}；来源：${summary.sourceWork || '未注明'}。`,
            ...summary.attribution.map((entry) => `${entry.title}：${entry.licenseNote}`),
            summary.conflict === 'replace'
              ? '同名角色已存在，确认后将替换其角色包。'
              : '确认后导入此角色包。',
          ].join(' ');
          confirmPackageButton.textContent =
            summary.conflict === 'replace' ? '确认替换并导入' : '确认导入';
          confirmPackageButton.hidden = false;
        } catch {
          detail.textContent = '角色包导入失败，请重试。';
        } finally {
          selectPackageButton.disabled = false;
        }
      });
    });
    packageActions.append(selectPackageButton, confirmPackageButton);

    const importModelButton = document.createElement('button');
    importModelButton.type = 'button';
    importModelButton.className = 'wizard__button';
    importModelButton.textContent = '选择 .model3.json…';
    importModelButton.addEventListener('click', () => {
      void context.run(async () => {
        importModelButton.disabled = true;
        detail.textContent = '正在导入模型…';
        try {
          const imported = await context.api.importSetupLive2DModel();
          detail.textContent = !imported.ok
            ? imported.message
            : imported.canceled
              ? ''
              : `已导入模型「${imported.modelName}」，共 ${imported.assetCount} 个文件。`;
        } catch {
          detail.textContent = 'Live2D 模型导入失败，请重试。';
        } finally {
          importModelButton.disabled = false;
        }
      });
    });
    live2DActions.append(importModelButton);

    const group = document.createElement('fieldset');
    group.className = 'wizard__group';
    const legend = document.createElement('legend');
    legend.textContent = '选择角色来源';
    group.append(
      legend,
      createChoice(
        'character-source',
        'placeholder',
        '继续使用中性占位角色',
        '保持基础包自带的占位资料，之后随时可以导入角色。',
        selections.characterSource === 'placeholder',
        () => {
          context.updateSelections({ characterSource: 'placeholder' });
          applyVisibility('placeholder');
        },
      ),
      createChoice(
        'character-source',
        'package',
        '导入角色包（.fpnf-character.zip）',
        '导入身份卡与随附资源，导入前会显示角色名称与来源信息。',
        selections.characterSource === 'package',
        () => {
          context.updateSelections({ characterSource: 'package' });
          applyVisibility('package');
        },
      ),
      createChoice(
        'character-source',
        'live2d',
        '导入 Live2D 模型（.model3.json）',
        '只导入模型资源，角色资料仍使用当前设置。',
        selections.characterSource === 'live2d',
        () => {
          context.updateSelections({ characterSource: 'live2d' });
          applyVisibility('live2d');
        },
      ),
    );
    applyVisibility(selections.characterSource);

    host.replaceChildren(
      createParagraph(`当前角色：${status.activeCharacterName}`),
      group,
      packageActions,
      live2DActions,
      detail,
      createParagraph(
        'VTube Studio 连接、显示方式等仍在主界面的设置中配置。',
        'wizard__text wizard__text--muted',
      ),
    );
  },
});

export const createReviewPage = (): SetupPage => ({
  render: async (host, _view, context) => {
    const selections = context.getSelections();
    const [provider, character] = await Promise.all([
      context.api.getSetupProviderStatus(),
      context.api.getSetupCharacterStatus(),
    ]);
    const providerOption = provider.options.find((option) => option.id === provider.providerId);
    const rows: Array<[string, string]> = [
      ['设置方式', selections.mode === 'recommended' ? '推荐设置' : '自定义设置'],
      [
        '模型服务商',
        provider.hasSecret
          ? (providerOption?.displayName ?? provider.providerId)
          : '尚未配置，稍后在「设置 → AI」中完成',
      ],
      ['对话模型', provider.modelId || '尚未选择'],
      [
        '角色来源',
        character.source === 'package'
          ? `角色包：${character.activeCharacterName}`
          : character.source === 'live2d'
            ? `Live2D 模型：${character.activeCharacterName}`
            : '中性占位角色',
      ],
      ['本地语音输出', setupVoiceLabel(selections.voice)],
      [
        '本地语音输入',
        selections.speechInput ? '本地 SenseVoice，手动录音' : '保持已有设置，稍后配置',
      ],
    ];
    const ids = setupResourceIds(selections);
    const resources = ids.length ? await context.api.getSetupResources() : undefined;
    const selected = resources?.resources.filter((r) => ids.includes(r.id)) ?? [];
    rows.push([
      '附加下载',
      formatSetupBytes(
        selected.reduce(
          (n, r) =>
            n +
            (resources?.downloads.tiers.find((t) => t.id === r.id)?.state === 'ready'
              ? 0
              : r.downloadBytes),
          0,
        ),
      ),
    ]);
    if (ids.length)
      rows.push([
        '解压后大小',
        `${formatSetupBytes(selected.reduce((n, r) => n + r.installedBytes, 0))}，下载临时空间另计`,
      ]);
    host.replaceChildren(
      createParagraph(
        ids.length
          ? '请确认组件、体积和使用说明。下一步可手动开始下载或跳过。'
          : '确认后继续，不下载任何资源。',
      ),
      createSummary(rows),
      ...selected.map((r) =>
        createParagraph(
          `${r.name}：${r.license}${r.available ? '' : '（当前不可下载，可稍后重试或跳过）'}`,
          'wizard__field-hint',
        ),
      ),
    );
  },
});

export const createFinishPage = (): SetupPage => ({
  render: async (host, _view, context) => {
    const selections = context.getSelections();
    const [provider, character] = await Promise.all([
      context.api.getSetupProviderStatus(),
      context.api.getSetupCharacterStatus(),
    ]);
    const option = document.createElement('label');
    option.className = 'wizard__checkbox';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = selections.launchAfterFinish;
    input.addEventListener('change', () => {
      context.updateSelections({ launchAfterFinish: input.checked });
    });
    const text = document.createElement('span');
    text.textContent = '立即启动 For People No Friend';
    option.append(input, text);
    host.replaceChildren(
      createParagraph('基础设置已准备就绪。'),
      createParagraph(
        '模型服务商、角色与语音组件可以随时在主界面的设置里补齐。',
        'wizard__text wizard__text--muted',
      ),
      option,
      createSummary([
        [
          '文字聊天',
          provider.hasSecret && provider.modelId
            ? '已配置；连通性以连接测试为准'
            : '需在设置 → AI 中补齐',
        ],
        [
          '角色显示',
          character.hasLive2DModel
            ? '已导入 Live2D 模型，显示方式可在设置调整'
            : '尚无 Live2D 模型，可稍后导入或连接 VTube Studio',
        ],
        [
          '本地朗读',
          selections.voice === 'none'
            ? '保持已有设置'
            : `${setupVoiceLabel(selections.voice)}，完成时启用`,
        ],
        ['语音识别', selections.speechInput ? '已验证；完成后可手动录音' : '保持已有设置'],
      ]),
    );
  },
});
