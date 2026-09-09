import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountOopzSettings } from '../src/renderer/chat/settings-oopz';
import type { OopzPresenceSnapshot, OopzSettingsInput } from '../src/shared/social-ipc';
import { fakePanelDocument, panelText } from './helpers/panel-dom';

const URL_OK = 'ws://127.0.0.1:6700';
const ACCOUNT = '13800000000';
const PASSWORD = 'fake-oopz-password';

const makeSnapshot = (
  configuration: Partial<OopzPresenceSnapshot['configuration']> = {},
  bridge: OopzPresenceSnapshot['bridge'] = 'stopped',
  state: OopzPresenceSnapshot['state'] = 'not-configured',
): OopzPresenceSnapshot => ({
  configuration: {
    characterId: 'character-a',
    enabled: false,
    onebotUrl: '',
    ownerBindingCount: 0,
    hasCredentials: false,
    runtimeAvailable: false,
    ...configuration,
  },
  bridge,
  state,
});

const input = (element: HTMLInputElement, value: string): void => {
  element.value = value;
  element.dispatchEvent(new Event('input'));
};
const check = (element: HTMLInputElement, checked: boolean): void => {
  element.checked = checked;
  element.dispatchEvent(new Event('change'));
};
const click = (element: HTMLButtonElement): void => {
  element.dispatchEvent(new Event('click'));
};

const panels: Array<ReturnType<typeof mountOopzSettings>> = [];
afterEach(() => {
  for (const panel of panels.splice(0)) panel.dispose();
});

const setup = (initial: OopzPresenceSnapshot = makeSnapshot()) => {
  fakePanelDocument();
  let snapshot = initial;
  const api = {
    getOopzPresence: vi.fn(async () => snapshot),
    saveOopzPresence: vi.fn(async (settings: OopzSettingsInput) => {
      snapshot = makeSnapshot(
        {
          ...snapshot.configuration,
          enabled: settings.enabled,
          onebotUrl: settings.onebotUrl ?? snapshot.configuration.onebotUrl,
          hasCredentials: !!settings.account || snapshot.configuration.hasCredentials,
          ownerBindingCount:
            settings.ownerUserIds?.length ?? snapshot.configuration.ownerBindingCount,
        },
        snapshot.bridge,
        snapshot.state,
      );
      return snapshot;
    }),
    startOopzBridge: vi.fn(async () => (snapshot = { ...snapshot, bridge: 'running' })),
    stopOopzBridge: vi.fn(async () => (snapshot = { ...snapshot, bridge: 'stopped' })),
    connectOopzPresence: vi.fn(async () => (snapshot = { ...snapshot, state: 'online' })),
    disconnectOopzPresence: vi.fn(async () => (snapshot = { ...snapshot, state: 'offline' })),
    deleteOopzSecret: vi.fn(async () => {
      snapshot = makeSnapshot(
        { ...snapshot.configuration, hasCredentials: false },
        snapshot.bridge,
        snapshot.state,
      );
      return snapshot;
    }),
  };
  const panel = mountOopzSettings({ api });
  panels.push(panel);
  const open = async () => {
    panel.setActive(true);
    await vi.waitFor(() => expect(panel.elements.saveButton.disabled).toBe(false));
  };
  return { panel, api, open, current: () => snapshot };
};

