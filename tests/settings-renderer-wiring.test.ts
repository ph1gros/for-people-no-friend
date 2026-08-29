import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('settings renderer regression wiring', () => {
  const source = readFileSync(resolve('src/renderer/chat/chat-controller.ts'), 'utf8');
  const styles = readFileSync(resolve('src/renderer/styles.css'), 'utf8');
  const registry = readFileSync(resolve('src/renderer/widgets/widget-registry.ts'), 'utf8');

  it('places connection feedback directly after the test action and before unrelated settings', () => {
    const formStart = source.indexOf('settingsPanel.append(');
    const formEnd = source.indexOf('\n  );', formStart);
    const formLayout = source.slice(formStart, formEnd);

    expect(formStart).toBeGreaterThan(-1);
    expect(formLayout.indexOf("createField('API Key', apiKeyInput)")).toBeLessThan(
      formLayout.indexOf('connectionActions'),
    );
    expect(formLayout.indexOf('connectionActions')).toBeLessThan(
      formLayout.indexOf('connectionStatus'),
    );
    expect(formLayout.indexOf('connectionStatus')).toBeLessThan(
      formLayout.indexOf("createField('角色名称', characterNameInput)"),
    );
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
    expect(source).toContain("'up-right': '↗'");
    expect(source).toContain('inputOverlayMouse.hidden = !settings.inputOverlayMouseEnabled;');
    expect(styles).toContain('.input-overlay__key.is-active');
    expect(styles).toContain('.input-overlay__direction.is-active');
    expect(styles).toMatch(
      /\.desktop-overlay-stack\s*\{[^}]*width:\s*calc\(100% - var\(--visible-frame-left, 14px\) - 8px\);/su,
    );
    expect(styles).toMatch(
      /\.input-overlay\s*\{[^}]*width:\s*max-content;[^}]*max-width:\s*100%;/su,
    );
    expect(styles).toMatch(
      /\.input-overlay__keys\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/su,
    );
  });

  it('organizes input and media controls as extensible widget catalog cards', () => {
    expect(source).toContain("widgetsButton = createButton('小组件'");
    expect(source).toContain('toolbar.append(recordsMenu, widgetsButton, settingsButton);');
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
    expect(source).toContain('widgetsPanel.hidden = !willOpen;');
    expect(styles).toContain('.widgets-panel__content');
    expect(styles).toContain('.widget-catalog-card');
    expect(styles).toContain('.widget-catalog-card__settings');
    expect(styles).toContain('.widget-detail');
    expect(styles).toMatch(/\.desktop-overlay-stack\s*\{[^}]*gap:\s*0;/su);
    expect(styles).toContain('var(--visible-frame-top, 0px)');
    expect(styles).toContain('var(--visible-frame-height, calc(100% - 16px))');
    expect(styles).toMatch(/\.widgets-panel\s*\{[^}]*inset:\s*50px 8px auto;/su);
    expect(styles).toMatch(/\.widgets-panel__content\s*\{[^}]*height:\s*auto;/su);
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
      'inputWidgetHeader.append(backFromInputWidgetButton, inputWidgetTitle, inputOverlayEnabledInput)',
    );
    expect(source).toContain(
      'mediaWidgetHeader.append(backFromMediaWidgetButton, mediaWidgetTitle, mediaControlInput)',
    );
    expect(styles).toContain('.settings-toggle-heading');
    expect(styles).toContain(".widget-detail__header input[type='checkbox']");
  });

  it('guards media buttons against overlapping commands', () => {
    expect(source).toContain('if (!api || mediaCommandInFlight) return;');
    expect(source).toContain('mediaCommandInFlight = true;');
    expect(source).toContain('mediaCommandInFlight = false;');
    expect(source).toContain('desktopStatus.media.title');
    expect(source).toContain("'正在播放'");
    expect(source).toContain("'已暂停'");
    expect(source).toContain('mediaStatusRefreshTimer = window.setInterval');
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

  it('does not retain the removed temporary do-not-disturb surface', () => {
    expect(source).not.toContain('toggleDesktopMute');
    expect(source).not.toContain('desktopTemporarilyMuted');
    expect(source).not.toContain('临时免打扰');
  });

  it('uses the shared layout, keeps the drag hint, and shows one opening line', () => {
    expect(source).not.toContain("root.classList.toggle('settings-expanded'");
    expect(source).toContain('let openingLineShown = false;');
    expect(source).toContain("let openingLineContext: OpeningLineContext = 'resume';");
    expect(source).toContain('conversationMessages: messages.length');
    expect(source).toContain('await api.generateContextualOpeningLine()');
    expect(source).toContain("setReplyStatus('正在想起上次对话…')");
    expect(source).toContain('showOpeningLineIfReady();');
    expect(styles).toContain('.window-drag-region::after');
    expect(styles).not.toContain('.settings-expanded .character-host');
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

  it('groups history, memory, and context under one records menu', () => {
    expect(source).toContain("recordsMenuButton.textContent = '资料';");
    expect(source).toContain('recordsMenuItems.append(historyButton, memoryButton, debugButton);');
    expect(source).toContain('toolbar.append(recordsMenu, widgetsButton, settingsButton);');
    expect(styles).toContain('.chat-tools-menu__items');
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
  });

  it('expands character text fields to show their complete content', () => {
    expect(source).toContain("textarea.classList.add('settings-textarea--auto');");
    expect(source).toContain('textarea.style.height = `${textarea.scrollHeight}px`;');
    expect(source).toContain('const loreEditorResizeObserver = new ResizeObserver');
    expect(source).toContain("loreEditor.addEventListener('toggle'");
    expect(source).toContain('loreEditor.open = false;');
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
