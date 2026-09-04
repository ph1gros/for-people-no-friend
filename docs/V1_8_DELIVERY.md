# V1.8 交付与非目视验收记录

更新：2026-09-05。供 Claude 或后续维护者复核。沿用现有 main 工作区，未新建 clone 或 worktree。

## 本轮结果

- 主程序版本 1.8.0；完成代码与非目视验证后打包、推送并发布。最终附件大小及 SHA-256 见本文末尾发布测量。
- 资源仓库：[fpnf-resources](https://github.com/ph1gros/fpnf-resources)，组件发布：[components-v1.8.0](https://github.com/ph1gros/fpnf-resources/releases/tag/components-v1.8.0)。七个当前组件按需下载，旧引擎附件仅保留兼容记录。
- 独立资源窗口、任务栏入口、四类导航、搜索、下载进度、暂停／继续／取消已实现；卡片统一用途、适配引擎、语言、配套资源、版本、大小、许可。
- memory-panel、settings-provider、settings-speech、settings-vtube、settings-character 五个面板分别拆分和提交。chat-controller 从本轮基线 5447 行降至 2930 行；状态和跨面板协调仍留在控制器，不引入新全局 store。
- Genie-TTS 1.0.4 保留 EOS 修复，新增保守的长停顿降噪及 HTTP 断开后恢复。未修改 ONNX 权重、参考音频或模型结构。

## 自动检查与真实运行

1. pnpm verify：131 个测试文件、622 项测试通过，包含 lint、格式、双 TypeScript 检查、生产构建、沙箱 Preload、Electron 原生 sherpa 与 SQLite 冒烟。
2. 九项 Python 回归覆盖终止标记、有效零值、重复初始化、异常返回、停顿门控、轻声与短停顿保留、ASGI 断开、鉴权拒绝及停止后的队列清理。
3. 真实 Electron 加载拆分前和拆分后的 initializeChat，设置页完整 DOM（标签、类名、属性、控件值及文本）深度相等，两次初始化和 dispose 均成功。期间发现并修复重复角色页装配；不能用“单元测试全绿”替代这项检查。
4. 七个实际组件均通过本体下载器的冻结哈希、大小、解压和激活检查，离线库存恢复七项。更新后的 Genie 1.0.4 使用实际 ZIP 安装后启动、合成成功；DirectML 的伊蕾娜真实合成也成功。
5. 原问题音频 7.28 秒；4.1–4.7 秒噪声 RMS 从 388.35 降至 11.42，约降低 30.6 dB。长度不变，绝对幅度大于 5000 的发音采样不变。本地 SenseVoice 在处理前后均识别为“先生、こんにちは 今日もよろしくね。”。这证明本样本的信号改善与识别内容保留，不等于人工自然度验收。
6. 真实 HTTP 打断先发现后续请求持续 409；修复 receive 包装后又通过 ASR 发现后续音频混入旧句。最终由纯 ASGI 鉴权原样传递 receive，并在停止、等待工作线程结束后清空旧文本／音频队列。客户端取消约 0.27 秒返回，后续音频为 140844 字节，ASR 仅得到“こんにちは。”；无会话凭据、带 Origin 及服务不可达均安全拒绝。
7. 七个公开 GitHub 附件经 Electron 真实 Range 请求验证 206、长度与 ZIP 签名，服务端 digest 与本地测量一致。此前还完整下载 133853592 字节 Style 引擎并激活；未重复完整下载所有公开附件。
8. 安装后的 Style CPU／DirectML 与原生 ASR、最终打包内容检查分别执行；最终包的原生 ASR 与开发版使用同一测试音频，模型缺失返回不可用。

## 下载故障注入

实验使用真实生产下载器、真实已冻结的 127.65 MiB Style 引擎 ZIP、仓库内独立测试目录和回环 HTTP，不改生产信任记录。

| 场景                      | 实际结果                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| 中途断开 TCP 连接         | 留下 2097152 字节断点；重试从该位置请求 Range，安装成功                                            |
| 强制结束独立下载进程      | 留下 2358888 字节断点；新进程从断点恢复并安装                                                      |
| 可用空间为零              | 注入 statfs 返回，下载前中文提示，服务器未收到请求                                                 |
| 写入时 ENOSPC             | 在真实文件句柄写入边界注入，中文提示，原有资源保留                                                 |
| ZIP 改一个字节            | SHA256 失败，损坏下载删除，未激活                                                                  |
| 所有下载源不可用          | 错误返回，原有激活记录保持不变                                                                     |
| 激活前 staging 被外部删除 | 回滚并恢复原有资源，清理残留，重试成功                                                             |
| 下载中变为计费网络        | 每 10 秒检查；变为计费或无法确认费用时暂停，手动继续可明确使用当前网络；完成和退出后释放监测计时器 |

磁盘耗尽通过文件系统边界注入，没有填满用户系统盘；断网通过断开真实本地连接，没有拔掉用户网络。以上为非目视故障验收，不声称观察过故障过程中的 Live2D 帧率。

## 任务书对应关系

- R1：本地打包、依赖裁剪、CPU／DirectML TTS、原生及打包 ASR 完成；不同 GPU 的目视部分保留在 V1.9。
- R2：四类独立资源和显式安装是用户后续指定方案，取代两档静默预下载；保留进度、磁盘余量、计费策略，不恢复自动下载。
- R3：采用完整下载、SHA 校验后解压。下载前预留解压大小×1.3 + ZIP 大小 +500 MiB。
- R4：上述全部非目视故障场景完成；物理拔网线、填满系统盘及人工帧率观察未冒充完成。
- R5：五个模块、独立测试、监听／定时器清理、真实 DOM 对比、每面板独立提交均完成。
- R6：实际安装、后台启动、合成、取消后恢复、不可达回退完成；无真实在线账户密钥的 Fish／在线 TTS 用受控测试覆盖，未调用付费服务。自然听感保留人工判断。
- R7：公开托管、清单、七项组件及许可说明完成。伊蕾娜仅非商业使用；传统 OneDrive VITS/MoeGoe 和黑猫素材未上传。

## 信任和发布边界

远程目录仅展示信息，下载清单仅提供 ID、版本、URL。哈希、压缩和解压体积、文件数、目标目录均在主程序编译期冻结；入口重新解析。版本不匹配或未测量的资源不可激活。

Genie 引擎 1.0.4：178215260 字节，解压 559619995 字节，13218 个条目，SHA-256 为 b7fc2610ed34bc9b1ca7d6e739dc2524a821185b8889cd5b8405d1a710bad00f。其他六项不变；七项合计 1657430975 字节，约 1.54 GiB。

主程序包不含 ONNX、Python 解释器、角色模型、训练原始录音、用户配置、对话或凭据；包含项目自己的语音服务脚本。sherpa 原生文件置于 asar.unpacked，保留 en-US／zh-CN 两个语言包。README 与第三方许可随发布更新。

## 本地证据

- .release/panel-extraction/*-verify.log、dom-before.json、dom-after.json、dom-smoke.log
- .release/v1.8-resource-review/final-verify.log、fault-smoke-results.json、install-final.log、public-final-smoke.log
- .release/genie-review/python-regression.log、cancel-final-result.json、final-components-result.json
- .release/genie-review/breath-probe/report.json、fix-measurements.json、asr-comparison.json
- .release/genie-review/breath-probe/reported-sample.wav 与 reported-sample-cleaned.wav；新安装试听 mika-v1.8-final.wav

临时模型、归档及音频不加入主程序 Git。人工目视和听感待办见 [V1.9 验收](V1_9_VISUAL_ACCEPTANCE.md)。

## 发布测量

- 主程序发布：[v1.8.0](https://github.com/ph1gros/for-people-no-friend/releases/tag/v1.8.0)。
- 附件：`FPNF-v1.8.0-Windows-x64.zip`，145527660 字节，138.79 MiB；附带 `SHA256SUMS.txt`。
- 主程序解压目录：354165187 字节，约 337.76 MiB；ZIP 另附许可证和中文使用说明。
- SHA-256：`298010d09aeef40a55fdaf17df88c0864041abae0dedacbe48d143a750ca8ca8`。
- ZIP 完整性检查通过；包内 3080 个 asar 条目及 5 个原生文件检查通过。打包后的 Electron 43.4.1 / Node 24.18.1 实际执行原生 ASR，识别“こんにちは。今日はいい天気ですね。”，模型缺失时返回不可用。
- 资源仓库对应元数据提交：`29662872d7fdebbe45348f430a352eb6c51193d4`。
