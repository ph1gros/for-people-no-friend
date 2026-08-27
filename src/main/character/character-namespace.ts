import { createHash } from 'node:crypto';

import type { CharacterProfile } from '../../core/conversation/character-profile';

const normalize = (value: string): string => value.normalize('NFKC').trim().toLowerCase();

export const resolveCharacterMemoryNamespace = (profile: CharacterProfile): string => {
  const canonicalName = normalize(profile.lore?.canonicalName ?? profile.name);
  const sourceWork = normalize(profile.lore?.sourceWork ?? '');
  if (
    profile.live2dModelId === 'local-model' &&
    canonicalName === '凯尔希' &&
    (sourceWork.includes('明日方舟') || sourceWork.includes('arknights'))
  ) {
    return 'character-kaltsit';
  }
  const fingerprint = [profile.live2dModelId, canonicalName, sourceWork].join('\0');
  const digest = createHash('sha256').update(fingerprint, 'utf8').digest('hex').slice(0, 24);
  return `character-${digest}`;
};
