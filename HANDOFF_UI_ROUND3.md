# FPNF 交接报告 —— UI 重做轮次（Claude → GPT/Codex）

> 接手后的修复及验收状态见 [UI Round 3 验证记录](docs/UI_ROUND3_VERIFICATION.md)。用户已另行授权发布 v1.8.1，交付信息见 [V1.8.1 交付记录](docs/V1_8_1_DELIVERY.md)。以下保留原始任务书，已完成项及发布授权以新记录为准。

日期：2026-09-05
仓库：`C:\ai_deskpet`
本轮改动文件：`src/renderer/styles.css`、`tests/style-tokens.test.ts`、`scripts/verify-style-tokens.mjs`
本轮**没有**改动任何 `src/main/**`、任何 IPC、任何 preload、任何构建配置。

---

## 零、给你的第一句话

本轮全部是渲染层样式改动，已经提交到工作区但**没有提交 git、没有打包、没有发布**。
你接手要做的第一件事是 **§1 的真机验收**，不是继续改。验收没过就先修，别往下推进 §2。

下面每条任务的格式统一为：**位置 → 现状 → 改法 → 验收 → 不要做**。

---

## 一、本轮已完成的改动（不要重做，不要回退）

### 1.1 设计 token 提取（视觉零变化）

`src/renderer/styles.css:13-95` 新增 `:root` token 块，60 个 token。

原样式表用 229 种颜色写法表达约 190 种意图——同一个面板底色曾经有 11 种写法。
现在同组内的写法在 CIE Lab 下 ΔE < 1.0（人眼不可察觉），合并为一个 token。

注意 `styles.css` 里现在有**两个** `:root` 块：第 13 行是 token 块，第 97 行是原有的
`color-scheme` / `font-family` 基础规则。这是我 prepend 造成的，功能上没问题
（见 §5 T7，可选合并）。

### 1.2 紫色降彩度（本轮唯一的主动视觉改动）

规则：**只改色相在 285°–320° 之间的紫色**，统一到 OKLCH 299.5°。
红（语义：危险）、琥珀（警告）、绿（成功）、蓝（信息）、中性灰——全部原样未动。

**感知明度与不透明度一律不动**（OKLCH 下 ΔL < 0.002），所以对比度、可读性、
蒙层厚度和改前完全一致。

降幅按**出现面积**分档，这是本轮的核心判断——问题不在色相，在紫色出现的面积：

| 类别                      | 判据                                  | 彩度         |
| ------------------------- | ------------------------------------- | ------------ |
| 铺在面板/描边上的半透明紫 | 不透明度 < 60%                        | × 0.40       |
| 紫色文字                  | `color` 属性、`--accent-text-*`       | × 0.70       |
| 实心紫                    | 不透明度 ≥ 60% 的背景、`accent-color` | **原样保留** |

实心紫保留的具体位置（**改动时别动它们，它们是产品识别色**）：

- `styles.css:1142` `.chat-composer__send / __microphone / __stop / __stop-speech / .primary-button / .secondary-button` 的 `linear-gradient(145deg, #8261c8, #6543ad)`
- `.chat-toolbar__mode-button.is-selected` 的 `linear-gradient(145deg, rgb(152 110 232 / 96%), rgb(103 70 174 / 96%))`
- `.input-overlay__key.is-active` 等激活态的 `rgb(139 84 219 / 88%)`
- `select option:checked` 的 `#7658a5`
- `--accent-control-1 / -2`（`accent-color`，复选框与滑块）

实测：298 处颜色，肉眼可辨（ΔE ≥ 1）115 处，中位 0，最大 23.48。

### 1.3 蓝色语义色改名

原先 4 个蓝色被我上一轮误分进中性组，本轮改名并独立分组（`styles.css:85-89`）：

| 旧名                 | 新名             |
| -------------------- | ---------------- |
| `--fill-10`          | `--info-fill`    |
| `--line-6`           | `--info-line`    |
| `--text-11`          | `--info-text`    |
| `--accent-control-3` | `--info-control` |

连带把 `--fill-11 / --fill-12` 顺次改成 `--fill-10 / --fill-11`。
**全项目只有 `styles.css` 引用这些名字**，已核对过，无遗漏。

### 1.4 修掉两个既存 bug（不是本轮引入的）

**（a）`--text-muted` 从未定义** —— `styles.css:862` 的 `.speech-asset-progress-strip`
引用 `var(--text-muted)`，但全项目**没有任何地方定义过它**（既不在 CSS 里，也不由
运行时 `setProperty` 设置）。那条 `color` 声明一直是无效值，进度条文字实际继承了
面板的近白色——和"弱化"的本意正好相反。

