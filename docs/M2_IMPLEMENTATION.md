# M2 Live2D 角色

## 范围

M2 在 M1 桌宠外壳内加入 Live2D Cubism 3/4/5 兼容模型加载、基础待机、自动眨眼、鼠标跟随，以及 State、Action、Emotion、Tracking 四通道最小控制架构。本里程碑不包含 Claude 或其他模型提供商、文字对话、长期记忆、语音、MCP、Agent 和桌面控制。

M1 的透明无边框置顶窗口、顶部拖动区、原生边缘缩放、状态恢复、托盘、单实例和显示器恢复保持不变。Main 和 Preload 没有新增权限或 IPC；Live2D 完全位于沙箱化 Renderer 内，只读取随应用提供的同源本地模型资源。

## Runtime 与许可结论

- 使用 `untitled-pixi-live2d-engine` 的 modern Cubism entry 和 PixiJS 8。该 entry 使用 Cubism 5 runtime，并面向 Cubism 3/4/5 `.model3.json`；不加载 Cubism 2。
- Live2D 官方说明：Web Framework 必须与单独下载的 Cubism Core 配合；新的 Core 对旧 `.moc3` 保持向后兼容，但新 Editor 特性需要匹配版本的 Core。参考 [官方 Web Framework](https://github.com/Live2D/CubismWebFramework)、[Cubism 3.3 兼容说明](https://docs.live2d.com/en/cubism-sdk-manual/warnnig-for-cubism3-3-00-update/) 和 [Cubism 5.3 兼容说明](https://docs.live2d.com/en/cubism-sdk-manual/compatibility-with-cubism-5-3/)。
- Cubism Core 受 Live2D Proprietary Software License 约束，官方测试角色还受 Free Material License、Sample Data Terms 和下载页条件约束。因此 Core、Simple model、Hiyori 及其他模型本体只放在已忽略的 `assets/models/local/`，不进入 Git。
- 发布前仍须换成自有、委托制作或明确获得发布授权的模型，并重新确认 SDK 发布许可要求。

## 本地模型清单

Renderer 固定读取 `assets/models/local/model.json`。清单只接受本地相对路径，拒绝 URL、绝对路径、反斜杠和 `..`，避免模型配置绕过同源资源边界。示例见 `assets/models/model.example.json`，详细步骤见 `assets/models/README.md`。

构建时 Vite 将 `assets/` 作为静态资源目录；`assets/models/local/` 仍由 Git 忽略。CI 不需要模型或 Cubism Core：构建验证加载器代码，运行时缺失资源会进入明确的可恢复错误界面。

## 四通道控制

合并顺序遵循技术计划：

```text
State → Action → Emotion → Tracking
```

- State：保存唯一持续状态 `idle | thinking | talking`。没有对应 Motion 时回退到 idle；Action 播放期间只更新目标状态，不抢占动作。
- Action：按 FIFO 顺序播放清单中的动作。每个动作完成或失败后继续下一项，队列清空后恢复最新 State；未知动作直接返回 `false`。
- Emotion：独立设置 Expression。模型不支持请求表情或播放失败时回退到 `neutral`，不影响 State/Action。
- Tracking：Renderer 内将指针归一化到 `[-1, 1]` 后交给 runtime 平滑跟随；Electron 路径另提供只读白名单接口，尝试按桌宠所在显示器映射系统光标，可关闭并复位到中心。

当前 Windows 手工验收中，全屏光标跟随在用户实际运行环境仍只表现为窗口/边框范围内可靠响应。M2 接受框内头眼跟随作为已知限制，不再继续修改；跨窗口稳定跟随、不同显示器坐标与刷新机制统一延期到 M3。现有只读白名单接口保留，但不得据此宣称 M2 已完成可靠的全屏跟随。

眨眼、呼吸等自然运动由 Cubism 模型的 EyeBlink Groups/参数和 runtime automator 驱动。部分模型用永久参数选择服装、身体或部件，清单可通过 `parameters` 声明这些值；Renderer 会在每帧动画合成后重新应用，避免被 Motion 或 Expression 淡出覆盖。循环待机 Motion 播放期间也会继续执行 EyeBlink，因此待机动作不会屏蔽自动眨眼。M2 不实现音频口型，也没有增加 LipSync 通道。

## 开源项目参考与取舍

以下项目只作为设计参考。引入代码或依赖前仍以许可证、当前技术栈兼容性和 M2 范围为准：

| 项目                                                                       | 优点与可借鉴点                                                                    | 限制与风险                                                                          | 本项目采用情况                                                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Soullink Emotion SDK](https://github.com/nanlingyin/soullink-emotion-sdk) | 引擎与渲染器分离；连续情绪、动作单元、模型 profile 和逐帧分层参数适合扩展角色表现 | Live2D renderer 面向 Pixi 7，而本项目使用 Pixi 8；planner、embedding、TTS 等超出 M2 | 不安装整套 SDK；采用轻量逐帧参数合成思路，用于模型永久参数，并保留四通道驱动边界 |
| [ayangweb/BongoCat](https://github.com/ayangweb/BongoCat)                  | 成熟的跨平台透明桌宠体验；输入事件映射、模型导入、离线运行和窗口交互值得参考      | Tauri/Rust/Vue 技术栈与 Electron 不同，角色格式也不是 Live2D Cubism                 | 借鉴输入与角色表现解耦、窗口交互清晰可见、模型资源本地化；不引入其运行时         |
| [ZcChat2](https://github.com/Zao-chen/ZcChat2)                             | 多表情、多动作组合、角色素材分层和演出效果适合未来丰富桌宠表现                    | 使用 GPL-3.0，不能把其实现直接复制进本项目；并且 AI、语音、记忆、桌面控制超出 M2    | 仅借鉴动作组合与资源描述思路；不复制 GPL 代码，不接入其 AI 功能                  |
| [EchoBot](https://github.com/KdaiP/EchoBot)                                | 本地 Live2D 目录导入/切换、全局眼神跟随开关和渲染设置分层清晰                     | Python/Web 架构与 Electron 不同；Decision、Roleplay、Agent、语音和记忆超出 M2       | 借鉴模型目录发现、全屏鼠标跟随和渲染设置边界；不接入 AI/Agent，不读取 API Key    |

当前容易、安全且直接改善 M2 的部分已经采用：模型完整等比例布局、根据最终 Alpha 像素绘制且不反向影响模型的可见边框、全屏系统光标到 Tracking 的只读映射、逐帧永久参数层，以及拖动区的可视提示。动作组合、模型选择界面、粒子和高级情绪混合保留为后续里程碑候选，不在 M2 扩张范围。

“列出项目名称、链接并说明设计影响”属于引用与独立分析，不等于复制代码。真正复制、修改、链接或发布代码时必须逐项遵守仓库许可证：MIT 项目需保留其版权与许可声明；GPL 代码若形成组合程序会带来 GPL 发布义务，因此本项目不复制 ZcChat2 实现；未声明许可证的公开仓库默认不能据此复制或分发。模型、贴图、音频和 Cubism Core 的授权独立于代码许可证，必须另行核对。此处记录是工程合规策略，不替代针对具体发布方式的法律意见。

## 错误与恢复

以下情况都会在透明窗口中显示可理解的信息和“重新加载”按钮，不会让 Electron 进程退出：

- `model.json` 缺失、JSON 损坏或字段不合法；
- Cubism Core 缺失、脚本损坏或未提供预期全局对象；
- `.model3.json`、`.moc3`、纹理、Motion、Expression、Physics 或 Pose 引用缺失；
- Core 版本无法读取模型的 `.moc3` 版本；
- WebGL/runtime 初始化失败。

用户补齐或修正本地文件后可直接点击重试。每次重载都会销毁旧 Pixi application 和 controller，避免重复 ticker 与 WebGL 资源。

## 验证

自动验证：

```powershell
pnpm verify
```

单元测试覆盖：模型清单成功与不安全路径拒绝、缺失模型错误、State/Action 不互相覆盖、Action FIFO 与状态恢复、Emotion neutral 回退、Tracking 限幅与关闭复位。Windows CI 在无模型、无 Core、无密钥环境执行完整 lint、格式、类型检查、单测和构建。

Windows 手工验收：

1. 不放置 `assets/models/local/model.json` 启动，确认显示缺失说明和可点击重试。
2. 按模型说明放入当前 Cubism 5 Core 与官方 Simple model 或 Hiyori，修改清单后点击重试，确认角色显示。
3. 观察待机和自动眨眼；在可见边框内移动鼠标，确认头部/视线平滑跟随。窗口外稳定跟随列为 M3 验收项。
4. 确认可见边框和顶部拖动提示贴合最终非透明画面；从顶部拖动区移动角色，从原生窗口边缘缩放，确认角色保持完整等比例显示，停止缩放后边框重新贴合且不会反向裁切模型；退出重启后确认位置和比例恢复。
5. 验证托盘隐藏/恢复、第二实例唤醒、显示器变化恢复仍正常。
6. 临时改错 Core 或模型路径，确认错误可读；修正后点击重试恢复。
7. 运行至少 30 分钟，反复隐藏/显示并观察动画和资源占用无持续异常增长。
