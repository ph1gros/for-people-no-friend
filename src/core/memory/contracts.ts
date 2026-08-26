export const MEMORY_TYPES = ['preference', 'person', 'event', 'plan', 'fact'] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export type MemoryStatus = 'active' | 'superseded' | 'deleted';

export interface MemoryCandidate {
  type: MemoryType;
  normalizedKey: string;
  content: string;
  importance: number;
  confidence: number;
  expiresAt?: number;
}

export interface MemoryRecord extends MemoryCandidate {
  id: string;
  namespace: string;
  status: MemoryStatus;
  sourceMessageId?: string;
  sourceExcerpt?: string;
  source: 'manual' | 'automatic';
  createdAt: number;
  updatedAt: number;
  lastConfirmedAt?: number;
  lastUsedAt?: number;
}

export interface SessionSummary {
  conversationId: string;
  summary: string;
  coveredUntilMessageId?: string;
  updatedAt: number;
}
