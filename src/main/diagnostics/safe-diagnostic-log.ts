import { appendFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { LlmErrorCode } from '../../core/llm/contracts';

const DEFAULT_MAX_LOG_BYTES = 256 * 1_024;
const MAX_IDENTIFIER_LENGTH = 160;

export type CharacterLoreDiagnosticOutcome = 'success' | 'parse-failure' | 'stream-failure';
export type CharacterLoreParseFailure =
  'missing-json-object' | 'truncated-json-object' | 'invalid-json' | 'invalid-json-root';

export interface CharacterLoreDiagnosticEvent {
  providerId: string;
  modelId: string;
  outcome: CharacterLoreDiagnosticOutcome;
  finishReason: string;
  outputCharacters: number;
  hasOpeningBrace: boolean;
  hasClosingBrace: boolean;
  parseFailure?: CharacterLoreParseFailure;
  errorCode?: LlmErrorCode;
  fieldSummary?: {
    aliases: number;
    identity: boolean;
    personality: boolean;
    background: boolean;
    relationships: number;
    speechStyle: boolean;
    sampleLines: number;
    roleplayExamples: number;
  };
}

export interface CharacterLoreDiagnosticSink {
  recordCharacterLore(event: CharacterLoreDiagnosticEvent): Promise<void>;
}

const cleanIdentifier = (value: string): string =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_IDENTIFIER_LENGTH);

export class SafeDiagnosticLog implements CharacterLoreDiagnosticSink {
  public readonly filePath: string;
  private pending: Promise<void> = Promise.resolve();

  public constructor(
    userDataPath: string,
    private readonly maxLogBytes = DEFAULT_MAX_LOG_BYTES,
  ) {
    this.filePath = path.join(userDataPath, 'model-diagnostics.v1.jsonl');
  }

  public recordCharacterLore(event: CharacterLoreDiagnosticEvent): Promise<void> {
    this.pending = this.pending.then(async () => {
      const record = {
        version: 1,
        event: 'character-lore-generation',
        recordedAt: new Date().toISOString(),
        providerId: cleanIdentifier(event.providerId),
        modelId: cleanIdentifier(event.modelId),
        outcome: event.outcome,
        finishReason: cleanIdentifier(event.finishReason),
        outputCharacters: Math.max(0, Math.min(10_000_000, Math.trunc(event.outputCharacters))),
        hasOpeningBrace: event.hasOpeningBrace,
        hasClosingBrace: event.hasClosingBrace,
        ...(event.parseFailure ? { parseFailure: event.parseFailure } : {}),
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        ...(event.fieldSummary ? { fieldSummary: event.fieldSummary } : {}),
      };
      const line = `${JSON.stringify(record)}\n`;
      const lineBytes = Buffer.byteLength(line, 'utf8');
      const currentBytes = await stat(this.filePath)
        .then((value) => value.size)
        .catch(() => 0);
      if (currentBytes + lineBytes > this.maxLogBytes) {
        await writeFile(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
        return;
      }
      await appendFile(this.filePath, line, { encoding: 'utf8', mode: 0o600 });
    });
    this.pending = this.pending.catch(() => undefined);
    return this.pending;
  }
}