已在 `styles.css:48` 补上定义：`--text-muted: rgb(229 227 233 / 62%)`。
**这是一处真实的视觉变化**，验收时留意那条进度条的文字确实变暗了。

**（b）按钮基类名单不一致** —— `styles.css:1142` 的基础规则原本只覆盖
`.chat-composer__send / __microphone / __stop / .primary-button / .secondary-button`，
而 `styles.css:1161` 的胶囊形状规则多覆盖了一个 `.chat-composer__stop-speech`。
结果「停声」有形状、没有底子：实测 `border: 2px outset rgb(255,255,255)`
（浏览器默认边框），旁边三颗是 `1px solid rgb(216 210 231 / 35%)`；字重 400 对 650，
高 28px 对 26px。

同时基础规则**从未设过 `font-size`**，而 `styles.css:574` 有
`button, input, textarea, select { font: inherit }`，从 `html` 到 `body` 到 `#app`
到 `.chat-panel` 整条链上也没有任何一层设过 `font-size`——于是
`.primary-button` / `.secondary-button` 一路继承到浏览器默认的 **16px**，
实测高 37px，而同一排的 `.text-button` 是 11px / 29px。

改法：把 `.chat-composer__stop-speech` 加进基础规则名单，并补 `font-size: 11px`。
改后实测：停声与三个邻居逐项一致（26px / 1px solid / 650）；
primary/secondary 37px → 31px（旁边 `.text-button` 29px，剩下 2px 是 `padding: 7px`
对 `6px`，主操作重一点是有意保留的）。

### 1.5 无框布局（本轮的主要布局改动）

**关键机制**：`styles.css:137` 的 `#app.chat-expanded::before` **不是一块背板，
而是一个"洞"**——`box-shadow: 0 0 0 9999px var(--fill-1)` 把洞**以外**全部涂上
不透明色，洞里透出桌面。所以洞开到哪，桌面就露到哪。

原先 `styles.css:168` 的 live2d 覆盖规则把洞收成**紧贴角色轮廓**的矩形
（`left/top/width/height` 全部来自 `--visible-frame-*`），等于给角色描了一圈框。

现在改成整个角色侧都是洞——上下左三条边直接到窗口边缘，只在靠聊天面板那一侧收口：

```css
/* styles.css:168 */
#app.chat-expanded[data-character-display-mode='live2d']:not(.character-is-loading)::before {
  top: 0;
  right: calc(50% + 8px);
  bottom: 0;
  left: 0;
  width: auto;
  height: auto;
  border-radius: 0 14px 14px 0; /* 只有右边那条是朝向界面内部的边 */
}
```

`styles.css:180` 的 `[data-character-pane='right']` 分支整个镜像。

**副作用（重要）**：这条规则现在**不再依赖 `--visible-frame-*`**。那四个自定义属性
由 `src/renderer/live2d/pixi-driver.ts:262-265` 设置，目前只剩
`styles.css:244` `.desktop-overlay-stack` 的 `top: clamp(...)` 在用（且只在
非 widgets-active 状态下生效）。**先别删它们**，静态图模式和加载中状态的行为还没验收。

### 1.6 小组件不带背板，作为角色脚下的一条边

`styles.css:261` `.desktop-widgets-active .desktop-overlay-stack`：

- `background: var(--fill-1)`（不透明横带）→ `background: transparent`。
  小组件自己带 `--fill-5` 底色、描边和 `backdrop-filter: blur(10px)`，
  直接浮在桌面上排成一条边。
- `pointer-events: auto` → `pointer-events: none`。
  这条容器横向铺满整宽（`width: calc(100% - 16px)`），而小组件通常只占左边一小块，
  余下那片"看不见但点不穿"的区域**原先一直挡着桌面**。现在改成由各个小组件自己
  决定：`.media-overlay` 是 `auto`（可交互），`.input-overlay` 是 `none`（纯显示）。

`styles.css:234` `.desktop-widgets-active .character-host` 的
`height: calc(100% - var(--desktop-widget-reserve, 0px))` **保留**。
小组件是角色脚下的边，不是盖在它身上的一层——角色整体缩小一点站在上面，
不被叠住。`--desktop-widget-reserve` 由 `chat-controller.ts:159` 的
`ResizeObserver` 按小组件实测高度设置，`widgets/widget-layout.ts` 里封顶 45% 视口高。

