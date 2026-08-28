import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('settings renderer regression wiring', () => {
  const source = readFileSync(resolve('src/renderer/chat/chat-controller.ts'), 'utf8');
  const styles = readFileSync(resolve('src/renderer/styles.css'), 'utf8');

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

  it('applies both desktop switches immediately through the narrow settings method', () => {
    expect(source).toContain("globalShortcutInput.addEventListener('change'");
    expect(source).toContain("mediaControlInput.addEventListener('change'");
    expect(source.match(/void saveDesktopIntegrationSettings\(\);/gu)).toHaveLength(3);
    expect(source).toContain(
      'await api.setDesktopIntegrationSettings({ settings: requestedSettings })',
    );
    expect(source).toContain(
      'displayDesktopIntegrationStatus(await api.getDesktopIntegrationStatus())',
    );
  });

  it('guards media buttons against overlapping commands', () => {
    expect(source).toContain('if (!api || mediaCommandInFlight) return;');
    expect(source).toContain('mediaCommandInFlight = true;');
    expect(source).toContain('mediaCommandInFlight = false;');
  });

  it('uses the shared layout, keeps the drag hint, and shows one opening line', () => {
    expect(source).not.toContain("root.classList.toggle('settings-expanded'");
    expect(source).toContain('let openingLineShown = false;');
    expect(source).toContain('showOpeningLineIfReady();');
    expect(styles).toContain('.window-drag-region::after');
    expect(styles).not.toContain('.settings-expanded .character-host');
  });

  it('groups history, memory, and context under one records menu', () => {
    expect(source).toContain("recordsMenuButton.textContent = '资料';");
    expect(source).toContain('recordsMenuItems.append(historyButton, memoryButton, debugButton);');
    expect(source).toContain('toolbar.append(recordsMenu, settingsButton);');
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

  it('exposes a remote-provider key field without duplicating same-provider secrets', () => {
    expect(source).toContain("createField('远端 API Key', remoteApiKeyInput)");
    expect(source).toContain('remoteApiKeyInput.disabled = !enabled || sharesProvider;');
    expect(source).toContain('远端模型与上方使用同一提供商，将共用该提供商的密钥。');
    expect(source).toContain('remoteProviderSelect.value !== providerId');
  });
});
