import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { SafeDiagnosticLog } from '../src/main/diagnostics/safe-diagnostic-log';

const testRoot = path.resolve('.release', 'diagnostic-log-tests');
const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(testRoot, 'case-'));
  temporaryDirectories.push(directory);
  return directory;
};

describe('SafeDiagnosticLog', () => {
  beforeAll(async () => {
    await mkdir(testRoot, { recursive: true });
  });

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('persists only bounded character-generation metadata', async () => {
    const directory = await createTemporaryDirectory();
    const log = new SafeDiagnosticLog(directory);

    await log.recordCharacterLore({
      providerId: 'deepseek\nignored',
      modelId: 'deepseek-v4-pro',
      outcome: 'parse-failure',
      finishReason: 'max_tokens',
      outputCharacters: 12_345,
      hasOpeningBrace: true,
      hasClosingBrace: false,
      parseFailure: 'truncated-json-object',
      errorCode: 'provider-response',
      fieldSummary: {
        aliases: 2,
        identity: true,
        personality: true,
        background: true,
        relationships: 0,
        speechStyle: true,
        sampleLines: 12,
        roleplayExamples: 8,
      },
    });

    const contents = await readFile(log.filePath, 'utf8');
    const record = JSON.parse(contents.trim()) as Record<string, unknown>;
    expect(record).toMatchObject({
      version: 1,
      event: 'character-lore-generation',
      providerId: 'deepseek ignored',
      modelId: 'deepseek-v4-pro',
      outcome: 'parse-failure',
      finishReason: 'max_tokens',
      outputCharacters: 12_345,
      hasOpeningBrace: true,
      hasClosingBrace: false,
      parseFailure: 'truncated-json-object',
      errorCode: 'provider-response',
      fieldSummary: {
        aliases: 2,
        identity: true,
        personality: true,
        background: true,
        relationships: 0,
        speechStyle: true,
        sampleLines: 12,
        roleplayExamples: 8,
      },
    });
    expect(contents).not.toContain('apiKey');
    expect(contents).not.toContain('sourceText');
    expect(contents).not.toContain('outputText');
  });

  it('rotates before the bounded log grows indefinitely', async () => {
    const directory = await createTemporaryDirectory();
    const log = new SafeDiagnosticLog(directory, 550);
    for (let index = 0; index < 8; index += 1) {
      await log.recordCharacterLore({
        providerId: 'deepseek',
        modelId: `fake-model-${index}`,
        outcome: 'success',
        finishReason: 'stop',
        outputCharacters: index,
        hasOpeningBrace: true,
        hasClosingBrace: true,
      });
    }

    expect((await stat(log.filePath)).size).toBeLessThanOrEqual(550);
    expect(await readFile(log.filePath, 'utf8')).toContain('fake-model-7');
  });
});
