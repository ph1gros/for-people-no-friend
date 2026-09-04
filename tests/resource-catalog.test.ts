import { describe, expect, it, vi } from 'vitest';
import catalogTemplate from '../resources/resource-catalog/catalog.json';

import {
  BUNDLED_RESOURCE_CATALOG,
  RESOURCE_DEFINITIONS,
  parseResourceCatalog,
} from '../src/shared/resource-catalog';
import { ResourceCenter, fetchResourceCatalog } from '../src/main/resources/resource-center';

const downloads = { sourceConfigured: false, metered: false, busy: false, tiers: [] };

describe('resource catalog', () => {
  it('accepts display metadata without authorizing installation', () => {
    expect(parseResourceCatalog(catalogTemplate)).toEqual(BUNDLED_RESOURCE_CATALOG);
    expect(parseResourceCatalog(BUNDLED_RESOURCE_CATALOG)).toEqual(BUNDLED_RESOURCE_CATALOG);
    expect(RESOURCE_DEFINITIONS['voice-ireina'].category).toBe('voice');
    expect(RESOURCE_DEFINITIONS['bert-japanese'].category).toBe('base');
    expect(RESOURCE_DEFINITIONS['genie-tts'].installTier).toBe('genie-tts');
    for (const extra of [
      { sha256: 'a'.repeat(64) },
      { urls: ['https://example.com/a.zip'] },
      { target: '../outside' },
    ]) {
      expect(() =>
        parseResourceCatalog({
          ...BUNDLED_RESOURCE_CATALOG,
          resources: [{ ...BUNDLED_RESOURCE_CATALOG.resources[0], ...extra }],
        }),
      ).toThrow();
    }
    expect(() => parseResourceCatalog({ ...BUNDLED_RESOURCE_CATALOG, extra: true })).toThrow();
  });

  it('rejects unknown IDs, duplicate IDs, oversized text and invalid versions', () => {
    const first = BUNDLED_RESOURCE_CATALOG.resources[0]!;
    for (const entry of [
      { ...first, id: 'script' },
      { ...first, summary: 'x'.repeat(601) },
      { ...first, latestVersion: '../../bad' },
    ]) {
      expect(() => parseResourceCatalog({ schemaVersion: 1, resources: [entry] })).toThrow();
    }
    expect(() => parseResourceCatalog({ schemaVersion: 1, resources: [first, first] })).toThrow();
  });

  it('limits network metadata and refuses redirects and non-local HTTP', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(BUNDLED_RESOURCE_CATALOG)));
    await expect(
      fetchResourceCatalog('http://example.com/catalog.json', { fetch: fetcher }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      fetchResourceCatalog('https://example.com/catalog.json', { fetch: fetcher }),
    ).resolves.toEqual(BUNDLED_RESOURCE_CATALOG);
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/catalog.json',
      expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }),
    );
    const oversized = vi.fn(async () => new Response('x'.repeat(128 * 1024 + 1)));
    await expect(
      fetchResourceCatalog('https://example.com/catalog.json', { fetch: oversized }),
    ).rejects.toThrow('过大');
  });

  it('keeps bundled resources visible without a configured source', async () => {
    const getStatus = vi.fn(async () => downloads);
    const refreshManifest = vi.fn(async () => downloads);
    const center = new ResourceCenter({ getStatus, refreshManifest });
    expect(await center.getStatus()).toMatchObject({
      catalog: BUNDLED_RESOURCE_CATALOG,
      catalogSource: 'bundled',
      downloads,
    });
    expect(refreshManifest).not.toHaveBeenCalled();
    center.dispose();
  });

  it('refreshes metadata explicitly, retains the last good catalog on failure and never installs', async () => {
    const remote = {
      ...BUNDLED_RESOURCE_CATALOG,
      resources: BUNDLED_RESOURCE_CATALOG.resources.map((entry) => ({
        ...entry,
        name: `${entry.name}（目录）`,
      })),
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(remote)))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify(BUNDLED_RESOURCE_CATALOG)));
    const refreshManifest = vi.fn(async () => downloads);
    const center = new ResourceCenter(
      { getStatus: async () => downloads, refreshManifest },
      'https://example.com/catalog.json',
      { fetch: fetcher },
    );
    expect((await center.getStatus()).catalog).toEqual(remote);
    await center.getStatus();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await center.refresh()).toMatchObject({
      catalog: remote,
      catalogMessage: expect.stringContaining('未能更新'),
    });
    expect((await center.refresh()).catalog).toEqual(BUNDLED_RESOURCE_CATALOG);
    expect(fetcher).toHaveBeenCalledTimes(3);
    center.dispose();
  });
});
