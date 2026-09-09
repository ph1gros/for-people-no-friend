import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QqAdapter } from '../src/adapters/social/qq/qq-adapter';
import type { QqTransport } from '../src/adapters/social/qq/qq-transport';
import { DEFAULT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import type { ChatEvent, ChatRequest } from '../src/core/llm/contracts';
import type { ModelRuntime } from '../src/main/llm/model-runtime';
import { QqPresenceController } from '../src/main/social/qq-presence-controller';
import { SocialConfigStore } from '../src/main/social/social-config-store';
import {
  createSocialConversationPort,
  type RuntimeSocialConversationPort,
} from '../src/main/social/social-conversation-port';
import { CharacterProfileStore } from '../src/main/storage/character-profile-store';
import { ConversationStore } from '../src/main/storage/conversation-store';
import { DeskpetDatabase } from '../src/main/storage/deskpet-database';

const fixtures: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

const setup = async (
  stream?: (request: ChatRequest, signal: AbortSignal) => AsyncIterable<ChatEvent>,
) => {
  const directory = await mkdtemp(path.join(process.cwd(), '.qq-controller-test-'));
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
    streamConversation: async function* (
      request: ChatRequest,
      _selection: unknown,
      signal: AbortSignal,
    ): AsyncIterable<ChatEvent> {
      requests.push(request);
      if (stream) {
        yield* stream(request, signal);
        return;
      }
      yield { type: 'text-delta', text: '{"text":"同一角色的回复","emotion":"neutral"}' };
      yield { type: 'finish', reason: 'stop' };
    },
  } as unknown as ModelRuntime;
  const ports: RuntimeSocialConversationPort[] = [];
  let handlers: Parameters<QqTransport['start']>[1];
  const transport: QqTransport = {
    start: vi.fn(async (_signal, callbacks) => {
      handlers = callbacks;
      callbacks.ready('bot-id');
      callbacks.state('online');
    }),
    sendText: vi.fn(async () => ({ id: 'reply-id' })),
    sendVoice: vi.fn(async () => ({ id: 'voice-id' })),
    stop: vi.fn(),
  };
  const factory = vi.fn(
    (options: ConstructorParameters<typeof QqAdapter>[0]) =>
      new QqAdapter({ ...options, createTransport: async () => transport }),
  );
  const controller = new QqPresenceController({
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
    history,
    requests,
    transport,
    factory,
    profile,
    configure: () =>
      controller.save({
        characterId: profile.id,
        appId: '123456',
        enabled: true,
        appSecret: 'test-only-secret',
        ownerUserIds: ['owner-openid'],
      }),
    emit: (id: string, sender = 'owner-openid', group?: string) =>
      handlers.message({
        kind: group ? 'group' : 'c2c',
        rawEventType: group ? 'GROUP_AT_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
        senderId: sender,
        messageId: id,
        content: '你好',
        ...(group ? { groupOpenid: group } : {}),
      }),
    state: (state: 'connecting' | 'online' | 'error' | 'offline') => handlers.state(state),
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

describe('QQ main-process composition', () => {
  it('is inert at startup, rejects unconfigured connections, and only connects explicitly', async () => {
    const h = await setup();
    expect(h.factory).not.toHaveBeenCalled();
    expect((await h.controller.getSnapshot()).state).toBe('not-configured');
    await expect(h.controller.connect(h.profile.id)).rejects.toThrow();
    await h.configure();
    expect(h.factory).not.toHaveBeenCalled();
    expect((await h.controller.connect(h.profile.id)).state).toBe('online');
    expect(h.factory).toHaveBeenCalledTimes(1);
    await h.controller.connect(h.profile.id);
    expect(h.factory).toHaveBeenCalledTimes(1);
    expect(h.factory.mock.calls[0]![0].voiceEnabled).toBe(false);
  });

  it('runs QQ -> router -> real conversation runtime -> SQLite -> QQ with owner and group isolation', async () => {
    const h = await setup();
    await h.configure();
    await h.history.append(
      {
        id: 'desktop-private',
        role: 'user',
        content: 'OWNER_PRIVATE_SENTINEL',
        status: 'complete',
        createdAt: 1,
      },
      h.profile.memoryNamespace,
    );
    await h.controller.connect(h.profile.id);
    h.emit('owner-message');
    await vi.waitFor(() => expect(h.transport.sendText).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(h.requests[0])).toContain('OWNER_PRIVATE_SENTINEL');
    h.emit('guest-message', 'guest-openid');
    await vi.waitFor(() => expect(h.transport.sendText).toHaveBeenCalledTimes(2));
    expect(JSON.stringify(h.requests[1])).not.toContain('OWNER_PRIVATE_SENTINEL');
    h.emit('group-message', 'owner-openid', 'group-openid');
    await vi.waitFor(() => expect(h.transport.sendText).toHaveBeenCalledTimes(3));
    expect(JSON.stringify(h.requests[2])).not.toContain('OWNER_PRIVATE_SENTINEL');
    expect(JSON.stringify(h.requests)).not.toContain('owner-openid');
    expect(JSON.stringify(h.requests)).not.toContain('guest-openid');
    expect(h.transport.sendText).toHaveBeenNthCalledWith(
      3,
      { kind: 'group', id: 'group-openid', messageId: 'group-message' },
      '同一角色的回复',
      expect.any(AbortSignal),
    );
    expect(await h.history.list(100, h.profile.memoryNamespace)).toHaveLength(3);
  });

  it('cancels a running reply on disconnect and requires explicit reconnection', async () => {
    let signal: AbortSignal | undefined;
    const h = await setup(async function* (_request, current) {
      signal = current;
      await new Promise<void>((resolve) =>
        current.addEventListener('abort', () => resolve(), { once: true }),
      );
      current.throwIfAborted();
      yield { type: 'text-delta', text: 'late' };
    });
    await h.configure();
    await h.controller.connect(h.profile.id);
    h.emit('slow');
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect((await h.controller.disconnect(h.profile.id)).state).toBe('offline');
    expect(signal!.aborted).toBe(true);
    expect(h.transport.stop).toHaveBeenCalled();
    expect(h.transport.sendText).not.toHaveBeenCalled();
  });

  it('publishes reconnect status and stops accepting messages while disconnected', async () => {
    const h = await setup();
    await h.configure();
    await h.controller.connect(h.profile.id);
    h.state('connecting');
    expect((await h.controller.getSnapshot()).state).toBe('connecting');
    h.emit('offline-message');
    expect(h.requests).toHaveLength(0);
    h.state('online');
    h.emit('reconnected');
    await vi.waitFor(() => expect(h.transport.sendText).toHaveBeenCalledTimes(1));
  });

  it('stops before configuration or secret changes and never persists enrollment as raw IDs', async () => {
    const h = await setup();
    await h.configure();
    await h.controller.connect(h.profile.id);
    const saved = await h.controller.save({
      characterId: h.profile.id,
      appId: '123456',
      enabled: false,
    });
    expect(saved.state).toBe('offline');
    expect(h.transport.stop).toHaveBeenCalled();
    expect(await h.store.getOwnerTokens(h.profile.id)).toEqual([
      expect.stringMatching(/^[a-f0-9]{24}$/),
    ]);
    expect((await h.controller.deleteSecret(h.profile.id)).configuration.hasSecret).toBe(false);
    await expect(h.controller.connect(h.profile.id)).rejects.toThrow();
  });

  it('rejects stale-character operations and disconnects an old session when the active character changes', async () => {
    const h = await setup();
    await h.configure();
    await h.controller.connect(h.profile.id);
    h.changeProfile();
    const status = await h.controller.getSnapshot();
    expect(status.configuration.characterId).toBe('another-character');
    expect(h.transport.stop).toHaveBeenCalled();
    await expect(h.controller.connect(h.profile.id)).rejects.toThrow();
    await expect(
      h.controller.save({ characterId: h.profile.id, appId: '123456', enabled: true }),
    ).rejects.toThrow();
  });

  it('disconnect preempts a pending connection without resurrecting it', async () => {
    const h = await setup();
    await h.configure();
    vi.mocked(h.transport.start).mockImplementation(async (signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      signal.throwIfAborted();
    });
    const pending = h.controller.connect(h.profile.id);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(h.transport.start).toHaveBeenCalled());
    await h.controller.disconnect(h.profile.id);
    await rejected;
    expect((await h.controller.getSnapshot()).state).toBe('offline');
  });
});
