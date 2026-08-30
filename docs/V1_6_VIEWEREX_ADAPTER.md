# V1.6 Live2DViewerEX 显示适配基础

## 定位

For People No Friend 继续负责角色、对话、记忆、模型调用和语音。Live2DViewerEX 是可选的外部显示端，内嵌 Live2D 仍可独立运行；任一显示端失败都不能阻断文字聊天。

官方 ExAPI 采用 WebSocket：ViewerEX 是本机服务端，FPNF 的 Main Process 是客户端。默认地址是 `ws://127.0.0.1:10086/api`；端口被占用时 ViewerEX 会从 10086 起选择后续可用端口。

- 官方结构说明：<https://live2d.pavostudio.com/doc/en-us/exapi/api-structure/>
- 官方 API 列表：<https://live2d.pavostudio.com/doc/en-us/exapi/api-list/>

## 当前已实现

- 适配器默认关闭，只允许 `127.0.0.1`、`10086` 至 `10150` 和固定 `/api` 路径。
- Renderer 只能通过固定 IPC 提交有限的角色表现意图；Main Process 再校验文字、情绪和动作。
- 回复完成后可发送 `11000` 气泡消息。文字会移除控制字符、限为 1000 个 Unicode 码点，并把尖括号转为全角，避免模型输出被 ViewerEX 当成 Unity 富文本。
- 表情只允许配置后的数字 ID，并使用 `13300`；动作只允许配置后的 `group` 或 `group:motion` 标识，并固定使用 `13200` 的 `type: 0`。
- 内嵌 Live2D 与 ViewerEX 共享复合角色表现端口，状态、情绪和动作会同时送往两个显示端；任一显示端失败不会阻断另一个。
- 设置页可启停适配器、填写官方端口、选择模型序号、记录纯数字 Steam 创意工坊编号、控制气泡，并发送一条固定的本机测试气泡。
- 状态动作、情绪表情编号和角色动作采用一行一个 `语义=ViewerEX标识` 的显式映射；设置页可发送 `talking / happy / 首个角色动作` 的固定映射测试。官方 ExAPI 不提供查询当前模型动作或表情列表的接口，因此不猜测模型内部编号。
- 连接超时或发送失败时静默回退；不自动无限重连，不记录回复正文。

## 明确不做

- 不读取、复制、解压或解密 ViewerEX/Steam 管理的 `.lpk` 和创意工坊模型。
- 不调用带绝对路径的切换模型、背景、动作文件或播放声音 API。
- 不向 ViewerEX 发送 TTS 文件、Base64 音频、API Key、聊天历史或记忆。
- 不开放新的网络监听，不允许 Renderer 提供主机名、URL、文件路径或 ExAPI 消息编号。
- ViewerEX 的“远程服务”在当前 Windows 版本实测绑定 `0.0.0.0:10086`；FPNF 仍只连接 `127.0.0.1`，但用户应在不用时关闭该服务，或用系统防火墙限制局域网入站访问。

## 人工联调

1. 由用户正常启动 Live2DViewerEX 并把目标模型放入模型序号 0 至 7 的一个位置。
2. 确认 ViewerEX ExAPI 正在监听；优先使用 10086，若被占用则查看 ViewerEX 当前端口。
3. 在 FPNF 设置中启用“Live2DViewerEX 显示适配”，填写端口和模型序号。
4. 点击“发送本机测试气泡”。ViewerEX 应显示“For People No Friend 已连接。”。
5. 关闭 ViewerEX 后继续聊天，确认文字回复和内嵌 Live2D 不受影响。

当前自动测试全部使用 fake WebSocket；不会访问真实 API Key、远程网络或真实模型文件。
