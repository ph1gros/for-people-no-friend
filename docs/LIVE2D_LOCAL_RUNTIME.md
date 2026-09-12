# 本地 Live2D 运行时

纯 Live2D 的模型和 Cubism Core 属于不同边界：模型由 Main 校验后导入角色存储；Core 是应用控制的可执行运行时，不能由角色包指定或携带。

## 本地构建

普通 `pnpm build`、`pnpm build:renderer` 和 CI 不复制本地 Core，也不复制私人模型。需要在已有本地环境验证内嵌 Live2D 时，明确执行：

```powershell
pnpm build:renderer:local-core
```

该命令在 Renderer 构建中只提供 `assets/models/local/live2dcubismcore.min.js` 这一已知本地文件，输出为 `dist/renderer/runtime/cubism/live2dcubismcore.min.js`。不会扫描目录、复制相邻模型、执行下载或制作安装包。已构建的 Electron 可以用通常的启动方式加载它。

需要单独使用 Vite 本地开发服务器时，可执行 `pnpm exec vite --mode local-core --host 127.0.0.1`；该模式在同一固定运行时路由提供相同字节。默认 `pnpm dev` 不自动启用此模式。

构建前检查普通文件、体积和本地内容指纹；缺失或变化会明确失败。当前记录的 SHA-256 为 `8741f739779b5d5210872bd3d7d99f0f1e56e6c87409e7d26d6bb4b80aa1ef47`，只用于识别既有本地副本的变化，不是官方发布者的信任锚。更换版本需要先核对来源及兼容性，不能为了让构建通过而直接更改校验值。

执行普通 `pnpm build:renderer` 会清理带 Core 的 Renderer 输出，恢复普通构建。标准 `pnpm package:win` 会先执行普通完整构建；发布文件规则还显式排除 `dist/renderer/runtime/cubism/**/*`，防止跳过构建而意外收录本地 Core。当前没有提供包含 Core 的公开打包模式。打包与发布须获得对应版本授权。

## 缺失与失败行为

应用始终从固定 `runtime/cubism/` 路径加载 Core，导入模型中的路径不会改变可执行脚本来源。缺失、损坏和 30 秒加载超时分别保留错误类型；界面显示“Live2D 运行时不可用”，不会建议反复导入模型。已有模型保留，文字聊天及其他显示方式可继续使用。并发加载共用请求，失败后清理脚本与计时器，允许重试。

## 公开分发前仍需核对

本地文件与旧本地构建内容一致，仅说明历史连续性。尚未建立该文件对应的固定官方 SDK 版本、官方下载来源及原件核对记录；本地构建成功不能充当这些证明。

Cubism Core 受 [Live2D 专有软件许可](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)约束，不能由项目源码许可或非商业用途推定无条件分发。正式发布时应根据实际应用用途核对[官方 SDK 发布许可说明](https://www.live2d.com/en/sdk/license/)，包括可扩展应用的相关条件。本次未作公开分发授权结论，未把 Core 文件加入版本控制或资源下载目录。
