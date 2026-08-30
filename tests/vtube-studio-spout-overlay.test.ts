import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  readNativeWindowHandle,
  VTubeStudioSpoutOverlay,
} from '../src/main/vtube-studio/vtube-studio-spout-overlay';

const createChild = (): ChildProcess => {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperties(child, {
    exitCode: { value: null, writable: true },
    signalCode: { value: null, writable: true },
  });
  child.kill = vi.fn(() => true);
  return child;
};

const createWindow = (handle: bigint): BrowserWindow =>
  ({
    isDestroyed: () => false,
    getNativeWindowHandle: () => {
      const buffer = Buffer.alloc(8);
      buffer.writeBigUInt64LE(handle);
      return buffer;
    },
  }) as BrowserWindow;

describe('VTubeStudioSpoutOverlay', () => {
  it('reads validated 32-bit and 64-bit native window handles', () => {
    const wide = Buffer.alloc(8);
    wide.writeBigUInt64LE(4_294_967_300n);
    const narrow = Buffer.alloc(4);
    narrow.writeUInt32LE(10_086);

    expect(readNativeWindowHandle(wide)).toBe(4_294_967_300n);
    expect(readNativeWindowHandle(narrow)).toBe(10_086n);
    expect(readNativeWindowHandle(Buffer.alloc(8))).toBeUndefined();
    expect(readNativeWindowHandle(Buffer.alloc(6))).toBeUndefined();
  });

  it('starts only the fixed VTube Studio sender and stops it when the mode changes', () => {
    const child = createChild();
    const spawnProcess = vi.fn(() => child);
    const executablePath =
      'C:\\ai_deskpet\\native\\vtube-studio-spout\\bin\\FpnfVTubeStudioSpout.exe';
    const overlay = new VTubeStudioSpoutOverlay(() => createWindow(10_486n), {
      platform: 'win32',
      executablePath,
      exists: () => true,
      spawnProcess,
    });

    overlay.setMode('vtube-studio');
    overlay.setMode('vtube-studio');

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(spawnProcess).toHaveBeenCalledWith(
      executablePath,
      ['--owner', '10486', '--sender', 'VTubeStudioSpout', '--fps', '30', '--zoom', '1.4'],
      {
        cwd: 'C:\\ai_deskpet\\native\\vtube-studio-spout\\bin',
        windowsHide: true,
        stdio: 'ignore',
      },
    );

    overlay.setMode('off');
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('does not spawn when the platform, helper, or owner is unavailable', () => {
    const spawnProcess = vi.fn(() => createChild());
    const base = {
      executablePath: 'C:\\fixed\\FpnfVTubeStudioSpout.exe',
      exists: () => true,
      spawnProcess,
    };

    new VTubeStudioSpoutOverlay(() => createWindow(1n), {
      ...base,
      platform: 'linux',
    }).setMode('vtube-studio');
    new VTubeStudioSpoutOverlay(() => createWindow(1n), {
      ...base,
      platform: 'win32',
      exists: () => false,
    }).setMode('vtube-studio');
    new VTubeStudioSpoutOverlay(() => undefined, {
      ...base,
      platform: 'win32',
    }).setMode('vtube-studio');

    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('keeps the compact widget strip outside the native model pixels', () => {
    const source = readFileSync(resolve('native/vtube-studio-spout/SpoutOverlay.cpp'), 'utf8');

    expect(source).toContain('constexpr int kWidgetSafeAreaHeight = 112;');
    expect(source).toContain('const int widget_safe_area = std::min(kWidgetSafeAreaHeight');
    expect(source).toContain('scale_frame(state, height - widget_safe_area);');
    expect(source).toContain('std::fill(');
  });

  it('keeps the VTube Studio model in the left pane while chat is expanded', () => {
    const source = readFileSync(resolve('native/vtube-studio-spout/SpoutOverlay.cpp'), 'utf8');

    expect(source).toContain('constexpr float kExpandedChatMinimumAspect = 0.95F;');
    expect(source).toContain('constexpr float kSettingsLayoutMinimumAspect = 1.42F;');
    expect(source).toContain(
      'const bool expanded_chat = owner_aspect > kExpandedChatMinimumAspect;',
    );
    expect(source).toContain('const int render_width = expanded_chat ? width / 2 : width;');
    expect(source).toContain('bounds.left + render_width');
    expect(source).toContain('if (owner_aspect >= kSettingsLayoutMinimumAspect)');
  });
});
