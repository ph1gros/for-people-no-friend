import type { DeskpetApi } from '../../shared/ipc';
import type { CharacterDisplayMode } from '../../shared/character-display-ipc';
import { CHARACTER_EMOTIONS, type CharacterEmotion } from '../../core/character/character-reply';
import {
  DEFAULT_VIEWEREX_SETTINGS,
  type ViewerExSettings,
  type ViewerExStatus,
} from '../../shared/viewerex-ipc';
import {
  DEFAULT_VTUBE_STUDIO_SETTINGS,
  type VTubeStudioConnectionReason,
  type VTubeStudioInspectResult,
  type VTubeStudioInventory,
  type VTubeStudioModelMapping,
  type VTubeStudioSettings,
  type VTubeStudioStatus,
} from '../../shared/vtube-studio-ipc';
import {
  formatViewerExMappingDraft,
  parseViewerExMappingDraft,
  type ViewerExMappings,
} from '../viewerex/viewerex-mapping-draft';
import { el, createButton, createField } from './elements';
import { createPanelLifetime } from './panel-lifetime';
import { createButtonFeedback } from './panel-feedback';
interface VTubePanelOptions {
  api:
    | Pick<
        DeskpetApi,
        | 'getVTubeStudioStatus'
        | 'inspectVTubeStudio'
        | 'setVTubeStudioSettings'
        | 'authorizeVTubeStudio'
        | 'launchVTubeStudio'
        | 'installBundledVTubeStudioModel'
        | 'presentInVTubeStudio'
        | 'previewVTubeStudioExpression'
        | 'setViewerExSettings'
        | 'presentInViewerEx'
      >
    | undefined;
  setDisplayModeInputs(mode: CharacterDisplayMode): void;
  persistCharacterDisplayMode(
    mode: CharacterDisplayMode,
  ): Promise<{ ok: boolean; message?: string }>;
  closeDrawers(): void;
}
export const mountVTubeSettings = (options: VTubePanelOptions) => {
  const { api } = options;
  const lifetime = createPanelLifetime();
  const feedback = createButtonFeedback();
  const { showButtonFeedback } = feedback;
  const viewerExSettingsPanel = el('section', { className: 'display-mode-pane' });
  const viewerExSettingsHeading = el('label', { className: 'settings-toggle-heading' });
  const viewerExSettingsTitle = el('strong', { textContent: '启用 Live2DViewerEX' });
  const viewerExEnabledInput = document.createElement('input');
  viewerExEnabledInput.type = 'checkbox';
  viewerExEnabledInput.setAttribute('aria-label', '启用 Live2DViewerEX 显示适配');
  viewerExSettingsHeading.append(viewerExSettingsTitle, viewerExEnabledInput);
  const viewerExPortInput = el('input', { type: 'number', min: '10086', max: '10150', step: '1' });
  const viewerExModelIndexInput = el('input', { type: 'number', min: '0', max: '7', step: '1' });
  const viewerExWorkshopItemInput = document.createElement('input');
  viewerExWorkshopItemInput.inputMode = 'numeric';
  viewerExWorkshopItemInput.maxLength = 20;
  viewerExWorkshopItemInput.placeholder = '例如：2380801353';
  const viewerExBubbleInput = document.createElement('input');
  viewerExBubbleInput.type = 'checkbox';
  viewerExBubbleInput.setAttribute('aria-label', '在 ViewerEX 显示回复气泡');
  const viewerExTestButton = createButton('发送本机测试气泡', 'secondary-button');
  const viewerExStateMotionsInput = document.createElement('textarea');
  viewerExStateMotionsInput.rows = 3;
  viewerExStateMotionsInput.placeholder = 'thinking=idle:think\ntalking=talk';
  const viewerExEmotionExpressionsInput = document.createElement('textarea');
  viewerExEmotionExpressionsInput.rows = 4;
  viewerExEmotionExpressionsInput.placeholder = 'happy=0\nsad=1';
  const viewerExActionMotionsInput = el('textarea', { rows: 4, placeholder: 'wave=tap:wave_1' });
  const viewerExMappingTestButton = createButton('测试 talking / happy 映射', 'secondary-button');
  const viewerExStatus = el('p', { className: 'settings-status', attrs: { role: 'status' } });
  const viewerExHint = el('small', { className: 'settings-hint' });
  viewerExHint.textContent =
    '启用后由 ViewerEX 负责角色显示，FPNF 不再加载内置凯尔希。仅连接 127.0.0.1 的官方 ExAPI；不会读取 LPK，也不会发送文件路径或声音。';
  viewerExSettingsPanel.append(
    viewerExSettingsHeading,
    viewerExHint,
    createField('ExAPI 端口', viewerExPortInput),
    createField('模型序号（从 0 开始）', viewerExModelIndexInput),
    createField('Steam 创意工坊编号（仅作标识）', viewerExWorkshopItemInput),
    createField('显示回复气泡', viewerExBubbleInput),
    viewerExTestButton,
    createField('状态动作映射', viewerExStateMotionsInput),
    createField('情绪表情编号映射', viewerExEmotionExpressionsInput),
    createField('角色动作映射', viewerExActionMotionsInput),
    viewerExMappingTestButton,
    viewerExStatus,
  );
  let viewerExMappings: ViewerExMappings = {
    stateMotions: {},
    emotionExpressions: {},
    actionMotions: {},
  };
  const readViewerExSettings = (): ViewerExSettings => ({
    ...DEFAULT_VIEWEREX_SETTINGS,
    ...parseViewerExMappingDraft({
      stateMotions: viewerExStateMotionsInput.value,
      emotionExpressions: viewerExEmotionExpressionsInput.value,
      actionMotions: viewerExActionMotionsInput.value,
    }),
    enabled: viewerExEnabledInput.checked,
    port: Number(viewerExPortInput.value),
    modelIndex: Number(viewerExModelIndexInput.value),
    workshopItemId: viewerExWorkshopItemInput.value.trim(),
    bubbleEnabled: viewerExBubbleInput.checked,
  });
  const vTubeStudioSettingsPanel = el('section', { className: 'display-mode-pane' });
  const vTubeStudioSettingsHeading = el('label', { className: 'settings-toggle-heading' });
  const vTubeStudioSettingsTitle = el('strong', { textContent: '启用 VTube Studio' });
  const vTubeStudioEnabledInput = document.createElement('input');
  vTubeStudioEnabledInput.type = 'checkbox';
  vTubeStudioEnabledInput.setAttribute('aria-label', '启用 VTube Studio 显示适配');
  vTubeStudioSettingsHeading.append(vTubeStudioSettingsTitle, vTubeStudioEnabledInput);
  const vTubeStudioPortInput = document.createElement('input');
  vTubeStudioPortInput.type = 'number';
  vTubeStudioPortInput.min = '1024';
  vTubeStudioPortInput.max = '65535';
  vTubeStudioPortInput.step = '1';
  const vTubeStudioMouseTrackingHeading = el('label', { className: 'settings-toggle-heading' });
  const vTubeStudioMouseTrackingTitle = el('strong', { textContent: '鼠标追踪' });
  const vTubeStudioMouseTrackingInput = document.createElement('input');
  vTubeStudioMouseTrackingInput.type = 'checkbox';
  vTubeStudioMouseTrackingInput.setAttribute('aria-label', '让 VTube Studio 角色追踪鼠标');
  vTubeStudioMouseTrackingHeading.append(
    vTubeStudioMouseTrackingTitle,
    vTubeStudioMouseTrackingInput,
  );
  const vTubeStudioMouseTrackingHint = document.createElement('small');
  vTubeStudioMouseTrackingHint.className = 'settings-hint settings-toggle-hint';
  vTubeStudioMouseTrackingHint.textContent =
    '鼠标移动时由眼睛和头部平滑跟随；静止后逐渐恢复随机待机。';
  const vTubeStudioLaunchButton = createButton('启动 VTube Studio', 'secondary-button');
  const vTubeStudioInstallModelButton = createButton('安装模型', 'secondary-button');
  const vTubeStudioConnectButton = createButton('连接 VTube Studio', 'secondary-button');
  const vTubeStudioExpressionTestButton = createButton('测试惊讶表情', 'secondary-button');
  const vTubeStudioExpressionSelect = document.createElement('select');
  vTubeStudioExpressionSelect.setAttribute('aria-label', '要预览的 VTube Studio 表情');
  vTubeStudioExpressionSelect.disabled = true;
  const vTubeStudioExpressionPreviewButton = createButton('预览并返回桌面', 'secondary-button');
  vTubeStudioExpressionPreviewButton.disabled = true;
  const vTubeStudioExpressionRestoreButton = createButton('关闭预览', 'text-button');
  const vTubeStudioEmotionSelect = document.createElement('select');
  for (const emotion of CHARACTER_EMOTIONS) {
    if (emotion === 'neutral') continue;
    const option = el('option', { value: emotion, textContent: emotion });
    vTubeStudioEmotionSelect.append(option);
  }
  const vTubeStudioMapExpressionButton = createButton('把所选表情映射到该情绪', 'secondary-button');
  vTubeStudioMapExpressionButton.disabled = true;
  const vTubeStudioConfirmSuggestionsButton = createButton(
    '确认自动识别的映射',
    'secondary-button',
  );
  vTubeStudioConfirmSuggestionsButton.disabled = true;
  const vTubeStudioActionSelect = document.createElement('select');
  for (const [action, label] of [
    ['nod', '肯定 / 点头'],
    ['shake', '否定 / 摇头'],
  ] as const) {
    const option = el('option', { value: action, textContent: label });
    vTubeStudioActionSelect.append(option);
  }
  const vTubeStudioActionHotkeySelect = el('select', { disabled: true });
  const vTubeStudioMapActionButton = createButton('把所选动画映射到该动作', 'secondary-button');
  vTubeStudioMapActionButton.disabled = true;
  const vTubeStudioMappingSummary = el('small', { className: 'settings-hint' });
  const vTubeStudioExpressionActions = el('div', { className: 'settings-actions' });
  vTubeStudioExpressionActions.append(
    vTubeStudioExpressionPreviewButton,
    vTubeStudioExpressionRestoreButton,
  );
  const vTubeStudioStatus = el('p', { className: 'settings-status', attrs: { role: 'status' } });
  const vTubeStudioInventory = el('p', { className: 'settings-hint' });
  const vTubeStudioParameterDetails = el('details', { className: 'character-lore' });
  const vTubeStudioParameterSummary = el('summary', { textContent: '查看模型参数' });
  const vTubeStudioParameterList = el('small', { className: 'settings-hint' });
  vTubeStudioParameterDetails.append(vTubeStudioParameterSummary, vTubeStudioParameterList);
  const vTubeStudioHint = el('small', { className: 'settings-hint' });
  vTubeStudioHint.textContent =
    '连接时会自动寻找端口并请求 VTube Studio 授权；不用另外下载 Spout2，VTube Studio 和 FPNF 已包含显示所需组件。';
  const vTubeStudioSetupNotice = document.createElement('p');
  vTubeStudioSetupNotice.className = 'settings-status vtube-studio-setup-notice';
  vTubeStudioSetupNotice.setAttribute('role', 'alert');
  vTubeStudioSetupNotice.hidden = true;
  const showVTubeStudioSetupNotice = (
    reason?: VTubeStudioConnectionReason | 'spout-disabled',
  ): void => {
    if (!reason) {
      vTubeStudioSetupNotice.hidden = true;
      vTubeStudioSetupNotice.textContent = '';
      return;
    }
    vTubeStudioSetupNotice.hidden = false;
    vTubeStudioSetupNotice.textContent =
      reason === 'api-disabled'
        ? '只需在 VTube Studio 设置首页打开“允许插件 API 访问（Allow Plugin API access）”，然后回来再次点“连接 VTube Studio”。端口和授权都由 FPNF 自动处理。'
        : reason === 'spout-disabled'
          ? 'API 已连接。要在桌面显示模型，请在 VTube Studio 打开 Spout2 输出；无需下载安装 OBS 插件。'
          : '请先启动 VTube Studio，然后再次点“连接 VTube Studio”。';
  };
  const vTubeStudioTroubleshooting = document.createElement('details');
  vTubeStudioTroubleshooting.className = 'character-lore vtube-studio-troubleshooting';
  const vTubeStudioTroubleshootingSummary = el('summary', { textContent: '连接故障排查' });
  const vTubeStudioTroubleshootingHint = el('small', { className: 'settings-hint' });
  vTubeStudioTroubleshootingHint.textContent =
    '一般无需修改。只有自动发现失败时，才把 VTube Studio 中显示的 Plugin API 端口填到这里。';
  vTubeStudioTroubleshooting.append(
    vTubeStudioTroubleshootingSummary,
    vTubeStudioTroubleshootingHint,
    createField('手动端口', vTubeStudioPortInput),
  );
  const vTubeStudioGuide = el('details', { className: 'character-lore vtube-studio-guide' });
  const vTubeStudioGuideSummary = el('summary', { textContent: '新模型接入与调教参考' });
  const vTubeStudioGuideList = document.createElement('ul');
  for (const item of [
    '先启动 VTube Studio、加载模型，并在主设置页开启“允许插件 API 访问”；默认端口 8001，被占用时实际端口可能变成 8002 或更高。',
    '再授权并读取模型，在 VTube Studio 弹窗中点“允许”，确认头部角度、眼球、睁眼参数以及表情清单是否存在。',
    '关闭 VTube Studio 人脸追踪，避免和 FPNF 的随机待机、眨眼、鼠标追踪互相抢参数。',
    '逐个预览表情，再让 AI 接管；参数范围不同的模型要单独校准，不能直接照搬 0～1。',
    '休息状态会慢慢闭眼和点头；鼠标靠近只微睁，收到消息后缓慢完全醒来。',
    'VTube Studio 模型仍留在它自己的应用中；这里不会复制或导出其模型文件。',
  ]) {
    const row = el('li', { textContent: item });
    vTubeStudioGuideList.append(row);
  }
  vTubeStudioGuide.append(vTubeStudioGuideSummary, vTubeStudioGuideList);
  vTubeStudioSettingsPanel.append(
    vTubeStudioSettingsHeading,
    vTubeStudioHint,
    vTubeStudioSetupNotice,
    vTubeStudioMouseTrackingHeading,
    vTubeStudioMouseTrackingHint,
    vTubeStudioLaunchButton,
    vTubeStudioInstallModelButton,
    vTubeStudioConnectButton,
    vTubeStudioExpressionTestButton,
    createField('逐个查看模型表情', vTubeStudioExpressionSelect),
    vTubeStudioExpressionActions,
    createField('映射为角色情绪', vTubeStudioEmotionSelect),
    vTubeStudioMapExpressionButton,
    vTubeStudioConfirmSuggestionsButton,
    createField('角色动作', vTubeStudioActionSelect),
    createField('模型动画热键', vTubeStudioActionHotkeySelect),
    vTubeStudioMapActionButton,
    vTubeStudioMappingSummary,
    vTubeStudioStatus,
    vTubeStudioInventory,
    vTubeStudioParameterDetails,
    vTubeStudioTroubleshooting,
    vTubeStudioGuide,
  );
  let vTubeStudioEmotionMappings: Partial<Record<CharacterEmotion, string>> = {};
  let vTubeStudioActionMappings: Record<string, string> = {};
  let vTubeStudioModelMappings: Record<string, VTubeStudioModelMapping> = {};
  let currentVTubeStudioMapping: VTubeStudioInspectResult['mapping'];
  const renderVTubeStudioMappings = (): void => {
    const emotionEntries = Object.entries(vTubeStudioEmotionMappings);
    const actionEntries = Object.entries(vTubeStudioActionMappings);
    const suggestionCount = currentVTubeStudioMapping
      ? Object.keys(currentVTubeStudioMapping.suggestions.emotionExpressions).length +
        Object.keys(currentVTubeStudioMapping.suggestions.actionHotkeys).length
      : 0;
    vTubeStudioMappingSummary.textContent = currentVTubeStudioMapping
      ? [
          `当前模型：${currentVTubeStudioMapping.modelName}`,
          emotionEntries.length
            ? `已确认表情：${emotionEntries.map(([emotion, file]) => `${emotion} → ${file}`).join('；')}`
            : '尚未确认表情映射',
          actionEntries.length
            ? `已确认动作：${actionEntries.map(([action]) => action).join('、')}`
            : '点头、摇头会使用内置轻动作；也可绑定模型动画',
          suggestionCount ? `自动识别到 ${suggestionCount} 项候选，确认后才会交给 AI 使用。` : '',
        ]
          .filter(Boolean)
          .join('；')
      : '连接并读取模型后，会为每个模型单独保存表情和动作映射。';
  };
  renderVTubeStudioMappings();
  const readVTubeStudioSettings = (): VTubeStudioSettings => ({
    ...DEFAULT_VTUBE_STUDIO_SETTINGS,
    enabled: vTubeStudioEnabledInput.checked,
    port: Number(vTubeStudioPortInput.value),
    mouseTrackingEnabled: vTubeStudioMouseTrackingInput.checked,
    emotionExpressions: {},
    modelMappings: { ...vTubeStudioModelMappings },
  });

  const displayViewerExStatus = (status: ViewerExStatus): void => {
    if (lifetime.disposed) return;
    viewerExPortInput.value = String(status.settings.port);
    viewerExModelIndexInput.value = String(status.settings.modelIndex);
    viewerExWorkshopItemInput.value = status.settings.workshopItemId;
    viewerExBubbleInput.checked = status.settings.bubbleEnabled;
    viewerExMappings = {
      stateMotions: { ...status.settings.stateMotions },
      emotionExpressions: { ...status.settings.emotionExpressions },
      actionMotions: { ...status.settings.actionMotions },
    };
    viewerExStateMotionsInput.value = formatViewerExMappingDraft(viewerExMappings.stateMotions);
    viewerExEmotionExpressionsInput.value = formatViewerExMappingDraft(
      viewerExMappings.emotionExpressions,
    );
    viewerExActionMotionsInput.value = formatViewerExMappingDraft(viewerExMappings.actionMotions);
    viewerExStatus.textContent = status.detail;
  };

  let currentVTubeStudioInventory: VTubeStudioInventory | undefined;
  const selectCurrentVTubeStudioMapping = (): void => {
    const modelId = currentVTubeStudioInventory?.model.id;
    if (!modelId || !currentVTubeStudioMapping) {
      vTubeStudioEmotionMappings = {};
      vTubeStudioActionMappings = {};
      vTubeStudioConfirmSuggestionsButton.disabled = true;
      renderVTubeStudioMappings();
      return;
    }
    const confirmed = vTubeStudioModelMappings[modelId] ?? currentVTubeStudioMapping.confirmed;
    vTubeStudioEmotionMappings = { ...(confirmed?.emotionExpressions ?? {}) };
    vTubeStudioActionMappings = { ...(confirmed?.actionHotkeys ?? {}) };
    const suggestions = currentVTubeStudioMapping.suggestions;
    vTubeStudioConfirmSuggestionsButton.disabled =
      Object.keys(suggestions.emotionExpressions).length === 0 &&
      Object.keys(suggestions.actionHotkeys).length === 0;
    renderVTubeStudioMappings();
  };
  const updateCurrentVTubeStudioModelMapping = (): boolean => {
    const model = currentVTubeStudioInventory?.model;
    if (!model?.id) return false;
    vTubeStudioModelMappings[model.id] = {
      modelName: model.name,
      emotionExpressions: { ...vTubeStudioEmotionMappings },
      actionHotkeys: { ...vTubeStudioActionMappings },
    };
    return true;
  };
  const displayVTubeStudioInventory = (
    inventory?: VTubeStudioInventory,
    mapping?: VTubeStudioInspectResult['mapping'],
  ): void => {
    currentVTubeStudioInventory = inventory;
    currentVTubeStudioMapping = mapping;
    vTubeStudioExpressionSelect.replaceChildren();
    vTubeStudioActionHotkeySelect.replaceChildren();
    vTubeStudioParameterDetails.hidden = !inventory?.parameters.length;
    vTubeStudioParameterList.textContent = inventory?.parameters.length
      ? inventory.parameters
          .map(
            (parameter) =>
              `${parameter.name}（${parameter.minimum}～${parameter.maximum}，当前 ${parameter.value}）`,
          )
          .join('、')
      : '';
    vTubeStudioParameterSummary.textContent = inventory?.parameters.length
      ? `查看全部 ${inventory.parameters.length} 个模型参数`
      : '查看模型参数';
    vTubeStudioExpressionSelect.disabled = !inventory?.expressions.length;
    vTubeStudioExpressionPreviewButton.disabled = !inventory?.expressions.length;
    vTubeStudioMapExpressionButton.disabled = !inventory?.expressions.length;
    const actionHotkeys =
      inventory?.hotkeys.filter((hotkey) => hotkey.type === 'TriggerAnimation') ?? [];
    for (const hotkey of actionHotkeys) {
      const option = document.createElement('option');
      option.value = hotkey.hotkeyId;
      option.textContent = `${hotkey.name}${hotkey.file ? `（${hotkey.file}）` : ''}`;
      vTubeStudioActionHotkeySelect.append(option);
    }
    vTubeStudioActionHotkeySelect.disabled = actionHotkeys.length === 0;
    vTubeStudioMapActionButton.disabled = actionHotkeys.length === 0;
    selectCurrentVTubeStudioMapping();
    if (!inventory) {
      vTubeStudioInventory.textContent = '';
      return;
    }
    inventory.expressions.forEach((expression, index) => {
      const option = el('option', { value: String(index) });
      const details = [
        ...expression.parameters.map((parameter) => parameter.name),
        ...expression.hotkeyNames,
      ].filter((value, detailIndex, values) => values.indexOf(value) === detailIndex);
      option.textContent = `${index + 1}. ${expression.name}${details.length ? `（${details.join('、')}）` : ''}`;
      vTubeStudioExpressionSelect.append(option);
    });
    const expressionNames = inventory.expressions.map((expression) => expression.name).join('、');
    const hotkeyNames = inventory.hotkeys.map((hotkey) => hotkey.name).join('、');
    vTubeStudioInventory.textContent = inventory.model.loaded
      ? `当前模型：${inventory.model.name}；${inventory.hotkeys.length} 个热键${hotkeyNames ? `（${hotkeyNames}）` : ''}；${inventory.expressions.length} 个表情${expressionNames ? `（${expressionNames}）` : ''}。`
      : 'VTube Studio 当前没有加载模型。';
  };

  const displayVTubeStudioStatus = (status: VTubeStudioStatus): void => {
    if (lifetime.disposed) return;
    vTubeStudioPortInput.value = String(status.settings.port);
    vTubeStudioMouseTrackingInput.checked = status.settings.mouseTrackingEnabled;
    vTubeStudioModelMappings = { ...(status.settings.modelMappings ?? {}) };
    selectCurrentVTubeStudioMapping();
    vTubeStudioStatus.textContent = status.detail;
    vTubeStudioConnectButton.textContent = '连接 VTube Studio';
    if (status.detail.includes('没有发现 Spout2 输出')) {
      showVTubeStudioSetupNotice('spout-disabled');
    }
    vTubeStudioInstallModelButton.hidden = !status.bundledModelAvailable;
  };

  let vTubeStudioInspectionInFlight = false;
  const inspectSelectedVTubeStudio = async (): Promise<boolean> => {
    if (lifetime.disposed || !api || vTubeStudioInspectionInFlight) return false;
    vTubeStudioInspectionInFlight = true;
    displayVTubeStudioInventory();
    try {
      const status = await api.getVTubeStudioStatus();
      if (lifetime.disposed) return false;
      displayVTubeStudioStatus(status);
      if (!status.settings.enabled || !status.authorized) return false;
      vTubeStudioStatus.textContent = '正在读取当前模型、表情和动画…';
      const inspected = await api.inspectVTubeStudio();
      if (lifetime.disposed) return false;
      if (!inspected.ok) {
        if (inspected.reason === 'api-disabled') {
          showVTubeStudioSetupNotice(inspected.reason);
        }
        vTubeStudioStatus.textContent = inspected.message ?? '无法读取 VTube Studio 模型。';
        return false;
      }
      showVTubeStudioSetupNotice();
      displayVTubeStudioInventory(inspected.inventory, inspected.mapping);
      displayVTubeStudioStatus(await api.getVTubeStudioStatus());
      if (lifetime.disposed) return false;
      return true;
    } catch {
      if (!lifetime.disposed) vTubeStudioStatus.textContent = '读取失败，请检查本机服务后重试。';
      return false;
    } finally {
      vTubeStudioInspectionInFlight = false;
    }
  };
  const activateConnectedVTubeStudio = async (): Promise<boolean> => {
    if (lifetime.disposed || !api) return false;
    const displayResult = await options.persistCharacterDisplayMode('vtube-studio');
    if (lifetime.disposed) return false;
    if (!displayResult.ok) {
      vTubeStudioStatus.textContent =
        displayResult.message ?? 'VTube Studio 已连接，但角色显示方式无法启用。';
      return false;
    }
    return true;
  };
  lifetime.on(viewerExTestButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      viewerExTestButton.disabled = true;
      viewerExStatus.textContent = '正在连接本机 ViewerEX…';
      try {
        const saved = await api.setViewerExSettings({ settings: readViewerExSettings() });
        if (lifetime.disposed) return;
        if (!saved.ok) {
          viewerExStatus.textContent = saved.message ?? 'ViewerEX 设置无法保存。';
          return;
        }
        const sent = await api.presentInViewerEx({ text: 'For People No Friend 已连接。' });
        if (lifetime.disposed) return;
        viewerExStatus.textContent = sent
          ? '测试气泡已发送到本机 ViewerEX。'
          : '未连接到 ExAPI；请先在 ViewerEX 启动模型并确认端口。';
      } catch (error) {
        viewerExStatus.textContent =
          error instanceof Error ? error.message : 'ViewerEX 映射格式无效。';
      } finally {
        viewerExTestButton.disabled = false;
      }
    })().catch(() => {
      if (!lifetime.disposed) vTubeStudioStatus.textContent = '操作失败，请检查本机服务后重试。';
    });
  });
  lifetime.on(viewerExMappingTestButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      viewerExMappingTestButton.disabled = true;
      viewerExStatus.textContent = '正在测试 ViewerEX 映射…';
      try {
        const settings = readViewerExSettings();
        const saved = await api.setViewerExSettings({ settings });
        if (lifetime.disposed) return;
        if (!saved.ok) {
          viewerExStatus.textContent = saved.message ?? 'ViewerEX 设置无法保存。';
          return;
        }
        const firstAction = Object.keys(settings.actionMotions)[0];
        const sent = await api.presentInViewerEx({
          state: 'talking',
          emotion: 'happy',
          ...(firstAction ? { action: firstAction } : {}),
        });
        if (lifetime.disposed) return;
        viewerExStatus.textContent = sent
          ? '已发送 talking、happy 和首个角色动作映射。'
          : '没有可发送的映射，或 ViewerEX 未连接。';
      } catch (error) {
        viewerExStatus.textContent =
          error instanceof Error ? error.message : 'ViewerEX 映射格式无效。';
      } finally {
        viewerExMappingTestButton.disabled = false;
      }
    })().catch(() => {
      if (!lifetime.disposed) vTubeStudioStatus.textContent = '操作失败，请检查本机服务后重试。';
    });
  });
  lifetime.on(vTubeStudioConnectButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      vTubeStudioConnectButton.disabled = true;
      displayVTubeStudioInventory();
      showVTubeStudioSetupNotice();
      try {
        options.setDisplayModeInputs('vtube-studio');
        const saved = await api.setVTubeStudioSettings({ settings: readVTubeStudioSettings() });
        if (lifetime.disposed) return;
        if (!saved.ok) {
          vTubeStudioStatus.textContent = saved.message ?? 'VTube Studio 设置无法保存。';
          return;
        }
        let status = await api.getVTubeStudioStatus();
        if (lifetime.disposed) return;
        displayVTubeStudioStatus(status);
        if (status.authorized) {
          const connected = await inspectSelectedVTubeStudio();
          if (lifetime.disposed) return;
          status = await api.getVTubeStudioStatus();
          if (lifetime.disposed) return;
          if (connected) {
            await activateConnectedVTubeStudio();
            if (lifetime.disposed) return;
            return;
          }
          if (status.authorized) return;
          vTubeStudioStatus.textContent = '授权已失效，正在重新请求 VTube Studio 授权…';
        }
        if (!status.authorized) {
          vTubeStudioStatus.textContent = '请在 VTube Studio 弹窗中点“允许”…';
          const authorization = await api.authorizeVTubeStudio();
          if (lifetime.disposed) return;
          if (!authorization.ok) {
            if (authorization.reason === 'api-disabled') {
              showVTubeStudioSetupNotice(authorization.reason);
            } else if (authorization.reason === 'unavailable') {
              showVTubeStudioSetupNotice(authorization.reason);
            }
            vTubeStudioStatus.textContent = authorization.message ?? 'VTube Studio 授权未完成。';
            return;
          }
          status = await api.getVTubeStudioStatus();
          if (lifetime.disposed) return;
          displayVTubeStudioStatus(status);
        }
        const connected = await inspectSelectedVTubeStudio();
        if (lifetime.disposed) return;
        if (connected) await activateConnectedVTubeStudio();
        if (lifetime.disposed) return;
      } finally {
        vTubeStudioConnectButton.disabled = false;
      }
    })().catch(() => {
      if (!lifetime.disposed) vTubeStudioStatus.textContent = '操作失败，请检查本机服务后重试。';
    });
  });
  lifetime.on(vTubeStudioLaunchButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      vTubeStudioLaunchButton.disabled = true;
      try {
        const result = await api.launchVTubeStudio();
        if (lifetime.disposed) return;
        vTubeStudioStatus.textContent = result.message ?? '已请求启动 VTube Studio。';
      } finally {
        vTubeStudioLaunchButton.disabled = false;
      }
    })().catch(() => {
      if (!lifetime.disposed) vTubeStudioStatus.textContent = '操作失败，请检查本机服务后重试。';
    });
  });
  lifetime.on(vTubeStudioInstallModelButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      vTubeStudioInstallModelButton.disabled = true;
      try {
        const result = await api.installBundledVTubeStudioModel();
        if (lifetime.disposed) return;
        vTubeStudioStatus.textContent = result.message ?? 'VTube Studio 模型安装操作已结束。';
      } finally {
        vTubeStudioInstallModelButton.disabled = false;
      }
    })().catch(() => {
      if (!lifetime.disposed) vTubeStudioStatus.textContent = '操作失败，请检查本机服务后重试。';
    });
  });
  lifetime.on(vTubeStudioExpressionTestButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      vTubeStudioExpressionTestButton.disabled = true;
      vTubeStudioStatus.textContent = '正在发送本机惊讶表情测试…';
      try {
        const result = await api.presentInVTubeStudio({ emotion: 'surprised' });
        if (lifetime.disposed) return;
        if (!result.ok) {
          vTubeStudioStatus.textContent =
            result.reason === 'mapping-missing'
              ? '当前模型没有可用的“惊讶”表情映射；请先逐个预览并保存映射。'
              : (result.message ?? 'VTube Studio 表情测试未发送。');
          return;
        }
        vTubeStudioStatus.textContent = '惊讶表情已发送，3 秒后恢复中性。';
        await lifetime.delay(3_000);
        if (lifetime.disposed) return;
        await api.presentInVTubeStudio({ emotion: 'neutral' });
        if (lifetime.disposed) return;
        vTubeStudioStatus.textContent = 'VTube Studio 表情联动测试通过。';
      } finally {
        vTubeStudioExpressionTestButton.disabled = false;
      }
    })().catch(() => {
      if (!lifetime.disposed) vTubeStudioStatus.textContent = '操作失败，请检查本机服务后重试。';
    });
  });
  lifetime.on(vTubeStudioExpressionPreviewButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api || !currentVTubeStudioInventory) return;
      const expressionIndex = Number(vTubeStudioExpressionSelect.value);
      const expression = currentVTubeStudioInventory.expressions[expressionIndex];
      if (!expression) return;
      vTubeStudioExpressionPreviewButton.disabled = true;
      const result = await api.previewVTubeStudioExpression({ active: true, expressionIndex });
      if (lifetime.disposed) return;
      vTubeStudioStatus.textContent =
        result.message ?? (result.ok ? '表情预览已开启。' : '预览失败。');
      vTubeStudioExpressionPreviewButton.disabled = false;
      if (result.ok) options.closeDrawers();
    })().catch(() => {
      if (!lifetime.disposed) vTubeStudioStatus.textContent = '操作失败，请检查本机服务后重试。';
    });
  });
  lifetime.on(vTubeStudioExpressionRestoreButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api) return;
      vTubeStudioExpressionRestoreButton.disabled = true;
      const result = await api.previewVTubeStudioExpression({ active: false });
      if (lifetime.disposed) return;
      vTubeStudioStatus.textContent =
        result.message ?? (result.ok ? '表情预览已关闭。' : '恢复失败。');
      vTubeStudioExpressionRestoreButton.disabled = false;
      if (result.ok) options.closeDrawers();
    })().catch(() => {
      if (!lifetime.disposed) vTubeStudioStatus.textContent = '操作失败，请检查本机服务后重试。';
    });
  });
  lifetime.on(vTubeStudioMapExpressionButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api || !currentVTubeStudioInventory) return;
      const expression =
        currentVTubeStudioInventory.expressions[Number(vTubeStudioExpressionSelect.value)];
      const emotion = vTubeStudioEmotionSelect.value as CharacterEmotion;
      if (!expression || !CHARACTER_EMOTIONS.includes(emotion)) return;
      vTubeStudioEmotionMappings[emotion] = expression.file;
      updateCurrentVTubeStudioModelMapping();
      renderVTubeStudioMappings();
      showButtonFeedback(vTubeStudioMapExpressionButton, '正在保存…', 'pending');
      const result = await api.setVTubeStudioSettings({ settings: readVTubeStudioSettings() });
      if (lifetime.disposed) return;
      vTubeStudioStatus.textContent = result.ok
        ? `已为当前模型确认“${expression.name}”对应 ${emotion}。`
        : (result.message ?? 'VTube Studio 表情映射无法保存。');
      showButtonFeedback(
        vTubeStudioMapExpressionButton,
        result.ok ? '已确认 ✓' : '保存失败',
        result.ok ? 'success' : 'error',
        1_200,
      );
    })().catch(() => {
      if (!lifetime.disposed) vTubeStudioStatus.textContent = '操作失败，请检查本机服务后重试。';
    });
  });
  lifetime.on(vTubeStudioConfirmSuggestionsButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api || !currentVTubeStudioMapping) return;
      vTubeStudioEmotionMappings = {
        ...currentVTubeStudioMapping.suggestions.emotionExpressions,
        ...vTubeStudioEmotionMappings,
      };
      vTubeStudioActionMappings = {
        ...currentVTubeStudioMapping.suggestions.actionHotkeys,
        ...vTubeStudioActionMappings,
      };
      if (!updateCurrentVTubeStudioModelMapping()) return;
      renderVTubeStudioMappings();
      showButtonFeedback(vTubeStudioConfirmSuggestionsButton, '正在保存…', 'pending');
      const result = await api.setVTubeStudioSettings({ settings: readVTubeStudioSettings() });
      if (lifetime.disposed) return;
      vTubeStudioStatus.textContent = result.ok
        ? `已确认“${currentVTubeStudioMapping.modelName}”的自动识别映射。`
        : (result.message ?? '自动识别映射无法保存。');
      showButtonFeedback(
        vTubeStudioConfirmSuggestionsButton,
        result.ok ? '已确认 ✓' : '保存失败',
        result.ok ? 'success' : 'error',
        1_200,
      );
    })().catch(() => {
      if (!lifetime.disposed) vTubeStudioStatus.textContent = '操作失败，请检查本机服务后重试。';
    });
  });
  lifetime.on(vTubeStudioMapActionButton, 'click', () => {
    void (async () => {
      if (lifetime.disposed || !api || !currentVTubeStudioInventory) return;
      const action = vTubeStudioActionSelect.value;
      const hotkeyId = vTubeStudioActionHotkeySelect.value;
      const hotkey = currentVTubeStudioInventory.hotkeys.find(
        (candidate) => candidate.hotkeyId === hotkeyId && candidate.type === 'TriggerAnimation',
      );
      if (!hotkey || (action !== 'nod' && action !== 'shake')) return;
      vTubeStudioActionMappings[action] = hotkey.hotkeyId;
      if (!updateCurrentVTubeStudioModelMapping()) return;
      renderVTubeStudioMappings();
      showButtonFeedback(vTubeStudioMapActionButton, '正在保存…', 'pending');
      const result = await api.setVTubeStudioSettings({ settings: readVTubeStudioSettings() });
      if (lifetime.disposed) return;
      vTubeStudioStatus.textContent = result.ok
        ? `已为当前模型确认“${hotkey.name}”对应 ${action}。`
        : (result.message ?? 'VTube Studio 动作映射无法保存。');
      showButtonFeedback(
        vTubeStudioMapActionButton,
        result.ok ? '已确认 ✓' : '保存失败',
        result.ok ? 'success' : 'error',
        1_200,
      );
    })().catch(() => {
      if (!lifetime.disposed) vTubeStudioStatus.textContent = '操作失败，请检查本机服务后重试。';
    });
  });

  return {
    elements: {
      viewerExSettingsPanel,
      viewerExEnabledInput,
      readViewerExSettings,
      vTubeStudioSettingsPanel,
      vTubeStudioEnabledInput,
      readVTubeStudioSettings,
    },
    displayViewerExStatus,
    displayVTubeStudioStatus,
    displayVTubeStudioInventory,
    inspectSelectedVTubeStudio,
    listenForSelection(target: EventTarget | undefined, callback: () => void): void {
      if (target) lifetime.on(target, 'click', callback);
    },
    dispose(): void {
      lifetime.dispose();
      feedback.dispose();
    },
  };
};
