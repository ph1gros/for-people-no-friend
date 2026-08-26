# For people no friend 详细技术计划书

> 文档状态：1.0.0 功能基线
> 目标平台：Windows  
> 产品定位：以角色陪伴为核心的轻量 AI 桌宠  
> 首发模型：Claude 云端 API  
> 架构要求：模型提供商可扩展，不锁定 Claude  

## 1. 项目结论

For people no friend 是一个独立项目，不以完整 Agent 平台为目标。第一阶段优先完成稳定的桌面角色、文字对话、人格与情绪表现；随后加入简单、透明、可管理的长期记忆；语音放在长期记忆之后。

M0～M5.2 已组成 1.0.0 功能基线。这里的“1.0.0”表示核心功能和安全边界已经形成稳定基线，不表示 Windows 安装包、签名、升级或公开发布已经完成；这些仍属于 M6 发布工程。

项目采用单个 Electron 应用，核心数据保存在本机 SQLite。Claude 只是首个模型适配器，聊天、记忆、Live2D 和界面不得直接依赖 Anthropic SDK。后续应能接入 OpenAI、DeepSeek、通义千问、Gemini、Ollama、LM Studio 等接口，而不重写业务层。

### 1.1 已确定的产品方向

- Windows 首发。
- Live2D 二维角色。
- 第一阶段使用文字输入与字幕回复。
- Claude 作为首个云端模型。
- 模型接口可增加、可切换。
- 长期记忆保存在本机。
- 不使用 Neo4j，不要求向量数据库。
- 不在本机运行大语言模型，但预留 Ollama、LM Studio 接口。
- 语音、口型同步放到后续版本。
- 不包含主播、直播、弹幕和观众互动。
- 不在早期加入 MCP、自动电脑控制、多 Agent 或插件市场。

### 1.2 核心体验

```text
启动桌宠
  ↓
恢复上次位置、角色和设置
  ↓
Live2D 角色待机、眨眼、跟随鼠标
  ↓
用户打开输入框并发送文字
  ↓
人格 + 最近对话 + 会话摘要 + 相关长期记忆
  ↓
通过已选择的模型提供商生成回复
  ↓
字幕 + 情绪 + 动作驱动 Live2D
  ↓
后台更新会话摘要和长期记忆
```

## 2. 范围控制

### 2.1 第一阶段必须完成

1. 透明、无边框、置顶的 Windows 桌宠窗口。
2. Live2D 模型加载、待机、眨眼和鼠标跟随。
3. 角色拖动、缩放、点击区域和位置保存。
4. 文字输入框、流式字幕、取消生成和错误提示。
5. 可编辑的角色人格与角色卡。
6. Claude 原生 API 适配器。
7. OpenAI 兼容 API 适配器。
8. 模型提供商注册、选择、连接测试和能力声明。
9. 最近对话历史和会话持久化。
10. 结构化情绪与动作输出。
11. Live2D 状态、动作、表情和追踪分层控制。
12. 系统托盘、单实例、显示、隐藏和退出。
13. 本地安全保存 API Key。
14. Windows 安装包和基础自动更新预留。

### 2.2 长期记忆阶段必须完成

1. SQLite 本地数据库。
2. 跨会话摘要。
3. 用户主动说“记住”和“忘记”。
4. 自动提取少量重要记忆。
5. 记忆去重、更新、过期和冲突处理。
6. 记忆检索与上下文注入。
7. 记忆查看、修改、删除和总开关。
8. 数据导出、备份和清空。

### 2.3 1.0.0 不实现

- 本地大模型训练或微调。
- Neo4j、独立向量数据库和知识图谱可视化。
- Python 后端和多个固定端口服务。
- ASR、TTS、声音克隆和实时打断。
- 直播、弹幕、主播控制台和观众互动。
- 自动截图、屏幕常驻观察和键鼠控制。
- 任意代码执行。
- MCP、完整 Agent、多 Agent 和插件市场。
- 账号系统、云端记忆同步和社区市场。

以上能力可以在 1.0.0 之后重新评估。其中 Qdrant、Embedding、Neo4j、Python 记忆服务、独立画像 API Key、Agent、MCP 和工具调用均不得以维护或小修名义混入 1.0.0；采用顺序、条件和权限边界见 [1.0 之后路线](POST_V1_ROADMAP.md)。

## 3. 总体技术架构

