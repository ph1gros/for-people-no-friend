import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('settings renderer regression wiring', () => {
  const controllerSource = readFileSync(resolve('src/renderer/chat/chat-controller.ts'), 'utf8');
  const source = [
    'chat-controller',
    'settings-provider',
    'settings-speech',
    'settings-vtube',
    'settings-character',
  ]
    .map((name) => readFileSync(resolve(`src/renderer/chat/${name}.ts`), 'utf8'))
    .join('\n');
  const sourceAst = ts.createSourceFile('chat-controller.ts', source, ts.ScriptTarget.Latest, true);
  // Check the configured DOM value, independent of el() versus separate IDL assignments.
  const readElementOption = (variable: string, key: string): string => {
    const values: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === variable &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        node.initializer.expression.getText(sourceAst) === 'el'
      ) {
        const options = node.initializer.arguments[1];
        if (options && ts.isObjectLiteralExpression(options)) {
          for (const property of options.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              property.name.getText(sourceAst) === key &&
              ts.isStringLiteral(property.initializer)
            ) {
              values.push(property.initializer.text);
            }
          }
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        node.left.expression.getText(sourceAst) === variable &&
        node.left.name.text === key &&
        ts.isStringLiteral(node.right)
      ) {
        values.push(node.right.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceAst);
    expect(values, `${variable}.${key} must have one unambiguous literal declaration`).toHaveLength(
      1,
    );
    return values[0]!;
  };
  const composerSource = readFileSync(resolve('src/renderer/chat/composer.ts'), 'utf8');
  const timelineModuleSource = readFileSync(resolve('src/renderer/chat/timeline.ts'), 'utf8');
  const indexSource = readFileSync(resolve('src/renderer/index.ts'), 'utf8');
  const styles = readFileSync(resolve('src/renderer/styles.css'), 'utf8');
  const speechLanguageSource = readFileSync(
    resolve('src/renderer/speech/speech-language-options.ts'),
    'utf8',
  );
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
    expect(readElementOption('movementKeys', 'className')).toBe('input-overlay__movement');
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
    expect(readElementOption('widgetsTitle', 'textContent')).toBe('小组件');
    expect(readElementOption('inputWidgetTitle', 'textContent')).toBe('输入显示');
    expect(readElementOption('mediaWidgetTitle', 'textContent')).toBe('听歌控制');
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
    expect(readElementOption('widgetsInterfaceTitle', 'textContent')).toBe('小组件接口');
    expect(styles).toContain('.widgets-panel__content');
    expect(styles).toContain('.widget-catalog-card');
    expect(styles).toContain('.widget-catalog-card__settings');
    expect(styles).toContain('.widget-detail');
    expect(styles).toMatch(/\.desktop-overlay-stack\s*\{[^}]*gap:\s*6px;/su);
    expect(styles).toContain('var(--visible-frame-top, 0px)');
    expect(styles).toContain('var(--visible-frame-height, calc(100% - 16px))');
    expect(source).toContain(
      "root.classList.toggle('desktop-widgets-active', desktopWidgetsActive)",
    );
    expect(source).toContain('calculateDesktopWidgetReserve(');
    expect(source).toContain("root.style.setProperty('--desktop-widget-reserve'");
    expect(source).toContain('desktopWidgetResizeObserver.observe(desktopOverlayStack)');
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
    expect(readElementOption('speechSettingsTitle', 'textContent')).toBe('声音与音频生成');
    expect(source).toContain("['openai-compatible', 'OpenAI 兼容 TTS（本机或在线）']");
    expect(source).toContain('speechOpenAiCompatibleOption.textContent = status.voiceAvailable');
    expect(source).toContain("? '本机 Style-Bert-VITS2'");
    expect(source).toContain("['output', '声音与音频生成', speechOutputPane]");
    expect(source).toContain("['input', '中文麦克风输入', speechInputPane]");
    expect(source).toContain("showSpeechPage('output')");
    expect(source).toContain('Genie-TTS：已支持连接本机 GPT-SoVITS V2 / V2ProPlus ONNX 服务');
    expect(source).toContain('Fish Audio：已支持官方在线接口');
    expect(source).toContain('api.setSpeechSettings({ settings: speechSettings })');
    expect(source).toContain("['character-name', '跟随当前角色名称']");
    expect(source).toContain("['custom', '自定义称呼']");
    expect(source).toContain("createField('精准模式称呼', speechWakeWordSourceSelect)");
    expect(source).toContain("createField('自定义称呼', speechCustomWakeWordInput)");
    expect(source).toContain('wakeWordSource: speechWakeWordSourceSelect.value');
    expect(source).toContain('customWakeWord: speechCustomWakeWordInput.value.trim()');
    expect(source).toContain('resolvePreciseWakeWord(');
    expect(source).toContain("profile?.name ?? '桌宠'");
    expect(source).toContain('api.setSpeechSecret({ apiKey: speechApiKeyInput.value })');
    expect(composerSource).toContain("stopSpeechButton = createButton(documentRef, '停声'");
    expect(composerSource).toContain("stopSpeechButton.addEventListener('click'");
    expect(composerSource).toContain("microphoneButton = createButton(documentRef, '说话'");
    expect(source).toContain('navigator.mediaDevices.getUserMedia');
    expect(source).toContain('api.transcribeSpeech({ requestId, audio');
    expect(source).toContain('input.value = transcript');
    expect(source).toContain(
      "['full', '完全', '持续听麦；自动发送，2 秒内继续说会合并并重新思考']",
    );
    expect(source).toContain("['half', '精准', '持续听麦；必须先说设定的称呼才发送，降低误判']");
    expect(source).toContain(
      "['manual', '手动', '点击“说话”，或按住设置键位录音；识别结果只填入输入框']",
    );
    expect(source).toContain("speechPushToTalkKeySelect.value = 'F8'");
    expect(source).toContain("createField('手动按住说话键', speechPushToTalkKeySelect)");
    expect(source).toContain('event.key === speechSettings.pushToTalkKey');
    expect(source).toContain('void startMicrophoneRecording(true)');
    expect(source).toContain('new ContinuousMicrophoneListener({');
    expect(source).toContain('wakeWordCommands.handle(transcript, preciseWakeWord)');
    expect(source).toContain('activeSpeechTurn?.appendText(event.text)');
    expect(source).toContain('getPresentation()?.updateSpeechLevel(level)');
    expect(source).toContain("speechVolumeInput.value = '0.6'");
    expect(source).toContain('speechPlayer.setVolume(volume)');
    expect(source).toContain('settings: { ...currentSpeechStatus.settings, volume }');
    expect(source).toContain("createButton('打开音源文件夹', 'secondary-button')");
    expect(source).toContain("createButton('启动本地训练工具', 'secondary-button')");
    expect(source).toContain(
      'speechAssetsActions.append(exportLocalVoiceButton, openSpeechTrainingSourcesButton)',
    );
    expect(source).toContain('speechTrainingActions.append(launchSpeechTrainerButton)');
    expect(source).not.toContain(
      'speechTrainingActions.append(openSpeechTrainingSourcesButton, launchSpeechTrainerButton)',
    );
    expect(source).toContain('api!.openSpeechTrainingSources()');
    expect(source).toContain('api!.launchSpeechTrainer()');
    expect(source).not.toContain('我确认只使用自己拥有或已获授权的声音素材');
    expect(source).not.toContain('请先确认声音素材的使用权。');
  });

  it('keeps ViewerEX optional, loopback-scoped, and separate from model files and audio', () => {
    expect(readElementOption('viewerExSettingsTitle', 'textContent')).toBe('启用 Live2DViewerEX');
    expect(source).toContain('api.setViewerExSettings({ settings: readViewerExSettings() })');
    expect(source).toContain("api.presentInViewerEx({ text: 'For People No Friend 已连接。' })");
    expect(source).toContain('仅连接 127.0.0.1 的官方 ExAPI');
    expect(source).toContain("viewerExWorkshopItemInput.placeholder = '例如：2380801353'");
    expect(source).toContain("createField('状态动作映射', viewerExStateMotionsInput)");
    expect(source).toContain("createField('情绪表情编号映射', viewerExEmotionExpressionsInput)");
    expect(source).toContain("lifetime.on(viewerExMappingTestButton, 'click'");
  });

  it('wires VTube Studio authorization and read-only inventory separately from presentation', () => {
    expect(readElementOption('vTubeStudioSettingsTitle', 'textContent')).toBe('启用 VTube Studio');
    expect(source).toContain("createButton('启动 VTube Studio', 'secondary-button')");
    expect(source).toContain('await api.launchVTubeStudio()');
    expect(source).toContain('await api.installBundledVTubeStudioModel()');
    expect(source).toContain('api.setVTubeStudioSettings({ settings: readVTubeStudioSettings() })');
    expect(readElementOption('vTubeStudioMouseTrackingTitle', 'textContent')).toBe('鼠标追踪');
    expect(source).toContain('mouseTrackingEnabled: vTubeStudioMouseTrackingInput.checked');
    expect(source).toContain('const authorization = await api.authorizeVTubeStudio()');
    expect(source).toContain('const activateConnectedVTubeStudio = async (): Promise<boolean>');
    expect(source).toContain("persistCharacterDisplayMode('vtube-studio')");
    expect(source).toContain("setDisplayModeInputs('vtube-studio');");
    expect(source).toContain('const connected = await inspectSelectedVTubeStudio();');
    expect(source).toContain("createButton('连接 VTube Studio', 'secondary-button')");
    expect(readElementOption('vTubeStudioTroubleshootingSummary', 'textContent')).toBe(
      '连接故障排查',
    );
    expect(source).toContain("createField('手动端口', vTubeStudioPortInput)");
    expect(source).toContain('不用另外下载 Spout2');
    expect(source).toContain("authorization.reason === 'api-disabled'");
    expect(source).toContain("inspected.reason === 'api-disabled'");
    expect(source).toContain('vTubeStudioSetupNotice.hidden = false');
    expect(source).toContain('const inspected = await api.inspectVTubeStudio()');
    expect(source).toContain("vTubeStudioExpressionTestButton = createButton('测试惊讶表情'");
    expect(source).toContain("vTubeStudioExpressionPreviewButton = createButton('预览并返回桌面'");
    expect(source).toContain("createField('逐个查看模型表情', vTubeStudioExpressionSelect)");
    expect(source).toContain('`查看全部 ${inventory.parameters.length} 个模型参数`');
    expect(source).toContain('...expression.parameters.map((parameter) => parameter.name)');
    expect(source).toContain('api.previewVTubeStudioExpression({ active: true, expressionIndex })');
    expect(source).toContain('api.previewVTubeStudioExpression({ active: false })');
    expect(source).toContain("api.presentInVTubeStudio({ emotion: 'surprised' })");
    expect(source).toContain("result.reason === 'mapping-missing'");
    expect(source).toContain('当前模型没有可用的“惊讶”表情映射');
    expect(source).toContain("api.presentInVTubeStudio({ emotion: 'neutral' })");
    expect(source).toContain('仅连接 127.0.0.1');
    expect(source).toContain('连接时会自动寻找端口并请求 VTube Studio 授权');
    expect(source).toContain('允许插件 API 访问（Allow Plugin API access）');
    expect(source).toContain('授权已失效，正在重新请求 VTube Studio 授权');
    expect(source).toContain('const inspectSelectedVTubeStudio = async ()');
    expect(source).toContain('const hotkeyNames = inventory.hotkeys.map((hotkey) => hotkey.name)');
    expect(source).toContain("loadedCharacterDisplayMode === 'vtube-studio'");
    expect(indexSource).toContain(
      "if (mode === 'vtube-studio') await vTubeStudioPresentation?.setState('idle')",
    );
    expect(source).toContain("displayModeResult.mode === 'vtube-studio'");
    expect(source).toContain('await inspectSelectedVTubeStudio();');
    expect(source).toContain("vtubePanel.listenForSelection(settingsTabButtons.get('display')");
    expect(source).toContain(".get('vtube-studio')");
  });

  it('saves independent settings before an AI chat model is configured', () => {
    expect(source).not.toContain("statusTarget.textContent = '请填写模型名称。';");
    expect(source).toContain('modelId\n        ? api.setConversationConfiguration');
    expect(source).toContain('其他设置已保存；AI 对话模型尚未配置。');
    expect(source).toContain("connectionStatus.textContent = '请填写 AI 对话模型名称。';");
    expect(source.indexOf('api.setSpeechSettings({ settings: speechSettings })')).toBeGreaterThan(
      source.indexOf('const modelId = modelInput.value.trim();'),
    );
  });

  it('groups the three mutually exclusive character displays into left-hand tabs', () => {
    expect(readElementOption('displayModeTitle', 'textContent')).toBe('角色显示方式');
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
    expect(source).toContain("await persistCharacterDisplayMode('live2d')");
    expect(source).toContain('transitionCharacterDisplayMode({');
    expect(source).toContain('选择模型主目录中的 .model3.json');
  });

  it('keeps all character management in one left-navigation category', () => {
    expect(controllerSource).not.toContain('const characterPageBody =');
    expect(controllerSource).toContain('characterSettingsSection.append(characterPanel.pageBody)');
    expect(source.match(/const characterPageBody =/gu)).toHaveLength(1);
    expect(readElementOption('settingsTitle', 'textContent')).toBe('设置');
    expect(readElementOption('settingsTitle', 'textContent')).not.toBe('For People No Friend 设置');
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
    expect(source).toContain("showCharacterSettings: () => showSettingsPage('character')");
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

  it('uses both top bars as drag surfaces without a separate drag hint', () => {
    expect(source).toContain("root.classList.toggle('settings-expanded'");
    expect(source).toContain('settingsPanel.scrollTop = 0;');
    expect(source).toContain('let openingLineShown = false;');
    expect(source).toContain("let openingLineContext: OpeningLineContext = 'resume';");
    expect(source).toContain('conversationMessages: messages.length');
    expect(source).toContain('await api.generateContextualOpeningLine()');
    expect(source).toContain("setReplyStatus('正在想起上次对话…')");
    expect(source).toContain('showOpeningLineIfReady();');
    expect(styles).not.toContain('.window-drag-region::after');
    expect(styles).toContain('.chat-expanded:not(.settings-expanded) .window-drag-region');
    expect(styles).toMatch(
      /\.chat-panel__header\s*\{[^}]*-webkit-app-region:\s*drag;[^}]*cursor:\s*grab;/su,
    );
    expect(styles).toMatch(/\.chat-panel__header button\s*\{[^}]*-webkit-app-region:\s*no-drag;/su);
    expect(styles).toContain('.settings-expanded .character-host');
    expect(styles).toContain('.settings-layout');
    expect(styles).toMatch(
      /\.settings-expanded \.settings-panel\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/su,
    );
    expect(styles).toMatch(
      /\.settings-expanded \.settings-layout\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/su,
    );
    expect(readElementOption('settingsHeaderActions', 'className')).toBe('settings-header-actions');
    expect(source).toContain(
      'settingsHeaderActions.append(settingsStatus, settingsActions, closeSettingsButton)',
    );
    expect(source).not.toContain("settingsFooter.className = 'settings-footer'");
    expect(styles).toMatch(
      /\.settings-expanded \.settings-panel > \.chat-drawer__header\s*\{[^}]*-webkit-app-region:\s*drag;/su,
    );
    expect(styles).toMatch(/\.settings-header-actions\s*\{[^}]*-webkit-app-region:\s*no-drag;/su);
    expect(styles).toMatch(/#app::after\s*\{[^}]*display:\s*none;/su);
    expect(styles).toContain('.settings-section');
  });

  it('colors every expanded area except the Live2D pane', () => {
    expect(styles).toMatch(/#app\.chat-expanded\s*\{[^}]*background:\s*transparent;/su);
    expect(styles).toMatch(
      /#app\.chat-expanded::before\s*\{[^}]*right:\s*calc\(50% \+ 8px\);[^}]*border:\s*0;[^}]*border-radius:\s*14px;[^}]*background:\s*transparent;/su,
    );
    expect(styles).toContain('0 0 0 9999px rgb(24 25 28 / 90%)');
    expect(styles).toMatch(
      /#app\.chat-expanded\[data-character-pane='right'\]:not\(\.settings-expanded\)::before\s*\{[^}]*right:\s*10px;[^}]*left:\s*calc\(50% \+ 8px\);/su,
    );
    expect(styles).toMatch(
      /#app\.chat-expanded\[data-character-display-mode='live2d'\]:not\(\.character-is-loading\)::before\s*\{[^}]*top:\s*var\(--visible-frame-top\);[^}]*right:\s*auto;[^}]*bottom:\s*auto;[^}]*left:\s*var\(--visible-frame-left\);[^}]*width:\s*var\(--visible-frame-width\);[^}]*height:\s*var\(--visible-frame-height\);/su,
    );
    expect(styles).toMatch(
      /#app\.chat-expanded\[data-character-display-mode='live2d'\]\[data-character-pane='right'\]:not\(\s*\.character-is-loading\s*\)::before\s*\{[^}]*left:\s*calc\(50% \+ var\(--visible-frame-left\)\);/su,
    );
    expect(styles).toMatch(
      /\.chat-panel\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/su,
    );
    expect(styles).toMatch(
      /\.settings-expanded \.chat-panel\s*\{[^}]*overflow:\s*hidden;[^}]*border:\s*1px solid rgb\(225 228 234 \/ 24%\);[^}]*border-radius:\s*24px;[^}]*background:\s*linear-gradient\(145deg, #242529, #17181b\);[^}]*box-shadow:\s*none;/su,
    );
    expect(styles).toMatch(
      /\.settings-expanded \.settings-panel > \.chat-drawer__header\s*\{[^}]*border-radius:\s*23px 23px 0 0;/su,
    );
    expect(styles).toMatch(
      /\.settings-expanded \.settings-navigation\s*\{[^}]*background:\s*rgb\(31 32 35 \/ 98%\);/su,
    );
    expect(styles).toMatch(
      /\.settings-expanded \.settings-section\s*\{[^}]*background:\s*rgb\(35 36 40 \/ 92%\);/su,
    );
    expect(styles).toMatch(
      /\.settings-expanded \.settings-field input,[^}]*background:\s*rgb\(45 46 50 \/ 96%\);/su,
    );
    expect(styles).toMatch(
      /\.conversation-list\s*\{[^}]*border-radius:\s*12px 12px 0 0;[^}]*background:\s*rgb\(29 30 33 \/ 94%\);/su,
    );
    expect(styles).toMatch(
      /\.chat-composer\s*\{[^}]*border-top:\s*0;[^}]*border-radius:\s*0 0 14px 14px;[^}]*background:\s*rgb\(33 34 37 \/ 94%\);/su,
    );
    expect(styles).toMatch(/\.chat-toolbar__button,[^}]*border-radius:\s*10px;/su);
    expect(styles).toMatch(
      /#app\.chat-expanded:not\(\.settings-expanded\),[^}]*#app\.chat-expanded:not\(\.settings-expanded\) \*\s*\{[^}]*border-color:\s*transparent;/su,
    );
  });

  it('opens directly into conversation mode without collapsed launcher controls', () => {
    expect(source).not.toContain("createButton('>>>', 'chat-launcher')");
    expect(source).not.toContain("createButton('<<<', 'text-button chat-collapse')");
    expect(source).not.toContain('setPanelExpanded(false);');
    expect(source).toContain("setPanelExpanded(true, 'chat');");
    expect(styles).not.toContain('.chat-launcher');
    expect(styles).not.toContain('.chat-collapse');
  });

  it('uses a compact auto-growing composer with clear action controls', () => {
    expect(composerSource).toContain("input.placeholder = '输入消息或任务…'");
    expect(composerSource).not.toContain('Ctrl+Enter 发送');
    expect(composerSource).toContain('input.rows = 1;');
    expect(composerSource).not.toContain('const resizeComposer');
    expect(composerSource).not.toContain(
      "event.key === 'Enter' && event.ctrlKey && !event.isComposing",
    );
    expect(composerSource).toContain(
      'actions.append(microphoneButton, stopSpeechButton, stopButton, sendButton)',
    );
    expect(composerSource).toContain("dropStatus.className = 'chat-composer__drop-status'");
    expect(source).toContain('工作模式开启后，可把文本或文件拖到整个对话区。');
    expect(styles).toMatch(
      /\.chat-composer\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*grid-template-areas:\s*['"]input actions['"] ['"]status status['"];/su,
    );
    expect(styles).toMatch(/\.chat-composer__input\s*\{[^}]*min-height:\s*32px;/su);
    expect(styles).toMatch(/\.chat-composer__input\s*\{[^}]*height:\s*32px;/su);
    expect(styles).toMatch(/\.chat-composer__input\s*\{[^}]*max-height:\s*32px;/su);
    expect(styles).toMatch(/\.chat-composer__input\s*\{[^}]*resize:\s*none;/su);
    expect(styles).toMatch(/\.chat-composer__input\s*\{[^}]*overflow-y:\s*auto;/su);
    expect(styles).toMatch(/\.chat-composer__drop-status:empty\s*\{[^}]*display:\s*none;/su);
    expect(styles).toMatch(
      /\.chat-composer__send,[^}]*\.chat-composer__microphone,[^}]*\.chat-composer__stop,[^}]*\.chat-composer__stop-speech\s*\{[^}]*min-height:\s*26px;[^}]*padding:\s*5px 9px;[^}]*font-size:\s*10px;[^}]*border-radius:\s*999px;/su,
    );
    expect(source).toContain("state === 'processing' ? '识别...' : '在听...'");
    expect(source).toContain("microphoneButton.textContent = listening ? '在听...' : '开启监听'");
    expect(source).not.toContain('完全监听中');
    expect(source).not.toContain('精准监听中');
    expect(styles).toMatch(
      /\.chat-composer__microphone\[aria-pressed='true'\]\s*\{[^}]*background:\s*rgb\(44 45 49 \/ 96%\);/su,
    );
    expect(styles).toMatch(/\.chat-panel\s*\{[^}]*gap:\s*0;/su);
    expect(styles).toMatch(/\.chat-panel__header\s*\{[^}]*margin-bottom:\s*8px;/su);
    expect(styles).toMatch(/\.chat-toolbar\s*\{[^}]*margin-top:\s*8px;/su);
  });

  it('shows the main conversation as left and right chat bubbles', () => {
    const timelineSource = source.slice(
      source.indexOf('const renderConversationTimeline'),
      source.indexOf('const renderHistory'),
    );
    const historySource = source.slice(
      source.indexOf('const renderHistory'),
      source.indexOf('const renderMemories'),
    );
    expect(source).toContain("conversationList.className = 'conversation-list'");
    expect(timelineModuleSource).toContain(
      'item.className = `conversation-message conversation-message--${message.role}`',
    );
    expect(source).toContain('renderConversationTimeline();');
    expect(timelineSource).not.toContain("document.createElement('strong')");
    expect(historySource).not.toContain("document.createElement('strong')");
    expect(styles).not.toContain('.conversation-message strong');
    expect(styles).toMatch(/\.conversation-message--user\s*\{[^}]*align-items:\s*flex-end;/su);
    expect(styles).toMatch(
      /\.conversation-message--user p\s*\{[^}]*background:\s*rgb\(68 70 74 \/ 94%\);/su,
    );
    expect(styles).toMatch(
      /\.conversation-message--assistant\s+p\s*\{[^}]*background:\s*rgb\(48 50 54 \/ 94%\);/su,
    );
  });

  it('rounds the transparent model area upward into the square widget reserve', () => {
    expect(styles).toMatch(
      /\.desktop-widgets-active \.desktop-overlay-stack\s*\{[^}]*z-index:\s*10;[^}]*bottom:\s*0;[^}]*padding:\s*8px;[^}]*border-radius:\s*0;[^}]*background:\s*rgb\(24 25 28\);/su,
    );
    expect(styles).toMatch(/#app\.chat-expanded::before\s*\{[^}]*background:\s*transparent;/su);
    expect(styles).toMatch(
      /#app\.chat-expanded\.desktop-widgets-active:not\(\.settings-expanded\)::before\s*\{[^}]*bottom:\s*var\(--desktop-widget-reserve, 0px\);/su,
    );
    expect(source).not.toContain('? 128');
    expect(source).not.toContain('? 84');
    expect(source).not.toContain('? 60');
    expect(styles).toMatch(
      /\.desktop-widgets-active \.desktop-overlay-stack\s*\{[^}]*top:\s*auto;[^}]*max-height:\s*45%;/su,
    );
  });

  it('offers one explicit work mode for bounded workspace and web tools', () => {
    expect(source).toContain("createButton('工作模式 OFF', 'text-button assistant-mode-button')");
    expect(source).toContain("'secondary-button assistant-workspace-button'");
    expect(readElementOption('assistantWorkspaceHeading', 'textContent')).toBe('工作区与权限');
    expect(readElementOption('assistantInterfaceTitle', 'textContent')).toBe('当前工作接口');
    expect(source).toContain("'普通聊天'");
    expect(source).toContain("'OFF'");
    expect(source).toContain("'工作模式'");
    expect(source).toContain("'ON'");
    expect(source).toContain('文件接口：列出、搜索、读取、新建、精确修改或打开文件');
    expect(source).toContain('网页接口：搜索网页、读取 HTTPS 公开页面');
    expect(source).toContain('工作区内直接操作；工作区外真实路径与可执行文件逐次确认');
    expect(source).toContain('启用听歌控制即授权上一首、播放/暂停和下一首');
    expect(source).toContain('const result = await api.selectAssistantWorkspace();');
    expect(source).toContain('assistantMode: assistantModeEnabled');
    expect(source).toContain('wakeFromDrowsy,');
    expect(source).toContain('const wakeFromDrowsy = companionDrowsy;');
    expect(source).toContain('api.importDroppedWorkspaceFiles({');
    expect(composerSource).toContain('files.map(async (file) => ({');
    expect(composerSource).toContain("dragEvent.dataTransfer?.getData('text/plain')");
    expect(composerSource).toContain("dropTarget.classList.add('is-drop-active')");
    expect(composerSource).toContain("dropTarget.addEventListener('dragover', handleDragOver)");
    expect(composerSource).toContain("dropTarget.addEventListener('drop', handleDrop)");
    expect(composerSource).toContain("showDropStatus('已把拖入文本放进输入框')");
    expect(composerSource).toContain(
      "windowRef.addEventListener('drop', preventWindowFileNavigation)",
    );
    expect(source).toContain("event.type === 'tool-approval'");
    expect(source).toContain('api?.resolveAssistantToolApproval({');
    expect(styles).toContain('.assistant-mode-button.is-active');
    expect(styles).toContain('.chat-panel.is-drop-active');
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

  it('offers synthetic agreement and disagreement actions while VTube Studio is active', () => {
    expect(source).toContain("readCharacterDisplayMode() === 'vtube-studio'");
    expect(source).toContain("? ['nod', 'shake']");
    expect(source).toContain('availableActions: readAvailablePresentationActions()');
  });

  it('confirms VTube Studio expression and action candidates inside the current model namespace', () => {
    expect(source).toContain("createButton(\n    '确认自动识别的映射'");
    expect(source).toContain('currentVTubeStudioMapping.suggestions.emotionExpressions');
    expect(source).toContain('currentVTubeStudioMapping.suggestions.actionHotkeys');
    expect(source).toContain('vTubeStudioModelMappings[model.id] = {');
    expect(source).toContain("['nod', '肯定 / 点头']");
    expect(source).toContain("['shake', '否定 / 摇头']");
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
    expect(source).toContain("scaleInput.value = '0.78';");
    expect(readElementOption('scaleOutput', 'textContent')).toBe('78%');
    expect(source).toContain('scaleInput.max = String(MAX_WINDOW_SCALE);');
    expect(windowIpcSource).toContain('MAX_WINDOW_SCALE = 1.2');
  });

  it('preserves the stored safe layout without showing interface-position controls', () => {
    expect(source).not.toContain("layoutPositionTitle.textContent = '界面位置'");
    expect(source).not.toContain("createField('模型与对话框', characterPaneSelect)");
    expect(source).not.toContain("createField('小组件位置', widgetAlignmentSelect)");
    expect(source).not.toContain("previewLayoutPositionButton = createButton('保存并预览位置'");
    expect(source).toContain('api.setDesktopLayoutSettings');
    expect(source).toContain('currentDesktopLayoutSettings = settings;');
    expect(styles).toContain("[data-character-pane='right'] .character-host");
    expect(styles).toContain("[data-character-pane='right'] .chat-panel");
    expect(styles).toContain("[data-widget-alignment='center'] .desktop-overlay-stack");
    expect(styles).toContain("[data-widget-alignment='end'] .desktop-overlay-stack");
  });

  it('uses the same visible model and voice editor for bundled and external TTS', () => {
    expect(source).toContain("createField('新角色名称', newCharacterNameInput)");
    expect(styles).toContain('.local-character-actions .settings-field');
    expect(readElementOption('speechVoiceIdentityTitle', 'textContent')).toBe('语音模型与音色');
    expect(source).toContain("createField('语音模型 ID', speechModelInput)");
    expect(source).toContain("createField('音色 / Speaker ID', speechVoiceInput)");
    expect(source).not.toContain('speechBundledVoice');
    expect(source).not.toContain('showVoiceSummary');
    expect(source).not.toContain('speechVoiceEditorExpanded');
    expect(source).toContain("['openai-compatible', 'OpenAI 兼容 TTS（本机或在线）']");
    expect(source).toContain("['genie-tts', '本机 Genie-TTS']");
    expect(source).not.toContain('其他 OpenAI 兼容 TTS（本机或在线）');
    expect(source).toContain('speechOpenAiCompatibleOption');
    expect(source).not.toContain("? '本机 Style-Bert-VITS2（伊蕾娜）'");
    expect(source).not.toContain("createButton('配置其他音色', 'text-button')");
    expect(source).not.toContain('speechModelInput.readOnly');
    expect(source).toContain("speechVoiceFieldLabel.textContent = '音色 ID'");
    expect(source).toContain("speechVoiceConfirmButton.hidden = providerId === 'disabled'");
    expect(source).toContain(
      "showButtonFeedback(speechVoiceConfirmButton, '已确认 ✓', 'success', 1_200)",
    );
    expect(source).not.toContain('speechModelInput.value = speechVoiceInput.value');
    expect(source).toContain('speechVoiceInput.focus()');
    expect(source).toContain('const speechVoiceConfirmButton = createButton(');
    expect(source).toContain("'secondary-button speech-voice-identity__confirm'");
    expect(source).toContain("speechStatus.textContent = '请填写音色 ID。'");
    expect(source).toContain('音色已确认；请点击右上角“保存”使其生效。');
    expect(styles).toContain('.speech-voice-identity__fields');
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(source).toContain("showButtonFeedback(saveButton, '保存中…', 'pending')");
    expect(source).toContain("showButtonFeedback(saveButton, '已保存 ✓', 'success', 1_500)");
    expect(source).toContain("showButtonFeedback(saveButton, '保存失败', 'error', 1_500)");
    expect(styles).toContain("button[data-feedback='success']");
    expect(styles).toContain("button[data-feedback='error']");
    expect(speechLanguageSource).toContain("['ja-JP', '日语（ja-JP）']");
    expect(speechLanguageSource).toContain("['zh-CN', '中文（zh-CN）']");
    expect(speechLanguageSource).toContain("['en-US', '英语（en-US）']");
    expect(speechLanguageSource).toContain("['custom', '自定义']");
    expect(source).toContain("createField('语言', speechLanguageSelect)");
    expect(source).toContain("createField('自定义语言代码', speechLanguageInput)");
    expect(source).toContain('language: readSpeechLanguage()');
    expect(source).toContain("speechStatus.textContent = '请填写自定义语言代码。'");
  });

  it('uses a generic VTube Studio model installation label', () => {
    expect(source).toContain("createButton('安装模型', 'secondary-button')");
    expect(source).not.toContain('安装随包小猫模型');
    expect(source).toContain(
      'vTubeStudioInstallModelButton.hidden = !status.bundledModelAvailable',
    );
  });

  it('expands character text fields to show their complete content', () => {
    expect(source).toContain("textarea.classList.add('settings-textarea--auto');");
    expect(source).toContain('textarea.style.height = `${textarea.scrollHeight}px`;');
    expect(source).toContain('const loreEditorResizeObserver = new ResizeObserver');
    expect(source).toContain("lifetime.on(loreEditor, 'toggle'");
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
