import type { DeskpetApi } from '../../shared/ipc';
import type { ConfigurableProviderId } from '../../shared/model-ipc';
import type { PublicLlmError } from '../../core/llm/contracts';
import { el, createButton, createField } from './elements';
import { createPanelLifetime } from './panel-lifetime';

interface ProviderPanelOptions {
  api:
    | Pick<
        DeskpetApi,
        | 'getProviderSecretStatus'
        | 'testProviderConnection'
        | 'deleteProviderSecret'
        | 'cancelProviderRequest'
      >
    | undefined;
  save(status: HTMLParagraphElement): Promise<boolean>;
  setStatus(message: string): void;
  formatError(error: PublicLlmError): string;
  createRequestId(): string;
  confirm?: (message: string) => boolean;
}

export const mountProviderSettings = (options: ProviderPanelOptions) => {
  const { api } = options;
  const lifetime = createPanelLifetime();
  const confirm = options.confirm ?? ((message: string) => window.confirm(message));
  let pendingTest: string | undefined;
  const providerSelect = document.createElement('select');
  for (const [value, label] of [
    ['anthropic', 'Anthropic Claude'],
    ['deepseek', 'DeepSeek'],
    ['openai-compatible', 'OpenAI / Ollama 兼容'],
  ]) {
    const option = el('option', { value: value, textContent: label });
    providerSelect.append(option);
  }
  const modelInput = el('input', { maxLength: 256, placeholder: '例如 Claude 或本地模型 ID' });
  const baseUrlInput = el('input', { type: 'url', maxLength: 2_048 });
  baseUrlInput.placeholder = '例如：http://127.0.0.1:11434/v1';
  const modelCollaborationPanel = el('section', { className: 'character-search' });
  const modelCollaborationHeading = el('label', { className: 'settings-toggle-heading' });
  const modelCollaborationTitle = el('strong', { textContent: '本地 / 远端模型协作' });
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
    const option = el('option', { value: value, textContent: label });
    remoteProviderSelect.append(option);
  }
  const remoteModelInput = el('input', { maxLength: 256, placeholder: '远端模型 ID' });
  const remoteApiKeyInput = document.createElement('input');
  remoteApiKeyInput.type = 'password';
  remoteApiKeyInput.maxLength = 32_768;
  remoteApiKeyInput.autocomplete = 'off';
  remoteApiKeyInput.placeholder = '留空则保留远端提供商已有密钥';
  const remoteSecretStatus = el('p', { className: 'settings-status' });
  const modelCollaborationStatus = el('p', { className: 'settings-status' });
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
  const secretStatus = el('small', { className: 'settings-status' });
  const secretRow = el('div', { className: 'settings-secret-row' });
  const deleteSecretButton = createButton('删除当前密钥', 'text-button');
  deleteSecretButton.hidden = true;
  secretRow.append(secretStatus, deleteSecretButton);
  const connectionStatus = document.createElement('p');
  connectionStatus.className = 'settings-status connection-status';
  connectionStatus.setAttribute('role', 'status');
  connectionStatus.setAttribute('aria-live', 'polite');
  const testButton = createButton('测试连接', 'secondary-button');
  const connectionActions = el('div', { className: 'settings-actions connection-actions' });
  connectionActions.append(testButton);
  const baseUrlField = createField('兼容接口地址（仅 OpenAI / Ollama）', baseUrlInput);
  const baseUrlHint = document.createElement('small');
  baseUrlHint.className = 'settings-hint';
  baseUrlHint.textContent = '用于连接本地 Ollama 或其他 OpenAI 兼容服务；Claude 不使用此地址。';
  baseUrlField.append(baseUrlHint);
  baseUrlField.hidden = true;

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
    if (lifetime.disposed || !api) {
      return;
    }
    const secrets = await api.getProviderSecretStatus();
    if (lifetime.disposed) return;
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

  lifetime.on(providerSelect, 'change', () => {
    updateProviderVisibility();
    remoteApiKeyInput.value = '';
    connectionStatus.textContent = '';
    void updateSecretStatus();
  });
  lifetime.on(allowRemoteComplexTasksInput, 'change', () => {
    updateCollaborationVisibility();
    void updateSecretStatus();
  });
  lifetime.on(remoteProviderSelect, 'change', () => {
    remoteApiKeyInput.value = '';
    void updateSecretStatus();
  });
  lifetime.on(modelInput, 'input', () => {
    connectionStatus.textContent = '';
  });
  lifetime.on(baseUrlInput, 'input', () => {
    connectionStatus.textContent = '';
  });
  lifetime.on(apiKeyInput, 'input', () => {
    connectionStatus.textContent = '';
  });
  lifetime.on(testButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) {
        return;
      }
      if (!modelInput.value.trim()) {
        connectionStatus.textContent = '请填写 AI 对话模型名称。';
        modelInput.focus();
        return;
      }
      if (!(await options.save(connectionStatus))) {
        return;
      }
      if (lifetime.disposed) return;
      connectionStatus.textContent = '正在测试连接…';
      testButton.disabled = true;
      const requestId = options.createRequestId();
      pendingTest = requestId;
      try {
        const result = await api.testProviderConnection({
          requestId,
          providerId: providerSelect.value as ConfigurableProviderId,
          modelId: modelInput.value.trim(),
        });
        if (lifetime.disposed) return;
        connectionStatus.textContent = result.ok
          ? `连接成功，约 ${result.latencyMs} ms。`
          : options.formatError(result.error);
      } catch {
        if (!lifetime.disposed) connectionStatus.textContent = '连接测试失败，请检查配置后重试。';
      } finally {
        pendingTest = undefined;
        if (!lifetime.disposed) testButton.disabled = false;
      }
    })();
  });
  lifetime.on(deleteSecretButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api || !confirm('确定删除当前提供商已保存的 API Key 吗？')) {
        return;
      }
      const providerId = providerSelect.value as ConfigurableProviderId;
      const result = await api.deleteProviderSecret({ providerId });
      if (lifetime.disposed) return;
      options.setStatus(result.ok ? '密钥已删除。' : result.error.message);
      await updateSecretStatus();
    })();
  });

  return {
    elements: {
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
    },
    updateProviderVisibility,
    updateCollaborationVisibility,
    updateSecretStatus,
    dispose(): void {
      lifetime.dispose();
      if (pendingTest) {
        void api?.cancelProviderRequest({ requestId: pendingTest });
        pendingTest = undefined;
      }
      apiKeyInput.value = '';
      remoteApiKeyInput.value = '';
    },
  };
};