```text
┌──────────────── Electron Renderer ────────────────┐
│ Live2D Canvas │ 字幕气泡 │ 输入面板 │ 设置页面    │
│ 只负责展示和交互，不持有 API Key 和高权限能力    │
└──────────────────────┬────────────────────────────┘
                       │ 受限 IPC
┌──────────────── Electron Main Process ────────────┐
│ WindowManager       窗口、托盘、单实例、位置恢复  │
│ ConversationService 对话流程与取消                │
│ ContextAssembler    人格、历史、摘要、记忆组装    │
│ ModelRouter         模型选择与任务路由            │
│ ProviderRegistry    模型适配器注册                 │
│ MemoryService       摘要、提取、检索、删除         │
│ CharacterService    角色卡与模型资源               │
│ SecretStore         API Key 加密保存               │
│ SQLite              消息、摘要、长期记忆           │
└──────────────────────┬────────────────────────────┘
                       │ HTTPS
             Claude / OpenAI兼容 / 其他接口
```

### 3.1 为什么保持单应用

- 安装简单，不要求用户配置 Python、Docker 或数据库服务。
- 没有多个后台端口和进程需要管理。
- 对话、记忆和 Live2D 可以在统一生命周期中启动和停止。
- Windows 打包、升级和卸载更稳定。
- 本地内存和磁盘占用更容易控制。

### 3.2 安全边界

- Renderer 设置 `nodeIntegration: false`。
- Renderer 开启 `contextIsolation: true`。
- 只通过 preload 暴露白名单 IPC。
- API Key 仅在 Main Process 解密和使用。
- IPC 参数使用运行时 Schema 校验。
- Live2D 模型文件不获得系统命令执行能力。
- 第一阶段不请求截图、全局键盘监听或桌面控制权限。

## 4. 推荐目录结构

```text
for-people-no-friend/
├── docs/
│   ├── PRODUCT_PLAN_V1.md
│   ├── TECHNICAL_PLAN_V1.md
│   ├── PROJECT_CONTEXT.md
├── src/
│   ├── main/
│   │   ├── app/
│   │   ├── windows/
│   │   ├── tray/
│   │   ├── ipc/
│   │   ├── storage/
│   │   └── security/
│   ├── renderer/
│   │   ├── live2d/
│   │   ├── chat/
│   │   ├── settings/
│   │   └── components/
│   ├── core/
│   │   ├── conversation/
│   │   ├── context/
│   │   ├── llm/
│   │   ├── memory/
│   │   ├── character/
│   │   └── emotion/
│   ├── adapters/
│   │   ├── llm/
│   │   ├── storage/
│   │   └── speech/
│   └── shared/
│       ├── contracts/
│       └── validation/
├── assets/
│   └── models/
│       ├── README.md
│       └── local/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── .env.example
├── package.json
└── README.md
```

## 5. 可扩展模型接口

### 5.1 设计原则

- `ConversationService` 不导入 Anthropic 或 OpenAI SDK。
- `MemoryService` 不直接调用 Claude。
- 所有模型输出统一转换为内部事件。
- 每个提供商声明自己的能力，而不是假设全部模型功能相同。
- 对话模型、摘要模型和记忆提取模型可以分别选择。
- 第一阶段采用代码内注册，不做可下载插件。

### 5.2 核心接口

```ts
export type ProviderCapability =
  | "streaming"
  | "structured-output"
  | "vision"
  | "tool-use";

export interface ModelSelection {
  providerId: string;
  modelId: string;
}

export interface ChatRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  responseSchema?: object;
  temperature?: number;
  maxOutputTokens?: number;
}

export type ChatEvent =
  | { type: "text-delta"; text: string }
  | { type: "structured-result"; value: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "finish"; reason: string };

export interface LlmProvider {
  readonly id: string;
  readonly displayName: string;

  listCapabilities(modelId: string): Set<ProviderCapability>;

  streamChat(
    request: ChatRequest,
    selection: ModelSelection,
    signal?: AbortSignal,
  ): AsyncIterable<ChatEvent>;

  testConnection(selection: ModelSelection): Promise<ConnectionResult>;
}
```

### 5.3 Provider Registry

```ts
class ProviderRegistry {
  register(provider: LlmProvider): void;
  get(providerId: string): LlmProvider;
  list(): LlmProvider[];
}
```

第一阶段注册：

```text
anthropic             → Claude 原生 Messages API
openai-compatible     → OpenAI、DeepSeek、通义千问、Ollama、LM Studio
disabled              → 未配置时的安全空实现
```

未来可以增加：

```text
google-gemini
azure-openai
amazon-bedrock
custom-proxy
```

