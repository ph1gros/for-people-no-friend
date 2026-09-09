import { describe, expect, it, vi } from 'vitest';

import {
  createDefaultSocialPresenceConfig,
  type SocialPresenceConfig,
} from '../src/core/social/social-account-config';
import type { SocialConversationRequest } from '../src/core/social/social-conversation-router';
import { SocialPresenceService } from '../src/main/social/social-presence-service';
import { createSocialInstallationSalt } from '../src/main/social/social-identity-hasher';
import { FakeSocialAdapter, createSocialMessage } from './helpers/fake-social-adapter';

const CHARACTER_NAMESPACE = 'character-abc123';

const enabledConfig = (overrides: Partial<SocialPresenceConfig> = {}): SocialPresenceConfig => {
  const base = createDefaultSocialPresenceConfig('character-1');
  return {
    ...base,
    accounts: base.accounts.map((account) =>
      account.platform === 'qq'
        ? { ...account, enabled: true, ownerUserIds: ['owner-account'] }
        : account,
    ),
    ...overrides,
  };
};

const createService = (config = enabledConfig()) => {
  const requests: SocialConversationRequest[] = [];
  const service = new SocialPresenceService({
    identitySalt: createSocialInstallationSalt(),
    getCharacterNamespace: () => CHARACTER_NAMESPACE,
    config,
    port: {
      respond: async (request) => {
        requests.push(request);
        return { text: 'reply text' };
      },
    },
  });
  return { service, requests };
};

