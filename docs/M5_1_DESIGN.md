# M5.1 联网角色卡设计

## 目标

M5.1 为非默认角色建立可检查、可编辑、可追溯的结构化角色卡。它既能使用联网搜索发现冷门角色资料，也始终保留本地手动填写路径。

“Mon3tr + 明日方舟”是本版本的代表性验收样例：只查询通用百科不算完成，系统需要找到作品社区资料，或清楚引导用户添加对应资料源。

## 产品原则

1. **先确认身份，再生成资料。** 搜索候选与角色卡草稿分开，避免把同名人物或论文误当成角色。
2. **搜索不会自动保存。** 任何联网内容都先显示来源和草稿，用户确认后才写入本地。
3. **联网是可选能力。** 手动角色卡永远可用；不支持联网的 Ollama 或兼容接口不会被排除。
4. **角色设定不是用户记忆。** 角色卡与 M5 长期记忆分别存储、分别管理。
5. **不声称查过没有查过的范围。** UI 显示实际使用的搜索方式、资料源和失败项。

## 交互流程

### 1. 输入角色

设置页把以下两个字段放在一起：

- 角色名称，例如 `Mon3tr`；
- 来源作品或游戏，例如 `明日方舟`。

当名称不是默认“桌宠”时，输入停止或离开输入框后只显示一次轻提示：

> 要联网查找这个角色的资料吗？填写作品名会更准确。

用户点击“联网查找”后才发起请求。旁边保留“只手动填写”。应用不在输入期间静默请求。

### 2. 展示候选

候选卡最多显示 3 项；名称与作品均完全匹配时只显示最佳结果。每项包含：

- 正式名称与别名；
- 所属作品；
- 一句身份摘要；
- 命中的站点和原始链接；
- “为什么可能是这个角色”；
- 资料的新旧时间（能够取得时）。

候选必须区分同名结果。例如搜索 `Mon3tr` 时，明日方舟角色应排在同名论文之前，因为用户提供了“明日方舟”。

### 3. 生成可编辑草稿

用户选中候选后，系统只读取少量相关页面，生成以下字段：

- 正式名称；
- 别名；
- 来源作品或游戏；
- 身份；
- 性格；
- 背景资料；
- 重要关系；
- 称呼与说话方式；
- 参考来源。

每个自动生成字段保留来源编号和置信度。资料没有明确描述性格或说话方式时留空，不根据角色外观或少量台词强行猜测。

### 4. 用户确认

草稿可以逐字段编辑。只有点击“保存角色卡”后才覆盖本地资料；取消搜索不会改变现有角色卡。保存后，稳定核心在对话中持续使用，长背景与关系仍只在相关问题中加入。

## 搜索架构

搜索拆成四层，避免把某几个网站等同于整个互联网。

### A. 查询规划

统一生成多语言查询：

- `角色名 + 作品名 + 角色/character/operator`；
- 已知别名与中英文作品名；
- 对社区 Wiki 提高权重的查询。

结果排序首先看名称匹配，其次看作品匹配，再看资料源质量。作品名匹配的权重必须足以压过无关同名结果。

### B. 广泛网页发现

通过现有模型提供商的**可选能力**搜索公开网页：

- Anthropic 使用其 Messages API 的 server-side web search；
- OpenAI 官方接口使用 Responses API 的 `web_search`；
- OpenAI Compatible 与 Ollama 默认标记为“不保证支持”，不能把兼容的聊天接口误判为支持网页搜索。

提供商能力由适配器声明，不根据模型名称猜测。首次使用前提示：搜索词会发送给当前提供商，且网页搜索可能产生额外费用。自动测试只使用 fake HTTP，不调用真实提供商或真实 Key。

### C. 可扩展资料源

资料源注册表负责稳定搜索与读取站点：

```ts
interface CharacterSourceDefinition {
  id: string;
  label: string;
  kind: 'mediawiki' | 'single-page';
  origin: string;
  apiPath?: string;
  workHints: string[];
  enabled: boolean;
  builtIn: boolean;
}
```

内置首批来源：

- Wikimedia（候选补充，不再作为唯一入口）；
- 萌娘百科（仅使用站点实际允许的读取方式）；
- Arknights Terra Wiki，作品提示为 `明日方舟`、`Arknights`，确保 Mon3tr 验收样例有稳定来源。

用户可以添加基于 MediaWiki 的社区站点，填写站点名称、HTTPS 地址、API 路径和对应作品关键词。也可以添加一条明确的角色资料页作为本次补充来源。自定义来源默认只属于本地用户，不随角色卡分享。

后续新增游戏 Wiki 只需注册资料源，不修改搜索核心或 Renderer。

### D. 内容提取

