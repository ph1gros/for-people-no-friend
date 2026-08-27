# M3 模型提供商与 Claude

## 范围

M3 建立与聊天界面无关的模型基础设施：

- 内部 LlmProvider、ChatRequest、ChatEvent 与能力协议；
- ProviderRegistry、按任务显式分配的 ModelRouter 和 disabled 安全空实现；
- Anthropic 原生 Messages API Provider；
- OpenAI Compatible Chat Completions SSE Provider；
- 连接测试、AbortSignal 取消与统一错误；
- Electron Main 中的普通 Provider 配置和 safeStorage 加密密钥存储；
- 受限、可校验的 Main、Preload、Renderer IPC 边界。

M3 不包含聊天输入、流式字幕、历史、人格卡、结构化情绪或动作输出、长期记忆、语音、MCP、Agent 或桌面控制。这些仍按后续里程碑实施。

## 内部协议与路由

业务代码只依赖 src/core/llm：

- LlmProvider.streamChat() 将厂商响应转换为 text-delta、usage 和 finish 事件；
- listCapabilities() 显式声明能力，当前两个 Provider 都只声明已经实现的 streaming；
- ProviderRegistry 拒绝空 ID、重复注册和未知 Provider；
- ModelRouter 根据 conversation、memoryExtraction、summarization 的明确分配选择 Provider；
- Router 不进行静默回退，避免把私密内容自动发送给另一个云端服务；
- responseSchema 已保留在内部协议中，但 M3 Provider 不宣称或实现结构化输出。该能力属于 M4。

统一错误代码：

| 内部错误          | 含义                     |
| ----------------- | ------------------------ |
| authentication    | 密钥被拒绝               |
| rate-limit        | 频率或额度限制           |
| network           | 网络或连接失败           |
| model-not-found   | 模型不存在               |
| context-too-long  | 上下文过长               |
| provider-response | HTTP 或流式响应异常      |
| cancelled         | 用户取消                 |
| configuration     | Provider、模型或设置无效 |

对 Renderer 只返回简短、脱敏的公共错误，不返回厂商原始响应、请求正文、Authorization Header 或密钥。

## Anthropic Provider

AnthropicProvider 只在适配器内部使用 Anthropic 官方 TypeScript SDK。实现遵循官方 Messages API：

- 使用 POST /v1/messages；
- 系统内容使用顶层 system，不伪装成 system 消息；
- SDK 负责 x-api-key 和 anthropic-version；
- 使用 stream: true；
- content_block_delta.text_delta 转为内部文字增量；
- message_start 与 message_delta 汇总 token 使用量；
- 只有收到 message_stop 才判定流完整；
- 未知新增事件安全忽略，提前断流转换为统一错误；
- AbortSignal 传入 SDK；SDK 抛错或直接结束迭代两种取消表现都转换为 cancelled；
- 网络请求默认 60 秒超时，超时转换为可重试的 network 错误，不与用户取消混淆。

参考：

