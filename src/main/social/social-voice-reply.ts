import { randomUUID } from 'node:crypto';

import type { SocialAudioPayload } from '../../core/social/social-contracts';
import type { SpeechService } from '../speech/speech-service';
import type { SocialVoiceCodec } from './social-voice-codec';

export interface SocialVoiceSynthesizer {
  /** Resolves undefined whenever the reply should stay text-only. Never throws. */
  synthesize(text: string, signal: AbortSignal): Promise<SocialAudioPayload | undefined>;
}

export interface SocialVoiceReplyOptions {
  speech: Pick<SpeechService, 'synthesize' | 'cancel'>;
  codec: SocialVoiceCodec;
  /** Read per reply, so toggling the setting takes effect without reconnecting the account. */
  isEnabled(): boolean;
}

/** The codec consumes PCM WAV; a provider configured for MP3 output simply stays on text. */
const WAV_MIME_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave']);

/**
 * Turns an assistant reply into a native voice clip: existing TTS produces WAV, the SILK codec
 * repackages it for the platform. Voice is an enhancement, never a requirement, so every failure
 * path — disabled, unsupported provider output, missing codec, cancellation — resolves to
 * undefined and the caller sends the text reply instead.
 */
export const createSocialVoiceSynthesizer = (
  options: SocialVoiceReplyOptions,
): SocialVoiceSynthesizer => ({
  async synthesize(text: string, signal: AbortSignal): Promise<SocialAudioPayload | undefined> {
    if (!options.isEnabled() || signal.aborted) return undefined;
    const spokenText = text.trim();
    if (!spokenText) return undefined;

    const requestId = `social_voice_${randomUUID()}`;
    const cancel = (): void => {
      options.speech.cancel(requestId);
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const spoken = await options.speech.synthesize({ requestId, text: spokenText });
      if (!spoken.ok || signal.aborted || !WAV_MIME_TYPES.has(spoken.mimeType)) return undefined;
      const clip = await options.codec.encodeFromWav(spoken.audio);
      if (!clip || signal.aborted) return undefined;
      return { mimeType: 'audio/silk', data: clip.data, durationMs: clip.durationMs };
    } catch {
      return undefined;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  },
});
