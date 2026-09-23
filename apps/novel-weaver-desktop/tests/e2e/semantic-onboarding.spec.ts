import { expect } from "@playwright/test";
import type { SemanticExtensionStatus } from "novel-weaver-core/src/domain/semantic-extension.ts";
import {
	configureSession,
	coreRequest,
	createTempProjectDir,
	disposeTempProjectDir,
	test,
} from "./helpers/author-app";

test("skip optional embedding, persist the choice and create a book with the real core", async ({
	page,
}) => {
	// Run with NOVEL_WEAVER_EXTENSION_DIR pointing at an isolated temporary directory.
	test.skip(
		!process.env.NOVEL_WEAVER_EXTENSION_DIR,
		"Set an isolated NOVEL_WEAVER_EXTENSION_DIR before running this test.",
	);
	const dir = await createTempProjectDir();
	try {
		await configureSession(page, {
			defaultCwd: "",
			dialogPath: dir,
			fault: "none",
		});
		await page.goto("/");
		await page.getByRole("button", { name: "暂不安装", exact: true }).click();
		const extension = await coreRequest<SemanticExtensionStatus>(
			page,
			dir,
			"semantic_extension_status",
		);
		expect(extension.enabled).toBe(false);
		expect(extension.dismissed).toBe(true);
		await page.reload();
		await expect(
			page.getByRole("button", { name: "暂不安装", exact: true }),
		).toHaveCount(0);
		await page
			.getByRole("button", { name: "新建一部书", exact: true })
			.first()
			.click();
		await page.getByLabel("书名", { exact: true }).fill("基础版不依赖模型");
		await page.getByLabel("主要创作语言", { exact: true }).fill("zh-CN");
		await page.getByRole("button", { name: "创建项目", exact: true }).click();
		await expect(
			page.getByRole("button", { name: /进入写作台/ }),
		).toBeVisible();
		const result = await coreRequest<{
			engine: string;
			degradedReason: string;
		}>(page, dir, "search_evidence", { query: "线索", beforeStoryOrder: 10 });
		expect(result.engine).toBe("sqlite");
		expect(result.degradedReason).toBe("semantic_disabled");
	} finally {
		await disposeTempProjectDir(dir);
	}
});
