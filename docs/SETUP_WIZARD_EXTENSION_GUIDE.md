# 首次运行向导扩展指南 / Setup Wizard Extension Guide

实现与验证边界见[首次运行向导实现](SETUP_WIZARD_IMPLEMENTATION.md)，交付结果见 [v1.8.3 交付记录](V1_8_3_DELIVERY.md)。资源中心当前提供十项组件。

## 1. 能力与版本缺口

| 能力                   | 当前实现 / 边界                                             |
| ---------------------- | ----------------------------------------------------------- |
| 服务商、模型与角色导入 | 复用既有存储和共享导入服务                                  |
| 语音输出与输入         | 固定 Genie / 伊蕾娜组合及 SenseVoiceSmall；输入默认手动录音 |
| 资源状态、体积与许可   | ResourceCenter + Main 固定信任记录                          |
| 下载与断点续传         | SpeechAssetManager；向导只控制固定资源组合                  |
| 计费网络               | 向导显式同意，默认阻止计费和未知成本网络                    |
| 步骤恢复与重跑         | schema v2，保留 v1 完成标记；托盘入口                       |
| 本地对话模型下载       | 未提供，当前十项组件均为语音相关                            |
| DPI、多屏、读屏        | 响应式与语义基础已实现，真实人工验收仍需进行                |

参考[资源中心](RESOURCE_CENTER.md)与[语音资产按需下载](SPEECH_ASSET_DOWNLOADS.md)。不要为了新页面自行实现 fetch、解压或完整性校验。

## 2. 加一个页面

1. 在 src/core/setup/setup-flow.ts 的 SETUP_STEP_IDS 与 createDefaultSetupSteps() 添加固定 ID、顺序和 isEnabled。条件不满足时跳过页面。
2. 若需要保存选择，更新 SetupSelections、DEFAULT_SETUP_SELECTIONS 及 shared/setup-ipc.ts 的解析器。给旧状态提供默认值，不保存密钥或任意路径。
3. 在 renderer/setup/pages.ts 或 resource-pages.ts 实现 SetupPage。commit 抛错留在本页；dispose 清理轮询、测试、事件和异步结果。
4. 更新 setup.ts 的 STEP_LABELS、PAGE_HEADINGS、PAGES。异步写操作使用 context.run 防止重复导航；资源未就绪时 setNextEnabled(false)。
5. 更新 SetupController 的选项变更位置校验与恢复行为，不能仅靠隐藏 UI 实现权限。
6. 覆盖 flow、IPC、controller、恢复、页面生命周期测试；运行 pnpm verify。

## 3. 加一个主进程能力

1. shared/ipc.ts 添加明确 setup: 通道。
2. shared/setup-ipc.ts（资源则 setup-resources.ts）添加窄类型和严格解析器。
3. setup-services.ts 或 setup-resource-service.ts 声明最小服务切片，复用现有服务实例。
4. SetupController 首先 requireActiveSession，并在异步边界后检查会话；需要有副作用时传递生命周期 AbortSignal。
5. register-setup-ipc-handlers.ts 增加接口、白名单和 handler，验证当前向导 main frame 与所有输入。
6. preload/setup.ts 暴露固定方法；不暴露通用 invoke、URL、文件路径或命令。
7. main/index.ts 注入同一实例。提前创建服务时确保首次运行进行中状态先于任何配置写入，退出时清理。
8. 补齐 ipc-contract、setup-ipc-validation、服务边界、取消及失败降级测试。

## 4. 资源扩展

- 新资源先进入既有目录与固定信任记录，遵循版本、哈希、大小和许可约束。
- setupResourceIds() 从固定组合展开依赖，保留 Set 去重以处理配套循环；Renderer 不提交任意 tierId 或下载地址。
- getStatus 提供真实库存，确认页扣除已 ready 资源的下载量；安装体积不能标成峰值占用。
- control 只复用既有任务；开始/继续必须检查可用性，计费同意不得从以前的向导会话继承。
- requireReady 与 apply 均在 Main 检查状态，不能把下载完成或 UI 选中视为校验通过。
- 跳过时清除本次启用意图，不撤销已有语音配置，也不删除已验证资源。

## 5. 人工验收清单

- Windows 100% / 125% / 150% DPI 下检查文字、进度、按钮、滚动和多屏移动。
- 仅用 Tab / Shift+Tab / 方向键 / Enter / Esc 走完推荐、自定义和取消路径；检查标题焦点和读屏提示。
- 人工测试服务商、角色包 / Live2D 系统对话框、同名替换确认和真实资源下载。
- 验证断网、磁盘不足、计费状态变化及取消后重启，未就绪语音不应阻止选择跳过。
- 已有配置主动重跑后退出，下次普通启动不再强制向导；主动重跑仍可恢复。

这些项目不因单元测试或 IPC 冒烟通过而自动视为完成。

## 6. 七条不可破坏的约束

1. **密钥永不回传。** 只返回 hasSecret，输入框从空开始，诊断不能包含秘密。
2. **Main 是权威。** 步骤、选项和完成判定必须在 Main 校验。
3. **只有存活的向导 main frame 能调用。** 桌宠、资源窗口和子框架不能借用权限。
4. **会话结束后拒绝迟到请求。** 包括 await 后的写入、测试和文件对话框结果。
5. **可选失败不拖垮基础功能。** 建窗失败回退主界面，资源失败可跳过。
6. **不复制既有路径。** 配置、密钥、导入、资源安装必须复用同一服务与写队列。
7. **升级用户不被强制走向导。** 历史标记必须是使用证据；初装进行中状态优先于后来产生的配置文件，重跑不得清除原完成标记。
