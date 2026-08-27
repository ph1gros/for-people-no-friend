# M4 完整文字对话

## 范围

M4 在 M3 Provider 基础上完成第一条可用的角色对话链路：

- 桌宠窗口内的文字输入、流式字幕、停止生成和错误提示；
- 最近 20 条上下文、最近历史展示和单会话本地保存；
- 单角色的人格、简介、用户称呼和模型选择；
- `text + emotion + action` 结构化角色回复；
- 回复情绪和动作接入现有 Live2D State、Action、Emotion、Tracking 四通道；
- Main、Preload、Renderer 之间受限且可校验的流式 IPC；
- 沙箱 Preload 单文件构建和生产启动回归检查。

M4 不包含会话摘要、长期记忆、向量检索、多角色导入、语音、主动对话、MCP、Agent、工具调用、视觉或桌面控制。这些能力不能借人格或结构化回复之名提前进入当前范围。

## 用户交互

桌宠窗口增加三块覆盖层，但不修改 M2 已确认的模型可见边框：

- 底部输入框：Enter 发送，Shift+Enter 换行；生成时切换为“停止”；
- 流式字幕：只显示回复的 `text`，使用 `textContent`，不解析模型 HTML；
- 顶部抽屉：最近历史，以及紧凑的模型与人格设置。

设置抽屉同时提供 65%～150% 的桌宠大小滑杆和即时百分比。拖动滑杆时只更新百分比，松开后一次应用大小，避免窗口变化让滑块从指针下移走。缩放围绕当前窗口中心进行，并复用 M1 的多显示器可见区域修正与窗口状态持久化；原生窗口边缘缩放仍然保留。滑杆下方另有独立的“按住这里拖动窗口”区域，只承担原生窗口移动。

模型设置支持 Anthropic 和 OpenAI Compatible。OpenAI Compatible 可使用云端 HTTPS 地址，也可使用 `http://127.0.0.1:11434/v1` 等本地 Ollama/LM Studio 地址；本地无认证服务不要求 API Key。设置界面从不回显完整密钥，空输入不会覆盖 Main 中已经保存的密钥，并提供带确认的独立删除操作。

## 对话运行时

`ConversationRuntime` 只运行在 Electron Main：

1. 读取当前角色人格、最近历史和显式模型选择；
2. 模型未选择时返回统一 `configuration` 错误，不猜测默认模型；
3. 保存用户消息，并把最近最多 20 条、总计最多 24,000 字符的完整消息交给 `ModelRouter`；
4. 通过 M3 的 `streamChat()` 消费统一事件；
5. 只向 Renderer 发送可见文字增量；
6. 完成后保存回复、情绪、动作、Provider、模型和 token 使用量；
7. 取消时中止同一个 `AbortController`，可保存用户已经看到的部分回复，但标记为 `cancelled`，后续上下文不注入该部分回复。

同一时刻只允许一个角色回复，避免多个流同时修改字幕、历史和 Live2D 状态。应用退出会取消所有活动回复。

## 人格与角色卡

第一阶段角色资料包含：

- 稳定 ID、角色名称和对用户的称呼；
- 角色简介和可编辑人格提示词；
- Live2D 模型 ID 与未来记忆命名空间。

当前只实现单角色，但 ID、Live2D 模型和记忆命名空间仍分开保存，没有把未来多角色和 M5 记忆写死在默认角色中。人格提示词不是聊天历史，也不是长期记忆；M4 不根据聊天内容自动改写稳定人格。

## 结构化回复与流式降级

内部结果沿用技术计划：

```ts
interface CharacterReply {
  text: string;
  emotion: 'neutral' | 'happy' | 'sad' | 'angry' | 'surprised' | 'shy' | 'playful';
  action?: string;
}
```

当前两个 Provider 只声明已经验证的 `streaming` 能力。由于用户输入的 Claude、OpenAI Compatible 和本地模型 ID 无法可靠推断是否支持原生 JSON Schema，M4 不盲目发送厂商专用结构化参数，而是使用兼容 JSON 提示词和严格的本地解析器：

- 增量解析 JSON 的 `text` 字段，字幕无需等待整个 JSON 完成；
- 正确处理转义字符和跨网络分片；
- 非 JSON 回复立即按普通文字流式显示；
- JSON 解析失败、未知情绪或未知动作都保留可见正文并回退 `neutral`；
- `action` 必须匹配 Renderer 从当前 Live2D manifest 提供的动作白名单；
- Live2D 本身仍会对缺失 Expression 或 Motion 再做一次安全回退。

Anthropic 当前官方结构化输出使用 `output_config.format`，OpenAI 支持模型可使用 JSON Schema response format。未来只有在模型能力可被可靠配置或发现时才启用原生能力；启用不需要修改 `ConversationRuntime` 的业务结果。