**点击穿透（"命门"）验证方式与结果**：改前改后各渲染一次，用 `elementFromPoint`
在 638 点网格上逐点比对命中元素。结果 36 点变化，**方向全部一致**
（`.desktop-overlay-stack` → `#app` / `.character-host`），
**没有任何一点新增拦截**。`.chat-shell` 仍是 `pointer-events: none`，
各控件仍是 `auto`，未改动。

### 1.7 测试与工具

**`tests/style-tokens.test.ts`**

- 补全 `RUNTIME_VARIABLES`：原先漏了 `--visible-frame-left` / `--visible-frame-width`
  （由 `pixi-driver.ts:262,264` 设置）。**这个测试在你接手前是红的**——
  我上一轮提交后没跑过它。
- 新增断言「所有紫色共用一个色相」：扫描全表，sRGB HSL 饱和度 > 0.1 且色相在
  240°–330° 的颜色，必须落在 245°–270° 之间。以后再粘一个色相不同的紫会在这里被拦下。

**`scripts/verify-style-tokens.mjs`** 新增 `--max <ΔE>` 参数。

不加参数仍然卡死在 ΔE 1.0（用于第 1.1 步那种"应当零变化"的改动）。
加了 `--max` 是**声明预算**，不是关掉检查：每一处照样量，任何一处超预算就失败，
并额外打印「肉眼可辨多少处 / 中位 / 前 10%」的分布。

```bash
# 验证一次改动没有改变任何渲染色
git show HEAD:src/renderer/styles.css > /tmp/before.css
node scripts/verify-style-tokens.mjs /tmp/before.css src/renderer/styles.css

# 验证一次"有意的"配色改动没有超出预算
node scripts/verify-style-tokens.mjs /tmp/before.css src/renderer/styles.css --max 25
```

---

## 二、T1（最高优先）真机验收本轮改动

**位置**：整个渲染层。

**现状**：以上全部改动**只在无头 Chromium 里用假角色摆位验证过**。
真实 Live2D 画布的缩放、居中、`--visible-frame-*` 的实际取值、真实壁纸下的观感，
一次都没在真机上跑过。

**改法**：不改代码，跑验收。

```bash
pnpm verify        # vitest + prettier + eslint + tsc，我这边跑不了，格式是手工对齐的
pnpm dev
```

**验收标准**——四个分支逐个看，每个都要截图：

1. **live2d + 角色在左**：角色上方和左边应当直接是桌面，没有任何深色边框；
   角色头顶不被切；聊天面板一侧的深色区域右边缘有圆角、有投影。
2. **live2d + 角色在右**（`data-character-pane='right'`）：完全镜像。
   **这个分支我完全没验证过，最可能出问题。**
3. **静态图模式**（`data-character-display-mode` 不是 `live2d`）：
   走的是 `styles.css:137` 的基础规则，我没动它——所以它仍然是 10px 内缩的圆角框。
   **它现在和 live2d 模式看起来会不一样。** 这是已知的不一致，见 T2。
4. **`settings-expanded`**：`styles.css:188` 有 `#app.settings-expanded::before { display: none }`，
   整个洞消失。确认设置面板展开时布局正常。

另外三点单独确认：

- **点击穿透**：在角色上方的透明区域点击，应当穿到桌面（点到桌面图标）。
  在「正在播放」小组件上点击，应当被小组件接住。在「键盘显示」上点击，应当穿过去。
- **小组件开关**：打开/关闭桌面小组件，角色应当整体缩放，不应当被切掉下半身。
- **进度条文字**：触发语音资产下载，`.speech-asset-progress-strip` 的文字应当是
  灰白色（62% 白），不是近白色。这是 §1.4(a) 的效果。

**不要做**：验收发现问题请**先报给我或先记录**，不要顺手推翻 §1.5 的洞机制去改回
"紧贴角色的框"——那是用户明确否掉的方向。

---

## 三、T2 静态图模式与 live2d 模式的边框不一致

**位置**：`styles.css:137`（基础规则）对 `styles.css:168`（live2d 覆盖）。

**现状**：

```css
/* styles.css:137 —— 静态图模式走这条 */
#app.chat-expanded::before {
  top: 10px;
  right: calc(50% + 8px);
  bottom: 10px;
  left: 10px;
  border-radius: 14px;
  box-shadow:
    0 0 0 9999px var(--fill-1),
    0 7px 20px var(--shadow-2);
}
```

