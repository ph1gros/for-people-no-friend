# For People No Friend

> 没朋友也没关系，桌面上先放一个。
>
> No friends online? Fine. Put one on your desktop.

给暂时不想把社交当主线任务的人准备的 Windows AI 角色陪伴项目：角色待在桌面上，能聊天、做表情，也会把长期记忆留在本机。

当前 `main` 是 **Live2D Version**，以凯尔希作为完整 Live2D 示例；伊雷娜动态 WebP 在 `gif-version` 独立发展。

Live2D Version 侧重长期陪伴、可信记忆、情绪与关系连续性。WebP Version 侧重本地小模型和快速角色扮演，同时也会记住重要的事情。两个版本都支持生成角色。

## 当前已完成能力

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

## 当前不包含

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
- V1.2 / M6：双版本各自完成带来源角色生成、资料检索、隔离与安全回退
- V1.3：双版本表现能力与真人目视验收，以及 `gif-version` 的 WebP 标签判定与调度规则
- 后续：真实 UI 自动化、语音、高级记忆基础设施与受控 Agent 能力

## 开发参考原则

吸收前人精华，顺便绕开前人踩过的坑。每个里程碑动手前，先看看 [my-neuro](https://github.com/morettt/my-neuro)、[Soullink Emotion SDK](https://github.com/nanlingyin/soullink-emotion-sdk)、[BongoCat](https://github.com/ayangweb/BongoCat)、[ZcChat2](https://github.com/Zao-chen/ZcChat2) 和 [EchoBot](https://github.com/KdaiP/EchoBot) 已经试过什么、哪里好用、哪里会炸。

## 当前开发状态

M0～M5.2 已完成并组成 For People No Friend 1.0.0 功能基线。V1.1 完成可信长期记忆、角色资料和情境对话增强；V1.2 完成 Live2D 角色资料库、陪伴连续性、作品社区词库、安全检索与共享设置同步闭环。动态 WebP 在 `gif-version` 支线独立发展。V1.2 提供免安装 Windows 压缩包，但暂不提供安装器、代码签名和自动升级。

## 下载

[GitHub Releases](https://github.com/ph1gros/for-people-no-friend/releases) 提供两个独立的 Windows 免安装压缩包：Live2D Version 使用凯尔希示例，GIF Version 使用伊雷娜动态 WebP 示例。下载对应版本、解压后运行 `For People No Friend.exe` 即可；两者不会在运行时互相切换。

## 示例模型与素材来源

| 角色   | 所在版本                          | 作者                                                   | 原始来源                                                                            | 收录说明                       |
| ------ | --------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------ |
| 凯尔希 | `main` · Live2D Version           | [什行在要](https://space.bilibili.com/2695839)         | [“工作凯尔希”Live2D](https://www.bilibili.com/video/BV1Le411976u/)                  | 已获许可，仅限非盈利收录与分发 |
| 伊雷娜 | `gif-version` · 动态 WebP Version | [白之魔女-霜娜](https://space.bilibili.com/2125763952) | [伊雷娜动态 WebP 表情原始发布页](https://www.bilibili.com/opus/1209543497317613574) | 经用户确认，作者允许使用与分发 |

模型和表情素材只负责角色外观与动作，角色资料、作品词库、用户记忆和私人对话分别保存。来源链接只用于署名与查阅，不会在运行时远程加载素材。

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
- [M6 双版本角色生成收尾](docs/M6_DUAL_VERSION_CHARACTER_GENERATION.md)
- [V1.2 实现与自动验收](docs/V1_2_IMPLEMENTATION.md)
- [V1.2 可选资料索引评估](docs/V1_2_OPTIONAL_INDEX_EVALUATION.md)
- [1.0 之后路线](docs/POST_V1_ROADMAP.md)
- [Claude API 用户准备清单](docs/CLAUDE_PREPARATION.md)

## 角色与表现资源

主线新安装默认使用凯尔希资料卡和“工作凯尔希”Live2D 运行素材。启用方法与完整许可边界见 [本地 Live2D 兼容模型](assets/models/README.md)。

主线与支线共享角色资料学习、长期记忆和安全边界，但不是同一个程序里的两套皮肤，也不提供凯尔希与伊蕾娜的运行时互切：`main` 专注 Live2D 的完整表现能力，`gif-version` 专注更轻量、更像传统桌宠的动态 WebP 待机与表情动作。

两个版本都保留“联网查找 → 生成本地角色草稿 → 用户检查并保存”的能力。生成的是可追溯的称呼、身份背景、关系、说话方式和情境示例；Live2D 与 WebP 的表现素材仍分别使用各自版本的清单与授权检查，不能把另一条分支的示例角色直接塞进来。

- **WebP Version**：本地 LLM 优先，生成一张紧凑角色卡即可开始；关键词资料检索和失败回退保持简单，长期记忆可以使用，但不作为首次上手的门槛。
- **Live2D Version**：大型 LLM 优先，沿着 `neuro-like` 的长期陪伴方向发展，重视稳定人格、可信长期记忆、持续情绪、关系连续性和 Live2D 表现联动；任一可选模块失败时仍须回到普通文字聊天和基础动作。

不同缩放、拖动、长回复、启动表现与长时间桌面运行的真人目视发烟统一延期到 V1.3；V1.2 只声明已经通过的自动测试、构建与安全检查。

## 安全约定

- 私钥、密码、API Key、访问令牌和 `.env` 不提交到 Git。
- Live2D 第三方模型文件默认不提交；明确取得再分发许可的示例须附作者、来源和使用边界。
- 对话数据默认只保存在本机。
- 示例角色包只包含公开资料、来源和公开作品词库，不包含用户对话、长期记忆、摘要或本机模型配置。
- 第一版不请求截图、全局键盘监听、桌面控制或代码执行权限。
