import { expect, type Page } from "@playwright/test";

import {
	configureSession,
	coreRequest,
	createTempProject,
	disposeTempProjectDir,
	expectNoPageHorizontalScroll,
	rpcLog,
	test,
} from "./helpers/author-app";

/**
 * WF5-05：启动页回答「接下来写什么」。每条用例的断言都经真实核心投影
 * get_resume_target + 本地续写记忆（localStorage），跨会话用新标签页验证：
 * 同一浏览器上下文里 localStorage 共享、sessionStorage 每页独立。
 */

interface SeedSceneOptions {
	title: string;
	markdown: string;
	storyOrder: number;
}

async function seedScene(
	page: Page,
	dir: string,
	options: SeedSceneOptions,
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
): Promise<void> {
	const proposal = await coreRequest<{ proposalId: string }>(
		page,
		dir,
		"create_artifact_proposal",
		{ kind, title, content },
	);
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: proposal.proposalId,
		expectedRevision: 1,
	});
}

function shelfCard(page: Page, name: string) {
	return page.getByRole("article", { name: `书籍：${name}` });
}

async function openPlain(page: Page, name: string): Promise<void> {
	const card = shelfCard(page, name);
	// 投影就绪前主操作也临时叫「打开书籍」；等它分化成续写目标后再点普通打开。
	await expect(card.getByRole("button", { name: "打开书籍" })).toHaveCount(1);
	await card.getByRole("button", { name: "打开书籍" }).click();
	await expect(page.getByRole("banner")).toBeVisible();
}

async function gotoShelf(page: Page, dir: string): Promise<void> {
	await configureSession(page, { defaultCwd: dir, fault: "none" });
	await page.goto("/");
}

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runResumeSuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runResumeSuite("compact");
});

