import { describe, expect, it } from 'vitest';

import {
  containsSensitiveInformation,
  deriveMemoryKey,
  parseAutomaticMemoryCandidates,
  parseExplicitMemoryIntent,
  sanitizeMemoryCandidate,
} from '../src/core/memory/memory-policy';

describe('M5 memory policy', () => {
  it('recognizes explicit remember and forget requests', () => {
    expect(parseExplicitMemoryIntent('记住：我喜欢草莓蛋糕。')).toEqual({
      type: 'remember',
      content: '我喜欢草莓蛋糕',
    });
    expect(parseExplicitMemoryIntent('我下个月要去悉尼，请记住。')).toEqual({
      type: 'remember',
      content: '我下个月要去悉尼',
    });
    expect(parseExplicitMemoryIntent('忘掉：草莓蛋糕')).toEqual({
      type: 'forget',
      content: '草莓蛋糕',
    });
  });

  it('uses the preference object as the conflict key', () => {
    expect(deriveMemoryKey('我喜欢草莓蛋糕', 'preference')).toBe(
      deriveMemoryKey('我现在不喜欢草莓蛋糕', 'preference'),
    );
  });

  it('rejects sensitive and weak automatic memories', () => {
    expect(containsSensitiveInformation('password: super-secret-value')).toBe(true);
    expect(
      sanitizeMemoryCandidate(
        {
          type: 'fact',
          normalizedKey: 'password',
          content: 'password: super-secret-value',
          importance: 1,
          confidence: 1,
        },
        'manual',
      ),
    ).toBeUndefined();
    expect(
      sanitizeMemoryCandidate(
        {
          type: 'fact',
          normalizedKey: 'guess',
          content: '用户可能喜欢下雨',
          importance: 0.3,
          confidence: 0.4,
        },
        'automatic',
      ),
    ).toBeUndefined();
  });

  it('parses at most three validated automatic candidates', () => {
    const text = JSON.stringify([
      {
        type: 'preference',
        normalizedKey: 'color',
        content: '用户喜欢蓝色',
        importance: 0.8,
        confidence: 0.9,
      },
      {
        type: 'plan',
        normalizedKey: 'trip',
        content: '用户计划下个月去悉尼',
        importance: 0.7,
        confidence: 0.8,
      },
      {
        type: 'fact',
        normalizedKey: 'cat',
        content: '用户的猫叫团子',
        importance: 0.8,
        confidence: 0.9,
      },
      {
        type: 'fact',
        normalizedKey: 'fourth',
        content: '第四条不会写入',
        importance: 0.8,
        confidence: 0.9,
      },
    ]);
    expect(parseAutomaticMemoryCandidates(text)).toHaveLength(3);
  });
});
