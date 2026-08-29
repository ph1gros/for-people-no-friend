import { execFile } from 'node:child_process';
import path from 'node:path';

import type {
  MediaCommand,
  MediaController,
  MediaSessionState,
} from '../../core/desktop/integration';

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
const STATE_RESPONSE_MAX_BYTES = 16_384;

export type WindowsMediaSessionInvoker = (method: WindowsSessionMethod) => Promise<boolean>;
export type WindowsMediaStateInvoker = () => Promise<MediaSessionState>;

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

export const buildWindowsMediaStateScript = (): string => String.raw`
$utf8Output = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8Output
$OutputEncoding = $utf8Output
$ErrorActionPreference = 'Stop'
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
  $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
  $manager = Await-WinRtOperation ($managerType::RequestAsync()) $managerType
  $current = $manager.GetCurrentSession()
  $sessions = @($manager.GetSessions())
  $session = $sessions |
    Where-Object {
      try { $_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing' } catch { $false }
    } |
    Select-Object -First 1
  if ($null -eq $session) { $session = $current }
  if ($null -eq $session -and $sessions.Count -gt 0) { $session = $sessions[0] }
  if ($null -eq $session) {
    @{ supported = $true } | ConvertTo-Json -Compress
    exit 0
  }

  $properties = Await-WinRtOperation ($session.TryGetMediaPropertiesAsync()) $propertiesType
  $playback = $session.GetPlaybackInfo()
  [ordered]@{
    supported = $true
    playing = $playback.PlaybackStatus.ToString() -eq 'Playing'
    title = [string]$properties.Title
    artist = [string]$properties.Artist
    source = [string]$session.SourceAppUserModelId
  } | ConvertTo-Json -Compress
  exit 0
} catch {
  exit 1
}
`;

const cleanMediaText = (value: unknown, maximumLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const cleaned = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, maximumLength) : undefined;
};

export const parseWindowsMediaStateOutput = (output: string): MediaSessionState => {
  if (Buffer.byteLength(output, 'utf8') > STATE_RESPONSE_MAX_BYTES) {
    throw new Error('The Windows media state response is too large.');
  }
  const value = JSON.parse(output.trim()) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The Windows media state response is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.supported !== true ||
    (record.playing !== undefined && typeof record.playing !== 'boolean')
  ) {
    throw new Error('The Windows media state response is invalid.');
  }
  const title = cleanMediaText(record.title, 300);
  const artist = cleanMediaText(record.artist, 300);
  const source = cleanMediaText(record.source, 256);
  return {
    supported: true,
    ...(typeof record.playing === 'boolean' ? { playing: record.playing } : {}),
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(source ? { source } : {}),
  };
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

export const queryWindowsMediaSessionState = async (): Promise<MediaSessionState> => {
  const powerShellPath = resolvePowerShellPath();
  if (!powerShellPath) return { supported: true };

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
        Buffer.from(buildWindowsMediaStateScript(), 'utf16le').toString('base64'),
      ],
      {
        timeout: COMMAND_TIMEOUT_MS,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: STATE_RESPONSE_MAX_BYTES,
      },
      (error, stdout) => {
        if (error) {
          resolve({ supported: true });
          return;
        }
        try {
          resolve(parseWindowsMediaStateOutput(stdout));
        } catch {
          resolve({ supported: true });
        }
      },
    );
  });
};

export class WindowsMediaController implements MediaController {
  public constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly invokeSessionMethod: WindowsMediaSessionInvoker = invokeWindowsMediaSessionMethod,
    private readonly queryState: WindowsMediaStateInvoker = queryWindowsMediaSessionState,
  ) {}

  public async getState(): ReturnType<MediaController['getState']> {
    if (this.platform !== 'win32') return { supported: false };
    return this.queryState().catch(() => ({ supported: true }));
  }

  public async send(command: MediaCommand): Promise<boolean> {
    if (this.platform !== 'win32') return false;
    return this.invokeSessionMethod(WINDOWS_SESSION_METHODS[command]).catch(() => false);
  }
}