function runResumeSuite(profile: string): void {
	/**
	 * WF5-05 验收 1：本地记忆场景 → 主操作「继续写作：场景名」，
	 * 打开后直接选中该场景；跨会话（新标签页）依旧成立。
	 */
	test(`[${profile}] 继续写作：卡主操作恢复上次编辑场景`, async ({
		page,
	}, testInfo) => {
		const dir = await createTempProject(page, { name: `续写-${profile}` });
		try {
			await seedScene(page, dir, {
				title: "雾中来客",
				markdown: "林舟在雾中接过苏晚递来的唯一钥匙。",
				storyOrder: 10,
			});
			await gotoShelf(page, dir);

			// 先普通打开并选中场景，留下本地续写记忆。
			await openPlain(page, `续写-${profile}`);
			await page
				.getByRole("button", { name: /雾中来客/ })
				.first()
				.click();
			await expect(page.getByText("正典只读")).toBeVisible();

			// 真实投影证据：书架卡片确实经 get_resume_target 计算主操作。
			const log = await rpcLog(page);
			expect(
				log.some(
					(entry) => entry.args?.request?.method === "get_resume_target",
				),
				"书架必须发出 get_resume_target 投影",
			).toBe(true);

			// 新标签页 = 跨会话：sessionStorage 清空，localStorage 续写记忆仍在。
			const page2 = await page.context().newPage();
			try {
				await gotoShelf(page2, dir);
				const primary = shelfCard(page2, `续写-${profile}`).getByRole(
					"button",
					{
						name: "继续写作：雾中来客",
					},
				);
				await expect(primary).toBeVisible();
				// 目检证据：卡片主操作即续写目标（WF5-05）。
				if (profile === "wide") {
					await page2.screenshot({
						path: "test-results/documentation/wf5-resume-shelf.png",
						fullPage: true,
					});
					await testInfo.attach("resume-shelf", {
						path: "test-results/documentation/wf5-resume-shelf.png",
					});
				}
				await primary.click();
				await expect(page2.getByText("正典只读")).toBeVisible();
				await expectNoPageHorizontalScroll(page2);
				if (profile === "wide") {
					await page2.screenshot({
						path: "test-results/documentation/wf5-resume-landing.png",
						fullPage: true,
					});
					await testInfo.attach("resume-landing", {
						path: "test-results/documentation/wf5-resume-landing.png",
					});
				}
			} finally {
				await page2.close();
			}
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	/**
	 * WF5-05 验收 1（草稿）：有基线一致的本地草稿时，继续写作直接回到草稿态。
	 */
	test(`[${profile}] 继续写作：自动恢复未提交草稿`, async ({ page }) => {
		const dir = await createTempProject(page, { name: `草稿-${profile}` });
		try {
			await seedScene(page, dir, {
				title: "雾中来客",
				markdown: "林舟在雾中接过苏晚递来的唯一钥匙。",
				storyOrder: 10,
			});
			await gotoShelf(page, dir);
			await openPlain(page, `草稿-${profile}`);
			await page
				.getByRole("button", { name: /雾中来客/ })
				.first()
				.click();
			await page.getByRole("button", { name: "以此场景为基写新候选" }).click();
			const draftBox = page.locator("textarea");
			await expect(draftBox).toBeVisible();
			await draftBox.fill("林舟在雾中接过钥匙，指尖却先一步冰凉。");

			// 900ms 防抖自动保存：轮询本地草稿键真实落盘。
			await expect
				.poll(() =>
					page.evaluate((cwd) => {
						const sceneId = window.localStorage.getItem(
							`nw-resume-scene:${cwd}`,
						);
						return sceneId
							? window.localStorage.getItem(`nw-draft:${cwd}:${sceneId}`)
							: null;
					}, dir),
				)
				.not.toBeNull();

			const page2 = await page.context().newPage();
			try {
				await gotoShelf(page2, dir);
				await shelfCard(page2, `草稿-${profile}`)
					.getByRole("button", { name: "继续写作：雾中来客" })
					.click();
				await expect(page2.getByText(/已恢复上次草稿/)).toBeVisible();
				await expect(page2.locator("textarea")).toHaveValue(
					"林舟在雾中接过钥匙，指尖却先一步冰凉。",
				);
			} finally {
				await page2.close();
			}
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	/**
	 * WF5-05 验收 1（滚动）：重开应用回到上次写作位置。
	 */
	test(`[${profile}] 继续写作：跨会话恢复写作区滚动位置`, async ({ page }) => {
		const dir = await createTempProject(page, { name: `滚动-${profile}` });
		try {
			const longProse = Array.from(
				{ length: 60 },
				(_, index) => `${index + 1}. 雨点敲打着屋檐，林舟数着更声。`,
			).join("\n\n");
			await seedScene(page, dir, {
				title: "长夜",
				markdown: longProse,
				storyOrder: 10,
			});
			await gotoShelf(page, dir);
			await openPlain(page, `滚动-${profile}`);
			await page.getByRole("button", { name: /长夜/ }).first().click();
			await expect(page.getByText("正典只读")).toBeVisible();

			const main = page.getByRole("main").first();
			await main.evaluate((el) => {
				el.scrollTop = el.scrollHeight;
			});
			const saved = await main.evaluate((el) => el.scrollTop);
			expect(saved).toBeGreaterThan(0);
			// 滚动持久化走 250ms 防抖：等真实落盘再开新页。
			await expect
				.poll(() =>
					page.evaluate(
						(cwd) => window.localStorage.getItem(`nw-resume-scroll:${cwd}`),
						dir,
					),
				)
				.not.toBeNull();

			const page2 = await page.context().newPage();
			try {
				await gotoShelf(page2, dir);
				await shelfCard(page2, `滚动-${profile}`)
					.getByRole("button", { name: "继续写作：长夜" })
					.click();
				const main2 = page2.getByRole("main").first();
				await expect
					.poll(() => main2.evaluate((el) => el.scrollTop), { timeout: 5000 })
					.toBeGreaterThanOrEqual(saved - 10);
			} finally {
				await page2.close();
			}
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	/**
	 * WF5-05 验收 2：有总纲零章 → 规划章节，不落误导性空编辑器。
	 */
	test(`[${profile}] 有总纲零章：主操作导向规划章节`, async ({ page }) => {
		const dir = await createTempProject(page, { name: `总纲-${profile}` });
		try {
			await seedArtifact(page, dir, "outline", "第一卷大纲", {
				goal: "钥匙之谜浮出水面。",
				acts: ["雨夜来客"],
			});
			await gotoShelf(page, dir);
			await shelfCard(page, `总纲-${profile}`)
				.getByRole("button", { name: "根据总纲规划章节" })
				.click();
			await expect(
				page
					.getByRole("navigation", { name: "规划子区" })
					.getByRole("button", { name: "章节大纲" }),
			).toHaveAttribute("aria-current", "page");
			await expect(
				page.getByRole("heading", { name: "大纲工作区" }),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	/**
	 * WF5-05 验收 3：有章节、场景计划未写成 → 主操作点名该场景。
	 */
	test(`[${profile}] 有章节未写场景：主操作为开始写作该场景`, async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: `开写-${profile}` });
		try {
			await seedArtifact(page, dir, "chapter_plan", "第 1 章 雨夜", {
				purpose: "开场",
				sceneIds: [],
			});
			await seedArtifact(page, dir, "scene_plan", "雨夜来客", {
				purpose: "开场",
				continuityId: "main",
				storyOrder: 10,
			});
			await gotoShelf(page, dir);
			await shelfCard(page, `开写-${profile}`)
				.getByRole("button", { name: "开始写作：雨夜来客" })
				.click();
			// WF5-06：真实下一步卡取代假纸面——计划点名、任务与动作可见，无 textarea。
			await expect(page.getByText("下一步 · 待写场景")).toBeVisible();
			await expect(
				page.getByRole("heading", { name: "雨夜来客" }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "为此场景生成候选" }),
			).toBeVisible();
			await expect(page.locator("textarea")).toHaveCount(0);
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	/**
	 * WF5-05 验收 4：完全空项目 → 规划起点并解释第一步。
	 */
	test(`[${profile}] 空项目：主操作进入规划起点并解释第一步`, async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: `白纸-${profile}` });
		try {
			await gotoShelf(page, dir);
			const card = shelfCard(page, `白纸-${profile}`);
			await expect(
				card.getByRole("button", { name: "从总纲开始规划" }),
			).toBeVisible();
			await expect(
				card.getByText("从规划起步：先立总纲，再分幕排章节。"),
			).toBeVisible();
			await card.getByRole("button", { name: "从总纲开始规划" }).click();
			await expect(page.getByText("大纲还是空的")).toBeVisible();
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	/**
	 * WF5-05 验收 5：无本地记忆时确定性兜底——从故事前沿继续。
	 */
	test(`[${profile}] 无本地记忆：确定性回落到故事前沿场景`, async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: `前沿-${profile}` });
		try {
			await seedScene(page, dir, {
				title: "雾中来客",
				markdown: "林舟在雾中接过苏晚递来的唯一钥匙。",
				storyOrder: 10,
			});
			await seedScene(page, dir, {
				title: "桥上追击",
				markdown: "苏晚握紧钥匙，桥头的人影却先一步动了。",
				storyOrder: 20,
			});
			await gotoShelf(page, dir);
			// 全新浏览器上下文没有本地续写记忆：确定性落到最大 storyOrder 场景。
			await shelfCard(page, `前沿-${profile}`)
				.getByRole("button", { name: "继续写作：桥上追击" })
				.click();
			await expect(page.getByText("序20 · 正典只读")).toBeVisible();
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
}