静态图模式下角色仍然被一个 10px 内缩的圆角框框住，而 live2d 模式已经无框。
同一个应用两种气质。

**改法**：这是**设计决策，不要自己定**。两条路：

- （A）把基础规则也改成 `top/bottom/left: 0` + `border-radius: 0 14px 14px 0`，
  两种模式统一无框。代价：静态图模式下窗口左上没有任何视觉边界。
- （B）保留静态图模式的框，接受两种模式不同。

**验收**：无论选哪条，`settings-expanded` 和 `character-is-loading` 两个状态都要
一起看，别只看主状态。

**不要做**：不要在没问过用户的情况下选 A。

---

## 四、T3 未知计费网络下的启动 → 暂停死循环

**这是本轮核对时新发现的真 bug，优先级仅次于 T1。**

**位置**：`src/main/speech/speech-asset-manager.ts:380` 与 `:277`。

**现状**：

```ts
// :380  runInstall 里
if (this.metered === true) this.meteredConsent.add(tier.id);
else this.meteredConsent.delete(tier.id);
```

```ts
// :277  checkActiveNetworkCost 里，每 10 秒一次
// An explicit start while already metered is consent for that connection.
if (this.metered === true && this.meteredConsent.has(id)) continue;
this.installer.pause(id);
```

`detectWindowsMeteredConnection()` 失败时 `this.metered` 是 `undefined`
（`:236` 的 `.catch(() => undefined)`），代表"无法确认网络是否计费"。

这种情况下：用户看到「无法确认…可手动下载」，手动点开始 → `runInstall` 因为
`metered !== true` 走 `else` 分支，**把 consent 删掉** → 10 秒后轮询触发，
`metered !== false` 且 `consent.has(id)` 为假 → **暂停** → 用户再点继续 →
再次删 consent → 再次暂停。**用户永远下不完。**

`metered === true`（确认计费）时没有这个问题，因为 `:380` 会记下 consent。
问题只出在 `undefined` 这一支。

**改法**：把"显式启动"当作对**当前这次网络状况**的同意，而不只是对"确认计费"的同意。
最小改动是 `:380` 改成：

```ts
// 用户在非「确认不计费」的情况下手动启动，就是对当前网络的同意。
if (this.metered !== false) this.meteredConsent.add(tier.id);
else this.meteredConsent.delete(tier.id);
```

并把 `:277` 的判断相应放宽为 `if (this.metered !== false && this.meteredConsent.has(id)) continue;`。

**验收**：`tests/` 下新增一个测试，注入 `detectMetered: async () => undefined`：

1. 手动 start 一个档位 → 推进假定时器超过 10 秒 → 断言该档位**仍在 active 中**，
   状态不是 paused。
2. 再注入 `detectMetered` 从 `undefined` 变成 `true`：断言行为不变（仍然继续），
   因为用户已经在未知状态下同意过了。
3. 回归：`detectMetered` 从 `false` 变成 `true`（下到一半切到热点）→
   断言**必须暂停**并给出提示。这条是原有行为，不能被上面的放宽破坏。

**不要做**：

- 不要改成"未知就当作不计费直接下"——那会在真的用手机热点时偷跑几百 MB。
- 不要动 `refreshNetworkCost()` 的 coalescing 逻辑（`:234-245`），它是对的。
- 不要真的去测系统网络状态，用 `options.detectMetered` 注入。

**顺带更正**：我上一轮口头说过"`metered` 只在 `scheduleInitialDownload` 里检测一次，
切热点后手动下载不会重新检查"——**这句话是错的**，请忽略。
`:175` 手动启动路径会 `await this.refreshNetworkCost()`，
`:383` 的 `setInterval` 每 10 秒重查一次并在切换到计费网络时暂停。
机制是完整的，问题只在上面那个 consent 分支。

---

## 五、剩余任务（优先级递减）

### T4 `.danger-button` 靠调用点约定才不裸奔

**位置**：`styles.css:2443`。

**现状**：

```css
.danger-button {
  color: #ffd7df;
  border-color: rgb(255 151 172 / 30%);
}
```

只有 `color` 和 `border-color`，连 `border-style` 都没有。它能正常显示**完全靠**
每个调用点都记得同时写 `text-button`：

- `chat/settings-character.ts:92,182,654`
- `chat/memory-panel.ts:80,263,456`

任何一处漏写 `text-button`，那颗按钮就退化成浏览器默认按钮（方角、灰底、无内边距）。

