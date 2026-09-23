# 本地构建与 Release 附件准备

维护者在本机接入私有核心、构建、验证后上传安装包。core 源码不上传到公开或私有 GitHub 仓库。这里的脚本只执行本地操作，不调用 GitHub 上传或发布接口。

当前 `build` 入口仅支持 macOS Apple Silicon；Windows 的凭据读取尚未完成，其他平台也未通过完整验收。安装包内置项目许可与第三方原文，启动页和工作区的“许可证”按钮可离线查看。首次发行前仍需审核对应版本的许可清单并完成实际安装验证。不要把脚本测试通过当成安装包可以直接发布。

## 准备固定版本

公开工作副本须已提交且没有待处理文件。使用明确的 `vX.Y.Z`，它必须与根 package、桌面 package、Cargo 和 Tauri 版本一致。core 版本可以不同，但必须匹配 `private-core.lock.json`。

```sh
pnpm release:prepare v0.1.0 /absolute/path/to/local-core /absolute/path/to/new-build
```

输出目录的父目录应已存在，输出目录本身必须不存在，并位于源码目录之外。脚本导出允许公开的文件，再把核心运行输入复制到新目录的 `packages/novel-weaver-core/`；不会复制核心测试、作品或原仓库 Git 历史。输入记录位于 `.private/local-release.json`，只包含版本、公开提交、指纹和平台信息。

每次重新构建使用新目录。目录已存在、核心不匹配、版本不一致或源代码未提交时，脚本会停止，不自动删除或覆盖原文件。

## 构建

在新目录中执行：

```sh
cd /absolute/path/to/new-build
pnpm release:build
```

当前固定工具为官方独立 Node 22.20.0、pnpm 10.33.2、Rust 1.93.1。脚本依次冻结锁文件安装依赖、运行脚本测试及 UI 静态检查、构建 DMG，并从生成的 `.app` 中验证核心资源的隔离运行。

当前入口生成 ad-hoc 签名预览包：应用 tauri.preview.conf.json，并清除子进程环境中的 APPLE_* 配置，再显式设定 APPLE_SIGNING_IDENTITY=-。它不使用 Developer ID，也不提交 Apple 公证。预览包不承诺免除 macOS 下载安全提示；签名应以最终产物的 codesign 验证结果为准。正式签名公证须另行实现并验收。

构建会收集实际安装的 npm 运行时依赖、Cargo 目标依赖的保守超集、Node/Rust 运行时与原生库、字体声明。上游未附完整许可的部分通过版本固定且带校验和的 scripts/license-overrides.json 补充。MPL Rust 组件的原始 .crate 随包提供，原生组件源码获取说明见声明文件。材料生成失败时构建停止。

成功后 `.private/local-build.json` 记录实际生成的 DMG 校验和、工具版本及资源测试结果。它不是 GUI 安装、真实模型调用、签名或许可审计报告。若构建失败，应在新目录重新准备，避免收集旧安装包。

## 收集附件

安装包构建后，可以先收集待审附件：

```sh
pnpm release:collect /absolute/path/to/new-assets
```

如果此版的第三方材料已审核，指定一个只提供以下两项文件的材料目录：`THIRD-PARTY-NOTICES.txt` 和 `licenses.zip`。

```sh
pnpm release:collect /absolute/path/to/new-assets /absolute/path/to/reviewed-notices
```

收集步骤核对固定源码、核心及已构建 DMG 的 hash，只复制指定安装包、三份项目许可材料和可选的第三方材料，并生成 `release-manifest.json` 与 `SHA256SUMS.txt`。不复制构建目录、core 源码或 `.private/`。

缺少第三方许可材料时仍可生成本地待审附件，但不能通过上传前的完整检查。第三方许可 ZIP 的内容必须另行审计；文件名与 hash 校验不能证明里面的许可完整或没有误放源码。最终安装包也必须内置相应材料，附件中的副本不能替代这一要求。

## 上传前检查

只检查文件集合、类型边界与 hash：

```sh
pnpm release:check /absolute/path/to/new-assets
```

该模式输出 `uploadReviewPassed: false`，即使附件一致也不表示验收完成。

收集时会生成 `.private/release-review.template.json`。完成实际验证后，将它另存为本地验收记录，如 `.private/release-review.json`，按事实记录干净机器安装、核心功能、安装包内许可、第三方许可审计和签名策略批准。签名状态只支持 `notarized` 或明确作为预览版的 `ad-hoc-preview`；没有验证就保持未通过。

```sh
pnpm release:check /absolute/path/to/new-assets .private/release-review.json
```

这一步会要求第三方附件齐全、各项人工验收已通过，并将验收记录绑定到当前 manifest 的 hash，防止挪用其他版本的结果。它验证记录的一致性，不替代真正执行签名验证、安装测试或许可内容审核。记录应留在本地，不作为 Release 附件。

发布阶段还需要核对远端 tag 指向清单中的公开提交，确认该提交已在公开仓库，以及现有 Release 附件不会被覆盖。只有取得发布确认后才执行上传；不要对整个构建目录或待审目录使用宽泛的递归上传。
