import { describe, expect, it } from 'vitest';

import {
  resolveAutomaticGlossarySourceWork,
  type CharacterResearchCandidate,
} from '../src/core/character/character-research';

const candidate = (sourceWork: string): CharacterResearchCandidate => ({
  id: `candidate-${sourceWork}`,
  name: '测试角色',
  sourceWork,
  description: '测试简介',
  sourceName: '本地测试来源',
  sourceUrl: 'http://127.0.0.1/character',
  matchReason: '名称匹配',
});

describe('automatic work glossary selection', () => {
  it('uses an explicitly entered work without consulting candidates', () => {
    expect(resolveAutomaticGlossarySourceWork('  缘之空  ', [candidate('其他作品')])).toBe(
      '缘之空',
    );
  });

  it('uses the inferred work only when all usable candidates agree', () => {
    expect(
      resolveAutomaticGlossarySourceWork('', [candidate('明日方舟'), candidate(' 明日方舟 ')]),
    ).toBe('明日方舟');
    expect(
      resolveAutomaticGlossarySourceWork('', [candidate('明日方舟'), candidate('新世纪福音战士')]),
    ).toBeUndefined();
  });

  it('does not start an automatic glossary lookup without a usable work name', () => {
    expect(
      resolveAutomaticGlossarySourceWork('', [candidate(''), candidate('  ')]),
    ).toBeUndefined();
  });
});
