/**
 * Transport-safety primitives shared by every social platform client.
 *
 * Each platform keeps its own error class and its own status-code policy; what is shared here is
 * the part that must not be re-derived per platform: deadline and abort plumbing, and reading a
 * response body under a hard size cap. The error constructor is injected so `instanceof` checks
 * in platform code and tests keep working.
 */

/** The faults every platform client can raise. Platform-specific codes stay in that platform. */
export type SocialHttpFault = 'cancelled' | 'timeout' | 'response' | 'size' | 'request';

export type SocialHttpErrorFactory = (fault: SocialHttpFault) => Error;

export interface SocialDeadline {
  readonly signal: AbortSignal;
  abort(): void;
  /** Normalizes any thrown value into this platform's error type. */
  error(value: unknown): Error;
  dispose(): void;
}

export interface SocialHttpToolkit {
  assertActive(signal: AbortSignal): void;
  withAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T>;
  deadline(parent: AbortSignal, timeoutMs: number): SocialDeadline;
  /** Reads a JSON body with a hard byte cap, cancelling the stream on abort. */
  readBoundedJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown>;
}

export const cancelResponseBody = (response: Response): void => {
  void response.body?.cancel().catch(() => undefined);
};

export const createSocialHttpToolkit = (
  makeError: SocialHttpErrorFactory,
  isOwnError: (value: unknown) => boolean,
): SocialHttpToolkit => {
  const assertActive = (signal: AbortSignal): void => {
    if (signal.aborted) throw makeError('cancelled');
  };

  /** Also bounds mock implementations which do not honour an AbortSignal themselves. */
  const withAbort = <T>(pending: Promise<T>, signal: AbortSignal): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const abort = (): void => reject(makeError('cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      pending.then(
        (value) => {
          signal.removeEventListener('abort', abort);
          if (signal.aborted) abort();
          else resolve(value);
        },
        () => {
          signal.removeEventListener('abort', abort);
          reject(makeError('request'));
        },
      );
      if (signal.aborted) abort();
    });

  const deadline = (parent: AbortSignal, timeoutMs: number): SocialDeadline => {
    const controller = new AbortController();
    let timedOut = false;
    const abort = (): void => controller.abort();
    parent.addEventListener('abort', abort, { once: true });
    if (parent.aborted) abort();
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, timeoutMs);
    return {
      signal: controller.signal,
      abort,
      error(value: unknown): Error {
        // Cause order matters: an aborted parent outranks a timeout that fired on the way out.
        if (parent.aborted) return makeError('cancelled');
        if (timedOut) return makeError('timeout');
        return isOwnError(value) ? (value as Error) : makeError('request');
      },
      dispose(): void {
        clearTimeout(timer);
        parent.removeEventListener('abort', abort);
      },
    };
  };

  const readBoundedJson = async (
    response: Response,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<unknown> => {
    if (!response.body) throw makeError('response');
    const reader = response.body.getReader();
    try {
      // A single allocation also bounds memory when a peer streams millions of tiny chunks.
      const bytes = new Uint8Array(maxBytes);
      let length = 0;
      while (true) {
        const chunk = await withAbort(reader.read(), signal);
        if (chunk.done) break;
        if (chunk.value.byteLength > maxBytes - length) throw makeError('size');
        bytes.set(chunk.value, length);
        length += chunk.value.byteLength;
      }
      assertActive(signal);
      try {
        return JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)),
        );
      } catch {
        throw makeError('response');
      }
    } finally {
      void reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  };

  return { assertActive, withAbort, deadline, readBoundedJson };
};

/** Rejects a declared body length that is missing, malformed or over the cap. */
export const isDeclaredLengthAllowed = (declared: string | null, maxBytes: number): boolean =>
  declared === null || (/^\d+$/u.test(declared) && Number(declared) <= maxBytes);

/** A response that landed anywhere other than the requested URL is refused, never followed. */
export const isSameDestination = (response: Response, url: string): boolean =>
  !response.redirected && (!response.url || response.url === url);
