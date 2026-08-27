export type ConversationContextSource =
  | 'character-core'
  | 'current-scene'
  | 'short-term'
  | 'long-term-memory'
  | 'character-knowledge'
  | 'work-glossary'
  | 'reply-boundary';

export interface ConversationContextEntry {
  source: ConversationContextSource;
  content: string;
  priority: number;
  maximumCharacters: number;
}

const SOURCE_ORDER: readonly ConversationContextSource[] = [
  'character-core',
  'current-scene',
  'short-term',
  'long-term-memory',
  'character-knowledge',
  'work-glossary',
  'reply-boundary',
];

export class ConversationContextRegistry {
  private readonly entries = new Map<ConversationContextSource, ConversationContextEntry>();

  public replace(entry: ConversationContextEntry): void {
    const content = entry.content.trim();
    if (!content) {
      this.entries.delete(entry.source);
      return;
    }
    if (
      !Number.isFinite(entry.priority) ||
      !Number.isInteger(entry.maximumCharacters) ||
      entry.maximumCharacters < 1 ||
      entry.maximumCharacters > 32_768
    ) {
      throw new Error('The conversation context entry is invalid.');
    }
    this.entries.set(entry.source, {
      ...entry,
      content: content.slice(0, entry.maximumCharacters),
    });
  }

  public remove(source: ConversationContextSource): void {
    this.entries.delete(source);
  }

  public snapshot(maximumCharacters = 32_768): ConversationContextEntry[] {
    let remaining = Math.max(0, Math.min(131_072, Math.trunc(maximumCharacters)));
    const ordered = [...this.entries.values()].sort(
      (left, right) =>
        left.priority - right.priority ||
        SOURCE_ORDER.indexOf(left.source) - SOURCE_ORDER.indexOf(right.source),
    );
    const selected: ConversationContextEntry[] = [];
    for (const entry of ordered) {
      if (remaining <= 0) break;
      const content = entry.content.slice(0, remaining);
      if (content) selected.push({ ...entry, content });
      remaining -= content.length;
    }
    return selected.sort(
      (left, right) => SOURCE_ORDER.indexOf(left.source) - SOURCE_ORDER.indexOf(right.source),
    );
  }
}
