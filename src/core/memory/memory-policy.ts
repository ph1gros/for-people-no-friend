import {
  MEMORY_TYPES,
  type AutomaticMemoryCandidate,
  type MemoryCandidate,
  type MemoryReviewReason,
  type MemoryType,
} from './contracts';

const memoryTypeSet = new Set<string>(MEMORY_TYPES);
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const AUTOMATIC_MEMORY_BATCH_MESSAGES = 20;
export const AUTOMATIC_MEMORY_MAX_CANDIDATES = 3;
export const AUTOMATIC_MEMORY_MIN_IMPORTANCE = 0.4;
export const AUTOMATIC_MEMORY_MIN_CONFIDENCE = 0.65;
const SECRET_PATTERNS = [
  /\b(?:sk|api|key)-[A-Za-z0-9_-]{12,}\b/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b/i,
  /(?:密码|口令|password|passcode|api\s*key|secret)\s*[:：=]\s*\S+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
];

export type ExplicitMemoryIntent =
  { type: 'remember'; content: string } | { type: 'forget'; content: string };

const cleanContent = (value: string): string =>
  value.trim().replace(/^[：:，,。.!！\s]+|[。.!！\s]+$/g, '');

export const normalizeMemoryKey = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, 160);

export const inferMemoryType = (content: string): MemoryType => {
  if (/(?:喜欢|不喜欢|偏好|讨厌|更爱|prefer|favorite|favourite|dislike)/i.test(content)) {
    return 'preference';
  }
  if (
    /(?:家人|朋友|同事|伴侣|父亲|母亲|哥哥|姐姐|弟弟|妹妹|friend|family|colleague)/i.test(content)
  ) {
    return 'person';
  }
  if (/(?:计划|打算|目标|准备要|将会|plan|goal|intend)/i.test(content)) {
    return 'plan';
  }
  if (/(?:昨天|今天|上周|发生|参加了|去了|完成了|yesterday|happened|attended)/i.test(content)) {
    return 'event';
  }
  return 'fact';
};

export const deriveMemoryKey = (content: string, type = inferMemoryType(content)): string => {
  const normalized = content.normalize('NFKC').trim();
  if (type === 'preference') {
    const chinesePreference = normalized.match(
      /(?:我|用户)?(?:现在|目前)?(?:已经)?(?:不再)?(?:不|很|最|更)?(?:喜欢|偏好|讨厌|爱吃|爱喝)\s*(.+)$/u,
    );
    if (chinesePreference?.[1]) {
      return `preference:${normalizeMemoryKey(chinesePreference[1])}`;
    }
    const englishPreference = normalized.match(
      /(?:i|user)\s+(?:now\s+)?(?:do not\s+|don't\s+|no longer\s+)?(?:like|prefer|love|dislike)\s+(.+)$/i,
    );
    if (englishPreference?.[1]) {
      return `preference:${normalizeMemoryKey(englishPreference[1])}`;
    }
  }
  return `${type}:${normalizeMemoryKey(normalized)}`;
};

export const parseExplicitMemoryIntent = (input: string): ExplicitMemoryIntent | undefined => {
  const text = input.trim();
  const prefixForget = text.match(
    /^(?:请)?(?:忘记|忘掉|别再记得|不要再记得)(?:这件事)?[：:，,\s]*(.+)$/su,
  );
  if (prefixForget?.[1]) {
    const content = cleanContent(prefixForget[1]);
    return content ? { type: 'forget', content } : undefined;
  }
  const suffixForget = text.match(/^(.+?)[，,\s]*(?:请)?(?:忘记|忘掉)(?:这件事)?[。.!！]?$/su);
  if (suffixForget?.[1]) {
    const content = cleanContent(suffixForget[1]);
    return content ? { type: 'forget', content } : undefined;
  }
  const prefixRemember = text.match(/^(?:请)?(?:记住|记得)(?:这件事)?[：:，,\s]*(.+)$/su);
  if (prefixRemember?.[1]) {
    const content = cleanContent(prefixRemember[1]);
    return content ? { type: 'remember', content } : undefined;
  }
  const suffixRemember = text.match(/^(.+?)[，,\s]*(?:请)?(?:记住|记得)(?:这件事)?[。.!！]?$/su);
  if (suffixRemember?.[1]) {
    const content = cleanContent(suffixRemember[1]);
    return content ? { type: 'remember', content } : undefined;
  }
  return undefined;
};

export const containsSensitiveInformation = (content: string): boolean => {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
    return true;
  }
  const digits = content.replace(/[^0-9]/g, '');
  return digits.length >= 13 && digits.length <= 19;
};

