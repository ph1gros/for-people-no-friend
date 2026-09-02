import { spawn, type ChildProcess } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

const READY_URL = 'http://127.0.0.1:9881/ready';
const INPUT_READY_URL = 'http://127.0.0.1:9880/ready';
const STARTUP_READY_ATTEMPTS = 240;
const REQUIRED_RUNTIME_RELATIVE_PATHS = [
  'python/python.exe',
  'voice/ireina/ireina_e100_s16040.onnx',
  'voice/ireina/config.json',
  'voice/ireina/style_vectors.npy',
] as const;
const SERVICE_RELATIVE_PATH = 'ireina_tts_service.py';

export interface BundledSpeechRuntimeCandidate {
  runtimeRoot: string;
  serviceRoot?: string;
}

type BundledSpeechRuntimeSource =
  string | BundledSpeechRuntimeCandidate | readonly (string | BundledSpeechRuntimeCandidate)[];

interface ResolvedBundledSpeechRuntime {
  runtimeRoot: string;
  serviceRoot: string;
}

export const resolveBundledSpeechRuntimeSources = ({
  appPath,
  resourcesPath,
  packaged,
}: {
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
}): Array<string | BundledSpeechRuntimeCandidate> => {
  const packagedRuntime = path.join(resourcesPath, 'voice-runtime');
  if (packaged) return [packagedRuntime];
  return [
    packagedRuntime,
    {
      runtimeRoot: path.join(appPath, 'data', 'v1.6-portable-voice-runtime'),
      serviceRoot: path.join(appPath, 'resources', 'voice-runtime'),
    },
  ];
};

type SpawnRuntime = (
  executable: string,
  args: readonly string[],
  options: {
    cwd: string;
    windowsHide: true;
    stdio: ['ignore', 'ignore', 'pipe'];
    env: NodeJS.ProcessEnv;
  },
) => ChildProcess;