**改法**（二选一，我倾向 B）：

- （A）给 `.danger-button` 补齐 `.text-button` 的全部基础声明。缺点：重复，两处会漂移。
- （B）把选择器改成 `.text-button.danger-button`，并在 `createButton` 的类型层面
  约束——或者更简单，在 `tests/` 加一条断言：源码里出现 `danger-button` 的地方
  必须同时出现 `text-button`。

**验收**：故意在某个调用点删掉 `text-button`，测试必须红。

### T5 小组件列表滚轮

**位置**：`styles.css:261`（容器）与 `styles.css:306`（`.input-overlay`）。

**现状**：容器 `pointer-events: none`、`overflow-y: auto`、`max-height: 45%`。
滚轮悬在 `.media-overlay`（`auto`）上能滚，悬在 `.input-overlay`（`none`）上滚不动。

**改法**：先确认这是不是真问题——`widget-layout.ts` 的 `MAX_WIDGET_VIEWPORT_RATIO = 0.45`
和 CSS 的 `max-height: 45%` 是同一个上限，只有小组件总高超过 45% 视口时才会出现滚动条。
**如果实际小组件数量根本达不到，这条直接关掉不做。**

**不要做**：不要为了修滚轮把容器改回 `pointer-events: auto`——那会把 §1.6 修掉的
隐形点击拦截整个带回来，得不偿失。

### T6 两个 `:root` 块合并（洁癖，可选）

**位置**：`styles.css:13` 与 `styles.css:97`。

前者是 token 块，后者是 `color-scheme` / `font-family`。合并成一个即可。
`tests/style-tokens.test.ts` 的 `tokenBlock()` 用
`/:root\s*\{([\s\S]*?)\n\}/` 只取第一个块，合并后仍然正确。

### T7 上一轮（ROUND2）遗留，未动

见 `IMPROVEMENT_TASKS_ROUND2.md`：R1 本地打包验收（含移除 `dxcompiler.dll` 后的
无 GPU Live2D 检查）、R4 故障注入、R5 剩余面板抽取、R6 Genie-TTS 试听验收、R7 托管决策。

---

## 六、全局约束（本轮沿用，逐条有效）

- **G1** 不得改动任何 ONNX 模型权重。量化已因音质原因排除。
- **G2** 保持 zip 免安装分发，不引入 NSIS / MSI / 代码签名。
- **G3** 保持 Electron 信任边界：`contextIsolation: true`、`sandbox: true`、
  `nodeIntegration: false`，`setWindowOpenHandler` 拒绝，`will-navigate` /
  `will-attach-webview` 阻止。每个 IPC 都要在 Main 侧校验发送者，
  每个不可信值都要在 Main 侧二次校验。
- **G4** 不得新增远程代码执行面。语音资产的信任模型已定：
  **每档的 SHA256 硬编码在应用源码里，绝对不能远程更新；远程清单只管 URL。**
- **G5** 不得请求、读取、打印、存储或用真实的 API key / token / 密码 / 私钥 /
  个人凭据来测试。用 mock、假值、临时数据库、本地 HTTP server。
- **G6** Ireina 音色权重没有公开再分发许可——不放进 Git、安装包或公开 Release，
  不要编造下载 URL。
- **G7** 不得 commit、push、发布、改写历史、修改仓库可见性。
  **本地 `pnpm package:win` 是验证手段，不是发布，允许且在 T1 里被要求。**
- **G8** 改完必须 `pnpm verify` 通过。

---

## 七、不要碰的东西

1. `styles.css:581` `.chat-shell { pointer-events: none }` 和各控件上的
   `pointer-events: auto`——这是透明窗口点击穿透的命门。任何改动都要用
   `elementFromPoint` 网格法证明没有新增拦截。
2. §1.2 列出的那批实心紫。它们是产品识别色，本轮特意保留的。
3. `styles.css:168` 的洞机制。用户明确否掉了"给角色描边框"的方向。
4. `src/renderer/live2d/pixi-driver.ts:262-265` 设置的 `--visible-frame-*`。
   虽然 `::before` 已经不用了，但 `.desktop-overlay-stack` 还在用，
   且静态图模式没验收，**先别删**。
5. `speech-asset-manager.ts:234-245` 的 `refreshNetworkCost()` coalescing 逻辑。
6. `tests/style-tokens.test.ts` 里「正文中不得重复出现同一个颜色字面量」那条断言。
   它是防回归的核心：一个颜色值被写第二遍，说明它该成为 token 却没有。
