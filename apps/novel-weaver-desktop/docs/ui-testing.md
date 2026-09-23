# UI 终值断言

桌面端的 UI 回归测试分为两层：`test:ui:static` 快速检查不应退化的源码结构；`test:ui` 由普通 `@playwright/test` 启动 Vite fixture，在真实 Chromium 中读取最终计算样式、尺寸或 DOM 语义。它不启动 Tauri、`AppRoot` 或本地 RPC。

## 本地运行

在仓库根目录安装依赖后，仅下载本基线所需的 Chromium：

```sh
pnpm --filter novel-weaver-desktop exec playwright install chromium
pnpm --filter novel-weaver-desktop test:ui:static
pnpm --filter novel-weaver-desktop test:ui
```

CI 在依赖安装后执行同一条浏览器安装命令，再运行两个测试命令。Playwright 版本升级后应重新运行安装命令，以下载与该版本匹配的 Chromium。当前基线不安装或运行 Firefox/WebKit。

## Fixture 与断言约定

- 每个 fixture 是 `ui-fixtures/<name>.html` 加 `src/test-fixtures/<name>.tsx`，必须显式导入产品 `ui/base.css`；该入口会连同 token 与 Tailwind utilities 一起加载。
- fixture 仅装配确定性的 UI 组件和假数据，禁止导入需要 Tauri `getCurrentWindow()` 或本地 RPC 的 `AppRoot`。
- Playwright 只配置一个 `chromium` 项目；测试内固定遍历 `1180×760` 与 `800×600` 两种视口。新增断言应在两个视口下都成立，或明确说明仅适用的视口。
- 通过条件以数值、角色/名称与行为断言为准。测试会保留 JSON 数值附件，失败时自动保留截图和 trace；不维护整页像素金样本。
- 结构性不变量加入 `scripts/verify-ui-structure.mjs`，计算颜色、布局、溢出和交互行为加入 `tests/ui/`。

浏览器测试只能验证网页可访问性线索，不能替代真实 macOS Tauri 窗口中的 VoiceOver/AXPress 人工抽测；这两类证据应分别记录。

## 真实作者任务基座（WF5-01）

`test:e2e` 是第三层：同一 Playwright/Chromium，但页面经 dev-only Tauri invoke 垫片把 `query_project` 原样转发到常驻的真实 `node local-core/cli.ts` 进程，SQLite 真实落盘后由测试进程独立读回。fixture 响应无法通过这一层。

```sh
pnpm --filter novel-weaver-desktop test:e2e
```

约定：

- 桥件只存在于 vite dev server（`tests/harness/local-rpc-bridge.ts`），端口固定 1430，不与作者本机 1420 的 dev server 抢占；`tauri dev` 下垫片检测到 `__TAURI_INTERNALS__` 即静默退出，生产行为不变。
- 故障注入仅在传输层复刻核心失败形态（进程不可达、陈旧核心 Zod dump）；业务逻辑与校验全部走真实核心，禁止业务 mock。
- 公共测试只使用临时示例项目；作者真实小说的本机 smoke 测试不包含在本仓库中。
- 错误断言以人话片段匹配（如「请求被本地核心拒绝」「本地核心版本过旧」），绑定文案根因而不绑死整句。
- 双视口（1180×760 / 800×600）所有真实流程必须同时断言无页面级横向滚动并附截图。
