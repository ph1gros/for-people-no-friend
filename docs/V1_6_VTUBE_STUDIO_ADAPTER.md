# V1.6 VTube Studio adapter foundation

This slice proves the official VTube Studio Plugin API can serve as an optional external character display while the current Electron app remains the conversation and speech service. Character display is now mutually exclusive: off, built-in Live2D, ViewerEX, or VTube Studio.

## Runtime result

- Tested locally against VTube Studio 1.35.10 on `ws://127.0.0.1:8001`.
- Authentication and read-only model inspection succeeded.
- The loaded `akari` model exposed model metadata, hotkeys, and expression state through the official API.
- Expression activation, bounded hotkey triggering, and low-frequency AI-owned idle tracking have been tested; model loading, file access, and model movement remain out of scope.

## Security boundary

- Main owns the WebSocket and fixes the host to `127.0.0.1`; Renderer can provide only a validated port.
- The adapter is disabled by default and never connects during startup while disabled.
- Plugin identity is fixed in Main as `For People No Friend` by `ph1gros`.
- Authorization is explicit. VTube Studio shows its own consent prompt and the user must approve it.
- The returned token is stored only through the existing operating-system encrypted `SecretStore`; it is never returned through IPC.
- Preload exposes five fixed calls: status, validated settings, authorize, read-only inspection, and bounded character presentation intent.
- Main revalidates every Renderer input and bounds all VTube Studio responses, strings, arrays, counts, and filenames.
- Presentation accepts only validated character state/emotion/action intent. Main resolves that intent against the current model inventory; Renderer cannot provide an expression filename, hotkey ID, tracking parameter name, or tracking value.
- The settings preview accepts only a bounded expression index from the current inventory. Main resolves the index again, activates at most one FPNF-managed expression, and can restore it without clearing expressions the user activated elsewhere. Renderer still cannot provide a filename.
- Main owns the selected character display mode. A Renderer cannot enable ViewerEX and VTube Studio together through their legacy settings routes.
- New installations start with every character display disabled. Existing enabled ViewerEX or VTube Studio settings are migrated once so user work is preserved.
- The built-in Live2D renderer is loaded only when the selected mode is `live2d`; external or disabled modes dispose and hide it.
- While `vtube-studio` is selected, Main may launch only the bundled `FpnfVTubeStudioSpout.exe` helper with a fixed `VTubeStudioSpout` sender. Renderer cannot choose an executable, process, sender name, window handle, frame rate, or path.
- The Spout2 helper validates its owner handle and arguments again, renders a click-through transparent layer, follows the compact window or the expanded chat's left character pane, hides for the settings layout, and exits with its owner. It performs no desktop capture, file browsing, network access, or model access.
- Main may explicitly activate/deactivate a matched expression, trigger a matched `TriggerAnimation` hotkey, and set a fixed bounded idle signal through official tracking inputs while AI character control is active. It cannot load models/items, write arbitrary parameters, move the model, tint meshes, access files, or send arbitrary VTube Studio commands.
- The five-minute drowsy action closes the mapped eye parameters gradually, adds a stronger slow sleeping nod, and allows only a below-half-open peek while the pointer is nearby. A real user turn exits drowsy state with a slower wake transition; the conversation request carries only a validated boolean scene hint, and Main adds the bounded wake phrase to the stored visible reply.

## Current implementation order

1. Keep ViewerEX code present but default-off and stop extending it.
2. Use VTube Studio authorization and read-only inventory as the stable integration base.
3. Match completed reply emotions against expressions actually exposed by the current model. The initial hints cover happy/love, sad/cry, angry, surprised/shock, shy/blush, and playful/wink names.
4. Track only expressions activated by FPNF. A new matched emotion deactivates the previous FPNF-managed expression before activating the next one; user-managed expressions are not cleared globally.
5. Match requested character actions only to current-model hotkeys whose type is exactly `TriggerAnimation`.
6. Keep speech playback in FPNF and use the existing Live2D speech-level seam for lip sync; do not send audio files or arbitrary paths to VTube Studio.
7. Present the VTube Studio model through its transparent Spout2 sender. Keep the compatibility receiver at 30 FPS and a small target surface; treat a future DirectComposition zero-copy receiver as a performance refinement, not a security-boundary change.
8. Set smoothly interpolated randomized multi-axis head/body poses, eye targets, and randomized blinking at 10 FPS through VTube Studio's exclusive `set` mode. FPNF owns these fixed tracking inputs while AI character control is active; the current model maps them to its actual head, body, eyeball, and eyelid outputs.
9. Offer an opt-in mouse-tracking switch. Main reads and normalizes the local cursor position, revalidates finite bounded coordinates, blends movement into eyes and part of the head pose, then fades back to randomized idle after the pointer stops.

## Testing

Tests use only a temporary loopback WebSocket server, fake tokens, and temporary configuration directories. They do not read VTube Studio files or any real API key/token.

Official protocol reference: <https://github.com/DenchiSoft/VTubeStudio>
