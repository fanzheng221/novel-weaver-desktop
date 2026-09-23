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
 * WF5-06：专注写作台生产实现。每条用例经真实本地 RPC（书架投影 →
 * 写作台目录合并 → 纸面/草稿）在双视口下验证：默认落点、左栏三层
 * 定位、真实下一步、调宽偏好与按需工具；台账/规划摘要/关系切片移出。
 */

async function seedScene(
	page: Page,
	dir: string,
	options: { title: string; markdown: string; storyOrder: number },
): Promise<void> {
	const candidate = await coreRequest<{
		proposalId: string;
		sceneVersionId: string;
	}>(page, dir, "create_scene_candidate", {
		title: options.title,
		markdown: options.markdown,
		narrativeMode: "third_person_limited",
		viewpointCharacterId: "CHAR-LIN",
		continuityId: "main",
		storyOrder: options.storyOrder,
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

async function seedArtifact(
	page: Page,
	dir: string,
	kind: string,
	title: string,
	content: Record<string, unknown>,
): Promise<string> {
	const proposal = await coreRequest<{
		artifactId: string;
		proposalId: string;
	}>(page, dir, "create_artifact_proposal", { kind, title, content });
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: proposal.proposalId,
		expectedRevision: 1,
	});
	return proposal.artifactId;
}

/** 播种「卷 → 章 → 两场」完整层级：一场已成正文，一场只有计划。 */
async function seedHierarchy(page: Page, dir: string): Promise<void> {
	const planA = await seedArtifact(page, dir, "scene_plan", "雨夜来客", {
		purpose: "开场：钥匙易手",
		continuityId: "main",
		storyOrder: 10,
	});
	const planB = await seedArtifact(page, dir, "scene_plan", "桥上追击", {
		purpose: "追击与第一次交锋",
		continuityId: "main",
		storyOrder: 20,
	});
	const chapter = await seedArtifact(
		page,
		dir,
		"chapter_plan",
		"第 1 章 雨夜",
		{
			purpose: "雨夜起笔",
			sceneIds: [planA, planB],
		},
	);
	await seedArtifact(page, dir, "volume_plan", "第一卷 雾城", {
		goal: "钥匙之谜",
		chapterIds: [chapter],
	});
	await seedScene(page, dir, {
		title: "雨夜来客",
		markdown: "林舟在雨夜迎来第一位客人。",
		storyOrder: 10,
	});
}

function shelfCard(page: Page, name: string) {
	return page.getByRole("article", { name: `书籍：${name}` });
}

async function openPlain(page: Page, name: string): Promise<void> {
	const card = shelfCard(page, name);
	await expect(card.getByRole("button", { name: "打开书籍" })).toHaveCount(1);
	await card.getByRole("button", { name: "打开书籍" }).click();
	await expect(page.getByRole("banner")).toBeVisible();
}

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runWritingSuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runWritingSuite("compact");
});