官方参考：

- [Anthropic Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat)
- [Ollama OpenAI Compatibility](https://docs.ollama.com/api/openai-compatibility)

## 历史与本地数据

M4 使用 Electron `userData` 下的两个普通本地文件：

- `character-profile.v1.json`：单角色资料与人格提示词；
- `conversation.v1.json`：当前单会话消息，最多保存 2,000 条，界面读取最近 100 条。

写入采用临时文件加原子重命名，并串行化并发 append。对话文件不保存 API Key。M5 会引入 SQLite、会话摘要、记忆数据表和迁移；M4 不伪装成长期记忆实现。

## IPC 与 Electron 安全

M4 新增的每个请求都执行运行时校验：

- request ID、用户文字、模型 ID、Provider ID、动作列表和角色字段均有类型、长度与格式边界；
- 每个 handler 继续要求 sender 是当前桌宠窗口的 main frame；
- Renderer 没有通用 `invoke` 或 `send`；
- Main 到 Renderer 的流事件在 Preload 再校验一次；
- 模型正文只作为文本渲染，不进入 `innerHTML`；
- API Key 仍只由 Main 的 `safeStorage` 保存和读取。

实际 Electron 冒烟检查发现，`sandbox: true` 的 Preload 不能加载 TypeScript 编译后留下的相对 CommonJS 模块。M4 保留沙箱并增加 Vite 单文件 `index.cjs` bundle；`smoke:preload` 会验证 bundle 存在 Context Bridge 且不含相对 `require()`。这项检查已加入 `pnpm verify` 和 Windows CI。

## 开源项目参考与取舍

| 项目                                                                       | M4 相关实现                                                              | 本项目采用与拒绝                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| [Soullink Emotion SDK](https://github.com/nanlingyin/soullink-emotion-sdk) | Persona、ConversationTurn、ReplyDraft、EmotionIntent、动作计划和失败降级 | 采用“文本、情绪、动作”统一结果和模型表现失败不阻断聊天；不引入 VAD、FACS Planner、TTS、Embedding 或主动事件  |
| [EchoBot](https://github.com/KdaiP/EchoBot)                                | 会话历史归一化、流式任务状态、停止操作和人格切换                         | 采用历史与活动请求分离、显式停止和纯文本历史渲染；不引入 Agent、工具、图片、平台频道或语音                   |
| [ZcChat2](https://github.com/Zao-chen/ZcChat2)                             | Galgame 对话层、角色配置、历史窗口和按完整轮次保留最近上下文             | 采用最近完整消息和独立历史面板的体验；GPL-3.0 代码不复制，摘要压缩留到 M5                                    |
| [my-neuro](https://github.com/morettt/my-neuro)                            | 动态人格、情绪动作映射和主动对话                                         | 采用稳定人格与当前表现分层；不采用按轮次额外调用模型重写人格、心情定时器、主动对话或会记录私密正文的调试方式 |
| [ayangweb/BongoCat](https://github.com/ayangweb/BongoCat)                  | 透明桌宠覆盖层、窗口交互与资源职责划分                                   | 保持聊天覆盖层与窗口/Live2D runtime 解耦；没有为 M4 引入键盘监听或桌面控制                                   |

以上仅记录架构影响并独立实现。my-neuro、EchoBot、Soullink 当前标明 MIT；ZcChat2 为 GPL-3.0。

## 测试与验证

自动测试只使用 fake 模型事件、临时目录和 M3 的本地 `127.0.0.1` fake HTTP，不访问真实模型端点，也不读取、请求或记录用户的 Claude API Key。

覆盖内容包括：

- JSON/普通文本流式回复、转义、情绪和动作白名单回退；
- 最近 20 条与字符预算；
- 人格与会话原子持久化、并发 append 和清空；
- 完整 ConversationRuntime 流、token 记录和缺少配置错误；
- M4 IPC 输入、Main 到 Renderer 事件和明确白名单；
- 沙箱 Preload 单文件构建；
- M0 至 M3 的窗口、Live2D、Provider、密钥和 IPC 回归测试。

本地验证：

```powershell
pnpm verify
pnpm start
```

生产启动冒烟检查只确认 Context Bridge 与 Live2D 能正常启动，不会自动发起真实模型请求。

## 已知限制

- 当前是单角色、单会话；多角色和多会话管理不属于 M4。
- 当前 Provider 没有模型能力发现，结构化输出使用兼容提示词与安全解析器，而不是盲目启用原生 JSON Schema。
- 自动测试不使用真实 Claude、Ollama 或其他模型；真实连接必须由用户在界面中自行配置并主动测试。
- M2 的 Windows 跨窗口全屏鼠标跟随遗留仍未改变；本次没有修改通用视觉边框或跟踪链路。
