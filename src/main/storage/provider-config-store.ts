import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveChatCompletionsUrl } from '../../adapters/llm/openai-compatible-provider';
import type { ModelSelection } from '../../core/llm/contracts';
import { parseConversationConfiguration } from '../../shared/conversation-ipc';

interface ProviderConfigFile {
  version: 1;
  openAICompatibleBaseUrl: string;
  conversationSelection?: ModelSelection;
}

const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://api.openai.com/v1';

export class ProviderConfigStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'model-providers.v1.json');
  }

  public async getOpenAICompatibleBaseUrl(): Promise<string> {
    await this.writeQueue;
    return (await this.read()).openAICompatibleBaseUrl;
  }

  public setOpenAICompatibleBaseUrl(baseUrl: string): Promise<void> {
    return this.enqueueWrite(async () => {
      resolveChatCompletionsUrl(baseUrl);
      const current = await this.read();
      await this.write({ ...current, openAICompatibleBaseUrl: baseUrl.trim() });
    });
  }

  public async getConversationSelection(): Promise<ModelSelection | undefined> {
    await this.writeQueue;
    const selection = (await this.read()).conversationSelection;
    return selection ? { ...selection } : undefined;
  }

  public setConversationSelection(selection?: ModelSelection): Promise<void> {
    return this.enqueueWrite(async () => {
      const validated = parseConversationConfiguration({ selection }).selection;
      const current = await this.read();
      await this.write({
        ...current,
        ...(validated
          ? { conversationSelection: validated }
          : { conversationSelection: undefined }),
      });
    });
  }

  private enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<ProviderConfigFile> {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (
        typeof value !== 'object' ||
        value === null ||
        !('version' in value) ||
        value.version !== 1 ||
        !('openAICompatibleBaseUrl' in value) ||
        typeof value.openAICompatibleBaseUrl !== 'string'
      ) {
        throw new Error('The model provider configuration is invalid.');
      }
      resolveChatCompletionsUrl(value.openAICompatibleBaseUrl);
      const conversationSelection = parseConversationConfiguration({
        selection: 'conversationSelection' in value ? value.conversationSelection : undefined,
      }).selection;
      return {
        version: 1,
        openAICompatibleBaseUrl: value.openAICompatibleBaseUrl,
        ...(conversationSelection ? { conversationSelection } : {}),
      };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return {
          version: 1,
          openAICompatibleBaseUrl: DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
        };
      }
      throw error;
    }
  }

  private async write(file: ProviderConfigFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(file, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    try {
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
