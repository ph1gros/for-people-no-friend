import type {
  MemoryCandidate,
  MemoryCandidateRecord,
  MemoryConflictResolution,
  MemoryRecord,
  MemoryType,
} from '../core/memory/contracts';
import { MEMORY_CONFLICT_RESOLUTIONS, MEMORY_TYPES } from '../core/memory/contracts';
import { deriveMemoryKey } from '../core/memory/memory-policy';

export interface MemorySettings {
  automaticMemoryEnabled: boolean;
  semanticIndex: 'local' | 'qdrant';
  relationshipIndex: 'local' | 'neo4j';
  qdrantUrl: string;
  qdrantCollection: string;
  qdrantApiKeySaved: boolean;
  neo4jUrl: string;
  neo4jDatabase: string;
  neo4jUsername: string;
  neo4jPasswordSaved: boolean;
}

export interface SetMemorySettingsInput {
  automaticMemoryEnabled: boolean;
  semanticIndex?: 'local' | 'qdrant';
  relationshipIndex?: 'local' | 'neo4j';
  qdrantUrl?: string;
  qdrantCollection?: string;
  qdrantApiKey?: string;
  neo4jUrl?: string;
  neo4jDatabase?: string;
  neo4jUsername?: string;
  neo4jPassword?: string;
}

export interface UpdateMemoryInput {
  id: string;
  type: MemoryType;
  content: string;
  importance: number;
  confidence: number;
  expiresAt?: number;
}

export type UpdateMemoryCandidateInput = UpdateMemoryInput;

export interface ConfirmMemoryCandidateInput extends MemoryIdInput {
  conflictResolution?: MemoryConflictResolution;
}

export interface MergeMemoryCandidatesInput {
  targetId: string;
  sourceId: string;
}

export interface MemoryIdInput {
  id: string;
}

export type MemoryOperationResult = { ok: true } | { ok: false; message: string };

export type MemoryFileOperationResult =
  { ok: true; canceled: boolean } | { ok: false; canceled: false; message: string };

export type MemoryListResult = MemoryRecord[];
export type MemoryCandidateListResult = MemoryCandidateRecord[];

const MEMORY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const memoryTypeSet = new Set<string>(MEMORY_TYPES);
const conflictResolutionSet = new Set<string>(MEMORY_CONFLICT_RESOLUTIONS);

export const parseSetMemorySettingsInput = (value: unknown): SetMemorySettingsInput => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('automaticMemoryEnabled' in value) ||
    typeof value.automaticMemoryEnabled !== 'boolean'
  ) {
    throw new Error('The memory settings are invalid.');
  }
  const record = value as Record<string, unknown>;
  const semanticIndex = record.semanticIndex ?? 'local';
  const relationshipIndex = record.relationshipIndex ?? 'local';
  const qdrantUrl = record.qdrantUrl ?? 'http://127.0.0.1:6333';
  const qdrantCollection = record.qdrantCollection ?? 'deskpet_memories';
  const neo4jUrl = record.neo4jUrl ?? 'http://127.0.0.1:7474';
  const neo4jDatabase = record.neo4jDatabase ?? 'neo4j';
  const neo4jUsername = record.neo4jUsername ?? 'neo4j';
  const validSecret = (secret: unknown): secret is string =>
    secret === undefined ||
    (typeof secret === 'string' &&
      secret.trim().length > 0 &&
      secret.length <= 32_768 &&
      !/^\*+$/u.test(secret.trim()));
  if (
    (semanticIndex !== 'local' && semanticIndex !== 'qdrant') ||
    (relationshipIndex !== 'local' && relationshipIndex !== 'neo4j') ||
    typeof qdrantUrl !== 'string' ||
    qdrantUrl.length > 2_048 ||
    typeof qdrantCollection !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(qdrantCollection) ||
    typeof neo4jUrl !== 'string' ||
    neo4jUrl.length > 2_048 ||
    typeof neo4jDatabase !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(neo4jDatabase) ||
    typeof neo4jUsername !== 'string' ||
    !neo4jUsername.trim() ||
    neo4jUsername.length > 128 ||
    !validSecret(record.qdrantApiKey) ||
    !validSecret(record.neo4jPassword)
  ) {
    throw new Error('The memory index settings are invalid.');
  }
  for (const address of [qdrantUrl, neo4jUrl]) {
    const url = new URL(address);
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error('The memory index URL is invalid.');
    }
  }
  return {
    automaticMemoryEnabled: value.automaticMemoryEnabled,
    semanticIndex,
    relationshipIndex,
    qdrantUrl: qdrantUrl.trim(),
    qdrantCollection,
    neo4jUrl: neo4jUrl.trim(),
    neo4jDatabase,
    neo4jUsername: neo4jUsername.trim(),
    ...(typeof record.qdrantApiKey === 'string' ? { qdrantApiKey: record.qdrantApiKey } : {}),
    ...(typeof record.neo4jPassword === 'string' ? { neo4jPassword: record.neo4jPassword } : {}),
  };
};

