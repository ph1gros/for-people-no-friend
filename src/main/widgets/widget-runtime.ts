import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DESKTOP_WIDGET_IDS } from '../../shared/desktop-integration-ipc';
import {
  parseWidgetManifest,
  type WidgetManifest,
  type WidgetSnapshot,
} from '../../shared/widget-contract';
import { WidgetDataSources, type WidgetSourceContext } from './widget-data-sources';
import { inspectWidgetPackage } from './widget-package-loader';
import { WIDGET_PACKAGE_INTEGRITY } from './widget-package-integrity';

/** Only explicitly application-approved IDs are read. No directory discovery or arbitrary import. */
export class WidgetRuntime {
  private readonly manifests = new Map<string, WidgetManifest>();
  private readonly errors = new Map<string, string>();
  public constructor(private readonly sources = new WidgetDataSources()) {}

  public async loadApprovedPackages(root: string): Promise<void> {
    for (const [id, integrity] of Object.entries(WIDGET_PACKAGE_INTEGRITY)) {
      if (!integrity) continue;
      if (this.manifests.has(id)) continue;
      try {
        const directory = path.join(root, integrity.target);
        const archive = path.join(directory, 'package.zip');
        if ((await lstat(directory)).isSymbolicLink() || (await lstat(archive)).isSymbolicLink())
          throw new Error('小组件目录或归档不能是链接');
        const handle = await open(archive, 'r');
        let bytes: Uint8Array;
        try {
          if ((await handle.stat()).size !== integrity.compressedBytes)
            throw new Error('小组件归档体积不符');
          const buffer = new Uint8Array(integrity.compressedBytes);
          let offset = 0;
          while (offset < buffer.length) {
            const result = await handle.read(buffer, offset, buffer.length - offset, offset);
            if (result.bytesRead === 0) throw new Error('小组件归档不完整');
            offset += result.bytesRead;
          }
          bytes = buffer;
        } finally {
          await handle.close();
        }
        if (
          bytes.length !== integrity.compressedBytes ||
          createHash('sha256').update(bytes).digest('hex') !== integrity.sha256
        )
          throw new Error('小组件 SHA256 校验失败');
        const inspected = inspectWidgetPackage(bytes, `${id}.zip`, this.knownIds());
        if (inspected.manifest.capability.id !== id) throw new Error('小组件 ID 与信任记录不符');
        this.register(inspected.manifest);
        this.errors.delete(id);
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
          this.errors.set(
            id,
            `${id}：${error instanceof Error && error.name === 'WidgetPackageError' ? error.message : '已安装的小组件校验失败，请重新安装。'}`,
          );
        // A missing or invalid optional package cannot prevent built-in widgets or chat.
      }
    }
  }

  /** Main-only registration after package validation; never exposed through IPC. */
  public register(manifest: WidgetManifest): void {
    const validated = parseWidgetManifest(manifest);
    if (this.knownIds().includes(validated.capability.id) || this.knownIds().length >= 32)
      throw new Error('小组件 ID 重复或数量超限。');
    this.manifests.set(validated.capability.id, validated);
  }
  public knownIds(): string[] {
    return [...DESKTOP_WIDGET_IDS, ...this.manifests.keys()];
  }
  public getErrors(): string[] {
    return [...this.errors.values()];
  }
  public has(id: string): boolean {
    return this.manifests.has(id);
  }
  public snapshots(enabledIds: readonly string[], context: WidgetSourceContext): WidgetSnapshot[] {
    return [...this.manifests.values()].map((manifest) => {
      const enabled = enabledIds.includes(manifest.capability.id);
      const snapshot: WidgetSnapshot = {
        manifest: structuredClone(manifest),
        enabled,
        available: true,
        values: {},
      };
      if (!enabled) return snapshot;
      try {
        for (const row of manifest.layout.rows) {
          if (row.source && !Object.hasOwn(snapshot.values, row.source))
            snapshot.values[row.source] = this.sources.read(
              row.source,
              manifest.capability.permissions,
              context,
            );
        }
      } catch {
        snapshot.available = false;
        snapshot.values = {};
        snapshot.error = '小组件数据暂不可用';
      }
      return snapshot;
    });
  }
}