- [Anthropic Create a Message](https://platform.claude.com/docs/en/api/messages/create)
- [Anthropic Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Anthropic API Versioning](https://platform.claude.com/docs/en/api/versioning)
- [Anthropic TypeScript SDK](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript)

模型 ID 完全来自调用方选择，没有长期写死默认模型。

## OpenAI Compatible Provider

兼容层采用 Chat Completions 的 data-only SSE：

- 在配置的 base URL 后解析 /chat/completions；
- 请求使用 messages、model、stream: true、可选 temperature 和 max_tokens；
- 解析 choices[0].delta.content、finish_reason、可选 usage 和终止标记 [DONE]；
- 支持 CRLF、LF、跨网络块和多个 data 行；
- 畸形 JSON、缺少 body、错误对象或未完整结束的流转换为 provider-response；
- API Key 为空时不发送 Authorization，支持无认证的本地 Ollama 或 LM Studio；
- 远程端点必须使用 HTTPS；HTTP 只允许 localhost、127.0.0.1 和 ::1；
- URL 不允许嵌入用户名、密码、query 或 fragment，防止密钥被发送到含混端点；
- 网络请求默认 60 秒超时，外部 AbortSignal 仍可立即取消。

OpenAI 官方目前推荐新项目使用 Responses API，但仍明确记录 Chat Completions 的 data-only SSE、delta 和 [DONE]。M3 为覆盖 OpenAI、DeepSeek、通义兼容层、Ollama、LM Studio 等广泛实现，选择兼容性更好的 Chat Completions；未来可另加 Responses Provider，不需要修改业务协议。

参考：

- [OpenAI Chat Completions API](https://developers.openai.com/api/reference/resources/chat)
- [OpenAI Streaming API Responses](https://developers.openai.com/api/docs/guides/streaming-responses)

## 开源项目参考与取舍

| 项目                                                                       | M3 相关技术                                                                      | 本项目结论                                                                                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [morettt/my-neuro](https://github.com/morettt/my-neuro)                    | 统一 OpenAI Compatible 客户端、流式增量、兼容消息清理和运行时配置更新            | 采用统一 Provider、严格 SSE 分片和配置解耦；不采用会输出请求或完整响应的调试方式，不引入工具调用、视觉和插件            |
| [EchoBot](https://github.com/KdaiP/EchoBot)                                | Provider 抽象、60 秒超时、OpenAI Compatible 流式接口、系统消息归并和额外参数配置 | 采用明确 60 秒超时和 Provider 端口；当前内部协议只有一个 systemPrompt，不需要归并；extra body、工具和附件留待对应里程碑 |
| [Soullink Emotion SDK](https://github.com/nanlingyin/soullink-emotion-sdk) | 上游密钥只在可信服务端、接口注入、按服务设置超时、失败时保持角色本地表现         | 已采用 Main-only 密钥、依赖注入和模型失败不影响 Live2D；情绪 Planner、TTS、Embedding 不进入 M3                          |
| [ZcChat2](https://github.com/Zao-chen/ZcChat2)                             | Provider 配置、连接测试、模型获取和流式交互的完整设置体验                        | 借鉴“配置、测试、选择”分步体验；模型列表和设置 UI 属于后续里程碑；项目为 GPL-3.0，不复制实现                            |
| [ayangweb/BongoCat](https://github.com/ayangweb/BongoCat)                  | 桌宠输入、窗口、托盘、资源与运行时职责划分                                       | 继续保持窗口和模型 Provider 解耦；它没有值得在 M3 引入的模型协议实现，不为凑功能改动窗口层                              |
| [EchoBot](https://github.com/KdaiP/EchoBot) 的眼神跟随                     | Web/Live2D 内局部鼠标跟随与开关                                                  | 不能直接解决 Electron Windows 跨窗口系统光标问题；不以 Web 局部方案替换现有全局链路                                     |

my-neuro、EchoBot 和 Soullink 当前仓库标明 MIT；ZcChat2 为 GPL-3.0。以上只记录独立分析和设计影响，没有复制参考项目源码。

## 配置、密钥与 IPC 安全

普通 Provider 配置保存在 Electron userData/model-providers.v1.json。当前只包含 OpenAI Compatible base URL。

密钥保存在 userData/secrets.v1.json：

- 仅 Electron Main 调用异步 safeStorage.encryptStringAsync() 和 decryptStringAsync()；
- Windows 使用操作系统 DPAPI 保护密钥；
- 磁盘文件只保存 base64 编码的密文字节；
- 每个 Provider 使用独立 Secret ID；
- 空值、纯星号掩码、超长值和非法 Secret ID 都被拒绝；
- Renderer 只能读取 boolean 配置状态，不能读取、解密或回显完整 Key；
- 删除密钥是独立操作，空输入不会覆盖已有密钥；
- M3 运行时代码不读取 .env 或用户已经准备的 Claude API Key。

Electron 边界保持：

- nodeIntegration: false；
- contextIsolation: true；
- sandbox: true；
- Preload 只暴露逐方法白名单，不暴露通用 send 或 invoke；
- 每个 IPC handler 同时校验 event.sender 和 event.senderFrame 必须属于当前主窗口；
- 所有写入、连接测试和取消参数都做运行时类型、长度、枚举与格式校验；
- 导航、新窗口、webview 和权限请求仍被拒绝。

参考：

- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [Electron Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)

## 连接测试与取消

连接测试复用 Provider 的正常流式路径，并使用最多 1 个输出 token 的最小请求，同时验证密钥、模型访问、HTTP/SSE 连接和事件转换。

每个 IPC 连接测试需要独立、受限格式的 requestId。Main 为正在运行的测试保存 AbortController；取消 IPC 只能取消同一 Main 运行时中已登记的请求。应用退出时会取消全部未完成测试。

M4 可以直接复用 Provider 的 AbortSignal 接口实现“停止生成”，无需把网络请求移入 Renderer。

## 测试与验证

所有自动 Provider 测试只使用进程内 127.0.0.1 fake HTTP server 和明确的 fake key。测试不索取、不读取、不记录、不使用真实 Claude 或其他 API Key，也不访问真实模型端点。

覆盖内容：

- Registry 注册、重复与未知 Provider；
- Router 显式任务选择且不静默回退；
- Anthropic Messages 请求形状、流式事件、usage、错误、超时和取消；
- OpenAI Compatible Chat Completions SSE、URL 安全、错误、超时和取消；
- IPC 白名单、参数边界与 sender/main-frame 校验；
- safeStorage 抽象下的密文落盘、状态读取、删除和掩码拒绝；
- 普通 base URL 配置保存与不安全远程 HTTP 拒绝；
- 原有 M0 至 M2 窗口、Live2D 与运行时测试回归。

本地完整验证：

```powershell
pnpm verify
```

Windows CI 在没有模型、Cubism Core 和 API Key 的环境运行相同命令。

## M2 全屏鼠标跟随遗留评估

M3 对现有链路做了独立审查：

```text
Electron Main screen.getCursorScreenPoint()
  → 当前显示器 workArea 归一化
  → 只读白名单 IPC
  → Renderer 定时更新 TrackingChannel
  → Live2D focusController
```

坐标映射单元测试通过，Live2D runtime 的局部自动 autoFocus 已关闭。但用户环境中“窗口外不继续跟随”的现象没有可在自动测试中复现的稳定根因。进一步修改轮询策略、窗口命中区域或透明窗口行为需要专门的 Windows 运行时诊断，并可能干扰已经确认正确的通用视觉边框。

因此 M3 不修改视觉边框和 Tracking 行为，只保留该遗留项。后续应在目标用户环境增加不含隐私内容的临时诊断（IPC 调用成功率、系统光标坐标和 Renderer 更新计数），定位是 Electron screen、IPC 调度、计时器节流还是模型参数覆盖后再修复。
