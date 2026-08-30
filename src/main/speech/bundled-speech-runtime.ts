import { spawn, type ChildProcess } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

const HEALTH_URL = 'http://127.0.0.1:9881/health';
const REQUIRED_RELATIVE_PATHS = [
  'python/python.exe',
  'ireina_tts_service.py',
  'voice/ireina/ireina_e100_s16040.onnx',
  'voice/ireina/config.json',
  'voice/ireina/style_vectors.npy',
] as const;

type SpawnRuntime = (
  executable: string,
  args: readonly string[],
  options: { cwd: string; windowsHide: true; stdio: 'ignore'; env: NodeJS.ProcessEnv },
) => ChildProcess;

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export class BundledSpeechRuntime {
  private child: ChildProcess | undefined;
  private starting: Promise<boolean> | undefined;

  public constructor(
    private readonly runtimeRoot: string,
    private readonly fetchHealth: typeof fetch = fetch,
    private readonly spawnRuntime: SpawnRuntime = (executable, args, options) =>
      spawn(executable, args, options),
  ) {}

  public async ensureRunning(): Promise<boolean> {
    if (await this.isHealthy()) return true;
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  public dispose(): void {
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) child.kill();
  }

  private async start(): Promise<boolean> {
    const root = await realpath(this.runtimeRoot).catch(() => undefined);
    if (!root) return false;
    for (const relativePath of REQUIRED_RELATIVE_PATHS) {
      const candidate = path.join(root, relativePath);
      const [stats, canonical] = await Promise.all([
        lstat(candidate).catch(() => undefined),
        realpath(candidate).catch(() => undefined),
      ]);
      if (!stats?.isFile() || stats.isSymbolicLink() || !canonical || !isWithin(root, canonical)) {
        return false;
      }
    }
    const executable = path.join(root, 'python', 'python.exe');
    const child = this.spawnRuntime(
      executable,
      [
        '-m',
        'uvicorn',
        'ireina_tts_service:app',
        '--host',
        '127.0.0.1',
        '--port',
        '9881',
        '--log-level',
        'warning',
      ],
      {
        cwd: root,
        windowsHide: true,
        stdio: 'ignore',
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', NO_PROXY: '127.0.0.1,localhost' },
      },
    );
    this.child = child;
    child.once('exit', () => {
      if (this.child === child) this.child = undefined;
    });
    child.once('error', () => {
      if (this.child === child) this.child = undefined;
    });
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await this.isHealthy()) return true;
      if (child.exitCode !== null || child.killed) return false;
      await delay(250);
    }
    this.dispose();
    return false;
  }

  private async isHealthy(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 700);
    try {
      const response = await this.fetchHealth(HEALTH_URL, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) return false;
      const body = (await response.json()) as Record<string, unknown>;
      return body.status === 'ok' && body.voice === 'ireina';
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
