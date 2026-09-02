FPNF V1.7 本地语音运行组件（可选）

这个组件给需要完全离线语音的用户使用，包含：
- Style-Bert-VITS2 2.7.0 推理所需的受控 Python 环境；
- 日语 BERT 推理模型；
- SenseVoiceSmall 中文/日语语音识别模型与服务依赖；
- 对应的开源许可证与模型说明。

它不包含伊蕾娜或其他角色音色权重，也不包含音色训练工具。安装后，本地语音输入
可以使用；本地 Style-Bert-VITS2 语音输出还需要另行安装有权使用的音色权重。

安装：
1. 完全退出 FPNF。
2. 建议先把基础包解压到短路径，例如 C:\FPNF。
3. 把本压缩包内的 FPNF 文件夹与基础包的 FPNF 文件夹合并。
4. 重新启动 FPNF，在“设置 > 语音和语音输入”中启用所需功能。

这是体积较大的可选组件；不安装时，文字聊天、在线或用户自建的 OpenAI 兼容语音
接口、Genie-TTS 和 Fish Audio 仍可使用。组件不会自动下载模型，也不会启动训练。

SenseVoiceSmall 模型声明为 Apache License 2.0；FunASR 代码声明为 MIT License；
Style-Bert-VITS2 及随附依赖的许可证保留在组件各自目录中。请按各项目许可证使用。
