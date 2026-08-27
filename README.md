# For People No Friend

> 没朋友也没关系，桌面上先放一个。
>
> No friends online? Fine. Put one on your desktop.

给暂时不想把社交当主线任务的人准备的 Windows AI 角色陪伴项目：角色待在桌面上，能聊天、做表情，也会把长期记忆留在本机。

A local-first Windows AI character companion for days when socializing feels like a side quest. It lives on your desktop, chats, reacts, and keeps its long-term memory local.

当前分支是 **GIF Version**：伊雷娜作为公开示例角色，随仓库提供经授权的动态 WebP 表情目录、来源可查的角色资料和《魔女之旅》作品词库。它与 Live2D 主线共享可信长期记忆、文字对话、安全模型配置和侧拉 HUD，但两种表现层不在界面中互相切换。当前不提供安装包、签名或可执行发布产物。

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
- 自动记忆候选、来源证据、冲突确认与旧数据安全迁移
- 候选编辑、同键证据合并、有效期调整与冲突保留选择
- 版本化动态 WebP 角色包、动作多标签和统一显示画布
- GIF Version 独立角色配置，以及角色卡、历史、摘要、记忆和表现资源隔离
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

- M0：Electron + TypeScript 工程骨架
- M1：桌宠窗口外壳
- M2：Live2D 角色
- M3：模型提供商与 Claude
- M4：完整文字对话
- M5：长期记忆
- M5.1：结构化角色卡与可选联网补全
- M5.2：对话 HUD、角色身份显示与新词理解修整
- 1.0.0：M0～M5.2 功能基线
- V1.1a：可信长期记忆最小闭环
- V1.1b：候选整理、有效期编辑与冲突决策
- V1.1c：GIF Version 分支、版本化 WebP 角色模板与伊雷娜资源包
- V1.2 / M6：可追溯角色资料、轻量本地模型预算与 WebP 表现恢复闭环
- 后续：真实 UI 自动化、语音、高级记忆基础设施与受控 Agent 能力

## 开发参考原则

吸收前人精华，顺便绕开前人踩过的坑。每个里程碑动手前，先看看 [my-neuro](https://github.com/morettt/my-neuro)、[Soullink Emotion SDK](https://github.com/nanlingyin/soullink-emotion-sdk)、[BongoCat](https://github.com/ayangweb/BongoCat)、[另一只 BongoCat](https://github.com/bongocat-pet/BongoCat)、[ZcChat2](https://github.com/Zao-chen/ZcChat2) 和 [EchoBot](https://github.com/KdaiP/EchoBot) 已经试过什么、哪里好用、哪里会炸。

能带走的是思路、经验和测试方法，不能顺手打包带走的是许可证不兼容的源码。看懂以后再核对官方文档和本项目的安全边界，用自己的代码重新实现并测试；也不因为别人家功能多，就把语音、Agent、MCP 和桌面控制一锅端进来。

## 当前开发状态

M0～M5.2 已完成并组成 For People No Friend 1.0.0 功能基线。V1.1a～V1.1b 完成可信长期记忆闭环；本 GIF Version 分支在同一套聊天能力上使用可复用动态 WebP 角色包和伊雷娜。Live2D 继续在 `main` 发展，两种表现层不在运行时互相切换。当前仓库不提供 Windows 安装包、签名或可执行发布产物。后续功能顺序与采用条件详见 [1.0 之后路线](docs/POST_V1_ROADMAP.md)。

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
- [V1.1a 可信长期记忆实现](docs/V1_1A_IMPLEMENTATION.md)
- [V1.1b 记忆整理实现](docs/V1_1B_IMPLEMENTATION.md)
- [V1.1c 版本化角色表现实现](docs/V1_1C_IMPLEMENTATION.md)
- [公开示例角色包](docs/EXAMPLE_CHARACTER_PACK.md)
- [M6 双版本角色生成收尾](docs/M6_DUAL_VERSION_CHARACTER_GENERATION.md)
- [V1.2 / M6 GIF Version 实现](docs/V1_2_IMPLEMENTATION.md)
- [1.0 之后路线](docs/POST_V1_ROADMAP.md)
- [Claude API 用户准备清单](docs/CLAUDE_PREPARATION.md)

## 角色与表现资源

v1.0 里的 Live2D 示例只负责证明“这只东西确实能在桌面上动起来”，不负责决定她是谁。Simple model、Hiyori 或其他本地模型都只是兼容性测试材料，不会被当成正式角色人格；放置和许可说明见 [本地 Live2D 兼容模型](assets/models/README.md)。

首个动态 WebP 角色包是 **伊雷娜**：53 个动态表情素材、作者和原始发布页均保存在版本化资源清单中；公开角色资料与《魔女之旅》词库也随分支提供。凯尔希则是 `main` 的完整 Live2D 示例。两边的人格、对话历史、摘要、长期记忆和表现资源各走各的，不会互相继承资料后假装无事发生。

项目使用带版本的泛用角色模板管理动态 WebP/GIF 表现资源，并按待机、思考、说话、情绪和动作标签映射；缺失或加载失败时会安全回退，不影响文字聊天。细节见 [角色资源说明](assets/characters/README.md)。

## 安全约定

- 私钥、密码、API Key、访问令牌和 `.env` 不提交到 Git。
- Live2D 第三方模型文件默认不提交。
- 对话数据默认只保存在本机。
- 示例角色包只包含公开资料、来源和获准分发的表现素材，不包含用户对话、长期记忆、摘要、API 配置或联网缓存。
- 第一版不请求截图、全局键盘监听、桌面控制或代码执行权限。
