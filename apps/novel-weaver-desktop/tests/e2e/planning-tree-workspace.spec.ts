import { expect } from "@playwright/test";

import {
	configureSession,
	coreRequest,
	createTempProject,
	disposeTempProjectDir,
	expectNoPageHorizontalScroll,
	test,
} from "./helpers/author-app";

interface ArtifactResult {
	artifactId: string;
	proposalId: string;
	revision: number;
}

/** 进程外播种：真实 create_artifact_proposal + approve_proposal。 */
async function seedArtifact(
	page: import("@playwright/test").Page,
	dir: string,
	input: Record<string, unknown>,
): Promise<string> {
	const result = await coreRequest<ArtifactResult>(
		page,
		dir,
		"create_artifact_proposal",
		input,
	);
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: result.proposalId,
		expectedRevision: result.revision,
	});
	return result.artifactId;
}

async function seedPlanningWorld(
	page: import("@playwright/test").Page,
	dir: string,
): Promise<void> {
	// 人物（带 UUID 形态 ID，用于验证「名称选择、UUID 只在高级详情」）。
	const design = await coreRequest<{ proposalId: string; revision: number }>(
		page,
		dir,
		"create_design_proposal",
		{
			entities: [
				{
					id: "a2f1c9de-1111-2222-3333-444455556666",
					type: "character",
					canonicalName: "角色甲",
					description: "本书主角",
				},
			],
		},
	);
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: design.proposalId,
		expectedRevision: design.revision,
	});
	const outlineId = await seedArtifact(page, dir, {
		kind: "outline",
		title: "示例城总纲",
		content: { goal: "揭开示例城旧案", acts: ["身世揭开一角"] },
	});
	const sceneId = await seedArtifact(page, dir, {
		kind: "scene_plan",
		title: "城门初见",
		dependencyIds: [outlineId],
		content: {
			purpose: "与旧识重逢",
			storyOrder: 10,
			viewpointCharacterId: "a2f1c9de-1111-2222-3333-444455556666",
		},
	});
	const ch1Id = await seedArtifact(page, dir, {
		kind: "chapter_plan",
		title: "第一章 · 归城",
		dependencyIds: [outlineId],
		content: {
			purpose: "主角回到示例城",
			targetWords: 3000,
			characterIds: ["a2f1c9de-1111-2222-3333-444455556666"],
			sceneIds: [sceneId],
		},
	});
	const ch2Id = await seedArtifact(page, dir, {
		kind: "chapter_plan",
		title: "第二章 · 旧档",
		dependencyIds: [outlineId],
		content: { purpose: "翻出旧案档案" },
	});
	await seedArtifact(page, dir, {
		kind: "volume_plan",
		title: "第一卷",
		dependencyIds: [outlineId],
		content: { goal: "立足示例城", chapterIds: [ch1Id, ch2Id] },
	});
}

async function openOutline(
	page: import("@playwright/test").Page,
	bookName: string,
): Promise<void> {
	await page.goto("/");
	// 精确书名：书架可能残留此前用例的书卡，正则会撞 strict mode。
	await page
		.getByRole("article", { name: `书籍：${bookName}` })
		.getByRole("button", { name: "打开书籍" })
		.click();
	await expect(page.getByRole("banner")).toBeVisible();
	await page.evaluate(() => {
		window.location.hash = "#/outline";
	});
	await expect(page.getByRole("heading", { name: "大纲工作区" })).toBeVisible();
}

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runPlanningTreeSuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runPlanningTreeSuite("compact");
});

