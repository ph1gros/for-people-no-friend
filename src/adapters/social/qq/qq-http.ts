import {
  cancelResponseBody,
  createSocialHttpToolkit,
  isDeclaredLengthAllowed,
  isSameDestination,
} from '../shared/social-http';

export const QQ_MAX_PAYLOAD_BYTES = 1024 * 1024;
export const QQ_HTTP_TIMEOUT_MS = 15_000;
export const QQ_OPERATION_TIMEOUT_MS = 90_000;
export const QQ_MAX_COOLDOWN_MS = 60_000;

const API_ORIGIN = 'https://api.sgroup.qq.com';
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const ERROR_MESSAGES = {
  cancelled: 'QQ operation cancelled.',
  timeout: 'QQ operation timed out.',
  input: 'Invalid QQ transport input.',
  response: 'Invalid QQ response.',
  size: 'QQ response exceeds the size limit.',
  request: 'QQ request failed.',
  rate: 'QQ request rate limited.',
  gateway: 'QQ gateway connection failed.',
  stopped: 'QQ transport is stopped or already started.',
} as const;

/** No remote text, abort reason, URL, identifier, or nested cause escapes this boundary. */
export class QqError extends Error {
  constructor(public readonly code: keyof typeof ERROR_MESSAGES) {
    super(ERROR_MESSAGES[code]);
    this.name = 'QqError';
  }
}

class HttpFailure extends QqError {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs = 1000,
  ) {
    super(status === 429 ? 'rate' : 'request');
  }
}

export interface QqCredentials {
  appId: string;
  appSecret: string;
}

export function isQqId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/u.test(value);
}

export function qqRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QqError('response');
  return value as Record<string, unknown>;
}

const toolkit = createSocialHttpToolkit(
  (fault) => new QqError(fault),
  (value) => value instanceof QqError,
);

export const assertQqActive = toolkit.assertActive;
export const withQqAbort = toolkit.withAbort;
export const qqDeadline = toolkit.deadline;

