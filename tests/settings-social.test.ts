import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QqPresenceSnapshot, QqSettingsInput } from '../src/shared/social-ipc';
import { mountSocialSettings } from '../src/renderer/chat/settings-social';
import { asPanelElement, fakePanelDocument, panelNodes, panelText } from './helpers/panel-dom';

const makeSnapshot = (
  configuration: Partial<QqPresenceSnapshot['configuration']> = {},
  state: QqPresenceSnapshot['state'] = 'offline',
): QqPresenceSnapshot => ({
  configuration: {
    characterId: 'character-a',
    appId: 'fake-app',
    enabled: false,
    hasSecret: false,
    ownerBindingCount: 0,
    ...configuration,
  },
  state,
});

const panels: Array<ReturnType<typeof mountSocialSettings>> = [];
const setup = () => {
  fakePanelDocument();
  let snapshot = makeSnapshot();
  const api = {
    getQqPresence: vi.fn(async () => snapshot),
    saveQqPresence: vi.fn(async (input: QqSettingsInput) => {
      const changedApp = input.appId !== snapshot.configuration.appId;
      snapshot = makeSnapshot({
        ...snapshot.configuration,
        appId: input.appId,
        enabled: input.enabled,
        hasSecret: !!input.appSecret || (!changedApp && snapshot.configuration.hasSecret),
        ownerBindingCount:
          input.ownerUserIds?.length ?? (changedApp ? 0 : snapshot.configuration.ownerBindingCount),
      });
      return snapshot;
    }),
    connectQqPresence: vi.fn(async () => (snapshot = { ...snapshot, state: 'online' })),
    disconnectQqPresence: vi.fn(async () => (snapshot = { ...snapshot, state: 'offline' })),
    deleteQqSecret: vi.fn(async () => {
      snapshot = makeSnapshot({ ...snapshot.configuration, hasSecret: false });
      return snapshot;
    }),
  };
  const panel = mountSocialSettings({ api });
  panels.push(panel);
  const open = async () => {
    panel.setActive(true);
    await vi.waitFor(() => expect(panel.elements.saveButton.disabled).toBe(false));
  };
  return {
    panel,
    api,
    open,
    setSnapshot: (value: QqPresenceSnapshot) => {
      snapshot = value;
    },
  };
};

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
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
const deferred = () => {
  let resolve!: (snapshot: QqPresenceSnapshot) => void;
  const promise = new Promise<QqPresenceSnapshot>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

describe('QQ social settings', () => {
  afterEach(() => {
    panels.splice(0).forEach((panel) => panel.dispose());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock('electron');
  });

  it('is opt-in, reads only on open, and explains the official bot and private memory boundary', async () => {
    const { panel, api, open } = setup();
    const e = panel.elements;
    expect(e.enabledInput.checked).toBe(false);
    expect(api.getQqPresence).not.toHaveBeenCalled();
    expect(e.saveButton.disabled).toBe(true);
    await open();
    expect(e.connectButton.disabled).toBe(true);
    expect(e.appSecretInput.type).toBe('password');
    expect(e.appSecretInput.autocomplete).toBe('off');
    expect(e.appSecretInput.value).toBe('');
    const text = panelText(asPanelElement(panel.section));
    expect(text).toContain('社交存在');
    expect(text).toContain('QQ 官方机器人');
    expect(text).toContain('C2C');
    expect(text).toContain('不是 QQ 号');
    expect(text).toContain('当前机器人');
    expect(text).toContain('一对一私聊');
    expect(text).toContain('公开群聊永不使用主人的私人历史');
    expect(text).toContain('启动时不会自动连接');
    expect(api.connectQqPresence).not.toHaveBeenCalled();
    for (const node of panelNodes(asPanelElement(panel.section))) {
      expect(node).not.toHaveProperty('innerHTML');
      if (node.tagName === 'button') expect(node.type).toBe('button');
    }
  });

  it('saves fake app credentials once, erases the password and requires explicit connection', async () => {
    const { panel, api, open } = setup();
    await open();
    const e = panel.elements;
    input(e.appIdInput, '  new-fake-app  ');
    input(e.appSecretInput, 'fake-only-app-secret');
    input(e.ownerInput, 'fake-bot-openid');
    check(e.enabledInput, true);
    click(e.connectButton);
    expect(api.connectQqPresence).not.toHaveBeenCalled();
    expect(e.status.textContent).toContain('先点击');
    click(e.saveButton);
    click(e.saveButton);
    await flush();
    expect(api.saveQqPresence).toHaveBeenCalledExactlyOnceWith({
      characterId: 'character-a',
      appId: 'new-fake-app',
      enabled: true,
      appSecret: 'fake-only-app-secret',
      ownerUserIds: ['fake-bot-openid'],
    });
    expect(e.appSecretInput.value).toBe('');
    expect(e.ownerInput.value).toBe('');
    expect(panelText(asPanelElement(panel.section))).not.toContain('fake-only-app-secret');
    expect(e.configurationStatus.textContent).toContain('主人绑定：1');
    expect(e.status.textContent).toContain('已保存');
    expect(api.connectQqPresence).not.toHaveBeenCalled();
    expect(e.connectButton.disabled).toBe(false);
    click(e.connectButton);
    await flush();
    expect(api.connectQqPresence).toHaveBeenCalledExactlyOnceWith({ characterId: 'character-a' });
    expect(e.connectionStatus.textContent).toContain('已连接');
    click(e.disconnectButton);
    await flush();
    expect(api.disconnectQqPresence).toHaveBeenCalledExactlyOnceWith({
      characterId: 'character-a',
    });
    expect(e.connectionStatus.textContent).toContain('已断开');
  });

  it('preserves omitted owners and secrets, and explicitly clears owner bindings with []', async () => {
    const { panel, api, open, setSnapshot } = setup();
    setSnapshot(makeSnapshot({ hasSecret: true, enabled: true, ownerBindingCount: 2 }));
    await open();
    const e = panel.elements;
    click(e.saveButton);
    await flush();
    expect(api.saveQqPresence).toHaveBeenLastCalledWith({
      characterId: 'character-a',
      appId: 'fake-app',
      enabled: true,
    });
    expect(e.configurationStatus.textContent).toContain('主人绑定：2');
    check(e.clearOwnersInput, true);
    expect(e.ownerInput.disabled).toBe(true);
    click(e.saveButton);
    await flush();
    expect(api.saveQqPresence).toHaveBeenLastCalledWith({
      characterId: 'character-a',
      appId: 'fake-app',
      enabled: true,
      ownerUserIds: [],
    });
    expect(e.configurationStatus.textContent).toContain('主人绑定：0');
    expect(e.clearOwnersInput.checked).toBe(false);
  });

  it('preserves dirty fields on explicit refresh and requires a new secret when changing enabled app ID', async () => {
    const { panel, api, open, setSnapshot } = setup();
    setSnapshot(makeSnapshot({ hasSecret: true, enabled: true }));
    await open();
    const e = panel.elements;
    input(e.appIdInput, 'new-fake-app');
    input(e.ownerInput, 'fake-new-owner');
    await panel.refresh();
    expect(e.appIdInput.value).toBe('new-fake-app');
    expect(e.ownerInput.value).toBe('fake-new-owner');
    expect(e.connectButton.disabled).toBe(true);
    expect(e.status.textContent).toContain('修改已保留');
    click(e.saveButton);
    expect(api.saveQqPresence).not.toHaveBeenCalled();
    expect(e.status.textContent).toContain('新的 App Secret');
  });

  it('deletes only the saved secret while preserving the other dirty fields', async () => {
    const { panel, api, open, setSnapshot } = setup();
    setSnapshot(makeSnapshot({ hasSecret: true }));
    await open();
    const e = panel.elements;
    input(e.appIdInput, 'draft-app');
    input(e.appSecretInput, 'fake-unsaved-secret');
    click(e.deleteSecretButton);
    await flush();
    expect(api.deleteQqSecret).toHaveBeenCalledExactlyOnceWith({ characterId: 'character-a' });
    expect(e.appSecretInput.value).toBe('');
    expect(e.appIdInput.value).toBe('draft-app');
    expect(e.configurationStatus.textContent).toContain('未保存');
    expect(e.deleteSecretButton.disabled).toBe(true);
    expect(e.connectButton.disabled).toBe(true);
  });

  it.each(['saveButton', 'connectButton', 'disconnectButton', 'deleteSecretButton'] as const)(
    'checks active identity before %s and never writes stale configuration',
    async (button) => {
      const { panel, api, open, setSnapshot } = setup();
      setSnapshot(makeSnapshot({ hasSecret: true, enabled: true }));
      await open();
      setSnapshot(makeSnapshot({ characterId: 'character-b', appId: 'bot-b' }));
      click(panel.elements[button]);
      await flush();
      expect(api.saveQqPresence).not.toHaveBeenCalled();
      expect(api.connectQqPresence).not.toHaveBeenCalled();
      expect(api.disconnectQqPresence).not.toHaveBeenCalled();
      expect(api.deleteQqSecret).not.toHaveBeenCalled();
      expect(panel.elements.appIdInput.value).toBe('bot-b');
      expect(panel.elements.status.textContent).toContain('角色已切换');
    },
  );

  it('ignores a stale save completion and an older refresh after a character switch', async () => {
    const { panel, api, open, setSnapshot } = setup();
    await open();
    const save = deferred();
    api.saveQqPresence.mockImplementationOnce(() => save.promise);
    click(panel.elements.saveButton);
    await flush();
    expect(api.saveQqPresence).toHaveBeenCalledOnce();
    const oldRead = deferred();
    api.getQqPresence.mockImplementationOnce(() => oldRead.promise);
    panel.resetForCharacterChange();
    setSnapshot(makeSnapshot({ characterId: 'character-b', appId: 'bot-b' }));
    panel.resetForCharacterChange();
    await flush();
    save.resolve(makeSnapshot({ appId: 'old-save' }));
    oldRead.resolve(makeSnapshot({ appId: 'old-read' }));
    await flush();
    expect(panel.elements.appIdInput.value).toBe('bot-b');
    expect(panel.elements.configurationStatus.textContent).toContain('character-b');
  });

  it('closing or disposing erases credentials, invalidates pending work and removes listeners', async () => {
    const { panel, api, open } = setup();
    await open();
    const e = panel.elements;
    input(e.appSecretInput, 'fake-only-secret');
    input(e.ownerInput, 'fake-only-owner');
    const beforeWrite = deferred();
    api.getQqPresence.mockImplementationOnce(() => beforeWrite.promise);
    click(e.saveButton);
    panel.setActive(false);
    expect(e.appSecretInput.value).toBe('');
    expect(e.ownerInput.value).toBe('');
    beforeWrite.resolve(makeSnapshot());
    await flush();
    expect(api.saveQqPresence).not.toHaveBeenCalled();
    const pending = deferred();
    api.getQqPresence.mockImplementationOnce(() => pending.promise);
    panel.setActive(true);
    panel.dispose();
    const priorStatus = e.status.textContent;
    pending.resolve(makeSnapshot({ appId: 'late-result' }));
    await flush();
    expect(e.status.textContent).toBe(priorStatus);
    expect(e.appIdInput.value).toBe('');
    const reads = api.getQqPresence.mock.calls.length;
    click(e.refreshButton);
    click(e.saveButton);
    input(e.ownerInput, 'after-dispose');
    expect(e.status.textContent).toBe(priorStatus);
    expect(api.getQqPresence).toHaveBeenCalledTimes(reads);
    expect(api.saveQqPresence).not.toHaveBeenCalled();
  });

  it('does not poll even while open and degrades when the optional API is absent', async () => {
    const { panel, api, open } = setup();
    await open();
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.getQqPresence).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    panel.setActive(false);
    await panel.refresh();
    expect(api.getQqPresence).toHaveBeenCalledOnce();
    const absent = mountSocialSettings({ api: undefined });
    panels.push(absent);
    absent.setActive(true);
    expect(absent.elements.status.textContent).toContain('不可用');
    expect(absent.elements.saveButton.disabled).toBe(true);
  });

  it('never echoes raw errors or snapshot diagnostics, and recovers through refresh', async () => {
    const { panel, api, open, setSnapshot } = setup();
    await open();
    input(panel.elements.appSecretInput, 'fake-private-secret');
    api.saveQqPresence.mockRejectedValueOnce(new Error('fake-private-secret <img src=x>'));
    click(panel.elements.saveButton);
    await flush();
    expect(panel.elements.appSecretInput.value).toBe('');
    expect(panelText(asPanelElement(panel.section))).not.toContain('fake-private-secret');
    expect(panel.elements.status.textContent).toContain('操作失败');
    setSnapshot({ ...makeSnapshot({}, 'error'), errorMessage: 'fake-private-secret <img src=x>' });
    await panel.refresh();
    expect(panel.elements.connectionStatus.textContent).toContain('连接失败');
    expect(panelText(asPanelElement(panel.section))).not.toContain('fake-private-secret');
    expect(panel.elements.saveButton.disabled).toBe(false);
  });
});
