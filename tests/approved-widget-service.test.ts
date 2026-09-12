import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { zipSync } from 'fflate';
import { ApprovedWidgetService } from '../src/main/widgets/approved-widget-service';
import { WidgetPackageInstaller } from '../src/main/widgets/widget-package-installer';
import { WidgetRuntime } from '../src/main/widgets/widget-runtime';

describe('approved clock delivery', () => {
  it('installs the real example against production pins, coalesces requests and reloads idempotently', async () => {
    await mkdir(resolve('.release'), { recursive: true });
    const root = await mkdtemp(join(resolve('.release'), 'approved-clock-'));
    const content = await readFile(resolve('docs/examples/widget-clock/manifest.json'));
    const bytes = zipSync({ 'manifest.json': content }, { level: 9, mtime: new Date(2020, 0, 1) });
    let downloads = 0;
    const runtime = new WidgetRuntime();
    const installer = new WidgetPackageInstaller(root, {
      fetch: async () => {
        downloads += 1;
        return new Response(bytes);
      },
      detectMetered: async () => false,
    });
    const service = new ApprovedWidgetService(root, runtime, installer);
    try {
      await mkdir(join(root, 'clock'));
      await writeFile(join(root, 'clock/package.zip'), new Uint8Array(bytes.length));
      await runtime.loadApprovedPackages(root);
      await runtime.loadApprovedPackages(root);
      expect(runtime.getErrors()).toHaveLength(1);
      await Promise.all([service.installClock(), service.installClock()]);
      expect(runtime.knownIds()).toEqual(['input', 'media', 'clock']);
      expect(downloads).toBe(1);
      await runtime.loadApprovedPackages(root);
      await service.installClock();
      expect(downloads).toBe(1);
      expect(runtime.getErrors()).toEqual([]);
      service.dispose();
      await expect(service.installClock()).rejects.toThrow('停止');
    } finally {
      service.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
