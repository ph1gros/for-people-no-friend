import {
  KookError,
  KookHttp,
  KOOK_OPERATION_TIMEOUT_MS,
  assertKookActive,
  isKookId,
  isKookToken,
  kookDeadline,
  kookRecord,
} from './kook-http';
import { KookGateway, type KookGatewayHandlers, type KookWebSocketFactory } from './kook-gateway';
import { KookVoiceChannel, type KookVoiceHandle, type KookVoiceOptions } from './kook-voice';

export type KookTargetKind = 'direct' | 'channel';

export interface KookTransport {
  start(signal: AbortSignal, handlers: KookGatewayHandlers): Promise<void>;
  sendText(
    target: { kind: KookTargetKind; id: string },
    text: string,
    signal: AbortSignal,
  ): Promise<{ id: string }>;
  /** Joins a voice room; the returned handle accepts explicit PCM WAV playback. */
  joinVoice(channelId: string, signal: AbortSignal): Promise<KookVoiceHandle>;
  stop(): void;
}

/** Main-process dependency injection only. Production endpoints are not configurable. */
export interface KookTransportDependencies {
  fetch?: typeof globalThis.fetch;
  webSocketFactory?: KookWebSocketFactory;
  now?: () => number;
  voice?: KookVoiceOptions;
}

const MAX_TEXT_BYTES = 16_384;

export function createKookTransport(token: string): KookTransport {
  return createKookTransportWithDependencies(token);
}

/** Test seam, kept separate from the production factory's public signature. */
export function createKookTransportWithDependencies(
  token: string,
  dependencies: KookTransportDependencies = {},
): KookTransport {
  if (!isKookToken(token)) throw new KookError('input');
  const http = new KookHttp(token, dependencies.fetch, dependencies.now);
  const gateway = new KookGateway(http, dependencies.webSocketFactory);
  const voice = new KookVoiceChannel(http, dependencies.voice);
  const lifetime = new AbortController();
  let started = false;

  const stop = (): void => {
    // Leave the room before the HTTP client shuts down, so the platform is told explicitly.
    void voice.leave().finally(() => http.stop());
    lifetime.abort();
    gateway.stop();
  };

  return {
    async start(signal, handlers) {
      if (started) throw new KookError('gateway');
      started = true;
      try {
        await gateway.start(AbortSignal.any([signal, lifetime.signal]), handlers);
      } catch (error) {
        stop();
        throw error instanceof KookError ? error : new KookError('gateway');
      }
    },
    async sendText(target, text, signal) {
      if (
        !target ||
        (target.kind !== 'direct' && target.kind !== 'channel') ||
        !isKookId(target.id) ||
        typeof text !== 'string' ||
        !text.trim() ||
        Buffer.byteLength(text) > MAX_TEXT_BYTES
      ) {
        throw new KookError('input');
      }
      const operation = kookDeadline(
        AbortSignal.any([signal, lifetime.signal]),
        KOOK_OPERATION_TIMEOUT_MS,
      );
      try {
        assertKookActive(operation.signal);
        const path =
          target.kind === 'direct' ? '/api/v3/direct-message/create' : '/api/v3/message/create';
        const result = kookRecord(
          await http.request(
            'POST',
            path,
            // Type 1 is plain text: KMarkdown would let model output become platform markup.
            { type: 1, target_id: target.id, content: text },
            operation.signal,
          ),
        );
        if (!isKookId(result.msg_id)) throw new KookError('response');
        assertKookActive(operation.signal);
        return { id: result.msg_id };
      } catch (error) {
        throw operation.error(error);
      } finally {
        operation.dispose();
      }
    },
    async joinVoice(channelId, signal) {
      return voice.join(channelId, AbortSignal.any([signal, lifetime.signal]));
    },
    stop,
  };
}
