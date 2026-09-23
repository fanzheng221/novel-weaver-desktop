import { expect, type Page } from "@playwright/test";

import {
	configureSession,
	coreRequest,
	createTempProject,
	disposeTempProjectDir,
	expectNoPageHorizontalScroll,
	test,
} from "./helpers/author-app";

/** 经真实核心把临时项目播种成「有规则/有关系/有一个正典场景」的世界（WF5-03 同款）。 */
async function seedProject(page: Page, dir: string): Promise<void> {
	const design = await coreRequest<{ proposalId: string }>(
		page,
		dir,
		"create_design_proposal",
		{
			hardRules: [
				{
					id: "RULE-DEATH",
					name: "人死不能复生",
					description: "本世界没有复活手段，死亡即终局。",
					examples: [],
				},
			],
			softRules: [],
			entities: [
				{
					id: "CHAR-LIN",
					type: "character",
					canonicalName: "林舟",
					description: "漕帮少主。",
					attributes: {},
				},
			],
			objectiveRelationships: [],
		},
	);
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: design.proposalId,
		expectedRevision: 1,
	});
	const candidate = await coreRequest<{
		proposalId: string;
		sceneVersionId: string;
	}>(page, dir, "create_scene_candidate", {
		title: "雾中来客",
		markdown: "林舟在雾中接过苏晚递来的唯一钥匙。",
		narrativeMode: "third_person_limited",
		viewpointCharacterId: "CHAR-LIN",
		continuityId: "main",
		storyOrder: 10,
		purposes: ["推进主线"],
	});
	await coreRequest(page, dir, "record_scene_review", {
		proposalId: candidate.proposalId,
		candidateVersionId: candidate.sceneVersionId,
		findings: [],
	});
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: candidate.proposalId,
		expectedRevision: 1,
	});
}

/** 五区一级导航的作者语言标签（验收 1）。 */
const AREA_LABELS = ["写作", "规划", "世界", "审校", "发布"] as const;

async function openProject(page: Page, name: string): Promise<string> {
	const dir = await createTempProject(page, { name });
	await configureSession(page, { defaultCwd: dir, fault: "none" });
	await page.goto("/");
	const card = page.getByRole("article", { name: `书籍：${name}` });
	await card.getByRole("button", { name: "打开书籍" }).click();
	await expect(page.getByRole("banner")).toBeVisible();
	return dir;
}

async function openProjectMenu(page: Page): Promise<void> {
	await page
		.getByRole("complementary", { name: "导航侧栏" })
		.getByRole("button", { name: "项目与设置" })
		.click();
	await expect(page.getByRole("dialog", { name: "项目与设置" })).toBeVisible();
}

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runShellSuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runShellSuite("compact");
});

