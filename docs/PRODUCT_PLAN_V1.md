# For People No Friend 产品与开发计划书

## 1. 项目决定

- 项目名称：For People No Friend
- GitHub 仓库：`ph1gros/for-people-no-friend`
- 仓库可见性：Private
- 首发平台：Windows
- 第一版交互：文字对话
- 第一版角色：Live2D
- 语音：第一版不实现，仅保留输入与输出接口，第二版接入
- 直播、主播、弹幕：不进入产品范围
- 参考项目：`morettt/my-neuro`

本项目采用独立仓库，而不是长期直接修改 `my-neuro`。原因是当前目标只需要桌宠核心，而参考项目包含直播、弹幕、本地模型集群、游戏和大量插件。独立实现能获得更清晰的结构，同时可以借鉴其 Live2D、情绪映射和插件思想。

## 2. 产品目标

第一版交付一个稳定、轻量的 Windows 桌宠：角色常驻桌面，用户可以打开文字输入框与其聊天，回复以字幕展示，并根据回复情绪切换 Live2D 表情或动作。

核心体验：

```text
启动应用
  ↓
桌面显示 Live2D 角色
  ↓
用户打开输入框并发送文字
  ↓
角色人格 + 对话历史 → LLM
  ↓
回复文本 + 情绪标记
  ↓
字幕显示 + Live2D 表情/动作
```

## 3. 第一版范围

### 必须实现

1. Windows 桌面应用。
2. 透明、无边框、置顶的角色窗口。
3. 角色拖动、缩放和位置保存。
4. 加载一个 Live2D Cubism 3/4/5 兼容模型。
5. 基础待机动作、眨眼和鼠标跟随。
6. 文字输入框和字幕气泡。
7. OpenAI 兼容的 LLM 接口。
8. 可编辑的角色人格提示词。
9. 最近对话历史。
10. 情绪标记到 Live2D 表情/动作的映射。
11. 系统托盘中的显示、隐藏、设置和退出。
12. 密钥只保存在本地，不进入 Git。

### 明确不做

- 语音识别、TTS 和实时打断
- 直播和弹幕
- Bilibili 或海外直播平台
- 礼物、观众和主播控制台
- 长期记忆和向量数据库
- 自动截图和视觉识别
- 键鼠控制和代码执行
- MCP
- 游戏陪玩
- 本地 LLM 训练或微调
- 声音克隆
- 插件市场
- 手机端

## 4. 第二版预留语音接口

第一版不包含语音依赖，但业务层不直接调用具体语音服务。预留以下抽象：

```ts
export interface SpeechInput {
  isAvailable(): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  onTranscript(handler: (text: string) => void): void;
}

export interface SpeechOutput {
  isAvailable(): Promise<boolean>;
  speak(text: string): Promise<void>;
  stop(): Promise<void>;
}
```

第一版使用 `DisabledSpeechInput` 和 `DisabledSpeechOutput` 空实现。第二版可以替换为本地 ASR/TTS 或云端服务，而不用重写对话流程。

## 5. 推荐技术结构

```text
Electron
├── Main process
│   ├── 窗口生命周期
│   ├── 系统托盘
│   ├── 配置与本地密钥存储
│   └── IPC 权限边界
└── Renderer
    ├── Live2D 渲染
    ├── 字幕和输入框
    ├── 对话状态
    ├── LLM 适配器
    ├── 情绪解析器
    └── 语音接口（第一版为空实现）
```

建议使用：

- TypeScript
- Electron
- Vite
- Live2D Cubism SDK for Web，或验证兼容性后的 Pixi Live2D 渲染方案
- Vitest
- ESLint + Prettier

## 6. 建议目录

