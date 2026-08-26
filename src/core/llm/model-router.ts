import type {
  ChatEvent,
  ChatRequest,
  ConnectionResult,
  LlmProvider,
  ModelAssignments,
  ModelSelection,
  ModelTask,
} from './contracts';
import { ConfigurationError } from './errors';
import { ProviderRegistry } from './provider-registry';

export class ModelRouter {
  public constructor(
    private readonly registry: ProviderRegistry,
    private readonly assignments: ModelAssignments,
  ) {}

  public getSelection(task: ModelTask): ModelSelection {
    const selection = this.assignments[task];
    this.registry.get(selection.providerId);
    return { ...selection };
  }

  public streamChat(
    task: ModelTask,
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ChatEvent> {
    const selection = this.getSelection(task);
    return this.registry.get(selection.providerId).streamChat(request, selection, signal);
  }

  public testConnection(task: ModelTask, signal?: AbortSignal): Promise<ConnectionResult> {
    const selection = this.getSelection(task);
    return this.registry.get(selection.providerId).testConnection(selection, signal);
  }

  public withAssignments(assignments: ModelAssignments): ModelRouter {
    return new ModelRouter(this.registry, assignments);
  }
}

export class DisabledProvider implements LlmProvider {
  public readonly id = 'disabled';
  public readonly displayName = 'Disabled';

  public listCapabilities(): ReadonlySet<never> {
    return new Set();
  }

  public streamChat(): AsyncIterable<never> {
    const providerId = this.id;
    return {
      [Symbol.asyncIterator](): AsyncIterator<never> {
        return {
          next: async () => {
            throw new ConfigurationError('No model provider is configured.', providerId);
          },
        };
      },
    };
  }

  public async testConnection(): Promise<ConnectionResult> {
    return {
      ok: false,
      error: {
        code: 'configuration',
        message: 'No model provider is configured.',
        retryable: false,
      },
    };
  }
}
