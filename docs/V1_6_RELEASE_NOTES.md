# For People No Friend V1.6

V1.6 把程序从单一内嵌 Live2D 聊天桌宠扩展为本地角色服务：角色、记忆、语音、工作能力与表现由 Main Process 安全协调，设置页只是控制端。

## 主要变化

- 增加中文文字回复与日语 TTS 分流、流式分句、有序播放、停声、口型和失败回到完整文字。
- 增加“说话就输出”“精准小猫”“手动录音”三种中文语音输入；2 秒内续句合并后重新思考。
- 增加内嵌 Live2D、ViewerEX、VTube Studio 三种互斥显示方式。
- VTube Studio 使用官方本机 Plugin API，支持固定 Steam 启动、授权、模型清单、表情预览、随机待机、眨眼、鼠标追踪、犯困与唤醒。
- 增加原创“小猫”角色卡、工作模式、受限文件拖入、网页查找与本机文件/代码协助。
- 重做设置页分类、窗口布局、小组件避让、120% 缩放上限和声音入口。
- 增加角色包、Live2D 模型和本地音色的导入/导出或安全预留接口。

## 此公开包不包含

- 小黑猫 / heibaiMaoMao VTube Studio 模型。
- 伊蕾娜训练音色、ONNX/Safetensors 权重、训练录音或训练环境。
- 任何 API Key、VTube Studio 授权令牌、对话、记忆或本机工作区数据。

上述两个二进制资源的公开再分发授权仍在确认，因此只保存在用户的私人“待授权”备份中。程序可使用用户自行合法取得并配置的 VTube Studio 模型和 OpenAI 兼容 TTS/ASR。

## 验证

- `pnpm verify`：94 个测试文件、419 项测试全部通过。
- TypeScript、ESLint、Prettier、Electron/Vite 构建与沙箱 Preload 烟雾检查通过。
- Windows x64 免安装目录包；无安装器、代码签名或自动升级。

完整调教、迁移和许可边界见 `docs/V1_6_PORTABLE_CHARACTER_VOICE_VTUBE_GUIDE.md`。
