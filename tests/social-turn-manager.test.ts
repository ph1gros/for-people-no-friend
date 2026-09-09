import { describe, expect, it } from 'vitest';
import { SocialTurnManager } from '../src/core/social/social-turn-manager';

const input = {
  key: 'character-a/qq/channel-a',
  actorId: 'actor-a',
  owner: false,
  addressed: true,
  direct: false,
  busy: false,
  eligible: true,
};
describe('social turn manager', () => {
  it('listens without spending a turn and answers an addressed message', () => {
    const manager = new SocialTurnManager();
    expect(manager.admit({ ...input, eligible: false }).action).toBe('listen');
    expect(manager.admit(input).action).toBe('answer');
    expect(manager.admit({ ...input, busy: true }).action).toBe('wait');
  });
  it('enforces cooldown from completion and is robust against clock rollback', () => {
    let now = 1000;
    const manager = new SocialTurnManager({ channelCooldownMs: 1000 }, () => now);
    manager.admit(input);
    manager.finish(input.key);
    expect(manager.delay(input.key, false)).toBe(1000);
    expect(manager.admit(input).action).toBe('wait');
    now = 500;
    expect(manager.delay(input.key, false)).toBe(1000);
    now = 2000;
    expect(manager.delay(input.key, false)).toBe(0);
    expect(manager.delay(input.key, true)).toBe(0);
  });
  it('bounds per-actor bursts, including owners, and expires the sliding window', () => {
    let now = 0;
    const manager = new SocialTurnManager(
      { maxActorTurns: 2, ownerPriority: true, ownerInterrupt: true },
      () => now,
    );
    manager.admit(input);
    manager.admit(input);
    expect(manager.admit({ ...input, owner: true })).toEqual({
      action: 'ignore',
      reason: 'actor-rate-limit',
    });
    now = 10000;
    expect(manager.admit(input).action).toBe('answer');
  });
  it('limits coordinated channel spam without affecting other characters/platforms/channels', () => {
    const manager = new SocialTurnManager({ maxChannelTurns: 2 });
    manager.admit(input);
    manager.admit({ ...input, actorId: 'b' });
    expect(manager.admit({ ...input, actorId: 'c' })).toEqual({
      action: 'ignore',
      reason: 'channel-rate-limit',
    });
    for (const key of [
      'character-b/qq/channel-a',
      'character-a/kook/channel-a',
      'character-a/qq/channel-b',
    ])
      expect(manager.admit({ ...input, key }).action).toBe('answer');
  });
  it('fails closed at capacity rather than evicting live rate limits', () => {
    const manager = new SocialTurnManager({ maxChannels: 1, maxActorsPerChannel: 1 });
    manager.admit(input);
    expect(manager.admit({ ...input, key: 'b' })).toEqual({
      action: 'ignore',
      reason: 'context-capacity',
    });
    expect(manager.admit({ ...input, actorId: 'b' })).toEqual({
      action: 'ignore',
      reason: 'context-capacity',
    });
    manager.clear();
    expect(manager.admit({ ...input, key: 'b' }).action).toBe('answer');
  });
  it('makes mention priority deterministic and owner interruption opt-in', () => {
    const manager = new SocialTurnManager();
    expect(manager.admit({ ...input, addressed: false })).toMatchObject({ priority: 0 });
    expect(manager.admit(input)).toMatchObject({ priority: 10 });
    expect(manager.admit({ ...input, owner: true, busy: true }).action).toBe('wait');
    const priority = new SocialTurnManager({ ownerPriority: true, ownerInterrupt: true });
    expect(priority.admit({ ...input, owner: true, busy: true })).toMatchObject({
      action: 'interrupt',
      priority: 70,
    });
  });
  it('rejects invalid tuning instead of disabling resource bounds', () => {
    for (const options of [
      { maxChannels: 0 },
      { maxWaitMs: Infinity },
      { maxActorTurns: -1 },
      { channelCooldownMs: NaN },
    ])
      expect(() => new SocialTurnManager(options)).toThrow();
  });
});
