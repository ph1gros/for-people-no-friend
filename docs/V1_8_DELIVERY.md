# V1.8 资源中心交付与验收记录

更新：2026-09-04。供后续编码助手或 Claude 核对。工作区 C:\ai_deskpet，沿用现有 main，保留已有改动，没有另建仓库或 worktree。

## 当前交付

- 主程序开发版本 1.8.0，尚未提交、推送或发布。用户最新要求先完成全部 v1.8 任务及验收，再打包推送；已发布主程序仍为 v1.7.1。
- 资源已公开：[fpnf-resources](https://github.com/ph1gros/fpnf-resources)，[components-v1.8.0](https://github.com/ph1gros/fpnf-resources/releases/tag/components-v1.8.0)。
- 资源元数据提交 78d2f3806f9f27ace59240dde7b6a15a680c77de；七个 ZIP 和两份校验附件全部上传，GitHub 服务端 digest 与本地实测 SHA-256 逐项一致。
- 资源中心统一“用途、适配引擎、支持语言、配套资源、版本与大小、许可说明”；四类仍为引擎、基础模型、音色模型、语音识别。保留独立窗口、任务栏、下载进度和显式安装。
- Main 默认使用公开 catalog.json 和 speech-assets-v1.8.0.json。环境变量可覆盖，空字符串停用；没有远程提供哈希或执行入口的能力。
- Genie 引擎 1.0.1 排除解码器末尾 EOS 占位值，消除它被声码器合成为额外气声的路径；未按固定毫秒裁掉正常语音，未修改模型权重。

## 既有本地测试包

`.release/v1.8.0/FPNF-v1.8.0-Windows-x64.zip`：145524534 字节（138.78 MiB），解压目录 354154172 字节。
SHA-256：`97efaf25ba7a68fe77b3fd8d522c667db05fc067af3e36e26f12897ab7d860a8`。
最终包已重新核对包含最新 Electron 下载兼容修复，打包后的 ASR 仍通过。此 ZIP 尚未对外上传；后续面板修改完成后须重新打包和测量。

## 实测资源大小

| ID               | 版本  |  ZIP 字节 | ZIP MiB |  解压字节 | 文件数 |
| ---------------- | ----- | --------: | ------: | --------: | -----: |
| voice-runtime    | 1.0.0 | 133853592 |  127.65 | 431733455 |   6832 |
| speech-input     | 1.0.0 | 160310562 |  152.88 | 239560934 |      6 |
| bert-japanese    | 1.0.0 | 365027764 |  348.12 | 408491314 |     10 |
| voice-ireina     | 1.0.0 | 231253343 |  220.54 | 249421901 |      5 |
| genie-tts        | 1.0.1 | 178213817 |  169.96 | 559616288 |  13218 |
| genie-data       | 1.0.0 | 283237298 |  270.12 | 373792956 |      4 |
| voice-genie-mika | 1.0.0 | 305533156 |  291.38 | 336874992 |     14 |

总下载量 1,657,429,532 字节，约 1.54 GiB。完整校验记录位于 src/main/speech/speech-asset-integrity.ts；资源 Release 也附 measurements.json 和 SHA256SUMS.txt，后者仅供人工核对。

## 真实验证与界面观察

1. 七个实际 ZIP 均经本体下载器从回环 HTTP 下载、合并、SHA 校验、解压和激活；未 mock 生产信任记录。离线库存恢复七项已安装状态。
2. 安装后的伊蕾娜 DirectML 发声成功，WAV 260948 字节；同一套组件 CPU 发声成功，WAV 228396 字节。Genie 未花安装后受管理启动和发声成功，WAV 465964 字节。随机采样会使不同次发声长度不同。
3. 使用 16 kHz 测试音频，开发 Electron 与打包后的 Electron 原生 ASR 得到相同日语结果“こんにちは。今日はいい天気ですね。”；模型缺失的路径返回不可用。测试文本公开、合成音频不含用户录音。
4. 七个 GitHub 附件均由 Electron 真实请求验证 Range 206、Content-Range、长度和 ZIP 签名。随后完整下载 133853592 字节的 Style-Bert-VITS2 引擎，四段合并、SHA 校验、解压及激活成功。其他六个公开附件未再次完整下载；服务端 digest 已与本地归档逐项核对。
5. 浏览器实际观察四类导航及基础模型模板，卡片布局正常；这是开发预览，不是打包后的原生窗口或实际听感验收。
6. pnpm verify 全部通过：125 个测试文件、604 项测试；pnpm package:win 本地打包成功。完整校验包括类型检查、生产构建、两个沙箱 Preload、原生 sherpa 和 SQLite 冒烟。Python 的三项终止标记回归另行执行，不混入 Vitest 数量。
7. 打包内容检查：版本 1.8.0，五个 sherpa 原生文件在 asar.unpacked；语言包仅 en-US/zh-CN；没有 dxcompiler.dll、dxil.dll、.cmo3、角色模型、ONNX 权重或 Python 被混入主包。

## 正式下载中发现并修复的问题

- GitHub Release 附件会跳转到存储域名，旧下载器拒绝全部跳转，导致资源上传后客户端仍不能下载。
- Electron net.fetch 的手动重定向会报 Redirect was cancelled，普通 Node fetch 测试无法发现。Main 现用 net.request 暴露重定向响应，下载器只准本仓库跳转一次到 HTTPS release-assets.githubusercontent.com；不直接 followRedirect，不携带会话凭据。
- 清单增加 8 秒超时和 256 KiB 流式上限，拒绝没有 Content-Length 的超大响应；单次下载 30 分钟超时，保留用户取消与续传。
- 新回归覆盖重定向来源、二次跳转、Electron 取消、超大清单和全类别卡片字段。

## 旧任务书的对应关系与仍需验收的项目

用户最新要求本轮完成全部 v1.8 任务，不再将目视验收移至 v1.9。以下是开始补齐前的状态。

- R1：本地打包、原生 ASR、裁剪检查、两套 TTS 发声与实际组件大小已验证。独立 GPU / 强制软件渲染的 Live2D 人工观察尚未完成；不能把无界面原生测试当作这项验收。
- R2：用户后续明确采用四类独立组件和主动安装，取代旧的两档静默预下载方案；不重新合并 BERT，不恢复开机自动下载。计费状态、体积与磁盘余量检查保留。
- R3：继续完整下载并 SHA 校验后解压。下载前要求 解压大小×1.3 + ZIP大小 +500 MiB；并发安装会同时占用磁盘，错误路径仍须保留有效旧包。
- R4：自动故障回归已通过。拔网线、真实磁盘耗尽、强杀桌宠并同时观察 UI 的整套人工实验未完成；不在用户正在使用的真实磁盘或桌面上制造破坏性条件。
- R5：旧计划中 memory-panel、settings-provider、settings-speech、settings-vtube、settings-character 五个面板的进一步拆分仍为维护待办，本轮未扩大到这些设置面板重构。不能将旧第二轮任务表整体标记完成。
- R6：Genie 实际安装、合成和末尾标记修复已验证，取消及边界有回归；自然度、角色相似度仍以用户试听为准。
- R7：仓库、下载源和七项组件已落实，许可随包保留。伊蕾娜仅非商用；Mika 上游示例的角色和声音权利不因 MIT 标注而转移。OneDrive 传统 VITS/MoeGoe 与黑猫素材未上传。

## 本地证据位置

- .release/v1.8-resource-review/verify.log、package.log
- .release/v1.8-resource-review/github-assets-verified.json、public-download-smoke.json、public-full-install.log
- .release/v1.8-resource-review/install-all.log、cpu-smoke.log、asr.log
- .release/genie-review/all-components-result.json、probe-tail.json、tail-install-result.json
- .release/v1.8-resource-review/ireina-installed.wav、ireina-cpu.wav；.release/genie-review/mika-installed-tail-fixed.wav

不要将上述临时构建目录加入 Git；后续版本须基于其对应源码重新核对版本、最终 ZIP 与完整验证。
