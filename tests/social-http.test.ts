import { describe, expect, it, vi } from 'vitest';

import {
  cancelResponseBody,
  createSocialHttpToolkit,
  isDeclaredLengthAllowed,
  isSameDestination,
  type SocialHttpFault,
} from '../src/adapters/social/shared/social-http';

class TestError extends Error {
  public constructor(public readonly fault: SocialHttpFault) {
    super(`test:${fault}`);
    this.name = 'TestError';
  }
}

const toolkit = createSocialHttpToolkit(
  (fault) => new TestError(fault),
  (value) => value instanceof TestError,
);

const aborted = (): AbortSignal => AbortSignal.abort();
const live = (): AbortSignal => new AbortController().signal;

const streamOf = (chunks: Uint8Array[]): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  );

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('shared social HTTP toolkit', () => {
  it('raises the platform error type for an already aborted signal', () => {
    expect(() => toolkit.assertActive(aborted())).toThrow(TestError);
    expect(() => toolkit.assertActive(live())).not.toThrow();
  });

  it('rejects a pending promise once the signal aborts', async () => {
    const controller = new AbortController();
    const pending = toolkit.withAbort(new Promise(() => {}), controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ fault: 'cancelled' });
  });

  it('maps an upstream rejection to a request fault without echoing it', async () => {
    const failure = toolkit.withAbort(
      Promise.reject(new Error('socket died at 10.0.0.1 with token abc')),
      live(),
    );

    const error = await failure.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(TestError);
    expect((error as Error).message).not.toContain('10.0.0.1');
    expect((error as Error).message).not.toContain('abc');
  });

  it('resolves a value that settles before any abort', async () => {
    await expect(toolkit.withAbort(Promise.resolve(7), live())).resolves.toBe(7);
  });

  it('classifies a timeout, a parent abort and an own error distinctly', async () => {
    vi.useFakeTimers();
    try {
      const parent = new AbortController();
      const deadline = toolkit.deadline(parent.signal, 1_000);
      expect(deadline.error(new TestError('response'))).toMatchObject({ fault: 'response' });
      expect(deadline.error(new Error('raw'))).toMatchObject({ fault: 'request' });

      vi.advanceTimersByTime(1_001);
      expect(deadline.signal.aborted).toBe(true);
      expect(deadline.error(new Error('raw'))).toMatchObject({ fault: 'timeout' });
      deadline.dispose();

      // A cancelled parent outranks a timeout that fired on the way out.
      const cancelled = new AbortController();
      const second = toolkit.deadline(cancelled.signal, 1_000);
      cancelled.abort();
      vi.advanceTimersByTime(1_001);
      expect(second.error(new Error('raw'))).toMatchObject({ fault: 'cancelled' });
      second.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts immediately when the parent signal was already aborted', () => {
    const deadline = toolkit.deadline(aborted(), 1_000);
    expect(deadline.signal.aborted).toBe(true);
    deadline.dispose();
  });

  it('reads a bounded JSON body', async () => {
    await expect(
      toolkit.readBoundedJson(streamOf([bytes('{"ok":'), bytes('true}')]), 1_024, live()),
    ).resolves.toEqual({ ok: true });
  });

  it('refuses a body that exceeds the cap mid-stream', async () => {
    const response = streamOf([bytes('a'.repeat(8)), bytes('b'.repeat(8))]);

    await expect(toolkit.readBoundedJson(response, 10, live())).rejects.toMatchObject({
      fault: 'size',
    });
  });

  it('refuses malformed JSON and invalid UTF-8 rather than guessing', async () => {
    await expect(
      toolkit.readBoundedJson(streamOf([bytes('{not json')]), 1_024, live()),
    ).rejects.toMatchObject({ fault: 'response' });

    await expect(
      toolkit.readBoundedJson(streamOf([Uint8Array.from([0xff, 0xfe, 0xfd])]), 1_024, live()),
    ).rejects.toMatchObject({ fault: 'response' });
  });

  it('refuses a response without a body', async () => {
    await expect(
      toolkit.readBoundedJson(new Response(null, { status: 204 }), 1_024, live()),
    ).rejects.toMatchObject({ fault: 'response' });
  });

  it('stops reading when the signal aborts', async () => {
    const controller = new AbortController();
    const response = new Response(
      new ReadableStream({
        start(streamController) {
          streamController.enqueue(bytes('{'));
          // Never closed: only the abort can end this read.
        },
      }),
    );

    const pending = toolkit.readBoundedJson(response, 1_024, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ fault: 'cancelled' });
  });

  it('bounds the declared content length', () => {
    expect(isDeclaredLengthAllowed(null, 100)).toBe(true);
    expect(isDeclaredLengthAllowed('100', 100)).toBe(true);
    expect(isDeclaredLengthAllowed('101', 100)).toBe(false);
    expect(isDeclaredLengthAllowed('-1', 100)).toBe(false);
    expect(isDeclaredLengthAllowed('1e3', 100)).toBe(false);
    expect(isDeclaredLengthAllowed(' 10', 100)).toBe(false);
  });

  it('treats a redirect or a different landing URL as a different destination', () => {
    const url = 'https://example.invalid/a';
    const at = (value: string, redirected = false): Response => {
      // `Response.redirect` cannot model this: it marks a redirect response, not a followed one.
      const response = new Response('{}', { status: 200 });
      Object.defineProperty(response, 'url', { value });
      Object.defineProperty(response, 'redirected', { value: redirected });
      return response;
    };

    expect(isSameDestination(at(url), url)).toBe(true);
    expect(isSameDestination(at(''), url)).toBe(true);
    // Belt and braces behind `redirect: 'error'`: a fetch that followed anyway is still refused.
    expect(isSameDestination(at(url, true), url)).toBe(false);
    expect(isSameDestination(at('https://evil.invalid'), url)).toBe(false);
  });

  it('cancels a response body without throwing on an already consumed one', async () => {
    const response = new Response('{}');
    expect(() => cancelResponseBody(response)).not.toThrow();
    // A second cancel on the same body must stay silent as well.
    expect(() => cancelResponseBody(response)).not.toThrow();
  });
});