/** Cancellable wait used by the cooldown loop; aborting must reject so the loop cannot spin. */
export async function qqDelay(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new QqError('cancelled'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function retryAfter(value: string | null): number {
  if (!value || value.length > 128) return 1000;
  const seconds = /^\d+(?:\.\d+)?$/u.test(value) ? Number(value) : NaN;
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.max(1000, Math.min(QQ_MAX_COOLDOWN_MS, ms)) : 1000;
}

/** Fixed-origin, bounded JSON reader. Error bodies are discarded without reading them. */
async function fetchJson(
  fetcher: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  const deadline = qqDeadline(signal, QQ_HTTP_TIMEOUT_MS);
  let response: Response | undefined;
  try {
    assertQqActive(deadline.signal);
    const received = await withQqAbort(
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
    if (!isSameDestination(received, url)) throw new QqError('response');
    if (!isDeclaredLengthAllowed(received.headers.get('content-length'), QQ_MAX_PAYLOAD_BYTES)) {
      throw new QqError('size');
    }
    if (!received.ok)
      throw new HttpFailure(received.status, retryAfter(received.headers.get('retry-after')));
    // Ownership of the body moves to the bounded reader, which always releases it.
    response = undefined;
    return await toolkit.readBoundedJson(received, QQ_MAX_PAYLOAD_BYTES, deadline.signal);
  } catch (error) {
    deadline.abort();
    throw deadline.error(error);
  } finally {
    if (response) cancelResponseBody(response);
    deadline.dispose();
  }
}

interface TokenFlight {
  controller: AbortController;
  promise: Promise<string>;
  waiters: number;
}

/** Instance-local token/cache/cooldown state; never uses the SDK's network implementation. */
export class QqHttp {
  private readonly lifetime = new AbortController();
  private cached?: { token: string; refreshAt: number };
  private flight?: TokenFlight;
  private apiCooldownUntil = 0;
  private tokenCooldownUntil = 0;

  constructor(
    private readonly credentials: QqCredentials,
    private readonly fetcher: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  stop(): void {
    this.lifetime.abort();
    this.flight?.controller.abort();
    this.cached = undefined;
  }

  invalidateToken(rejectedToken?: string): void {
    // A delayed 401 from an old request must not evict a freshly refreshed token.
    if (!rejectedToken || this.cached?.token === rejectedToken) this.cached = undefined;
  }

  async getAccessToken(signal: AbortSignal): Promise<string> {
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    assertQqActive(combined);
    if (this.cached && Date.now() < this.cached.refreshAt) return this.cached.token;
    let flight = this.flight;
    if (!flight) {
      flight = { controller: new AbortController(), promise: Promise.resolve(''), waiters: 0 };
      const current = flight;
      this.flight = current;
      current.promise = this.fetchToken(
        AbortSignal.any([current.controller.signal, this.lifetime.signal]),
      ).finally(() => {
        if (this.flight === current) this.flight = undefined;
      });
    }
    flight.waiters++;
    try {
      // Preserve only our fixed errors while keeping caller cancellation independent.
      let failure: QqError | undefined;
      const token = await withQqAbort(
        flight.promise.catch((error: unknown) => {
          failure = error instanceof QqError ? error : new QqError('request');
          throw failure;
        }),
        combined,
      ).catch(() => {
        throw combined.aborted ? new QqError('cancelled') : (failure ?? new QqError('request'));
      });
      return token;
    } finally {
      flight.waiters--;
      if (flight.waiters === 0 && this.flight === flight) {
        this.flight = undefined;
        flight.controller.abort();
      }
    }
  }

  private async fetchToken(signal: AbortSignal): Promise<string> {
    const operation = qqDeadline(signal, QQ_OPERATION_TIMEOUT_MS);
    try {
      for (let attempt = 0; ; attempt++) {
        await this.waitCooldown('token', operation.signal);
        const requestedAt = Date.now();
        try {
          const data = qqRecord(
            await fetchJson(
              this.fetcher,
              TOKEN_URL,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  appId: this.credentials.appId,
                  clientSecret: this.credentials.appSecret,
                }),
              },
              operation.signal,
            ),
          );
          const ttl =
            typeof data.expires_in === 'string' && /^\d+$/u.test(data.expires_in)
              ? Number(data.expires_in)
              : data.expires_in;
          if (
            typeof data.access_token !== 'string' ||
            !/^[A-Za-z0-9._~+/=-]{1,8192}$/u.test(data.access_token) ||
            typeof ttl !== 'number' ||
            !Number.isFinite(ttl) ||
            ttl <= 0 ||
            ttl > 86_400
          ) {
            throw new QqError('response');
          }
          const refreshAt = requestedAt + ttl * 1000 - Math.min(30_000, ttl * 100);
          assertQqActive(operation.signal);
          if (refreshAt <= Date.now()) throw new QqError('response');
          this.cached = { token: data.access_token, refreshAt };
          return data.access_token;
        } catch (error) {
          if (!(error instanceof HttpFailure) || error.status !== 429) throw error;
          this.tokenCooldownUntil = Math.max(
            this.tokenCooldownUntil,
            Date.now() + error.retryAfterMs,
          );
          if (attempt >= 1) throw error;
        }
      }
    } catch (error) {
      throw operation.error(error);
    } finally {
      operation.dispose();
    }
  }

  private async waitCooldown(kind: 'api' | 'token', signal: AbortSignal): Promise<void> {
    while (true) {
      assertQqActive(signal);
      const delay = (kind === 'api' ? this.apiCooldownUntil : this.tokenCooldownUntil) - Date.now();
      if (delay <= 0) return;
      await qqDelay(delay, signal);
    }
  }

  async request(
    method: string,
    path: string,
    body: unknown,
    signal: AbortSignal,
    accessToken?: string,
  ): Promise<unknown> {
    if (!(
      (method === 'GET' && path === '/gateway') ||
      (method === 'POST' &&
        /^\/v2\/(?:users|groups)\/[A-Za-z0-9_-]{1,256}\/(?:messages|files)$/u.test(path))
    )) {
      throw new QqError('input');
    }
    const operation = qqDeadline(
      AbortSignal.any([signal, this.lifetime.signal]),
      QQ_OPERATION_TIMEOUT_MS,
    );
    try {
      // Serialize exactly once: retries must retain the original msg_seq and payload.
      const serialized = body === undefined ? undefined : JSON.stringify(body);
      if (serialized && Buffer.byteLength(serialized) > QQ_MAX_PAYLOAD_BYTES)
        throw new QqError('input');
      let token = accessToken;
      let refreshed = false;
      let retriedRateLimit = false;
      for (;;) {
        await this.waitCooldown('api', operation.signal);
        token ??= await this.getAccessToken(operation.signal);
        try {
          return await fetchJson(
            this.fetcher,
            `${API_ORIGIN}${path}`,
            {
              method,
              headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json' },
              body: serialized,
            },
            operation.signal,
          );
        } catch (error) {
          if (error instanceof HttpFailure && error.status === 401 && !refreshed) {
            refreshed = true;
            this.invalidateToken(token);
            token = undefined;
            continue;
          }
          if (error instanceof HttpFailure && error.status === 429) {
            this.apiCooldownUntil = Math.max(
              this.apiCooldownUntil,
              Date.now() + error.retryAfterMs,
            );
            if (!retriedRateLimit) {
              retriedRateLimit = true;
              continue;
            }
          }
          // In particular, never replay a POST after an ambiguous network/body failure.
          throw error;
        }
      }
    } catch (error) {
      throw operation.error(error);
    } finally {
      operation.dispose();
    }
  }
}
