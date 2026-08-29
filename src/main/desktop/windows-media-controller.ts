import { execFile } from 'node:child_process';
import path from 'node:path';

import type { MediaCommand, MediaController } from '../../core/desktop/integration';

const WINDOWS_SESSION_METHODS = {
  'play-pause': 'TryTogglePlayPauseAsync',
  next: 'TrySkipNextAsync',
  previous: 'TrySkipPreviousAsync',
} as const satisfies Readonly<Record<MediaCommand, string>>;
type WindowsSessionMethod = (typeof WINDOWS_SESSION_METHODS)[MediaCommand];

const ALLOWED_SESSION_METHODS = new Set<string>(Object.values(WINDOWS_SESSION_METHODS));
const WINDOWS_MEDIA_VIRTUAL_KEYS = {
  TryTogglePlayPauseAsync: '0xB3',
  TrySkipNextAsync: '0xB0',
  TrySkipPreviousAsync: '0xB1',
} as const satisfies Readonly<Record<WindowsSessionMethod, string>>;
const COMMAND_TIMEOUT_MS = 6_000;

export type WindowsMediaSessionInvoker = (method: WindowsSessionMethod) => Promise<boolean>;

const resolvePowerShellPath = (): string | undefined => {
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) return undefined;
  return path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
};

export const buildWindowsMediaControlScript = (method: WindowsSessionMethod): string => {
  const virtualKey = WINDOWS_MEDIA_VIRTUAL_KEYS[method];
  return String.raw`
$ErrorActionPreference = 'Stop'
try {
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime

    function Await-WinRtOperation($operation, [Type]$resultType) {
      $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
          $_.Name -eq 'AsTask' -and
          $_.IsGenericMethod -and
          $_.GetParameters().Count -eq 1
        } |
        Select-Object -First 1
      $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
      $task.Wait()
      return $task.Result
    }

    $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $manager = Await-WinRtOperation ($managerType::RequestAsync()) $managerType
    $sessions = @()
    $current = $manager.GetCurrentSession()
    if ($null -ne $current) { $sessions += $current }
    foreach ($candidate in $manager.GetSessions()) {
      if ($null -eq $current -or $candidate.SourceAppUserModelId -ne $current.SourceAppUserModelId) {
        $sessions += $candidate
      }
    }
    foreach ($session in $sessions) {
      try {
        $result = Await-WinRtOperation ($session.${method}()) ([bool])
        if ($result) { exit 0 }
      } catch {
        # Try the next advertised session before falling back to a fixed media key.
      }
    }
  } catch {
    # Some desktop players do not publish a Windows media session. Use a fixed
    # system media key below; the command was already selected from a Main allowlist.
  }

  Add-Type @'
using System.Runtime.InteropServices;
public static class DeskpetMediaKey {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
}
'@
  [DeskpetMediaKey]::keybd_event(${virtualKey}, 0, 0, [UIntPtr]::Zero)
  [DeskpetMediaKey]::keybd_event(${virtualKey}, 0, 2, [UIntPtr]::Zero)
  exit 0
} catch {
  exit 1
}
`;
};

const buildEncodedCommand = (method: WindowsSessionMethod): string => {
  const script = buildWindowsMediaControlScript(method);
  return Buffer.from(script, 'utf16le').toString('base64');
};

export const invokeWindowsMediaSessionMethod = async (method: unknown): Promise<boolean> => {
  if (typeof method !== 'string' || !ALLOWED_SESSION_METHODS.has(method)) return false;
  const powerShellPath = resolvePowerShellPath();
  if (!powerShellPath) return false;

  return new Promise((resolve) => {
    execFile(
      powerShellPath,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
        buildEncodedCommand(method as WindowsSessionMethod),
      ],
      {
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1_024,
      },
      (error) => resolve(!error),
    );
  });
};

export class WindowsMediaController implements MediaController {
  public constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly invokeSessionMethod: WindowsMediaSessionInvoker = invokeWindowsMediaSessionMethod,
  ) {}

  public async getState(): ReturnType<MediaController['getState']> {
    return { supported: this.platform === 'win32' };
  }

  public async send(command: MediaCommand): Promise<boolean> {
    if (this.platform !== 'win32') return false;
    return this.invokeSessionMethod(WINDOWS_SESSION_METHODS[command]).catch(() => false);
  }
}
