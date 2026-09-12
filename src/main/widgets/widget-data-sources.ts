import os from 'node:os';
import type {
  ExtensionCapabilityManifest,
  MediaSessionState,
} from '../../core/desktop/integration';
import {
  WIDGET_SOURCE_PERMISSIONS,
  type WidgetSource,
  type WidgetValue,
} from '../../shared/widget-contract';

export interface WidgetSourceContext {
  media?: MediaSessionState;
  input?: { keys: string[]; mouse: string[]; direction: string | null };
}
type Permissions = ExtensionCapabilityManifest['permissions'];
const cpuTimes = () =>
  os.cpus().reduce(
    (sum, cpu) => ({
      idle: sum.idle + cpu.times.idle,
      total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0),
    }),
    { idle: 0, total: 0 },
  );

export class WidgetDataSources {
  private previousCpu: ReturnType<typeof cpuTimes> | undefined;
  private lastSample = -Infinity;
  private cpu: number | null = null;
  private memory: number | null = null;
  public constructor(
    private readonly clock: () => number = Date.now,
    private readonly readCpu: typeof cpuTimes = cpuTimes,
    private readonly readMemory: () => { total: number; free: number } = () => ({
      total: os.totalmem(),
      free: os.freemem(),
    }),
  ) {}

  private sampleSystem(): void {
    const now = this.clock();
    if (now >= this.lastSample && now - this.lastSample < 1000) return;
    const next = this.readCpu();
    const previous = this.previousCpu;
    const total = previous ? next.total - previous.total : 0;
    this.cpu =
      previous && total > 0
        ? Math.max(0, Math.min(1, 1 - (next.idle - previous.idle) / total))
        : null;
    const memory = this.readMemory();
    this.memory =
      memory.total > 0 ? Math.max(0, Math.min(1, 1 - memory.free / memory.total)) : null;
    this.previousCpu = next;
    this.lastSample = now;
  }

  public read(
    source: WidgetSource,
    granted: readonly Permissions[number][],
    context: WidgetSourceContext = {},
  ): WidgetValue {
    if (
      !Object.hasOwn(WIDGET_SOURCE_PERMISSIONS, source) ||
      !granted.includes(WIDGET_SOURCE_PERMISSIONS[source])
    )
      throw new Error('小组件没有读取该数据源的权限。');
    return this.readers[source](context);
  }

  private readonly readers: Readonly<
    Record<WidgetSource, (context: WidgetSourceContext) => WidgetValue>
  > = Object.freeze({
    'clock.time': () => this.clock(),
    'clock.date': () => this.clock(),
    'clock.timezone': () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    'system.cpu': () => {
      this.sampleSystem();
      return this.cpu;
    },
    'system.memory': () => {
      this.sampleSystem();
      return this.memory;
    },
    'media.title': (context) => context.media?.title?.slice(0, 256) ?? null,
    'media.artist': (context) => context.media?.artist?.slice(0, 256) ?? null,
    'media.playing': (context) => context.media?.playing ?? null,
    'media.player': (context) => context.media?.playerName?.slice(0, 256) ?? null,
    'input.keys': (context) => context.input?.keys.slice(0, 24) ?? null,
    'input.mouse': (context) => context.input?.mouse.slice(0, 3) ?? null,
    'input.direction': (context) => context.input?.direction ?? null,
  });
}
