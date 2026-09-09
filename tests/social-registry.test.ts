import { describe, expect, it, vi } from 'vitest';

import { SocialAdapterRegistry } from '../src/core/social/social-registry';
import { FakeSocialAdapter, createSocialMessage } from './helpers/fake-social-adapter';

const clock = () => {
  let value = 1_700_000_000_000;
  return () => (value += 1_000);
};

const LONG_TOKEN = 'A'.repeat(44);

describe('social adapter registry', () => {
  it.each([false, true])('ignores superseded disconnect completion (reject=%s)', async (reject) => {
    const diagnostics = vi.fn();
    const registry = new SocialAdapterRegistry(clock(), diagnostics);
    const adapter = new FakeSocialAdapter('qq');
    registry.register(adapter);
    await registry.connect('qq');
    let finishDisconnect!: () => void;
    vi.spyOn(adapter, 'disconnect').mockImplementation(
      () =>
        new Promise((resolve, fail) => {
          finishDisconnect = () => (reject ? fail(new Error('old disconnect')) : resolve());
        }),
    );
    let finishConnect!: () => void;
    vi.spyOn(adapter, 'connect').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishConnect = resolve;
        }),
    );
    const disconnecting = registry.disconnect('qq');
    const connecting = registry.connect('qq');
    finishDisconnect();
    await expect(disconnecting).resolves.toMatchObject({ state: 'connecting' });
    expect(registry.presence()[0]?.state).toBe('connecting');
    expect(diagnostics).not.toHaveBeenCalled();
    finishConnect();
    await expect(connecting).resolves.toMatchObject({ state: 'online' });
  });
  it('registers a platform once and rejects a duplicate', () => {
    const registry = new SocialAdapterRegistry(clock());
    registry.register(new FakeSocialAdapter('qq'));

    expect(registry.platforms()).toEqual(['qq']);
    expect(() => registry.register(new FakeSocialAdapter('qq'))).toThrow(
      'A social adapter for "qq" is already registered.',
    );
  });

  it('reports presence per platform with the declared capabilities', async () => {
    const registry = new SocialAdapterRegistry(clock());
    registry.register(new FakeSocialAdapter('qq', { capabilities: { audioMessage: true } }));
    registry.register(new FakeSocialAdapter('kook', { capabilities: { voiceChannel: true } }));

    expect(registry.presence().map(({ platform, state }) => ({ platform, state }))).toEqual([
      { platform: 'qq', state: 'offline' },
      { platform: 'kook', state: 'offline' },
    ]);

    await registry.connectAll();
    const presence = registry.presence();
    expect(presence.every(({ state }) => state === 'online')).toBe(true);
    expect(presence[0]?.capabilities).toEqual({
      text: true,
      audioMessage: true,
      voiceChannel: false,
      streamingText: false,
    });
  });

  it('degrades a failing connection into an error entry instead of throwing', async () => {
    const diagnostics = vi.fn();
    const registry = new SocialAdapterRegistry(clock(), diagnostics);
    registry.register(
      new FakeSocialAdapter('qq', { connectError: new Error(`token ${LONG_TOKEN} rejected`) }),
    );

    const entry = await registry.connect('qq');

    expect(entry.state).toBe('error');
    expect(entry.errorMessage).toContain('[redacted]');
    expect(entry.errorMessage).not.toContain(LONG_TOKEN);
    expect(diagnostics).toHaveBeenCalledWith('social-adapter-connect-failed', 'qq');
  });

  it('fans inbound messages out to subscribers and survives a failing subscriber', () => {
    const diagnostics = vi.fn();
    const registry = new SocialAdapterRegistry(clock(), diagnostics);
    const adapter = new FakeSocialAdapter('qq');
    registry.register(adapter);

    const healthy = vi.fn();
    registry.onMessage(() => {
      throw new Error('subscriber exploded');
    });
    const unsubscribe = registry.onMessage(healthy);

    const message = createSocialMessage();
    adapter.emit(message);
    expect(healthy).toHaveBeenCalledWith(message);
    expect(diagnostics).toHaveBeenCalledWith('social-handler-failed', 'qq');

    unsubscribe();
    adapter.emit(createSocialMessage());
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it('disconnects and detaches on unregister', async () => {
    const registry = new SocialAdapterRegistry(clock());
    const adapter = new FakeSocialAdapter('kook');
    registry.register(adapter);
    await registry.connect('kook');

    expect(adapter.handlerCount).toBe(1);
    expect(await registry.unregister('kook')).toBe(true);
    expect(adapter.disconnectCalls).toBe(1);
    expect(adapter.handlerCount).toBe(0);
    expect(registry.platforms()).toEqual([]);
    expect(await registry.unregister('kook')).toBe(false);
  });

  it('refuses to connect an unregistered platform', async () => {
    const registry = new SocialAdapterRegistry(clock());
    await expect(registry.connect('oopz')).rejects.toThrow(
      'No social adapter is registered for "oopz".',
    );
    expect(await registry.disconnect('oopz')).toBeUndefined();
  });
});
