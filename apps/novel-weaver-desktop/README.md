# Novel Weaver · 文织助手（桌面版）

[简体中文](README.md) | [English](README.en.md)

Novel Weaver 是一款**本地优先**的 AI 协作小说创作桌面应用（macOS Apple Silicon / Windows x64），面向长篇创作：从世界观设定、大纲规划到逐场景写作、审校与发布。它与其他 AI 写作工具的根本区别是**作者主权**——AI 产出的一切都只是「候选内容」，只有经你明确确认后才会成为正式内容，并作为后续创作的既成事实。

## 核心理念

- **作者掌握最终决策权**：生成候选 → 作者裁决 → 确认入正典。正文、设定、规划在四处设有确认关口，AI 永远不会静默改写你的作品。
- **事实库驱动的一致性**：故事事实、角色认知、严格状态（等级 / 归属 / 资源）、故事时间都被显式建模，审校阶段做确定性校验，而不是靠模型「记住」前文。
- **本地优先**：项目数据存放在你自己的磁盘（SQLite + 资产目录），桌面壳通过本地 RPC 调用 Node/TS 核心，不依赖任何云端服务；模型接入自带 Key（BYOK），调用哪家服务商由你决定。

## 功能速览

### 写作台

按章节与场景组织正文，左侧是场景树，右侧是正典纸面。每场记录本场任务与叙事目的，支持版本历史、以当前场景为基续写新候选、空白新草稿、专注模式与自动保存。

### AI 助手

助手只服务于当前打开的场景，提供生成候选、讨论推演、检查正文三类工作。快捷指令（从光标续写、强化张力、三个走向……）一键发起，本次携带的上下文在生成前可见。

### 候选裁决（双稿对照）

AI 候选不会直接覆盖正文。裁决视图三栏对照「我的正文 / AI 候选 / 最终草稿预览」：可以逐句勾选替换，也可以全文采用为新草稿——确认前一切可放弃。

### 规划工作区

章节大纲（总纲 → 卷 → 章 → 场景）、伏笔追踪、时间线、节奏范围一目了然。AI 的一切规划调整都以「待审工作提案」的形式提交，你批准后才会生效。

### 世界设定与关系图谱

世界工作区管理规则、人物、设定与关系。设定即世界的钉子：建立后拒绝正式更改，需要修订时走流程。关系图谱按故事时间与知识范围切片，同时呈现客观关系与方向性角色态度，每条关系都能跳转到支撑它的正式场景证据。

### 审校收件箱

一致性校验分阻断 / 警告 / 提示三级，另有 AI 味检测、叙事增量与剧情逻辑疑点。所有待你裁决的事项——场景候选、规划变更、设定修订、风格沉淀提案——集中出现在审校收件箱，处理或去对应工作区处理。

选中任一条目即可查看处理建议与影响说明，或跳转对应工作区处理：

### 发布流程

发布检查 → 发布版本 → 确认定版 → 导出（TXT / MD / HTML / EPUB）。发布形成不可变的版本快照，后续修订不会改写既有发布历史；「追更看板」管理各章的更新计划。

### 风格参考与风格特征

导入参考作品（TXT）后自动切章，本地统计 + 逐章 AI 分析提炼风格特征与节奏范本；产出以提案形式进入收件箱，采纳后作为生成时的文风指导。参考书原文只做分析，永不进入正文（防泄漏双重保险）。

### 模型接入（BYOK）

按协议接入，服务商不限制：OpenAI Chat Completions / Anthropic Messages / OpenAI Responses 三种协议，内置 DeepSeek、通义千问、Kimi、智谱 GLM、火山方舟 / 豆包、硅基流动、OpenAI、Anthropic、Ollama 与自定义中转站模板。API Key 只存系统钥匙串（macOS Keychain），支持连通测试与用量统计。

### 可选语义检索

默认关闭的本地扩展：接入 Ollama（可自动安装运行时与 embedding 模型）后，可用自然语言检索本书正文，如「有人把钥匙交给主角的那一幕」。未启用或索引过期时自动回退 SQLite 关键词检索。详见[语义检索与分发说明](docs/semantic-extension.md)。

## 安装包

安装包将在独立构建、验收后通过 GitHub Releases 提供。本源码快照尚未发布安装包；开发运行方式见下文。

## 本地开发

仓库仅公开桌面外层；共享核心保持私有，不包含在公开源码中。完整构建需要维护者先接入匹配版本的私有核心，步骤见[仓库首页](../../README.md)。

```sh
node scripts/attach-private-core.mjs /path/to/private/novel-weaver-core
pnpm install --frozen-lockfile                        # 仓库根目录
pnpm --filter novel-weaver-desktop tauri dev          # 启动桌面开发模式
```

无需预构建本地核心：Tauri 通过 Node 的 TypeScript 支持直接启动 `local-core/cli.ts`。可用 `NOVEL_WEAVER_NODE` 覆盖 Node 二进制，`NOVEL_WEAVER_CORE_SCRIPT` 覆盖核心入口路径。

常用命令：

```sh
pnpm --filter novel-weaver-desktop build              # 类型检查 + 前端构建
pnpm --filter novel-weaver-desktop test:e2e           # 真实核心进程端到端测试
pnpm --filter novel-weaver-desktop test:ui:static     # Tailwind 类名静态门禁
pnpm --filter novel-weaver-desktop icons:generate     # 编辑 public/app-icon.svg 后同步原生图标
```

架构约束：桌面壳不直接读 SQLite，所有读模型经由本地 RPC 暴露，由 `packages/novel-weaver-core` 提供业务能力。

## 更多文档

- [BYOK 模型接入](docs/byok.md)——协议、端点、鉴权与高级参数
- [语义检索与分发说明](docs/semantic-extension.md)——安装门槛、已有 Ollama 接入、独立运行时打包
- [UI 终值断言](docs/ui-testing.md)——三层测试基座
