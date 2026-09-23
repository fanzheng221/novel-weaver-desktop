# Novel Weaver · 文织助手桌面外层

本仓库公开 Novel Weaver 的 React 界面、Tauri 桌面壳、本地 RPC 适配器与构建工具。`novel-weaver-core` 是单独维护的私有实现，不包含在本仓库中；安装包由维护者接入私有核心后构建，包含完整运行组件。

这不是可以只靠公开源码完成完整构建的版本。当前界面仍引用核心的类型及部分运行时逻辑；拥有私有核心的维护者可以构建完整应用。普通使用者应获取维护者发布的安装包。

功能介绍：[中文](apps/novel-weaver-desktop/README.md) · [English](apps/novel-weaver-desktop/README.en.md)。

## 公开源码检查

只需 Node 22.18+（22.x），不需要安装依赖或接触私有核心：

```sh
node scripts/verify-public-source.mjs
node --test scripts/tests/*.test.mjs
```

公开 CI 只运行这两项检查，不拉取私有源码、不持有私有构建凭据，也不自动发布安装包。

## 维护者开发与打包

需要 Node 22.18+（22.x）、pnpm 10.33.2、Rust stable 和目标平台的 Tauri 2 构建依赖。生产打包使用官方独立 Node 发行版，并在目标平台、目标架构上运行。

先取得与 `private-core.lock.json` 指纹匹配的私有核心，再执行：

```sh
node scripts/attach-private-core.mjs /absolute/path/to/novel-weaver-core
pnpm install --frozen-lockfile
pnpm dev
```

第一条命令只复制版本锁定的核心运行源码与包配置到被 Git 忽略的 `packages/novel-weaver-core/`，不覆盖已有目录。没有私有核心时会明确拒绝继续；示例路径需要换成维护者自己的私有核心目录。

```sh
pnpm build           # 核心版本验证 + TypeScript + 前端构建
pnpm typecheck
pnpm test:ui:static
pnpm --filter novel-weaver-desktop exec playwright install chromium
pnpm test:ui
pnpm test:e2e
pnpm bundle          # 当前平台的 Tauri 安装包
pnpm --filter novel-weaver-desktop exec node scripts/verify-bundle.mjs
```

`pnpm bundle` 验证私有核心指纹，并生成 Node 运行时、核心 CJS、SQL schema、原生依赖及构建指纹清单，然后交给 Tauri 打包。源码和生成的资源全部留在维护者构建环境；验证脚本核对核心版本与 CJS 校验和，并在隔离目录、空 PATH、无向量模块的条件下测试创建书籍、检索及重新打开。

可选环境设置见 [.env.example](.env.example)。应用不自动读取 `.env`。

## 导出公开源码

即使本机已接入私有核心，也只从允许列表导出准备上传的源码：

```sh
node scripts/verify-public-source.mjs
node scripts/export-public-source.mjs /absolute/path/to/new-public-export
```

导出目标必须是工作目录之外的新目录。`public-files.json` 决定公开文件集合；脚本拒绝核心目录、生成资源、常见凭据文件、路径穿越和符号链接。已有独立 Git 仓库时也会检查暂存区，发现强制加入的私有文件即失败。新增公开文件时需同步审查允许列表。

`.gitignore` 只是第一层约束；不要从含核心的构建目录直接制作递归 ZIP，也不要强制添加 `packages/` 或 `src-tauri/resources/`。

## 分发边界

公开源码仓库不包含核心源码、核心测试、SQL 源文件、小说数据库或真实作品截图。`pnpm-lock.yaml` 中的核心依赖元数据及 `private-core.lock.json` 中的版本指纹可公开，它们不包含核心实现。

安装包包含核心的可执行分发形式。当前核心打包成可提取、可阅读的 JavaScript；不公开源码仓库不等于对安装包加密或防逆向。安装包只作为 Release 附件分发，不能把生成的 CJS、source map 或整个构建目录提交到公开源码库。

原有自动 Release 工作流不随此公开副本发布。维护者可以本机构建，或另行配置受控的私有构建环境；源码上传与 Release 发布仍需要维护者明确执行。

macOS 与 Windows 安装包需要分别验收。

## 许可证

本仓库的原创桌面外层采用 [Apache License 2.0](LICENSE)，允许按该许可证使用、修改和分发，包括商业使用。适用范围及第三方组件说明见 [LICENSING.md](LICENSING.md)。

该授权不覆盖私有 `novel-weaver-core` 的实现。核心由哈迪工作室按 [CORE-LICENSE.txt](CORE-LICENSE.txt) 授权个人和企业免费使用，并允许免费转发完整、未修改的官方安装包；不授予核心独立再分发或转售权。第三方组件保留各自许可，正式安装包应包含全部适用许可材料。
