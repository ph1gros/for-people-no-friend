# Genie-TTS 本地组件

配套音色为 **圣园未花（Mika）／日语／《蔚蓝档案》**、**菲比（Feibi）／中文／《鸣潮》**和 **37（ThirtySeven）／英语／《重返未来：1999》**。
需要安装 `genie-tts`（引擎）、`genie-data`（基础模型）和所选音色。中英文另需 `genie-language-data`（发音词典）；日语不依赖这个词典包。
这不是传统 VITS/MoeGoe 模型加载器；本轮不处理 OneDrive 音色。

## 运行范围

- v1.8.2 配套的 FPNF 引擎组件版本为 1.1.2（上游 Genie-TTS 仍为 2.0.2）；基础模型和音色组件仍为 1.0.0。公开 v1.8.1 使用的旧引擎仍为 1.0.4。
- 使用 Genie-TTS 2.0.2、ONNX Runtime 1.22.1 CPU、NumPy 1.26.4 和独立 Python 3.12.10。
- `requirements.lock` 固定 Windows x64 / CPython 3.12 中日英推理所需 wheel 的版本及哈希；不安装转换或训练工具。
- 所选音色所需组件均通过安装校验并具备匹配的激活记录后启动固定入口。Mika、Feibi、ThirtySeven 分别使用固定回环端口 9882、9883、9884，按首次使用懒启动，退出应用时全部结束。独立进程防止并行请求串音；同一音色复用进程和预热结果，切换多个音色后会占用更多内存。
- Main 生成临时会话凭据，服务拒绝缺少凭据或带 Origin 的请求。凭据不进入 Renderer、用户设置或日志。
- 只开放 `/ready` 和固定角色的 `/tts`；不加载上游的通用 Server，不接受文件路径、模型路径、保存路径或任意角色。
- 启动及推理不下载任何模型。固定模型路径在导入 Genie 前设置，禁用 Hugging Face 在线访问及隐式令牌读取。
- 首次准备会加载模型并做一次静音合成；状态显示后台预热，文字聊天先可用。准备完毕后才显示语音可用。

## 句尾气声修正

固定的 Genie 2.0.2 `t2s_cpu` 会把最后一个结束标记改为 `0`，并把该位置留在声码器输入中。
在 Mika V2ProPlus 上，这个额外位置会生成约 40 ms 的尾音。
FPNF 在调用声码器前排除这个由解码器插入的末尾占位值，保留全部前置语音值（包括有效的零值）。
仅适用于当前固定运行时；返回形状或末尾约定不符时拒绝推理，不猜测新版本的协议。
这项终止标记修复不裁切固定长度的 PCM。

1.0.4 另含保守的长停顿降噪：只在有明确发音能量参照、低能量区间超过 450 ms 时衰减停顿噪声。
保留发音前 120 ms、后 200 ms，使用渐变增益；不改变音频长度、语速或音高。整体很轻的音频及短停顿保持原样。
这是能量门控，不是呼吸分类模型，不能保证所有音色、轻声和情绪表达都与人工试听一致。
原问题音频 4.1–4.7 秒区间 RMS 由 388.35 降至 11.42，长度保持 7.28 秒，降噪前后本地 ASR 文本一致。

1.1.1 针对菲比“你好，我是菲比”的“比”后吸气：原 200 ms 尾字保护区保留了极弱气声。
在已确认的长停顿中，只有尾声能量极低、无明显周期性且高频占比低时，才将这段保护区缩短，最少保留 40 ms，并使用原有渐变衰减。检测到轻声元音或高频辅音时，继续保护整个分析窗口；其他音色仍使用原处理。
原试听 2.12–2.24 秒区间 RMS 从 68.10 降至 1.88（约 31.2 dB）；1.30–2.06 秒“我是菲比”逐采样不变，全长仍为 6.40 秒，整句 ASR 文字一致。
这是针对弱句尾气声的保守规则，不是通用呼吸识别器，也不剪去固定长度的尾字。

1.1.2 仅对 37 开启短停顿气声处理：停顿两侧需有发音，保留两侧 40 ms，连续至少 80 ms 满足低能量、低周期性与频谱条件才渐变衰减。原样本 2.25–2.39 秒 RMS 39.19→11.17、3.96–4.10 秒 113.38→5.33，长度及前 2.20 秒不变；用户已认可试听。Mika、菲比现有样本的新旧处理逐字节一致。低频底噪未扩大处理，样本验证不保证所有英文辅音均无损。

