import { execFile } from 'node:child_process';
import path from 'node:path';

import type {
  MediaCommand,
  MediaController,
  MediaSessionState,
} from '../../core/desktop/integration';
import { resolveSupportedMediaPlayer } from '../../core/desktop/integration';

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
    $supportedSourcePattern = '(?i)(cloudmusic|netease|orpheus|qq\s*music|qq\s*音乐|kugou|apple\s*music|spotify)'
    foreach ($session in $sessions | Where-Object { [string]$_.SourceAppUserModelId -match $supportedSourcePattern }) {
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
  $currentSource = if ($null -ne $current) { [string]$current.SourceAppUserModelId } else { '' }
  $items = @()
  foreach ($session in @($manager.GetSessions()) | Select-Object -First 16) {
    try {
      $properties = Await-WinRtOperation ($session.TryGetMediaPropertiesAsync()) $propertiesType
      $playback = $session.GetPlaybackInfo()
      $source = [string]$session.SourceAppUserModelId
      $items += [ordered]@{
        current = $source -eq $currentSource
        playing = $playback.PlaybackStatus.ToString() -eq 'Playing'
        title = [string]$properties.Title
        artist = [string]$properties.Artist
        source = $source
      }
    } catch {
      # Skip one malformed media session without hiding other supported players.
    }
  }
  [ordered]@{
    supported = $true
    sessions = @($items)
  } | ConvertTo-Json -Compress -Depth 4
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
  if (record.supported !== true || !Array.isArray(record.sessions) || record.sessions.length > 16) {
    throw new Error('The Windows media state response is invalid.');
  }
  const sessions = record.sessions.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('The Windows media state response is invalid.');
    }
    const session = value as Record<string, unknown>;
    if (
      typeof session.current !== 'boolean' ||
      typeof session.playing !== 'boolean' ||
      typeof session.source !== 'string'
    ) {
      throw new Error('The Windows media state response is invalid.');
    }
    const source = cleanMediaText(session.source, 256);
    return {
      current: session.current,
      playing: session.playing,
      ...(cleanMediaText(session.title, 300) ? { title: cleanMediaText(session.title, 300) } : {}),
      ...(cleanMediaText(session.artist, 300)
        ? { artist: cleanMediaText(session.artist, 300) }
        : {}),
      ...(source ? { source } : {}),
      player: resolveSupportedMediaPlayer(source),
    };
  });
  const supportedSessions = sessions.filter((session) => session.player);
  const selected =
    supportedSessions.find((session) => session.playing) ??
    supportedSessions.find((session) => session.current) ??
    supportedSessions[0];
  if (!selected?.player) {
    const current =
      sessions.find((session) => session.playing) ??
      sessions.find((session) => session.current) ??
      sessions[0];
    return {
      supported: true,
      sessionAvailable: sessions.length > 0,
      ...(current?.source ? { source: current.source } : {}),
    };
  }
  return {
    supported: true,
    sessionAvailable: true,
    playerId: selected.player.id,
    playerName: selected.player.name,
    playing: selected.playing,
    ...(selected.title ? { title: selected.title } : {}),
    ...(selected.artist ? { artist: selected.artist } : {}),
    ...(selected.source ? { source: selected.source } : {}),
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
  if (!powerShellPath) return { supported: true, sessionAvailable: false };

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
          resolve({ supported: true, sessionAvailable: false });
          return;
        }
        try {
          resolve(parseWindowsMediaStateOutput(stdout));
        } catch {
          resolve({ supported: true, sessionAvailable: false });
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
