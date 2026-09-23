import { expect } from "@playwright/test";

import {
	configureSession,
	createTempProjectDir,
	disposeTempProjectDir,
	expectHumanErrorWithPreservedInput,
	test,
} from "./helpers/author-app";

/**
 * WF5-01 用例 #3：三类故障的人话错误、输入保留、恢复动作与焦点目标。
 * 故障注入只在传输层复刻核心失败形态（同文案），业务逻辑全部真实：
 * 「rpc_down」= 核心进程不可达；「stale_core」= 陈旧核心 Zod 形态；
 * 校验失败则完全不加注入，直接由真实核心 Zod 拒绝空语言字段。
 */
test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });

	test("校验失败：真实核心拒绝，人话提示且输入保留", async ({ page }) => {
		const dir = await createTempProjectDir();
		try {
			await configureSession(page, { defaultCwd: "", dialogPath: dir });
			await page.goto("/");
			await page.getByRole("button", { name: "＋ 新建一部书" }).first().click();

			const dialog = page.getByRole("dialog", { name: "首启向导" });
			const bookName = "校验不通过的稿子";
			await page.getByLabel("书名").fill(bookName);
			await page.getByLabel("主要创作语言").fill("");
			await page.getByRole("button", { name: "创建项目" }).click();

			await expectHumanErrorWithPreservedInput(page, "请求被本地核心拒绝");
			await expect(
				page.getByLabel("书名"),
				"失败的提交必须保留已填写的书名",
			).toHaveValue(bookName);
			// 恢复动作：作者补全字段后原表单重试即成功（真实写路径）。
			await page.getByLabel("主要创作语言").fill("zh-CN");
			await page.getByRole("button", { name: "创建项目" }).click();
			await expect(
				page.getByRole("button", { name: "进入写作台 ›" }),
			).toBeVisible();
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test("模型/RPC 失败：进程不可达提示，输入保留后可重试成功", async ({
		page,
	}) => {
		const dir = await createTempProjectDir();
		try {
			await configureSession(page, {
				defaultCwd: "",
				dialogPath: dir,
				fault: "rpc_down",
			});
			await page.goto("/");
			await page.getByRole("button", { name: "＋ 新建一部书" }).first().click();

			await page.getByLabel("书名").fill("断线重连稿");
			await page.getByRole("button", { name: "创建项目" }).click();

			await expectHumanErrorWithPreservedInput(
				page,
				"无法启动 Novel Weaver 本地核心",
			);
			await expect(
				page.getByLabel("书名"),
				"失败的提交必须保留已填写的书名",
			).toHaveValue("断线重连稿");

			await configureSession(page, { fault: "none" });
			await page.getByRole("button", { name: "创建项目" }).click();
			await expect(
				page.getByRole("button", { name: "进入写作台 ›" }),
			).toBeVisible();
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test("陈旧核心：版本过旧人话提示且不落任何写入", async ({ page }) => {
		const dir = await createTempProjectDir();
		try {
			await configureSession(page, {
				defaultCwd: "",
				dialogPath: dir,
				fault: "stale_core",
			});
			await page.goto("/");
			await page.getByRole("button", { name: "＋ 新建一部书" }).first().click();

			await page.getByLabel("书名").fill("旧核心稿");
			await page.getByRole("button", { name: "创建项目" }).click();

			// src/rpc.ts 的 staleCore 判定必须把 Zod 原始形态翻译成这句话。
			await expectHumanErrorWithPreservedInput(page, "本地核心版本过旧");
			await expect(page.getByLabel("书名")).toHaveValue("旧核心稿");

			// 目录保持未初始化：故障请求不得在 SQLite 留下半成品。
			const entries = await page.request.post("/__nw/local-rpc", {
				data: { cwd: dir, request: { method: "project_status", params: {} } },
			});
			expect((await entries.json())["ok"]).not.toBe(true);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
});
