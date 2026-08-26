export const CHARACTER_EMOTIONS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'shy',
  'playful',
] as const;

export type CharacterEmotion = (typeof CHARACTER_EMOTIONS)[number];

export interface CharacterReply {
  text: string;
  emotion: CharacterEmotion;
  action?: string;
}

const emotionSet = new Set<string>(CHARACTER_EMOTIONS);
const ACTION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_REPLY_LENGTH = 32_768;

export const CHARACTER_REPLY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    emotion: { type: 'string', enum: [...CHARACTER_EMOTIONS] },
    action: { type: ['string', 'null'] },
  },
  required: ['text', 'emotion', 'action'],
  additionalProperties: false,
};

const stripCodeFence = (value: string): string => {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
};

export const parseCharacterReply = (
  rawValue: string,
  allowedActions: readonly string[] = [],
): CharacterReply => {
  const fallback = stripCodeFence(rawValue).slice(0, MAX_REPLY_LENGTH).trim();
  try {
    const value = JSON.parse(fallback) as unknown;
    if (typeof value !== 'object' || value === null || !('text' in value)) {
      throw new Error('The character reply is not an object.');
    }

    const text = typeof value.text === 'string' ? value.text.trim().slice(0, MAX_REPLY_LENGTH) : '';
    if (!text) {
      throw new Error('The character reply text is empty.');
    }

    const emotion =
      'emotion' in value && typeof value.emotion === 'string' && emotionSet.has(value.emotion)
        ? (value.emotion as CharacterEmotion)
        : 'neutral';
    const requestedAction =
      'action' in value && typeof value.action === 'string' && ACTION_PATTERN.test(value.action)
        ? value.action
        : undefined;
    const action =
      requestedAction && allowedActions.includes(requestedAction) ? requestedAction : undefined;
    return { text, emotion, ...(action ? { action } : {}) };
  } catch {
    return {
      text: fallback || '……',
      emotion: 'neutral',
    };
  }
};

interface ExtractedJsonString {
  value: string;
  complete: boolean;
}

const extractJsonTextPrefix = (source: string): ExtractedJsonString | undefined => {
  const field = /"text"\s*:\s*"/.exec(source);
  if (!field || field.index === undefined) {
    return undefined;
  }

  let value = '';
  let index = field.index + field[0].length;
  while (index < source.length) {
    const character = source[index];
    if (character === '"') {
      return { value, complete: true };
    }
    if (character !== '\\') {
      value += character;
      index += 1;
      continue;
    }

    const escaped = source[index + 1];
    if (escaped === undefined) {
      break;
    }
    const simpleEscape: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    if (escaped in simpleEscape) {
      value += simpleEscape[escaped];
      index += 2;
      continue;
    }
    if (escaped === 'u') {
      const hexadecimal = source.slice(index + 2, index + 6);
      if (hexadecimal.length < 4) {
        break;
      }
      if (/^[0-9A-Fa-f]{4}$/.test(hexadecimal)) {
        value += String.fromCharCode(Number.parseInt(hexadecimal, 16));
      }
      index += 6;
      continue;
    }
    value += escaped;
    index += 2;
  }
  return { value, complete: false };
};

export class CharacterReplyStreamDecoder {
  private raw = '';
  private emittedText = '';
  private mode: 'unknown' | 'json' | 'plain' = 'unknown';

  public push(delta: string): string {
    this.raw = (this.raw + delta).slice(0, MAX_REPLY_LENGTH * 2);
    if (this.mode === 'unknown') {
      const first = this.raw.trimStart()[0];
      if (!first) {
        return '';
      }
      this.mode = first === '{' || first === '`' ? 'json' : 'plain';
    }

    const visible =
      this.mode === 'plain'
        ? this.raw
        : (extractJsonTextPrefix(stripCodeFence(this.raw))?.value ?? '');
    const next = visible.slice(this.emittedText.length);
    this.emittedText = visible;
    return next;
  }

  public finish(allowedActions: readonly string[] = []): {
    reply: CharacterReply;
    remainingText: string;
  } {
    const reply = parseCharacterReply(this.raw, allowedActions);
    const remainingText = reply.text.startsWith(this.emittedText)
      ? reply.text.slice(this.emittedText.length)
      : this.emittedText
        ? ''
        : reply.text;
    this.emittedText = reply.text;
    return { reply, remainingText };
  }

  public get visibleText(): string {
    return this.emittedText;
  }
}