function runShellSuite(profile: string): void {
	/**
	 * WF5-04 用例 1：主导航只有五个作者工作区；BYOK、用量、主题、设计基座
	 * 进入项目菜单。项目菜单打开后系统能力仍全部可达。
	 */
	test(`[${profile}] 主导航收敛为五工作区，系统入口进项目菜单`, async ({
		page,
	}, testInfo) => {
		const dir = await openProject(page, `五区-${profile}`);
		try {
			const nav = page.getByRole("complementary", { name: "导航侧栏" });
			for (const label of AREA_LABELS) {
				await expect(
					nav.getByRole("button", { name: label, exact: true }),
				).toBeVisible();
			}
			// 旧一级入口不再出现在主导航（收编进子区或项目菜单）。
			for (const gone of [
				"设定库",
				"爽点模板库",
				"QC 审校",
				"发布前检查",
				"模型接入 · BYOK",
			]) {
				await expect(nav.getByRole("button", { name: gone })).toHaveCount(0);
			}
			await expectNoPageHorizontalScroll(page);

			await openProjectMenu(page);
			const menu = page.getByRole("dialog", { name: "项目与设置" });
			await expect(
				menu.getByRole("button", { name: /模型接入/ }),
			).toBeVisible();
			await expect(
				menu.getByRole("button", { name: /设计基座/ }),
			).toBeVisible();
			await menu.getByRole("button", { name: /模型接入/ }).click();
			await expect(page.getByText("用量与费用").first()).toBeVisible();

			await openProjectMenu(page);
			await page
				.getByRole("dialog", { name: "项目与设置" })
				.getByRole("button", { name: /设计基座/ })
				.click();
			await expect(page.getByText("设计系统基座").first()).toBeVisible();

			// 主题切换进菜单：data-theme 必须真实翻转。
			const root = page.locator("html");
			const before = await root.getAttribute("data-theme");
			await openProjectMenu(page);
			await page
				.getByRole("dialog", { name: "项目与设置" })
				.getByRole("button", { name: /切换浅色主题|切换深色主题/ })
				.click();
			const after = await root.getAttribute("data-theme");
			expect(after, "主题必须真实切换").not.toBe(before);

			// 目检证据落盘（附件会随 report 清理，路径相对桌面端包根持久保留）。
			const wideShot = `test-results/documentation/wf5-shell-nav-${profile}.png`;
			await page.screenshot({ path: wideShot, fullPage: true });
			await testInfo.attach("five-area-nav", { path: wideShot });
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	/**
	 * WF5-04 用例 2：旧 hash 全部映射到对应工作区/子区，未知路由回落写作区。
	 */
	test(`[${profile}] 旧深链与未知路由全部落地，不出现空页`, async ({
		page,
	}) => {
		const dir = await openProject(page, `深链-${profile}`);
		try {
			const cases: Array<[string, () => Promise<void>]> = [
				[
					"#/outline",
					() =>
						expect(
							page.getByRole("heading", { name: "大纲工作区" }),
						).toBeVisible(),
				],
				["#/foreshadow", () => expectStripActive(page, "规划", "伏笔追踪")],
				[
					"#/outline-foreshadow",
					() => expectStripActive(page, "规划", "伏笔追踪"),
				],
				["#/timeline", () => expectStripActive(page, "规划", "时间线")],
				[
					"#/pacing",
					() =>
						expect(
							page.getByRole("heading", { name: "爽点模板库" }),
						).toBeVisible(),
				],
				[
					"#/lore",
					() =>
						expect(page.getByRole("heading", { name: "设定" })).toBeVisible(),
				],
				[
					"#/characters",
					() =>
						expect(page.getByRole("heading", { name: "人物" })).toBeVisible(),
				],
				[
					"#/graph",
					() =>
						expect(
							page.getByRole("heading", { name: "关系", exact: true }),
						).toBeVisible(),
				],
				["#/qc", () => expectStripActive(page, "审校", null)],
				// WF5-16：旧「发布检查/发布与导出」深链并入线性发布流程。
				["#/checklist", () => expectStripActive(page, "发布", "发布流程")],
				["#/publish", () => expectStripActive(page, "发布", "发布流程")],
				[
					"#/board",
					() =>
						expect(
							page.getByRole("heading", { name: "追更看板" }),
						).toBeVisible(),
				],
				["#/studio", () => expectStripActive(page, "写作", null)],
				["#/不存在路由", () => expectStripActive(page, "写作", null)],
			];
			for (const [hash, assertLanded] of cases) {
				await page.goto(`/${hash}`);
				await assertLanded();
				await expectNoPageHorizontalScroll(page);
			}
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	/**
	 * WF5-04 用例 3：切换工作区再返回，子区选择、滚动位置、当前场景上下文都恢复。
	 */
	test(`[${profile}] 子区、滚动与场景上下文跨区保留`, async ({ page }) => {
		const dir = await openProject(page, `记忆-${profile}`);
		try {
			await seedProject(page, dir);

			// 子区记忆：规划/伏笔追踪 → 写作 → 回规划仍在伏笔追踪。
			await page.goto("/#/planning");
			await stripButton(page, "规划", "伏笔追踪").click();
			await expectStripActive(page, "规划", "伏笔追踪");
			await navTo(page, "写作");
			await navTo(page, "规划");
			await expectStripActive(page, "规划", "伏笔追踪");

			// 场景上下文：写作区选中场景 → 切走 → 回来仍选中。
			// 「当前场景」文案在 AI 助手抽屉内（WF5-07）：先选中场景再开抽屉查看；
			// 抽屉是模态覆盖层，跨区导航前先 Esc 收起。
			await navTo(page, "写作");
			await page
				.getByRole("button", { name: /雾中来客/ })
				.first()
				.click();
			await page
				.getByRole("banner")
				.getByRole("button", { name: /AI 助手/ })
				.click();
			await expect(page.getByText(/当前场景：正典 · 雾中来客/)).toBeVisible();
			await page.keyboard.press("Escape");
			await navTo(page, "世界");
			await navTo(page, "写作");
			await page
				.getByRole("banner")
				.getByRole("button", { name: /AI 助手/ })
				.click();
			await expect(page.getByText(/当前场景：正典 · 雾中来客/)).toBeVisible();
			await page.keyboard.press("Escape");

			// 滚动记忆：世界区关系子区（统一工作区，双视口都超出视口高）滚到底部
			// → 切走 → 回来子区与滚动位置一起恢复（WF5-04）。
			await navTo(page, "世界");
			await stripButton(page, "世界", "关系").click();
			await expectStripActive(page, "世界", "关系");
			const scrollMain = page.getByRole("main").first();
			await scrollMain.evaluate((el) => {
				el.scrollTop = el.scrollHeight;
			});
			const saved = await scrollMain.evaluate((el) => el.scrollTop);
			expect(saved).toBeGreaterThan(0);
			await navTo(page, "审校");
			await navTo(page, "世界");
			await expect
				.poll(async () => scrollMain.evaluate((el) => el.scrollTop), {
					timeout: 3000,
				})
				.toBeGreaterThan(0);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	/**
	 * WF5-04 用例 4：命令面板使用与主导航一致的作者语言，当前工作区/子区有选中态。
	 */
	test(`[${profile}] 命令面板作者语言与当前项选中态`, async ({ page }) => {
		const dir = await openProject(page, `面板-${profile}`);
		try {
			await page.getByRole("button", { name: /⌘K 命令/ }).click();
			const dialog = page.getByRole("dialog", { name: "命令面板" });
			await expect(
				dialog.getByRole("option", { name: "写作", exact: false }),
			).toBeVisible();
			await expect(
				dialog.getByRole("option", { name: /规划 › 伏笔追踪/ }),
			).toBeVisible();
			await expect(
				dialog.getByRole("option", { name: /世界 › 规则/ }),
			).toBeVisible();
			// 当前在写作区：写作条目带当前态。
			await expect(
				dialog.getByRole("option", { name: /写作/ }).first(),
			).toHaveAttribute("aria-current", "true");
			await dialog.getByRole("option", { name: /规划 › 伏笔追踪/ }).click();
			await expectStripActive(page, "规划", "伏笔追踪");

			await page.getByRole("button", { name: /⌘K 命令/ }).click();
			await expect(
				page
					.getByRole("dialog", { name: "命令面板" })
					.getByRole("option", { name: /规划 › 伏笔追踪/ }),
			).toHaveAttribute("aria-current", "true");
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
}

/** 800×600 专属：折叠栏直接提供五区图标入口，键盘可完成切换（验收 5）。 */
test.describe("800×600 折叠导航", () => {
	test.use({ viewport: { width: 800, height: 600 } });

	test("折叠栏五区图标键盘可达且带当前态", async ({ page }, testInfo) => {
		const dir = await openProject(page, "折叠-窄窗");
		try {
			const nav = page.getByRole("complementary", { name: "导航侧栏" });
			// 窄窗自动折叠：五区以图标按钮直达，无需先展开侧栏。
			for (const label of AREA_LABELS) {
				await expect(
					nav.getByRole("button", { name: label, exact: true }),
				).toBeVisible();
			}
			// 键盘：Tab 到「规划」图标 → Enter → 规划区激活且图标带当前态。
			await nav.getByRole("button", { name: "规划", exact: true }).focus();
			await page.keyboard.press("Enter");
			await expect(
				nav.getByRole("button", { name: "规划", exact: true }),
			).toHaveAttribute("aria-current", "page");
			await expect(page.getByText("章节大纲").first()).toBeVisible();
			await expectNoPageHorizontalScroll(page);
			const foldedShot = "test-results/documentation/wf5-shell-folded-nav.png";
			await page.screenshot({ path: foldedShot, fullPage: true });
			await testInfo.attach("folded-nav-keyboard", { path: foldedShot });
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
});

async function navTo(page: Page, label: string): Promise<void> {
	await page
		.getByRole("complementary", { name: "导航侧栏" })
		.getByRole("button", { name: label, exact: true })
		.click();
}

function stripButton(page: Page, area: string, sub: string) {
	return page
		.getByRole("navigation", { name: `${area}子区` })
		.getByRole("button", { name: sub });
}

async function expectStripActive(
	page: Page,
	area: string,
	sub: string | null,
): Promise<void> {
	const nav = page.getByRole("complementary", { name: "导航侧栏" });
	await expect(
		nav.getByRole("button", { name: area, exact: true }),
	).toHaveAttribute("aria-current", "page");
	if (sub) {
		await expect(stripButton(page, area, sub)).toHaveAttribute(
			"aria-current",
			"page",
		);
	}
}
