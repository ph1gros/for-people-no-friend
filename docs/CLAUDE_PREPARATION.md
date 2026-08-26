# Claude API 用户准备清单

> 本清单只供用户本人操作。不要把 API Key 发到聊天中、截图中、日志中或 Git 仓库中。M1 不接入 Claude，也不会读取密钥。

## 1. 创建 Anthropic Console 账号

访问 [Anthropic Console](https://console.anthropic.com/) 并创建或登录账号。Claude.ai 订阅与 Anthropic API Console 是分开的产品；Claude.ai Pro/Max 订阅本身不包含 API 用量。

官方说明：[如何访问 Anthropic API](https://support.anthropic.com/en/articles/8114521-how-can-i-access-the-anthropic-api)、[Claude.ai 订阅与 API 计费的区别](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-a-paid-claude-ai-plan-why-do-i-have-to-pay-separately-for-api-usage-on-console)。

## 2. 完成 API 计费

在 Console 的 Billing 页面填写组织和用途信息、添加付款方式并购买少量预付 usage credits。按需设置自动充值和预算提醒；不希望自动扣款时保持自动充值关闭。预付额度用尽后 API 会停止调用。

官方说明：[账号创建后的 API 准备](https://support.anthropic.com/en/articles/8114531-i-have-created-an-account-in-console-and-i-want-to-start-using-the-api-what-should-i-do)、[预付 usage credits](https://support.anthropic.com/en/articles/8977456-how-do-i-pay-for-my-api-usage)。

## 3. 创建专用 API Key

在 Console 的 API Keys 页面为 For People No Friend 创建一枚独立 Key，名称明确标注用途。只复制一次到自己的安全存储；如果怀疑泄露，立即在 Console 撤销并轮换。不要复用其他生产项目的 Key。

官方入口：[Anthropic Console API Keys](https://console.anthropic.com/settings/keys)。

## 4. 本地安全保存

- 当前 M1 不需要 Key。先把它保存在可信密码管理器或 Windows 凭据管理器中，不要提前写入项目文件。
- 后续 Claude 接入里程碑将通过应用设置页录入，并由 Main Process 使用 Electron `safeStorage` 加密；Renderer 不会获得完整 Key。
- 仅在人工开发连接测试确实需要时，才使用本机环境变量 `ANTHROPIC_API_KEY` 或仓库已忽略的 `.env`。不要在命令行参数、源代码、测试夹具、日志或 CI 配置中写明文 Key。
- CI 如未来需要人工 API 测试，应使用 GitHub Actions Secret；常规 CI 继续使用 Mock Provider，不调用付费 API。

创建完成后只需告知“Claude 账号、计费和 Key 已准备好”，不要发送 Key 本身。
