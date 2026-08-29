# For People No Friend

> 没朋友也没关系，桌面上先放一个。
>
> No friends online? Fine. Put one on your desktop.

给暂时不想把社交当主线任务的人准备的 Windows AI 角色陪伴项目：角色待在桌面上，能聊天、做表情，也会把长期记忆留在本机。

当前仓库是 **Live2D Version**，以凯尔希作为完整 Live2D 示例；动态 WebP 版本已迁至独立的 [GIF Version 仓库](https://github.com/ph1gros/for-people-no-friend-gif)。

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
- 作品名留空时从精确角色资料页识别并在确认候选后自动回填
- 再次启动同一人格且已有对话时，由当前模型用最近几轮和相关已确认记忆生成一句简短关联开场；新人格、切换人格或无历史时使用角色卡默认开场
- 仅在桌宠窗口被选中时生效的可配置显示/隐藏与停止生成快捷键
- “小组件”入口以独立卡片管理听歌控制与本机输入展示；卡片状态可以按默认配置一键启停，额外设置单独进入。已启用组件按开启先后紧密排列；听歌条开启后固定保留，优先适配网易云音乐、QQ 音乐、酷狗音乐、Apple Music 和 Spotify，并提供上一首、播放/暂停、下一首；输入展示按用户白名单显示按键（默认 WASD），可用多种分隔符继续添加常用键盘按键，并可显示鼠标三键和移动方向。现有组件使用[仓库内类型化注册器](docs/V1_5_WIDGET_EXTENSION_GUIDE.md)，便于开发者或编码 AI 安全增加新组件，不在客户端加载外部插件

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
- V1.1c：角色资料与情境对话增强；动态 WebP 迁至独立 GIF Version
- V1.2 / M6：双版本各自完成带来源角色生成、资料检索、隔离与安全回退
- V1.3：Live2D 深化角色表现、短期连续性、可信记忆与模型提供商支持
- V1.4：版本化角色包、混合记忆、可选 Embedding/向量/关系索引，以及本地/远端模型透明协作
- V1.5：受限快捷键、Windows 媒体控制、本机输入展示、角色连续开场和仓库内小组件代码接口
- V1.6：本地/远端 ASR、TTS、VAD、打断、字幕与角色口型/说话动画
- 后续：更多渲染路线、只读视觉与受控 Agent 能力

## 开发参考

这些项目主要用于参考已经验证过的产品思路、模块边界和交互方式；For People No Friend 仍按自己的 Electron 安全边界和数据结构实现，不代表直接使用了对方代码。

| 项目                                                                        | 参考的思路与用途                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [AIRI](https://github.com/moeru-ai/airi)                                    | 上下文组织、生成生命周期、角色包、Live2D 表现与模型能力分层  |
| [my-neuro](https://github.com/morettt/my-neuro)                             | 长期陪伴、核心记忆、画像候选、时间感、混合检索与主动对话     |
| [SillyTavern](https://github.com/SillyTavern/SillyTavern)                   | Character Card、World Info、示例对话、摘要与上下文预算       |
| [RoleLLM](https://aclanthology.org/2024.findings-acl.878/)                  | 角色资料、情境知识、表达风格分层与固定角色评测               |
| [Soullink Emotion SDK](https://github.com/nanlingyin/soullink-emotion-sdk)  | 连续情绪、动作分层、模型校准与表现失败回退                   |
| [BongoCat](https://github.com/ayangweb/BongoCat)                            | 透明桌宠交互、输入事件到动作的映射、自定义模型与离线运行     |
| [OBS Input Overlay](https://github.com/univrsal/input-overlay)              | 可配置按键与鼠标状态叠层的交互和布局                         |
| [EchoBot](https://github.com/KdaiP/EchoBot)                                 | Roleplay、Decision、Agent 分层、会话管理、模型接入与语音边界 |
| [ZcChat2](https://github.com/Zao-chen/ZcChat2)                              | 表情、动作和粒子组合、角色资产组织、流式文本与语音演出       |
| [Live2D Cubism Web Framework](https://github.com/Live2D/CubismWebFramework) | Cubism 模型加载、Motion、Expression、参数语义与资源生命周期  |

更具体的采用与拒绝范围见 [开发路线中的开发参考](docs/POST_V1_ROADMAP.md#开发参考)。

## 版本记录

今后每个正式版本都在 README 与 Release 说明中记录“完成了什么、使用了什么、参考了什么”；参考表示学习产品思路或交互方式，不等于复制对方代码。

### V1.5b（程序版本 1.5.2）

**完成了什么**

- 修复听歌悬浮条因播放器未提供曲名而消失的问题：组件开启后固定保留，能取得媒体资料时再显示曲名。
- 明确优先适配网易云音乐、QQ 音乐、酷狗音乐、Apple Music 与 Spotify，并继续把控制限制为上一首、播放/暂停、下一首。
- 修复每五秒媒体刷新覆盖按键编辑内容的问题；支持逗号、顿号、分号、空格，以及更多常用标点、功能键和数字小键盘按键。
- 增加关联开场的有界输出预算与截断检测；半句不再直接显示，完整短句会自然收尾。
- 修复大量键盘映射在对话框展开时越过 Live2D 区域、遮挡右侧输入框的问题；保持单行横向显示，超出部分在组件内部滚动，按下隐藏键时自动定位。

**使用了什么**

- Windows Global System Media Transport Controls 负责识别五类播放器的受限媒体会话；未发布完整会话时仍使用固定系统媒体键回退。
- Renderer 只保留尚未提交的按键编辑草稿；保存后仍由 Main Process 按白名单、数量和类型重新验证。
- 当前会话模型继续负责关联开场，任务保持最近六条完整消息、受限记忆、一次生成、超时与取消边界。

**参考了什么**

- OBS Input Overlay：可编辑按键集合不应在状态轮询时被重置。
- Windows 系统媒体会话模型：播放器资料读取与固定媒体控制需要分开降级。
- AIRI、my-neuro：恢复会话时的连续感应由有界上下文生成，并在失败时安全回退。

### V1.5.0

**完成了什么**

- 增加可配置的窗口显示/隐藏与停止生成快捷键，所有输入在 Main Process 再校验。
- 增加 Windows 当前媒体会话读取与上一首、播放/暂停、下一首控制，并修复网易云音乐控制回退和中文曲名乱码。
- 增加默认关闭的 WASD、自选按键、鼠标三键与八方向输入展示；不保存按键正文、坐标或输入历史。
- 将输入展示和听歌控制整理为可独立启停、按开启顺序紧密排列的小组件，并提供仓库内类型化扩展指南。
- 改进角色联网查找、关系字段补整和独立作品词库同步；再次启动已有历史的同一人格时，可生成一句承接近期对话与已确认记忆的短开场。
- 统一应用、任务管理器和托盘图标与名称；Windows 便携包继续使用 ASAR，并只解包本机输入钩子的必要预编译文件以控制路径长度。

**使用了什么**

- Electron、TypeScript、Vite、Vitest、SQLite 与 Live2D 运行时继续组成桌面、界面、测试、记忆和角色表现基础。
- Windows Global System Media Transport Controls 与固定系统媒体键回退负责媒体状态和三种受限控制。
- `uiohook-napi` 只在用户明确开启输入展示时读取白名单按键、鼠标按键和粗粒度移动方向。
- 角色查找继续由 Main Process 访问允许的公开资料源；模型结构化整理、作品词库同步和启动开场使用彼此独立且有界的任务。

**参考了什么**

- BongoCat：输入状态与桌宠交互的可视化思路。
- OBS Input Overlay：可配置按键、鼠标状态和紧凑横向叠层布局。
- AIRI、my-neuro、SillyTavern：上下文生命周期、长期陪伴、角色卡和连续对话的组织方式。
- Live2D Cubism Web Framework：模型、Motion、Expression 与资源生命周期边界。

## 当前开发状态

M0～M5.2 已完成并组成 For People No Friend 1.0.0 功能基线。V1.1 完成可信长期记忆、角色资料和情境对话增强；V1.2 完成 Live2D 角色资料库、陪伴连续性、作品社区词库、安全检索与共享设置同步闭环；V1.3 完成 Live2D 表现、短期情绪连续性和模型提供商增强；V1.4 完成角色包、角色库、上下文角色扮演、混合记忆、可选外部索引和本地/远端模型协作。V1.5 已完善聚焦窗口内的可配置快捷键、停止生成、Windows 媒体控制、默认关闭的 WASD/自选按键和鼠标活动展示，以及供开发者或编码 AI 使用的小组件代码注册器；输入到 Live2D 动作的映射只在模型提供对应 Motion 或 Expression 时作为可选增强。动态 WebP 后续在独立 GIF Version 仓库发展。当前提供免安装 Windows 压缩包，暂不提供安装器、代码签名和自动升级。

## 下载

[V1.5b Live2D Release](https://github.com/ph1gros/for-people-no-friend/releases/tag/v1.5b) 提供 Windows x64 免安装包，并使用 ASAR 避免 Windows 解压路径过长。[V1.5.0 历史 Release](https://github.com/ph1gros/for-people-no-friend/releases/tag/v1.5.0) 继续保留；动态 WebP 的后续发布在 [GIF Version Releases](https://github.com/ph1gros/for-people-no-friend-gif/releases)。

## 示例模型与素材来源

本仓库的完整示例是凯尔希，位于 `main` · Live2D Version。使用作者[什行在要](https://space.bilibili.com/2695839)发布的[“工作凯尔希”Live2D](https://www.bilibili.com/video/BV1Le411976u/)，已获许可，仅限非盈利收录与分发。

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
- [V1.3 Live2D 表现标准](docs/V1_3_LIVE2D_PERFORMANCE_STANDARD.md)
- [V1.3 AIRI / SillyTavern 成熟方案对照](docs/V1_3_AIRI_SILLYTAVERN_ADOPTION.md)
- [V1.4 角色包与模型协作计划](docs/V1_4_CHARACTER_PACKAGE_AND_MODEL_ROUTING.md)
- [V1.5 小组件代码扩展指南](docs/V1_5_WIDGET_EXTENSION_GUIDE.md)
- [中期参考项目审查](docs/MIDTERM_REFERENCE_AUDIT.md)
- [1.0 之后路线](docs/POST_V1_ROADMAP.md)
- [Claude API 用户准备清单](docs/CLAUDE_PREPARATION.md)

## 角色与表现资源

主线新安装默认使用凯尔希资料卡和“工作凯尔希”Live2D 运行素材。启用方法与完整许可边界见 [本地 Live2D 兼容模型](assets/models/README.md)。

两个独立项目共享角色资料学习、长期记忆和安全边界，但不是同一个程序里的两套皮肤，也不提供跨版本角色运行时互切：本仓库专注 Live2D 的完整表现能力，[GIF Version](https://github.com/ph1gros/for-people-no-friend-gif) 专注更轻量、更像传统桌宠的动态 WebP 待机与表情动作。

两个版本都保留“联网查找 → 生成本地角色草稿 → 用户检查并保存”的能力。生成的是可追溯的称呼、身份背景、关系、说话方式和情境示例；Live2D 与 WebP 的表现素材分别使用各自项目的清单与授权检查，不能把另一个项目的示例角色直接塞进来。

- **WebP Version**：本地 LLM 优先，生成一张紧凑角色卡即可开始；上下文注入更短，但重要事情仍进入同一套可信长期记忆流程。
- **Live2D Version**：大型 LLM 优先，沿着 `neuro-like` 的长期陪伴方向发展，同时升级短期上下文、可信长期记忆、持续情绪、关系连续性和 Live2D 表现联动；任一可选模块失败时仍须回到普通文字聊天和基础动作。

不同缩放、拖动、长回复、启动表现与长时间桌面运行的真人目视发烟统一延期到 V1.3；V1.2 只声明已经通过的自动测试、构建与安全检查。

## 安全约定

- 私钥、密码、API Key、访问令牌和 `.env` 不提交到 Git。
- Live2D 第三方模型文件默认不提交；明确取得再分发许可的示例须附作者、来源和使用边界。
- 对话数据默认只保存在本机。
- 示例角色包只包含公开资料、来源和公开作品词库，不包含用户对话、长期记忆、摘要或本机模型配置。
- 不请求截图、桌面控制或代码执行权限；可选输入展示默认关闭，只接收用户白名单按键与粗粒度鼠标状态，不保存或联网发送输入历史。
