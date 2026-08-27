# For People No Friend

> 没朋友也没关系，桌面上先放一个。
>
> No friends online? Fine. Put one on your desktop.

给暂时不想把社交当主线任务的人准备的 Windows AI 角色陪伴项目：角色待在桌面上，能聊天、做表情，也会把长期记忆留在本机。

A local-first Windows AI character companion for days when socializing feels like a side quest. It lives on your desktop, chats, reacts, and keeps its long-term memory local.

当前 `main` 是 **Live2D Version**：凯尔希作为完整公开示例，模型、角色资料、情境表达参考和《明日方舟》作品社区词库保持同一角色归属。项目继续支持 Live2D、文字对话、安全的模型提供商配置、可信长期记忆、侧拉对话 HUD 与作品社区词库；动态 WebP 伊雷娜则作为另一套完整示例，在独立的 `gif-version` 分支发展。

两条路线的产品重心并不相同：WebP Version 面向本地小模型和快速角色扮演，尽量用较短的角色卡、较小的上下文预算和少量步骤完成一个角色；Live2D Version 面向能力更强的大模型与长期陪伴，更重视可信记忆、关系连续性、情绪理解，以及回复和表情动作的一致。二者都能生成角色，但不会为了“功能看起来一样多”而背上同一套运行成本。

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
- 结构化角色卡与用户确认后的联网补全
- 带场景、情绪、触发条件、角色态度和来源的情境对话示例
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
- V1.1c：角色资料与情境对话增强；动态 WebP 伊雷娜进入 `gif-version` 支线
- 后续：真实 UI 自动化、语音、高级记忆基础设施与受控 Agent 能力

## 开发参考原则

吸收前人精华，顺便绕开前人踩过的坑。每个里程碑动手前，先看看 [my-neuro](https://github.com/morettt/my-neuro)、[Soullink Emotion SDK](https://github.com/nanlingyin/soullink-emotion-sdk)、[BongoCat](https://github.com/ayangweb/BongoCat)、[另一只 BongoCat](https://github.com/bongocat-pet/BongoCat)、[ZcChat2](https://github.com/Zao-chen/ZcChat2) 和 [EchoBot](https://github.com/KdaiP/EchoBot) 已经试过什么、哪里好用、哪里会炸。

能带走的是思路、经验和测试方法，不能顺手打包带走的是许可证不兼容的源码。看懂以后再核对官方文档和本项目的安全边界，用自己的代码重新实现并测试；也不因为别人家功能多，就把语音、Agent、MCP 和桌面控制一锅端进来。

## 当前开发状态

M0～M5.2 已完成并组成 For People No Friend 1.0.0 功能基线。V1.1a～V1.1b 完成可信长期记忆闭环；V1.1c 在主线增强联网角色资料和情境对话，Live2D 继续作为完整功能主线，动态 WebP 则在 `gif-version` 支线发展。当前仓库不提供 Windows 安装包、签名或可执行发布产物。

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
- [公开示例角色包](docs/EXAMPLE_CHARACTER_PACK.md)
- [V1.2 角色资料库与检索边界](docs/V1_2_CHARACTER_KNOWLEDGE_DESIGN.md)
- [V1.2 实现与自动验收](docs/V1_2_IMPLEMENTATION.md)
- [V1.2 可选资料索引评估](docs/V1_2_OPTIONAL_INDEX_EVALUATION.md)
- [1.0 之后路线](docs/POST_V1_ROADMAP.md)
- [Claude API 用户准备清单](docs/CLAUDE_PREPARATION.md)

## 角色与表现资源

主线新安装默认使用凯尔希资料卡，并提供已获作者非盈利授权的“工作凯尔希”Live2D 运行素材。它们共同组成主线完整示例；角色资料和模型文件仍保持独立命名空间，方便以后替换或增加角色。启用方法、作者来源和许可边界见 [本地 Live2D 兼容模型](assets/models/README.md)。

主线与支线共享角色资料学习、长期记忆和安全边界，但不是同一个程序里的两套皮肤，也不提供凯尔希与伊蕾娜的运行时互切：`main` 专注 Live2D 的完整表现能力，`gif-version` 专注更轻量、更像传统桌宠的动态 WebP 待机与表情动作。

两个版本都保留“联网查找 → 生成本地角色草稿 → 用户检查并保存”的能力。生成的是可追溯的称呼、身份背景、关系、说话方式和情境示例；Live2D 与 WebP 的表现素材仍分别使用各自版本的清单与授权检查，不能把另一条分支的示例角色直接塞进来。

- **WebP Version**：本地 LLM 优先，生成一张紧凑角色卡即可开始；关键词资料检索和失败回退保持简单，长期记忆可以使用，但不作为首次上手的门槛。
- **Live2D Version**：大型 LLM 优先，沿着 `neuro-like` 的长期陪伴方向发展，重视稳定人格、可信长期记忆、持续情绪、关系连续性和 Live2D 表现联动；任一可选模块失败时仍须回到普通文字聊天和基础动作。

## 安全约定

- 私钥、密码、API Key、访问令牌和 `.env` 不提交到 Git。
- Live2D 第三方模型文件默认不提交；明确取得再分发许可的示例须附作者、来源和使用边界。
- 对话数据默认只保存在本机。
- 示例角色包只包含公开资料、来源和公开作品词库，不包含用户对话、长期记忆、摘要或本机模型配置。
- 第一版不请求截图、全局键盘监听、桌面控制或代码执行权限。
