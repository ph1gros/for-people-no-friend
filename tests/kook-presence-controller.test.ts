import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { KookAdapter } from '../src/adapters/social/kook/kook-adapter';
import type { KookTransport } from '../src/adapters/social/kook/kook-transport';
import { DEFAULT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import type { ChatEvent, ChatRequest } from '../src/core/llm/contracts';
import type { ModelRuntime } from '../src/main/llm/model-runtime';
import { KookPresenceController } from '../src/main/social/kook-presence-controller';
import { SocialConfigStore } from '../src/main/social/social-config-store';
import {
  createSocialConversationPort,
  type RuntimeSocialConversationPort,
} from '../src/main/social/social-conversation-port';
import { CharacterProfileStore } from '../src/main/storage/character-profile-store';
import { ConversationStore } from '../src/main/storage/conversation-store';
import { DeskpetDatabase } from '../src/main/storage/deskpet-database';
import { KOOK_PRESENCE_PUBLIC_ERROR } from '../src/shared/social-ipc';

const TOKEN = 'fake-kook-bot-token-value';

const fixtures: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

const setup = async () => {
  const directory = await mkdtemp(path.join(process.cwd(), '.kook-controller-test-'));
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
  const requests: ChatRequest[] = [];
  const models = {
    getConversationConfiguration: async () => ({
      selection: { providerId: 'openai-compatible', modelId: 'fake' },
    }),
    streamConversation: async function* (request: ChatRequest): AsyncIterable<ChatEvent> {
      requests.push(request);
      yield { type: 'text-delta', text: '{"text":"同一角色的回复","emotion":"neutral"}' };
      yield { type: 'finish', reason: 'stop' };
    },
  } as unknown as ModelRuntime;
  const ports: RuntimeSocialConversationPort[] = [];
  let handlers: Parameters<KookTransport['start']>[1];
  const transport: KookTransport = {
    joinVoice: vi.fn(async (channelId) => ({
      channelId,
      transport: { ip: '203.0.113.1', port: 4000, rtcpMux: true },
      play: vi.fn(async () => undefined),
      leave: vi.fn(async () => undefined),
    })),
    start: vi.fn(async (_signal, callbacks) => {
      handlers = callbacks;
      callbacks.ready('kook-bot-id');
      callbacks.state('online');
    }),
    sendText: vi.fn(async () => ({ id: 'reply-id' })),
    stop: vi.fn(),
  };
  const factory = vi.fn(
    (options: ConstructorParameters<typeof KookAdapter>[0]) =>
      new KookAdapter({ ...options, createTransport: () => transport }),
  );
  const controller = new KookPresenceController({
    speech: {
      synthesize: vi.fn(async () => ({
        ok: true as const,
        mimeType: 'audio/wav',
        audio: new Uint8Array([1, 2]),
        requestId: 'fake',
      })),
      cancel: vi.fn(),
    },
    store,
    getProfile: async () => profile,
    getWindow: () => undefined,
    createAdapter: factory,
    createPort: (bound) => {
      const port = createSocialConversationPort({ profile: bound, models, profiles, history });
      ports.push(port);
      return port;
    },
  });
  const fixture = {
    controller,
    store,
    requests,
    transport,
    factory,
    profile,
    configure: () =>
      controller.save({
        characterId: profile.id,
        enabled: true,
        botToken: TOKEN,
        ownerUserIds: ['kook-owner-1'],
      }),
    emit: (id: string, sender = 'kook-owner-1') =>
      handlers.message({
        channel_type: 'PERSON',
        type: 1,
        target_id: sender,
        author_id: sender,
        content: '你好',
        msg_id: id,
        extra: { author: { id: sender } },
      }),
    changeProfile: () => {
      profile = { ...profile, id: 'another-character', memoryNamespace: 'another-character' };
    },
    close: async () => {
      controller.dispose();
      await Promise.all(ports.map((port) => port.drain()));
      database.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
  fixtures.push(fixture);
  return fixture;
};

describe('KOOK main-process composition', () => {
  it('does not revive a voice join completed after a character switch', async () => {
    const h = await setup();
    await h.configure();
    await h.controller.connect(h.profile.id);
    const handle = {
      channelId: '12345',
      transport: { ip: '203.0.113.1', port: 4000, rtcpMux: true },
      play: vi.fn(async () => undefined),
      leave: vi.fn(async () => undefined),
    };
    let complete!: (value: typeof handle) => void;
    vi.mocked(h.transport.joinVoice).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = h.controller.controlVoice({
      characterId: h.profile.id,
      action: 'join',
      channelId: '12345',
    });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(h.transport.joinVoice).toHaveBeenCalled());
    h.controller.stop();
    h.changeProfile();
    complete(handle);
    await rejected;
    expect(handle.leave).toHaveBeenCalledOnce();
    expect(handle.play).not.toHaveBeenCalled();
  });
  it('joins only explicitly, synthesizes public text, plays, and leaves without disconnecting text', async () => {
    const h = await setup();
    await h.configure();
    await h.controller.connect(h.profile.id);
    expect(h.transport.joinVoice).not.toHaveBeenCalled();
    await h.controller.controlVoice({
      characterId: h.profile.id,
      action: 'join',
      channelId: '12345',
    });
    const handle = await vi.mocked(h.transport.joinVoice).mock.results[0]!.value;
    await h.controller.controlVoice({
      characterId: h.profile.id,
      action: 'speak',
      text: '公开测试',
    });
    expect(handle.play).toHaveBeenCalledOnce();
    await h.controller.controlVoice({ characterId: h.profile.id, action: 'leave' });
    expect(handle.leave).toHaveBeenCalledOnce();
    expect((await h.controller.getSnapshot()).state).toBe('online');
    await expect(
      h.controller.controlVoice({
        characterId: 'another-character',
        action: 'join',
        channelId: '12345',
      }),
    ).rejects.toThrow();
  });
  it('starts unconfigured and refuses to connect', async () => {
    const h = await setup();

    expect(await h.controller.getSnapshot()).toEqual({
      configuration: {
        characterId: h.profile.id,
        enabled: false,
        ownerBindingCount: 0,
        hasToken: false,
      },
      state: 'not-configured',
    });
    await expect(h.controller.connect(h.profile.id)).rejects.toThrow(KOOK_PRESENCE_PUBLIC_ERROR);
    expect(h.factory).not.toHaveBeenCalled();
  });

  it('reports offline once a token is stored but no connection was made', async () => {
    const h = await setup();
    const saved = await h.configure();

    expect(saved).toEqual({
      configuration: {
        characterId: h.profile.id,
        enabled: true,
        ownerBindingCount: 1,
        hasToken: true,
      },
      state: 'offline',
    });
    // Saving must never open a connection on its own.
    expect(h.transport.start).not.toHaveBeenCalled();
  });

  it('connects on explicit request and answers as the same character', async () => {
    const h = await setup();
    await h.configure();

    const connected = await h.controller.connect(h.profile.id);
    expect(connected.state).toBe('online');
    expect(h.factory).toHaveBeenCalledTimes(1);

    h.emit('msg-1');
    await vi.waitFor(() => expect(h.transport.sendText).toHaveBeenCalledTimes(1));
    expect(h.requests).toHaveLength(1);
  });

  it('refuses to connect while disabled even with a stored token', async () => {
    const h = await setup();
    await h.configure();
    await h.controller.save({ characterId: h.profile.id, enabled: false });

    await expect(h.controller.connect(h.profile.id)).rejects.toThrow(KOOK_PRESENCE_PUBLIC_ERROR);
    expect(h.factory).not.toHaveBeenCalled();
  });

  it('drops the session when the active character changes', async () => {
    const h = await setup();
    await h.configure();
    await h.controller.connect(h.profile.id);

    h.changeProfile();
    const snapshot = await h.controller.getSnapshot();

    expect(snapshot.state).toBe('not-configured');
    expect(h.transport.stop).toHaveBeenCalled();
  });

  it('refuses operations aimed at a character that is no longer active', async () => {
    const h = await setup();
    await h.configure();
    h.changeProfile();

    await expect(h.controller.connect('default-character')).rejects.toThrow(
      KOOK_PRESENCE_PUBLIC_ERROR,
    );
    await expect(h.controller.disconnect('default-character')).rejects.toThrow(
      KOOK_PRESENCE_PUBLIC_ERROR,
    );
  });

  it('disconnects and forgets the stored token on request', async () => {
    const h = await setup();
    await h.configure();
    await h.controller.connect(h.profile.id);

    const disconnected = await h.controller.disconnect(h.profile.id);
    expect(disconnected.state).toBe('offline');
    expect(h.transport.stop).toHaveBeenCalled();

    const deleted = await h.controller.deleteSecret(h.profile.id);
    expect(deleted.configuration.hasToken).toBe(false);
    expect(deleted.state).toBe('not-configured');
  });

  it('degrades a failed connection to an error state without leaking the cause', async () => {
    const h = await setup();
    await h.configure();
    vi.mocked(h.transport.start).mockRejectedValueOnce(
      new Error(`Bot ${TOKEN} rejected by upstream`),
    );

    // A failed connection reports itself; it must not take the IPC call down with it.
    const snapshot = await h.controller.connect(h.profile.id);

    expect(snapshot.state).toBe('error');
    expect(snapshot.errorMessage).toBe(KOOK_PRESENCE_PUBLIC_ERROR);
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN);
    expect(JSON.stringify(snapshot)).not.toContain('rejected by upstream');
  });

  it('is idempotent when already connected', async () => {
    const h = await setup();
    await h.configure();
    await h.controller.connect(h.profile.id);

    const again = await h.controller.connect(h.profile.id);

    expect(again.state).toBe('online');
    expect(h.factory).toHaveBeenCalledTimes(1);
  });
});
