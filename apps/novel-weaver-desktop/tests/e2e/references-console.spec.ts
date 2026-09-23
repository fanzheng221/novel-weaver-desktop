import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

import {
	configureSession,
	coreRequest,
	createTempProject,
	disposeTempProjectDir,
	expectNoPageHorizontalScroll,
	test,
} from "./helpers/author-app";

/**
 * WF6-05 喂书分析全链路（真实 RPC）：启动页打开书籍 → 规划/风格参考 →
 * 导入对话框（会话配置 dialogPath 代答真实 TXT，核心按 sourcePath 读盘）→
 * 标题切分预览 → 确定性统计报告 → 分步分析（NW_COMPLETION_FIXTURE 按
 * 【参考书风格分析】/【参考书风格汇总】标记脚本化模型层）→ 汇总送审 →
 * 收件箱就地采纳 → 核心侧风格特征已启用。参考书永不进正典（ADR-0019）。
 */

const REFERENCE_TEXT = [
	"第一章 雾夜来客",
	"苏晚把灯挑亮了一分。她说：「今晚的雾太大了。」",
	"林舟没有回答，只是按住了刀柄。风从江面卷过来，吹得灯罩嗡嗡作响。",
	"雾里亮起一盏不该出现的灯！",
	"",
	"第二章 灯下对峙",
	"来人停在五步之外，斗篷还在滴水。",
	"他开口问：「钥匙在哪里？」",
	"林舟摇头。苏晚看了林舟一眼，把灯芯剪短了一截。",
	"夜色更深了。",
].join("\n");

/** e2e 补全服务商：恒有 Key（垫片 byok_key_tail），补全走 NW_COMPLETION_FIXTURE。 */
async function seedByokFixture(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"nw-byok-providers",
			JSON.stringify([
				{
					id: "e2e-fixture",
					name: "E2E 补全夹具",
					modelId: "fixture-model",
					baseURL: "http://fixture.local/v1",
				},
			]),
		);
		window.localStorage.setItem(
			"nw-byok-slots",
			JSON.stringify({ generation: "e2e-fixture" }),
		);
	});
}

async function openReferencesConsole(
	page: Page,
	bookName: string,
): Promise<void> {
	await page.goto("/");
	const card = page.getByRole("article", { name: `书籍：${bookName}` });
	await expect(card).toBeVisible();
	// 投影就绪前主按钮回落也叫「打开书籍」（同名双按钮），等分化完成再点。
	await expect(card.getByRole("button", { name: "打开书籍" })).toHaveCount(1);
	await card.getByRole("button", { name: "打开书籍" }).click();
	await expect(page.getByRole("banner")).toBeVisible();
	await page
		.getByRole("complementary", { name: "导航侧栏" })
		.getByRole("button", { name: "规划" })
		.click();
	await page
		.getByRole("navigation", { name: "规划子区" })
		.getByRole("button", { name: "风格参考" })
		.click();
	await expect(page.getByRole("heading", { name: "风格参考" })).toBeVisible();
}

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runReferenceSuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runReferenceSuite("compact");
});

