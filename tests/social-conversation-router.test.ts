import { describe, expect, it, vi } from 'vitest';

import {
  SocialConversationRouter,
  type SocialConversationPort,
  type SocialConversationRequest,
  type SocialRouterDiagnostic,
} from '../src/core/social/social-conversation-router';
import { SocialActorDirectory } from '../src/core/social/social-identity';
import { resolveSocialChannelToken } from '../src/core/social/social-memory-scope';
import { SocialAdapterRegistry } from '../src/core/social/social-registry';
import { FakeSocialAdapter, createSocialMessage, fakeHashId } from './helpers/fake-social-adapter';

const CHARACTER_NAMESPACE = 'character-abc123';
const LONG_TOKEN = 'B'.repeat(44);

interface Harness {
  registry: SocialAdapterRegistry;
  adapter: FakeSocialAdapter;
  router: SocialConversationRouter;
  requests: SocialConversationRequest[];
  diagnostics: SocialRouterDiagnostic[];
}

const createHarness = (
  respond: SocialConversationPort['respond'] = async () => ({ text: 'reply text' }),
  overrides: Partial<ConstructorParameters<typeof SocialConversationRouter>[0]> = {},
  adapterOptions: ConstructorParameters<typeof FakeSocialAdapter>[1] = {},
): Harness => {
  const requests: SocialConversationRequest[] = [];
  const diagnostics: SocialRouterDiagnostic[] = [];
  const registry = new SocialAdapterRegistry(() => 1_700_000_000_000);
  const adapter = new FakeSocialAdapter('qq', adapterOptions);
  registry.register(adapter);

  const router = new SocialConversationRouter({
    registry,
    directory: new SocialActorDirectory(fakeHashId, [
      { platform: 'qq', userId: 'owner-account', actorClass: 'owner' },
    ]),
    port: {
      respond: async (request) => {
        requests.push(request);
        return respond(request);
      },
    },
    hashId: fakeHashId,
    getContext: () => ({ characterNamespace: CHARACTER_NAMESPACE }),
    diagnostics: (diagnostic) => diagnostics.push(diagnostic),
    ...overrides,
  });
  router.start();
  return { registry, adapter, router, requests, diagnostics };
};

