import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
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
  child.stderr = new PassThrough();
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
    const diagnostics: string[] = [];
    const overlay = new VTubeStudioSpoutOverlay(
      () => createWindow(10_486n),
      {
        platform: 'win32',
        executablePath,
        exists: () => true,
        spawnProcess,
      },
      (event) => diagnostics.push(event),
    );

    overlay.setMode('vtube-studio');
    overlay.setMode('vtube-studio');

    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(spawnProcess).toHaveBeenCalledWith(
      executablePath,
      ['--owner', '10486', '--sender', 'VTubeStudioSpout', '--fps', '30', '--zoom', '1.4'],
      {
        cwd: 'C:\\ai_deskpet\\native\\vtube-studio-spout\\bin',
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    child.stderr?.emit('data', Buffer.from('FPNF_SPOUT_FRAME_UNAVAILABLE\n'));
    expect(diagnostics).toContain('FPNF_SPOUT_FRAME_UNAVAILABLE');

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

    expect(source).toContain('constexpr int kWidgetSafeAreaHeight = 128;');
    expect(source).toContain('const int widget_safe_area = std::min(kWidgetSafeAreaHeight');
    expect(source).toContain('scale_frame(state, height - widget_safe_area);');
    expect(source).toContain('std::fill(');
  });

  it('keeps the VTube Studio model in the left pane while chat is expanded', () => {
    const source = readFileSync(resolve('native/vtube-studio-spout/SpoutOverlay.cpp'), 'utf8');

    expect(source).toContain('constexpr float kExpandedChatMinimumAspect = 0.95F;');
    expect(source).toContain(
      'const bool expanded_chat = owner_aspect > kExpandedChatMinimumAspect;',
    );
    expect(source).toContain('const int render_width = expanded_chat ? width / 2 : width;');
    expect(source).toContain('bounds.left + render_width');
    expect(source).not.toContain('kSettingsLayoutMinimumAspect');
    expect(source).not.toContain('if (owner_aspect >=');
  });

  it('uses the owner DPI and stable owned-window z-order without per-frame topmost fighting', () => {
    const source = readFileSync(resolve('native/vtube-studio-spout/SpoutOverlay.cpp'), 'utf8');

    expect(source).toContain(
      'SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)',
    );
    expect(source).toContain('state.options.owner, nullptr, instance, &state');
    expect(source).toContain('SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW');
    expect(source).not.toContain('SetWindowPos(window, HWND_TOPMOST');
    expect(source).not.toContain('SetWindowPos(state.options.owner, HWND_TOPMOST');
  });

  it('suppresses the native model only while the settings panel is explicitly open', () => {
    const firstChild = createChild();
    const secondChild = createChild();
    const spawnProcess = vi.fn().mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);
    const overlay = new VTubeStudioSpoutOverlay(() => createWindow(10_486n), {
      platform: 'win32',
      executablePath: 'C:\\fixed\\FpnfVTubeStudioSpout.exe',
      exists: () => true,
      spawnProcess,
    });

    overlay.setMode('vtube-studio');
    overlay.setSettingsPanelExpanded(true);
    overlay.setSettingsPanelExpanded(false);

    expect(firstChild.kill).toHaveBeenCalledTimes(1);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });

  it('selects the high-performance GPU used by VTube Studio and reports receiver readiness', () => {
    const source = readFileSync(resolve('native/vtube-studio-spout/SpoutOverlay.cpp'), 'utf8');

    expect(source).toContain('NvOptimusEnablement');
    expect(source).toContain('AmdPowerXpressRequestHighPerformance');
    expect(source).toContain('GetSenderAdapter(state.options.sender.c_str()');
    expect(source).toContain('SetPreferredAdapter(2)');
    expect(source).toContain('SetAutoShare(true)');
    expect(source).toContain('FPNF_SPOUT_READY');
    expect(source).toContain('FPNF_SPOUT_FRAME_UNAVAILABLE');
  });
});
