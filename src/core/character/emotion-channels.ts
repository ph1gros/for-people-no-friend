/** Per-reply expression intensities, not a persisted relationship score. */
export const EMOTION_CHANNELS = [
  'joy',
  'sadness',
  'anger',
  'fear',
  'disgust',
  'surprise',
  'trust',
  'love',
  'longing',
  'guilt',
] as const;
export type EmotionChannel = (typeof EMOTION_CHANNELS)[number];
export type EmotionChannels = Readonly<Record<EmotionChannel, number>>;

export const parseEmotionChannels = (value: unknown): EmotionChannels => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid emotion channels.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !(EMOTION_CHANNELS as readonly string[]).includes(key)))
    throw new Error('Unknown emotion channel.');
  const result = {} as Record<EmotionChannel, number>;
  for (const channel of EMOTION_CHANNELS) {
    const intensity = Object.hasOwn(record, channel) ? record[channel] : 0;
    if (
      typeof intensity !== 'number' ||
      !Number.isFinite(intensity) ||
      intensity < 0 ||
      intensity > 1
    )
      throw new Error('Emotion intensity must be between zero and one.');
    result[channel] = intensity;
  }
  return Object.freeze(result);
};