describe('social conversation router', () => {
  it('starts cooldown even when the execution-time gate returns before creating a controller', async () => {
    vi.useFakeTimers();
    let selfUserId: string | undefined;
    const h = createHarness(undefined, {
      getContext: () => ({
        characterNamespace: CHARACTER_NAMESPACE,
        selfUserIds: { qq: selfUserId },
      }),
      turnOptions: { channelCooldownMs: 1000 },
    });
    try {
      const target = { platform: 'qq', channelKind: 'group', channelId: 'group-a' } as const;
      h.adapter.emit(createSocialMessage({ target, userId: 'late-self', mentionsCharacter: true }));
      selfUserId = 'late-self';
      await h.router.drain();
      expect(h.requests).toHaveLength(0);
      h.adapter.emit(createSocialMessage({ target, mentionsCharacter: true }));
      await vi.advanceTimersByTimeAsync(999);
      expect(h.requests).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      await h.router.drain();
      expect(h.requests).toHaveLength(1);
    } finally {
      h.router.dispose();
      vi.useRealTimers();
    }
  });
  it('prioritizes mentions and optionally owners among waiting turns in the same channel', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const h = createHarness(
      async (request) => {
        order.push(request.text!);
        if (request.text === 'first') await gate;
        return { text: request.text! };
      },
      { turnOptions: { ownerPriority: true } },
    );
    h.adapter.emit(createSocialMessage({ text: 'first' }));
    await vi.waitFor(() => expect(order).toEqual(['first']));
    h.adapter.emit(createSocialMessage({ text: 'ordinary' }));
    h.adapter.emit(createSocialMessage({ text: 'mentioned', mentionsCharacter: true }));
    h.adapter.emit(createSocialMessage({ text: 'owner', userId: 'owner-account' }));
    release();
    await h.router.drain();
    expect(order).toEqual(['first', 'owner', 'mentioned', 'ordinary']);
    h.router.dispose();
  });
  it('interrupts only the same channel and suppresses a late result from an uncancellable provider', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = createHarness(
      async (request) => {
        if (request.text === 'first') await gate;
        return { text: request.text! };
      },
      { turnOptions: { ownerInterrupt: true } },
    );
    h.adapter.emit(createSocialMessage({ text: 'first' }));
    await vi.waitFor(() => expect(h.requests).toHaveLength(1));
    h.adapter.emit(
      createSocialMessage({
        text: 'other-channel',
        userId: 'owner-account',
        target: { platform: 'qq', channelKind: 'direct', channelId: 'other' },
      }),
    );
    await vi.waitFor(() => expect(h.adapter.sentText).toHaveLength(1));
    expect(h.requests[0]!.signal.aborted).toBe(false);
    h.adapter.emit(createSocialMessage({ text: 'interrupt', userId: 'owner-account' }));
    await h.router.drain();
    expect(h.requests[0]!.signal.aborted).toBe(true);
    expect(h.adapter.sentText.map((entry) => entry.text)).toEqual(['other-channel', 'interrupt']);
    release();
    await Promise.resolve();
    expect(h.adapter.sentText).toHaveLength(2);
    h.router.dispose();
  });
  it('drops spam before invoking the model and never grants owners unlimited quota', async () => {
    const h = createHarness(undefined, { turnOptions: { maxActorTurns: 2 } });
    for (let i = 0; i < 10; i++) h.adapter.emit(createSocialMessage({ userId: 'owner-account' }));
    await h.router.drain();
    expect(h.requests).toHaveLength(2);
    expect(
      h.diagnostics.filter((d) => d.event === 'turn-decision' && d.reason === 'actor-rate-limit'),
    ).toHaveLength(8);
    h.router.dispose();
  });
  it('expires queued turns rather than replying after a long backlog', async () => {
    let now = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = createHarness(
      async () => {
        await gate;
        return { text: 'reply' };
      },
      { now: () => now, turnOptions: { maxWaitMs: 100 } },
    );
    h.adapter.emit(createSocialMessage());
    await vi.waitFor(() => expect(h.requests).toHaveLength(1));
    h.adapter.emit(createSocialMessage());
    now = 101;
    release();
    await h.router.drain();
    expect(h.requests).toHaveLength(1);
    expect(h.diagnostics).toContainEqual({
      event: 'turn-decision',
      platform: 'qq',
      action: 'ignore',
      reason: 'stale-turn',
    });
    h.router.dispose();
  });
  it('applies completion cooldown in group channels and cancels the wait on stop', async () => {
    const h = createHarness(undefined, { turnOptions: { channelCooldownMs: 1000 } });
    const target = { platform: 'qq', channelKind: 'group', channelId: 'group-a' } as const;
    h.adapter.emit(createSocialMessage({ target, mentionsCharacter: true }));
    await h.router.drain();
    h.adapter.emit(createSocialMessage({ target, mentionsCharacter: true }));
    await Promise.resolve();
    expect(h.requests).toHaveLength(1);
    h.router.stop();
    await h.router.drain();
    expect(h.requests).toHaveLength(1);
    h.router.dispose();
  });
  it('actually resumes after cooldown instead of permanently dropping the next group turn', async () => {
    const calls: number[] = [];
    const h = createHarness(
      async () => {
        calls.push(performance.now());
        return { text: 'reply' };
      },
      { turnOptions: { channelCooldownMs: 30 } },
    );
    const target = { platform: 'qq', channelKind: 'group', channelId: 'group-a' } as const;
    h.adapter.emit(createSocialMessage({ target, mentionsCharacter: true }));
    await h.router.drain();
    h.adapter.emit(createSocialMessage({ target, mentionsCharacter: true }));
    await h.router.drain();
    expect(calls).toHaveLength(2);
    expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(25);
    h.router.dispose();
  });
  it('routes a direct message through identity, memory scope and back to the platform', async () => {
    const harness = createHarness();
    const message = createSocialMessage({ userId: 'owner-account', text: 'hello there' });

    harness.adapter.emit(message);
    await harness.router.drain();

    expect(harness.requests).toHaveLength(1);
    const request = harness.requests[0];
    expect(request?.actor.actorClass).toBe('owner');
    expect(request?.text).toBe('hello there');
    expect(request?.memoryScope).toBe('private');
    expect(request?.memoryNamespace).toBe(CHARACTER_NAMESPACE);
    expect(request?.memoryAudience).toEqual({
      actorId: request?.actor.actorId,
      actorClass: 'owner',
      platform: 'qq',
      channelKind: 'direct',
      channelToken: resolveSocialChannelToken(fakeHashId, message.target),
    });
    expect(harness.adapter.sentText).toEqual([{ target: message.target, text: 'reply text' }]);
  });

  it('isolates an unbound account into its own memory namespace', async () => {
    const harness = createHarness();

    harness.adapter.emit(createSocialMessage({ userId: 'stranger' }));
    await harness.router.drain();

    const request = harness.requests[0];
    expect(request?.actor.actorClass).toBe('guest');
    expect(request?.memoryScope).toBe('personal');
    expect(request?.memoryNamespace).toBe(`${CHARACTER_NAMESPACE}/actor/${request?.actor.actorId}`);
  });

  it('never reaches the conversation core for an unaddressed group message', async () => {
    const harness = createHarness();

    harness.adapter.emit(
      createSocialMessage({ target: { platform: 'qq', channelKind: 'group', channelId: 'g1' } }),
    );
    await harness.router.drain();

    expect(harness.requests).toHaveLength(0);
    expect(harness.adapter.sentText).toHaveLength(0);
    expect(harness.diagnostics).toEqual([
      { event: 'turn-decision', platform: 'qq', action: 'listen', reason: 'unaddressed' },
    ]);
  });

  it('drops a redelivered message without answering twice', async () => {
    const harness = createHarness();
    const message = createSocialMessage();

    harness.adapter.emit(message);
    harness.adapter.emit(message);
    await harness.router.drain();

    expect(harness.requests).toHaveLength(1);
    expect(harness.diagnostics).toEqual([{ event: 'message-duplicate', platform: 'qq' }]);
  });

  it('processes one target serially and keeps the reply order', async () => {
    const active: number[] = [];
    let maximumOverlap = 0;
    const harness = createHarness(async (request) => {
      active.push(1);
      maximumOverlap = Math.max(maximumOverlap, active.length);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active.pop();
      return { text: `echo ${request.text}` };
    });

    harness.adapter.emit(createSocialMessage({ text: 'first' }));
    harness.adapter.emit(createSocialMessage({ text: 'second' }));
    await harness.router.drain();

    expect(maximumOverlap).toBe(1);
    expect(harness.adapter.sentText.map(({ text }) => text)).toEqual(['echo first', 'echo second']);
  });

  it('keeps text chat alive when the conversation core fails', async () => {
    const harness = createHarness(async () => {
      throw new Error(`upstream rejected key ${LONG_TOKEN}`);
    });

    harness.adapter.emit(createSocialMessage());
    await harness.router.drain();

    expect(harness.adapter.sentText).toHaveLength(0);
    expect(harness.diagnostics).toHaveLength(1);
    const diagnostic = harness.diagnostics[0];
    expect(diagnostic?.event).toBe('conversation-failed');
    expect(diagnostic).toMatchObject({ platform: 'qq' });
    expect(JSON.stringify(diagnostic)).not.toContain(LONG_TOKEN);
  });

  it('reports a redacted send failure without crashing', async () => {
    const harness = createHarness(
      undefined,
      {},
      {
        sendTextError: new Error(`Authorization: Bearer ${LONG_TOKEN}`),
      },
    );

    harness.adapter.emit(createSocialMessage());
    await harness.router.drain();

    const diagnostic = harness.diagnostics[0];
    expect(diagnostic?.event).toBe('send-failed');
    expect(JSON.stringify(diagnostic)).not.toContain(LONG_TOKEN);
  });

  it('sends nothing when the conversation core stays silent', async () => {
    const harness = createHarness(async () => undefined);

    harness.adapter.emit(createSocialMessage());
    await harness.router.drain();

    expect(harness.requests).toHaveLength(1);
    expect(harness.adapter.sentText).toHaveLength(0);
    expect(harness.diagnostics).toHaveLength(0);
  });

  it('sanitizes the outgoing reply before it reaches the platform', async () => {
    const harness = createHarness(async () => ({ text: '  spaced reply  ' }));

    harness.adapter.emit(createSocialMessage());
    await harness.router.drain();

    expect(harness.adapter.sentText[0]?.text).toBe('spaced reply');
  });

  it('aborts an in-flight conversation on stop and suppresses its reply', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    let observedAbort = false;
    const harness = createHarness(async (request) => {
      started = true;
      await gate;
      observedAbort = request.signal.aborted;
      return { text: 'late reply' };
    });

    harness.adapter.emit(createSocialMessage());
    await vi.waitFor(() => expect(started).toBe(true));
    harness.router.stop();
    release();
    await harness.router.drain();

    expect(observedAbort).toBe(true);
    expect(harness.adapter.sentText).toHaveLength(0);
  });

  it('drops work that was queued before stop instead of replying late', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createHarness(async () => {
      await gate;
      return { text: 'reply text' };
    });
    const target = { platform: 'qq', channelKind: 'direct', channelId: 'dm-1' } as const;

    harness.adapter.emit(createSocialMessage({ target }));
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1));
    harness.adapter.emit(createSocialMessage({ target }));
    harness.router.stop();
    release();
    await harness.router.drain();

    expect(harness.requests).toHaveLength(1);
    expect(harness.adapter.sentText).toHaveLength(0);
  });

  it('sheds load instead of queueing without limit', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createHarness(
      async () => {
        await gate;
        return { text: 'ok' };
      },
      { maxConcurrentConversations: 1 },
    );

    harness.adapter.emit(
      createSocialMessage({ target: { platform: 'qq', channelKind: 'direct', channelId: 'dm-1' } }),
    );
    await Promise.resolve();
    harness.adapter.emit(
      createSocialMessage({ target: { platform: 'qq', channelKind: 'direct', channelId: 'dm-2' } }),
    );

    expect(harness.diagnostics).toEqual([{ event: 'overloaded', platform: 'qq' }]);
    release();
    await harness.router.drain();
    expect(harness.requests).toHaveLength(1);
  });

  it('stops accepting messages once disposed', async () => {
    const harness = createHarness();
    harness.router.dispose();

    harness.adapter.emit(createSocialMessage());
    await harness.router.drain();

    expect(harness.requests).toHaveLength(0);
    expect(() => harness.router.start()).toThrow('The social conversation router is disposed.');
  });

  it('ignores messages the character itself produced', async () => {
    const harness = createHarness(undefined, {
      getContext: () => ({
        characterNamespace: CHARACTER_NAMESPACE,
        selfUserIds: { qq: 'bot-account' },
      }),
    });

    harness.adapter.emit(createSocialMessage({ userId: 'bot-account' }));
    await harness.router.drain();

    expect(harness.requests).toHaveLength(0);
    expect(harness.diagnostics).toEqual([
      { event: 'reply-ignored', platform: 'qq', reason: 'self-message' },
    ]);
  });
});