export type BundledSpeechDiagnosticSink = (event: string) => void;
const DIAGNOSTIC_LINE_PATTERN = /^FPNF_TTS_[A-Z_]+(?: [A-Za-z0-9_-]+)?$/u;
const INPUT_DIAGNOSTIC_LINE_PATTERN = /^FPNF_ASR_[A-Z_]+(?: [A-Za-z0-9:_-]+)?$/u;

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
    private readonly runtimeRoots: BundledSpeechRuntimeSource,
    private readonly fetchHealth: typeof fetch = fetch,
    private readonly spawnRuntime: SpawnRuntime = (executable, args, options) =>
      spawn(executable, args, options),
    private readonly recordDiagnostic: BundledSpeechDiagnosticSink = (event) =>
      console.warn('Bundled speech runtime:', event),
  ) {}

  public async ensureRunning(): Promise<boolean> {
    if (await this.isHealthy()) return true;
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  public async resolveAvailableRoot(): Promise<string | undefined> {
    return (await this.resolveAvailableRuntime())?.runtimeRoot;
  }

  private async resolveAvailableRuntime(): Promise<ResolvedBundledSpeechRuntime | undefined> {
    const sources = Array.isArray(this.runtimeRoots) ? this.runtimeRoots : [this.runtimeRoots];
    for (const source of sources) {
      const runtimeRoot = typeof source === 'string' ? source : source.runtimeRoot;
      const serviceRoot =
        typeof source === 'string' ? source : (source.serviceRoot ?? source.runtimeRoot);
      const [canonicalRuntimeRoot, canonicalServiceRoot] = await Promise.all([
        realpath(runtimeRoot).catch(() => undefined),
        realpath(serviceRoot).catch(() => undefined),
      ]);
      if (!canonicalRuntimeRoot || !canonicalServiceRoot) continue;
      let complete = true;
      for (const relativePath of REQUIRED_RUNTIME_RELATIVE_PATHS) {
        const candidate = path.join(canonicalRuntimeRoot, relativePath);
        const [stats, canonical] = await Promise.all([
          lstat(candidate).catch(() => undefined),
          realpath(candidate).catch(() => undefined),
        ]);
        if (
          !stats?.isFile() ||
          stats.isSymbolicLink() ||
          !canonical ||
          !isWithin(canonicalRuntimeRoot, canonical)
        ) {
          complete = false;
          break;
        }
      }
      if (!complete) continue;
      const servicePath = path.join(canonicalServiceRoot, SERVICE_RELATIVE_PATH);
      const [serviceStats, canonicalServicePath] = await Promise.all([
        lstat(servicePath).catch(() => undefined),
        realpath(servicePath).catch(() => undefined),
      ]);
      if (
        !serviceStats?.isFile() ||
        serviceStats.isSymbolicLink() ||
        !canonicalServicePath ||
        !isWithin(canonicalServiceRoot, canonicalServicePath)
      ) {
        continue;
      }
      return { runtimeRoot: canonicalRuntimeRoot, serviceRoot: canonicalServiceRoot };
    }
    return undefined;
  }

  public dispose(): void {
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) child.kill();
  }

  private async start(): Promise<boolean> {
    const runtime = await this.resolveAvailableRuntime();
    if (!runtime) return false;
    const executable = path.join(runtime.runtimeRoot, 'python', 'python.exe');
    const splitRuntime = runtime.runtimeRoot !== runtime.serviceRoot;
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
        cwd: runtime.serviceRoot,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
          NO_PROXY: '127.0.0.1,localhost',
          ...(splitRuntime
            ? {
                FPNF_BUNDLED_VOICE_ROOT: path.join(runtime.runtimeRoot, 'voice', 'ireina'),
                FPNF_BUNDLED_OUTPUT_ROOT: path.join(runtime.runtimeRoot, 'recent-output'),
              }
            : {}),
        },
      },
    );
    this.child = child;
    let stderrBuffer = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string | Buffer) => {
      stderrBuffer = `${stderrBuffer}${chunk.toString()}`.slice(-1_024);
      const lines = stderrBuffer.split(/\r?\n/gu);
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const event = line.trim().slice(0, 160);
        if (DIAGNOSTIC_LINE_PATTERN.test(event)) this.recordDiagnostic(event);
      }
    });
    child.once('exit', () => {
      if (this.child === child) this.child = undefined;
    });
    child.once('error', () => {
      if (this.child === child) this.child = undefined;
    });
    for (let attempt = 0; attempt < STARTUP_READY_ATTEMPTS; attempt += 1) {
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
      const response = await this.fetchHealth(READY_URL, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) return false;
      const body = (await response.json()) as Record<string, unknown>;
      return (
        body.status === 'ready' &&
        body.voice === 'ireina' &&
        ['DmlExecutionProvider', 'CPUExecutionProvider'].includes(String(body.provider))
      );
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface BundledSpeechInputRuntimeCandidate {
  pythonRoot: string;
  assetRoot: string;
  serviceRoot: string;
}

export const resolveBundledSpeechInputRuntimeCandidate = ({
  appPath,
  resourcesPath,
  packaged,
}: {
  appPath: string;
  resourcesPath: string;
  packaged: boolean;
}): BundledSpeechInputRuntimeCandidate => {
  const packagedRoot = path.join(resourcesPath, 'speech-input-runtime');
  if (packaged) {
    return {
      pythonRoot: path.join(resourcesPath, 'voice-runtime', 'python'),
      assetRoot: packagedRoot,
      serviceRoot: packagedRoot,
    };
  }
  return {
    pythonRoot: path.join(
      appPath,
      'data',
      'gpt-sovits-standalone',
      'app',
      'GPT-SoVITS-v2pro-20250604',
      'runtime',
    ),
    assetRoot: path.join(appPath, 'data', 'ireina-speech-service'),
    serviceRoot: path.join(appPath, 'resources', 'speech-input-runtime'),
  };
};

export class BundledSpeechInputRuntime {
  private child: ChildProcess | undefined;
  private starting: Promise<boolean> | undefined;

  public constructor(
    private readonly candidate: BundledSpeechInputRuntimeCandidate,
    private readonly fetchHealth: typeof fetch = fetch,
    private readonly spawnRuntime: SpawnRuntime = (executable, args, options) =>
      spawn(executable, args, options),
    private readonly recordDiagnostic: BundledSpeechDiagnosticSink = (event) =>
      console.warn('Bundled speech input runtime:', event),
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
    const [pythonRoot, assetRoot, serviceRoot] = await Promise.all([
      realpath(this.candidate.pythonRoot).catch(() => undefined),
      realpath(this.candidate.assetRoot).catch(() => undefined),
      realpath(this.candidate.serviceRoot).catch(() => undefined),
    ]);
    if (!pythonRoot || !assetRoot || !serviceRoot) return false;
    for (const [root, relativePath] of [
      [pythonRoot, 'python.exe'],
      [assetRoot, 'python-packages/funasr/__init__.py'],
      [assetRoot, 'models/modelscope/models/iic/SenseVoiceSmall/model.pt'],
      [serviceRoot, 'sensevoice_asr_service.py'],
    ] as const) {
      const candidate = path.join(root, relativePath);
      const [stats, canonical] = await Promise.all([
        lstat(candidate).catch(() => undefined),
        realpath(candidate).catch(() => undefined),
      ]);
      if (!stats?.isFile() || stats.isSymbolicLink() || !canonical || !isWithin(root, canonical)) {
        return false;
      }
    }
    const child = this.spawnRuntime(
      path.join(pythonRoot, 'python.exe'),
      [
        '-m',
        'uvicorn',
        'sensevoice_asr_service:app',
        '--host',
        '127.0.0.1',
        '--port',
        '9880',
        '--log-level',
        'warning',
      ],
      {
        cwd: serviceRoot,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
          NO_PROXY: '127.0.0.1,localhost',
          FPNF_ASR_PACKAGE_ROOT: path.join(assetRoot, 'python-packages'),
          FPNF_ASR_MODEL_ROOT: path.join(assetRoot, 'models'),
          FPNF_ASR_TEMP_ROOT: path.join(assetRoot, 'tmp'),
        },
      },
    );
    this.child = child;
    let stderrBuffer = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string | Buffer) => {
      stderrBuffer = `${stderrBuffer}${chunk.toString()}`.slice(-1_024);
      const lines = stderrBuffer.split(/\r?\n/gu);
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const event = line.trim().slice(0, 160);
        if (INPUT_DIAGNOSTIC_LINE_PATTERN.test(event)) this.recordDiagnostic(event);
      }
    });
    child.once('exit', () => {
      if (this.child === child) this.child = undefined;
    });
    child.once('error', () => {
      if (this.child === child) this.child = undefined;
    });
    for (let attempt = 0; attempt < STARTUP_READY_ATTEMPTS; attempt += 1) {
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
      const response = await this.fetchHealth(INPUT_READY_URL, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) return false;
      const body = (await response.json()) as Record<string, unknown>;
      return (
        body.status === 'ready' &&
        body.model === 'SenseVoiceSmall' &&
        ['cuda:0', 'cpu'].includes(String(body.provider))
      );
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
