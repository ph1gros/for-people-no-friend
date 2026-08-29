# V1.5 小组件代码扩展指南

V1.5 的“小组件扩展”是仓库内的类型化开发接口，不是面向普通用户的插件市场或动态加载器。开发者或编码 AI 可以按本指南增加组件；应用不会从磁盘、网络、角色包或模型输出加载 JavaScript、DLL、命令或未知清单。

## 现有结构

- `src/renderer/widgets/widget-registry.ts` 注册组件名称、说明、图标、设置视图、权限、超时和状态展示。
- `src/shared/desktop-integration-ipc.ts` 维护允许的组件 ID、持久化顺序和专用启停输入校验。
- `DesktopIntegrationService.setWidgetEnabled` 在 Main Process 内把组件 ID 映射到固定设置能力；Renderer 不能传入命令名。
- `chat-controller.ts` 根据注册器生成组件卡片，并为组件连接显式的详情页与桌面叠层。

## 增加一个组件

1. 在 `DESKTOP_WIDGET_IDS` 增加稳定、简短的组件 ID。
2. 在 `desktopWidgetRegistry` 注册定义，声明最小权限、有限超时、卡片信息和状态解析；不得声明可执行入口。
3. 在 Renderer 增加对应叠层或详情视图，并补齐 `DesktopWidgetId` 的穷尽映射。缺少映射时 TypeScript 必须报错。
4. 若组件需要系统能力，在 Main Process 增加固定方法和允许列表；所有 IPC 输入在 Main 再校验。不要接受 shell、路径、代码片段、URL 动作或 Renderer 自定义命令。
5. 为合法输入、伪造 ID、重复注册、权限越界、失败回退、排序和关闭清理增加测试，然后运行 `pnpm verify`。

只需要 Renderer 展示、且不读取系统数据的组件也必须经过注册器，但可以声明空权限。涉及网络、文件、屏幕、输入正文、命令执行或桌面控制的组件不属于此接口，需要新的高风险里程碑和用户明确授权。
