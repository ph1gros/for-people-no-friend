import type { Net } from 'electron';

/** Electron net.fetch rejects manual redirects instead of returning the 3xx response.
 * Expose that response with net.request so the downloader can validate its destination.
 * No redirect is followed here, and no session credentials are attached.
 */
export const createElectronResourceFetch =
  (network: Pick<Net, 'fetch' | 'request'>): typeof fetch =>
  async (input, init) => {
    if (init?.redirect !== 'manual')
      return network.fetch(input instanceof URL ? input.toString() : input, init);
    if (typeof input !== 'string' && !(input instanceof URL)) {
      throw new Error('资源请求地址无效。');
    }
    const address = new URL(input);
    if (
      address.origin !== 'https://github.com' ||
      address.username ||
      address.password ||
      address.hash ||
      !address.pathname.startsWith('/ph1gros/fpnf-resources/releases/download/') ||
      (init.method && init.method !== 'GET') ||
      init.body
    )
      throw new Error('资源请求地址无效。');
    init.signal?.throwIfAborted();
    return new Promise<Response>((resolve, reject) => {
      const request = network.request({
        url: address.toString(),
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: Object.fromEntries(new Headers(init.headers)),
      });
      let settled = false;
      const finish = (response?: Response, error?: Error): void => {
        if (settled) return;
        settled = true;
        init.signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(response!);
        request.abort();
      };
      const onAbort = (): void => finish(undefined, new Error('资源请求已取消。'));
      request.on('error', () => finish(undefined, new Error('资源下载连接失败。')));
      request.on('redirect', (status, _method, destination) => {
        try {
          finish(new Response(null, { status, headers: { location: destination } }));
        } catch {
          finish(undefined, new Error('资源仓库返回了无效的附件跳转。'));
        }
      });
      request.on('response', () => {
        finish(undefined, new Error('资源仓库没有返回预期的附件跳转。'));
      });
      init.signal?.addEventListener('abort', onAbort, { once: true });
      request.end();
    });
  };
