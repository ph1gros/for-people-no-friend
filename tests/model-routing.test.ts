import { describe, expect, it } from 'vitest';

import { ModelRouter } from '../src/core/llm/model-router';
import { ProviderRegistry } from '../src/core/llm/provider-registry';
import type {
  ChatEvent,
  ChatRequest,
  ConnectionResult,
  LlmProvider,
  ModelSelection,
} from '../src/core/llm/contracts';

class FakeProvider implements LlmProvider {
  public readonly displayName = 'Fake';
  public readonly calls: ModelSelection[] = [];

  public constructor(public readonly id: string) {}

  public listCapabilities(): ReadonlySet<'streaming'> {
    return new Set(['streaming']);
  }

  public async *streamChat(
    _request: ChatRequest,
    selection: ModelSelection,
  ): AsyncIterable<ChatEvent> {
    this.calls.push(selection);
    yield { type: 'text-delta', text: this.id };
    yield { type: 'finish', reason: 'stop' };
  }

  public async testConnection(selection: ModelSelection): Promise<ConnectionResult> {
    this.calls.push(selection);
    return { ok: true, latencyMs: 1 };
  }
}

describe('ProviderRegistry and ModelRouter', () => {
  it('registers, lists and resolves providers', () => {
    const registry = new ProviderRegistry();
    const provider = new FakeProvider('alpha');
    registry.register(provider);

    expect(registry.get('alpha')).toBe(provider);
    expect(registry.list()).toEqual([provider]);
  });

  it('rejects duplicates and unknown providers', () => {
    const registry = new ProviderRegistry();
    registry.register(new FakeProvider('alpha'));

    expect(() => registry.register(new FakeProvider('alpha'))).toThrow(/already registered/);
    expect(() => registry.get('missing')).toThrow(/Unknown model provider/);
  });

  it('routes each task only to its explicit assignment without fallback', async () => {
    const registry = new ProviderRegistry();
    const conversation = new FakeProvider('conversation-provider');
    const summary = new FakeProvider('summary-provider');
    registry.register(conversation);
    registry.register(summary);

    const router = new ModelRouter(registry, {
      conversation: { providerId: conversation.id, modelId: 'chat-model' },
      memoryExtraction: { providerId: summary.id, modelId: 'memory-model' },
      summarization: { providerId: summary.id, modelId: 'summary-model' },
      characterResearch: { providerId: summary.id, modelId: 'character-model' },
    });

    const events: ChatEvent[] = [];
    for await (const event of router.streamChat('conversation', {
      systemPrompt: '',
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: 'text-delta', text: conversation.id });
    expect(conversation.calls).toEqual([{ providerId: conversation.id, modelId: 'chat-model' }]);
    expect(summary.calls).toEqual([]);
  });
});