describe('social presence service', () => {
  it('revokes token-enrolled owner memory access when configuration is replaced', async () => {
    const { service, requests } = createService();
    const adapter = new FakeSocialAdapter('qq');
    service.registerAdapter(adapter);
    const message = createSocialMessage({ userId: 'token-owner' });
    const token = service.directory.resolve(message).actorId.slice('qq-'.length);
    service.directory.bindToken('qq', token, 'owner');
    await service.connect('qq');
    try {
      adapter.emit(message);
      await vi.waitFor(() => expect(adapter.sentText).toHaveLength(1));
      expect(requests[0]?.memoryNamespace).toBe(CHARACTER_NAMESPACE);
      service.applyConfig(enabledConfig());
      expect(service.directory.resolve(message).actorClass).toBe('guest');
      adapter.emit(createSocialMessage({ userId: 'token-owner' }));
      await vi.waitFor(() => expect(adapter.sentText).toHaveLength(2));
      expect(requests[1]?.memoryNamespace).not.toBe(CHARACTER_NAMESPACE);
      expect(requests[1]?.memoryScope).not.toBe('private');
    } finally {
      await service.dispose();
    }
  });
  it('cancels old turns before applying changed owner bindings', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests: SocialConversationRequest[] = [];
    const config = enabledConfig();
    const service = new SocialPresenceService({
      identitySalt: createSocialInstallationSalt(),
      getCharacterNamespace: () => CHARACTER_NAMESPACE,
      config,
      port: {
        respond: async (request) => {
          requests.push(request);
          if (requests.length === 1) await gate;
          return { text: request.actor.actorClass };
        },
      },
    });
    const adapter = new FakeSocialAdapter('qq');
    service.registerAdapter(adapter);
    try {
      await service.connect('qq');
      adapter.emit(createSocialMessage({ userId: 'owner-account' }));
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      service.applyConfig({
        ...config,
        accounts: config.accounts.map((account) => ({ ...account, ownerUserIds: [] })),
      });
      expect(requests[0]!.signal.aborted).toBe(true);
      release();
      adapter.emit(createSocialMessage({ userId: 'owner-account' }));
      await vi.waitFor(() => expect(adapter.sentText).toHaveLength(1));
      expect(adapter.sentText[0]!.text).toBe('guest');
      expect(requests[1]!.memoryNamespace).not.toBe(CHARACTER_NAMESPACE);
    } finally {
      release();
      await service.dispose();
    }
  });
  it('starts with no adapter registered and nothing online', () => {
    const { service } = createService();

    expect(service.presence()).toEqual([]);
    expect(service.isStarted()).toBe(false);
  });

  it('derives owner bindings from the stored account configuration', () => {
    const { service } = createService();

    expect(service.directory.snapshot()).toEqual([
      { platform: 'qq', userId: 'owner-account', actorClass: 'owner' },
    ]);
  });

  it('refuses to connect a platform the user has not enabled', async () => {
    const { service } = createService();
    service.registerAdapter(new FakeSocialAdapter('kook'));

    await expect(service.connect('kook')).rejects.toThrow(
      'Social presence for "kook" is not enabled.',
    );
    expect(service.isStarted()).toBe(false);
  });

  it('connects an enabled platform and routes a message end to end', async () => {
    const { service, requests } = createService();
    const adapter = new FakeSocialAdapter('qq');
    service.registerAdapter(adapter);

    const entry = await service.connect('qq');
    expect(entry.state).toBe('online');
    expect(service.isStarted()).toBe(true);

    adapter.emit(createSocialMessage({ userId: 'owner-account', text: 'hello' }));
    await vi.waitFor(() => expect(adapter.sentText).toHaveLength(1));

    expect(requests[0]?.actor.actorClass).toBe('owner');
    expect(requests[0]?.memoryNamespace).toBe(CHARACTER_NAMESPACE);
    expect(adapter.sentText[0]?.text).toBe('reply text');
  });

  it('ignores the account the character itself posts under', async () => {
    const { service, requests } = createService();
    const adapter = new FakeSocialAdapter('qq');
    service.registerAdapter(adapter);
    service.setSelfUserId('qq', 'bot-account');
    await service.connect('qq');

    adapter.emit(createSocialMessage({ userId: 'bot-account' }));
    adapter.emit(createSocialMessage({ userId: 'owner-account' }));
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    expect(requests[0]?.actor.actorClass).toBe('owner');
  });

  it('applies the reply policy stored for that platform', async () => {
    const config = enabledConfig();
    const restricted: SocialPresenceConfig = {
      ...config,
      accounts: config.accounts.map((account) =>
        account.platform === 'qq'
          ? {
              ...account,
              replyPolicy: { ...account.replyPolicy, respondInDirectMessages: false },
            }
          : account,
      ),
    };
    const { service, requests } = createService(restricted);
    const adapter = new FakeSocialAdapter('qq');
    service.registerAdapter(adapter);
    await service.connect('qq');

    adapter.emit(createSocialMessage({ userId: 'owner-account' }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(requests).toHaveLength(0);
  });

  it('re-derives bindings when the configuration is replaced', () => {
    const { service } = createService();

    service.applyConfig({
      ...enabledConfig(),
      accounts: createDefaultSocialPresenceConfig('character-1').accounts,
      bindings: [{ platform: 'kook', userId: 'friend', actorClass: 'known-user', label: 'Ann' }],
    });

    expect(service.directory.snapshot()).toEqual([
      { platform: 'kook', userId: 'friend', actorClass: 'known-user', label: 'Ann' },
    ]);
  });

  it('rejects a malformed configuration instead of storing it', () => {
    const { service } = createService();

    expect(() =>
      service.applyConfig({ version: 2, characterId: 'x', accounts: [], bindings: [] } as never),
    ).toThrow();
    expect(service.snapshotConfig().version).toBe(1);
  });

  it('tears everything down on dispose', async () => {
    const { service } = createService();
    const adapter = new FakeSocialAdapter('qq');
    service.registerAdapter(adapter);
    await service.connect('qq');

    await service.dispose();

    expect(service.presence()).toEqual([]);
    expect(service.isStarted()).toBe(false);
    expect(adapter.disconnectCalls).toBe(1);
    expect(adapter.handlerCount).toBe(0);
  });
});