function runWritingSuite(profile: string): void {
	/**
	 * 验收 1：打开项目默认选中 resume target；左栏三层定位；
	 * 中央只突出正文与当前任务；台账/规划摘要/关系切片移出默认态。
	 * 无本地记忆时 resume target = 首个未写场景计划（WF5-05 选择序）；
	 * 选中正典场景后书架主操作随之点名该场景。
	 */
	test(`[${profile}] 默认落点与专注默认态`, async ({ page }, testInfo) => {
		const dir = await createTempProject(page, { name: `写作-${profile}` });
		try {
			await seedHierarchy(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await page.goto("/");
			await shelfCard(page, `写作-${profile}`)
				.getByRole("button", { name: "开始写作：桥上追击" })
				.click();
			await expect(page.getByRole("banner")).toBeVisible();

			const rail = page.getByRole("navigation", { name: "章节与场景" });
			await expect(rail).toBeVisible();
			await expect(rail.getByText("第一卷 雾城")).toBeVisible();
			await expect(rail.getByText("第 1 章 雨夜")).toBeVisible();
			// resume target 落在待写场景：默认选中计划行，中央是真实下一步。
			await expect(
				rail.getByRole("button", { name: /桥上追击/ }),
			).toHaveAttribute("aria-current", "true");
			await expect(page.getByText("下一步 · 待写场景")).toBeVisible();
			await expect(page.locator("textarea")).toHaveCount(0);
			// 专注默认态：台账/规划摘要/关系切片移出。
			await expect(page.getByText("项目台账")).toHaveCount(0);
			await expect(page.getByText("规划概览")).toHaveCount(0);
			await expectNoPageHorizontalScroll(page);

			// 切到已成正典的场景：任务头与纸面常驻；本地记忆随之更新。
			await rail.getByRole("button", { name: /雨夜来客/ }).click();
			await expect(page.getByText("正典只读")).toBeVisible();
			await expect(page.getByText(/本场任务/)).toBeVisible();
			await expect(page.getByText("开场：钥匙易手").first()).toBeVisible();

			await page.goto("/");
			await shelfCard(page, `写作-${profile}`)
				.getByRole("button", { name: "继续写作：雨夜来客" })
				.click();
			await expect(page.getByText("正典只读")).toBeVisible();
			await expect(
				rail.getByRole("button", { name: /雨夜来客/ }),
			).toHaveAttribute("aria-current", "true");
			if (profile === "wide") {
				await page.screenshot({
					path: "test-results/documentation/wf5-writing-default.png",
					fullPage: true,
				});
				await testInfo.attach("writing-default", {
					path: "test-results/documentation/wf5-writing-default.png",
				});
			}
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	/**
	 * 验收 2/3：调宽键盘路径与本地偏好持久化；compact 视口上限 304。
	 */
	test(`[${profile}] 左栏调宽：键盘、复位与持久化`, async ({ page }) => {
		const dir = await createTempProject(page, { name: `调宽-${profile}` });
		try {
			await seedHierarchy(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await page.goto("/");
			await shelfCard(page, `调宽-${profile}`)
				.getByRole("button", { name: "打开书籍" })
				.click();
			await expect(page.getByRole("banner")).toBeVisible();

			const resizer = page.getByRole("separator", { name: "调整章节栏宽度" });
			await expect(resizer).toBeVisible();
			const baseline = await resizer.getAttribute("aria-valuenow");
			await resizer.focus();
			await page.keyboard.press("ArrowRight");
			const widened = await resizer.getAttribute("aria-valuenow");
			expect(Number(widened)).toBeGreaterThan(Number(baseline));
			await page.keyboard.press("Home");
			await expect(resizer).toHaveAttribute("aria-valuenow", "232");

			await page.keyboard.press("ArrowRight");
			// 生产端把宽度写进本地偏好（重载恢复行为由 fixture 套件锁定）。
			await expect
				.poll(() =>
					page.evaluate(() => window.localStorage.getItem("nw-writing-nav-w")),
				)
				.toBe("244");

			// 拖拽后页面级不得出现横向滚动（双视口视觉基线）。
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	/**
	 * 验收 4：本场简报与版本历史按需打开（右面板 Tab）。
	 */
	test(`[${profile}] 按需工具：本场简报与版本历史`, async ({ page }) => {
		const dir = await createTempProject(page, { name: `简报-${profile}` });
		try {
			await seedHierarchy(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await page.goto("/");
			await shelfCard(page, `简报-${profile}`)
				.getByRole("button", { name: "打开书籍" })
				.click();
			await expect(page.getByRole("banner")).toBeVisible();
			await expect(
				page.getByRole("complementary", { name: "写作工具面板" }),
			).toHaveCount(0);

			// 打开即默认落在待写场景（待写简报）；切到正典场景后简报随选中更新。
			const rail = page.getByRole("navigation", { name: "章节与场景" });
			await expect(
				rail.getByRole("button", { name: /桥上追击/ }),
			).toHaveAttribute("aria-current", "true");
			await rail.getByRole("button", { name: /雨夜来客/ }).click();
			await expect(page.getByText("正典只读")).toBeVisible();

			await page.getByRole("button", { name: "本场简报" }).click();
			const panel = page.getByRole("complementary", { name: "写作工具面板" });
			await expect(panel).toBeVisible();
			await expect(panel.getByText("已成正文")).toBeVisible();
			await expect(panel.getByText("第一卷 雾城 › 第 1 章 雨夜")).toBeVisible();

			await page.getByRole("button", { name: "版本历史" }).click();
			await expect(panel.getByText("正典").first()).toBeVisible();
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	/**
	 * 验收 5（WF5-07 更新）：未写场景的真实下一步——计划卡两个动作都可用：
	 * 打开覆盖式 AI 助手（标题已随场景预填）；跳转章节大纲。
	 */
	test(`[${profile}] 待写场景：下一步卡预填生成并可达大纲`, async ({
		page,
	}, testInfo) => {
		const dir = await createTempProject(page, { name: `下一步-${profile}` });
		try {
			const planA = await seedArtifact(page, dir, "scene_plan", "雨夜来客", {
				purpose: "开场：钥匙易手",
				continuityId: "main",
				storyOrder: 10,
			});
			await seedArtifact(page, dir, "chapter_plan", "第 1 章 雨夜", {
				purpose: "雨夜起笔",
				sceneIds: [planA],
			});
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await page.goto("/");
			await openPlain(page, `下一步-${profile}`);

			await expect(page.getByText("下一步 · 待写场景")).toBeVisible();
			await expect(
				page.getByRole("heading", { name: "雨夜来客" }),
			).toBeVisible();
			await expect(page.locator("textarea")).toHaveCount(0);
			if (profile === "wide") {
				await page.screenshot({
					path: "test-results/documentation/wf5-writing-next-step.png",
					fullPage: true,
				});
				await testInfo.attach("writing-next-step", {
					path: "test-results/documentation/wf5-writing-next-step.png",
				});
			}

			await page.getByRole("button", { name: "为此场景生成候选" }).click();
			const drawer = page.getByRole("complementary", { name: "AI 助手" });
			await expect(drawer).toBeVisible();
			await expect(drawer.getByLabel("场景标题")).toHaveValue("雨夜来客");

			// 作者路径：Esc 关抽屉（焦点归还），下一步卡仍指向章节大纲。
			await page.keyboard.press("Escape");
			await expect(drawer).toHaveCount(0);
			await page.getByRole("button", { name: "查看章节大纲" }).click();
			await expect(
				page.getByRole("heading", { name: "大纲工作区" }),
			).toBeVisible();

			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
}
