import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

/**
 * 真实作者任务验收基座（WF5-01）。与静态 fixture 套件互补：
 * 这里的每一条断言都经浏览器 invoke shim → /__nw/local-rpc → 真实
 * `node local-core/cli.ts` 进程 → SQLite 往返，fixture 响应无法通过。
 * 端口固定 1430，避免与作者本机 1420 的 dev server 相互抢占。
 */
const port = 1430;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
	testDir: "./tests/e2e",
	outputDir: "test-results/author-tasks",
	fullyParallel: false,
	workers: 1,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: [
		["list"],
		["html", { open: "never", outputFolder: "playwright-report/author-tasks" }],
	],
	use: {
		baseURL,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	webServer: {
		command: `pnpm exec vite --port ${port} --strictPort --host 127.0.0.1`,
		url: `${baseURL}/__nw/health`,
		reuseExistingServer: false,
		timeout: 30_000,
		cwd: path.dirname(fileURLToPath(import.meta.url)),
		// WF5-09：双稿 e2e 的补全夹具随服务器启动注入（桥件 spawn 核心
		// 进程时继承此环境）；其余用例不触发 generate，不受影响。
		env: {
			NW_COMPLETION_FIXTURE: path.join(
				path.dirname(fileURLToPath(import.meta.url)),
				"tests/e2e/fixtures/dual-draft-completions.json",
			),
		},
	},
	projects: [
		{
			name: "chromium",
			use: { browserName: "chromium" },
		},
	],
});
