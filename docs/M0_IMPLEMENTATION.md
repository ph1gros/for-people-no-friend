# M0 工程骨架

## 范围

M0 只建立 Electron + TypeScript + Vite 工程、安全边界和自动检查，不包含 Live2D、模型提供商、长期记忆、语音、MCP 或桌面控制。

## 进程边界

- `src/main/`：Electron 生命周期、窗口创建和白名单 IPC 注册。
- `src/preload/`：通过 `contextBridge` 暴露最小 API。
- `src/renderer/`：Vite 驱动的透明空白页面，不具备 Node.js 权限。
- `src/shared/`：Main、Preload 与 Renderer 共用的 IPC 契约。

窗口明确设置 `nodeIntegration: false`、`contextIsolation: true` 和 `sandbox: true`，并拒绝 Renderer 发起的新窗口和页面导航。Renderer 使用内容安全策略限制脚本、样式和连接来源。当前唯一允许的 IPC 是无参数、只读的 `app:getVersion`。

## 本地开发

需要 Node.js 24 和 pnpm 11。

```powershell
pnpm install
pnpm dev
```

开发命令会启动 Vite、监视 Main/Preload TypeScript，并在资源就绪后打开透明无边框空白窗口。

## 验证

```powershell
pnpm verify
```

该命令依次运行 ESLint、Prettier 检查、TypeScript 类型检查、Vitest 和生产构建。GitHub Actions 在 Windows runner 上执行同一命令。