export const parseMemoryIdInput = (value: unknown): MemoryIdInput => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !MEMORY_ID_PATTERN.test(value.id)
  ) {
    throw new Error('The memory ID is invalid.');
  }
  return { id: value.id };
};

export const parseConfirmMemoryCandidateInput = (value: unknown): ConfirmMemoryCandidateInput => {
  const { id } = parseMemoryIdInput(value);
  const conflictResolution =
    typeof value === 'object' &&
    value !== null &&
    'conflictResolution' in value &&
    value.conflictResolution !== undefined
      ? value.conflictResolution
      : 'replace';
  if (typeof conflictResolution !== 'string' || !conflictResolutionSet.has(conflictResolution)) {
    throw new Error('The memory conflict resolution is invalid.');
  }
  return { id, conflictResolution: conflictResolution as MemoryConflictResolution };
};

export const parseMergeMemoryCandidatesInput = (value: unknown): MergeMemoryCandidatesInput => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The memory candidate merge is invalid.');
  }
  const targetId = 'targetId' in value ? value.targetId : undefined;
  const sourceId = 'sourceId' in value ? value.sourceId : undefined;
  if (
    typeof targetId !== 'string' ||
    typeof sourceId !== 'string' ||
    !MEMORY_ID_PATTERN.test(targetId) ||
    !MEMORY_ID_PATTERN.test(sourceId) ||
    targetId === sourceId
  ) {
    throw new Error('The memory candidate merge is invalid.');
  }
  return { targetId, sourceId };
};

export const parseUpdateMemoryInput = (
  value: unknown,
): { id: string; candidate: MemoryCandidate } => {
  const { id } = parseMemoryIdInput(value);
  if (typeof value !== 'object' || value === null) {
    throw new Error('The memory update is invalid.');
  }
  const type = 'type' in value ? value.type : undefined;
  const content = 'content' in value ? value.content : undefined;
  const importance = 'importance' in value ? value.importance : undefined;
  const confidence = 'confidence' in value ? value.confidence : undefined;
  const expiresAt = 'expiresAt' in value ? value.expiresAt : undefined;
  if (
    typeof type !== 'string' ||
    !memoryTypeSet.has(type) ||
    typeof content !== 'string' ||
    content.trim().length === 0 ||
    content.length > 1_000 ||
    typeof importance !== 'number' ||
    !Number.isFinite(importance) ||
    importance < 0 ||
    importance > 1 ||
    typeof confidence !== 'number' ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    (expiresAt !== undefined &&
      (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= Date.now()))
  ) {
    throw new Error('The memory update is invalid.');
  }
  const memoryType = type as MemoryType;
  return {
    id,
    candidate: {
      type: memoryType,
      normalizedKey: deriveMemoryKey(content.trim(), memoryType),
      content: content.trim(),
      importance,
      confidence,
      ...(typeof expiresAt === 'number' ? { expiresAt: Math.trunc(expiresAt) } : {}),
    },
  };
};

export const parseUpdateMemoryCandidateInput = parseUpdateMemoryInput;
