import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  registerSocialIpcHandlers,
  type SocialIpcController,
} from '../src/main/ipc/register-social-ipc-handlers';
import type { SenderValidationWindow } from '../src/main/ipc/sender-validation';
import {
  QQ_PRESENCE_PUBLIC_ERROR,
  SOCIAL_IPC_CHANNELS,
  parseQqCharacterInput,
  parseQqPresenceConfiguration,
  parseQqPresenceSnapshot,
  parseQqSettingsInput,
  parseSaveQqPresenceInput,
  type QqPresenceApi,
  type QqPresenceSnapshot,
} from '../src/shared/social-ipc';

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<QqPresenceSnapshot>>(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => Promise<QqPresenceSnapshot>,
    ) => {
      ipc.handlers.set(channel, handler);
    },
    removeHandler: ipc.removeHandler,
  },
}));

const validInput = () => ({ characterId: 'character-a', appId: '12345', enabled: false });
const snapshot = (): QqPresenceSnapshot => ({
  configuration: {
    ...validInput(),
    ownerBindingCount: 0,
    hasSecret: false,
    voiceReplyEnabled: false,
  },
  state: 'offline',
});

describe('QQ IPC parsers', () => {
  it('defaults disabled, preserves omission, accepts explicit clear, and copies only declared fields', () => {
    expect(parseQqSettingsInput({ characterId: 'character-a', appId: '' })).toEqual({
      characterId: 'character-a',
      appId: '',
      enabled: false,
    });
    expect(parseQqSettingsInput(validInput())).not.toHaveProperty('ownerUserIds');
    expect(parseQqSettingsInput({ ...validInput(), ownerUserIds: undefined })).not.toHaveProperty(
      'ownerUserIds',
    );
    expect(
      parseQqSettingsInput({
        ...validInput(),
        ownerUserIds: [],
        ownerTokens: ['forged-token'],
        hasSecret: true,
      }),
    ).toEqual({
      ...validInput(),
      ownerUserIds: [],
    });
    expect(parseSaveQqPresenceInput).toBe(parseQqSettingsInput);
    expect(parseQqCharacterInput({ characterId: 'character-a', appSecret: 'fake-secret' })).toEqual(
      { characterId: 'character-a' },
    );
  });

  it('accepts bounded decimal app IDs, opaque QQ owner IDs and a write-only fake secret', () => {
    const ownerUserIds = ['fake-owner', 'FAKE_QQ_OPEN_ID_001', '12345', 'a:b.c-d'];
    const parsed = parseQqSettingsInput({
      ...validInput(),
      appId: '1'.repeat(32),
      appSecret: ' fake-secret ',
      ownerUserIds: [...ownerUserIds, ownerUserIds[0]],
    });
    expect(parsed.appSecret).toBe('fake-secret');
    expect(parsed.ownerUserIds).toEqual(ownerUserIds);
    expect(
      parseQqSettingsInput({
        ...validInput(),
        characterId: 'x'.repeat(64),
        ownerUserIds: Array.from({ length: 8 }, (_, i) => `fake-${i}`),
      }).ownerUserIds,
    ).toHaveLength(8);
  });

  it.each([undefined, null, true, 7, 'input', [], {}, { characterId: 'a' }])(
    'rejects invalid settings envelopes (%#)',
    (input) => {
      expect(() => parseQqSettingsInput(input)).toThrow();
    },
  );

  it.each(['', '.', '..', 'a.b', '../a', 'a/b', 'a\\b', 'a b', 'a\n', 'x'.repeat(65), null, 1])(
    'rejects invalid character IDs in both input parsers (%#)',
    (characterId) => {
      expect(() => parseQqCharacterInput({ characterId })).toThrow();
      expect(() => parseQqSettingsInput({ ...validInput(), characterId })).toThrow();
    },
  );

  it.each([
    '1234',
    '1'.repeat(33),
    ' 12345',
    '12345 ',
    '12e34',
    '12.34',
    '1234a',
    '１２３４５',
    null,
    12345,
  ])('rejects invalid app IDs (%#)', (appId) => {
    expect(() => parseQqSettingsInput({ ...validInput(), appId })).toThrow();
  });

  it.each([null, 0, 1, 'true', [], {}])('requires a boolean enabled flag (%#)', (enabled) => {
    expect(() => parseQqSettingsInput({ ...validInput(), enabled })).toThrow();
  });

  it.each([
    '',
    ' ',
    '***',
    '\u2022\u2022\u2022',
    'x'.repeat(32_769),
    'fake\nsecret',
    'fake\u0000secret',
    123,
    null,
    {},
  ])('rejects invalid or masked secrets without echoing input (%#)', (appSecret) => {
    expect(() => parseQqSettingsInput({ ...validInput(), appSecret })).toThrow(
      'The social presence input is invalid.',
    );
  });

  it.each([
    null,
    {},
    'fake-owner',
    [123],
    [''],
    ['*'],
    ['a b'],
    ['a/b'],
    ['x'.repeat(129)],
    Array(9).fill('same-fake-owner'),
    new Array(1),
  ])('rejects invalid owners and validates the limit before deduplication (%#)', (ownerUserIds) => {
    expect(() => parseQqSettingsInput({ ...validInput(), ownerUserIds })).toThrow();
  });

  it('projects snapshots to public fields and replaces untrusted error details', () => {
    const privateSnapshot = {
      ...snapshot(),
      appSecret: 'fake-secret',
      identitySalt: 'a'.repeat(64),
      ownerTokens: ['fake-token'],
      configuration: {
        ...snapshot().configuration,
        ownerUserIds: ['fake-owner'],
        ownerTokens: ['fake-token'],
        appSecret: 'fake-secret',
      },
    };
    expect(parseQqPresenceSnapshot(privateSnapshot)).toEqual(snapshot());
    expect(parseQqPresenceConfiguration(privateSnapshot.configuration)).toEqual(
      snapshot().configuration,
    );
    expect(
      parseQqPresenceSnapshot({
        ...privateSnapshot,
        state: 'error',
        errorMessage: 'fake-private-provider-diagnostic',
      }),
    ).toEqual({
      ...snapshot(),
      state: 'error',
      errorMessage: QQ_PRESENCE_PUBLIC_ERROR,
    });
    expect(
      parseQqPresenceSnapshot({ ...snapshot(), errorMessage: 'fake-secret' }),
    ).not.toHaveProperty('errorMessage');
  });

  it.each(['not-configured', 'offline', 'connecting', 'online', 'error'])(
    'accepts connection state %s',
    (state) => {
      expect(parseQqPresenceSnapshot({ ...snapshot(), state }).state).toBe(state);
    },
  );

  it.each([
    undefined,
    null,
    [],
    {},
    { ...snapshot(), state: 'connected' },
    { ...snapshot(), errorMessage: {} },
  ])('rejects invalid snapshot envelopes (%#)', (input) => {
    expect(() => parseQqPresenceSnapshot(input)).toThrow();
  });

  it.each([
    { characterId: '../escape' },
    { appId: 'invalid' },
    { enabled: undefined },
    { hasSecret: 1 },
    { ownerBindingCount: -1 },
    { ownerBindingCount: 9 },
    { ownerBindingCount: 1.5 },
    { ownerBindingCount: NaN },
    { ownerBindingCount: Infinity },
    { ownerBindingCount: '1' },
    { ownerBindingCount: undefined },
  ])('rejects invalid snapshot configuration (%#)', (configuration) => {
    expect(() =>
      parseQqPresenceSnapshot({
        ...snapshot(),
        configuration: { ...snapshot().configuration, ...configuration },
      }),
    ).toThrow();
  });
});

