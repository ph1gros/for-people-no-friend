export const MEMORY_TYPES = ['preference', 'person', 'event', 'plan', 'fact'] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export type MemoryStatus = 'active' | 'superseded' | 'deleted';

export const MEMORY_CANDIDATE_STATUSES = ['pending', 'conflict', 'confirmed', 'rejected'] as const;

export type MemoryCandidateStatus = (typeof MEMORY_CANDIDATE_STATUSES)[number];

export const MEMORY_REVIEW_REASONS = [
  'legacy_automatic',
  'conflict',
  'time_uncertain',
  'profile_claim',
] as const;

export type MemoryReviewReason = (typeof MEMORY_REVIEW_REASONS)[number];

export interface MemoryCandidate {
  type: MemoryType;
  normalizedKey: string;
  content: string;
  importance: number;
  confidence: number;
  expiresAt?: number;
}

export interface AutomaticMemoryCandidate extends MemoryCandidate {
  sourceMessageId: string;
}

export interface MemoryEvidence {
  sourceMessageId: string;
  observedAt: number;
  sourceExcerpt?: string;
}

export interface MemoryCandidateRecord extends MemoryCandidate {
  id: string;
  namespace: string;
  status: MemoryCandidateStatus;
  reviewReasons: MemoryReviewReason[];
  evidence: MemoryEvidence[];
  evidenceDateCount: number;
  conflictingMemory?: MemoryRecord;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  decisionAt?: number;
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
