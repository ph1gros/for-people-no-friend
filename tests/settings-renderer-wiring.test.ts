import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('settings renderer regression wiring', () => {
  const source = readFileSync(resolve('src/renderer/chat/chat-controller.ts'), 'utf8');
  const indexSource = readFileSync(resolve('src/renderer/index.ts'), 'utf8');
  const styles = readFileSync(resolve('src/renderer/styles.css'), 'utf8');
  const registry = readFileSync(resolve('src/renderer/widgets/widget-registry.ts'), 'utf8');
  const windowIpcSource = readFileSync(resolve('src/shared/window-ipc.ts'), 'utf8');

  it('places connection feedback with the model controls before unrelated settings', () => {
    const sectionStart = source.indexOf('modelSettingsSection.append(');
    const sectionEnd = source.indexOf('\n  );', sectionStart);
    const sectionLayout = source.slice(sectionStart, sectionEnd);

    expect(sectionStart).toBeGreaterThan(-1);
    expect(sectionLayout.indexOf("createField('API Key', apiKeyInput)")).toBeLessThan(
      sectionLayout.indexOf('connectionActions'),
    );
    expect(sectionLayout.indexOf('connectionActions')).toBeLessThan(
      sectionLayout.indexOf('connectionStatus'),
    );
    expect(source).toContain('characterSettingsSection.append(');
  });

  it('applies desktop controls immediately through the narrow settings method', () => {
    expect(source).toContain("globalShortcutInput.addEventListener('change'");
    expect(source).toContain("mediaControlInput.addEventListener('change'");
    expect(source).toContain("inputOverlayEnabledInput.addEventListener('change'");
    expect(source).toContain("inputOverlayMouseInput.addEventListener('change'");
    expect(source).toContain("inputOverlayKeysInput.addEventListener('change'");
    expect(source.match(/void saveDesktopIntegrationSettings\(\);/gu)).toHaveLength(7);
    expect(source).toContain("stopGenerationShortcutInput.addEventListener('change'");
    expect(source).toContain('stopGenerationShortcut: stopGenerationShortcutInput.value.trim()');
    expect(source).toContain(
      'await api.setDesktopIntegrationSettings({ settings: requestedSettings })',
    );
    expect(source).toContain(
      'displayDesktopIntegrationStatus(await api.getDesktopIntegrationStatus())',
    );
  });

  it('shows only configured input keys and coarse mouse activity', () => {
    expect(source).toContain('inputOverlayHint.textContent =');
    expect(source).toContain('默认 W, A, S, D');
    expect(source).toContain('最多 24 个');
    expect(source).toContain('输入时不会被状态刷新覆盖');
    expect(source).toContain('tokenizeInputOverlayKeyDraft(inputOverlayKeysInput.value)');
    expect(source).toContain('document.activeElement !== inputOverlayKeysInput');
    expect(source).toContain("'up-right': '↗'");
    expect(source).toContain('inputOverlayMouse.hidden = !settings.inputOverlayMouseEnabled;');
    expect(styles).toContain('.input-overlay__key.is-active');
    expect(styles).toContain('.input-overlay__direction.is-active');
    expect(styles).toMatch(
      /\.desktop-overlay-stack\s*\{[^}]*left:\s*8px;[^}]*width:\s*calc\(100% - 16px\);/su,
    );
    expect(styles).toMatch(
      /\.chat-expanded \.desktop-overlay-stack\s*\{[^}]*width:\s*calc\(50% - 16px\);/su,
    );
    expect(styles).toMatch(
      /\.input-overlay\s*\{[^}]*width:\s*max-content;[^}]*max-width:\s*100%;/su,
    );
    expect(styles).toMatch(
      /\.input-overlay__keys\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/su,
    );
    expect(source).toContain("movementKeys.className = 'input-overlay__movement'");
    expect(source).toContain('element.dataset.movement = key.toLowerCase()');
    expect(styles).toContain(".input-overlay__movement [data-movement='w']");
    expect(styles).toContain(".input-overlay__movement [data-movement='a']");
    expect(styles).toContain(".input-overlay__movement [data-movement='s']");
    expect(styles).toContain(".input-overlay__movement [data-movement='d']");
    expect(styles).toContain('overscroll-behavior-inline: contain;');
    expect(source).toContain("element.scrollIntoView({ block: 'nearest', inline: 'nearest' });");
  });

  it('organizes input and media controls as extensible widget catalog cards', () => {
    expect(source).toContain("widgetsButton = createButton('小组件'");
    expect(source).toContain(
      'toolbar.append(soundButton, speechInputModeToolbar, widgetsButton, settingsButton);',
    );
    expect(source).toContain("widgetsTitle.textContent = '小组件';");
    expect(source).toContain("inputWidgetTitle.textContent = '输入显示';");
    expect(source).toContain("mediaWidgetTitle.textContent = '听歌控制';");
    expect(source).toContain('const createWidgetCatalogCard = (');
    expect(source).toContain('for (const definition of desktopWidgetRegistry.list())');
    expect(source).toContain('widgetsCatalog.append(card.card);');
    expect(source).toContain(
      'widgetsContent.append(widgetsCatalog, inputWidget, mediaWidget, widgetsStatus);',
    );
    expect(source).toContain("const showWidgetView = (view: 'catalog' | DesktopWidgetId)");
    expect(source).toContain(
      'await api.setDesktopWidgetEnabled({ widgetId: widget, enabled: !enabled })',
    );
    expect(source).toContain('for (const widget of widgetOrder)');
    expect(registry).toContain('export class DesktopWidgetRegistry');
    expect(registry).toContain("id: 'input'");
    expect(registry).toContain("id: 'media'");
    expect(registry).not.toContain('import(');
    expect(source).toContain("showSettingsPage('widgets');");
    expect(source).toContain(
      'widgetsSettingsSection.append(widgetsInterfacePanel, widgetsContent)',
    );
    expect(source).toContain("widgetsInterfaceTitle.textContent = '小组件接口'");
    expect(styles).toContain('.widgets-panel__content');
    expect(styles).toContain('.widget-catalog-card');
    expect(styles).toContain('.widget-catalog-card__settings');
    expect(styles).toContain('.widget-detail');
    expect(styles).toMatch(/\.desktop-overlay-stack\s*\{[^}]*gap:\s*6px;/su);
    expect(styles).toContain('var(--visible-frame-top, 0px)');
    expect(styles).toContain('var(--visible-frame-height, calc(100% - 16px))');
    expect(source).toContain("root.classList.toggle('desktop-widgets-active', widgetReserve > 0)");
    expect(source).toContain("root.style.setProperty('--desktop-widget-reserve'");
    expect(styles).toContain('.desktop-widgets-active .character-host');
    expect(styles).toContain('calc(100% - var(--desktop-widget-reserve, 0px))');
    expect(styles).toMatch(/\.widgets-panel\s*\{[^}]*inset:\s*50px 8px 8px;/su);
    expect(styles).toMatch(/\.widgets-panel__content\s*\{[^}]*min-height:\s*0;/su);
    expect(styles).toContain('.widgets-panel[hidden]');
    expect(styles).toMatch(/\.widget-catalog-card\s*\{[^}]*box-sizing:\s*border-box;/su);
    expect(styles).toMatch(/\.media-overlay\s*\{[^}]*width:\s*min\(260px, 100%\);/su);
  });

  it('keeps section enable checkboxes on the same row as their headings', () => {
    expect(source).toContain(
      'modelCollaborationHeading.append(modelCollaborationTitle, allowRemoteComplexTasksInput)',
    );
    expect(source).toContain(
      'desktopIntegrationHeading.append(desktopIntegrationTitle, globalShortcutInput)',
    );
    expect(source).toContain(
      'speechSettingsHeading.append(speechSettingsTitle, speechEnabledInput)',
    );
    expect(source).toContain(
      'inputWidgetHeader.append(backFromInputWidgetButton, inputWidgetTitle, inputOverlayEnabledInput)',
    );
    expect(source).toContain(
      'mediaWidgetHeader.append(backFromMediaWidgetButton, mediaWidgetTitle, mediaControlInput)',
    );
    expect(styles).toContain('.settings-toggle-heading');
    expect(styles).toContain(".widget-detail__header input[type='checkbox']");
  });

  it('wires optional speech through the narrow API and keeps an immediate stop control', () => {
    expect(source).toContain("speechSettingsTitle.textContent = '声音与音频生成'");
    expect(source).toContain("['openai-compatible', 'OpenAI 兼容 TTS（本机或在线）']");
    expect(source).toContain("['output', '声音与音频生成', speechOutputPane]");
    expect(source).toContain("['input', '中文麦克风输入', speechInputPane]");
    expect(source).toContain("showSpeechPage('output')");
    expect(source).toContain('专用本地语音模型：已预留提供商位置');
    expect(source).toContain('更多在线 TTS：已预留接入位置');
    expect(source).toContain('api.setSpeechSettings({ settings: speechSettings })');
    expect(source).toContain('api.setSpeechSecret({ apiKey: speechApiKeyInput.value })');
    expect(source).toContain("stopSpeechButton = createButton('停声'");
    expect(source).toContain("stopSpeechButton.addEventListener('click'");
    expect(source).toContain("microphoneButton = createButton('说话'");
    expect(source).toContain('navigator.mediaDevices.getUserMedia');
    expect(source).toContain('api.transcribeSpeech({ requestId, audio');
    expect(source).toContain('input.value = transcript');
    expect(source).toContain(
      "['full', '完全', '持续听麦；自动发送，2 秒内继续说会合并并重新思考']",
    );
    expect(source).toContain("['half', '精准', '持续听麦；必须说“小猫 + 内容”才发送，降低误判']");
    expect(source).toContain(
      "['manual', '手动', '点击“说话”，或按住设置键位录音；识别结果只填入输入框']",
    );
    expect(source).toContain("speechPushToTalkKeySelect.value = 'F8'");
    expect(source).toContain("createField('手动按住说话键', speechPushToTalkKeySelect)");
    expect(source).toContain('event.key === speechSettings.pushToTalkKey');
    expect(source).toContain('void startMicrophoneRecording(true)');
    expect(source).toContain('new ContinuousMicrophoneListener({');
    expect(source).toContain('wakeWordCommands.handle(transcript)');
    expect(source).toContain('activeSpeechTurn?.appendText(event.text)');
    expect(source).toContain('getPresentation()?.updateSpeechLevel(level)');
    expect(source).toContain("speechVolumeInput.value = '0.6'");
    expect(source).toContain('speechPlayer.setVolume(volume)');
    expect(source).toContain('settings: { ...currentSpeechStatus.settings, volume }');
  });

  it('keeps ViewerEX optional, loopback-scoped, and separate from model files and audio', () => {
    expect(source).toContain("viewerExSettingsTitle.textContent = '启用 Live2DViewerEX'");
    expect(source).toContain('api.setViewerExSettings({ settings: readViewerExSettings() })');
    expect(source).toContain("api.presentInViewerEx({ text: 'For People No Friend 已连接。' })");
    expect(source).toContain('仅连接 127.0.0.1 的官方 ExAPI');
    expect(source).toContain("viewerExWorkshopItemInput.placeholder = '例如：2380801353'");
    expect(source).toContain("createField('状态动作映射', viewerExStateMotionsInput)");
    expect(source).toContain("createField('情绪表情编号映射', viewerExEmotionExpressionsInput)");
    expect(source).toContain("viewerExMappingTestButton.addEventListener('click'");
  });

  it('wires VTube Studio authorization and read-only inventory separately from presentation', () => {
    expect(source).toContain("vTubeStudioSettingsTitle.textContent = '启用 VTube Studio'");
    expect(source).toContain("createButton('启动 VTube Studio', 'secondary-button')");
    expect(source).toContain('await api.launchVTubeStudio()');
    expect(source).toContain('await api.installBundledVTubeStudioModel()');
    expect(source).toContain('api.setVTubeStudioSettings({ settings: readVTubeStudioSettings() })');
    expect(source).toContain("vTubeStudioMouseTrackingTitle.textContent = '鼠标追踪'");
    expect(source).toContain('mouseTrackingEnabled: vTubeStudioMouseTrackingInput.checked');
    expect(source).toContain('const authorization = await api.authorizeVTubeStudio()');
    expect(source).toContain('const inspected = await api.inspectVTubeStudio()');
    expect(source).toContain("vTubeStudioExpressionTestButton = createButton('测试惊讶表情'");
    expect(source).toContain("vTubeStudioExpressionPreviewButton = createButton('预览并返回桌面'");
    expect(source).toContain("createField('逐个查看模型表情', vTubeStudioExpressionSelect)");
    expect(source).toContain('`查看全部 ${inventory.parameters.length} 个模型参数`');
    expect(source).toContain('...expression.parameters.map((parameter) => parameter.name)');
    expect(source).toContain('api.previewVTubeStudioExpression({ active: true, expressionIndex })');
    expect(source).toContain('api.previewVTubeStudioExpression({ active: false })');
    expect(source).toContain("api.presentInVTubeStudio({ emotion: 'surprised' })");
    expect(source).toContain("api.presentInVTubeStudio({ emotion: 'neutral' })");
    expect(source).toContain('仅连接 127.0.0.1');
    expect(source).toContain('首次授权由 VTube Studio 弹窗确认');
    expect(source).toContain('const inspectSelectedVTubeStudio = async ()');
    expect(source).toContain('const hotkeyNames = inventory.hotkeys.map((hotkey) => hotkey.name)');
    expect(source).toContain("loadedCharacterDisplayMode === 'vtube-studio'");
    expect(indexSource).toContain(
      "if (mode === 'vtube-studio') await vTubeStudioPresentation?.setState('idle')",
    );
    expect(source).toContain("displayModeResult.mode === 'vtube-studio'");
    expect(source).toContain('await inspectSelectedVTubeStudio();');
    expect(source).toContain("settingsTabButtons.get('display')?.addEventListener");
    expect(source).toContain(".get('vtube-studio')");
  });

  it('groups the three mutually exclusive character displays into left-hand tabs', () => {
    expect(source).toContain("displayModeTitle.textContent = '角色显示方式'");
    expect(source).toContain("['live2d', '纯 Live2D']");
    expect(source).toContain("['viewerex', 'ViewerEX']");
    expect(source).toContain("['vtube-studio', 'VTube Studio']");
    expect(source).toContain("let selectedDisplayTab: Exclude<CharacterDisplayMode, 'off'>");
    expect(source).toContain("setDisplayModeInputs(input.checked ? mode : 'off')");
    expect(source).toContain('api.setCharacterDisplayMode({');
    expect(styles).toContain('.display-mode-settings__body');
    expect(styles).toContain('.display-mode-tabs');
    expect(styles).toContain('.display-mode-tab.is-active');
  });

  it('offers a direct, Main-owned Live2D model import entry', () => {
    expect(source).toContain("importLive2DModelButton = createButton('导入 Live2D 模型'");
    expect(source).toContain('const result = await api.importLive2DModel();');
    expect(source).toContain("await api.setCharacterDisplayMode({ mode: 'live2d' })");
    expect(source).toContain("displayCharacterDisplayMode('live2d')");
    expect(source).toContain('选择模型主目录中的 .model3.json');
  });

  it('keeps all character management in one left-navigation category', () => {
    expect(source).toContain("settingsTitle.textContent = '设置'");
    expect(source).not.toContain("settingsTitle.textContent = 'For People No Friend 设置'");
    expect(source).toContain("settingsNavigation.setAttribute('aria-label', '设置分类')");
    expect(source).toContain("['model', '模型与窗口', modelSettingsSection]");
    expect(source).toContain("['assistant', '工作模式', assistantSettingsSection]");
    expect(source).toContain("['speech', '语音和语音输入', speechSettingsSection]");
    expect(source).toContain("['character', '角色', characterSettingsSection]");
    expect(source).toContain("['library', '角色库与角色包', characterLibraryPane]");
    expect(source).toContain("['local', '自建角色', localCharacterPane]");
    expect(source).toContain("['research', '网络查找', characterResearchPane]");
    expect(source).toContain("['display', '模型显示方式', displaySettingsSection]");
    expect(source).toContain("['widgets', '小组件', widgetsSettingsSection]");
    expect(source).toContain("['desktop', '桌面快捷操作', desktopSettingsSection]");
    expect(source).toContain("['memory', '记忆', memorySettingsSection]");
    expect(source).toContain('const showSettingsPage = (page: SettingsPage)');
    expect(source).toContain("showSettingsPage('character');");
    expect(source).toContain('characterSearchNameInput.value = storedProfile.name;');
    expect(source).toContain('section.hidden = !selected;');
    expect(styles).toContain('.settings-navigation');
    expect(styles).toContain('.settings-navigation__tab.is-active');
    expect(styles).toContain('.settings-page[hidden]');
  });

  it('guards media buttons against overlapping commands', () => {
    expect(source).toContain('if (!api || mediaCommandInFlight) return;');
    expect(source).toContain('mediaCommandInFlight = true;');
    expect(source).toContain('mediaCommandInFlight = false;');
    expect(source).toContain('desktopStatus.media.title');
    expect(source).toContain("'正在播放'");
    expect(source).toContain("'已暂停'");
    expect(source).toContain('mediaStatusRefreshTimer = window.setInterval');
    expect(source).toContain('mediaOverlay.hidden = !desktopStatus.settings.mediaControlEnabled;');
    expect(source).toContain('开启后悬浮控制条会固定保留');
    expect(source).toContain("previousMediaOverlayButton = createButton('◀'");
    expect(source).toContain("playPauseMediaOverlayButton = createButton('⏸'");
    expect(source).toContain("nextMediaOverlayButton = createButton('▶'");
    expect(source).not.toContain('mediaLyric');
    expect(source).not.toContain('mediaProgress');
    expect(styles).not.toContain('.media-overlay__lyric');
    expect(styles).not.toContain('.media-overlay__progress');
    expect(styles).toContain('.media-overlay__controls');
  });

  it('shows honest indeterminate progress during network search and draft expansion', () => {
    expect(source).toContain("characterResearchProgress.className = 'character-research-progress'");
    expect(source).toContain('characterResearchProgress.hidden = !busy;');
    expect(source).toContain("'正在查询公开角色资料'");
    expect(source).toContain("'正在发散查找并整理角色资料'");
    expect(styles).toContain('.character-research-progress');
    expect(styles).toContain('@keyframes character-research-scan');
  });

  it('creates a separate local character without replacing the active role card', () => {
    expect(source).toContain("createButton('新建本地角色'");
    expect(source).toContain('api.createLocalCharacter({ name })');
    expect(source).toContain('await refreshActiveCharacter();');
  });

  it('does not retain the removed temporary do-not-disturb surface', () => {
    expect(source).not.toContain('toggleDesktopMute');
    expect(source).not.toContain('desktopTemporarilyMuted');
    expect(source).not.toContain('临时免打扰');
  });

  it('uses a dedicated large settings layout, keeps the drag hint, and shows one opening line', () => {
    expect(source).toContain("root.classList.toggle('settings-expanded'");
    expect(source).toContain('settingsPanel.scrollTop = 0;');
    expect(source).toContain('let openingLineShown = false;');
    expect(source).toContain("let openingLineContext: OpeningLineContext = 'resume';");
    expect(source).toContain('conversationMessages: messages.length');
    expect(source).toContain('await api.generateContextualOpeningLine()');
    expect(source).toContain("setReplyStatus('正在想起上次对话…')");
    expect(source).toContain('showOpeningLineIfReady();');
    expect(styles).toContain('.window-drag-region::after');
    expect(styles).toContain('.chat-expanded:not(.settings-expanded) .window-drag-region');
    expect(styles).toMatch(/\.window-drag-region::after\s*\{[^}]*opacity:\s*0;/su);
    expect(styles).toMatch(/\.chat-expanded \.window-drag-region::after\s*\{[^}]*opacity:\s*1;/su);
    expect(styles).toContain('.settings-expanded .character-host');
    expect(styles).toContain('.settings-layout');
    expect(styles).toMatch(
      /\.settings-expanded \.settings-panel\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/su,
    );
    expect(styles).toMatch(
      /\.settings-expanded \.settings-layout\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/su,
    );
    expect(styles).toMatch(
      /\.settings-expanded \.settings-footer\s*\{[^}]*position:\s*relative;[^}]*flex:\s*0 0 auto;/su,
    );
    expect(styles).toContain('.settings-section');
  });

  it('uses a compact auto-growing composer with clear action controls', () => {
    expect(source).toContain("input.placeholder = '输入消息或任务…'");
    expect(source).not.toContain('Ctrl+Enter 发送');
    expect(source).toContain('input.rows = 1;');
    expect(source).toContain('Math.min(input.scrollHeight, 104)');
    expect(source).not.toContain("event.key === 'Enter' && event.ctrlKey && !event.isComposing");
    expect(source).toContain(
      'composerActions.append(microphoneButton, stopSpeechButton, stopButton, sendButton)',
    );
    expect(source).toContain("composerDropStatus.className = 'chat-composer__drop-status'");
    expect(styles).toMatch(/\.chat-composer__input\s*\{[^}]*min-height:\s*42px;/su);
    expect(styles).toMatch(/\.chat-composer__input\s*\{[^}]*max-height:\s*104px;/su);
    expect(styles).toMatch(/\.chat-composer__input\s*\{[^}]*resize:\s*none;/su);
  });

  it('offers one explicit work mode for bounded workspace and web tools', () => {
    expect(source).toContain("createButton('工作模式 OFF', 'text-button assistant-mode-button')");
    expect(source).toContain("'secondary-button assistant-workspace-button'");
    expect(source).toContain("assistantWorkspaceHeading.textContent = '工作区与权限'");
    expect(source).toContain("assistantInterfaceTitle.textContent = '当前工作接口'");
    expect(source).toContain("'普通聊天'");
    expect(source).toContain("'OFF'");
    expect(source).toContain("'工作模式'");
    expect(source).toContain("'ON'");
    expect(source).toContain('文件接口：列出文件、读取文件、新建或修改文件');
    expect(source).toContain('网页接口：搜索网页、读取 HTTPS 公开页面');
    expect(source).toContain('const result = await api.selectAssistantWorkspace();');
    expect(source).toContain('assistantMode: assistantModeEnabled');
    expect(source).toContain('wakeFromDrowsy,');
    expect(source).toContain('const wakeFromDrowsy = companionDrowsy;');
    expect(source).toContain('api.importDroppedWorkspaceFiles({');
    expect(source).toContain('files.map(async (file) => ({');
    expect(source).toContain("composer.classList.add('is-file-drop-active')");
    expect(source).toContain("window.addEventListener('drop', preventWindowFileNavigation)");
    expect(source).toContain("event.type === 'tool-approval'");
    expect(source).toContain('api?.resolveAssistantToolApproval({');
    expect(styles).toContain('.assistant-mode-button.is-active');
    expect(styles).toContain('.mode-comparison__card');
  });

  it('groups character library, local creation, and research under one character page', () => {
    expect(source).toContain("'角色',\n    '集中管理角色库、角色包、自建资料和联网查找。'");
    expect(source).toContain("['library', '角色库与角色包', characterLibraryPane]");
    expect(source).toContain("['local', '自建角色', localCharacterPane]");
    expect(source).toContain("['research', '网络查找', characterResearchPane]");
    expect(source).toContain("['character', '角色', characterSettingsSection]");
    expect(source).toContain('api.clearInactiveCharacters()');
    expect(styles).toContain('.character-page__body');
  });

  it('offers the synthetic nod action while VTube Studio is the active display', () => {
    expect(source).toContain("readCharacterDisplayMode() === 'vtube-studio'");
    expect(source).toContain("? ['nod']");
    expect(source).toContain('availableActions: readAvailablePresentationActions()');
  });

  it('resets character-scoped renderer state and replays the new opening line after updates', () => {
    expect(source).toContain('const resetCharacterSessionView = (): void => {');
    expect(source).toContain('openingLineShown = false;');
    expect(source).toContain('latestContextDebug = undefined;');
    expect(source).toContain('memoryRecords = [];');
    expect(source).toContain('memoryCandidates = [];');
    expect(source).toContain("openingLineContext = 'character-refresh';");
    expect(source).toContain('await refreshActiveCharacter();');
    expect(source).toContain('const characterProfileChanged =');
    expect(source).toContain('if (refreshCharacter || characterProfileChanged)');
    expect(source).toContain('showOpeningLineIfReady();\n  };');
  });

  it('uses sound in the toolbar and moves memory to its own settings page', () => {
    expect(source).toContain("soundButton = createButton('声音'");
    expect(source).toContain(
      'toolbar.append(soundButton, speechInputModeToolbar, widgetsButton, settingsButton);',
    );
    expect(source).toContain("speechInputModeToolbar.className = 'chat-toolbar__mode-switch'");
    expect(source).toContain("button.addEventListener('click'");
    expect(source).toContain('inputEnabled: true,');
    expect(styles).toContain('.chat-toolbar__mode-switch');
    expect(styles).toContain('.chat-toolbar__mode-button.is-selected');
    expect(source).toContain("['memory', '记忆', memorySettingsSection]");
    expect(source).toContain('memorySettingsActions.append(');
    expect(source).not.toContain("recordsMenuButton.textContent = '资料';");
  });

  it('uses consistent compact settings buttons without pill-shaped corners', () => {
    expect(styles).toMatch(
      /\.settings-panel button\s*\{[^}]*font-size:\s*11px;[^}]*border-radius:\s*8px;/su,
    );
    expect(styles).toMatch(
      /\.character-library > \.settings-actions button\s*\{[^}]*white-space:\s*nowrap;/su,
    );
  });

  it('allows window size adjustment in one-percent increments', () => {
    expect(source).toContain("scaleInput.step = '0.01';");
    expect(source).toContain("scaleInput.value = '0.85';");
    expect(source).toContain('scaleInput.max = String(MAX_WINDOW_SCALE);');
    expect(windowIpcSource).toContain('MAX_WINDOW_SCALE = 1.2');
  });

  it('offers non-overlapping safe positions for the model, chat and widgets', () => {
    expect(source).toContain("layoutPositionTitle.textContent = '界面位置'");
    expect(source).toContain("['left', '模型在左，对话框在右']");
    expect(source).toContain("['right', '模型在右，对话框在左']");
    expect(source).toContain("createField('小组件位置', widgetAlignmentSelect)");
    expect(source).toContain('api.setDesktopLayoutSettings');
    expect(source).toContain("previewLayoutPositionButton = createButton('保存并预览位置'");
    expect(styles).toContain("[data-character-pane='right'] .character-host");
    expect(styles).toContain("[data-character-pane='right'] .chat-panel");
    expect(styles).toContain("[data-widget-alignment='center'] .desktop-overlay-stack");
    expect(styles).toContain("[data-widget-alignment='end'] .desktop-overlay-stack");
  });

  it('styles local character creation as a labelled field and groups the TTS model with its voice', () => {
    expect(source).toContain("createField('新角色名称', newCharacterNameInput)");
    expect(styles).toContain('.local-character-actions .settings-field');
    expect(source).toContain("speechVoiceIdentityTitle.textContent = '语音模型与音色'");
    expect(source).toContain("createField('语音模型 ID', speechModelInput)");
    expect(source).toContain("createField('音色 / Speaker ID', speechVoiceInput)");
    expect(styles).toContain('.speech-voice-identity__fields');
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
  });

  it('expands character text fields to show their complete content', () => {
    expect(source).toContain("textarea.classList.add('settings-textarea--auto');");
    expect(source).toContain('textarea.style.height = `${textarea.scrollHeight}px`;');
    expect(source).toContain('const loreEditorResizeObserver = new ResizeObserver');
    expect(source).toContain("loreEditor.addEventListener('toggle'");
    expect(source).toContain('loreEditor.open = true;');
    expect(styles).toMatch(
      /\.settings-field textarea\.settings-textarea--auto\s*\{[^}]*field-sizing:\s*content;[^}]*overflow-y:\s*hidden;[^}]*resize:\s*none;/su,
    );
  });

  it('fills an inferred work only after selection and syncs its glossary separately', () => {
    expect(source).toContain('if (candidate.sourceWork) {');
    expect(source).toContain('loreSourceWorkInput.value = candidate.sourceWork;');
    expect(source).toContain('await loadGlossaryStatus(candidate.sourceWork);');
    expect(source).toContain('void syncWorkGlossarySeparately(candidate.sourceWork, true);');
    expect(source).toContain('if (sourceWork) void syncWorkGlossarySeparately(sourceWork, true);');
    expect(source).toContain('resolveAutomaticGlossarySourceWork(');
    expect(source).toContain('不与角色整理共用模型上下文');
  });

  it('exposes a remote-provider key field without duplicating same-provider secrets', () => {
    expect(source).toContain("createField('远端 API Key', remoteApiKeyInput)");
    expect(source).toContain('remoteApiKeyInput.disabled = !enabled || sharesProvider;');
    expect(source).toContain('远端模型与上方使用同一提供商，将共用该提供商的密钥。');
    expect(source).toContain('remoteProviderSelect.value !== providerId');
  });
});