describe('Oopz settings panel', () => {
  it('is opt-in, reads only when opened, and never polls', async () => {
    const h = setup();

    expect(h.api.getOopzPresence).not.toHaveBeenCalled();
    await h.open();
    expect(h.api.getOopzPresence).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.api.getOopzPresence).toHaveBeenCalledTimes(1);
  });

  it('refuses to store credentials until the experimental warning is accepted', async () => {
    const h = setup();
    await h.open();

    check(h.panel.elements.enabledInput, true);
    input(h.panel.elements.accountInput, ACCOUNT);
    input(h.panel.elements.passwordInput, PASSWORD);
    click(h.panel.elements.saveButton);

    expect(h.api.saveOopzPresence).not.toHaveBeenCalled();
    expect(panelText(h.panel.elements.status)).toContain('实验性风险');

    check(h.panel.elements.warningInput, true);
    click(h.panel.elements.saveButton);
    await vi.waitFor(() => expect(h.api.saveOopzPresence).toHaveBeenCalledTimes(1));
    expect(h.api.saveOopzPresence.mock.calls[0]?.[0]).toMatchObject({
      account: ACCOUNT,
      password: PASSWORD,
      acceptedWarningVersion: 1,
    });
    // The credential is never kept in the DOM after the write.
    expect(h.panel.elements.passwordInput.value).toBe('');
  });

  it('requires the account and password together', async () => {
    const h = setup();
    await h.open();
    check(h.panel.elements.warningInput, true);
    input(h.panel.elements.accountInput, ACCOUNT);

    click(h.panel.elements.saveButton);

    expect(h.api.saveOopzPresence).not.toHaveBeenCalled();
    expect(panelText(h.panel.elements.status)).toContain('必须一起填写');
  });

  it('explains why starting is impossible without an audited runtime', async () => {
    const h = setup(
      makeSnapshot({
        enabled: true,
        hasCredentials: true,
        onebotUrl: URL_OK,
        runtimeAvailable: false,
      }),
    );
    await h.open();

    expect(h.panel.elements.startBridgeButton.disabled).toBe(true);
    expect(panelText(h.panel.elements.bridgeStatus)).toContain('未配置经过审核的桥接运行时');
    expect(panelText(h.panel.elements.bridgeStatus)).toContain('不会被解密');

    check(h.panel.elements.warningInput, true);
    click(h.panel.elements.startBridgeButton);
    expect(h.api.startOopzBridge).not.toHaveBeenCalled();
  });

  it('keeps the two lifecycles separate: starting does not connect', async () => {
    const h = setup(
      makeSnapshot({
        enabled: true,
        hasCredentials: true,
        onebotUrl: URL_OK,
        runtimeAvailable: true,
      }),
    );
    await h.open();
    check(h.panel.elements.warningInput, true);

    // Connecting is unavailable while the process is not running.
    expect(h.panel.elements.connectButton.disabled).toBe(true);

    click(h.panel.elements.startBridgeButton);
    await vi.waitFor(() => expect(h.api.startOopzBridge).toHaveBeenCalledTimes(1));
    expect(h.api.connectOopzPresence).not.toHaveBeenCalled();
    expect(panelText(h.panel.elements.bridgeStatus)).toContain('不代表已登录');

    await vi.waitFor(() => expect(h.panel.elements.connectButton.disabled).toBe(false));
    click(h.panel.elements.connectButton);
    await vi.waitFor(() => expect(h.api.connectOopzPresence).toHaveBeenCalledTimes(1));
    expect(panelText(h.panel.elements.connectionStatus)).toContain('已连接');
  });

  it('shows both lifecycles independently', async () => {
    const h = setup(
      makeSnapshot(
        { enabled: true, hasCredentials: true, onebotUrl: URL_OK, runtimeAvailable: true },
        'running',
        'offline',
      ),
    );
    await h.open();

    expect(panelText(h.panel.elements.bridgeStatus)).toContain('进程运行中');
    expect(panelText(h.panel.elements.connectionStatus)).toContain('已断开');
  });

  it('stops the bridge and deletes the stored credential on request', async () => {
    const h = setup(
      makeSnapshot(
        { enabled: true, hasCredentials: true, onebotUrl: URL_OK, runtimeAvailable: true },
        'running',
      ),
    );
    await h.open();

    click(h.panel.elements.stopBridgeButton);
    await vi.waitFor(() => expect(h.api.stopOopzBridge).toHaveBeenCalledTimes(1));

    click(h.panel.elements.deleteSecretButton);
    await vi.waitFor(() => expect(h.api.deleteOopzSecret).toHaveBeenCalledTimes(1));
    expect(h.current().configuration.hasCredentials).toBe(false);
  });

  it('discards the draft and both credential fields when the page closes', async () => {
    const h = setup();
    await h.open();
    input(h.panel.elements.accountInput, ACCOUNT);
    input(h.panel.elements.passwordInput, PASSWORD);
    check(h.panel.elements.warningInput, true);

    h.panel.setActive(false);

    expect(h.panel.elements.accountInput.value).toBe('');
    expect(h.panel.elements.passwordInput.value).toBe('');
    expect(h.panel.elements.warningInput.checked).toBe(false);
  });

  it('ignores a stale completion after the character switched', async () => {
    const h = setup();
    await h.open();
    check(h.panel.elements.warningInput, true);
    input(h.panel.elements.accountInput, ACCOUNT);
    input(h.panel.elements.passwordInput, PASSWORD);

    h.api.getOopzPresence.mockResolvedValueOnce(makeSnapshot({ characterId: 'another-character' }));
    click(h.panel.elements.saveButton);

    await vi.waitFor(() => expect(panelText(h.panel.elements.status)).toContain('当前角色已切换'));
    expect(h.api.saveOopzPresence).not.toHaveBeenCalled();
  });

  it('degrades without the optional API and never echoes a raw error', async () => {
    fakePanelDocument();
    const offline = mountOopzSettings({ api: undefined });
    panels.push(offline);
    offline.setActive(true);
    expect(offline.elements.saveButton.disabled).toBe(true);
    offline.resetForCharacterChange();
    expect(panelText(offline.elements.status)).toContain('不可用');

    const h = setup();
    await h.open();
    h.api.getOopzPresence.mockRejectedValueOnce(new Error(`login failed for ${ACCOUNT}`));
    click(h.panel.elements.refreshButton);

    await vi.waitFor(() => expect(panelText(h.panel.elements.status)).toContain('请刷新重试'));
    expect(panelText(h.panel.elements.status)).not.toContain(ACCOUNT);
  });

  it('blocks starting and connecting while there are unsaved edits', async () => {
    const h = setup(
      makeSnapshot(
        { enabled: true, hasCredentials: true, onebotUrl: URL_OK, runtimeAvailable: true },
        'running',
      ),
    );
    await h.open();
    check(h.panel.elements.warningInput, true);

    input(h.panel.elements.urlInput, 'ws://127.0.0.1:7000');
    expect(h.panel.elements.startBridgeButton.disabled).toBe(true);
    expect(h.panel.elements.connectButton.disabled).toBe(true);
  });
});
