import type { LlmProvider } from './contracts';
import { ConfigurationError } from './errors';

export class ProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();

  public register(provider: LlmProvider): void {
    if (!provider.id || this.providers.has(provider.id)) {
      throw new ConfigurationError(
        provider.id
          ? `Provider "${provider.id}" is already registered.`
          : 'Provider IDs cannot be empty.',
        provider.id,
      );
    }
    this.providers.set(provider.id, provider);
  }

  public get(providerId: string): LlmProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new ConfigurationError(`Unknown model provider "${providerId}".`, providerId);
    }
    return provider;
  }

  public list(): LlmProvider[] {
    return [...this.providers.values()];
  }
}
