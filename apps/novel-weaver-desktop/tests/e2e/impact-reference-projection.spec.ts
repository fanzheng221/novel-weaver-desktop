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
 * WF5-14：被引用/会影响投影与跨页深链（真实核心进程 + 真实 SQLite）。
 * 五个详情面（规则/人物/关系/规划节点/场景）统一影响区域；影响边深链
 * 回目标对象；浏览器后退恢复原聚焦与影响展开；有引用不得显示空。
 * 400 场景性能与增删改/失效传播由 core 集成测试锁定（<100ms），
 * 这里验证桌面渲染路径按需查询、不扫全项目。
 */

interface SceneCandidate {
	sceneId: string;
	sceneVersionId: string;
	proposalId: string;
	revision: number;
}

async function approve(
	page: Page,
	dir: string,
	proposalId: string,
): Promise<void> {
	await coreRequest(page, dir, "approve_proposal", {
		proposalId,
		expectedRevision: 1,
	});
}

/** 播种：硬/软规则、三实体、正典场景（上下文包）、证据关系、三级规划与一个待确认候选。 */
async function seedImpactWorld(page: Page, dir: string): Promise<void> {
	const design = await coreRequest<{ proposalId: string }>(
		page,
		dir,
		"create_design_proposal",
		{
			hardRules: [
				{
					id: "RULE-NO-REVIVE",
					name: "人死不能复生",
					description: "本世界没有复活手段，死亡即终局。",
					examples: [],
				},
			],
			softRules: [
				{
					id: "RULE-FOG",
					name: "雾城多雾",
					description: "叙事里雾是常驻意象。",
					examples: [],
				},
			],
			entities: [
				{
					id: "CHAR-LIN",
					type: "character",
					canonicalName: "林舟",
					description: "雾城档案员。",
				},
				{
					id: "CHAR-SU",
					type: "character",
					canonicalName: "苏晚",
					description: "钟表匠之女。",
				},
				{
					id: "ENT-KEY",
					type: "item",
					canonicalName: "黄铜钥匙",
					description: "雾塔的钥匙。",
				},
			],
		},
	);
	await approve(page, dir, design.proposalId);

	// 正典场景：上下文包把硬规则带进生成基线（规则被引用的来源）。
	const context = await coreRequest<{ contextId: string }>(
		page,
		dir,
		"build_context_package",
		{
			continuityId: "main",
			storyOrder: 10,
			viewpointCharacterId: "CHAR-LIN",
			relatedEntityIds: ["CHAR-SU", "ENT-KEY"],
		},
	);
	const candidate = await coreRequest<SceneCandidate>(
		page,
		dir,
		"create_scene_candidate",
		{
			title: "雾中来客",
			markdown: "林舟在雾中接过苏晚递来的唯一钥匙。",
			narrativeMode: "third_person_limited",
			viewpointCharacterId: "CHAR-LIN",
			continuityId: "main",
			storyOrder: 10,
			purposes: ["推进钥匙线索"],
			relatedEntityIds: ["CHAR-LIN", "CHAR-SU", "ENT-KEY"],
			contextPackageId: context.contextId,
		},
	);
	await coreRequest(page, dir, "record_scene_review", {
		proposalId: candidate.proposalId,
		candidateVersionId: candidate.sceneVersionId,
		findings: [],
	});
	await approve(page, dir, candidate.proposalId);

	// 证据锚定在正典版本上的客观关系。
	const evidence = await coreRequest<{ proposalId: string }>(
		page,
		dir,
		"create_design_proposal",
		{
			objectiveRelationships: [
				{
					id: "REL-LIN-SU",
					sourceEntityId: "CHAR-LIN",
					targetEntityId: "CHAR-SU",
					relationshipType: "同伴",
					continuityId: "main",
					validFrom: 10,
					sourceSceneVersionId: candidate.sceneVersionId,
				},
			],
		},
	);
	await approve(page, dir, evidence.proposalId);

	// 规划：总纲 ← 章（编排正典场景）← 场景计划（视点林舟）。
	const outline = await coreRequest<{ artifactId: string; proposalId: string }>(
		page,
		dir,
		"create_artifact_proposal",
		{
			kind: "outline",
			title: "总纲",
			dependencyIds: [],
			content: { goal: "雾塔真相", acts: ["雾起", "雾散"] },
		},
	);
	await approve(page, dir, outline.proposalId);
	const chapter = await coreRequest<{ artifactId: string; proposalId: string }>(
		page,
		dir,
		"create_artifact_proposal",
		{
			kind: "chapter_plan",
			title: "第一章 · 雾中来客",
			dependencyIds: [outline.artifactId],
			content: {
				purpose: "交出钥匙",
				sceneIds: [candidate.sceneId],
				storyOrder: 10,
			},
		},
	);
	await approve(page, dir, chapter.proposalId);
	const plan = await coreRequest<{ artifactId: string; proposalId: string }>(
		page,
		dir,
		"create_artifact_proposal",
		{
			kind: "scene_plan",
			title: "场景计划 · 雾中来客",
			dependencyIds: [chapter.artifactId],
			content: {
				purpose: "接过钥匙",
				continuityId: "main",
				storyOrder: 10,
				viewpointCharacterId: "CHAR-LIN",
			},
		},
	);
	await approve(page, dir, plan.proposalId);

	// 待确认候选：硬规则与正典场景影响面里的「改动后需复核」。
	await coreRequest<SceneCandidate>(page, dir, "create_scene_candidate", {
		title: "码头夜雾",
		markdown: "林舟在码头追查钥匙的下落。",
		narrativeMode: "third_person_limited",
		viewpointCharacterId: "CHAR-LIN",
		continuityId: "main",
		storyOrder: 20,
		purposes: ["追查钥匙"],
	});
}

