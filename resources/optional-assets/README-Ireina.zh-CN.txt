FPNF V1.7 伊蕾娜音色权重（可选）

本包只补充伊蕾娜音色权重，不包含 Python、Style-Bert-VITS2 推理环境或训练工具。
使用前必须先安装公开的 FPNF-v1.7-Local-Speech-Runtime 组件；不安装本音色包不影响
文字聊天、语音输入和其他 TTS 提供方。

安装：
1. 完全退出 FPNF。
2. 先把 Local-Speech-Runtime 压缩包内的 FPNF 文件夹与本体合并。
3. 再把本压缩包中的 resources 文件夹直接解压到 FPNF 主目录，与现有 resources 合并。
4. 确认最终文件位于：
   <FPNF>\resources\voice-runtime\voice\ireina\ireina_e100_s16040.onnx
5. 重新启动 FPNF。设置页检测到完整权重后，才会显示本机 Style-Bert-VITS2 / 伊蕾娜
   预设；首次预热较慢，DirectML 不可用时会自动改用 CPU。

为避免 Windows 路径过长，建议把基础包解压到 C:\FPNF 一类短路径后再合并本资源。
伊蕾娜音色及相关推理文件仅限非商业用途。
