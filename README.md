# For people no friend

> 没朋友也没关系，桌面上先放一个。
>
> No friends online? Fine. Put one on your desktop.

给暂时不想把社交当主线任务的人准备的 Windows AI 角色陪伴项目：角色待在桌面上，能聊天、做表情，也会把长期记忆留在本机。

A local-first Windows AI character companion for days when socializing feels like a side quest. It lives on your desktop, chats, reacts, and keeps its long-term memory local.

当前 `main` 定义为 **1.0.0 功能基线**：使用 Live2D 角色和文字对话，支持安全的模型提供商配置、完整对话、情绪动作、本地长期记忆、结构化角色卡、侧拉对话 HUD 与作品社区词库。公开仓库从这份干净的 1.0.0 快照开始，不包含安装包、签名或可执行发布产物；这些交付工作由后续 M6 完成。

## 1.0.0 已完成能力

- 透明、无边框、置顶的桌宠窗口
- Live2D 模型加载、待机、眨眼和鼠标跟随
- 角色拖动、缩放和位置保存
- 文字输入和字幕气泡
- OpenAI 兼容 LLM 接口
- 可编辑的角色人格
- 最近对话历史
- 结构化情绪到表情/动作的映射
- 系统托盘控制
- 本地长期记忆、会话摘要、导出与彻底删除
- 结构化角色卡与用户确认后的联网补全
- 侧拉对话 HUD、长回复滚动和动态角色身份
- 用户主动同步并本地缓存的作品社区词库

## 1.0.0 不包含

- ASR、TTS、声音克隆和实时打断
- 直播、弹幕和主播控制台
- Qdrant、语义 Embedding、Neo4j 和独立 Python 记忆服务
- 独立画像模型 API Key
- 屏幕视觉和桌面控制
- Agent、MCP、任意工具调用、游戏陪玩和插件市场
- 本地模型训练或微调

## 开发路线

1. M0：Electron + TypeScript 工程骨架
2. M1：桌宠窗口外壳
3. M2：Live2D 角色
4. M3：模型提供商与 Claude
5. M4：完整文字对话
6. M5：长期记忆
7. M5.1：结构化角色卡与可选联网补全
8. M5.2：对话 HUD、角色身份显示与新词理解修整
9. 1.0.0：M0～M5.2 功能基线
10. M6：1.0 安装包、干净系统验证与发布工程（暂缓）
11. 1.0 之后：记忆可信度、真实 UI 自动化、语音、高级记忆基础设施与受控 Agent 能力

## 开发参考原则

每个里程碑开始实现前，优先检查用户指定的开源参考项目中与当前范围对应的最新实现，包括 [my-neuro](https://github.com/morettt/my-neuro)、[Soullink Emotion SDK](https://github.com/nanlingyin/soullink-emotion-sdk)、[ayangweb/BongoCat](https://github.com/ayangweb/BongoCat)、[bongocat-pet/BongoCat](https://github.com/bongocat-pet/BongoCat)、[ZcChat2](https://github.com/Zao-chen/ZcChat2) 和 [EchoBot](https://github.com/KdaiP/EchoBot)。

参考顺序是：先理解其技术和踩坑，再核对官方文档、许可证、本项目安全边界及当前里程碑；有明确收益且不越界的技术应独立实现并测试。不得直接复制 GPL 或未授权代码，也不得为了追随参考项目提前引入 M4、记忆、语音、MCP、Agent 或桌面控制。

## 当前开发状态

M0～M5.2 已完成并组成 For people no friend 1.0.0 功能基线。当前没有制作 Windows 安装包、签名或发布产物；M6 发布工程继续暂缓。后续功能顺序与采用条件详见 [1.0 之后路线](docs/POST_V1_ROADMAP.md)。

## 文档

- [安全编码规范](docs/SECURITY_CODING_STANDARD.md)
- [第一版产品与开发计划](docs/PRODUCT_PLAN_V1.md)
- [详细技术计划书](docs/TECHNICAL_PLAN_V1.md)
- [项目背景与参考架构](docs/PROJECT_CONTEXT.md)
- [M1 桌宠外壳说明](docs/M1_IMPLEMENTATION.md)
- [M2 Live2D 角色说明](docs/M2_IMPLEMENTATION.md)
- [M3 模型提供商与 Claude 说明](docs/M3_IMPLEMENTATION.md)
- [M4 完整文字对话说明](docs/M4_IMPLEMENTATION.md)
- [M5 长期记忆说明](docs/M5_IMPLEMENTATION.md)
- [M5.1 联网角色卡设计](docs/M5_1_DESIGN.md)
- [M5.1 联网角色卡实现](docs/M5_1_IMPLEMENTATION.md)
- [M5.1 角色扮演约束](docs/M5_1_ROLEPLAY_CONSTRAINTS.md)
- [M5.2 对话体验修整设计](docs/M5_2_DESIGN.md)
- [1.0 之后路线](docs/POST_V1_ROADMAP.md)
- [Claude API 用户准备清单](docs/CLAUDE_PREPARATION.md)

## Live2D 测试模型

开发阶段优先使用 Live2D 官方 Simple model 或 Hiyori。Cubism Core、官方测试模型和第三方模型需从官方页面自行下载并遵守对应许可条款，只能放在已忽略的 `assets/models/local/`，不得提交到本仓库。放置方法见 [本地 Live2D 模型说明](assets/models/README.md)。发布前应替换为自有、委托制作或明确获得发布授权的模型。

## 安全约定

- 私钥、密码、API Key、访问令牌和 `.env` 不提交到 Git。
- Live2D 第三方模型文件默认不提交。
- 对话数据默认只保存在本机。
- 第一版不请求截图、全局键盘监听、桌面控制或代码执行权限。