HTTP 鉴权使用纯 ASGI 中间件，检查请求头后原样传递接收通道，避免隐藏客户端断开事件。
断开后取消当前合成、释放锁；停止并等待旧工作线程结束后清除残留队列，防止新请求混入旧句。后续请求可以继续。鉴权、Origin 拒绝、体积与路径边界保持有效。

离线回归使用组件 Python 运行：

```text
<组件python> -B -m unittest discover -s resources/genie-runtime -p "test_*.py"
```

二十二项回归覆盖末尾占位、正常零值保留、重复修正、异常形状、停顿降噪、轻声和短停顿保留、实际 ASGI 断开、鉴权、停止后队列清理、跨音色请求拒绝、对应语言预热、菲比弱尾声和正常尾音保护，以及 37 短停顿处理的八项回归。

## 来源与可重复准备

引擎：[High-Logic/Genie-TTS](https://github.com/High-Logic/Genie-TTS)，MIT。
模型：[High-Logic/Genie](https://huggingface.co/High-Logic/Genie)，固定提交
`52b17272e0b7032415e85ad37b551db2386b1810`。
`upstream-assets.lock.json` 记录实际采用文件的路径、大小、SHA256；没有转换或修改权重。
上游资源仓库标注 MIT；角色与声音相关权利不因此转移，使用前需阅读随附说明。

Python 嵌入包使用官方 `python-3.12.10-embed-amd64.zip`，SHA256：
`4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3`。

维护者准备工作目录 `.release/genie-components/`，内含上述六个同名组件目录。
引擎目录含 `python/`、本目录的 `fpnf_genie_service.py` 和 `LICENSE.txt`。
`python312._pth` 含 `python312.zip`、`.`、`Lib/site-packages`、`import site` 四行。
用维护者自己的 pip 将锁定 wheels 离线安装到 `python/Lib/site-packages`：

```text
python -m pip --isolated install --no-index --find-links <已校验的wheel目录> --no-deps --require-hashes --no-compile --target <组件中的site-packages> -r resources/genie-runtime/requirements.lock
```

基础模型和音色根据上游锁文件复制到各自组件目录，保留每个包的 `LICENSE.txt`。
使用 `python scripts/measure-genie-components.py` 生成本地组件 ZIP 和测量记录；仅更新引擎时加 `--tier genie-tts`。
脚本不会下载资源、上传文件或修改信任表。测量结果须人工复核后写入源码冻结记录；任何文件变化都需要重新测量并更新应用版本。
归档不含生成的 `__pycache__`，依赖许可证保留在各 wheel 的 dist-info 中。

1.1.0 补充 nltk、pypinyin、g2pM、jieba 及传递依赖，具体版本与 wheel 哈希见 `requirements.lock`。
上游 jieba_fast 0.53 没有 Windows CPython 3.12 wheel；中文服务使用原版 MIT jieba 0.42.1 的分词与词性接口适配，不改模型权重。
其官方源码包 SHA256 为 `055ca12f62674fafed09427f176506079bc135638a14e23e25be909131928db2`；本地构建纯 Python wheel 后按锁文件哈希复核。重新构建产生不同 wheel 时必须重新审核和测量，不能直接复用旧锁。
词典文件位于上游固定提交的 `GenieData/G2P`，按原字节保留。当前中文不安装可选的 RoBERTa，使用 Genie 上游支持的无 RoBERTa 路径；普通中文合成已验证，细微韵律仍需人工试听。
菲比直接朗读中文；37 遇到中文时通过用户当前聊天模型转换为英语，不切换提供商，转换失败保留文字并停止本次语音。英文原文直接合成。

旧版组件 ZIP 已发布到 https://github.com/ph1gros/fpnf-resources/releases/tag/components-v1.8.0 。v1.8.2 配套引擎 1.1.2、词典、菲比和 37 使用 components-v1.8.2 发布；主程序改用独立版本目录和 speech-assets-v1.8.2.json，保留旧版应用的清单及归档。
公开目录的显示文字不会授权下载或执行代码。
