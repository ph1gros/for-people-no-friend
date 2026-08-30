# FPNF VTube Studio Spout2 overlay

This Windows-only helper receives the fixed `VTubeStudioSpout` sender and renders it as a transparent, click-through layer attached to the FPNF character pane. Electron Main owns the process and passes only the validated native FPNF window handle plus fixed sender, frame-rate, and zoom arguments.

The helper is started only while the character display mode is `vtube-studio`. It fills the compact character window, stays in the left character pane while chat is expanded, and hides while FPNF itself is hidden or the settings layout is open. It exits when the owning FPNF window is destroyed and is terminated by Main when the display mode changes or the app quits.

The compact renderer reserves a transparent 76-pixel strip at the bottom of the native surface. FPNF's input and media widgets occupy that strip above the click-through helper, preventing the character pixels and widget controls from overlapping.

VTube Studio must use its built-in `ColorPicker` background with `透明推流` enabled, and its Spout2 output must be active. FPNF does not start VTube Studio or change its models.

## Build

Spout2 2.007.017 source is vendored under `vendor/spout2` under its BSD-2-Clause licence. Install Zig 0.15 or newer, then run:

```powershell
$env:FPNF_ZIG_PATH = 'C:\absolute\path\to\zig.exe'
pnpm build:vtube-overlay
```

The result is `bin/FpnfVTubeStudioSpout.exe`. The Electron package copies this one helper and the Spout2 licence outside ASAR; no runtime DLL or network download is required.

## Performance boundary

The current compatibility path uses Spout2 GPU sharing for transport, reads the 1280×720 frame into the helper, then scales only to the small FPNF window at 30 FPS. It avoids desktop/window capture and never includes VTube Studio UI. A future zero-copy DirectComposition renderer can remove the remaining GPU-to-CPU readback without changing the Electron security boundary.