Main 进程读取有限数量的页面并转换为纯文本；模型只接收受长度限制的相关片段，并按严格 JSON Schema 生成草稿。原始 HTML 不进入 Renderer，也不使用 `innerHTML`。

只保存简短事实摘要、字段来源和链接，不保存整篇百科正文。未知许可证的站点不得复制长段内容。

## 数据模型

```ts
interface CharacterLoreSource {
  id: string;
  title: string;
  url: string;
  siteName: string;
  retrievedAt: number;
}

interface CharacterLoreField<T> {
  value: T;
  sourceIds: string[];
  confidence: 'high' | 'medium' | 'low' | 'manual';
}

interface CharacterLoreDraft {
  canonicalName: CharacterLoreField<string>;
  aliases: CharacterLoreField<string[]>;
  sourceWork: CharacterLoreField<string>;
  identity: CharacterLoreField<string>;
  personality: CharacterLoreField<string>;
  background: CharacterLoreField<string>;
  relationships: CharacterLoreField<string[]>;
  speechStyle: CharacterLoreField<string>;
  sources: CharacterLoreSource[];
}
```

编辑中的 `CharacterLoreDraft` 与最终保存的角色卡分开。手工修改过的字段标记为 `manual`，后续再次搜索时默认不覆盖。

## Electron 安全边界

- 所有网络请求只在 Main 进程执行；Renderer 不获得 `fetch`、Node 或任意 URL 读取能力。
- Preload 只暴露 `searchCharacter`、`buildCharacterDraft`、`cancelCharacterSearch` 和资料源管理的窄接口。
- 每个 IPC 参数都做类型、长度、数量和 sender 校验；同时只允许一个搜索任务，可取消并设总超时。
- 内置来源使用固定允许域名。添加自定义域名时由 Main 弹出原生确认框，明确显示主机名。
- 自定义来源只允许 HTTPS、默认端口、无用户名密码；拒绝 localhost、IP 字面量和解析到私有、回环、链路本地或保留地址的主机。
- 每次重定向重新校验目标；限制响应类型、页面数、单页大小、总字节数和跳转次数。
- 搜索结果只以纯数据传入 Renderer，链接通过受控的外部浏览器打开。

## 隐私与费用

角色名、作品名和搜索提示可能被发送给当前模型提供商或资料站点。首次联网前必须展示该事实，并分别记住“允许直接资料源查询”和“允许付费模型网页搜索”的选择。

两种联网方式分开开关：

- `查询公开资料站点`：通常不产生模型网页搜索费用；
- `使用模型的广泛网页搜索`：可能产生提供商工具费用和 token 费用。

任何失败都不能影响普通聊天与手动角色卡。

## Mon3tr 验收路径

输入：

- 角色名称：`Mon3tr`；
- 来源作品：`明日方舟`。

预期：

1. 查询排序优先采用同时匹配 `Mon3tr` 与 `明日方舟/Arknights` 的结果；
2. 候选至少包含 Arknights Terra Wiki 的 Mon3tr 页面，而不是只显示同名论文；
3. 选择后可生成带来源的身份、背景与关系草稿；
4. 无明确证据的性格或称呼字段保持为空；
5. 用户修改并确认后才保存；
6. 在关闭广泛网页搜索时，内置明日方舟资料源仍可完成该路径。

## 测试与验收

- 查询规划、名称/作品相关性排序、别名去重；
- 多来源成功、部分失败、超时、取消和缓存；
- 同名无关结果不能压过作品匹配；
- 自定义来源与所有 URL/重定向安全校验；
- HTML、脚本、超大响应和错误内容类型不会进入 Renderer；
- 草稿字段来源、手动字段保护和确认后保存；
- M4/M5 角色配置兼容；
- Anthropic、OpenAI 官方、OpenAI Compatible、Ollama 的能力降级；
- Windows CI、生产构建、Electron Preload 冒烟；
- 单元测试和集成测试只用 mock/fake、本地 HTTP。

## M5.1 非目标

- 后台静默搜索并自动覆盖角色卡；
- 定期爬取或镜像百科站；
- 自动下载角色图片、Live2D 模型或音频；
- 多角色切换与角色卡市场；
- 把搜索网页当作长期记忆；
- 跨入后续 Agent 里程碑。

## 实施顺序

1. 保留并完善手动结构化角色卡；
2. 建立草稿、来源与搜索任务协议；
3. 实现资料源注册表和 Arknights Terra Wiki 验收适配器；
4. 增加候选、字段来源和确认 UI；
5. 增加 Anthropic 与 OpenAI 官方网页搜索能力，其他兼容接口安全降级；
6. 完成安全、测试、文档与 Windows CI 验证。
