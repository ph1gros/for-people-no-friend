# V1.6 character display mode

FPNF exposes one character-display setting with three configuration tabs: built-in Live2D, Live2DViewerEX, and VTube Studio. Selecting a tab only opens its settings. Its enable switch chooses that display; switching it off chooses no display.

The large settings window uses one persistent left-hand navigation with five top-level pages: model and window, speech and character presentation, character and reference material, character display mode, and desktop shortcuts. Each selection shows only its corresponding settings on the right. The character display page keeps the three display engines as a second-level left-hand selector.

The active mode is stored and validated in Electron Main. Only one of `live2d`, `viewerex`, or `vtube-studio` can be active. The default is `off`. Main also forces the legacy ViewerEX and VTube Studio `enabled` fields to agree with the selected mode, so a compromised Renderer cannot activate two displays at once.

For an existing installation without a display-mode file, Main preserves an already-enabled external adapter by migrating VTube Studio first, then ViewerEX. Otherwise it starts at `off`.

Renderer behavior follows the selected mode:

- `off`: no character renderer is loaded.
- `live2d`: FPNF loads the active local Live2D character package.
- `viewerex`: the built-in renderer is disposed and presentation intent goes only to ViewerEX.
- `vtube-studio`: the built-in renderer is disposed, presentation intent goes only to VTube Studio, and Main owns a transparent Spout2 receiver attached to the FPNF character pane.

This removes the previous duplicate-character behavior. VTube Studio continues to animate the model, but only its `VTubeStudioSpout` pixels are presented on the desktop; its own controls and background are not captured. The receiver is click-through, stays below FPNF controls, occupies only the left character pane while chat is expanded, hides for the settings layout, and stops whenever another display mode is selected.

In compact mode, the native receiver leaves a transparent strip at the bottom of the FPNF window. Desktop widgets remain in that reserved strip, so media and input controls do not cover the VTube Studio model.

The built-in Live2D page also provides a direct local import entry. The user selects a Cubism 3, 4, or 5 `.model3.json` file; Main validates the selection, follows only bounded local model references, rejects traversal, links, remote resources, executable code, missing assets, and oversized input, then stores an isolated copy for the active character. Imported models start with neutral rendering and no guessed action, expression, parameter, or lip-sync mappings. The bundled Cubism Core remains the only executable runtime code.
