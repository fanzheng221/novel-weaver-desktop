import { expect } from "@playwright/test";

import {
	configureSession,
	coreRequest,
	createTempProjectDir,
	disposeTempProjectDir,
	expectNoPageHorizontalScroll,
	rpcLog,
	test,
} from "./helpers/author-app";

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runLifecycleSuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runLifecycleSuite("compact");
});

function runLifecycleSuite(profile: string): void {
	/**
	 * 垂直切片（WF5-01 用例 #1）：UI 发出的 initialize_project 与生产 Tauri
	 * 完全同 envelope（{cwd, request:{method,params}} → 真实 CLI 进程）；
	 * 结束后测试进程再独立直打一次 project_status，从 SQLite 读回真实结果
	 * ——fixture 无法伪造第二个进程的读回。
	 */
	test(`[${profile}] 新建书→真实初始化→进入写作台，核心可独立读回`, async ({
		page,
	}, testInfo) => {
		const dir = await createTempProjectDir();
		try {
			await configureSession(page, {
				defaultCwd: "",
				dialogPath: dir,
				fault: "none",
			});

			await page.goto("/");
			await expect(
				page.getByRole("heading", { name: "书架是空的" }),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);
			await testInfo.attach("launcher-empty-shelf", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});

			// 目录选择对话框由会话配置代答；未初始化目录应直接进入首启向导。
			await page.getByRole("button", { name: "＋ 新建一部书" }).first().click();
			const dialog = page.getByRole("dialog", { name: "首启向导" });
			await expect(dialog).toBeVisible();

			const bookName = `验收稿-${profile}`;
			await page.getByLabel("书名").fill(bookName);
			await page.getByLabel("主要创作语言").fill("zh-CN");
			await page.getByRole("button", { name: "创建项目" }).click();

			// 成功态没有标题文案；以「进入写作台」按钮出现为准。
			const enterButton = page.getByRole("button", { name: "进入写作台 ›" });
			await expect(enterButton).toBeVisible();
			await enterButton.click();
			await expect(page.getByRole("dialog", { name: "首启向导" })).toBeHidden();
			// 顶栏项目名来自真实 project_status 读回（AppShell 挂载时拉取）。
			await expect(
				page.getByRole("banner").getByText(bookName, { exact: true }),
			).toBeVisible();

			// 生产 envelope 证据：UI 确实发出了同一信封的本地 RPC。
			const log = await rpcLog(page);
			const initCall = log.find(
				(entry) => entry.args?.request?.method === "initialize_project",
			);
			expect(initCall, "UI 必须发出 initialize_project").toBeTruthy();
			expect(initCall?.args).toMatchObject({
				cwd: dir,
				request: { method: "initialize_project" },
			});
			expect(JSON.stringify(initCall?.args)).toContain(bookName);

			// 独立读回：绕开 UI，从进程外用同一 envelope 验证 SQLite 落盘。
			const status = await coreRequest<{
				name: string;
				canonicalSceneCount: number;
			}>(page, dir, "project_status");
			expect(status.name).toBe(bookName);
			expect(status.canonicalSceneCount).toBe(0);
			expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
}
