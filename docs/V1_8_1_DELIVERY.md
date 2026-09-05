# V1.8.1 交付记录

日期：2026-09-05。用户明确授权将当前工作区改动打包、提交、推送并发布为 v1.8.1。

## 更新范围

- Python 语音子进程仅继承允许的环境变量；统一大小写匹配，启用用户 site 隔离和本地服务代理排除。项目检查子进程共用白名单工具。
- 补齐静默 IPC handler 对资源窗口的来源判断；资源窗口生产 CSP 禁止直接网络访问，开发模式保留 HMR。
- 隔离面板销毁步骤，避免单个同步异常中断后续清理；忽略控制器销毁后的记忆加载结果。
- 未知计费状态下，显式开始或继续下载后不会再每 10 秒反复暂停；恢复不计费后撤销旧同意，再切换热点仍暂停。
- 样式 token、紫色降彩度、Live2D 角色侧无框、小组件容器透明；输入显示采用更大的字号、适当的字重及更清楚的描边。

## 验证与限制

`pnpm verify`：133 个测试文件、640 项测试，包含类型检查、构建、沙箱 Preload、Electron 原生 sherpa 和 SQLite 冒烟。

当前白名单代码已真实启动 Style-Bert-VITS2（DirectML）和 Genie-TTS，并分别合成 WAV；测试注入的非白名单环境变量未传给子进程。输入显示在独立 Electron 中验证默认布局、长按键、240px 容器与命中网格。

完整左右角色布局、静态模式、多屏/DPI、Windows 桌面点击穿透及自然听感仍待人工验收。本补丁发布不将这些项目记为完成。T2 尚无选择，静态模式边框保留现状。详情见 [UI Round 3 验证记录](UI_ROUND3_VERIFICATION.md)。

组件继续使用 [components-v1.8.0](https://github.com/ph1gros/fpnf-resources/releases/tag/components-v1.8.0)，包含 Genie 引擎 1.0.4。编译期哈希和组件版本未变化，既有组件无需因本补丁重新下载。

## 发布测量

- [v1.8.1 Release](https://github.com/ph1gros/for-people-no-friend/releases/tag/v1.8.1)。
- 附件：`FPNF-v1.8.1-Windows-x64.zip`，145529398 字节，138.79 MiB；比 v1.8.0 增加 1738 字节。
- 主程序解压目录：354171276 字节，约 337.76 MiB；ZIP 另附许可证和中文使用说明。
- SHA-256：`c3e011cbf9fa18bc68eb96829a5e2a8f1a163d4ab6b878b8aff45280def5ec89`，另附 `SHA256SUMS.txt`。
- ZIP 完整性检查通过；asar 中 3081 项、5 个 sherpa 原生文件已核对。包内本轮 Main 代码和全部渲染 HTML/JS/CSS 与验收构建逐字节一致。
- 最终包在 Electron 43.4.1 / Node 24.18.1 下实际调用原生 ASR，识别“こんにちは。今日はいい天気ですね。”；模型缺失时返回不可用。
- 本地证据：`.release/v1.8.1/verify.log`、`package.log`、`package-audit.json`、`packaged-asr.log`、`package-result.json`。