describe('social conversation router wiring', () => {
  it('detaches from the registry on stop and can be restarted', async () => {
    const harness = createHarness();

    harness.router.stop();
    harness.adapter.emit(createSocialMessage());
    await harness.router.drain();
    expect(harness.requests).toHaveLength(0);

    harness.router.start();
    harness.adapter.emit(createSocialMessage());
    await harness.router.drain();
    expect(harness.requests).toHaveLength(1);
  });

  it('accepts a message handed over directly by an adapter', async () => {
    const harness = createHarness();
    harness.router.stop();

    harness.router.handle(createSocialMessage());
    await harness.router.drain();

    expect(harness.requests).toHaveLength(1);
  });

  it('drops the reply when the platform adapter has gone away', async () => {
    const harness = createHarness(async () => {
      await harness.registry.unregister('qq');
      return { text: 'reply text' };
    });

    harness.adapter.emit(createSocialMessage());
    await harness.router.drain();

    expect(harness.adapter.sentText).toHaveLength(0);
  });
});

describe('social conversation router diagnostics', () => {
  it('never records raw account or channel identifiers', async () => {
    const harness = createHarness(async () => {
      throw new Error('boom');
    });

    harness.adapter.emit(createSocialMessage({ userId: 'sensitive-account' }));
    await harness.router.drain();

    const serialized = JSON.stringify(harness.diagnostics);
    expect(serialized).not.toContain('sensitive-account');
  });

  it('honours a policy override supplied by the host context', async () => {
    const harness = createHarness(undefined, {
      getContext: () => ({
        characterNamespace: CHARACTER_NAMESPACE,
        policies: {
          qq: {
            respondInDirectMessages: false,
            requireMentionInGroups: true,
            respondToUnknownActors: true,
            blockedActorIds: [],
          },
        },
      }),
    });

    harness.adapter.emit(createSocialMessage());
    await harness.router.drain();

    expect(harness.requests).toHaveLength(0);
    expect(harness.diagnostics).toEqual([
      { event: 'reply-ignored', platform: 'qq', reason: 'direct-messages-disabled' },
    ]);
  });
});

describe('social conversation router audio passthrough', () => {
  it('forwards platform audio to the conversation core untouched', async () => {
    const harness = createHarness();
    const audio = { mimeType: 'audio/silk', data: new Uint8Array([9, 8, 7]) };

    harness.adapter.emit(createSocialMessage({ text: undefined, audio }));
    await harness.router.drain();

    expect(harness.requests[0]?.audio).toBe(audio);
    expect(harness.requests[0]?.text).toBeUndefined();
  });

  it('marks the request abortable so a later milestone can interrupt speech', async () => {
    const abortSpy = vi.fn();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let listening = false;
    const harness = createHarness(async (request) => {
      request.signal.addEventListener('abort', abortSpy);
      listening = true;
      await gate;
      return undefined;
    });

    harness.adapter.emit(createSocialMessage());
    await vi.waitFor(() => expect(listening).toBe(true));
    harness.router.stop();
    release();
    await harness.router.drain();

    expect(abortSpy).toHaveBeenCalledTimes(1);
  });
});
