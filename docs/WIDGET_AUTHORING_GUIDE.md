# 声明式小组件作者指南

本指南描述 V1.9 的开发契约。当前实现与尚未开放的分发环节见 [V1.9 工作记录](V1_9_IMPLEMENTATION.md)。示例可在开发环境测量、验证；当前公开版本仍是 v1.8.3。

## 包结构

包名必须为 `<id>.zip`。ZIP 根目录必须直接包含 `manifest.json`，可选 `icon.svg`、`strings/zh-CN.json` 与 `strings/en-US.json`。不允许额外文件、目录条目、脚本、压缩包嵌套或链接。归档和解压内容各不超过 1 MiB，条目最多 32。

完整示例见 [时钟清单](examples/widget-clock/manifest.json)。

- `capability.version` 固定为 1；`kind` 固定为 `widget`；`id` 为 1–64 个英文字母、数字、下划线或连字符，保留 ID 不可使用。
- `permissions` 最多四项；`timeoutMs` 为 100–30000 的整数，表示组件操作的预算，不允许作者用它提高系统采样频率。当前数据读取均为固定本机同步读取。
- `title`、`description`、`iconText` 的 JavaScript 字符串长度分别为 1–32、1–120、1–4，不接受空白文案。
- `layout.rows` 为 1–6 行。每行只能使用下表列出的字段。
- `cardState` 固定绑定 `widget.enabled` 和 `widget.available`；`labels.active/inactive/disabled` 各为 1–8 字符。

## 数据源

| 权限             | 数据源                                                         | 返回值与限制                                                                       |
| ---------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `clock`          | `clock.time`、`clock.date`、`clock.timezone`                   | 毫秒时间戳、毫秒时间戳、系统时区名                                                 |
| `system-load`    | `system.cpu`、`system.memory`                                  | CPU 区间占用率、系统已用内存比例，均为 0–1；CPU 首次采样为空，采样间隔至少 1 秒    |
| `media-control`  | `media.title`、`media.artist`、`media.playing`、`media.player` | 曲名、作者、播放状态、播放器名；需要现有媒体组件开启                               |
| `input-activity` | `input.keys`、`input.mouse`、`input.direction`                 | 当前选定按键、鼠标按键和方向；只有用户已开启输入显示时可用，不会因导入包而开启监听 |

每次 Main 读取都会检查组件权限。输入状态仅在内存中短暂保存，关闭监听时清除，不保存输入历史。媒体查询保留五秒缓存，不随时钟刷新反复启动系统查询。`network` 与 `global-shortcut` 不是本轮声明式包可用权限，天气组件暂不支持。

## 行类型与格式

| kind    | 字段                            | 行为                                                     |
| ------- | ------------------------------- | -------------------------------------------------------- |
| `value` | `source`、`format`              | 主数值                                                   |
| `label` | 可选 `source`、`format`、`text` | 说明文字；提供 `text` 时优先显示静态文字，长度不超过 120 |
| `bar`   | `source`、`min`、`max`          | 进度条；有限数值且 min 小于 max，结果限制为 0–1          |
| `icons` | `source`                        | 仅支持 `input.keys` 或 `input.mouse` 的文本图标列表      |

格式只能为 `HH:mm`、`HH:mm:ss`、`M月d日 EEE`、`percent`、`bytes`、`raw`。不支持模板、表达式或自定义格式串。缺失、非有限或类型不符的值显示 `—`。时间按用户系统本地时区显示。所有文案以纯文本渲染。

可选 SVG 当前只做安全校验，卡片仍显示 `iconText`；语言文件当前只做字段校验，尚不进行语言切换。语言文件仅允许 title、description、iconText、active、inactive、disabled，分别遵守对应长度限制。不要依赖这些可选资源改变当前显示。

## 作者自查

1. 不放入 JS、WASM、DLL、EXE、Python、Shell 等可执行文件；改扩展名也会被拒绝。
2. 不使用绝对路径、反斜杠、`..`、重复文件名或符号链接。
3. 使用有效的 widget 能力清单。
4. 包名必须与 ID 一致，ID 不得与已注册组件重复。
5. 每个数据源必须声明对应权限，不得声明尚未实现的权限。
6. 不超过六行，不使用 HTML、未知行类型或格式表达式。
7. SVG 只接受静态几何图形，不含脚本、事件属性、外部引用、CSS、实体或 foreignObject。
8. 所有文案遵守长度限制。

验证失败会带规则编号和文件名，整包拒绝。不会删除危险内容后假装安装成功。

## 开发验证与投稿

当前开发版已提供时钟示例的固定安装入口：打开“小组件”，点击“安装时钟”。安装后默认关闭，需在卡片中启用。该入口只支持应用已批准的时钟版本，不接收任意下载地址。

先执行 `pnpm build:electron`，再执行 `node scripts/measure-widget-package.mjs`，可由示例生成 ZIP 和测量记录，写入本地忽略目录 `.release/v1.9-widgets/`。检查已有包使用 `node scripts/measure-widget-package.mjs <id> <zip路径>`。测量脚本不会修改生产信任表。

流程为：第三方作者编写并提交 → 项目维护者审阅 → 测量最终字节 → 维护者更新应用内置校验记录 → 经发布授权分发。作者不能绕过应用审核自行给用户安装或更新包；远程清单仅提供 id、version、urls，不提供哈希或目标路径。

生产信任表独立于语音资源，包含固定版本、目标目录、SHA256、压缩体积、解压体积和文件数。完整归档先通过哈希检查，再运行全部内容规则，然后原子安装。当前不提供任意 ZIP 导入、客户端插件管理或自动发现第三方目录。
