import { describe, expect, it } from 'vitest';

import { ConversationContextRegistry } from '../src/core/conversation/context-registry';

describe('conversation context registry', () => {
  it('replaces only its own source and returns deterministic bounded snapshots', () => {
    const registry = new ConversationContextRegistry();
    registry.replace({
      source: 'long-term-memory',
      content: '长期事实',
      priority: 20,
      maximumCharacters: 20,
    });
    registry.replace({
      source: 'character-core',
      content: '稳定角色',
      priority: 10,
      maximumCharacters: 20,
    });
    registry.replace({
      source: 'long-term-memory',
      content: '新的长期事实',
      priority: 20,
      maximumCharacters: 20,
    });

    expect(registry.snapshot()).toEqual([
      { source: 'character-core', content: '稳定角色', priority: 10, maximumCharacters: 20 },
      { source: 'long-term-memory', content: '新的长期事实', priority: 20, maximumCharacters: 20 },
    ]);
    expect(
      registry
        .snapshot(6)
        .map(({ content }) => content)
        .join(''),
    ).toBe('稳定角色新的');
  });

  it('protects a high-priority boundary without changing prompt source order', () => {
    const registry = new ConversationContextRegistry();
    registry.replace({
      source: 'character-core',
      content: '角色',
      priority: 10,
      maximumCharacters: 20,
    });
    registry.replace({
      source: 'short-term',
      content: '短期上下文很长',
      priority: 20,
      maximumCharacters: 20,
    });
    registry.replace({
      source: 'reply-boundary',
      content: '边界',
      priority: 0,
      maximumCharacters: 20,
    });

    expect(registry.snapshot(4).map(({ source, content }) => [source, content])).toEqual([
      ['character-core', '角色'],
      ['reply-boundary', '边界'],
    ]);
  });
});
