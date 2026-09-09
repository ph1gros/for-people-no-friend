import {
  importQqProtocol,
  QqGateway,
  type QqGatewayHandlers,
  type QqWebSocketFactory,
} from './qq-gateway';
import {
  assertQqActive,
  isQqId,
  QqError,
  QqHttp,
  QQ_OPERATION_TIMEOUT_MS,
  qqDeadline,
  qqRecord,
  type QqCredentials,
} from './qq-http';

export interface QqTransport {
  start(signal: AbortSignal, handlers: QqGatewayHandlers): Promise<void>;
  sendText(
    target: { kind: 'c2c' | 'group'; id: string; messageId: string },
    text: string,
    signal: AbortSignal,
  ): Promise<{ id: string; refIdx?: string }>;
  sendVoice(
    target: { kind: 'c2c' | 'group'; id: string; messageId: string },
    voice: Uint8Array,
    signal: AbortSignal,
  ): Promise<{ id: string }>;
  stop(): void;
}

/** Matches the codec cap: the clip is uploaded as base64 inside the 1 MB QQ payload limit. */
const MAX_VOICE_BYTES = 512 * 1_024;
const MAX_FILE_INFO_LENGTH = 8_192;

/** Main-process dependency injection only. Production endpoints are not configurable. */
export interface QqTransportDependencies {
  fetch?: typeof globalThis.fetch;
  webSocketFactory?: QqWebSocketFactory;
}

export async function createQqTransport(credentials: QqCredentials): Promise<QqTransport> {
  return createQqTransportWithDependencies(credentials);
}

/** Test seam, kept separate from the production factory's public signature. */
export async function createQqTransportWithDependencies(
  credentials: QqCredentials,
  dependencies: QqTransportDependencies = {},
): Promise<QqTransport> {
  if (
    !credentials ||
    typeof credentials.appId !== 'string' ||
    !/^\d{1,32}$/u.test(credentials.appId) ||
    typeof credentials.appSecret !== 'string' ||
    !/^[\x21-\x7E]{1,256}$/u.test(credentials.appSecret)
  ) {
    throw new QqError('input');
  }
  const sdk = await importQqProtocol().catch(() => {
    throw new QqError('request');
  });
  const creds = { appId: credentials.appId, appSecret: credentials.appSecret };
  const http = new QqHttp(creds, dependencies.fetch);
  const gateway = new QqGateway(sdk, http, dependencies.webSocketFactory);
  const lifetime = new AbortController();
  let started = false;
  let detachAbort: (() => void) | undefined;

  // Per-call subclasses capture the current call's signal; concurrent sends cannot overwrite it.
  const boundSdk = (operation: { signal: AbortSignal }) => {
    class BoundedTokens extends sdk.TokenManager {
      override getAccessToken(): Promise<string> {
        return http.getAccessToken(operation.signal);
      }
    }
    class BoundedClient extends sdk.ApiClient {
      override async request<T = unknown>(
        token: string,
        method: string,
        path: string,
        body?: unknown,
      ): Promise<T> {
        return (await http.request(method, path, body, operation.signal, token)) as T;
      }
    }
    return { client: new BoundedClient(), tokens: new BoundedTokens() };
  };

  const stop = () => {
    lifetime.abort();
    detachAbort?.();
    detachAbort = undefined;
    http.stop();
    gateway.stop();
  };

  return {
    async start(signal, handlers) {
      if (started || lifetime.signal.aborted) throw new QqError('stopped');
      started = true;
      signal.addEventListener('abort', stop, { once: true });
      detachAbort = () => signal.removeEventListener('abort', stop);
      if (signal.aborted) stop();
      try {
        await gateway.start(lifetime.signal, handlers);
      } catch (error) {
        stop();
        throw error instanceof QqError ? error : new QqError('gateway');
      }
    },
    async sendText(target, text, signal) {
      if (
        !target ||
        (target.kind !== 'c2c' && target.kind !== 'group') ||
        !isQqId(target.id) ||
        !isQqId(target.messageId) ||
        typeof text !== 'string' ||
        !text.trim() ||
        text.length > 16_384 ||
        Buffer.byteLength(text) > 16_384
      )
        throw new QqError('input');
      const operation = qqDeadline(
        AbortSignal.any([signal, lifetime.signal]),
        QQ_OPERATION_TIMEOUT_MS,
      );
      try {
        assertQqActive(operation.signal);
        const bound = boundSdk(operation);
        const api = new sdk.MessageApi(bound.client, bound.tokens, { markdownSupport: false });
        const result = qqRecord(
          await api.sendMessage(
            target.kind,
            target.id,
            text,
            { appId: creds.appId, clientSecret: creds.appSecret },
            { msgId: target.messageId },
          ),
        );
        if (!isQqId(result.id)) throw new QqError('response');
        const refIdx =
          result.ext_info === undefined ? undefined : qqRecord(result.ext_info).ref_idx;
        if (refIdx !== undefined && !isQqId(refIdx)) throw new QqError('response');
        assertQqActive(operation.signal);
        return { id: result.id, ...(refIdx === undefined ? {} : { refIdx }) };
      } catch (error) {
        throw operation.error(error);
      } finally {
        operation.dispose();
      }
    },
    async sendVoice(target, voice, signal) {
      if (
        !target ||
        (target.kind !== 'c2c' && target.kind !== 'group') ||
        !isQqId(target.id) ||
        !isQqId(target.messageId) ||
        !(voice instanceof Uint8Array) ||
        voice.byteLength === 0 ||
        voice.byteLength > MAX_VOICE_BYTES
      )
        throw new QqError('input');
      const operation = qqDeadline(
        AbortSignal.any([signal, lifetime.signal]),
        QQ_OPERATION_TIMEOUT_MS,
      );
      try {
        assertQqActive(operation.signal);
        const bound = boundSdk(operation);
        const media = new sdk.MediaApi(bound.client, bound.tokens);
        const credentials = { appId: creds.appId, clientSecret: creds.appSecret };
        // Upload first, then reference the stored file: srvSendMsg would post it behind our back.
        const upload = qqRecord(
          await media.uploadMedia(target.kind, target.id, sdk.MediaFileType.VOICE, credentials, {
            buffer: Buffer.from(voice),
            srvSendMsg: false,
          }),
        );
        const fileInfo = upload.file_info;
        if (typeof fileInfo !== 'string' || !fileInfo || fileInfo.length > MAX_FILE_INFO_LENGTH) {
          throw new QqError('response');
        }
        assertQqActive(operation.signal);
        const result = qqRecord(
          await media.sendMediaMessage(target.kind, target.id, fileInfo, credentials, {
            msgId: target.messageId,
          }),
        );
        if (!isQqId(result.id)) throw new QqError('response');
        assertQqActive(operation.signal);
        return { id: result.id };
      } catch (error) {
        throw operation.error(error);
      } finally {
        operation.dispose();
      }
    },
    stop,
  };
}
