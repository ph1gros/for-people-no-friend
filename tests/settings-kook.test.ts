import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountKookSettings } from '../src/renderer/chat/settings-kook';
import type { KookPresenceSnapshot, KookSettingsInput } from '../src/shared/social-ipc';
import { fakePanelDocument, panelText } from './helpers/panel-dom';

const TOKEN = 'fake-kook-bot-token-value';

const makeSnapshot = (
  configuration: Partial<KookPresenceSnapshot['configuration']> = {},
  state: KookPresenceSnapshot['state'] = 'offline',
): KookPresenceSnapshot => ({
  configuration: {
    characterId: 'character-a',
    enabled: false,
    hasToken: false,
    ownerBindingCount: 0,
    ...configuration,
  },
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

const panels: Array<ReturnType<typeof mountKookSettings>> = [];
afterEach(() => {
  for (const panel of panels.splice(0)) panel.dispose();
});

const setup = () => {
  fakePanelDocument();
  let snapshot = makeSnapshot();
  const api = {
    controlKookVoice: vi.fn<
      (input: import('../src/shared/social-ipc').KookVoiceInput) => Promise<KookPresenceSnapshot>
    >(async () => snapshot),
    getKookPresence: vi.fn(async () => snapshot),
    saveKookPresence: vi.fn(async (input: KookSettingsInput) => {
      snapshot = makeSnapshot({
        ...snapshot.configuration,
        enabled: input.enabled,
        hasToken: !!input.botToken || snapshot.configuration.hasToken,
        ownerBindingCount: input.ownerUserIds?.length ?? snapshot.configuration.ownerBindingCount,
      });
      return snapshot;
    }),
    connectKookPresence: vi.fn(async () => (snapshot = { ...snapshot, state: 'online' })),
    disconnectKookPresence: vi.fn(async () => (snapshot = { ...snapshot, state: 'offline' })),
    deleteKookSecret: vi.fn(async () => {
      snapshot = makeSnapshot({ ...snapshot.configuration, hasToken: false });
      return snapshot;
    }),
  };
  const panel = mountKookSettings({ api });
  panels.push(panel);
  const open = async () => {
    panel.setActive(true);
    await vi.waitFor(() => expect(panel.elements.saveButton.disabled).toBe(false));
  };
  return { panel, api, open, current: () => snapshot };
};

describe('KOOK settings panel', () => {
  it('exposes explicit public voice actions and clears the speech draft when hidden', async () => {
    const h = setup();
    h.api.getKookPresence.mockResolvedValue(
      makeSnapshot({ enabled: true, hasToken: true }, 'online'),
    );
    await h.open();
    expect(h.api.controlKookVoice).not.toHaveBeenCalled();
    input(h.panel.elements.voiceChannelInput, '12345');
    click(h.panel.elements.voiceJoinButton);
    await vi.waitFor(() =>
      expect(h.api.controlKookVoice).toHaveBeenCalledWith({
        characterId: 'character-a',
        action: 'join',
        channelId: '12345',
      }),
    );
    await vi.waitFor(() => expect(h.panel.elements.voiceSpeakButton.disabled).toBe(false));
    input(h.panel.elements.voiceTextInput, '公开朗读测试');
    click(h.panel.elements.voiceSpeakButton);
    await vi.waitFor(() =>
      expect(h.api.controlKookVoice).toHaveBeenCalledWith({
        characterId: 'character-a',
        action: 'speak',
        text: '公开朗读测试',
      }),
    );
    h.panel.setActive(false);
    expect(h.panel.elements.voiceTextInput.value).toBe('');
    expect(h.panel.elements.voiceChannelInput.value).toBe('');
  });
  it('is opt-in, reads only when opened, and never polls', async () => {
    const h = setup();

    expect(h.api.getKookPresence).not.toHaveBeenCalled();
    expect(h.panel.elements.saveButton.disabled).toBe(true);

    await h.open();
    expect(h.api.getKookPresence).toHaveBeenCalledTimes(1);
    expect(h.panel.elements.enabledInput.checked).toBe(false);
    expect(h.panel.elements.connectButton.disabled).toBe(true);

    // Simply staying open must not trigger another read.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.api.getKookPresence).toHaveBeenCalledTimes(1);
  });

  it('saves the token once, erases the input and still requires an explicit connect', async () => {
    const h = setup();
    await h.open();

    check(h.panel.elements.enabledInput, true);
    input(h.panel.elements.tokenInput, TOKEN);
    click(h.panel.elements.saveButton);
    await vi.waitFor(() => expect(h.api.saveKookPresence).toHaveBeenCalledTimes(1));

    expect(h.api.saveKookPresence).toHaveBeenCalledWith({
      characterId: 'character-a',
      enabled: true,
      botToken: TOKEN,
    });
    // The credential is never kept in the DOM after the write.
    expect(h.panel.elements.tokenInput.value).toBe('');
    expect(h.api.connectKookPresence).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(h.panel.elements.connectButton.disabled).toBe(false));
    click(h.panel.elements.connectButton);
    await vi.waitFor(() => expect(h.api.connectKookPresence).toHaveBeenCalledTimes(1));
    expect(panelText(h.panel.elements.connectionStatus)).toContain('已连接');
  });

  it('refuses to enable without a token', async () => {
    const h = setup();
    await h.open();

    check(h.panel.elements.enabledInput, true);
    click(h.panel.elements.saveButton);

    expect(h.api.saveKookPresence).not.toHaveBeenCalled();
    expect(panelText(h.panel.elements.status)).toContain('请填写 KOOK Bot Token');
  });

  it('preserves an omitted token and clears bindings only when asked', async () => {
    const h = setup();
    await h.open();
    check(h.panel.elements.enabledInput, true);
    input(h.panel.elements.tokenInput, TOKEN);
    input(h.panel.elements.ownerInput, 'kook-owner-1');
    click(h.panel.elements.saveButton);
    await vi.waitFor(() => expect(h.api.saveKookPresence).toHaveBeenCalledTimes(1));

    // A second save without a token keeps the stored one.
    click(h.panel.elements.saveButton);
    await vi.waitFor(() => expect(h.api.saveKookPresence).toHaveBeenCalledTimes(2));
    expect(h.api.saveKookPresence.mock.calls[1]?.[0]).not.toHaveProperty('botToken');

    check(h.panel.elements.clearOwnersInput, true);
    click(h.panel.elements.saveButton);
    await vi.waitFor(() => expect(h.api.saveKookPresence).toHaveBeenCalledTimes(3));
    expect(h.api.saveKookPresence.mock.calls[2]?.[0]?.ownerUserIds).toEqual([]);
  });

  it('keeps unsaved edits across an explicit refresh and blocks connecting while dirty', async () => {
    const h = setup();
    await h.open();
    check(h.panel.elements.enabledInput, true);
    input(h.panel.elements.tokenInput, TOKEN);
    click(h.panel.elements.saveButton);
    await vi.waitFor(() => expect(h.api.saveKookPresence).toHaveBeenCalledTimes(1));

    input(h.panel.elements.ownerInput, 'kook-owner-2');
    expect(h.panel.elements.connectButton.disabled).toBe(true);

    click(h.panel.elements.refreshButton);
    await vi.waitFor(() => expect(h.api.getKookPresence).toHaveBeenCalledTimes(3));
    expect(h.panel.elements.ownerInput.value).toBe('kook-owner-2');
    expect(panelText(h.panel.elements.status)).toContain('未保存的修改已保留');
  });

  it('deletes only the stored token', async () => {
    const h = setup();
    await h.open();
    check(h.panel.elements.enabledInput, true);
    input(h.panel.elements.tokenInput, TOKEN);
    click(h.panel.elements.saveButton);
    await vi.waitFor(() => expect(h.api.saveKookPresence).toHaveBeenCalledTimes(1));

    click(h.panel.elements.deleteSecretButton);
    await vi.waitFor(() => expect(h.api.deleteKookSecret).toHaveBeenCalledTimes(1));

    expect(h.current().configuration.hasToken).toBe(false);
    expect(panelText(h.panel.elements.status)).toContain('已删除保存的 Bot Token');
  });

  it('discards the draft and the credential when the page closes or the panel is disposed', async () => {
    const h = setup();
    await h.open();
    input(h.panel.elements.tokenInput, TOKEN);
    input(h.panel.elements.ownerInput, 'kook-owner-1');

    h.panel.setActive(false);
    expect(h.panel.elements.tokenInput.value).toBe('');
    expect(h.panel.elements.ownerInput.value).toBe('');

    await h.open();
    input(h.panel.elements.tokenInput, TOKEN);
    h.panel.dispose();
    expect(h.panel.elements.tokenInput.value).toBe('');
  });

  it('ignores a stale save completion after the character switched', async () => {
    const h = setup();
    await h.open();
    check(h.panel.elements.enabledInput, true);
    input(h.panel.elements.tokenInput, TOKEN);

    h.api.getKookPresence.mockResolvedValueOnce(makeSnapshot({ characterId: 'another-character' }));
    click(h.panel.elements.saveButton);
    await vi.waitFor(() => expect(panelText(h.panel.elements.status)).toContain('当前角色已切换'));

    expect(h.api.saveKookPresence).not.toHaveBeenCalled();
  });

  it('degrades without the optional API and never echoes a raw error', async () => {
    fakePanelDocument();
    const offline = mountKookSettings({ api: undefined });
    panels.push(offline);
    offline.setActive(true);
    expect(offline.elements.saveButton.disabled).toBe(true);
    offline.resetForCharacterChange();
    expect(panelText(offline.elements.status)).toContain('不可用');

    const h = setup();
    await h.open();
    h.api.getKookPresence.mockRejectedValueOnce(new Error(`Bot ${TOKEN} rejected`));
    click(h.panel.elements.refreshButton);

    await vi.waitFor(() => expect(panelText(h.panel.elements.status)).toContain('请刷新重试'));
    expect(panelText(h.panel.elements.status)).not.toContain(TOKEN);
  });

  it('surfaces a failed connection as a status without leaking the cause', async () => {
    const h = setup();
    await h.open();
    check(h.panel.elements.enabledInput, true);
    input(h.panel.elements.tokenInput, TOKEN);
    click(h.panel.elements.saveButton);
    await vi.waitFor(() => expect(h.panel.elements.connectButton.disabled).toBe(false));

    h.api.connectKookPresence.mockResolvedValueOnce({
      ...makeSnapshot({ enabled: true, hasToken: true }, 'error'),
      errorMessage: 'KOOK presence is unavailable. Please check the configuration and try again.',
    });
    click(h.panel.elements.connectButton);

    await vi.waitFor(() => expect(panelText(h.panel.elements.status)).toContain('操作未完成'));
    expect(panelText(h.panel.elements.connectionStatus)).toContain('连接失败');
  });
});
