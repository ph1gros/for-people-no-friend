import { spawn, type ChildProcess } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import { isSpeechAssetActivated } from './speech-asset-activation';
import { validateInstalledSpeechAssetTarget } from './speech-asset-downloader';

const READY_URL = 'http://127.0.0.1:9881/ready';
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
  downloadedAsset?: true;
}

type BundledSpeechRuntimeSource =
  string | BundledSpeechRuntimeCandidate | readonly (string | BundledSpeechRuntimeCandidate)[];

interface ResolvedBundledSpeechRuntime {
  runtimeRoot: string;
  serviceRoot: string;
  voiceRoot?: string;
  bertRoot?: string;
}

export const resolveBundledSpeechRuntimeSources = ({
  appPath,
  resourcesPath,
  userDataPath,
  packaged,
}: {
  appPath: string;
  resourcesPath: string;
  userDataPath?: string;
  packaged: boolean;
}): Array<string | BundledSpeechRuntimeCandidate> => {
  const packagedRuntime = path.join(resourcesPath, 'voice-runtime');
  const downloadedRuntime: BundledSpeechRuntimeCandidate | undefined = userDataPath
    ? {
        runtimeRoot: path.join(userDataPath, 'speech-assets', 'voice-runtime'),
        downloadedAsset: true,
      }
    : undefined;
  if (packaged) return [...(downloadedRuntime ? [downloadedRuntime] : []), packagedRuntime];
  return [
    ...(downloadedRuntime ? [downloadedRuntime] : []),
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
  public async resolveAvailableVoiceRoot(): Promise<string | undefined> {
    const runtime = await this.resolveAvailableRuntime();
    return runtime
      ? (runtime.voiceRoot ?? path.join(runtime.runtimeRoot, 'voice', 'ireina'))
      : undefined;
  }

  private async resolveAvailableRuntime(): Promise<ResolvedBundledSpeechRuntime | undefined> {
    const sources = Array.isArray(this.runtimeRoots) ? this.runtimeRoots : [this.runtimeRoots];
    for (const source of sources) {
      const runtimeRoot = typeof source === 'string' ? source : source.runtimeRoot;
      if (typeof source !== 'string' && source.downloadedAsset) {
        const assetsRoot = path.dirname(runtimeRoot);
        try {
          for (const id of ['voice-runtime', 'bert-japanese', 'voice-ireina'] as const) {
            if (!(await isSpeechAssetActivated(assetsRoot, id)))
              throw new Error('Asset is not activated');
            await validateInstalledSpeechAssetTarget(path.join(assetsRoot, id), id);
          }
          const canonicalRuntimeRoot = await realpath(path.join(assetsRoot, 'voice-runtime'));
          return {
            runtimeRoot: canonicalRuntimeRoot,
            serviceRoot: canonicalRuntimeRoot,
            voiceRoot: await realpath(path.join(assetsRoot, 'voice-ireina')),
            bertRoot: await realpath(path.join(assetsRoot, 'bert-japanese')),
          };
        } catch {
          continue;
        }
      }
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
    const child = this.spawnRuntime(
      executable,
      [
        '-m',
        'uvicorn',
        '--app-dir',
        runtime.serviceRoot,
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
          FPNF_BUNDLED_VOICE_ROOT:
            runtime.voiceRoot ?? path.join(runtime.runtimeRoot, 'voice', 'ireina'),
          FPNF_BUNDLED_BERT_ROOT: runtime.bertRoot ?? '',
          FPNF_BUNDLED_OUTPUT_ROOT: path.join(runtime.runtimeRoot, 'recent-output'),
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
