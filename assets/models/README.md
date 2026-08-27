# 本地 Live2D 兼容模型

M2 使用 Cubism 5 runtime 加载 Cubism 3、4、5 的 `.model3.json` 模型。`main` 的完整公开示例是凯尔希：角色资料负责“她是谁”，本目录负责“画面怎么动”，两者使用相同角色归属但继续分开存放。这里不保存 Live2D Cubism Core 或 Live2D 官方示例；已取得单独授权的第三方模型会明确标注作者、来源和使用边界。

## 放置步骤

1. 阅读并接受 [Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)、[Sample Data Terms](https://www.live2d.com/eula/live2d-sample-model-terms_en.html) 和模型下载页的单独条件。
2. 从 [Live2D Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/) 下载当前 Cubism 5 SDK，将 `Core/live2dcubismcore.min.js` 复制到 `assets/models/local/`。
3. 要直接使用仓库所带的“工作凯尔希”示例，将 `kaltsit-work.example.json` 复制为 `assets/models/local/model.json`；也可以从 [Live2D Sample Data Collection](https://www.live2d.com/en/learn/sample/) 自行下载 Simple model 或 Hiyori 做兼容性验证。
4. 使用其他模型时，将本目录的 `model.example.json` 复制为 `assets/models/local/model.json`，按模型实际的文件名、Motion Group 和 Expression Id 修改映射。
5. 运行 `pnpm dev`。如果模型或 Core 缺失，桌宠窗口会显示错误和“重新加载”按钮；补齐文件后无需重启即可重试。

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

部分模型使用一个参数切换身体、服装或部件。例如模型要求 `ParamshentiZ` 始终为 `1`，可在清单顶层填写：

```json
"parameters": {
  "ParamshentiZ": 1
}
```

这些值会在每帧动画更新后重新应用，适合模型的永久配置。不要用它制作会随时间变化的动作或表情；动态效果仍应放进 Motion、Expression 或四通道控制中。
