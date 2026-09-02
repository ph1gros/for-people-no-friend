import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { app, type BrowserWindow } from 'electron';

import type { CharacterDisplayMode } from '../../shared/character-display-ipc';

const OVERLAY_EXECUTABLE_NAME = 'FpnfVTubeStudioSpout.exe';
const DEFAULT_SENDER_NAME = 'VTubeStudioSpout';

interface OverlayProcessDependencies {
  platform: NodeJS.Platform;
  executablePath: string;
  exists: (filePath: string) => boolean;
  spawnProcess: (
    executablePath: string,
    args: readonly string[],
    options: {
      cwd: string;
      windowsHide: boolean;
      stdio: ['ignore', 'ignore', 'pipe'];
    },
  ) => ChildProcess;
}

export type VTubeStudioSpoutDiagnosticSink = (event: string) => void;
const DIAGNOSTIC_LINE_PATTERN = /^FPNF_SPOUT_[A-Z_]+$/u;

const defaultExecutablePath = (): string => {
  const applicationRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(applicationRoot, 'native', 'vtube-studio-spout', 'bin', OVERLAY_EXECUTABLE_NAME);
};

const defaultDependencies = (): OverlayProcessDependencies => ({
  platform: process.platform,
  executablePath: defaultExecutablePath(),
  exists: existsSync,
  spawnProcess: (executablePath, args, options) =>
    spawn(executablePath, args, {
      ...options,
      detached: false,
    }),
});

export const readNativeWindowHandle = (handle: Buffer): bigint | undefined => {
  if (handle.length === 8) {
    const value = handle.readBigUInt64LE(0);
    return value > 0n ? value : undefined;
  }
  if (handle.length === 4) {
    const value = BigInt(handle.readUInt32LE(0));
    return value > 0n ? value : undefined;
  }
  return undefined;
};

export class VTubeStudioSpoutOverlay {
  private child: ChildProcess | undefined;
  private requestedMode: CharacterDisplayMode = 'off';
  private settingsPanelExpanded = false;

  public constructor(
    private readonly getWindow: () => BrowserWindow | undefined,
    private readonly dependencies: OverlayProcessDependencies = defaultDependencies(),
    private readonly recordDiagnostic: VTubeStudioSpoutDiagnosticSink = (event) =>
      console.warn('VTube Studio Spout overlay:', event),
  ) {}

  public setMode(mode: CharacterDisplayMode): void {
    this.requestedMode = mode;
    if (mode !== 'vtube-studio' || this.settingsPanelExpanded) {
      this.stop();
      return;
    }
    this.start();
  }

  public setSettingsPanelExpanded(expanded: boolean): void {
    if (this.settingsPanelExpanded === expanded) return;
    this.settingsPanelExpanded = expanded;
    if (expanded) {
      this.stop();
      return;
    }
    if (this.requestedMode === 'vtube-studio') this.start();
  }

  public dispose(): void {
    this.requestedMode = 'off';
    this.stop();
  }

  private start(): void {
    if (this.child || this.dependencies.platform !== 'win32') return;
    if (!this.dependencies.exists(this.dependencies.executablePath)) return;

    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    const ownerHandle = readNativeWindowHandle(window.getNativeWindowHandle());
    if (!ownerHandle) return;

    const executablePath = path.resolve(this.dependencies.executablePath);
    const child = this.dependencies.spawnProcess(
      executablePath,
      [
        '--owner',
        ownerHandle.toString(10),
        '--sender',
        DEFAULT_SENDER_NAME,
        '--fps',
        '30',
        '--zoom',
        '1.4',
      ],
      {
        cwd: path.dirname(executablePath),
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
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
        const event = line.trim().slice(0, 120);
        if (DIAGNOSTIC_LINE_PATTERN.test(event)) this.recordDiagnostic(event);
      }
    });
    child.once('error', () => {
      if (this.child === child) this.child = undefined;
    });
    child.once('exit', () => {
      if (this.child !== child) return;
      this.child = undefined;
      if (this.requestedMode === 'vtube-studio') {
        setTimeout(() => this.start(), 1_000).unref();
      }
    });
  }

  private stop(): void {
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
  }
}
