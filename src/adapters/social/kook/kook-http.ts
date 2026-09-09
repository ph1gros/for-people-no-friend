import {
  cancelResponseBody,
  createSocialHttpToolkit,
  isDeclaredLengthAllowed,
  isSameDestination,
} from '../shared/social-http';

export const KOOK_API_ORIGIN = 'https://www.kookapp.cn';
export const KOOK_MAX_PAYLOAD_BYTES = 1024 * 1024;
export const KOOK_HTTP_TIMEOUT_MS = 15_000;
export const KOOK_OPERATION_TIMEOUT_MS = 90_000;
export const KOOK_MAX_COOLDOWN_MS = 60_000;

export type KookErrorKind =
  'input' | 'auth' | 'request' | 'response' | 'size' | 'timeout' | 'cancelled' | 'gateway';

/** Never carries a platform message: upstream text may embed credentials or user content. */
export class KookError extends Error {
  public constructor(public readonly kind: KookErrorKind) {
    super(`KOOK request failed: ${kind}`);
    this.name = 'KookError';
  }
}

/** KOOK bot tokens are opaque; only shape is validated, never the value or its origin. */
export const isKookToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 8 && value.length <= 512 && /^\S+$/u.test(value);

export const isKookId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,128}$/u.test(value);

export const kookRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const toolkit = createSocialHttpToolkit(
  (fault) => new KookError(fault),
  (value) => value instanceof KookError,
);

export const assertKookActive = toolkit.assertActive;
export const withKookAbort = toolkit.withAbort;
export const kookDeadline = toolkit.deadline;

const RETRY_AFTER_HEADERS = ['retry-after', 'x-rate-limit-reset'];

const cooldownFrom = (headers: Headers): number => {
  for (const name of RETRY_AFTER_HEADERS) {
    const raw = headers.get(name);
    if (!raw || !/^\d+$/u.test(raw)) continue;
    return Math.max(1_000, Math.min(KOOK_MAX_COOLDOWN_MS, Number(raw) * 1_000));
  }
  return 1_000;
};

/**
 * Fixed-origin, bounded JSON reader. Redirects are refused rather than followed, error bodies are
 * discarded unread, and the response is capped before it is parsed.
 */
const fetchKookJson = async (
  fetcher: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<{ payload: unknown; cooldownMs?: number }> => {
  const deadline = kookDeadline(signal, KOOK_HTTP_TIMEOUT_MS);
  let response: Response | undefined;
  try {
    assertKookActive(deadline.signal);
    const received = await withKookAbort(
      fetcher(url, {
        ...init,
        signal: deadline.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
      }).then((value) => {
        if (deadline.signal.aborted) cancelResponseBody(value);
        return value;
      }),
      deadline.signal,
    );
    response = received;
    if (!isSameDestination(received, url)) throw new KookError('response');
    if (received.status === 401 || received.status === 403) throw new KookError('auth');
    if (received.status === 429) {
      // Surface the cooldown instead of the body: the caller schedules the backoff.
      return { payload: undefined, cooldownMs: cooldownFrom(received.headers) };
    }
    if (!isDeclaredLengthAllowed(received.headers.get('content-length'), KOOK_MAX_PAYLOAD_BYTES)) {
      throw new KookError('size');
    }
    if (!received.ok) throw new KookError('request');
    // Ownership of the body moves to the bounded reader, which always releases it.
    response = undefined;
    return {
      payload: await toolkit.readBoundedJson(received, KOOK_MAX_PAYLOAD_BYTES, deadline.signal),
    };
  } catch (error) {
    deadline.abort();
    throw deadline.error(error);
  } finally {
    if (response) cancelResponseBody(response);
    deadline.dispose();
  }
};

const ALLOWED_PATHS = [
  /^\/api\/v3\/gateway\/index$/u,
  /^\/api\/v3\/message\/create$/u,
  /^\/api\/v3\/direct-message\/create$/u,
  /^\/api\/v3\/user\/me$/u,
  /^\/api\/v3\/voice\/join$/u,
  /^\/api\/v3\/voice\/keep-alive$/u,
  /^\/api\/v3\/voice\/leave$/u,
] as const;

/** Instance-local cooldown state. The bot token never leaves this class. */
export class KookHttp {
  private readonly lifetime = new AbortController();
  private cooldownUntil = 0;

  public constructor(
    private readonly token: string,
    private readonly fetcher: typeof globalThis.fetch = globalThis.fetch,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!isKookToken(token)) throw new KookError('input');
  }

  public stop(): void {
    this.lifetime.abort();
  }

  /**
   * Only the endpoints this adapter actually uses are reachable, and only with a query string the
   * caller cannot inject: paths and search params are both validated here, in Main.
   */
  public async request(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    signal: AbortSignal,
    search?: Record<string, string>,
  ): Promise<unknown> {
    if (!ALLOWED_PATHS.some((allowed) => allowed.test(path))) throw new KookError('input');
    const operation = kookDeadline(
      AbortSignal.any([signal, this.lifetime.signal]),
      KOOK_OPERATION_TIMEOUT_MS,
    );
    try {
      await this.waitCooldown(operation.signal);
      const url = new URL(path, KOOK_API_ORIGIN);
      for (const [key, value] of Object.entries(search ?? {})) {
        if (!/^[a-z_]{1,32}$/u.test(key) || !/^[A-Za-z0-9_-]{0,64}$/u.test(value)) {
          throw new KookError('input');
        }
        url.searchParams.set(key, value);
      }
      if (url.origin !== KOOK_API_ORIGIN) throw new KookError('input');

      const serialized = body === undefined ? undefined : JSON.stringify(body);
      if (serialized && Buffer.byteLength(serialized) > KOOK_MAX_PAYLOAD_BYTES) {
        throw new KookError('size');
      }
      const result = await fetchKookJson(
        this.fetcher,
        url.href,
        {
          method,
          headers: {
            Authorization: `Bot ${this.token}`,
            Accept: 'application/json',
            ...(serialized ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(serialized ? { body: serialized } : {}),
        },
        operation.signal,
      );
      if (result.cooldownMs !== undefined) {
        this.cooldownUntil = this.now() + result.cooldownMs;
        throw new KookError('request');
      }
      const envelope = kookRecord(result.payload);
      // KOOK reports application errors inside a 200 envelope.
      if (envelope.code !== 0) throw new KookError('response');
      return envelope.data;
    } catch (error) {
      throw operation.error(error);
    } finally {
      operation.dispose();
    }
  }

  private async waitCooldown(signal: AbortSignal): Promise<void> {
    const remaining = this.cooldownUntil - this.now();
    if (remaining <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
        Math.min(remaining, KOOK_MAX_COOLDOWN_MS),
      );
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new KookError('cancelled'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