增加新接口时，只新增适配器并注册，不修改 `ConversationService`、`MemoryService` 或 Live2D 代码。

### 5.4 模型任务路由

```ts
export interface ModelAssignments {
  conversation: ModelSelection;
  memoryExtraction: ModelSelection;
  summarization: ModelSelection;
}
```

典型使用：

- Claude 高质量模型负责角色对话。
- 较快、较便宜的云端模型负责摘要和记忆提取。
- 本地 Ollama 可以只负责摘要。
- 某提供商不可用时，用户手动切换，不静默发送到其他云端。

### 5.5 统一错误类型

模型适配器必须将厂商错误转换为内部错误：

```text
AuthenticationError    密钥无效
RateLimitError         请求过快或额度不足
NetworkError           网络不可用
ModelNotFoundError     模型名称无效
ContextTooLongError    上下文过长
ProviderResponseError  返回格式异常
CancelledError         用户取消
```

界面显示简短信息，详细错误写入本地日志，但日志不得记录 API Key 或完整隐私对话。

## 6. Claude 首发接入

### 6.1 接入方式

- 使用 Anthropic 原生 TypeScript SDK和 Messages API。
- SDK 只存在于 `AnthropicProvider` 中。
- 使用流式输出降低等待感。
- API Key 只从 `SecretStore` 获取。
- 模型名称由设置保存，不硬编码到聊天服务。
- 所有请求支持 `AbortSignal`，允许用户停止生成。

### 6.2 Claude 不可用时

- Live2D、托盘、设置和历史记录继续工作。
- 输入框显示当前提供商不可用。
- 不自动把隐私内容发送给另一个提供商。
- 用户可以在设置中切换到 OpenAI 兼容接口。

### 6.3 成本控制

- 只发送最近消息、摘要和少量相关记忆。
- 不把整个数据库发送给模型。
- 记忆提取不在每一轮执行。
- 保存每次请求的 token 使用量。
- 对固定且较长的人格内容预留 Prompt Caching 支持，但不作为第一阶段依赖。

## 7. 对话流程

```text
用户输入
  ↓
输入校验与长度限制
  ↓
ContextAssembler
  ├── 角色人格
  ├── 当前角色状态
  ├── 会话摘要
  ├── 最近 20 条消息
  └── 最相关的 3～8 条长期记忆
  ↓
ModelRouter → 已选 Provider
  ↓
统一流式 ChatEvent
  ├── Renderer 显示字幕
  ├── EmotionParser 提取情绪
  └── 用户可随时取消
  ↓
保存完整回复
  ↓
后台摘要与记忆任务
```

### 7.1 结构化角色回复

业务层使用统一结果：

```ts
export interface CharacterReply {
  text: string;
  emotion: "neutral" | "happy" | "sad" | "angry" | "surprised" | "shy" | "playful";
  action?: string;
}
```

如果当前模型支持结构化输出，适配器使用其原生能力；如果不支持，则使用 JSON 提示词和安全解析。解析失败时保留正文并回退到 `neutral`，不能让对话失败。

## 8. 长期记忆设计

### 8.1 目标

长期记忆服务于角色持续性，而不是构建通用知识库。系统优先记住：

- 用户稳定偏好。
- 重要人物和关系。
- 已发生的重要事件。
- 用户计划、承诺和目标。
- 用户明确要求记住的内容。

默认不保存：

- 普通寒暄。
- 模型自己的猜测。
- 假设、玩笑和角色扮演内容。
- 密码、API Key、银行卡等敏感信息。
- 用户明确要求不要保存的内容。

### 8.2 三层上下文

```text
短期记忆：最近 20 条消息
中期记忆：当前会话结构化摘要
长期记忆：SQLite 中筛选出的稳定记忆
```

三层必须分开。人格提示词不是记忆，Live2D 心情状态也不是用户事实。

### 8.3 SQLite 数据表

