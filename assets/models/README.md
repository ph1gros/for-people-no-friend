# 本地 Live2D 兼容模型

M2 使用 Cubism 5 runtime 加载 Cubism 3、4、5 的 `.model3.json` 模型。`main` 自带 M3 的公开资料卡，但不会把任意本地模型自动认作 M3：角色资料负责“她是谁”，本目录只负责“画面怎么动”。这里也不保存 Live2D Cubism Core、官方示例或第三方模型本体。

## 放置步骤

1. 阅读并接受 [Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)、[Sample Data Terms](https://www.live2d.com/eula/live2d-sample-model-terms_en.html) 和模型下载页的单独条件。
2. 从 [Live2D Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/) 下载当前 Cubism 5 SDK，将 `Core/live2dcubismcore.min.js` 复制到 `assets/models/local/`。
3. 如需验证兼容性，可从 [Live2D Sample Data Collection](https://www.live2d.com/en/learn/sample/) 下载 Simple model 或 Hiyori，将完整模型目录复制到 `assets/models/local/`。它们是借来检查机器是否转得动的，不会自动获得正式角色编制。
4. 将本目录的 `model.example.json` 复制为 `assets/models/local/model.json`，按模型实际的文件名、Motion Group 和 Expression Id 修改映射。
5. 运行 `pnpm dev`。如果模型或 Core 缺失，桌宠窗口会显示错误和“重新加载”按钮；补齐文件后无需重启即可重试。

`assets/models/local/` 已整体加入 `.gitignore`。不要强制添加该目录，也不要在其中保存 API Key、密钥或其他隐私数据。

## 当前本机参考模型

当前开发机使用的凯尔希 Live2D 参考模型来自 [什行在要发布的“工作凯尔希”模型](https://www.bilibili.com/video/BV1Le411976u/)，作者主页为 [什行在要](https://space.bilibili.com/2695839)。原发布页允许免费下载并注明不要用于盈利，同时标有“未经作者授权，禁止转载”。因此仓库只记录作者、来源和本机放置方式，不重新分发模型文件；取得作者另行许可后，才可以调整这一边界。

这套外观是凯尔希，不会在归属信息中改名为 M3。主线默认 M3 资料卡只是角色资料示例；用户可以在本机替换为拥有合适授权的 M3 Live2D 外观。

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
