# Repository rules for coding agents

These rules apply to the entire repository and are mandatory for every coding task.

1. Read `docs/SECURITY_CODING_STANDARD.md` completely before changing code, tests, build configuration, storage, network behavior, IPC, character assets, or release configuration.
2. Work only inside this repository. Do not create another clone or worktree unless the user explicitly requests it.
3. Never request, read, print, store, or test with a real API key, token, password, private key, or personal credential. Use mocks, fakes, temporary databases, and local HTTP servers.
4. Preserve the Electron trust boundary: Main owns filesystem, secrets, databases, dialogs, and external network access; Preload exposes narrow typed methods; Renderer receives no Node.js or arbitrary IPC access.
5. Validate every IPC sender and every untrusted value again in Main. Renderer validation is usability only and is never a security boundary.
6. Do not add remote code execution, arbitrary file access, screen observation, desktop control, Agent, MCP, tool calls, voice capture, packaging, publishing, or external memory infrastructure without explicit user authorization for that milestone.
7. A failed optional subsystem must degrade safely and must not block basic text chat or local character display.
8. Keep character profiles, user memories, work glossaries, and character assets in explicit namespaces. Do not silently share data between characters.
9. Before handing off a code change, run the smallest relevant tests and, for milestone or cross-boundary changes, run `pnpm verify`.
10. Do not commit, push, publish, package, rewrite history, or change repository visibility unless the user explicitly asks for that operation.

If a requested change conflicts with the security standard, stop and explain the conflict before implementing it.
