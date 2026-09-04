import { EventEmitter } from 'node:events';
import type { Net } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createElectronResourceFetch } from '../src/main/resources/electron-resource-fetch';
import { fetchSpeechAssetArchive } from '../src/main/speech/speech-asset-fetch';

const source =
  'https://github.com/ph1gros/fpnf-resources/releases/download/components-v1.8.0/test.zip';
const setup = () => {
  const request = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    abort: vi.fn(),
    followRedirect: vi.fn(),
  });
  const network = {
    request: vi.fn(() => request),
    fetch: vi.fn(async () => new Response('data', { status: 206 })),
  };
  return {
    request,
    network,
    fetcher: createElectronResourceFetch(network as unknown as Pick<Net, 'fetch' | 'request'>),
  };
};
describe('Electron resource transport', () => {
  it('exposes a redirect for validation without following it in Electron', async () => {
    const { request, network, fetcher } = setup();
    const pending = fetchSpeechAssetArchive(source, { headers: { range: 'bytes=0-3' } }, fetcher);
    request.emit('redirect', 302, 'GET', 'https://release-assets.githubusercontent.com/test');
    expect((await pending).status).toBe(206);
    expect(network.request).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'manual',
        headers: { range: 'bytes=0-3' },
      }),
    );
    expect(request.followRedirect).not.toHaveBeenCalled();
    expect(request.abort).toHaveBeenCalledOnce();
    expect(network.fetch).toHaveBeenCalledWith(
      'https://release-assets.githubusercontent.com/test',
      expect.objectContaining({ redirect: 'error' }),
    );
  });
  it('refuses a redirect to another origin before issuing a second request', async () => {
    const { request, network, fetcher } = setup();
    const pending = fetchSpeechAssetArchive(source, {}, fetcher);
    request.emit('redirect', 302, 'GET', 'https://example.com/other');
    await expect(pending).rejects.toThrow('来源');
    expect(network.fetch).not.toHaveBeenCalled();
  });
  it('aborts a pending probe when cancelled and does not start pre-aborted requests', async () => {
    const { request, network, fetcher } = setup();
    const controller = new AbortController();
    const pending = fetcher(source, { redirect: 'manual', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('取消');
    expect(request.abort).toHaveBeenCalledOnce();
    await expect(
      fetcher(source, { redirect: 'manual', signal: controller.signal }),
    ).rejects.toThrow();
    expect(network.request).toHaveBeenCalledOnce();
  });
});