function runPlanningTreeSuite(profile: string): void {
	test(`[${profile}] 树优先：层级/状态/名称选择/抽屉确认纳入/按需看板`, async ({
		page,
	}, testInfo) => {
		const dir = await createTempProject(page, { name: `规划-${profile}` });
		try {
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await seedPlanningWorld(page, dir);
			await openOutline(page, `规划-${profile}`);

			// 用例 2：默认树展示层级与状态；章行有阶段点与场景计数。
			await expect(
				page.getByText("卷章结构 · 2 章", { exact: true }),
			).toBeVisible();
			// 树里的层级是按钮；详情面板的「依赖工件」会复述名称，避免 getByText 撞重复。
			await expect(
				page.getByRole("button", { name: "示例城总纲" }),
			).toBeVisible();
			await expect(page.getByRole("button", { name: "第一卷" })).toBeVisible();
			await expect(
				page.getByRole("button", { name: /第二章 · 旧档/ }),
			).toBeVisible();
			// 场景同时挂在章下与「其他规划工件」列表里，取首个即可。
			await expect(
				page.getByText("城门初见", { exact: true }).first(),
			).toBeVisible();
			await expect(page.getByText("POV · 角色甲").first()).toBeVisible();
			await expectNoPageHorizontalScroll(page);

			// 用例 4：默认视口无 UUID 裸串——ID 只在高级详情。
			await expect(
				page.getByText(/a2f1c9de-1111/).and(page.locator("main")),
			).toHaveCount(0);

			// 用例 3：章抽屉「编辑→预览影响→确认纳入」连续流，不跳页。
			await page.getByRole("button", { name: /第一章 · 归城/ }).click();
			const drawer = page.getByRole("dialog", { name: "编辑本章大纲" });
			await expect(drawer).toBeVisible();
			await drawer.getByLabel("核心事件一句话").fill("主角深夜回到示例城");
			await drawer.getByRole("button", { name: "提交修订提案" }).click();
			const confirm = drawer.getByTestId("proposal-confirm");
			await expect(confirm).toContainText("待确认更改：第一章 · 归城");
			await expect(confirm).toContainText(
				"本章目的: 主角回到示例城 → 主角深夜回到示例城",
			);
			// 涉及人物是名称芯片，不是 UUID。
			await expect(drawer.getByText(/a2f1c9de-1111/)).toHaveCount(0);
			await confirm.getByRole("button", { name: "确认纳入" }).click();
			await expect(
				page.getByText(/「第一章 · 归城」的修订已纳入规划/),
			).toBeVisible();
			const graphAfter = await coreRequest<{
				nodes: { id: string; content: { purpose?: string } }[];
			}>(page, dir, "planning_graph_query");
			expect(
				graphAfter.nodes.find(
					(node) => node.content.purpose === "主角深夜回到示例城",
				),
			).toBeTruthy();

			// 用例 3 变体已在 outline-proposal-p0 覆盖（稍后再说）。

			// 用例 4：场景详情人话字段 + JSON 只在高级详情。
			await page.getByRole("button", { name: "城门初见", exact: true }).click();
			const details = page.getByTestId("node-details");
			await expect(details).toContainText("叙事目的");
			await expect(details).toContainText("与旧识重逢");
			// 折叠的「高级 · 原始数据」JSON 仍在 DOM，但不可见——按可见文本断言。
			await expect(
				details.getByText(/a2f1c9de-1111/).filter({ visible: true }),
			).toHaveCount(0);
			await details.getByText("高级 · 原始数据").click();
			await expect(details.getByText(/a2f1c9de-1111/).first()).toBeVisible();
			await page.getByRole("button", { name: "关闭详情" }).click();

			// 用例 5：看板作为可选进度视图；切换保留数据。
			await page.getByRole("button", { name: "看板" }).click();
			await expect(
				page.getByText("第一章 · 归城", { exact: true }).first(),
			).toBeVisible();
			await page.getByRole("button", { name: "树状" }).click();
			await expect(
				page.getByRole("button", { name: /第一章 · 归城/ }),
			).toBeVisible();
			await testInfo.attach("planning-tree", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test(`[${profile}] 拆章成功：预览可改→逐条纳入→选中新建第一章`, async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: `拆章-${profile}` });
		try {
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			const outlineId = await seedArtifact(page, dir, {
				kind: "outline",
				title: "示例城总纲",
				content: {
					goal: "揭开示例城旧案",
					acts: ["主角回到示例城，重逢旧识。", "翻出旧案档案，遭遇追踪。"],
				},
			});
			await openOutline(page, `拆章-${profile}`);

			// 用例 1：有纲零章唯一主操作。
			await expect(page.getByTestId("outline-summary")).toBeVisible();
			await page.getByRole("button", { name: "根据总纲拆分章节" }).click();

			// 编辑指令（预填自总纲分幕）→ 预览。
			const dialog = page.getByRole("dialog", { name: "根据总纲拆分章节" });
			await expect(dialog.getByRole("textbox").first()).toContainText(
				"主角回到示例城，重逢旧识。",
			);
			await dialog.getByRole("button", { name: "生成拆章预览" }).click();
			// 预览标题在可编辑输入框里，断言取 value 而非文本。
			await expect(dialog.getByLabel("章节标题").first()).toHaveValue(
				"第1章 · 主角回到示例城",
			);
			await expect(dialog.getByLabel("章节标题").nth(1)).toHaveValue(
				"第2章 · 翻出旧案档案",
			);

			// 确认拆章：逐条 create+approve 纳入。
			await dialog.getByRole("button", { name: "确认拆章" }).click();
			await expect(dialog.getByText(/拆章完成：2 章已纳入规划/)).toBeVisible();
			await dialog.getByRole("button", { name: "完成" }).click();

			// 用例 6：成功后直接选中新建第一章（抽屉打开且标题正确）。
			const drawer = page.getByRole("dialog", { name: "编辑本章大纲" });
			await expect(drawer).toBeVisible();
			await expect(drawer.getByLabel("章节标题")).toHaveValue(
				"第1章 · 主角回到示例城",
			);
			await drawer.getByRole("button", { name: "关闭" }).click();

			// 进程外读回：两个章节计划、依赖指向总纲、无遗留待审提案。
			const graph = await coreRequest<{
				nodes: {
					id: string;
					kind: string;
					title: string;
					content: { storyOrder?: number };
				}[];
				edges: { sourceId: string; targetId: string }[];
			}>(page, dir, "planning_graph_query");
			const chapters = graph.nodes.filter(
				(node) => node.kind === "chapter_plan",
			);
			expect(chapters).toHaveLength(2);
			const chapterIds = new Set(chapters.map((chapter) => chapter.id));
			for (const edge of graph.edges) {
				if (chapterIds.has(edge.sourceId)) {
					expect(edge.targetId).toBe(outlineId);
				}
			}
			await expect(page.getByText("没有待审的工件提案。")).toBeVisible();
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test(`[${profile}] 拆章失败恢复：指令保留、重试对账不重复建章`, async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: `拆障-${profile}` });
		try {
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await seedArtifact(page, dir, {
				kind: "outline",
				title: "示例城总纲",
				content: {
					goal: "揭开示例城旧案",
					acts: ["主角回到示例城。", "翻出旧案档案。"],
				},
			});
			await openOutline(page, `拆障-${profile}`);
			await page.getByRole("button", { name: "根据总纲拆分章节" }).click();
			const dialog = page.getByRole("dialog", { name: "根据总纲拆分章节" });
			await dialog.getByRole("button", { name: "生成拆章预览" }).click();

			// 注入 rpc_down：第一条 create 失败即停，指令与进度保留。
			await configureSession(page, { fault: "rpc_down" });
			await dialog.getByRole("button", { name: "确认拆章" }).click();
			await expect(page.getByRole("alert").first()).toContainText(
				"拆章没有全部完成",
			);
			await expect(dialog.getByText(/你的拆章指令已保留/)).toBeVisible();
			await expect(dialog.getByText("第1章 · 主角回到示例城")).toBeVisible();

			// 清除故障重试：对账后续跑，绝不重复建章。
			await configureSession(page, { fault: "none" });
			await dialog.getByRole("button", { name: "重试拆章" }).click();
			await expect(dialog.getByText(/拆章完成：2 章已纳入规划/)).toBeVisible();
			await dialog.getByRole("button", { name: "完成" }).click();
			await page
				.getByRole("dialog", { name: "编辑本章大纲" })
				.getByRole("button", { name: "关闭" })
				.click();

			const graph = await coreRequest<{
				nodes: { kind: string; title: string }[];
			}>(page, dir, "planning_graph_query");
			const titles = graph.nodes
				.filter((node) => node.kind === "chapter_plan")
				.map((node) => node.title);
			expect(titles).toHaveLength(2);
			expect(new Set(titles).size).toBe(2);
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
}
