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
 * WF5-09：生成后双稿比较与作者裁决。全部经真实链路——浏览器 invoke 垫片 →
 * /__nw/local-rpc → 真实 local-core 进程 → SQLite；补全内容由
 * NW_COMPLETION_FIXTURE 按 userPrompt 标记串脚本化（真实装配、真实落库，
 * 只替换模型调用层）。覆盖：生成即双稿、放弃零副作用、局部采用全环、
 * 全文采用可追溯、stale 禁用与解释、800×600 决策栏与键盘等价。
 */

const BASE_TEXT = [
	"林舟在雾中看清了来人的脸。",
	"他按刀未动，先听风声。来人停在五步之外。",
	"灯笼的光被雾水洇开，照不亮对方的眼睛。",
].join("\n\n");

function drawer(page: Page) {
	return page.getByRole("complementary", { name: "AI 助手" });
}

function dualView(page: Page) {
	// 视图容器 label 形如「双稿裁决：雾中来客」；决策栏 toolbar 叫「双稿裁决」，
	// 用冒号前缀区分两者。
	return page.locator('div[aria-label^="双稿裁决："]');
}

async function seedProject(page: Page, dir: string): Promise<string> {
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
			entities: [
				{
					id: "CHAR-LIN",
					type: "character",
					canonicalName: "林舟",
					description: "漕帮少主。",
					attributes: {},
				},
			],
			characterAttitudes: [],
		},
	);
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: design.proposalId,
		expectedRevision: 1,
	});
	const seedCanonical = async (
		title: string,
		storyOrder: number,
		markdown: string,
	) => {
		const candidate = await coreRequest<{
			proposalId: string;
			sceneVersionId: string;
		}>(page, dir, "create_scene_candidate", {
			title,
			markdown,
			narrativeMode: "third_person_limited",
			viewpointCharacterId: "CHAR-LIN",
			continuityId: "main",
			storyOrder,
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
	};
	await seedCanonical("雾夜灯塔", 5, "雾夜灯塔：苏晚把灯挑亮了一分。");
	await seedCanonical("雾中来客", 10, BASE_TEXT);
	const scenes = await coreRequest<Array<{ sceneId: string; title: string }>>(
		page,
		dir,
		"list_canonical_scenes",
	);
	const target = scenes.find((scene) => scene.title === "雾中来客");
	if (!target) throw new Error("seed 后未找到场景「雾中来客」");
	return target.sceneId;
}

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

async function openBook(page: Page, name: string): Promise<void> {
	await seedByokFixture(page);
	await page.goto("/");
	await page
		.getByRole("article", { name: `书籍：${name}` })
		.getByRole("button", { name: "打开书籍" })
		.click();
	await expect(page.getByRole("banner")).toBeVisible();
	// 选中目标场景并等正典只读就位（prose 快照含版本号后双稿门禁才放行）。
	await page
		.getByRole("button", { name: /雾中来客/ })
		.first()
		.click();
	await expect(page.getByText("正典只读")).toBeVisible();
}

/** 生成到双稿：真实装配＋脚本化补全；成功后助手关闭、写作区原位切双稿。 */
async function generateToDual(page: Page, marker: string): Promise<void> {
	await page
		.getByRole("banner")
		.getByRole("button", { name: /AI 助手/ })
		.click();
	const panel = drawer(page);
	await expect(panel).toBeVisible();
	await panel
		.getByRole("textbox", { name: /你希望这次推进什么/ })
		.fill(`强化雾中相遇的张力。${marker}`);
	await panel.getByRole("button", { name: "生成场景候选" }).click();
	// 验收 1：生成成功后助手自动关闭，写作区原位切双稿。
	await expect(panel).toHaveCount(0);
	await expect(dualView(page)).toBeVisible();
}

async function versionCount(
	page: Page,
	dir: string,
	sceneId: string,
): Promise<number> {
	const versions = await coreRequest<unknown[]>(
		page,
		dir,
		"list_scene_versions",
		{
			sceneId,
		},
	);
	return versions.length;
}

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });

	test("生成成功→双稿现，来源基线可见", async ({ page }, testInfo) => {
		const dir = await createTempProject(page, { name: "双稿-生成" });
		try {
			await seedProject(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await openBook(page, "双稿-生成");
			await generateToDual(page, "E2E-DUAL-SCORE");

			const dual = dualView(page);
			// 焦点条：任务、基线状态、已选计数可见。
			await expect(dual.getByText("基线未过期")).toBeVisible();
			await expect(dual.getByText("已选 0 处采用")).toBeVisible();
			// 左栏：我的正文与基线来源说明；确认前不会改动。
			await expect(dual.getByText(/确认前不会改动/)).toBeVisible();
			// 中栏：差异句段卡来自真实补全（第二段句变＋第三段整段替换）。
			await expect(
				dual.locator("label").filter({ hasText: "腰间玉核微微发烫" }),
			).toHaveCount(1);
			await expect(
				dual.locator("label").filter({ hasText: "夜风卷着雾水扑上灯罩" }),
			).toHaveCount(1);
			await expectNoPageHorizontalScroll(page);

			if (testInfo.project.name === "chromium") {
				await page.screenshot({
					path: "test-results/documentation/wf5-dual-draft-adjudication.png",
					fullPage: true,
				});
				await testInfo.attach("dual-draft", {
					path: "test-results/documentation/wf5-dual-draft-adjudication.png",
				});
			}
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test("放弃候选：恢复单稿、零版本副作用、候选不留痕", async ({ page }) => {
		const dir = await createTempProject(page, { name: "双稿-放弃" });
		try {
			const sceneId = await seedProject(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await openBook(page, "双稿-放弃");
			await generateToDual(page, "E2E-DUAL-SCORE");

			const before = await versionCount(page, dir, sceneId);
			await dualView(page).getByRole("button", { name: "放弃候选" }).click();
			await expect(dualView(page)).toHaveCount(0);
			await expect(page.getByText("正典只读")).toBeVisible();

			// 零版本副作用：版本历史计数不变；正式稿原文未动。
			expect(await versionCount(page, dir, sceneId)).toBe(before);
			const canonical = await coreRequest<{ markdown: string }>(
				page,
				dir,
				"get_canonical_scene",
				{ sceneId },
			);
			expect(canonical.markdown).toBe(BASE_TEXT);

			// 候选整体移除：助手结果区不再有候选卡。
			await page
				.getByRole("banner")
				.getByRole("button", { name: /AI 助手/ })
				.click();
			await expect(drawer(page).getByText("候选 · 1")).toHaveCount(0);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test("局部采用：勾选/预览/确认成草稿，正式稿未动，撤销本次采用回双稿", async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: "双稿-局部" });
		try {
			const sceneId = await seedProject(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await openBook(page, "双稿-局部");
			await generateToDual(page, "E2E-DUAL-SCORE");

			const dual = dualView(page);
			const preview = dual.locator('section[aria-label="最终草稿预览"]');
			const card = dual
				.locator("label")
				.filter({ hasText: "腰间玉核微微发烫" });

			// 零勾选：确认禁用；预览即原稿。
			await expect(
				dual.getByRole("button", { name: "确认为新草稿" }),
			).toBeDisabled();
			await expect(preview.getByText("腰间玉核微微发烫")).toHaveCount(0);

			// 勾选 → 预览实时出现采用内容（ins 高亮）。
			await card.getByRole("checkbox").check();
			await expect(dual.getByText("已选 1 处采用")).toBeVisible();
			await expect(preview.getByText("腰间玉核微微发烫")).toHaveCount(1);

			// 确认 → 结果态；撤销本次采用 → 回比较态且勾选保留。
			await dual.getByRole("button", { name: "确认为新草稿" }).click();
			await expect(
				dual.getByText("已确认 1 处局部采用", { exact: true }),
			).toBeVisible();
			await dual.getByRole("button", { name: "撤销本次采用" }).click();
			await expect(dual.getByText("已选 1 处采用")).toBeVisible();
			await expect(card.getByRole("checkbox")).toBeChecked();

			// 再确认 → 回到正文：合并稿开手编草稿。
			await dual.getByRole("button", { name: "确认为新草稿" }).click();
			await dual.getByRole("button", { name: "回到正文继续写" }).click();
			await expect(dualView(page)).toHaveCount(0);
			const draftBox = page.locator("textarea");
			await expect(draftBox).toBeVisible();
			const draftValue = await draftBox.inputValue();
			expect(draftValue).toContain("林舟在雾中看清了来人的脸。");
			expect(draftValue).toContain("腰间玉核微微发烫");
			expect(draftValue).not.toContain("夜风卷着雾水扑上灯罩");

			// 正式稿未动、零新版本；候选已转草稿可追溯。
			const canonical = await coreRequest<{ markdown: string }>(
				page,
				dir,
				"get_canonical_scene",
				{ sceneId },
			);
			expect(canonical.markdown).toBe(BASE_TEXT);
			await page
				.getByRole("banner")
				.getByRole("button", { name: /AI 助手/ })
				.click();
			await expect(drawer(page).getByText("已转草稿")).toBeVisible();
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test("作为新草稿：候选全文开手编草稿，旧正式稿版本历史可查", async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: "双稿-全采" });
		try {
			const sceneId = await seedProject(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await openBook(page, "双稿-全采");
			const before = await versionCount(page, dir, sceneId);
			await generateToDual(page, "E2E-DUAL-SCORE");

			const dual = dualView(page);
			await dual.getByRole("button", { name: "全文采用为新草稿" }).click();
			await expect(
				dual.getByText("候选全文已作为新草稿打开", { exact: true }),
			).toBeVisible();
			await dual.getByRole("button", { name: "回到正文继续写" }).click();
			await expect(dualView(page)).toHaveCount(0);

			const draftBox = page.locator("textarea");
			await expect(draftBox).toBeVisible();
			const draftValue = await draftBox.inputValue();
			expect(draftValue).toContain("腰间玉核微微发烫");
			expect(draftValue).toContain("夜风卷着雾水扑上灯罩");

			// 草稿不产生版本；旧正式稿版本历史原样可查。
			expect(await versionCount(page, dir, sceneId)).toBe(before);
			const versions = await coreRequest<Array<{ markdown?: string }>>(
				page,
				dir,
				"list_scene_versions",
				{ sceneId },
			);
			expect(versions.length).toBeGreaterThan(0);

			await page
				.getByRole("banner")
				.getByRole("button", { name: /AI 助手/ })
				.click();
			await expect(drawer(page).getByText("已转草稿")).toBeVisible();
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test("stale：正典被外部批准位移后禁用采用并解释，放弃仍可用", async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: "双稿-stale" });
		try {
			const sceneId = await seedProject(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await openBook(page, "双稿-stale");
			await generateToDual(page, "E2E-DUAL-SCORE");

			// 第二条 RPC 链路（不经 UI）：同场景 create＋review＋approve 位移正典。
			// 候选必须以当前正典为基（sourceVersionId），否则 approve 会以
			// 「正典已位移」拒收——这正是版本安全语义的一部分。
			const current = await coreRequest<{ versionId: string }>(
				page,
				dir,
				"get_canonical_scene",
				{ sceneId },
			);
			const moved = await coreRequest<{
				proposalId: string;
				sceneVersionId: string;
			}>(page, dir, "create_scene_candidate", {
				sceneId,
				sourceVersionId: current.versionId,
				title: "雾中来客·外部修订",
				markdown: "雾散了，来人的脸属于苏晚。",
				narrativeMode: "third_person_limited",
				viewpointCharacterId: "CHAR-LIN",
				continuityId: "main",
				storyOrder: 10,
				purposes: ["推进主线"],
			});
			await coreRequest(page, dir, "record_scene_review", {
				proposalId: moved.proposalId,
				candidateVersionId: moved.sceneVersionId,
				findings: [],
			});
			await coreRequest(page, dir, "approve_proposal", {
				proposalId: moved.proposalId,
				expectedRevision: 1,
			});

			// 作者复核：打开版本历史 → ProseEditor 重取正典 → stale 判定刷新。
			await page.getByRole("button", { name: "版本历史" }).first().click();
			const dual = dualView(page);
			const bar = dual.getByText("已暂停采用与全文采用");
			await expect(bar).toBeVisible();

			// 勾选与确认全部禁用；放弃始终可用。
			await expect(
				dual.getByRole("checkbox", { name: /采用句段/ }).first(),
			).toBeDisabled();
			await expect(
				dual.getByRole("button", { name: "确认为新草稿" }),
			).toBeDisabled();
			await expect(
				dual.getByRole("button", { name: "全文采用为新草稿" }),
			).toBeDisabled();
			await expect(
				dual.getByRole("button", { name: "放弃候选" }),
			).toBeEnabled();

			// 放弃 → 恢复单稿，纸面是位移后的新正典。
			await dual.getByRole("button", { name: "放弃候选" }).click();
			await expect(dualView(page)).toHaveCount(0);
			await expect(page.getByText("雾散了，来人的脸属于苏晚。")).toBeVisible();
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });

	test("窄窗：决策栏常驻、预览转浮层、Tab+空格键盘等价、无页面横向滚动", async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: "双稿-窄窗" });
		try {
			await seedProject(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await openBook(page, "双稿-窄窗");
			await generateToDual(page, "E2E-DUAL-SCORE");

			const dual = dualView(page);
			const toolbar = dual.getByRole("toolbar", { name: "双稿裁决" });
			await expect(toolbar).toBeVisible();
			// 窄窗预览列收起为浮层，开关可见。
			await expect(
				dual.getByRole("button", { name: "结果预览" }),
			).toBeVisible();

			// 键盘等价：勾选框聚焦后空格切换，计数与浮层预览同步。
			await dual
				.locator("label")
				.filter({ hasText: "腰间玉核微微发烫" })
				.getByRole("checkbox")
				.focus();
			await page.keyboard.press("Space");
			await expect(dual.getByText("已选 1 处采用")).toBeVisible();

			await dual.getByRole("button", { name: "结果预览" }).click();
			await expect(
				dual
					.locator('section[aria-label="最终草稿预览"]')
					.getByText("腰间玉核微微发烫"),
			).toHaveCount(1);

			await expectNoPageHorizontalScroll(page);
			// 收尾：放弃恢复单稿。
			await toolbar.getByRole("button", { name: "放弃候选" }).click();
			await expect(dualView(page)).toHaveCount(0);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
});
