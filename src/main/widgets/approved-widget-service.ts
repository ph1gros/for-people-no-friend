import { WidgetPackageInstaller } from './widget-package-installer';
import { WidgetRuntime } from './widget-runtime';

/** The renderer can request the single approved package, never an arbitrary URL or path. */
export class ApprovedWidgetService {
  private pending?: Promise<void>;
  private readonly cancellation = new AbortController();
  public constructor(
    private readonly root: string,
    private readonly runtime: WidgetRuntime,
    private readonly installer = new WidgetPackageInstaller(root),
  ) {}
  public installClock(): Promise<void> {
    if (this.cancellation.signal.aborted) return Promise.reject(new Error('小组件服务已停止。'));
    if (this.runtime.has('clock')) return Promise.resolve();
    this.pending ??= this.install().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async install(): Promise<void> {
    await this.installer.install(
      {
        id: 'clock',
        version: '1.0.0',
        urls: [
          'https://github.com/ph1gros/fpnf-resources/releases/download/widgets-v1.9.0/clock.zip',
        ],
      },
      this.cancellation.signal,
    );
    await this.runtime.loadApprovedPackages(this.root);
    if (!this.runtime.has('clock')) throw new Error('时钟小组件未能加载，请重试。');
  }
  public dispose(): void {
    this.cancellation.abort();
  }
}
