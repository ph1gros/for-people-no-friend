# For People No Friend

> 没朋友也没关系，桌面上先放一个。
>
> No friends online? Fine. Put one on your desktop.

给暂时不想把社交当主线任务的人准备的 Windows AI 角色陪伴项目：角色待在桌面上，能聊天、做表情，也会把长期记忆留在本机。

当前仓库是 **Live2D Version**。V1.6 新安装默认使用原创角色“小猫”，可以选择内嵌 Live2D、ViewerEX 或 Steam VTube Studio；动态 WebP 版本已迁至独立的 [GIF Version 仓库](https://github.com/ph1gros/for-people-no-friend-gif)。

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
- 中文文字回复、流式分句、日语 TTS、有序播放、停声与 Live2D/VTube Studio 表现联动
- 说话就输出、精准小猫、手动录音三种中文语音输入模式；2 秒内连续语句合并后重新思考
- 已验证的 Style-Bert-VITS2 ONNX 本机运行方案，优先 DirectML、失败回退 CPU；因音色授权待确认，公开包暂不携带伊雷娜权重
- VTube Studio 官方 Plugin API 适配、固定 Steam 启动入口、当前模型清单与表情预览，以及为已获授权模型预留的有界安装入口
- 工作模式、受限文件拖入、网页查找与本机文件/代码协助；敏感操作仍需明确批准
- 作品名留空时从精确角色资料页识别并在确认候选后自动回填
- 再次启动同一人格且已有对话时，由当前模型用最近几轮和相关已确认记忆生成一句简短关联开场；新人格、切换人格或无历史时使用角色卡默认开场
- 仅在桌宠窗口被选中时生效的可配置显示/隐藏与停止生成快捷键
- “小组件”入口以独立卡片管理听歌控制与本机输入展示；卡片状态可以按默认配置一键启停，额外设置单独进入。已启用组件按开启先后紧密排列；听歌条开启后固定保留，优先适配网易云音乐、QQ 音乐、酷狗音乐、Apple Music 和 Spotify，并提供上一首、播放/暂停、下一首；输入展示按用户白名单显示按键（默认 WASD），可用多种分隔符继续添加常用键盘按键，并可显示鼠标三键和移动方向。现有组件使用[仓库内类型化注册器](docs/V1_5_WIDGET_EXTENSION_GUIDE.md)，便于开发者或编码 AI 安全增加新组件，不在客户端加载外部插件

## 当前不包含

- 未经授权的声音克隆、训练原始录音和公开模型再分发
- 直播、弹幕和主播控制台
- Qdrant、语义 Embedding、Neo4j 和独立 Python 记忆服务
- 独立画像模型 API Key
- 无边界屏幕监控、任意桌面控制、任意命令或第三方插件市场
- 随主程序打包的 39GB 声音训练环境；训练工具保持独立并要求确认音源授权

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
- V1.6：本地/远端 ASR、TTS、VAD、打断、字幕、角色口型、VTube Studio、工作模式与便携角色套装
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
| [VTube Studio Plugin API](https://github.com/DenchiSoft/VTubeStudio)        | 官方本机 API 鉴权、模型清单、热键、表情与受限参数注入        |
| [Style-Bert-VITS2](https://github.com/litagin02/Style-Bert-VITS2)           | JP-Extra 训练与推理流程、ONNX 导出、本地日语 TTS 服务边界    |
| [SenseVoice](https://github.com/FunAudioLLM/SenseVoice)                     | 本地中文语音识别、短音频转写与独立语音服务边界               |
| [Kokoro](https://github.com/hexgrad/kokoro)                                 | 轻量本地 TTS 的延迟、体积和跨设备部署对照                    |
| [Spout2](https://github.com/leadedge/Spout2)                                | Windows GPU 纹理共享与 VTube Studio 透明画面接入             |

更具体的采用与拒绝范围见 [开发路线中的开发参考](docs/POST_V1_ROADMAP.md#开发参考)。

## 版本记录

今后每个正式版本都在 README 与 Release 说明中记录“完成了什么、使用了什么、参考了什么”；参考表示学习产品思路或交互方式，不等于复制对方代码。

### V1.6.0

**完成了什么**

- 增加中文显示、日语朗读的流式语音主干；默认伊雷娜语速 `0.90`、音量 `60%`，句间与结尾停顿按自然听感重新校准。
- 增加说话就输出、精准小猫、手动录音三种中文输入；2 秒内续句合并后重新思考，繁忙时使用最多四句的有界队列。
- 增加内嵌 Live2D、ViewerEX、VTube Studio 三种互斥显示方式，以及眨眼、鼠标追踪、随机待机、犯困点头、慢闭眼和消息唤醒。
- 增加原创“小猫”角色卡、工作模式、文件拖入工作区、网页查找和受限本机文件/代码工具。
- 已完成本地 ONNX 日语语音运行时与有界 VTube 模型安装器；当前公开包不包含授权待确认的伊雷娜权重和小黑猫模型，二者只保存在用户私人备份中。

**使用了什么**

- Electron Main 继续保管密钥、网络、文件、Steam 启动、外部显示和语音进程；Preload 只暴露窄方法，Renderer 所有输入均在 Main 再验证。
- Style-Bert-VITS2 2.7.0 JP-Extra、ONNX Runtime DirectML/CPU 与本地日语 BERT 负责离线朗读；原始训练素材和训练环境不随包。
- VTube Studio 官方 Plugin API 负责读取模型公开清单并注入有限参数；VTube Studio 本体仍由 Steam 提供。

**参考了什么**

- AIRI、EchoBot、ZcChat2：流式文本切句、生成取消、半双工语音、角色表现和语音播放生命周期。
- VTube Studio 官方 Plugin API：本机插件鉴权、模型与热键读取、表情控制和参数注入协议；VTube Studio 应用本身不是本仓库代码。
- Style-Bert-VITS2：JP-Extra 训练、推理、ONNX 导出和本地服务组织；公开包不携带授权待确认的训练录音、权重或音色成品。
- SenseVoice：中文短音频识别和独立本地 ASR 服务边界；当前公开包不捆绑模型权重。
- Kokoro：轻量本地 TTS 的速度、体积和部署方式对照；最终 V1.6 日语声音链路未采用 Kokoro 音色克隆。
- Spout2：Windows GPU 纹理共享和 VTube Studio 透明画面接入；仅使用按其许可证保留声明的本机互操作组件。

**复现与调教**

完整角色卡、语音训练成品、语速停顿、监听模式、VTube 参数、休息动作、迁移步骤、授权边界和新电脑验收见 [V1.6 小猫角色、伊雷娜语音与 VTube Studio 复现手册](docs/V1_6_PORTABLE_CHARACTER_VOICE_VTUBE_GUIDE.md)。

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

M0～M5.2 已完成并组成 For People No Friend 1.0.0 功能基线。V1.1～V1.5 完成可信记忆、角色资料与角色包、模型协作、Live2D 表现、快捷键、媒体控制和小组件。V1.6 已完成声音主干、三种中文输入、工作模式、显示方式重构、VTube Studio 官方 API 适配和便携角色套装。动态 WebP 后续在独立 GIF Version 仓库发展。当前提供免安装 Windows 压缩包，暂不提供安装器、代码签名和自动升级。

## 下载

[V1.6 Live2D Release](https://github.com/ph1gros/for-people-no-friend/releases/tag/v1.6) 已提供 `FPNF-v1.6-Windows-x64.zip` Windows x64 免安装包，并可配合 [Steam VTube Studio](https://store.steampowered.com/app/1325860/VTube_Studio/) 使用。公开包不包含授权待确认的小黑猫模型和伊雷娜音色；确认公开再分发权后再决定是否增加独立资源资产。安装包 SHA-256 为 `DA3C0D4E7F0254878288F7A1959A254F54495FFE8690C2C4E10DC651C97A0E44`。[V1.5b 历史 Release](https://github.com/ph1gros/for-people-no-friend/releases/tag/v1.5b) 继续保留；动态 WebP 的后续发布在 [GIF Version Releases](https://github.com/ph1gros/for-people-no-friend-gif/releases)。

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
- [V1.6 声音与实时对话基线](docs/V1_6_SPEECH_FOUNDATION.md)
- [V1.6 VTube Studio 适配边界](docs/V1_6_VTUBE_STUDIO_ADAPTER.md)
- [V1.6 VTube Studio 模型调教参考](docs/V1_6_VTUBE_STUDIO_MODEL_ADAPTATION_GUIDE.md)
- [V1.6 小猫角色、伊雷娜语音与 VTube Studio 复现手册](docs/V1_6_PORTABLE_CHARACTER_VOICE_VTUBE_GUIDE.md)
- [V1.6 Release 说明](docs/V1_6_RELEASE_NOTES.md)
- [中期参考项目审查](docs/MIDTERM_REFERENCE_AUDIT.md)
- [1.0 之后路线](docs/POST_V1_ROADMAP.md)
- [Claude API 用户准备清单](docs/CLAUDE_PREPARATION.md)

## 角色与表现资源

V1.6 新安装默认使用原创“小猫”资料卡。内嵌 Live2D 仍保留已获许可的“工作凯尔希”示例；VTube Studio 随包模型和伊雷娜音色只有在公开再分发权已经核验时才能进入 Release。启用方法、迁移步骤与许可边界见 [V1.6 复现手册](docs/V1_6_PORTABLE_CHARACTER_VOICE_VTUBE_GUIDE.md) 和 [本地 Live2D 兼容模型](assets/models/README.md)。

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
