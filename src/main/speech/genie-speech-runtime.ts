import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createChildEnvironment, PYTHON_RUNTIME_ENV_NAMES } from '../security/child-environment';
import { isSpeechAssetActivated } from './speech-asset-activation';
import { validateInstalledSpeechAssetTarget } from './speech-asset-downloader';
import {
  GENIE_VOICE_PRESETS,
  findGenieVoicePreset,
  type GenieVoiceId,
} from '../../shared/speech-ipc';
import type { SpeechAssetTierId } from '../../shared/speech-asset-ipc';
import { SPEECH_ASSET_TARGETS } from './speech-asset-layout';

export interface GenieRuntimeOptions {
  fetch?: typeof fetch;
  spawn?: typeof spawn;
  delay?: (ms: number) => Promise<void>;
  attempts?: number;
  developmentAssetsRoot?: string;
}

/** One lazily started process per fixed voice prevents concurrent requests switching each other's voice. */
class ManagedGenieVoiceRuntime {
  private child?: ChildProcess;
  private starting?: Promise<boolean>;
  private disposed = false;
  private readonly token = randomBytes(32).toString('hex');

  public constructor(
    private readonly assetsRoot: string,
    private readonly options: GenieRuntimeOptions = {},
    private readonly preset: (typeof GENIE_VOICE_PRESETS)[number] = GENIE_VOICE_PRESETS[0],
  ) {}

  public headers(): Record<string, string> {
    return { 'x-fpnf-session': this.token };
  }

  public async resolveRoot(): Promise<string | undefined> {
    for (const root of [this.assetsRoot, this.options.developmentAssetsRoot]) {
      if (!root) continue;
      try {
        const required: SpeechAssetTierId[] = ['genie-tts', 'genie-data', this.preset.assetId];
        if (this.preset.voiceId !== 'mika') required.push('genie-language-data');
        for (const id of required) {
          if (!(await isSpeechAssetActivated(root, id))) throw Error('Inactive');
          await validateInstalledSpeechAssetTarget(
            path.join(root, SPEECH_ASSET_TARGETS[id]),
            SPEECH_ASSET_TARGETS[id],
          );
        }
        return root;
      } catch {
        /* An incomplete component must not start a process. */
      }
    }
    return undefined;
  }

  public async ensureRunning(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async health(): Promise<string> {
    try {
      const response = await (this.options.fetch ?? fetch)(this.preset.baseUrl + '/ready', {
        headers: this.headers(),
        redirect: 'error',
        signal: AbortSignal.timeout(800),
      });
      if (!response.ok) return 'unavailable';
      if (!response.body) return 'unavailable';
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024) {
            await reader.cancel();
            return 'unavailable';
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const status = JSON.parse(body) as Record<string, unknown>;
      return status.engine === 'genie-tts' &&
        status.voice === this.preset.voiceId &&
        typeof status.status === 'string'
        ? status.status
        : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }

  private async start(): Promise<boolean> {
    if (this.child && (await this.health()) === 'ready') return !this.disposed;
    const root = await this.resolveRoot();
    if (!root || this.disposed) return false;
    if (this.child) {
      this.child.kill();
      this.child = undefined;
    }
    const runtime = path.join(root, 'genie-tts');
    const child = (this.options.spawn ?? spawn)(
      path.join(runtime, 'python', 'python.exe'),
      [
        '-m',
        'uvicorn',
        '--app-dir',
        runtime,
        'fpnf_genie_service:app',
        '--host',
        '127.0.0.1',
        '--port',
        String(this.preset.port),
        '--log-level',
        'critical',
        '--no-access-log',
      ],
      {
        cwd: runtime,
        windowsHide: true,
        stdio: 'ignore',
        env: createChildEnvironment(PYTHON_RUNTIME_ENV_NAMES, {
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONNOUSERSITE: '1',
          NO_PROXY: '127.0.0.1,localhost',
          HF_HUB_OFFLINE: '1',
          HF_HUB_DISABLE_IMPLICIT_TOKEN: '1',
          HF_HUB_DISABLE_TELEMETRY: '1',
          GENIE_DATA_DIR: path.join(root, 'genie-data'),
          FPNF_GENIE_VOICE_ROOT: path.join(root, this.preset.assetId),
          FPNF_GENIE_VOICE_ID: this.preset.voiceId,
          FPNF_GENIE_LANGUAGE_ROOT: path.join(root, 'genie-language-data'),
          FPNF_GENIE_SESSION_TOKEN: this.token,
        }),
      },
    );
    this.child = child;
    let failed = false;
    child.once('error', () => {
      failed = true;
    });
    child.once('exit', () => {
      if (this.child === child) this.child = undefined;
    });
    for (let i = 0; i < (this.options.attempts ?? 180); i++) {
      if (failed || this.disposed || child.exitCode !== null || child.killed) break;
      const health = await this.health();
      if (health === 'ready') return true;
      if (health === 'failed') break;
      await (this.options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(
        500,
      );
    }
    child.kill();
    if (this.child === child) this.child = undefined;
    return false;
  }

  public dispose(): void {
    this.disposed = true;
    this.child?.kill();
    this.child = undefined;
  }
}

/** Only compiled presets may choose a managed executable, component directory or endpoint. */
export class GenieSpeechRuntime {
  private readonly voices = new Map<GenieVoiceId, ManagedGenieVoiceRuntime>();
  private disposed = false;

  public constructor(
    private readonly assetsRoot: string,
    private readonly options: GenieRuntimeOptions = {},
  ) {}

  private runtime(voiceId: string): ManagedGenieVoiceRuntime | undefined {
    const preset = findGenieVoicePreset(voiceId);
    if (!preset || this.disposed) return undefined;
    let runtime = this.voices.get(preset.voiceId);
    if (!runtime) {
      runtime = new ManagedGenieVoiceRuntime(this.assetsRoot, this.options, preset);
      this.voices.set(preset.voiceId, runtime);
    }
    return runtime;
  }

  public headers(voiceId = 'mika'): Record<string, string> {
    return this.runtime(voiceId)?.headers() ?? {};
  }
  public async resolveRoot(voiceId = 'mika'): Promise<string | undefined> {
    return this.runtime(voiceId)?.resolveRoot();
  }
  public async ensureRunning(voiceId = 'mika'): Promise<boolean> {
    return this.runtime(voiceId)?.ensureRunning() ?? false;
  }
  public dispose(): void {
    this.disposed = true;
    for (const runtime of this.voices.values()) runtime.dispose();
    this.voices.clear();
  }
}
