import { createHash } from 'node:crypto';

import type { MemoryRecord } from '../../core/memory/contracts';
import type {
  IndexedMemoryMatch,
  RelationshipMemoryIndex,
  SemanticMemoryIndex,
} from '../../core/memory/hybrid-retrieval';
import { createLocalTextEmbedding } from './local-memory-indexes';

type Fetcher = typeof fetch;

const validateExternalIndexUrl = (value: string): URL => {
  const url = new URL(value);
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('External index URLs require HTTPS, except for loopback HTTP.');
  }
  return url;
};

const pointId = (memoryId: string): string => {
  const digest = createHash('sha256').update(memoryId).digest('hex').slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20)}`;
};

const responseJson = async (response: Response): Promise<unknown> => {
  if (!response.ok) throw new Error(`External memory index returned HTTP ${response.status}.`);
  return response.json() as Promise<unknown>;
};

export class QdrantMemoryIndex implements SemanticMemoryIndex {
  public readonly kind = 'vector-database' as const;
  private readonly baseUrl: URL;

  public constructor(
    baseUrl: string,
    private readonly collection: string,
    private readonly fetcher: Fetcher,
    private readonly getApiKey: () => Promise<string | undefined>,
  ) {
    this.baseUrl = validateExternalIndexUrl(baseUrl);
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(collection)) throw new Error('Invalid Qdrant collection.');
  }

  public async sync(namespace: string, records: readonly MemoryRecord[]): Promise<void> {
    const points = records
      .filter((record) => record.namespace === namespace && record.status === 'active')
      .map((record) => ({
        id: pointId(record.id),
        vector: [...createLocalTextEmbedding(`${record.normalizedKey} ${record.content}`)],
        payload: { memoryId: record.id, namespace },
      }));
    if (points.length === 0) return;
    await responseJson(
      await this.fetcher(this.url(`/collections/${encodeURIComponent(this.collection)}/points`), {
        method: 'PUT',
        headers: await this.headers(),
        body: JSON.stringify({ points }),
      }),
    );
  }

  public async search(
    namespace: string,
    query: string,
    limit: number,
  ): Promise<IndexedMemoryMatch[]> {
    const value = await responseJson(
      await this.fetcher(
        this.url(`/collections/${encodeURIComponent(this.collection)}/points/query`),
        {
          method: 'POST',
          headers: await this.headers(),
          body: JSON.stringify({
            query: [...createLocalTextEmbedding(query)],
            filter: { must: [{ key: 'namespace', match: { value: namespace } }] },
            limit,
            with_payload: true,
          }),
        },
      ),
    );
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid Qdrant response.');
    const result = (value as Record<string, unknown>).result;
    const points =
      result && typeof result === 'object' && !Array.isArray(result)
        ? (result as Record<string, unknown>).points
        : undefined;
    if (!Array.isArray(points)) throw new Error('Invalid Qdrant response.');
    return points.flatMap((item): IndexedMemoryMatch[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const payload = record.payload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
      const memoryId = (payload as Record<string, unknown>).memoryId;
      const returnedNamespace = (payload as Record<string, unknown>).namespace;
      return typeof memoryId === 'string' &&
        memoryId.length <= 128 &&
        returnedNamespace === namespace &&
        typeof record.score === 'number' &&
        Number.isFinite(record.score)
        ? [{ memoryId, score: Math.max(0, Math.min(1, record.score)), reason: 'semantic' }]
        : [];
    });
  }

  private url(pathname: string): string {
    return new URL(
      pathname.replace(/^\//u, ''),
      `${this.baseUrl.toString().replace(/\/$/u, '')}/`,
    ).toString();
  }

  private async headers(): Promise<Record<string, string>> {
    const apiKey = await this.getApiKey();
    return { 'content-type': 'application/json', ...(apiKey ? { 'api-key': apiKey } : {}) };
  }
}

export class Neo4jRelationshipMemoryIndex implements RelationshipMemoryIndex {
  public readonly kind = 'graph' as const;
  private readonly endpoint: URL;

  public constructor(
    endpoint: string,
    private readonly database: string,
    private readonly username: string,
    private readonly fetcher: Fetcher,
    private readonly getPassword: () => Promise<string | undefined>,
  ) {
    this.endpoint = validateExternalIndexUrl(endpoint);
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(database) || !username || username.length > 128) {
      throw new Error('Invalid Neo4j configuration.');
    }
  }

  public async sync(namespace: string, records: readonly MemoryRecord[]): Promise<void> {
    await this.run(
      'UNWIND $records AS row MERGE (m:DeskpetMemory {namespace:$namespace, memoryId:row.memoryId}) SET m.terms=row.terms, m.kind=row.kind',
      {
        namespace,
        records: records
          .filter((record) => record.namespace === namespace && record.status === 'active')
          .map((record) => ({
            memoryId: record.id,
            kind: record.type,
            terms: this.terms(`${record.normalizedKey} ${record.content}`),
          })),
      },
    );
  }

  public async search(
    namespace: string,
    query: string,
    limit: number,
  ): Promise<IndexedMemoryMatch[]> {
    const rows = await this.run(
      'MATCH (seed:DeskpetMemory {namespace:$namespace}) WHERE any(term IN seed.terms WHERE term IN $terms) OPTIONAL MATCH (seed),(related:DeskpetMemory {namespace:$namespace}) WHERE seed <> related AND any(term IN seed.terms WHERE term IN related.terms) RETURN related.memoryId AS memoryId, 0.55 AS score LIMIT $limit',
      { namespace, terms: this.terms(query), limit },
    );
    return rows.flatMap((row): IndexedMemoryMatch[] =>
      typeof row[0] === 'string' && typeof row[1] === 'number'
        ? [{ memoryId: row[0], score: Math.max(0, Math.min(1, row[1])), reason: 'relationship' }]
        : [],
    );
  }

  private terms(text: string): string[] {
    return [
      ...new Set(
        text
          .normalize('NFKC')
          .toLocaleLowerCase()
          .match(/[\p{L}\p{N}]{2,}/gu) ?? [],
      ),
    ].slice(0, 64);
  }

  private async run(statement: string, parameters: Record<string, unknown>): Promise<unknown[][]> {
    const password = await this.getPassword();
    const response = await this.fetcher(
      new URL(
        `db/${encodeURIComponent(this.database)}/tx/commit`,
        `${this.endpoint.toString().replace(/\/$/u, '')}/`,
      ).toString(),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(password
            ? {
                authorization: `Basic ${Buffer.from(`${this.username}:${password}`).toString('base64')}`,
              }
            : {}),
        },
        body: JSON.stringify({ statements: [{ statement, parameters }] }),
      },
    );
    const value = await responseJson(response);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid Neo4j response.');
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.errors) && record.errors.length > 0)
      throw new Error('Neo4j query failed.');
    const first = Array.isArray(record.results) ? record.results[0] : undefined;
    if (!first || typeof first !== 'object' || Array.isArray(first)) return [];
    const data = (first as Record<string, unknown>).data;
    return Array.isArray(data)
      ? data.flatMap((item): unknown[][] =>
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          Array.isArray((item as Record<string, unknown>).row)
            ? [(item as { row: unknown[] }).row]
            : [],
        )
      : [];
  }
}