function shelfCard(page: Page, name: string) {
	return page.getByRole("article", { name: `书籍：${name}` });
}

async function openBook(page: Page, dir: string, name: string): Promise<void> {
	await configureSession(page, { defaultCwd: dir, fault: "none" });
	await page.goto("/");
	const card = shelfCard(page, name);
	// 投影就绪前主按钮回落「打开书籍」；等它分化再点，避免同名双按钮撞 strict mode。
	await expect(card.getByRole("button", { name: "打开书籍" })).toHaveCount(1);
	await card.getByRole("button", { name: "打开书籍" }).click();
	await expect(page.getByRole("banner")).toBeVisible();
}

async function openWorldSub(page: Page, sub: string): Promise<void> {
	await page
		.getByRole("complementary", { name: "导航侧栏" })
		.getByRole("button", { name: "世界", exact: true })
		.click();
	await page
		.getByRole("navigation", { name: "世界子区" })
		.getByRole("button", { name: sub })
		.click();
}

const REFERENCED_BY_LABEL = "被引用 · 既成事实里哪里用到了它";
const AFFECTS_LABEL = "会影响 · 本次改动会波及的待确认工作";

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });

	test("影响区五详情面接入：规则影响非空、深链跳转、后退恢复聚焦", async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: "影响投影-wide" });
		try {
			await seedImpactWorld(page, dir);
			await openBook(page, dir, "影响投影-wide");

			// ── 规则详情：展开「查看影响」，有引用不得显示空 ──
			await openWorldSub(page, "规则");
			const ruleCard = page.locator('[data-rule-id="RULE-NO-REVIVE"]');
			await ruleCard.getByText("查看影响").click();
			await expect(ruleCard.getByText(REFERENCED_BY_LABEL)).toBeVisible();
			// 硬规则经生成上下文被正典场景引用（人话原因 + 来源位置）。
			await expect(
				ruleCard.getByRole("button", { name: "雾中来客" }),
			).toBeVisible();
			await expect(ruleCard.getByText(/上下文/)).toBeVisible();
			// 待确认候选进入影响面，标注「改动后需复核」，不静默。
			await expect(ruleCard.getByText(AFFECTS_LABEL)).toBeVisible();
			await expect(ruleCard.getByText("待确认场景 · 码头夜雾")).toBeVisible();
			await expect(ruleCard.getByText("改动后需复核")).toBeVisible();
			// 软规则不进上下文，如实显示空态，不伪造引用。
			// （聚焦互斥：展开软卡时硬卡按 hash 聚焦语义收起，只亮一张。）
			const softCard = page.locator('[data-rule-id="RULE-FOG"]');
			await softCard.getByText("查看影响").click();
			await expect(softCard.getByText("还没有既成事实引用它。")).toBeVisible();
			await expect(
				softCard.getByText("没有待确认工作受它影响。"),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);

			// ── 深链：影响边点进目标对象（场景 → 写作台并选中该场景）──
			await ruleCard.getByText("查看影响").click();
			await ruleCard.getByRole("button", { name: "雾中来客" }).click();
			await expect(page.getByText("雾中来客序10 · 正典只读")).toBeVisible();
			await expect(page).toHaveURL(/#\/writing$/);

			// ── 后退：原规则卡聚焦恢复、影响展开保持 ──
			await page.goBack();
			await expect(page).toHaveURL(/#\/world\/rules\?focus=RULE-NO-REVIVE$/);
			const restoredCard = page.locator('[data-rule-id="RULE-NO-REVIVE"]');
			await expect(restoredCard.getByText(REFERENCED_BY_LABEL)).toBeVisible();
			await expect(
				restoredCard.getByRole("button", { name: "雾中来客" }),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);

			// ── 人物详情：影响面板列出场景与关系，关系边深链进关系工作区 ──
			await openWorldSub(page, "人物");
			await page.getByRole("button", { name: /苏晚/ }).first().click();
			// Panel 标题是 eyebrow span，不是 heading。
			const impactPanel = page.getByText("被什么引用 · 会影响什么（苏晚）");
			await expect(impactPanel).toBeVisible();
			await expect(
				page.getByRole("button", { name: "雾中来客" }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "林舟 → 苏晚（同伴）" }),
			).toBeVisible();
			await page.getByRole("button", { name: "林舟 → 苏晚（同伴）" }).click();
			await expect(page).toHaveURL(/#\/world\/relations\?focus=REL-LIN-SU$/);
			await expect(page.getByText(REFERENCED_BY_LABEL)).toBeVisible();
			// 聚焦边在时间切片内可见：故事时间被拨到关系生效章。
			await expect(
				page.getByText(/第 \d+ 章 · 客观 1 条 \/ 态度 0 条/),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);

			// ── 场景详情（本场简报）：影响区列出编排本章，深链进规划抽屉 ──
			await openWorldSub(page, "关系");
			// 从关系列表点人物节点跳写作台太绕：直接经影响区场景边回写作台。
			await page.getByRole("button", { name: "雾中来客" }).first().click();
			await expect(page.getByText("雾中来客序10 · 正典只读")).toBeVisible();
			await page.getByRole("button", { name: "本场简报" }).click();
			const briefing = page.getByRole("complementary", {
				name: "写作工具面板",
			});
			await expect(briefing.getByText(REFERENCED_BY_LABEL)).toBeVisible();
			await expect(
				briefing.getByRole("button", { name: "第一章 · 雾中来客" }),
			).toBeVisible();
			await briefing.getByRole("button", { name: "第一章 · 雾中来客" }).click();
			await expect(page).toHaveURL(/#\/planning\/outline\?focus=/);
			// 章 = 抽屉编辑；深链聚焦直接打开本章抽屉。
			await expect(
				page.getByRole("dialog", { name: "编辑本章大纲" }),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test("规划节点详情与人物深链聚焦：影响区嵌入详情面板", async ({ page }) => {
		const dir = await createTempProject(page, { name: "影响投影-规划" });
		try {
			await seedImpactWorld(page, dir);
			await openBook(page, dir, "影响投影-规划");

			// 规划工作区：总纲详情面板内嵌影响区；被引用＝依赖它的章（依赖方向如实呈现）。
			await page
				.getByRole("complementary", { name: "导航侧栏" })
				.getByRole("button", { name: "规划", exact: true })
				.click();
			await expect(page.getByText(/卷章结构 · 1 章/)).toBeVisible();
			await page
				.getByRole("button", { name: "总纲", exact: true })
				.first()
				.click();
			const details = page.getByTestId("node-details");
			await expect(details).toBeVisible();
			await expect(details.getByText(REFERENCED_BY_LABEL)).toBeVisible();
			await expect(
				details.getByRole("button", { name: "第一章 · 雾中来客" }),
			).toBeVisible();
			await expect(details.getByText("依赖这条规划")).toBeVisible();
			await expectNoPageHorizontalScroll(page);

			// 人物深链聚焦：hash 直达选中条目（?focus= 语义，会话内导航不刷新页面）。
			await page.evaluate(() => {
				window.location.hash = "#/world/characters?focus=CHAR-SU";
			});
			await expect(
				page.getByText("被什么引用 · 会影响什么（苏晚）"),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "林舟 → 苏晚（同伴）" }),
			).toBeVisible();
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });

	test("窄窗可用：规则影响展开、人物影响面板与零横向滚动", async ({ page }) => {
		const dir = await createTempProject(page, { name: "影响投影-compact" });
		try {
			await seedImpactWorld(page, dir);
			await openBook(page, dir, "影响投影-compact");

			await openWorldSub(page, "规则");
			const ruleCard = page.locator('[data-rule-id="RULE-NO-REVIVE"]');
			await ruleCard.getByText("查看影响").click();
			await expect(ruleCard.getByText(REFERENCED_BY_LABEL)).toBeVisible();
			await expect(
				ruleCard.getByRole("button", { name: "雾中来客" }),
			).toBeVisible();
			await expect(ruleCard.getByText("待确认场景 · 码头夜雾")).toBeVisible();
			await expectNoPageHorizontalScroll(page);

			// 窄窗深链到人物：影响面板在 800×600 不溢出（会话内 hash 导航）。
			await page.evaluate(() => {
				window.location.hash = "#/world/characters?focus=CHAR-SU";
			});
			await expect(
				page.getByText("被什么引用 · 会影响什么（苏晚）"),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "雾中来客" }),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
});