第一阶段只使用三张主表：

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  provider_id TEXT,
  model_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE session_summaries (
  conversation_id TEXT PRIMARY KEY,
  summary_json TEXT NOT NULL,
  covered_until_message_id TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  content TEXT NOT NULL,
  importance REAL NOT NULL,
  confidence REAL NOT NULL,
  source_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_confirmed_at INTEGER,
  expires_at INTEGER,
  status TEXT NOT NULL
);
```

记忆类型：

```text
preference  偏好
person      人物与关系
event       已发生事件
plan        计划或目标
fact        稳定事实
```

状态：

```text
active       当前有效
superseded   已被新记忆替代
deleted      已删除
```

### 8.4 记忆写入

触发条件：

1. 用户明确说“记住”：立即创建候选记忆。
2. 每累计 10～15 轮对话：后台提取一次。
3. 会话长时间无操作或关闭：更新会话摘要。
4. 每次自动提取最多写入 3 条记忆。

提取结果必须包含：

```ts
interface MemoryCandidate {
  type: MemoryType;
  normalizedKey: string;
  content: string;
  importance: number;
  confidence: number;
  expiresAt?: number;
}
```

写入前执行：

- 敏感信息过滤。
- 空内容和低置信度过滤。
- 相同 `normalizedKey` 去重。
- 与现有事实进行冲突判断。
- 记录来源消息。
- 用户手动记忆优先级高于自动记忆。

### 8.5 冲突与更新

示例：

```text
旧：用户喜欢草莓蛋糕
新：用户现在不喜欢草莓蛋糕
```

不能同时将两条都作为有效事实注入。新记忆写入后，旧记忆标记为 `superseded`。无法判断时不自动覆盖，放入待确认状态或降低置信度。

### 8.6 记忆检索

第一版使用 SQLite FTS5 或关键词匹配，不加载本地 Embedding 模型。

```text
相关分数 =
关键词匹配 × 0.50
+ 重要性 × 0.25
+ 最近确认时间 × 0.15
+ 最近使用时间 × 0.10
```

每轮最多注入 3～8 条，设置总字符或 token 上限。检索不到时正常对话，不让记忆失败阻塞回复。

### 8.7 用户控制

设置页面提供：

- 自动记忆总开关。
- 记忆列表和分类筛选。
- 查看记忆来源。
- 手动修改和删除。
- “忘掉这件事”。
- 导出 JSON。
- 清空全部记忆。
- 清空操作需要二次确认。

## 9. 角色卡设计

```json
{
  "id": "default-character",
  "name": "角色名称",
  "userDisplayName": "主人",
  "bio": "角色简介",
  "personaPromptFile": "persona.md",
  "live2dModelId": "simple-model",
  "emotionMapFile": "emotions.json",
  "actionMapFile": "actions.json",
  "memoryNamespace": "default-character"
}
```

角色卡绑定人格、Live2D 模型、表情动作映射和记忆空间。未来加入多个角色时，可以决定角色之间是否共享用户事实；第一阶段只实现单角色，但数据结构不写死。

导入自定义模型时，将完整模型目录复制到应用用户数据目录，配置只保存 `modelId` 和相对路径，不保存临时 URL。

## 10. Live2D 控制架构

采用四个相互独立的表现通道：

| 通道 | 内容 | 规则 |
|---|---|---|
| State | idle、thinking、talking | 持续状态，只允许一个主状态 |
| Action | 点头、摇头、挥手 | FIFO 队列，动作完成后返回状态 |
| Emotion | happy、sad、shy 等 | 叠加或平滑过渡 |
| Tracking | 鼠标与视线跟随 | 可关闭，可设置延迟 |

推荐合并顺序：

```text
State → Action → Emotion → Tracking
```

第一阶段不做音频口型；为第二版保留 `LipSyncChannel`，以后插入 State 与 Action 之间。

## 11. 桌面窗口与可靠性

必须专门测试：

- 只允许一个应用实例。
- 第二次启动时唤醒已存在窗口。
- 重启后恢复上次位置和缩放。
- 分辨率或显示器变化后将窗口移回可见区域。
- 拔掉副显示器后不丢失窗口。
- 透明窗口不允许进入不可靠的最大化状态。
- 托盘可恢复隐藏窗口。
- 右键菜单使用 Electron 原生菜单，避免被透明小窗口裁剪。
- 应用退出前正确关闭数据库和取消模型请求。

## 12. 配置与密钥

### 12.1 普通配置

```json
{
  "activeProvider": "anthropic",
  "modelAssignments": {
    "conversation": { "providerId": "anthropic", "modelId": "user-selected" },
    "memoryExtraction": { "providerId": "anthropic", "modelId": "user-selected-fast" },
    "summarization": { "providerId": "anthropic", "modelId": "user-selected-fast" }
  },
  "providers": {
    "anthropic": {},
    "openai-compatible": {
      "baseUrl": "http://127.0.0.1:11434/v1"
    }
  }
}
```

模型 ID 不提供长期写死的默认值，由设置页从用户输入或可用列表中选择。

### 12.2 API Key

- 开发环境可读取 `.env`。
- 发布版本使用设置页面录入。
- 使用 Electron `safeStorage` 加密保存。
- 每个提供商使用独立 Secret ID。
- 设置页只显示掩码，不回传完整 Key 给 Renderer。
- 配置更新时，空值或掩码不能覆盖已有真实 Key。

## 13. 性能预算

Claude 在云端运行，本地不承担大模型推理。

| 项目 | 目标 |
|---|---:|
| 空闲内存 | 300～550 MB |
| 对话与动画运行内存 | 450～900 MB |
| 峰值内存 | 尽量低于 1 GB |
| 空闲 CPU | 平均低于 3% |
| Live2D 帧率 | 目标 60 FPS，可降到 30 FPS |
| 冷启动 | 目标 5 秒内可见角色 |
| SQLite 数据库 | 长期目标低于 500 MB |
| 推荐系统内存 | 16 GB，最低 8 GB |

控制方法：

- 限制 Live2D 贴图大小和 SSAA。
- 窗口隐藏时降低帧率或暂停渲染。
- 消息列表使用虚拟滚动。
- 记忆任务后台排队，不并发大量模型请求。
- 数据库查询设置数量和时间上限。
- 不在本地加载 Embedding 或大语言模型。

## 14. 日志与隐私

- 日志采用等级：error、warn、info、debug。
- 默认不记录完整对话正文。
- API Key、Authorization Header 永远脱敏。
- 记忆数据库默认仅保存在用户设备。
- 提供数据目录入口、导出和删除功能。
- 崩溃报告默认不上传，未来如加入必须明确征得同意。
- 自动记忆默认可以关闭。

## 15. 测试计划

### 15.1 单元测试

- Provider Registry 注册和查找。
- 各 Provider 错误转换。
- 流式事件拼接和取消。
- 情绪解析及 neutral 回退。
- 记忆去重、冲突和过期。
- 上下文 token/字符预算。
- 路径校验和角色卡 Schema。

### 15.2 集成测试

- 使用 Mock Provider 完成完整对话。
- Claude Provider 连接测试使用人工密钥，不进入 CI。
- SQLite 创建、迁移、备份和恢复。
- Main/Renderer IPC 白名单。
- Live2D 模型导入和失败回退。

### 15.3 Windows E2E

- 安装、启动、托盘、退出和卸载。
- 单实例唤醒。
- 多显示器位置恢复。
- 断网和 API 错误。
- 长对话和取消生成。
- 连续运行数小时的内存增长。

## 16. 开发里程碑

### M0：工程骨架

- Electron + TypeScript + Vite。
- ESLint、Prettier、Vitest。
- Main、Preload、Renderer 安全边界。
- GitHub Actions 基础检查。

验收：开发模式能打开空白透明窗口，测试和构建通过。

### M1：桌宠外壳

- 透明置顶窗口。
- 拖动、缩放、位置恢复。
- 托盘和单实例。
- 多显示器可见区域恢复。

验收：重启、切换显示器和托盘恢复均不丢失窗口。

### M2：Live2D

- 加载官方 Simple model。
- 待机、眨眼、鼠标跟随。
- State、Action、Emotion、Tracking 控制器。
- 模型异常时显示可理解的错误。

验收：连续运行稳定，基础动作不会互相覆盖。

### M3：模型提供商与 Claude

- 内部模型协议。
- Provider Registry 和 Model Router。
- Anthropic Provider。
- OpenAI Compatible Provider。
- 连接测试、取消和统一错误。
- API Key 安全保存。

验收：Claude 和一个 OpenAI 兼容接口都能完成同一套聊天测试，切换时不修改业务代码。

### M4：完整文字对话

- 输入面板和流式字幕。
- 最近历史和会话保存。
- 人格提示词与角色卡。
- 情绪和动作结构化输出。
- 断网、超时和停止生成。

验收：可以稳定连续对话，回复能触发角色表现，异常不会导致程序退出。

### M5：长期记忆

- SQLite 数据表和迁移。
- 会话摘要。
- “记住”和“忘记”。
- 自动提取、去重、冲突和检索。
- 记忆管理页面。
- 导出、备份和清空。

验收：跨会话能正确回忆已保存事实；更新偏好后不会继续注入旧事实；用户可查看并彻底删除记忆。

### M5.1：结构化角色卡

- 手动编辑角色身份、性格、背景、关系和说话方式。
- 可选联网查询公开角色资料，用户确认后才保存。
- 角色名称与来源作品锁定，避免候选串角色。
- 角色资料与用户长期记忆保持独立。

验收：用户能得到来源明确、可检查、可修改的角色卡；离线时仍可完全手动填写。

### M5.2：对话体验与新词理解修整

- 重构对话 HUD，使聊天区与 Live2D 显示区分离。
- 长回复完整保留并可在当前对话区连续阅读，不使用摘要或截断替代正文。
- 降低 HUD 不透明度，统一输入、回复、历史和工具区域的视觉层级。
- 输入提示、回复署名和相关状态使用当前角色卡名称，未配置时才回退为“桌宠”。
- 对拼音缩写、社区黑话和新词结合上下文解释；含义不确定时先询问，不编造确定答案。
- 用户可明确触发一次性联网查词；结果显示来源，不让普通聊天静默联网。

验收：对话全文不会遮住 Live2D 角色；切换角色后 HUD 身份同步更新；面对含义不唯一的缩写时能澄清或在用户同意后查证。

### 1.0.0：功能基线

- 由 M0～M5.2 的已验收能力组成。
- 固定文字陪伴、Live2D、本地长期记忆、结构化角色卡、对话 HUD 和作品社区词库的现有安全边界。
- 不包含安装程序、签名、升级、公开发布或 1.0 之后的高级能力。

验收：完整验证通过，`main` 与远端基线一致；后续功能必须在独立里程碑中设计和验收。

### M6：1.0 发布工程

- 1.0.0 功能基线固定后再开始，不提前产包。
- 设置页面整理。
- Windows 安装包。
- 干净系统安装验证。
- 性能和长时间运行测试。
- 隐私说明、第三方许可和模型来源说明。

验收：普通用户只需要安装应用、配置模型接口和导入角色即可使用。M6 完成前，1.0.0 只作为代码与功能基线，不宣称已完成安装发行。

### V2：语音

- SpeechInput 和 SpeechOutput 接口。
- TTS、ASR、VAD 和打断。
- LipSyncChannel。
- 字幕、音频和嘴形同步。

1.0.0 之后的完整顺序还包括记忆可信度、真实 Electron UI 自动化、高级记忆基础设施和受控 Agent 能力，详见 [1.0 之后路线](POST_V1_ROADMAP.md)。

## 17. 主要风险与对策

| 风险 | 对策 |
|---|---|
| Claude 接口或模型名称变化 | 模型名配置化，SDK 封装在 Provider 内 |
| 被单一厂商锁定 | Claude 与 OpenAI 兼容接口同时作为第一批适配器 |
| 记忆错误 | 来源、置信度、冲突处理、用户编辑和删除 |
| Token 成本增长 | 摘要、最近消息限制、相关记忆上限、使用量统计 |
| Live2D 模型差异 | 参数映射配置和安全回退 |
| Electron 内存偏高 | 隐藏降帧、限制贴图、性能预算和持续监控 |
| API Key 泄漏 | Main Process + safeStorage + 日志脱敏 |
| 功能失控膨胀 | 严格按里程碑验收，不提前加入 Agent/MCP/视觉 |
| 参考项目许可证风险 | 只借鉴思路，独立实现，不复制 AGPL 项目源码 |

## 18. 第一轮实现任务

1. 初始化 Electron、TypeScript 和 Vite 工程。
2. 建立安全 Preload 和 IPC 白名单。
3. 打开透明无边框窗口。
4. 完成单实例、托盘和位置保存。
5. 建立 `LlmProvider`、Registry 和 Mock Provider。
6. 用 Mock Provider 打通输入框到字幕的完整流程。
7. 加载 Live2D 官方 Simple model。
8. 接入 Anthropic Provider。
9. 接入 OpenAI Compatible Provider。
10. 再开始 SQLite 和长期记忆，避免同时开发过多系统。

## 19. 完成定义

当以下条件全部满足时，第一版核心才算完成：

- 桌宠可在 Windows 干净环境安装和运行。
- Live2D 角色稳定显示并能恢复位置。
- Claude 能流式聊天，且可以切换到 OpenAI 兼容接口。
- 业务层不存在对具体厂商 SDK 的直接依赖。
- API Key 不出现在 Git、Renderer 或日志中。
- 角色人格、历史、摘要和长期记忆各自有清晰边界。
- 用户能查看和删除自己的长期记忆。
- 断网、取消和接口错误不会导致应用退出。
- 普通运行内存尽量低于 1 GB。
- 第一版没有直播、弹幕、桌面控制和完整 Agent 能力。
