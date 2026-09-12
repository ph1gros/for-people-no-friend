# V1.9 Commit 与发布范围审查

审查日期：2026-09-13。本记录区分当前 V1.9 工作区、尚未合并的 PR #2、自动验证和发布产物；不把未合并分支的问题归入当前基础包。发布结果统一见 [V1.9 交付记录](V1_9_DELIVERY.md)。以下 GitHub 快照注明了核查时点，避免将旧 main 状态误作发布后的最新状态。

## 已核实的 GitHub 状态

| 对象                                          | 本次只读核实结果                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 仓库                                          | [ph1gros/for-people-no-friend](https://github.com/ph1gros/for-people-no-friend)，公开仓库，默认分支 main                                                                                   |
| 当前开发基线、审查开始时本地 HEAD 与远端 main | [4e556326ddcfefe6acdf3f54682f74ac5c60ca55](https://github.com/ph1gros/for-people-no-friend/commit/4e556326ddcfefe6acdf3f54682f74ac5c60ca55)，v1.8.3 发布提交                               |
| 更早的 v1.8.2                                 | [8836cc3bb0ee56a8457f56b01fe47c9a9477c7ba](https://github.com/ph1gros/for-people-no-friend/commit/8836cc3bb0ee56a8457f56b01fe47c9a9477c7ba)                                                |
| 基线 main CI                                  | [run 34133396199](https://github.com/ph1gros/for-people-no-friend/actions/runs/34133396199)，上述完整基线 SHA，completed / success                                                         |
| 当时最新公开正式 Release                      | [v1.8.3](https://github.com/ph1gros/for-people-no-friend/releases/tag/v1.8.3)，2026-09-07 发布；ZIP 145,567,461 字节，另有 SHA256SUMS.txt                                                  |
| PR #2                                         | [feat: 社交存在（QQ / KOOK / 实验性 Oopz）与配置引导](https://github.com/ph1gros/for-people-no-friend/pull/2)，OPEN，未合并                                                                |
| PR #2 当前 head                               | [a88599ee1ab3eec326ccd5f73fb9f0f77aa59d1c](https://github.com/ph1gros/for-people-no-friend/commit/a88599ee1ab3eec326ccd5f73fb9f0f77aa59d1c)，feature/social-presence，base 为上述 main SHA |
| PR #2 CI                                      | [run 34303191108](https://github.com/ph1gros/for-people-no-friend/actions/runs/34303191108)，该 head 的 verify 成功；本次 API 未返回 review/comment 记录，CI 成功不等于本审查意见已修复    |
| V1.9 最终发布提交                             | [v1.9.0 所指提交](https://github.com/ph1gros/for-people-no-friend/commit/v1.9.0)；完整 SHA 同时记录于 Release 说明                                                                         |
| V1.9 远端 CI / tag / Release / ZIP digest     | [最终发布结果](V1_9_DELIVERY.md#验证与发布测量)；远端 CI 的具体 run 与完整提交 SHA 记录于 Release                                                                                          |

以上来自 `gh repo view`、`gh api .../commits/main`、`gh pr view 2`、PR 固定 head contents、`gh run list` 与 Release API。没有读取真实账号凭据或用户配置。

## 问题数量和适用范围

| 类别                                                               | 数量 | 范围与意义                                                                                                                |
| ------------------------------------------------------------------ | ---: | ------------------------------------------------------------------------------------------------------------------------- |
| confirmed / 已确认 P0                                              |    0 | 本轮审查没有发现                                                                                                          |
| confirmed / 已确认 P1                                              |    1 | 仅 PR #2 的隐私投影；当前 V1.9 main 未包含该社交实现                                                                      |
| confirmed / 已确认 P2                                              |    1 | 仅 PR #2 的单个非当前角色删除会中断当前社交会话                                                                           |
| 当前 V1.9 已审 widget / IPC / downloader 边界的新增 confirmed 阻断 |    0 | 限定于下述审阅范围，不表示全部功能或发布产物已验收                                                                        |
| possible / 尚需证据判断                                            |    1 | 捆绑试听音频的公开分发来源链与说明适用范围，见后文；不是已确认侵权或代码漏洞结论                                          |
| scope / 审查开始时的待核实分组                                     |    7 | 最终提交CI、打包内容、系统显示环境、时钟进程重启、显示端完整表达、真实听感/读屏、在线账号与独立研究；不计为已确认代码缺陷 |

本轮没有把泛化风险、未进行的人工验收或旧基线问题凑成缺陷数量。PR #2 的两项应在合并该 PR 前解决；保持 PR 不合并时，不以它们阻断独立 V1.9 工作区的发布。

## PR #2：两项仍未修复

### P1：非主人社交请求的公开投影仍靠关键词排除

固定 head 的 [social-conversation-port.ts:67](https://github.com/ph1gros/for-people-no-friend/blob/a88599ee1ab3eec326ccd5f73fb9f0f77aa59d1c/src/main/social/social-conversation-port.ts#L67) 只按主人名与中英文关键词判断公开性，随后保留通过过滤的 identity、personality、background、speechStyle、sources 和部分 knowledge records。非 owner-direct 请求在[211 行](https://github.com/ph1gros/for-people-no-friend/blob/a88599ee1ab3eec326ccd5f73fb9f0f77aa59d1c/src/main/social/social-conversation-port.ts#L211)把这个结果传为 promptProfile/includeKnowledgeRecord。

本次读取该固定版本，提取真实 `publicCharacter` 函数，以合成资料执行有界内存探针：不含主人名或关键词的门禁口令与就诊安排仍完整出现在投影的 background；输出 `privateBackgroundSurvives:true`。全部内容为测试合成数据，没有使用私人资料或真实凭据。此证据证明非公开内容能通过投影，不声称已向真实 QQ/KOOK 用户发送。

修法应采用显式公开字段/记录投影，未标注的旧资料默认不向非主人公开；保留可公开的角色设定需要明确可审计的来源与可见性，而不是不断扩充关键词黑名单。回归应覆盖不含过滤关键词的敏感语义、旧资料默认拒绝、主人私聊和明确公开设定的不同输出。

### P2：单个非当前角色删除无条件停止当前会话

固定 head 的 [register-ipc-handlers.ts:597](https://github.com/ph1gros/for-people-no-friend/blob/a88599ee1ab3eec326ccd5f73fb9f0f77aa59d1c/src/main/ipc/register-ipc-handlers.ts#L597)在检查删除目标是否为当前角色之前无条件调用 `onCharacterChanging`；Main 的[505 行](https://github.com/ph1gros/for-people-no-friend/blob/a88599ee1ab3eec326ccd5f73fb9f0f77aa59d1c/src/main/index.ts#L505)将其映射为 QQ、KOOK、Oopz 的 stop。删除一个非当前安装角色不会改变当前角色，仍会切断当前社交会话，甚至后续删除失败也已经触发停止。

该 PR 的 [character-change-ipc.test.ts:52](https://github.com/ph1gros/for-people-no-friend/blob/a88599ee1ab3eec326ccd5f73fb9f0f77aa59d1c/tests/character-change-ipc.test.ts#L52)验证的是批量 `clearInactiveCharacters` 不取消会话，不能覆盖 `removeCharacter` 的单删路径。本审查没有把批量清理误报为问题。

修法是在受控删除操作内读取当前 profile，只有删除会影响当前绑定角色时才同步失效其会话；非当前角色单删和删除前校验失败应保持当前会话。补充单删 inactive、删除 active 与不存在目标三种行为回归。

## 当前 V1.9 边界复核

- **小组件安装**：Renderer 只暴露无参数 `installClockWidget`；Main 拒绝额外参数，经可信主 frame registrar 注册。批准服务仅给出固定 clock、版本和 GitHub 资源路径，Renderer 不能提供下载 URL、目标、哈希或代码。
- **信任与包内容**：`WIDGET_PACKAGE_INTEGRITY` 顶层和条目均冻结；安装先检查应用固定尺寸与 SHA-256，再检查受限归档。仅允许 manifest、静态 SVG 和指定语言 JSON；路径、链接、执行格式、权限和格式有明确拒绝。目标为校验后的固定 ID，安装使用受控 staging / backup，失败保留旧安装。
- **运行时**：从批准信任表枚举 ID，没有发现任意目录扫描或 ZIP 导入入口。组件快照禁用时不读取数据源；读取时重新验证权限。媒体与选定输入仍来自 Main 的已有状态；Renderer 以 textContent 和受限 progress 渲染，不解释模板或 HTML。
- **IPC 与持久化**：新增时钟安装、固定 VTS 工坊方法维持窄 preload。启停 ID 由 Main 注册表再次校验。schema 6 使用临时文件后重命名；包缺失时过滤可选 ID，保留内置媒体/输入设置。当前自动证据包括真实临时安装、启停与服务重建保持。
- **共享下载器**：顺序下载抽到 `downloadArchive` 后保留长度、Range、重试与取消核对；补完整部分写循环，校验失败由调用方处理。GitHub Release 的一次重定向仍只接受固定 GitHub asset origin，其余跳转拒绝。固定哈希及目标信任仍由 speech/widget 调用方保有，远端路由不能提供信任依据。
- **本地 Core**：生产模型清单不能指定可执行 Core 来源。显式 local-core 模式只读取固定普通文件并核对已知本地指纹；普通构建不包含该文件。发布准备又在 electron-builder files 中显式增加 `!dist/renderer/runtime/cubism/**/*`，即使跳过普通构建也应排除该固定路径；不能继续把此前仅依赖构建顺序的风险描述为当前未修复缺陷。该指纹不是官方发布授权证明，最终仍以实际 asar 内容检查为准。
- **随包素材说明**：发布配置已通过 extraResources 将试听 README、IREINA-LICENSE、GENIE-LICENSE 单独放入 `licenses/voice-previews/`，不再仅依赖界面内嵌说明。后续成品实查确认三份文件与源码逐字节一致。

未在这些已阅边界发现需要立即修复的新增 P0/P1/P2。新增动作另经独立复核，发现并修复失焦锁住后台手势、旧动作迟到回调清除新动作状态两项问题；随后针对回归和真实 Cubism 参数检查通过，未保留这两项为未修复问题。

## 发布风险与尚未核实项

1. **最终提交与 CI**：所有生产改动冻结后，完整本地 verify 已重新通过；当前计数、源码/成品核验及对应发布提交统一见交付记录。最终 CI 必须绑定实际待发布完整 SHA，不能用 v1.8.3 的成功 run 代替。
2. **产物内容**：使用标准 `pnpm package:win` 先普通完整构建；新增显式 Core 排除规则再提供一道打包边界。成品 ZIP/asar 已检查，不含 Core、私人模型/权重、用户配置和 `.release` 证据，三个试听来源说明文件已核对。`.pnpm-store/`、`Claude outputs/` 等现有未跟踪目录不属于提交清单，不能全量暂存。
3. **系统显示环境**：浏览器尺寸矩阵不等于 Windows 100/125/150% DPI、多屏移动、系统任务栏与真实下载/解压帧率验收。受控本地 Core 下实际模型显示不等于标准安装包自带 Core。
4. **时钟进程保持**：启停及设置页保持已实机确认；临时存储服务重建已自动通过。独立3 PID探针仍在入口前退出，既不是产品失败，也不是主进程重启通过。
5. **显示端完整表达**：基础 VTS/Spout、ViewerEX 消息发送和纯Live2D基本显示与对应提示已有证据；ViewerEX真实映射、十通道强弱/连续打断/恢复自然度、口型不抢占仍不能一并宣称全部通过。
6. **听感与无障碍**：四试听媒体状态、向导键盘与可访问树已有真实浏览器证据；使用者确认了语音本身。细项主观听感、全部停止/离页后的扬声器声音、NVDA/Narrator实际朗读仍按验收记录保留边界。
7. **账号和研究范围**：在线Fish/OpenAI及翻译需使用者自行配置真实账号再验收；Astra仍是独立研究，Oopz在未合并PR中仍未接入生产运行时。不能把资源上传、生成样本或进程存活作为正式生产接入完成。

**Possible 项：音频来源说明。** 捆绑试听现在会进入基础包；`IREINA-LICENSE.txt`标题及开头仍称其仅适用于独立可选包，且未提供可核对的上游固定来源；`GENIE-LICENSE.txt`给出具体仓库与revision，但也明确原始角色/声音权利另行适用。现有文字不是足以由本审查独立确认全部生成录音公开分发权利的完整来源链。随包 README 已澄清“基础包中的短试听录音”和未随包分发的模型权重，并保留原许可文字；公开上游来源链仍未补齐。本项没有作法律有效性或侵权认定。

## 最终复核和后续验收

最终源码通过固定 [v1.9.0 提交](https://github.com/ph1gros/for-people-no-friend/commit/v1.9.0)定位，Release 记录完整 SHA、对应 GitHub CI、附件与校验结果。产物体积、SHA-256、排除内容、成品启动和 ASR 检查集中于交付记录，避免维护两份版本状态。

本次审查没有合并 PR #2 或在 GitHub 发布审查评论。PR 的两项已确认问题仍需在其合并前修复；系统显示矩阵、时钟主进程重启、完整表现/听感和独立研究仍按交付记录保留。阶段 7 组待核实事项中，成品内容及本地最终验证已经收口，不能继续描述为没有检查。
