import { describe, expect, it, vi } from 'vitest';

import {
  KOOK_API_ORIGIN,
  KOOK_MAX_PAYLOAD_BYTES,
  KookError,
  KookHttp,
  isKookToken,
} from '../src/adapters/social/kook/kook-http';

const TOKEN = 'fake-kook-token-for-tests';

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

const client = (
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  now: () => number = () => 1_800_000_000_000,
) => {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? {}),
  );
  return { http: new KookHttp(TOKEN, fetcher as unknown as typeof fetch, now), fetcher };
};

const live = (): AbortSignal => new AbortController().signal;

describe('KOOK HTTP client', () => {
  it('rejects a malformed token before any request is made', () => {
    expect(isKookToken('ok-token-value')).toBe(true);
    expect(isKookToken('short')).toBe(false);
    expect(isKookToken('has space')).toBe(false);
    expect(() => new KookHttp('short')).toThrow(KookError);
  });

  it('calls the fixed origin with the bot credential and unwraps the envelope', async () => {
    const { http, fetcher } = client(() =>
      json({ code: 0, message: '', data: { url: 'wss://x' } }),
    );

    const data = await http.request('GET', '/api/v3/gateway/index', undefined, live(), {
      compress: '0',
    });

    expect(data).toEqual({ url: 'wss://x' });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${KOOK_API_ORIGIN}/api/v3/gateway/index?compress=0`);
    expect((init?.headers as Record<string, string>)?.Authorization).toBe(`Bot ${TOKEN}`);
    expect(init?.redirect).toBe('error');
    expect(init?.credentials).toBe('omit');
  });

  it('refuses endpoints outside the allowlist', async () => {
    const { http, fetcher } = client(() => json({ code: 0, data: {} }));

    await expect(http.request('GET', '/api/v3/guild/list', undefined, live())).rejects.toThrow(
      KookError,
    );
    await expect(
      http.request('POST', '/api/v3/message/create/../../evil', undefined, live()),
    ).rejects.toThrow(KookError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses query parameters it did not define', async () => {
    const { http, fetcher } = client(() => json({ code: 0, data: {} }));

    await expect(
      http.request('GET', '/api/v3/gateway/index', undefined, live(), { 'bad key': '1' }),
    ).rejects.toThrow(KookError);
    await expect(
      http.request('GET', '/api/v3/gateway/index', undefined, live(), { compress: 'a b' }),
    ).rejects.toThrow(KookError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('treats an application-level error envelope as a failure', async () => {
    const { http } = client(() => json({ code: 40100, message: 'token expired', data: null }));

    await expect(
      http.request('POST', '/api/v3/message/create', { target_id: 'c' }, live()),
    ).rejects.toThrow(KookError);
  });

  it('maps authentication failures to their own error kind', async () => {
    const { http } = client(() => json({}, { status: 401 }));

    await expect(http.request('GET', '/api/v3/user/me', undefined, live())).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('refuses a redirected response instead of following it', async () => {
    const { http } = client(
      () =>
        new Response(JSON.stringify({ code: 0, data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json', location: 'https://evil.invalid' },
        }),
    );
    // A fetch implementation that silently landed elsewhere is rejected by URL comparison.
    const moved = client(() => Response.redirect('https://evil.invalid', 302));

    await expect(http.request('GET', '/api/v3/user/me', undefined, live())).resolves.toEqual({});
    await expect(moved.http.request('GET', '/api/v3/user/me', undefined, live())).rejects.toThrow(
      KookError,
    );
  });

  it('rejects an oversized declared body', async () => {
    const { http } = client(() =>
      json(
        { code: 0, data: {} },
        { headers: { 'content-length': String(KOOK_MAX_PAYLOAD_BYTES + 1) } },
      ),
    );

    await expect(http.request('GET', '/api/v3/user/me', undefined, live())).rejects.toMatchObject({
      kind: 'size',
    });
  });

  it('records a cooldown after a rate limit and waits before the next call', async () => {
    let clock = 1_800_000_000_000;
    let calls = 0;
    const { http, fetcher } = client(
      () => {
        calls += 1;
        return calls === 1
          ? json({}, { status: 429, headers: { 'retry-after': '2' } })
          : json({ code: 0, data: { ok: true } });
      },
      () => clock,
    );

    await expect(http.request('GET', '/api/v3/user/me', undefined, live())).rejects.toThrow(
      KookError,
    );
    // The cooldown has elapsed by the time the caller retries, so the next call proceeds.
    clock += 5_000;
    await expect(http.request('GET', '/api/v3/user/me', undefined, live())).resolves.toEqual({
      ok: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('never puts the token into a thrown error', async () => {
    const { http } = client(() => {
      throw new Error(`network died while sending Bot ${TOKEN}`);
    });

    const error = await http
      .request('GET', '/api/v3/user/me', undefined, live())
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(KookError);
    expect(JSON.stringify({ message: (error as Error).message })).not.toContain(TOKEN);
  });

  it('stops serving requests once the client is stopped', async () => {
    const { http } = client(() => json({ code: 0, data: {} }));
    http.stop();

    await expect(http.request('GET', '/api/v3/user/me', undefined, live())).rejects.toMatchObject({
      kind: 'cancelled',
    });
  });
});