export const sanitizeMemoryCandidate = (
  value: unknown,
  source: 'manual' | 'automatic',
): MemoryCandidate | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const content =
    'content' in value && typeof value.content === 'string' ? cleanContent(value.content) : '';
  const type =
    'type' in value && typeof value.type === 'string' && memoryTypeSet.has(value.type)
      ? (value.type as MemoryType)
      : inferMemoryType(content);
  const rawKey =
    'normalizedKey' in value && typeof value.normalizedKey === 'string'
      ? normalizeMemoryKey(value.normalizedKey)
      : '';
  const importance =
    'importance' in value && typeof value.importance === 'number'
      ? value.importance
      : source === 'manual'
        ? 0.9
        : 0;
  const confidence =
    'confidence' in value && typeof value.confidence === 'number'
      ? value.confidence
      : source === 'manual'
        ? 1
        : 0;
  const expiresAt =
    'expiresAt' in value && typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt)
      ? Math.trunc(value.expiresAt)
      : undefined;
  if (
    !content ||
    content.length > 1_000 ||
    containsSensitiveInformation(content) ||
    !Number.isFinite(importance) ||
    !Number.isFinite(confidence) ||
    (source === 'automatic' &&
      (importance < AUTOMATIC_MEMORY_MIN_IMPORTANCE ||
        confidence < AUTOMATIC_MEMORY_MIN_CONFIDENCE))
  ) {
    return undefined;
  }
  const normalizedKey =
    type === 'preference'
      ? deriveMemoryKey(content, type)
      : `${type}:${rawKey || normalizeMemoryKey(content)}`;
  return {
    type,
    normalizedKey,
    content,
    importance: Math.max(0, Math.min(1, importance)),
    confidence: Math.max(0, Math.min(1, confidence)),
    ...(expiresAt && expiresAt > Date.now() ? { expiresAt } : {}),
  };
};

export const memoryReviewReasons = (candidate: MemoryCandidate): MemoryReviewReason[] => {
  const reasons: MemoryReviewReason[] = [];
  if (
    candidate.type === 'preference' ||
    candidate.type === 'person' ||
    /(?:习惯|通常|经常|每天|每周|habit|usually|often|daily|weekly)/i.test(candidate.content)
  ) {
    reasons.push('profile_claim');
  }
  if (
    (candidate.type === 'event' || candidate.type === 'plan') &&
    candidate.expiresAt === undefined &&
    /(?:明天|后天|下周|下月|下个月|下季度|明年|过几天|以后|之后|未来|有空|改天|稍后|待会|tomorrow|next\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|later|someday|in\s+the\s+future)/i.test(
      candidate.content,
    )
  ) {
    reasons.push('time_uncertain');
  }
  return reasons;
};

export const parseAutomaticMemoryCandidates = (text: string): AutomaticMemoryCandidate[] => {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start < 0 || end <= start) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((value): AutomaticMemoryCandidate | undefined => {
        const candidate = sanitizeMemoryCandidate(value, 'automatic');
        const sourceMessageId =
          typeof value === 'object' &&
          value !== null &&
          'sourceMessageId' in value &&
          typeof value.sourceMessageId === 'string' &&
          MESSAGE_ID_PATTERN.test(value.sourceMessageId)
            ? value.sourceMessageId
            : undefined;
        return candidate && sourceMessageId ? { ...candidate, sourceMessageId } : undefined;
      })
      .filter((candidate): candidate is AutomaticMemoryCandidate => candidate !== undefined)
      .slice(0, AUTOMATIC_MEMORY_MAX_CANDIDATES);
  } catch {
    return [];
  }
};