```text
for-people-no-friend/
├── docs/
│   ├── PRODUCT_PLAN_V1.md
│   ├── PROJECT_CONTEXT.md
├── src/
│   ├── main/
│   ├── renderer/
│   ├── core/
│   ├── adapters/
│   │   ├── llm/
│   │   └── speech/
│   └── shared/
├── assets/
│   └── models/
│       └── README.md
├── tests/
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 7. Live2D 模型方案

第一版推荐使用 Live2D 官方 **Simple model** 做开发验证。它包含最基础的头部倾斜、眨眼和嘴部开合，结构简单，适合检查加载、坐标、透明窗口和参数控制。

第二选择是官方 Hiyori 示例模型。它包含更多待机动作、物理、Pose、眨眼、口型和点击区域，更适合验证完整播放器能力。

模型管理规则：

- 从 Live2D 官方页面自行下载。
- 下载前阅读并接受 Free Material License 和 Sample Data Terms。
- 开发模型放在 `assets/models/local/`。
- `assets/models/local/` 默认加入 `.gitignore`。
- 仓库只保存模型放置说明和来源链接，不保存第三方模型本体。
- 发布产品前换成自有、委托制作或明确获得发布授权的角色模型。

## 8. 情绪协议

LLM 返回结构化结果，避免依赖正文中的随意标签：

```json
{
  "text": "你终于想起来找我了。",
  "emotion": "playful",
  "action": "wave"
}
```

第一版情绪集合：

```text
neutral
happy
sad
angry
surprised
shy
playful
```

角色模型不支持某个动作时，回退到 `neutral`，不能让对话失败。

## 9. 配置与安全

- `.env` 保存 API Key，并加入 `.gitignore`。
- Git 中只提交 `.env.example`。
- Renderer 不直接持有高权限系统 API。
- 不启用 `nodeIntegration`。
- 通过受限 IPC 调用主进程能力。
- 对话记录默认只保存在本机。
- 第一版没有截图、键盘监听、桌面控制或代码执行权限。

## 10. 开发里程碑

> 本文早期版本曾使用“M2 对话、M3 情绪、M4 发布”的粗粒度编号。实际实施统一采用 [详细技术计划书](TECHNICAL_PLAN_V1.md) 和 README 中的路线：M2 Live2D、M3 Provider、M4 完整文字对话、M5 长期记忆、M5.1 角色卡、M5.2 对话体验修整。M0～M5.2 现定义为 1.0.0 功能基线，后续能力见 [1.0 之后路线](POST_V1_ROADMAP.md)。

### M0：仓库与工程骨架

- 创建私人 GitHub 仓库
- 初始化 TypeScript、Electron、Vite
- 设置测试、格式化和基本 CI
- 建立配置和安全边界

验收：开发模式能打开空白透明窗口，CI 能通过。

### M1：Live2D 桌宠外壳

- 加载官方简单模型
- 透明置顶窗口
- 拖动、缩放、位置保存
- 待机、眨眼、鼠标跟随
- 托盘控制

验收：重新启动后角色仍在上次位置，能连续运行且无明显资源泄漏。

### M2：文字对话

- 输入面板
- LLM 适配器
- 人格提示词
- 对话历史
- 字幕气泡
- 超时、取消和错误提示

验收：用户能够稳定连续对话，API 异常不会导致程序退出。

### M3：情绪与动作

- 结构化回复
- 情绪映射
- 动作队列
- 不支持动作的回退

验收：每种基础情绪都能触发有效表现，错误标签安全回退。

### M4：第一版完成

- 设置页面
- 角色人格编辑
- 模型路径选择
- Windows 打包
- 安装、升级和卸载验证
- 隐私与第三方许可说明

验收：在干净 Windows 环境安装后可以完成文字对话。

## 11. 第二版候选范围

- TTS
- ASR
- 实时打断
- 音频与口型同步
- 基础长期记忆
- 可调节的主动对话

语音功能通过第一版预留的 `SpeechInput` 和 `SpeechOutput` 接口接入。

## 12. 当前状态与下一步

1. M0～M5.2 已完成，当前代码定义为 1.0.0 功能基线。
2. 1.0.0 之后优先改善长期记忆可信度、泛用角色模板、双角色和真实 Electron UI 验证。
3. 语音、高级记忆基础设施与 Agent 能力必须分别设计、单独授权并保持安全边界。
