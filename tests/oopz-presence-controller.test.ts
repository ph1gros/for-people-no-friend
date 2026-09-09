import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OneBotAdapter } from '../src/adapters/social/onebot/onebot-adapter';
import { DEFAULT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import type { ChatEvent } from '../src/core/llm/contracts';
import type { ModelRuntime } from '../src/main/llm/model-runtime';
import { OopzPresenceController } from '../src/main/social/oopz-presence-controller';
import { SocialConfigStore } from '../src/main/social/social-config-store';
import {
  createSocialConversationPort,
  type RuntimeSocialConversationPort,
} from '../src/main/social/social-conversation-port';
import { CharacterProfileStore } from '../src/main/storage/character-profile-store';
import { ConversationStore } from '../src/main/storage/conversation-store';
import { DeskpetDatabase } from '../src/main/storage/deskpet-database';
import type { OopzBridgeSnapshot, OopzBridgeState } from '../src/shared/oopz-bridge';
import { OOPZ_PRESENCE_PUBLIC_ERROR } from '../src/shared/social-ipc';

const URL_OK = 'ws://127.0.0.1:6700/';
const ACCOUNT = '13800000000';
const PASSWORD = 'fake-oopz-password';

const fixtures: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

const setup = async (options: { runtimeAvailable?: boolean } = {}) => {
  const directory = await mkdtemp(path.join(process.cwd(), '.oopz-controller-test-'));
  const database = new DeskpetDatabase(directory);
  const history = new ConversationStore(database);
  const profiles = new CharacterProfileStore(directory, DEFAULT_CHARACTER_PROFILE);
  let profile = await profiles.get();
  const secrets = new Map<string, string>();
  const store = new SocialConfigStore(directory, {
    get: async (id) => secrets.get(id),
    has: async (id) => secrets.has(id),
    set: async (id, value) => {
      secrets.set(id, value);
    },
    delete: async (id) => {
      secrets.delete(id);
    },
  });
  const models = {
    getConversationConfiguration: async () => ({
      selection: { providerId: 'openai-compatible', modelId: 'fake' },
    }),
    streamConversation: async function* (): AsyncIterable<ChatEvent> {
      yield { type: 'text-delta', text: '{"text":"同一角色的回复","emotion":"neutral"}' };
      yield { type: 'finish', reason: 'stop' };
    },
  } as unknown as ModelRuntime;

  // The real bridge manager needs an audited runtime; this fake models its observable contract.
  let bridgeState: OopzBridgeState = 'stopped';
  let hasCredentials = false;
  const bridge = {
    snapshot: vi.fn(async (characterId: string): Promise<OopzBridgeSnapshot> => ({
      characterId,
      state: bridgeState,
      hasCredentials,
      experimental: true,
      warning: 'fake warning',
    })),
    save: vi.fn(async () => {
      hasCredentials = true;
    }),
    start: vi.fn(async () => {
      bridgeState = 'running';
    }),
    stop: vi.fn(async () => {
      bridgeState = 'stopped';
    }),
    deleteCredentials: vi.fn(async () => {
      hasCredentials = false;
    }),
    dispose: vi.fn(async () => undefined),
  };

  const ports: RuntimeSocialConversationPort[] = [];
  const connection = {
    start: vi.fn((callbacks: { ready: (id: string) => void; state: (s: string) => void }) => {
      callbacks.state('online');
      callbacks.ready('90001');
    }),
    call: vi.fn(async () => ({ message_id: 1 })),
    stop: vi.fn(),
    connected: true,
  };
  const factory = vi.fn(
    (adapterOptions: ConstructorParameters<typeof OneBotAdapter>[0]) =>
      new OneBotAdapter({
        ...adapterOptions,
        createConnection: () => connection as never,
      }),
  );
  const controller = new OopzPresenceController({
    store,
    bridge,
    getProfile: async () => profile,
    getWindow: () => undefined,
    createAdapter: factory,
    createPort: (bound) => {
      const port = createSocialConversationPort({ profile: bound, models, profiles, history });
      ports.push(port);
      return port;
    },
    isRuntimeAvailable: () => options.runtimeAvailable ?? true,
  });
  const fixture = {
    controller,
    bridge,
    factory,
    profile,
    configure: () =>
      controller.save({
        characterId: profile.id,
        enabled: true,
        onebotUrl: URL_OK,
        account: ACCOUNT,
        password: PASSWORD,
        acceptedWarningVersion: 1,
      }),
    changeProfile: () => {
      profile = { ...profile, id: 'another-character', memoryNamespace: 'another-character' };
    },
    close: async () => {
      await controller.dispose();
      await Promise.all(ports.map((port) => port.drain()));
      database.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
  fixtures.push(fixture);
  return fixture;
};

describe('Oopz main-process composition', () => {
  it('stops the bridge synchronously when the character-change hook is called', async () => {
    const h = await setup();
    await h.configure();
    await h.controller.startBridge({ characterId: h.profile.id, acceptedWarningVersion: 1 });
    await h.controller.connect(h.profile.id);
    h.controller.stop();
    expect(h.bridge.stop).toHaveBeenCalledOnce();
    h.changeProfile();
    await expect(h.controller.connect(h.profile.id)).rejects.toThrow();
  });

  it('cancels immediately but acknowledges stop only after startup settles, without a false failure', async () => {
    const h = await setup();
    await h.configure();
    let finish!: () => void;
    h.bridge.start.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const starting = h.controller.startBridge({
      characterId: h.profile.id,
      acceptedWarningVersion: 1,
    });
    await vi.waitFor(() => expect(h.bridge.start).toHaveBeenCalledOnce());
    let acknowledged = false;
    const stopping = h.controller.stopBridge(h.profile.id).then((snapshot) => {
      acknowledged = true;
      return snapshot;
    });
    await vi.waitFor(() => expect(h.bridge.stop).toHaveBeenCalledOnce());
    expect(h.bridge.stop).toHaveBeenCalledOnce();
    expect(acknowledged).toBe(false);
    finish();
    await expect(starting).resolves.toMatchObject({ bridge: 'stopped' });
    await expect(stopping).resolves.toMatchObject({ bridge: 'stopped' });
  });

  it('waits for the previous bridge teardown before starting another process', async () => {
    const h = await setup();
    await h.configure();
    let finish!: () => void;
    h.bridge.stop.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    h.controller.stop();
    const pending = h.controller.startBridge({
      characterId: h.profile.id,
      acceptedWarningVersion: 1,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.bridge.start).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(h.bridge.start).toHaveBeenCalledOnce();
  });

  it('fails closed with a redacted error if the previous teardown failed', async () => {
    const h = await setup();
    h.bridge.stop.mockRejectedValueOnce(new Error('fake private diagnostic'));
    h.bridge.stop.mockRejectedValueOnce(new Error('fake private retry diagnostic'));
    h.controller.stop();
    await expect(
      h.controller.startBridge({ characterId: h.profile.id, acceptedWarningVersion: 1 }),
    ).rejects.toThrow(OOPZ_PRESENCE_PUBLIC_ERROR);
    expect(h.bridge.start).not.toHaveBeenCalled();
    // A later start retries teardown itself; no extra click on Stop is necessary.
    await expect(
      h.controller.startBridge({ characterId: h.profile.id, acceptedWarningVersion: 1 }),
    ).resolves.toMatchObject({ bridge: 'running' });
    expect(h.bridge.stop).toHaveBeenCalledTimes(3);
    expect(h.bridge.start).toHaveBeenCalledOnce();
  });
  it('starts unconfigured, with the bridge stopped', async () => {
    const h = await setup();

    expect(await h.controller.getSnapshot()).toEqual({
      configuration: {
        characterId: h.profile.id,
        enabled: false,
        onebotUrl: '',
        ownerBindingCount: 0,
        hasCredentials: false,
        runtimeAvailable: true,
      },
      bridge: 'stopped',
      state: 'not-configured',
    });
  });

  it('stores settings and hands the credential to the bridge manager', async () => {
    const h = await setup();

    const saved = await h.configure();

    expect(saved.configuration).toMatchObject({
      enabled: true,
      onebotUrl: URL_OK,
      hasCredentials: true,
    });
    expect(h.bridge.save).toHaveBeenCalledWith(
      expect.objectContaining({ account: ACCOUNT, password: PASSWORD, acceptedWarningVersion: 1 }),
    );
    // The credential never comes back out through the snapshot.
    expect(JSON.stringify(saved)).not.toContain(PASSWORD);
    expect(JSON.stringify(saved)).not.toContain(ACCOUNT);
  });

  it('refuses to start the bridge when no audited runtime is wired', async () => {
    const h = await setup({ runtimeAvailable: false });
    await h.configure();

    await expect(
      h.controller.startBridge({ characterId: h.profile.id, acceptedWarningVersion: 1 }),
    ).rejects.toThrow(OOPZ_PRESENCE_PUBLIC_ERROR);
    expect(h.bridge.start).not.toHaveBeenCalled();

    const snapshot = await h.controller.getSnapshot();
    expect(snapshot.configuration.runtimeAvailable).toBe(false);
  });

  it('refuses to connect while the bridge process is not running', async () => {
    const h = await setup();
    await h.configure();

    // Configured, but nobody started the bridge yet.
    await expect(h.controller.connect(h.profile.id)).rejects.toThrow(OOPZ_PRESENCE_PUBLIC_ERROR);
    expect(h.factory).not.toHaveBeenCalled();
  });

  it('connects only after the bridge was explicitly started', async () => {
    const h = await setup();
    await h.configure();

    const started = await h.controller.startBridge({
      characterId: h.profile.id,
      acceptedWarningVersion: 1,
    });
    expect(started.bridge).toBe('running');
    // Starting the process must not connect on its own: there is no readiness handshake.
    expect(h.factory).not.toHaveBeenCalled();
    expect(started.state).toBe('offline');

    const connected = await h.controller.connect(h.profile.id);
    expect(connected.state).toBe('online');
    expect(connected.bridge).toBe('running');
    expect(h.factory).toHaveBeenCalledTimes(1);
  });

  it('refuses to connect without an endpoint or while disabled', async () => {
    const h = await setup();
    await h.controller.save({ characterId: h.profile.id, enabled: true });
    await h.controller.startBridge({ characterId: h.profile.id, acceptedWarningVersion: 1 });

    // Enabled and running, but no OneBot endpoint was configured.
    await expect(h.controller.connect(h.profile.id)).rejects.toThrow(OOPZ_PRESENCE_PUBLIC_ERROR);

    await h.controller.save({ characterId: h.profile.id, enabled: false, onebotUrl: URL_OK });
    await expect(h.controller.connect(h.profile.id)).rejects.toThrow(OOPZ_PRESENCE_PUBLIC_ERROR);
  });

  it('drops the OneBot session when the bridge is stopped', async () => {
    const h = await setup();
    await h.configure();
    await h.controller.startBridge({ characterId: h.profile.id, acceptedWarningVersion: 1 });
    await h.controller.connect(h.profile.id);

    const stopped = await h.controller.stopBridge(h.profile.id);

    expect(h.bridge.stop).toHaveBeenCalledTimes(1);
    expect(stopped.bridge).toBe('stopped');
    expect(stopped.state).toBe('offline');
  });

  it('rejects a malformed endpoint and a half credential', async () => {
    const h = await setup();

    // Input parsing happens before the promise is returned, so these throw synchronously.
    expect(() =>
      h.controller.save({
        characterId: h.profile.id,
        enabled: true,
        onebotUrl: 'ws://10.0.0.1:6700',
      }),
    ).toThrow();
    expect(() =>
      h.controller.save({ characterId: h.profile.id, enabled: true, account: ACCOUNT } as never),
    ).toThrow();
    // Credentials require an explicit acceptance of the current warning.
    expect(() =>
      h.controller.save({
        characterId: h.profile.id,
        enabled: true,
        account: ACCOUNT,
        password: PASSWORD,
      } as never),
    ).toThrow();
  });

  it('refuses operations aimed at a character that is no longer active', async () => {
    const h = await setup();
    await h.configure();
    h.changeProfile();

    await expect(h.controller.connect('default-character')).rejects.toThrow(
      OOPZ_PRESENCE_PUBLIC_ERROR,
    );
    await expect(
      h.controller.startBridge({ characterId: 'default-character', acceptedWarningVersion: 1 }),
    ).rejects.toThrow(OOPZ_PRESENCE_PUBLIC_ERROR);
  });

  it('forgets the stored credential on request', async () => {
    const h = await setup();
    await h.configure();

    const deleted = await h.controller.deleteSecret(h.profile.id);

    expect(h.bridge.deleteCredentials).toHaveBeenCalledTimes(1);
    expect(deleted.configuration.hasCredentials).toBe(false);
  });

  it('surfaces a bridge error state without leaking its cause', async () => {
    const h = await setup();
    await h.configure();
    h.bridge.snapshot.mockResolvedValueOnce({
      characterId: h.profile.id,
      state: 'error',
      hasCredentials: true,
      experimental: true,
      warning: 'fake warning',
      errorMessage: `login failed for ${ACCOUNT}`,
    });

    const snapshot = await h.controller.getSnapshot();

    expect(snapshot.bridge).toBe('error');
    expect(snapshot.errorMessage).toBe(OOPZ_PRESENCE_PUBLIC_ERROR);
    expect(JSON.stringify(snapshot)).not.toContain(ACCOUNT);
  });
});
