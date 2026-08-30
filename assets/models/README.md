# 本地 Live2D 兼容模型

M2 使用 Cubism 5 runtime 加载 Cubism 3、4、5 的 `.model3.json` 模型。`main` 的完整公开示例是凯尔希：角色资料负责“她是谁”，本目录负责“画面怎么动”，两者使用相同角色归属但继续分开存放。这里不保存 Live2D Cubism Core 或 Live2D 官方示例；已取得单独授权的第三方模型会明确标注作者、来源和使用边界。

## 放置步骤

1. 阅读并接受 [Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)、[Sample Data Terms](https://www.live2d.com/eula/live2d-sample-model-terms_en.html) 和模型下载页的单独条件。
2. 从 [Live2D Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/) 下载当前 Cubism 5 SDK，将 `Core/live2dcubismcore.min.js` 复制到 `assets/models/local/`。
3. 要直接使用仓库所带的“工作凯尔希”示例，将 `kaltsit-work.example.json` 复制为 `assets/models/local/model.json`；也可以从 [Live2D Sample Data Collection](https://www.live2d.com/en/learn/sample/) 自行下载 Simple model 或 Hiyori 做兼容性验证。
4. 使用其他模型时，将本目录的 `model.example.json` 复制为 `assets/models/local/model.json`，按模型实际的文件名、Motion Group 和 Expression Id 修改映射。
5. 运行 `pnpm dev`。如果模型或 Core 缺失，桌宠窗口会显示错误和“重新加载”按钮；补齐文件后无需重启即可重试。

普通用户也可以在“角色与显示方式 → 纯 Live2D”中点击“导入 Live2D 模型”，直接选择模型目录里的 `.model3.json`。程序会复制该文件实际引用的纹理、动作、表情、物理和音频资源，并把它设为当前角色的显示模型；未引用文件、脚本、远程资源和越过模型目录的路径不会导入。直接导入不会猜测动作、情绪或口型映射，需要这些能力时仍应使用完整的 FPNF 角色包或经过检查的 `model.json`。

`assets/models/local/` 中只有获准收录的 `kaltsit-work/` 示例会进入 Git；用户自己的模型、`model.json` 和 Cubism Core 仍保持忽略。不要在其中保存 API Key、密钥或其他隐私数据。

## 当前本机参考模型

仓库收录的凯尔希 Live2D 参考模型来自 [什行在要发布的“工作凯尔希”模型](https://www.bilibili.com/video/BV1Le411976u/)，作者主页为 [什行在要](https://space.bilibili.com/2695839)。项目维护者已确认取得作者许可，可以在本项目中收录和分发，但只能用于非盈利用途。完整边界见模型目录内的 `ATTRIBUTION.md`。

这套外观和主线默认资料卡都属于凯尔希，共同构成 Live2D Version 的完整参考例子。以后增加其他角色时，仍需使用各自的模型、资料与记忆命名空间，不能只改显示名称。

## 兼容说明

- Cubism 3/4 模型：由 Cubism 5 Core 的向后兼容能力加载。
- Cubism 5 模型：使用当前 Cubism 5 SDK/Core；模型若使用较新的 Editor 特性，必须配套能够读取该 `.moc3` 版本的 Core。
- 本项目不支持旧式 Cubism 2 `.model.json` / `.moc`。
- 模型应完整保留 `model3.json` 引用的纹理、物理、Pose、Motion 和 Expression 文件相对结构。

眨眼和呼吸由模型 `Groups`/参数与 runtime 自动驱动。循环待机 Motion 不会阻止自动眨眼。`states`、`actions`、`emotions` 只填写模型真实存在的映射；缺失动作会安全返回失败，缺失情绪会回退到 `neutral`。

如果模型没有 Expression，但有能表达情绪的一次性 Motion，可以增加 `emotionActions`，把标准情绪映射到 `actions` 中已经声明的动作名。显式回复动作优先；没有显式动作时才使用情绪动作。凯尔希示例会把 `angry` 映射到 `annoyed`、`sad` 映射到 `sigh`。映射到不存在的动作会拒绝加载，文字聊天仍可安全回退。

V1.6 的音频口型必须由模型清单显式声明，未声明时只播放声音，不猜测或写入任意模型参数：

```json
"lipSync": {
  "mouthOpenParameter": "ParamMouthOpenY",
  "gain": 1
}
```

`mouthOpenParameter` 只接受有限长度的 Cubism 参数 ID，`gain` 允许 0.1 至 3。播放结束、取消、解码失败或角色卸载时都会立即归零；不存在该参数时模型运行时会忽略口型，文字与音频仍保持可用。

部分模型使用一个参数切换身体、服装或部件。例如模型要求 `ParamshentiZ` 始终为 `1`，可在清单顶层填写：

```json
"parameters": {
  "ParamshentiZ": 1
}
```

这些值会在每帧动画更新后重新应用，适合模型的永久配置。不要用它制作会随时间变化的动作或表情；动态效果仍应放进 Motion、Expression 或四通道控制中。

不同模型的画布留白和主体比例差异很大。可以用 `presentation` 在自动等比适配之后做角色专属微调，不必修改通用播放逻辑：

```json
"presentation": {
  "scale": 0.85,
  "offsetX": 0,
  "offsetY": 0.1
}
```

`scale` 允许 0.25 至 2；`offsetX`、`offsetY` 允许 -1 至 1，分别按窗口半宽、半高偏移。非法值会拒绝加载，避免角色缩成零、飞出窗口或留下空框。这里是模型自身的构图校正，用户在设置里调整的桌宠尺寸仍由窗口缩放控制，两层不会互相冒充。
