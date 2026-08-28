import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import type { MemoryRecord } from '../src/core/memory/contracts';
import {
  Neo4jRelationshipMemoryIndex,
  QdrantMemoryIndex,
} from '../src/main/memory/external-memory-indexes';

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  server = undefined;
});

const listen = async (handler: Parameters<typeof createServer>[0]): Promise<string> => {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local test address.');
  return `http://127.0.0.1:${address.port}/`;
};

const memory: MemoryRecord = {
  id: 'memory-1',
  namespace: 'role-a',
  type: 'person',
  normalizedKey: 'alice',
  content: '爱丽丝是用户的妹妹',
  importance: 0.9,
  confidence: 1,
  status: 'active',
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
};

describe('optional external memory indexes', () => {
  it('uses Qdrant through bounded local HTTP and stores only IDs/namespaces in payload', async () => {
    const bodies: unknown[] = [];
    const baseUrl = await listen((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += String(chunk)));
      request.on('end', () => {
        bodies.push(JSON.parse(body));
        response.setHeader('content-type', 'application/json');
        response.end(
          request.url?.endsWith('/query')
            ? JSON.stringify({
                result: {
                  points: [{ score: 0.8, payload: { memoryId: 'memory-1', namespace: 'role-a' } }],
                },
              })
            : JSON.stringify({ result: { status: 'acknowledged' } }),
        );
      });
    });
    const index = new QdrantMemoryIndex(baseUrl, 'deskpet', fetch, async () => 'fake-local-key');
    await index.sync('role-a', [memory]);
    expect(await index.search('role-a', '妹妹', 3)).toEqual([
      { memoryId: 'memory-1', score: 0.8, reason: 'semantic' },
    ]);
    expect(JSON.stringify(bodies[0])).not.toContain(memory.content);
  });

  it('uses fixed Neo4j statements and parses relation IDs without trusting returned rows', async () => {
    const statements: string[] = [];
    const baseUrl = await listen((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += String(chunk)));
      request.on('end', () => {
        const value = JSON.parse(body) as { statements: Array<{ statement: string }> };
        statements.push(value.statements[0]!.statement);
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            results: [{ data: statements.length === 1 ? [] : [{ row: ['memory-1', 0.55] }] }],
            errors: [],
          }),
        );
      });
    });
    const index = new Neo4jRelationshipMemoryIndex(
      baseUrl,
      'neo4j',
      'fake-user',
      fetch,
      async () => 'fake-local-password',
    );
    await index.sync('role-a', [memory]);
    expect(await index.search('role-a', '爱丽丝', 3)).toEqual([
      { memoryId: 'memory-1', score: 0.55, reason: 'relationship' },
    ]);
    expect(statements.every((statement) => !statement.includes('爱丽丝'))).toBe(true);
  });

  it('rejects insecure non-loopback endpoints', () => {
    expect(
      () => new QdrantMemoryIndex('http://example.com', 'deskpet', fetch, async () => undefined),
    ).toThrow(/HTTPS/u);
  });
});
