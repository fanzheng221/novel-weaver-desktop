# BYOK 模型接入

模型接入按接口协议选择，服务商品牌不限制模型 ID。配置与任务槽位保存在本机 localStorage；API Key 仅写入 macOS 系统钥匙串。原有配置不需要迁移，旧版默认协议、鉴权和参数继续生效。

## 接入方式

在「项目与设置 → 模型接入」选择模板，填写平台提供的接口地址、模型 ID 和 API Key。可先点「测试当前配置」验证尚未保存的表单，再保存并分配正文生成槽位。模型 ID 支持平台模型名、`vendor/model` 和火山方舟接入点 ID。

| 协议 | 完整端点后缀 | 默认鉴权 |
| --- | --- | --- |
| OpenAI Chat Completions | `/chat/completions` | Bearer |
| Anthropic Messages | `/messages` | x-api-key |
| OpenAI Responses | `/responses` | Bearer |

支持直接粘贴完整端点，也支持 Base URL。裸域名补 `/v1`；已填写的版本路径（例如 `/api/paas/v4`、`/compatible-mode/v1`、`/proxy/v1`）保留。Messages 的非版本前缀如 `/anthropic` 会补 `/v1/messages`；如果平台路径特殊，请填写以 `/messages` 结尾的完整地址。表单会显示最终请求地址，协议与端点不一致时拒绝提交。地址仅支持 HTTP(S)，不接受内嵌账号密码、查询参数和锚点。

内置 DeepSeek、通义千问、Kimi、智谱 GLM、火山方舟 / 豆包、硅基流动、OpenAI、Anthropic、Ollama 和自定义中转站模板。模板不代表账户已开通相应模型；模型 ID、地域地址和套餐地址以平台控制台为准。参考：[DeepSeek](https://api-docs.deepseek.com/)、[百炼](https://help.aliyun.com/zh/model-studio/get-api-key/)、[Kimi](https://platform.kimi.com/docs/api/overview)、[智谱](https://docs.bigmodel.cn/cn/guide/develop/http/introduction)、[火山方舟](https://www.volcengine.com/docs/82379/1795150)、[硅基流动](https://docs.siliconflow.cn/docs/api/chat-completions-post)。

## 中转站与推理模型

高级设置提供：

- 鉴权方式：自动、Bearer、x-api-key 或无需鉴权。Messages 协议的中转站也可选 Bearer；Ollama 模板无需 Key，生成与测试均跳过钥匙串读取。
- 最大输出 Token：默认 4096，可按模型限制修改。Chat 可选 `max_tokens` 或 `max_completion_tokens`；Messages 使用 `max_tokens`；Responses 使用 `max_output_tokens`。
- 温度：旧配置默认 0.85，留空则不发送。对不接受 temperature 的推理模型，应留空。
- 思考模式：支持 `enable_thinking` 的平台可选择开关；其他平台保持默认。千问模板关闭思考，兼容其部分模型的非流式限制，见[百炼错误码](https://help.aliyun.com/zh/model-studio/error-code/)。
- 超时：默认 120 秒，可设为 5–600 秒。

连通测试复用相同的 URL、鉴权和参数规则，输出预算最多 1024 Token，可能产生少量费用。它验证接口响应结构、鉴权和模型可用性，不保证更长上下文或正式输出预算一定成功。429 表示限流或额度问题，不代表鉴权必然通过。重定向会被拒绝，应填写最终 API 地址。

正文生成、讨论和正文检查都会传递高级参数，Responses 正文从消息的 `output_text` 提取，思考内容不写入正文。长度截断会提示增大预算，不会把截断文本当作完整候选。接口返回 HTML、错误 JSON 或空内容时会报告失败，服务商错误中的当前 Key 会被遮盖。

## 当前边界与验证

当前调用为非流式文本请求。仅支持流式输出的模型、平台私有签名协议、任意自定义 Header、带查询参数的接口地址不在此次支持范围。审校槽位仍只保存配置；助手的正文检查使用当前所选服务商。语义检索已独立为默认关闭的可选扩展，安装和启停见[语义检索与分发说明](semantic-extension.md)。

新增服务商会先生成稳定 ID，再把 Key 存入该 ID 对应的钥匙串条目；写 Key 失败保留草稿，不发布损坏配置。曾受旧版空 ID 保存问题影响的服务商，需要重新填写并保存 Key。

验证命令：

```sh
pnpm --filter novel-weaver-core check
pnpm --filter novel-weaver-desktop build
pnpm --filter novel-weaver-desktop exec playwright test tests/ui/byok.spec.ts
cargo test --manifest-path apps/novel-weaver-desktop/src-tauri/Cargo.toml --bin novel-weaver-desktop
```

HTTP 契约测试使用本机模拟服务；UI 测试模拟 Tauri 钥匙串和探针，覆盖新增、编辑、重试、当前草稿测试、无 Key 配置与双视口布局。真实付费服务及 macOS 钥匙串权限弹窗需在桌面端使用自己的账户验证。