describe('QQ IPC handlers', () => {
  const mainFrame = {};
  const webContents = { mainFrame };
  const window = { isDestroyed: () => false, webContents } as SenderValidationWindow;
  const trustedEvent = { sender: webContents, senderFrame: mainFrame };
  const operations = [
    ['getQqPresence', 'getSnapshot', undefined],
    ['saveQqPresence', 'save', validInput()],
    ['connectQqPresence', 'connect', { characterId: 'character-a' }],
    ['disconnectQqPresence', 'disconnect', { characterId: 'character-a' }],
    ['deleteQqSecret', 'deleteSecret', { characterId: 'character-a' }],
  ] as const;
  let controller: ReturnType<typeof fakeController>;
  let dispose: () => void;

  const fakeController = () => ({
    getWindow: vi.fn<SocialIpcController['getWindow']>(() => window),
    getSnapshot: vi.fn<SocialIpcController['getSnapshot']>(async () => snapshot()),
    save: vi.fn<SocialIpcController['save']>(async () => snapshot()),
    connect: vi.fn<SocialIpcController['connect']>(async () => snapshot()),
    disconnect: vi.fn<SocialIpcController['disconnect']>(async () => snapshot()),
    deleteSecret: vi.fn<SocialIpcController['deleteSecret']>(async () => snapshot()),
  });

  beforeEach(() => {
    ipc.handlers.clear();
    ipc.removeHandler.mockClear();
    controller = fakeController();
    dispose = registerSocialIpcHandlers(controller);
  });

  const invoke = (method: keyof QqPresenceApi, input: unknown, event: unknown = trustedEvent) => {
    const handler = ipc.handlers.get(SOCIAL_IPC_CHANNELS[method]);
    if (!handler) throw new Error('Missing test handler.');
    return handler(event, input);
  };

  it('declares a fixed channel table for every platform', () => {
    expect(SOCIAL_IPC_CHANNELS).toEqual({
      controlKookVoice: 'deskpet:social-kook:voice',
      getQqPresence: 'deskpet:social-qq:get',
      saveQqPresence: 'deskpet:social-qq:save',
      connectQqPresence: 'deskpet:social-qq:connect',
      disconnectQqPresence: 'deskpet:social-qq:disconnect',
      deleteQqSecret: 'deskpet:social-qq:delete-secret',
      getKookPresence: 'deskpet:social-kook:get',
      saveKookPresence: 'deskpet:social-kook:save',
      connectKookPresence: 'deskpet:social-kook:connect',
      disconnectKookPresence: 'deskpet:social-kook:disconnect',
      deleteKookSecret: 'deskpet:social-kook:delete-secret',
      getOopzPresence: 'deskpet:social-oopz:get',
      saveOopzPresence: 'deskpet:social-oopz:save',
      startOopzBridge: 'deskpet:social-oopz:start-bridge',
      stopOopzBridge: 'deskpet:social-oopz:stop-bridge',
      connectOopzPresence: 'deskpet:social-oopz:connect',
      disconnectOopzPresence: 'deskpet:social-oopz:disconnect',
      deleteOopzSecret: 'deskpet:social-oopz:delete-secret',
    });
  });

  it('protects KOOK voice commands with the sender check, parser and response projection', async () => {
    const result = {
      configuration: {
        characterId: 'character-a',
        enabled: true,
        hasToken: true,
        ownerBindingCount: 0,
      },
      state: 'online' as const,
      ip: 'private-detail',
    };
    const controlVoice = vi.fn(async () => result);
    registerSocialIpcHandlers(controller, {
      getWindow: () => window,
      getSnapshot: async () => result,
      save: async () => result,
      connect: async () => result,
      disconnect: async () => result,
      deleteSecret: async () => result,
      controlVoice,
    });
    const handler = ipc.handlers.get(SOCIAL_IPC_CHANNELS.controlKookVoice)!;
    const input = { characterId: 'character-a', action: 'join', channelId: '1234' };
    await expect(handler({ sender: webContents, senderFrame: {} }, input)).rejects.toThrow(
      'Unauthorized',
    );
    await expect(handler(trustedEvent, { ...input, channelId: '../x' })).rejects.toThrow();
    expect(controlVoice).not.toHaveBeenCalled();
    expect(await handler(trustedEvent, input)).not.toHaveProperty('ip');
    expect(controlVoice).toHaveBeenCalledWith(input);
  });

  it('registers only the wired platform and removes exactly what it registered', () => {
    const qqChannels = [
      SOCIAL_IPC_CHANNELS.getQqPresence,
      SOCIAL_IPC_CHANNELS.saveQqPresence,
      SOCIAL_IPC_CHANNELS.connectQqPresence,
      SOCIAL_IPC_CHANNELS.disconnectQqPresence,
      SOCIAL_IPC_CHANNELS.deleteQqSecret,
    ];

    // KOOK has no controller here, so its channels must stay unhandled.
    expect([...ipc.handlers.keys()]).toEqual(qqChannels);
    dispose();
    expect(ipc.removeHandler.mock.calls.map(([channel]) => channel)).toEqual(qqChannels);
  });

  it.each(operations)(
    'accepts trusted %s and routes validated inputs',
    async (method, operation, input) => {
      expect(await invoke(method, input)).toEqual(snapshot());
      if (operation === 'getSnapshot') expect(controller[operation]).toHaveBeenCalledWith();
      else if (operation === 'save')
        expect(controller[operation]).toHaveBeenCalledWith(validInput());
      else expect(controller[operation]).toHaveBeenCalledWith('character-a');
    },
  );

  it.each(operations)(
    'rejects forged frames, senders, closed and missing windows for %s',
    async (method, operation, input) => {
      for (const event of [
        { ...trustedEvent, sender: {} },
        { ...trustedEvent, senderFrame: {} },
        { ...trustedEvent, senderFrame: null },
        { sender: { mainFrame }, senderFrame: mainFrame },
      ]) {
        await expect(invoke(method, input, event)).rejects.toThrow('Unauthorized IPC sender.');
      }
      controller.getWindow.mockReturnValue({ ...window, isDestroyed: () => true });
      await expect(invoke(method, input)).rejects.toThrow('Unauthorized IPC sender.');
      controller.getWindow.mockReturnValue(undefined);
      await expect(invoke(method, input)).rejects.toThrow('Unauthorized IPC sender.');
      expect(controller[operation]).not.toHaveBeenCalled();
    },
  );

  it.each(operations)(
    'validates the live window again on every %s call',
    async (method, operation, input) => {
      await invoke(method, input);
      const otherMainFrame = {};
      controller.getWindow.mockReturnValue({
        ...window,
        webContents: { mainFrame: otherMainFrame },
      } as SenderValidationWindow);
      await expect(invoke(method, input)).rejects.toThrow('Unauthorized IPC sender.');
      expect(controller[operation]).toHaveBeenCalledTimes(1);
    },
  );

  it.each(operations)(
    'rejects invalid payloads and extra arguments for %s before controller calls',
    async (method, operation) => {
      for (const input of [null, true, [], {}, { characterId: '../escape' }]) {
        await expect(invoke(method, input)).rejects.toThrow(QQ_PRESENCE_PUBLIC_ERROR);
      }
      if (operation !== 'getSnapshot')
        await expect(invoke(method, undefined)).rejects.toThrow(QQ_PRESENCE_PUBLIC_ERROR);
      await expect(
        ipc.handlers.get(SOCIAL_IPC_CHANNELS[method])!(trustedEvent, undefined, 'fake-extra'),
      ).rejects.toThrow(QQ_PRESENCE_PUBLIC_ERROR);
      expect(controller[operation]).not.toHaveBeenCalled();
    },
  );

  it.each(operations)(
    'hides rejected and synchronous errors for %s',
    async (method, operation, input) => {
      controller[operation].mockRejectedValueOnce(new Error('fake-private-secret-and-path'));
      await expect(invoke(method, input)).rejects.toThrow(QQ_PRESENCE_PUBLIC_ERROR);
      controller[operation].mockImplementationOnce(() => {
        throw new Error('fake-private-owner');
      });
      await expect(invoke(method, input)).rejects.toThrow(QQ_PRESENCE_PUBLIC_ERROR);
    },
  );

  it.each(operations)(
    'sanitizes controller snapshots for %s before returning over IPC',
    async (method, operation, input) => {
      controller[operation].mockResolvedValueOnce({
        ...snapshot(),
        state: 'error',
        errorMessage: 'fake-secret-in-diagnostic',
        configuration: {
          ...snapshot().configuration,
          appSecret: 'fake-secret',
          ownerUserIds: ['fake-owner'],
          ownerTokens: ['fake-token'],
        },
        identitySalt: 'fake-salt',
      } as QqPresenceSnapshot);
      expect(await invoke(method, input)).toEqual({
        ...snapshot(),
        state: 'error',
        errorMessage: QQ_PRESENCE_PUBLIC_ERROR,
      });
      controller[operation].mockResolvedValueOnce({
        ...snapshot(),
        configuration: { characterId: 'fake-owner' },
      } as QqPresenceSnapshot);
      await expect(invoke(method, input)).rejects.toThrow(QQ_PRESENCE_PUBLIC_ERROR);
    },
  );

  it('keeps preserve and clear operations distinct, ignoring forged owner tokens', async () => {
    await invoke('saveQqPresence', { ...validInput(), ownerTokens: ['fake-forged-owner-token'] });
    expect(controller.save).toHaveBeenLastCalledWith(validInput());
    await invoke('saveQqPresence', { ...validInput(), ownerUserIds: [] });
    expect(controller.save).toHaveBeenLastCalledWith({ ...validInput(), ownerUserIds: [] });
  });

  it.each(['connectQqPresence', 'disconnectQqPresence', 'deleteQqSecret'] as const)(
    'captures the explicit character before an asynchronous %s operation',
    async (method) => {
      const operation =
        method === 'connectQqPresence'
          ? 'connect'
          : method === 'disconnectQqPresence'
            ? 'disconnect'
            : 'deleteSecret';
      const input = { characterId: 'character-a' };
      const pending = invoke(method, input);
      input.characterId = 'character-b';
      await pending;
      expect(controller[operation]).toHaveBeenCalledWith('character-a');
      expect(controller.getSnapshot).not.toHaveBeenCalled();
    },
  );
});
