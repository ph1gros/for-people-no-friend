import type { ConversationMessage } from '../../shared/conversation-ipc';
import { DeskpetDatabase } from './deskpet-database';

const isStoredMessage = (value: unknown): value is ConversationMessage =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  typeof value.id === 'string' &&
  value.id.length > 0 &&
  value.id.length <= 256 &&
  'role' in value &&
  (value.role === 'user' || value.role === 'assistant') &&
  'content' in value &&
  typeof value.content === 'string' &&
  value.content.length <= 32_768 &&
  'createdAt' in value &&
  typeof value.createdAt === 'number' &&
  Number.isFinite(value.createdAt) &&
  'status' in value &&
  (value.status === 'complete' || value.status === 'cancelled');

export class ConversationStore {
  private readonly database: DeskpetDatabase;
  private readonly ownsDatabase: boolean;

  public constructor(databaseOrUserDataPath: DeskpetDatabase | string) {
    this.ownsDatabase = typeof databaseOrUserDataPath === 'string';
    this.database =
      typeof databaseOrUserDataPath === 'string'
        ? new DeskpetDatabase(databaseOrUserDataPath)
        : databaseOrUserDataPath;
  }

  public async list(limit = 100, namespace = 'default-character'): Promise<ConversationMessage[]> {
    return this.database.listMessages(limit, namespace);
  }

  public async append(
    message: ConversationMessage,
    namespace = 'default-character',
  ): Promise<void> {
    if (!isStoredMessage(message)) {
      throw new Error('The conversation message is invalid.');
    }
    this.database.appendMessage({ ...message }, namespace);
  }

  public async clear(namespace = 'default-character'): Promise<void> {
    this.database.clearMessages(namespace);
  }

  public close(): void {
    if (this.ownsDatabase) {
      this.database.close();
    }
  }
}