function runReferenceSuite(profile: string): void {
	test(`[${profile}] 导入→切分→统计→分析→汇总送审→收件箱采纳→特征启用`, async ({
		page,
	}, testInfo) => {
		const bookName = `喂书验收稿-${profile}`;
		const dir = await createTempProject(page, { name: bookName });
		const scratch = path.join(os.tmpdir(), `nw-reference-fixture-${profile}`);
		await mkdir(scratch, { recursive: true });
		const referenceFile = path.join(scratch, "雾城夜行.txt");
		await writeFile(referenceFile, REFERENCE_TEXT, "utf8");
		await seedByokFixture(page);
		await configureSession(page, {
			defaultCwd: dir,
			dialogPath: referenceFile,
		});
		try {
			await openReferencesConsole(page, bookName);
			await expect(
				page.getByText("还没有参考书"),
				"初始为空书架",
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);

			// 导入向导：文件路径由对话框代答，书名自动取自文件名。
			await page.getByRole("button", { name: "导入 TXT / MD" }).first().click();
			const dialog = page.getByRole("dialog", { name: "导入参考书" });
			await expect(dialog).toBeVisible();
			await dialog.getByRole("button", { name: "选择 TXT / MD 文件" }).click();
			await expect(
				dialog.getByText(referenceFile),
				"代答路径回显到面板",
			).toBeVisible();
			await expect(dialog.getByRole("textbox", { name: "书名" })).toHaveValue(
				"雾城夜行",
			);
			await dialog.getByRole("button", { name: "导入", exact: true }).click();

			// 书架与切分预览：标题切分 2 章，导入提示带章数。
			await expect(page.getByText(/导入完成：2 章/)).toBeVisible();
			await expect(
				page.getByRole("button", { name: /雾城夜行/ }).first(),
				"书架出现新书卡",
			).toBeVisible();
			await expect(page.getByText("共 2 章")).toBeVisible();
			await expect(page.getByText(/切分模式：章节标题/)).toBeVisible();
			await testInfo.attach("references-imported", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});

			// 统计报告（客观数据）：对话占比、章末钩子（第 1 章以「！」收尾）、句长中位。
			const statsPanel = page
				.locator("section")
				.filter({ hasText: "统计报告（客观数据）" });
			await expect(statsPanel.getByText(/1\/2 章/)).toBeVisible();
			await expect(statsPanel.getByText(/对话占比/)).toBeVisible();
			await expect(statsPanel.getByText(/\d+ 字$/)).toBeVisible();

			// 分析进行态：step 循环自动分批推进，全章完成后转「汇总送审」。
			await page.getByRole("button", { name: "发起分析" }).click();
			await expect(page.getByText("分批推进中")).toBeVisible();
			await expect(
				page.getByRole("button", { name: "汇总送审" }),
				"桌面 step 驱动自动跑完 2 章",
			).toBeVisible({ timeout: 30_000 });

			// 汇总送审：2 条风格特征＋1 条节奏范本提案进入收件箱。
			await page.getByRole("button", { name: "汇总送审" }).click();
			await expect(
				page.getByText(/已送审校收件箱：2 条风格特征提案＋1 条节奏范本提案/),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);

			// 「去裁决」只导航不自动跳转落地裁决。
			await page.getByRole("button", { name: "去裁决" }).first().click();
			await expect(
				page.getByRole("heading", { name: "审校收件箱" }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: /^风格沉淀/ }),
			).toBeVisible();
			const traitEntry = page.getByRole("button", {
				name: /风格特征·对话/,
			});
			await expect(traitEntry).toBeVisible();
			await expect(
				page.getByRole("button", { name: /节奏范本·《雾城夜行》/ }),
			).toBeVisible();

			// 收件箱就地裁决：采纳后核心侧特征已入库并默认启用。
			await traitEntry.click();
			const rulingPanel = page
				.locator("section")
				.filter({ hasText: "裁决 · 风格特征·对话" });
			await expect(rulingPanel).toBeVisible();
			await expect(
				rulingPanel.getByText(/来自参考书分析的风格特征提案/),
			).toBeVisible();
			await rulingPanel
				.getByRole("button", { name: "采纳", exact: true })
				.click();
			await expect(
				page.getByText(/已采纳：风格特征入库并默认启用/),
			).toBeVisible();

			const traits = await coreRequest<
				Array<{ dimension: string; enabled: boolean }>
			>(page, dir, "list_style_traits");
			expect(
				traits.some((trait) => trait.dimension === "对话" && trait.enabled),
				"采纳后特征在核心侧启用",
			).toBe(true);
		} finally {
			await configureSession(page, { dialogPath: null });
			await rm(scratch, { recursive: true, force: true });
			await disposeTempProjectDir(dir);
		}
	});
}
