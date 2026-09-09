import { describe, expect, it } from 'vitest';

import {
  SOCIAL_MAX_AUDIO_BYTES,
  SOCIAL_MAX_TEXT_LENGTH,
} from '../src/core/social/social-contracts';
import {
  parseSocialMessage,
  parseSocialTarget,
  sanitizeSocialText,
} from '../src/core/social/social-message';

const validMessage = () => ({
  messageId: 'msg-1',
  target: { platform: 'qq', channelKind: 'group', channelId: 'group-1', serverId: 'guild-1' },
  userId: 'user-1',
  displayName: 'Somebody',
  text: 'hello there',
  mentionsCharacter: true,
  receivedAt: 1_700_000_000_000,
});

describe('social message parsing', () => {
  it('narrows a well formed platform event and keeps only known fields', () => {
    const parsed = parseSocialMessage({ ...validMessage(), unexpected: 'dropped' });

    expect(parsed).toEqual({
      messageId: 'msg-1',
      target: { platform: 'qq', channelKind: 'group', channelId: 'group-1', serverId: 'guild-1' },
      userId: 'user-1',
      displayName: 'Somebody',
      text: 'hello there',
      mentionsCharacter: true,
      receivedAt: 1_700_000_000_000,
    });
    expect('unexpected' in parsed).toBe(false);
  });

  it('strips control characters and clamps oversized text', () => {
    const parsed = parseSocialMessage({
      ...validMessage(),
      text: `line\u0000one\r\nline two${'x'.repeat(SOCIAL_MAX_TEXT_LENGTH)}`,
    });

    expect(parsed.text).not.toContain('\u0000');
    expect(parsed.text).toContain('lineone\nline two');
    expect(parsed.text?.length).toBe(SOCIAL_MAX_TEXT_LENGTH);
  });

  it('rejects malformed identifiers, timestamps and channel kinds', () => {
    expect(() => parseSocialMessage({ ...validMessage(), messageId: 'bad id/../x' })).toThrow();
    expect(() => parseSocialMessage({ ...validMessage(), userId: '' })).toThrow();
    expect(() => parseSocialMessage({ ...validMessage(), receivedAt: Number.NaN })).toThrow();
    expect(() => parseSocialMessage({ ...validMessage(), mentionsCharacter: 'yes' })).toThrow();
    expect(() =>
      parseSocialMessage({
        ...validMessage(),
        target: { platform: 'discord', channelKind: 'group', channelId: 'c' },
      }),
    ).toThrow();
    expect(() =>
      parseSocialMessage({
        ...validMessage(),
        target: { platform: 'qq', channelKind: 'voice', channelId: 'c' },
      }),
    ).toThrow();
  });

  it('requires at least one payload and rejects whitespace only text', () => {
    const withoutText: Record<string, unknown> = { ...validMessage() };
    delete withoutText.text;

    expect(() => parseSocialMessage(withoutText)).toThrow();
    expect(() => parseSocialMessage({ ...validMessage(), text: '   \n  ' })).toThrow();
  });

  it('accepts allowed audio and rejects unknown or oversized audio', () => {
    const parsed = parseSocialMessage({
      messageId: 'msg-2',
      target: { platform: 'qq', channelKind: 'direct', channelId: 'dm-1' },
      userId: 'user-1',
      mentionsCharacter: false,
      receivedAt: 1_700_000_000_000,
      audio: { mimeType: 'audio/silk', data: new Uint8Array([1, 2, 3]), durationMs: 1_200 },
    });
    expect(parsed.audio?.mimeType).toBe('audio/silk');
    expect(parsed.audio?.durationMs).toBe(1_200);

    expect(() =>
      parseSocialMessage({
        ...validMessage(),
        audio: { mimeType: 'application/octet-stream', data: new Uint8Array([1]) },
      }),
    ).toThrow();
    expect(() =>
      parseSocialMessage({
        ...validMessage(),
        audio: { mimeType: 'audio/wav', data: new Uint8Array(SOCIAL_MAX_AUDIO_BYTES + 1) },
      }),
    ).toThrow();
    expect(() =>
      parseSocialMessage({
        ...validMessage(),
        audio: { mimeType: 'audio/wav', data: [1, 2, 3] },
      }),
    ).toThrow();
  });

  it('parses targets independently and rejects non objects', () => {
    expect(
      parseSocialTarget({ platform: 'kook', channelKind: 'channel', channelId: 'c1' }),
    ).toEqual({ platform: 'kook', channelKind: 'channel', channelId: 'c1' });
    expect(() => parseSocialTarget(null)).toThrow();
    expect(() => parseSocialTarget([])).toThrow();
  });

  it('sanitizes text consistently for inbound and outbound values', () => {
    expect(sanitizeSocialText('  padded\u007f text  ')).toBe('padded text');
    expect(sanitizeSocialText('a'.repeat(SOCIAL_MAX_TEXT_LENGTH + 50)).length).toBe(
      SOCIAL_MAX_TEXT_LENGTH,
    );
  });
});
