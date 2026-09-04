import type { DeskpetApi } from '../../shared/ipc';
import {
  BUNDLED_IREINA_SPEECH_PRESET,
  GENIE_MIKA_PRESET,
  MAX_SPEECH_WAKE_WORD_LENGTH,
  SPEECH_PUSH_TO_TALK_KEYS,
  type SpeechInputMode,
  type SpeechSettings,
  type SpeechStatus,
} from '../../shared/speech-ipc';
import {
  resolveSpeechLanguage,
  selectSpeechLanguage,
  SPEECH_LANGUAGE_OPTIONS,
  type SpeechLanguageSelection,
} from '../speech/speech-language-options';
import { el, createButton, createField } from './elements';
import { createPanelLifetime } from './panel-lifetime';
import { createButtonFeedback } from './panel-feedback';
interface SpeechPanelOptions {
  api:
    | Pick<
        DeskpetApi,
        | 'getSpeechStatus'
        | 'deleteSpeechSecret'
        | 'getLocalSpeechAssetStatus'
        | 'exportLocalVoice'
        | 'openSpeechTrainingSources'
        | 'launchSpeechTrainer'
      >
    | undefined;
  onStatus(status: SpeechStatus): void;
  getStatus(): SpeechStatus | undefined;
  setReadiness(status: SpeechStatus): void;
}
export const mountSpeechSettings = (options: SpeechPanelOptions) => {
  const { api } = options;
  const lifetime = createPanelLifetime();
  const feedback = createButtonFeedback();
  const { showButtonFeedback } = feedback;
  const speechSettingsPanel = el('section', { className: 'display-mode-settings speech-settings' });
  const speechSettingsHeading = el('label', { className: 'settings-toggle-heading' });
  const speechSettingsTitle = el('strong', { textContent: '声音与音频生成' });
  const speechEnabledInput = document.createElement('input');
  speechEnabledInput.type = 'checkbox';
  speechEnabledInput.setAttribute('aria-label', '启用角色语音输出');
  speechSettingsHeading.append(speechSettingsTitle, speechEnabledInput);
  const speechProviderSelect = document.createElement('select');
  for (const [value, label] of [
    ['disabled', '关闭'],
    ['openai-compatible', 'OpenAI 兼容 TTS（本机或在线）'],
    ['genie-tts', '本机 Genie-TTS'],
    ['fish-audio', 'Fish Audio（在线）'],
  ]) {
    const option = el('option', { value: value, textContent: label });
    speechProviderSelect.append(option);
  }
  const speechBaseUrlInput = el('input', { type: 'url', maxLength: 2_048 });
  speechBaseUrlInput.placeholder = '例如：http://127.0.0.1:8000/v1';
  const speechModelInput = el('input', { maxLength: 256, placeholder: '语音模型 ID' });
  const speechVoiceInput = el('input', { maxLength: 256, placeholder: '音色 / speaker ID' });
  const speechLanguageSelect = document.createElement('select');
  for (const [value, label] of SPEECH_LANGUAGE_OPTIONS) {
    const option = el('option', { value: value, textContent: label });
    speechLanguageSelect.append(option);
  }
  const speechLanguageInput = el('input', { maxLength: 32, placeholder: '例如：fr-FR' });
  const speechFormatSelect = document.createElement('select');
  for (const format of ['wav', 'mp3', 'opus', 'aac', 'flac']) {
    const option = el('option', { value: format, textContent: format.toUpperCase() });
    speechFormatSelect.append(option);
  }
  const speechSpeedInput = el('input', { type: 'number', min: '0.25', max: '4', step: '0.05' });
  const speechInputEnabledHeading = el('label', { className: 'settings-toggle-heading' });
  const speechInputEnabledTitle = el('strong', { textContent: '启用中文麦克风输入' });
  const speechInputEnabledInput = document.createElement('input');
  speechInputEnabledInput.type = 'checkbox';
  speechInputEnabledInput.setAttribute('aria-label', '启用中文麦克风输入');
  speechInputEnabledHeading.append(speechInputEnabledTitle, speechInputEnabledInput);
  const speechInputModeFieldset = el('fieldset', { className: 'speech-input-modes' });
  const speechInputModeLegend = el('legend', { textContent: '麦克风模式（三选一）' });
  speechInputModeFieldset.append(speechInputModeLegend);
  const speechInputModeInputs = new Map<SpeechInputMode, HTMLInputElement>();
  for (const [mode, label, detail] of [
    ['full', '完全', '持续听麦；自动发送，2 秒内继续说会合并并重新思考'],
    ['half', '精准', '持续听麦；必须先说设定的称呼才发送，降低误判'],
    ['manual', '手动', '点击“说话”，或按住设置键位录音；识别结果只填入输入框'],
  ] as const) {
    const option = el('label', { className: 'speech-input-mode' });
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'speech-input-mode';
    radio.value = mode;
    radio.checked = mode === 'manual';
    const copy = document.createElement('span');
    const title = el('strong', { textContent: label });
    const hint = el('small', { textContent: detail });
    copy.append(title, hint);
    option.append(radio, copy);
    speechInputModeInputs.set(mode, radio);
    speechInputModeFieldset.append(option);
  }
  const readSpeechInputMode = (): SpeechInputMode =>
    [...speechInputModeInputs].find(([, input]) => input.checked)?.[0] ?? 'manual';
  const speechWakeWordSourceSelect = document.createElement('select');
  for (const [source, label] of [
    ['character-name', '跟随当前角色名称'],
    ['custom', '自定义称呼'],
  ] as const) {
    const option = el('option', { value: source, textContent: label });
    speechWakeWordSourceSelect.append(option);
  }
  const speechWakeWordSourceField = createField('精准模式称呼', speechWakeWordSourceSelect);
  const speechCustomWakeWordInput = document.createElement('input');
  speechCustomWakeWordInput.maxLength = MAX_SPEECH_WAKE_WORD_LENGTH;
  speechCustomWakeWordInput.placeholder = '例如：阿响';
  const speechCustomWakeWordField = createField('自定义称呼', speechCustomWakeWordInput);
  const speechWakeWordHint = el('small', { className: 'settings-hint' });
  const speechPushToTalkKeySelect = document.createElement('select');
  for (const key of SPEECH_PUSH_TO_TALK_KEYS) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = key === 'Backquote' ? '`（反引号）' : key;
    speechPushToTalkKeySelect.append(option);
  }
  speechPushToTalkKeySelect.value = 'F8';
  const speechPushToTalkKeyField = createField('手动按住说话键', speechPushToTalkKeySelect);
  const speechPushToTalkHint = el('small', { className: 'settings-hint' });
  speechPushToTalkHint.textContent =
    '仅在“手动”模式生效：按住键位开始录音，松开后识别并填入输入框，不会自动发送。默认 F8，桌宠未被选中时也可使用。';
  const speechTranscriptionBaseUrlInput = el('input', { type: 'url', maxLength: 2_048 });
  speechTranscriptionBaseUrlInput.placeholder = 'http://127.0.0.1:9880/v1';
  const speechTranscriptionModelInput = document.createElement('input');
  speechTranscriptionModelInput.maxLength = 256;
  speechTranscriptionModelInput.placeholder = 'SenseVoiceSmall';
  const speechTranscriptionLanguageInput = el('input', { maxLength: 32, placeholder: 'zh-CN' });
  const speechApiKeyInput = document.createElement('input');
  speechApiKeyInput.type = 'password';
  speechApiKeyInput.maxLength = 32_768;
  speechApiKeyInput.autocomplete = 'off';
  speechApiKeyInput.placeholder = '本机免密接口可留空';
  const deleteSpeechSecretButton = createButton('删除语音密钥', 'text-button');
  deleteSpeechSecretButton.hidden = true;
  const speechStatus = document.createElement('p');
  speechStatus.className = 'settings-status';
  speechStatus.setAttribute('role', 'status');
  speechStatus.textContent = '语音默认关闭；失败不会阻断文字聊天。';
  const speechHint = el('small', { className: 'settings-hint' });
  speechHint.textContent =
    '当前兼容接口使用 /audio/speech，同时支持本机 TTS 和 HTTPS 在线 TTS；完整第一句出现后会立即准备语音，后续句子并行生成并按原顺序播放，也可随时打断。';
  const speechProviderRoadmap = document.createElement('section');
  speechProviderRoadmap.className = 'character-search speech-provider-roadmap';
  const speechProviderRoadmapTitle = el('strong', { textContent: '语音模型与服务' });
  const speechProviderRoadmapList = document.createElement('ul');
  for (const description of [
    'OpenAI 兼容 TTS：已支持，可连接本地语音模型或 HTTPS 在线 TTS。',
    'Genie-TTS：已支持连接本机 GPT-SoVITS V2 / V2ProPlus ONNX 服务。',
    'Fish Audio：已支持官方在线接口；启用后文字会发送到 Fish Audio。',
    'Piper：可通过本机 OpenAI 兼容桥接服务连接；传统 MoeGoe VITS 权重不能直接作为 Piper 模型。',
  ]) {
    const item = el('li', { textContent: description });
    speechProviderRoadmapList.append(item);
  }
  speechProviderRoadmap.append(speechProviderRoadmapTitle, speechProviderRoadmapList);
  const speechVoiceIdentityPanel = document.createElement('section');
  speechVoiceIdentityPanel.className = 'character-search speech-voice-identity';
  const speechVoiceIdentityTitle = el('strong', { textContent: '语音模型与音色' });
  const speechVoiceIdentityFields = el('div', { className: 'speech-voice-identity__fields' });
  const speechModelField = createField('语音模型 ID', speechModelInput);
  const speechVoiceField = createField('音色 / Speaker ID', speechVoiceInput);
  const speechVoiceFieldLabel = speechVoiceField.firstElementChild as HTMLSpanElement;
  const speechVoiceConfirmButton = createButton(
    '确认',
    'secondary-button speech-voice-identity__confirm',
  );
  speechVoiceIdentityFields.append(speechModelField, speechVoiceField, speechVoiceConfirmButton);
  const speechVoiceIdentityHint = el('small', { className: 'settings-hint' });
  speechVoiceIdentityHint.textContent =
    '模型决定使用哪套语音能力，音色 ID 决定该模型使用哪个说话人；两项需按当前 TTS 服务配套填写。';
  speechVoiceIdentityPanel.append(
    speechVoiceIdentityTitle,
    speechVoiceIdentityFields,
    speechVoiceIdentityHint,
  );
  const speechLanguageField = createField('语言', speechLanguageSelect);
  const speechCustomLanguageField = createField('自定义语言代码', speechLanguageInput);
  const updateSpeechLanguageVisibility = (): void => {
    speechCustomLanguageField.hidden = speechLanguageSelect.value !== 'custom';
  };
  const displaySpeechLanguage = (language: string): void => {
    const selected = selectSpeechLanguage(language);
    speechLanguageSelect.value = selected.selection;
    speechLanguageInput.value = selected.customLanguage;
    updateSpeechLanguageVisibility();
  };
  const readSpeechLanguage = (): string =>
    resolveSpeechLanguage(
      speechLanguageSelect.value as SpeechLanguageSelection,
      speechLanguageInput.value,
    );
  displaySpeechLanguage('ja-JP');
  const speechOutputPane = el('section', { className: 'display-mode-pane speech-settings__pane' });
  speechOutputPane.append(
    speechSettingsHeading,
    speechHint,
    speechProviderRoadmap,
    createField('语音提供商', speechProviderSelect),
    createField('语音服务地址', speechBaseUrlInput),
    speechVoiceIdentityPanel,
    speechLanguageField,
    speechCustomLanguageField,
    createField('音频格式', speechFormatSelect),
    createField('语速', speechSpeedInput),
  );
  const speechInputPane = el('section', { className: 'display-mode-pane speech-settings__pane' });
  speechInputPane.append(
    speechInputEnabledHeading,
    speechInputModeFieldset,
    speechWakeWordSourceField,
    speechCustomWakeWordField,
    speechWakeWordHint,
    speechPushToTalkKeyField,
    speechPushToTalkHint,
    createField('中文识别接口', speechTranscriptionBaseUrlInput),
    createField('识别模型', speechTranscriptionModelInput),
    createField('识别语言', speechTranscriptionLanguageInput),
  );
  const speechAssetsPane = el('section', { className: 'display-mode-pane speech-settings__pane' });
  // Detached catalog view keeps the existing compact download indicator updated.
  const resourceCenterRoot = document.createElement('section');
  const speechAssetsCard = el('section', { className: 'character-search local-asset-card' });
  const speechAssetsTitle = el('strong', { textContent: '本地音色成品' });
  const speechAssetsSummary = document.createElement('p');
  speechAssetsSummary.className = 'settings-status';
  speechAssetsSummary.textContent = '正在检查本地音色…';
  const exportLocalVoiceButton = createButton('导出当前音色', 'secondary-button');
  const openSpeechTrainingSourcesButton = createButton('打开音源文件夹', 'secondary-button');
  const speechAssetsActions = el('div', { className: 'settings-actions local-asset-actions' });
  speechAssetsActions.append(exportLocalVoiceButton, openSpeechTrainingSourcesButton);
  const speechAssetsHint = el('small', { className: 'settings-hint' });
  speechAssetsHint.textContent =
    '导出到你选择的新文件夹；只复制训练成品和试听文件，不包含原始训练录音，也不会停止正在运行的 TTS。';
  speechAssetsCard.append(
    speechAssetsTitle,
    speechAssetsSummary,
    speechAssetsActions,
    speechAssetsHint,
  );
  const speechTrainingCard = el('section', { className: 'character-search local-asset-card' });
  const speechTrainingTitle = el('strong', { textContent: '训练新音色' });
  const speechTrainingDescription = el('small', { className: 'settings-hint' });
  speechTrainingDescription.textContent =
    '训练工具是可选组件。安装后可从这里启动；不安装也不影响现成音色和其他 TTS。';
  const speechTrainingActions = el('div', { className: 'settings-actions local-asset-actions' });
  const launchSpeechTrainerButton = createButton('启动本地训练工具', 'secondary-button');
  speechTrainingActions.append(launchSpeechTrainerButton);
  const speechTrainingStatus = el('p', { className: 'settings-status', attrs: { role: 'status' } });
  speechTrainingCard.append(
    speechTrainingTitle,
    speechTrainingDescription,
    speechTrainingActions,
    speechTrainingStatus,
  );
  speechAssetsPane.append(speechAssetsCard, speechTrainingCard);
  const speechPageBody = document.createElement('div');
  speechPageBody.className = 'display-mode-settings__body speech-settings__body';
  const speechPageTabs = document.createElement('nav');
  speechPageTabs.className = 'display-mode-tabs speech-settings__tabs';
  speechPageTabs.setAttribute('aria-label', '语音设置分类');
  const speechPageContent = document.createElement('div');
  speechPageContent.className = 'display-mode-content speech-settings__content';
  type SpeechSettingsPage = 'output' | 'input' | 'assets';
  const speechPanes = [
    ['output', '声音与音频生成', speechOutputPane],
    ['input', '中文麦克风输入', speechInputPane],
    ['assets', '音色与训练', speechAssetsPane],
  ] as const satisfies readonly (readonly [SpeechSettingsPage, string, HTMLElement])[];
  const speechPageButtons = new Map<SpeechSettingsPage, HTMLButtonElement>();
  const showSpeechPage = (page: SpeechSettingsPage): void => {
    for (const [candidate, , pane] of speechPanes) {
      const selected = candidate === page;
      pane.hidden = !selected;
      const button = speechPageButtons.get(candidate);
      button?.classList.toggle('is-active', selected);
      button?.setAttribute('aria-pressed', String(selected));
    }
  };
  for (const [page, label, pane] of speechPanes) {
    const button = createButton(label, 'display-mode-tab speech-settings__tab');
    button.setAttribute('aria-pressed', 'false');
    lifetime.on(button, 'click', () => showSpeechPage(page));
    speechPageButtons.set(page, button);
    speechPageTabs.append(button);
    speechPageContent.append(pane);
  }
  speechPageBody.append(speechPageTabs, speechPageContent);
  const speechCredentialPanel = el('section', { className: 'character-search speech-credentials' });
  const speechCredentialTitle = el('strong', { textContent: '语音服务凭据' });
  speechCredentialPanel.append(
    speechCredentialTitle,
    createField('语音 API Key', speechApiKeyInput),
    deleteSpeechSecretButton,
  );
  speechSettingsPanel.append(speechPageBody, speechCredentialPanel, speechStatus);
  const speechOpenAiCompatibleOption = [...speechProviderSelect.options].find(
    (option) => option.value === 'openai-compatible',
  )!;
  let bundledIreinaAvailable = false;
  const updateSpeechProviderFields = (applyDefaults = false): void => {
    const providerId = speechProviderSelect.value as SpeechSettings['providerId'];
    speechVoiceConfirmButton.hidden = providerId === 'disabled';
    speechVoiceFieldLabel.textContent = '音色 ID';
    speechVoiceIdentityHint.textContent =
      '模型决定使用哪套语音能力，音色 ID 决定该模型使用哪个说话人；确认后再点击右上角“保存”。';
    speechBaseUrlInput.readOnly = providerId === 'fish-audio';
    speechApiKeyInput.disabled = providerId === 'disabled' || providerId === 'genie-tts';
    if (providerId === 'fish-audio') {
      speechBaseUrlInput.value = 'https://api.fish.audio';
      speechApiKeyInput.placeholder = 'Fish Audio API Key（必填）';
      if (applyDefaults) {
        speechModelInput.value = 's2-pro';
        speechVoiceInput.value = '';
        speechVoiceInput.placeholder = 'Fish Audio reference_id';
        speechFormatSelect.value = 'mp3';
        displaySpeechLanguage('en-US');
        speechSpeedInput.value = '1';
      }
    } else if (providerId === 'genie-tts') {
      speechApiKeyInput.placeholder = 'Genie-TTS 本机服务不使用密钥';
      speechVoiceInput.placeholder = '已在 Genie 中加载的 character_name';
      speechVoiceIdentityHint.textContent =
        '内置音色：圣园未花（Mika），日语，出自《蔚蓝档案》。需安装 Genie-TTS 引擎、Genie 基础模型和该音色。也可填写自行启动的 Genie 服务和角色名；修改后点击“保存”。';
      if (applyDefaults) {
        speechBaseUrlInput.value = GENIE_MIKA_PRESET.baseUrl;
        speechModelInput.value = GENIE_MIKA_PRESET.modelId;
        speechVoiceInput.value = GENIE_MIKA_PRESET.voiceId;
        displaySpeechLanguage(GENIE_MIKA_PRESET.language);
        speechFormatSelect.value = 'wav';
        speechSpeedInput.value = '1';
      }
    } else {
      speechVoiceInput.placeholder = '音色 / speaker ID';
      if (providerId === 'disabled') speechApiKeyInput.placeholder = '语音已关闭';
      if (applyDefaults && providerId === 'openai-compatible') {
        speechBaseUrlInput.value = bundledIreinaAvailable
          ? BUNDLED_IREINA_SPEECH_PRESET.baseUrl
          : 'http://127.0.0.1:8000/v1';
        speechModelInput.value = bundledIreinaAvailable ? BUNDLED_IREINA_SPEECH_PRESET.modelId : '';
        speechVoiceInput.value = bundledIreinaAvailable ? BUNDLED_IREINA_SPEECH_PRESET.voiceId : '';
        speechFormatSelect.value = bundledIreinaAvailable
          ? BUNDLED_IREINA_SPEECH_PRESET.responseFormat
          : 'wav';
        displaySpeechLanguage(BUNDLED_IREINA_SPEECH_PRESET.language);
        speechSpeedInput.value = String(
          bundledIreinaAvailable ? BUNDLED_IREINA_SPEECH_PRESET.speed : 1,
        );
      }
    }
  };
  lifetime.on(speechVoiceConfirmButton, 'click', () => {
    if (!speechModelInput.value.trim()) {
      speechStatus.textContent = '请填写语音模型 ID。';
      showButtonFeedback(speechVoiceConfirmButton, '请检查', 'error', 1_200);
      speechModelInput.focus();
      return;
    }
    if (!speechVoiceInput.value.trim()) {
      speechStatus.textContent = '请填写音色 ID。';
      showButtonFeedback(speechVoiceConfirmButton, '请检查', 'error', 1_200);
      speechVoiceInput.focus();
      return;
    }
    if (!readSpeechLanguage()) {
      speechStatus.textContent = '请填写自定义语言代码。';
      showButtonFeedback(speechVoiceConfirmButton, '请检查', 'error', 1_200);
      speechLanguageInput.focus();
      return;
    }
    updateSpeechProviderFields();
    showButtonFeedback(speechVoiceConfirmButton, '已确认 ✓', 'success', 1_200);
    speechStatus.textContent = '音色已确认；请点击右上角“保存”使其生效。';
  });
  showSpeechPage('output');
  const displayLocalSpeechAssetStatus = (
    status: Awaited<ReturnType<NonNullable<typeof api>['getLocalSpeechAssetStatus']>>,
  ): void => {
    if (lifetime.disposed) return;
    bundledIreinaAvailable = status.voiceAvailable;
    speechOpenAiCompatibleOption.textContent = status.voiceAvailable
      ? '本机 Style-Bert-VITS2'
      : 'OpenAI 兼容 TTS（本机或在线）';
    updateSpeechProviderFields();
    exportLocalVoiceButton.disabled = !status.voiceAvailable;
    openSpeechTrainingSourcesButton.disabled = !status.trainingSourceReady;
    launchSpeechTrainerButton.disabled = !status.trainingToolAvailable;
    speechAssetsSummary.textContent = status.voiceAvailable
      ? `${status.voiceName}：${status.voiceFileCount} 个成品文件，约 ${Math.ceil(status.voiceBytes / 1024 / 1024)} MiB；风格：${status.styles.join('、') || '未标注'}`
      : '未找到完整的本地音色成品；语音接口设置仍可照常使用。';
    speechTrainingStatus.textContent = status.trainingToolAvailable
      ? '独立训练工具已就绪；只有点击“启动”后才会运行。'
      : '未找到本地训练工具；不会影响当前语音播放。';
  };

  lifetime.on(speechProviderSelect, 'change', () => {
    speechApiKeyInput.value = '';
    updateSpeechProviderFields(true);
    speechStatus.textContent =
      speechProviderSelect.value === 'fish-audio'
        ? '启用后，待合成文字会发送到 Fish Audio；API Key 只保存在本机安全存储。'
        : speechProviderSelect.value === 'genie-tts'
          ? '已选择圣园未花（日语）。安装三项配套资源后，启用语音并保存即可在后台准备。'
          : '语音设置尚未保存。';
  });
  lifetime.on(speechVoiceInput, 'input', () => {
    updateSpeechProviderFields();
  });
  lifetime.on(speechLanguageSelect, 'change', () => {
    updateSpeechLanguageVisibility();
    updateSpeechProviderFields();
    if (speechLanguageSelect.value === 'custom') speechLanguageInput.focus();
  });
  for (const input of [speechBaseUrlInput, speechModelInput, speechLanguageInput]) {
    lifetime.on(input, 'input', () => updateSpeechProviderFields());
  }
  lifetime.on(deleteSpeechSecretButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api || !window.confirm('确定删除已保存的语音 API Key 吗？')) return;
      const result = await api.deleteSpeechSecret();
      if (lifetime.disposed) return;
      speechStatus.textContent = result.ok ? '语音 API Key 已删除。' : result.message;
      const status = await api.getSpeechStatus();
      if (!lifetime.disposed) options.onStatus(status);
    })();
  });
  lifetime.on(exportLocalVoiceButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      exportLocalVoiceButton.disabled = true;
      speechAssetsSummary.textContent = '正在导出音色成品…';
      try {
        const result = await api.exportLocalVoice();
        if (lifetime.disposed) return;
        speechAssetsSummary.textContent = result.ok
          ? result.canceled
            ? '已取消音色导出。'
            : result.message
          : result.message;
      } catch {
        if (!lifetime.disposed) speechAssetsSummary.textContent = '音色导出失败，请重试。';
      } finally {
        const status = await api.getLocalSpeechAssetStatus().catch(() => undefined);
        if (status) displayLocalSpeechAssetStatus(status);
      }
    })();
  });
  const runSpeechTrainingAction = async (
    button: HTMLButtonElement,
    operation: () => ReturnType<NonNullable<typeof api>['openSpeechTrainingSources']>,
  ): Promise<void> => {
    if (lifetime.disposed || !api) return;
    button.disabled = true;
    try {
      const result = await operation();
      if (lifetime.disposed) return;
      speechTrainingStatus.textContent = result.ok
        ? result.canceled
          ? '已取消。'
          : result.message
        : result.message;
    } catch {
      if (!lifetime.disposed) speechTrainingStatus.textContent = '操作失败，请重试。';
    } finally {
      if (!lifetime.disposed) button.disabled = false;
    }
  };
  lifetime.on(openSpeechTrainingSourcesButton, 'click', () => {
    void runSpeechTrainingAction(openSpeechTrainingSourcesButton, () =>
      api!.openSpeechTrainingSources(),
    );
  });
  lifetime.on(launchSpeechTrainerButton, 'click', () => {
    void runSpeechTrainingAction(launchSpeechTrainerButton, () => api!.launchSpeechTrainer());
  });
  let speechReadinessRefreshInFlight = false;
  const speechReadinessRefreshTimer = window.setInterval(() => {
    if (
      lifetime.disposed ||
      !api ||
      !options.getStatus()?.output.preparing ||
      speechReadinessRefreshInFlight
    )
      return;
    speechReadinessRefreshInFlight = true;
    const previous = options.getStatus()!;
    void api
      .getSpeechStatus()
      .then((status) => {
        if (lifetime.disposed || options.getStatus() !== previous) return;
        // Update readiness only; polling must not overwrite unsaved settings fields.
        options.setReadiness({ ...previous, output: status.output });
        speechStatus.textContent = status.output.detail + ' ' + previous.input.detail;
      })
      .catch(() => undefined)
      .finally(() => {
        speechReadinessRefreshInFlight = false;
      });
  }, 1000);

  return {
    elements: {
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
    },
    displayLocalSpeechAssetStatus,
    dispose(): void {
      lifetime.dispose();
      feedback.dispose();
      window.clearInterval(speechReadinessRefreshTimer);
      speechApiKeyInput.value = '';
    },
  };
};
