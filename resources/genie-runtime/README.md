# Genie-TTS 本地组件

首个配套音色为 **圣园未花（Mika）**，角色出自《蔚蓝档案》，合成语言为**日语**。
需要同时安装 `genie-tts`（引擎）、`genie-data`（基础模型）和 `voice-genie-mika`（音色）。
这不是传统 VITS/MoeGoe 模型加载器；本轮不处理 OneDrive 音色。

## 运行范围

- FPNF 引擎组件版本为 1.0.1（上游 Genie-TTS 仍为 2.0.2）；基础模型和音色组件仍为 1.0.0。
- 使用 Genie-TTS 2.0.2、ONNX Runtime 1.22.1 CPU、NumPy 1.26.4 和独立 Python 3.12.10。
- `requirements.lock` 固定 Windows x64 / CPython 3.12 日语推理所需 wheel 的版本及哈希；不安装转换、训练、中文或英文前端。
- Main 在三项组件均通过现有安装校验并具备匹配的激活记录后启动固定入口，监听 `127.0.0.1:9882`。
- Main 生成临时会话凭据，服务拒绝缺少凭据或带 Origin 的请求。凭据不进入 Renderer、用户设置或日志。
- 只开放 `/ready` 和固定角色的 `/tts`；不加载上游的通用 Server，不接受文件路径、模型路径、保存路径或任意角色。
- 启动及推理不下载任何模型。固定模型路径在导入 Genie 前设置，禁用 Hugging Face 在线访问及隐式令牌读取。
- 首次准备会加载模型并做一次静音合成；状态显示后台预热，文字聊天先可用。准备完毕后才显示语音可用。

## 句尾气声修正

固定的 Genie 2.0.2 `t2s_cpu` 会把最后一个结束标记改为 `0`，并把该位置留在声码器输入中。
在 Mika V2ProPlus 上，这个额外位置会生成约 40 ms 的尾音。
FPNF 在调用声码器前排除这个由解码器插入的末尾占位值，保留全部前置语音值（包括有效的零值）。
仅适用于当前固定运行时；返回形状或末尾约定不符时拒绝推理，不猜测新版本的协议。
不裁切固定长度的 PCM，不使用能量门限删掉低声、呼吸或正常尾音。

离线回归使用组件 Python 运行：

```text
<组件python> -B -m unittest discover -s resources/genie-runtime -p test_terminal.py
```

测试覆盖末尾占位、正常零值保留、重复安装修正、取消及异常形状。

## 来源与可重复准备

引擎：[High-Logic/Genie-TTS](https://github.com/High-Logic/Genie-TTS)，MIT。
模型：[High-Logic/Genie](https://huggingface.co/High-Logic/Genie)，固定提交
`52b17272e0b7032415e85ad37b551db2386b1810`。
`upstream-assets.lock.json` 记录实际采用文件的路径、大小、SHA256；没有转换或修改权重。
上游资源仓库标注 MIT；角色与声音相关权利不因此转移，使用前需阅读随附说明。

Python 嵌入包使用官方 `python-3.12.10-embed-amd64.zip`，SHA256：
`4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3`。

维护者准备工作目录 `.release/genie-components/`，内含上述三个同名组件目录。
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

组件 ZIP 已发布到 https://github.com/ph1gros/fpnf-resources/releases/tag/components-v1.8.0 ，v1.8.0 主程序内置正式下载路由。
公开目录的显示文字不会授权下载或执行代码。
