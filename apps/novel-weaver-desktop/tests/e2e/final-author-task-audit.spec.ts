import { expect, type Page } from "@playwright/test";

import {
	configureSession,
	coreRequest,
	createTempProject,
	createTempProjectDir,
	disposeTempProjectDir,
	expectNoPageHorizontalScroll,
	test,
} from "./helpers/author-app";

/**
 * WF5-18 终局验收：五条真实作者任务连续链路。全部经真实本地 RPC
 * （浏览器 invoke 垫片 → /__nw/local-rpc → 真实 local-core 进程 → SQLite），
 * 写操作只落临时项目；补全模型层由 NW_COMPLETION_FIXTURE 按 userPrompt
 * 标记脚本化（真实装配、真实落库，只替换模型调用）。
 *
 * 五条场景：
 * 一、从一个新故事想法开始：UI 冷启动建规则/人物/总纲，拆出首章并生成首个场景候选。
 * 二、打开已有大纲继续拆章，回到上次场景写作，比较双稿并确认成正式版本。
 * 三、修改一条硬规则，看到受影响的规划、人物、关系和场景，完成修订。
 * 四、在两个故事时间查看同一人物对的客观关系、双向态度、变化历史和证据场景。
 * 五、注入网络、模型、输入校验和过期基线错误，作者都能理解原因、保留输入并继续。
 */

function shelfCard(page: Page, name: string) {
	return page.getByRole("article", { name: `书籍：${name}` });
}

/** 打开书（普通入口）：等主按钮从续写目标回落分化再点。 */
async function openBook(page: Page, name: string): Promise<void> {
	await page.goto("/");
	const card = shelfCard(page, name);
	await expect(card.getByRole("button", { name: "打开书籍" })).toHaveCount(1);
	await card.getByRole("button", { name: "打开书籍" }).click();
	await expect(page.getByRole("banner")).toBeVisible();
}

async function nav(page: Page, name: string): Promise<void> {
	await page
		.getByRole("complementary", { name: "导航侧栏" })
		.getByRole("button", { name, exact: true })
		.click();
}

async function openWorldSub(page: Page, sub: string): Promise<void> {
	await nav(page, "世界");
	await page
		.getByRole("navigation", { name: "世界子区" })
		.getByRole("button", { name: sub })
		.click();
}

/** 待审设定提案面板：批准最早一条（规则/人物共用就近批准流）。 */
async function approvePendingSetting(page: Page): Promise<void> {
	const panel = page.getByText(/待审设定提案 · \d+/);
	await expect(panel).toBeVisible();
	await page.getByRole("button", { name: "批准", exact: true }).first().click();
	await expect(page.getByText("没有待审的设定提案。")).toBeVisible();
}

function drawer(page: Page) {
	return page.getByRole("complementary", { name: "AI 助手" });
}

function dualView(page: Page) {
	return page.locator('div[aria-label^="双稿裁决："]');
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

interface SceneCandidate {
	sceneId: string;
	sceneVersionId: string;
	proposalId: string;
}

/**
 * 终验共享世界（真实核心落库）：硬/软规则、两人物、盟友+证据关系、
 * 双向态度带第 20 章变化、两场正典（雾中来客上下文包引用硬规则）、
 * 未拆章总纲 + 未写场景计划、一条待确认候选。
 */
async function seedAuditWorld(page: Page, dir: string): Promise<string> {
	// 设计提案先行：规则 + 人物入库（上下文包才带得上硬规则）。
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
					description: "漕帮少主。",
					attributes: {},
				},
				{
					id: "CHAR-SU",
					type: "character",
					canonicalName: "苏晚",
					description: "钟表匠之女。",
					attributes: {},
				},
			],
		},
	);
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: design.proposalId,
		expectedRevision: 1,
	});

	// 正典雾中来客：上下文包把硬规则带进生成基线（规则被引用的来源）。
	const context = await coreRequest<{ contextId: string }>(
		page,
		dir,
		"build_context_package",
		{
			continuityId: "main",
			storyOrder: 10,
			viewpointCharacterId: "CHAR-LIN",
			relatedEntityIds: ["CHAR-SU"],
		},
	);
	const visitor = await coreRequest<SceneCandidate>(page, dir, "create_scene_candidate", {
		title: "雾中来客",
		markdown: "林舟在雾中看清了来人的脸。\n\n他按刀未动，先听风声。来人停在五步之外。",
		narrativeMode: "third_person_limited",
		viewpointCharacterId: "CHAR-LIN",
		continuityId: "main",
		storyOrder: 10,
		purposes: ["推进主线"],
		relatedEntityIds: ["CHAR-LIN", "CHAR-SU"],
		contextPackageId: context.contextId,
	});
	await coreRequest(page, dir, "record_scene_review", {
		proposalId: visitor.proposalId,
		candidateVersionId: visitor.sceneVersionId,
		findings: [],
	});
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: visitor.proposalId,
		expectedRevision: 1,
	});
	const lamp = await coreRequest<SceneCandidate>(page, dir, "create_scene_candidate", {
		title: "雾夜灯塔",
		markdown: "雾夜灯塔：苏晚把灯挑亮了一分。",
		narrativeMode: "third_person_limited",
		viewpointCharacterId: "CHAR-LIN",
		continuityId: "main",
		storyOrder: 5,
		purposes: ["铺垫"],
	});
	await coreRequest(page, dir, "record_scene_review", {
		proposalId: lamp.proposalId,
		candidateVersionId: lamp.sceneVersionId,
		findings: [],
	});
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: lamp.proposalId,
		expectedRevision: 1,
	});

	// 关系与态度：锚定雾中来客正典版本，一次真实批准落库。
	const relations = await coreRequest<{ proposalId: string }>(
		page,
		dir,
		"create_design_proposal",
		{
			objectiveRelationships: [
				{
					id: "REL-ALLY",
					sourceEntityId: "CHAR-LIN",
					targetEntityId: "CHAR-SU",
					relationshipType: "ally_of",
					continuityId: "main",
					validFrom: 0,
				},
				{
					id: "REL-EVIDENCE",
					sourceEntityId: "CHAR-SU",
					targetEntityId: "CHAR-LIN",
					relationshipType: "ally_of",
					continuityId: "main",
					validFrom: 10,
					sourceSceneVersionId: visitor.sceneVersionId,
				},
			],
			characterAttitudes: [
				{
					id: "ATT-A",
					sourceCharacterId: "CHAR-SU",
					targetCharacterId: "CHAR-LIN",
					dimension: "affection",
					intensity: 0.9,
					continuityId: "main",
					validFrom: 0,
					validTo: 20,
				},
				{
					id: "ATT-B",
					sourceCharacterId: "CHAR-LIN",
					targetCharacterId: "CHAR-SU",
					dimension: "trust",
					intensity: 0.6,
					continuityId: "main",
					validFrom: 1,
				},
				{
					id: "ATT-C",
					sourceCharacterId: "CHAR-SU",
					targetCharacterId: "CHAR-LIN",
					dimension: "affection",
					intensity: 0.4,
					continuityId: "main",
					validFrom: 20,
				},
			],
		},
	);
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: relations.proposalId,
		expectedRevision: 1,
	});

	// 规划：未拆章总纲 + 未写场景计划（resume target 的未写场景）。
	const outline = await coreRequest<{ artifactId: string; proposalId: string }>(
		page,
		dir,
		"create_artifact_proposal",
		{
			kind: "outline",
			title: "雾城总纲",
			dependencyIds: [],
			content: {
				goal: "揭开雾塔真相",
				acts: ["重逢旧识", "翻出旧案"],
			},
		},
	);
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: outline.proposalId,
		expectedRevision: 1,
	});
	const plan = await coreRequest<{ proposalId: string }>(
		page,
		dir,
		"create_artifact_proposal",
		{
			kind: "scene_plan",
			title: "码头夜雾计划",
			dependencyIds: [outline.artifactId],
			content: {
				purpose: "码头追查钥匙",
				continuityId: "main",
				storyOrder: 20,
			},
		},
	);
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: plan.proposalId,
		expectedRevision: 1,
	});

	// 待确认候选：规则影响面与收件箱的「改动后需复核 / 基准已变化」素材。
	await coreRequest<SceneCandidate>(page, dir, "create_scene_candidate", {
		title: "钟楼对峙",
		markdown: "林舟在钟楼顶与来人对话。",
		narrativeMode: "third_person_limited",
		viewpointCharacterId: "CHAR-LIN",
		continuityId: "main",
		storyOrder: 30,
		purposes: ["推进对峙"],
	});
	return visitor.sceneId;
}

// ── 场景一：从一个新故事想法开始 ──────────────────────────────

async function scenarioOne(page: Page, profile: string): Promise<void> {
	const dir = await createTempProjectDir();
	try {
		await configureSession(page, {
			defaultCwd: "",
			dialogPath: dir,
			fault: "none",
		});
		const bookName = `终验一-${profile}`;
		// 生成候选需要补全服务商：与其他场景共用 byok 垫片 + NW_COMPLETION_FIXTURE。
		await seedByokFixture(page);

		// 新建书：键盘输入 + 提交，进入写作台。
		await page.goto("/");
		await expect(
			page.getByRole("heading", { name: "书架是空的" }),
		).toBeVisible();
		await page.getByRole("button", { name: "＋ 新建一部书" }).first().click();
		const wizard = page.getByRole("dialog", { name: "首启向导" });
		await expect(wizard).toBeVisible();
		await page.getByLabel("书名").fill(bookName);
		await page.getByLabel("主要创作语言").fill("zh-CN");
		await page.getByRole("button", { name: "创建项目" }).click();
		await page.getByRole("button", { name: "进入写作台 ›" }).click();
		await expect(
			page.getByRole("banner").getByText(bookName, { exact: true }),
		).toBeVisible();

		// 硬规则：规则区空态起步，表单 → 就近批准（UI 建的规则 id 由核心生成）。
		await openWorldSub(page, "规则");
		await page.getByRole("button", { name: "＋ 写第一条规则" }).click();
		await page.getByLabel("名称").fill("人死不能复生");
		await page
			.getByLabel("这条规则约束什么")
			.fill("本世界没有复活手段，死亡即终局。");
		await page.getByRole("button", { name: "提交提案（待批准）" }).click();
		await approvePendingSetting(page);
		await expect(page.getByText("硬规则 · 1", { exact: true })).toBeVisible();
		await expect(page.getByText("人死不能复生", { exact: true })).toBeVisible();

		// 软规则：非空态入口，同一条连续确认流。
		await page.getByRole("button", { name: "＋ 新建软规则" }).click();
		await page.getByLabel("名称").fill("雾城多雾");
		await page.getByLabel("这条规则约束什么").fill("叙事里雾是常驻意象。");
		await page
			.getByLabel("规则强度")
			.selectOption({ label: "软规则 · 倾向" });
		await page.getByRole("button", { name: "提交提案（待批准）" }).click();
		await approvePendingSetting(page);
		await expect(page.getByText("软规则 · 1", { exact: true })).toBeVisible();
		await expect(page.getByText("雾城多雾", { exact: true })).toBeVisible();

		// 人物：世界区人物子区表单。
		await openWorldSub(page, "人物");
		await page.getByRole("button", { name: "＋ 新建" }).click();
		await page.getByLabel("本名").fill("林舟");
		await page.getByLabel("一句话定位").fill("漕帮少主。");
		await page.getByRole("button", { name: "提交提案（待批准）" }).click();
		await approvePendingSetting(page);
		await expect(
			page.getByRole("button", { name: /林舟/ }).first(),
		).toBeVisible();

		// 总纲：规划区新建工件表单 → 原位预览影响 → 确认纳入。
		await nav(page, "规划");
		await expect(page.getByRole("heading", { name: "大纲工作区" })).toBeVisible();
		await page.getByRole("textbox", { name: "标题", exact: true }).fill("雾城总纲");
		await page.getByLabel("目标").fill("揭开雾塔真相");
		await page
			.getByLabel("幕（每行一条）")
			.fill("重逢旧识\n翻出旧案");
		await page.getByRole("button", { name: "创建提案（待批准）" }).click();
		await page.getByTestId("proposal-confirm").getByRole("button", { name: "确认纳入" }).click();
		await expect(page.getByText(/「雾城总纲」已纳入规划/)).toBeVisible();

		// 拆出首章：总纲拆章连续流。
		await expect(page.getByTestId("outline-summary")).toBeVisible();
		await page.getByRole("button", { name: "根据总纲拆分章节" }).click();
		const split = page.getByRole("dialog", { name: "根据总纲拆分章节" });
		await split.getByRole("button", { name: "生成拆章预览" }).click();
		await expect(split.getByLabel("章节标题").first()).toHaveValue(
			"第1章 · 重逢旧识",
		);
		await split.getByRole("button", { name: "确认拆章" }).click();
		await expect(split.getByText(/拆章完成：2 章已纳入规划/)).toBeVisible();
		await split.getByRole("button", { name: "完成" }).click();
		const chapterDrawer = page.getByRole("dialog", { name: "编辑本章大纲" });
		await expect(chapterDrawer).toBeVisible();
		await chapterDrawer.getByRole("button", { name: "关闭" }).click();

		// 首个场景计划：高级设置里填故事序。
		await page.getByLabel("工件类型").selectOption({ label: "场景计划" });
		await page.getByRole("textbox", { name: "标题", exact: true }).fill("雨夜来客");
		await page.getByLabel("叙事目的").fill("开场：钥匙易手");
		await page.getByText("高级设置 · 依赖、排序与 JSON").click();
		await page.getByLabel("故事序（整数）").fill("10");
		await page.getByRole("button", { name: "创建提案（待批准）" }).click();
		await page
			.getByTestId("proposal-confirm")
			.getByRole("button", { name: "确认纳入" })
			.click();
		await expect(page.getByText(/「雨夜来客」已纳入规划/)).toBeVisible();

		// 写作台待写场景 → 生成首个场景候选。
		await nav(page, "写作");
		await expect(page.getByText("下一步 · 待写场景")).toBeVisible();
		await expect(page.getByRole("heading", { name: "雨夜来客" })).toBeVisible();
		await page.getByRole("button", { name: "为此场景生成候选" }).click();
		const panel = drawer(page);
		await expect(panel).toBeVisible();
		await expect(panel.getByLabel("场景标题")).toHaveValue("雨夜来客");
		// 视点角色：待写场景没有既定 POV，采用落库时核心校验强制非全知必须带视点。
		await panel.getByRole("button", { name: /生成参数/ }).click();
		await panel.getByLabel("视点角色").selectOption({ label: "林舟" });
		await panel
			.getByRole("textbox", { name: /你希望这次推进什么/ })
			.fill("写开场：钥匙易手。E2E-DUAL-SCORE");
		await panel.getByRole("button", { name: "生成场景候选" }).click();
		await expect(panel.getByText("候选 · 1", { exact: true })).toBeVisible();

		// 采用候选 → 作者触发的唯一落库动作（生成本身零写入）。
		await panel.getByRole("button", { name: "采用", exact: true }).click();
		await expect(panel.getByText("已入待审", { exact: true })).toBeVisible();

		// Esc 关抽屉（焦点归还）+ 独立读回：候选提案确实落库待审。
		await page.keyboard.press("Escape");
		await expect(panel).toHaveCount(0);
		const pending = await coreRequest<
			Array<{ proposalId: string; kind: string }>
		>(page, dir, "list_pending_proposals", {});
		expect(
			pending.some((item) => item.kind === "scene_candidate"),
			"首个场景候选应以待审提案形式落库",
		).toBe(true);
		await expectNoPageHorizontalScroll(page);
	} finally {
		await disposeTempProjectDir(dir);
	}
}

// ── 场景二：继续拆章 → 回上次场景 → 双稿裁决 → 确认入正典 ─────

async function scenarioTwo(page: Page, profile: string): Promise<void> {
	const dir = await createTempProject(page, { name: `终验二-${profile}` });
	try {
		const visitorSceneId = await seedAuditWorld(page, dir);
		await seedByokFixture(page);
		await configureSession(page, { defaultCwd: dir, fault: "none" });
		await openBook(page, `终验二-${profile}`);

		// resume target：未写场景计划（确定性选择序）。
		const rail = page.getByRole("navigation", { name: "章节与场景" });
		await expect(
			rail.getByRole("button", { name: /码头夜雾计划/ }),
		).toHaveAttribute("aria-current", "true");
		await expect(page.getByText("下一步 · 待写场景")).toBeVisible();

		// 回到上次场景写作：切到上次正典，纸面就位。
		await rail.getByRole("button", { name: /雾中来客/ }).click();
		await expect(page.getByText("正典只读")).toBeVisible();

		// 继续拆章：打开已有总纲，拆出两章。
		await nav(page, "规划");
		await page.getByRole("button", { name: "根据总纲拆分章节" }).click();
		const split = page.getByRole("dialog", { name: "根据总纲拆分章节" });
		await split.getByRole("button", { name: "生成拆章预览" }).click();
		await split.getByRole("button", { name: "确认拆章" }).click();
		await expect(split.getByText(/拆章完成：2 章已纳入规划/)).toBeVisible();
		await split.getByRole("button", { name: "完成" }).click();
		await page
			.getByRole("dialog", { name: "编辑本章大纲" })
			.getByRole("button", { name: "关闭" })
			.click();
		await expect(page.getByText(/卷章结构 · 2 章/)).toBeVisible();

		// 双稿裁决：在上次正典上重写生成 → 原位切双稿。
		await nav(page, "写作");
		await rail.getByRole("button", { name: /雾中来客/ }).click();
		await expect(page.getByText("正典只读")).toBeVisible();
		await page
			.getByRole("banner")
			.getByRole("button", { name: /AI 助手/ })
			.click();
		const panel = drawer(page);
		await panel
			.getByRole("textbox", { name: /你希望这次推进什么/ })
			.fill("强化雾中相遇的张力。E2E-DUAL-SCORE");
		await panel.getByRole("button", { name: "生成场景候选" }).click();
		await expect(panel).toHaveCount(0);
		const dual = dualView(page);
		await expect(dual).toBeVisible();
		await expect(dual.getByText("基线未过期")).toBeVisible();

		// 键盘裁决：空格勾选差异句段 → 确认为新草稿。
		const card = dual
			.locator("label")
			.filter({ hasText: "腰间玉核微微发烫" });
		await expect(card).toHaveCount(1);
		await card.getByRole("checkbox").focus();
		await page.keyboard.press("Space");
		await expect(dual.getByText("已选 1 处采用")).toBeVisible();
		await dual.getByRole("button", { name: "确认为新草稿" }).click();
		await dual.getByRole("button", { name: "回到正文继续写" }).click();
		await expect(dualView(page)).toHaveCount(0);

		// 手编草稿 → 存为候选提案。
		const draftBox = page.locator("textarea");
		await expect(draftBox).toBeVisible();
		expect(await draftBox.inputValue()).toContain("腰间玉核微微发烫");
		await page.getByRole("button", { name: "存为候选提案" }).click();
		await expect(page.getByText("候选提案已创建——待审批准后入正典。")).toBeVisible();

		// 审校收件箱：手编合并稿作为既有场景的修订落库（提案展示名 = 场景名），
		// 送审 → 确认入正典。
		await nav(page, "审校");
		await expect(page.getByRole("heading", { name: "审校收件箱" })).toBeVisible();
		await page.getByRole("button", { name: /雾中来客/ }).first().click();
		await page
			.getByRole("button", { name: "送独立审校（无新增发现）" })
			.click();
		await page.getByRole("button", { name: "确认入正典", exact: true }).click();
		await expect(page.getByText("已确认入正典。")).toBeVisible();

		// 独立读回：合并稿已是正式版本。
		const canonical = await coreRequest<{ markdown: string }>(
			page,
			dir,
			"get_canonical_scene",
			{ sceneId: visitorSceneId },
		);
		expect(canonical.markdown).toContain("腰间玉核微微发烫");
		expect(canonical.markdown).toContain("他按刀未动，先听风声");
		await expectNoPageHorizontalScroll(page);
	} finally {
		await disposeTempProjectDir(dir);
	}
}

// ── 场景三：修改硬规则 → 影响投影 → 修订 → 候选基准过期 ───────

async function scenarioThree(page: Page, profile: string): Promise<void> {
	const dir = await createTempProject(page, { name: `终验三-${profile}` });
	try {
		await seedAuditWorld(page, dir);
		await configureSession(page, { defaultCwd: dir, fault: "none" });
		await openBook(page, `终验三-${profile}`);

		// 影响投影：硬规则被正典引用，且波及待确认候选。
		await openWorldSub(page, "规则");
		const hardCard = page.locator('[data-rule-id="RULE-DEATH"]');
		await hardCard.getByText("查看影响").click();
		await expect(
			hardCard.getByText("被引用 · 既成事实里哪里用到了它"),
		).toBeVisible();
		await expect(
			hardCard.getByRole("button", { name: "雾中来客" }),
		).toBeVisible();
		await expect(
			hardCard.getByText("会影响 · 本次改动会波及的待确认工作"),
		).toBeVisible();
		await expect(
			hardCard.getByText("待确认场景 · 钟楼对峙"),
		).toBeVisible();
		await expect(hardCard.getByText("改动后需复核")).toBeVisible();

		// 修订：预填原规则的连续确认流。
		await hardCard.getByRole("button", { name: "修订" }).click();
		const revisionPanel = page.getByText("修订 · 人死不能复生");
		await expect(revisionPanel).toBeVisible();
		await expect(page.getByLabel("名称")).toHaveValue("人死不能复生");
		await page
			.getByLabel("这条规则约束什么")
			.fill("本世界没有复活手段，死亡即终局；魂体分离同样不可逆。");
		await page.getByRole("button", { name: "提交提案（待批准）" }).click();
		await approvePendingSetting(page);
		await expect(
			page.getByText(/魂体分离同样不可逆/).first(),
		).toBeVisible();

		// 收件箱同步：候选基准已变化，确认门如实拦截。
		await nav(page, "写作");
		await nav(page, "审校");
		await page.getByRole("button", { name: /钟楼对峙/ }).first().click();
		await expect(page.getByText(/它依赖的创作基准（规则、设定或已确认正文）变了/)).toBeVisible();
		await expect(
			page.getByRole("button", { name: "确认入正典", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByText(/这份稿子基于旧基准，无法直接确认。回写作台重新生成/),
		).toBeVisible();
		await expectNoPageHorizontalScroll(page);
	} finally {
		await disposeTempProjectDir(dir);
	}
}

// ── 场景四：两个故事时间看同一人物对 ──────────────────────────

const counterOf = (page: Page) =>
	page.getByText(/第 \d+ 章 · 客观 \d+ 条 \/ 态度 \d+ 条/);
const listPanelOf = (page: Page) =>
	page.getByRole("complementary", { name: "关系列表" });

async function scenarioFour(page: Page, profile: string): Promise<void> {
	const dir = await createTempProject(page, { name: `终验四-${profile}` });
	try {
		await seedAuditWorld(page, dir);
		await configureSession(page, { defaultCwd: dir, fault: "none" });
		await openBook(page, `终验四-${profile}`);
		await openWorldSub(page, "关系");
		await expect(page.getByRole("heading", { name: "关系" })).toBeVisible();

		// 故事时间 0：只有开局盟友与疼爱。
		await expect(counterOf(page)).toHaveText(
			"第 0 章 · 客观 1 条 / 态度 1 条",
		);
		await expect(
			listPanelOf(page).getByRole("button", {
				name: "林舟 → 苏晚，盟友，第 0 章起，尚未结束",
			}),
		).toBeVisible();
		await expect(
			listPanelOf(page).getByRole("button", {
				name: "苏晚对林舟的疼爱态度，强度 0.9",
			}),
		).toBeVisible();

		// 故事时间 10（键盘直达）：证据盟友与信任出现。
		await page.getByLabel("章号直达").fill("10");
		await page.getByLabel("章号直达").press("Enter");
		await expect(counterOf(page)).toHaveText(
			"第 10 章 · 客观 2 条 / 态度 2 条",
		);
		await expect(
			listPanelOf(page).getByRole("button", {
				name: "苏晚 → 林舟，盟友，第 10 章起，尚未结束",
			}),
		).toBeVisible();
		await expect(
			listPanelOf(page).getByText("本章新出现", { exact: true }),
		).toBeVisible();

		// 证据场景：证据边展开明细，跳场景落写作台。
		const evidenceRow = listPanelOf(page).getByRole("button", {
			name: "苏晚 → 林舟，盟友，第 10 章起，尚未结束",
		});
		await evidenceRow.click();
		await expect(
			listPanelOf(page).getByText(/《雾中来客》/),
		).toBeVisible();
		await listPanelOf(page).getByRole("button", { name: "跳到场景" }).click();
		await expect(page.getByText("雾中来客序10 · 正典只读")).toBeVisible();

		// 故事时间 20（键盘步进）：疼爱转淡的历史变化。
		await openWorldSub(page, "关系");
		const slider = page.getByRole("slider", { name: "故事时间切片" });
		await slider.focus();
		// 第 10 章起步进 +5 ×2 = 20（Shift 大步）。
		await page.keyboard.press("Shift+ArrowRight");
		await page.keyboard.press("Shift+ArrowRight");
		await expect(counterOf(page)).toHaveText(
			"第 20 章 · 客观 2 条 / 态度 2 条",
		);
		// 两条反向盟友边把同一对态度分两组显示，取首个即可。
		await expect(
			listPanelOf(page).getByRole("button", {
				name: "苏晚对林舟的疼爱态度，强度 0.4",
			}).first(),
		).toBeVisible();
		await expect(
			listPanelOf(page).getByRole("button", {
				name: "苏晚对林舟的疼爱态度，强度 0.9",
			}),
		).toHaveCount(0);

		// 变化事件下拉：跳回第 10 章，历史区间如实回滚。
		// 事件池含第 0/1/10/20 章的变化，按值精确选中第 10 章事件。
		await page
			.getByLabel("按关系变化事件跳章")
			.selectOption("10");
		await expect(counterOf(page)).toHaveText(
			"第 10 章 · 客观 2 条 / 态度 2 条",
		);
		await expect(
			listPanelOf(page).getByRole("button", {
				name: "苏晚对林舟的疼爱态度，强度 0.9",
			}).first(),
		).toBeVisible();
		await expectNoPageHorizontalScroll(page);
	} finally {
		await disposeTempProjectDir(dir);
	}
}

// ── 场景五：四类错误注入 ─────────────────────────────────────

async function scenarioFive(page: Page, profile: string): Promise<void> {
	const dir = await createTempProject(page, { name: `终验五-${profile}` });
	const scratch = await createTempProjectDir();
	try {
		// 共享世界先行播种：②拆章/③生成/④过期基线都依赖终验世界的真实数据。
		await seedAuditWorld(page, dir);
		// ① 输入校验（真实核心 Zod 拒绝）：空语言字段，人话错误 + 输入保留 + 原表单重试。
		await configureSession(page, {
			defaultCwd: "",
			dialogPath: scratch,
			fault: "none",
		});
		await page.goto("/");
		await page.getByRole("button", { name: "＋ 新建一部书" }).first().click();
		await page.getByLabel("书名").fill("校验不通过的稿子");
		await page.getByLabel("主要创作语言").fill("");
		await page.getByRole("button", { name: "创建项目" }).click();
		const alert = page.getByRole("alert");
		await expect(alert).toContainText("请求被本地核心拒绝");
		await expect(
			page.getByLabel("书名"),
			"失败的提交必须保留已填写的书名",
		).toHaveValue("校验不通过的稿子");
		await page.getByLabel("主要创作语言").fill("zh-CN");
		await page.getByRole("button", { name: "创建项目" }).click();
		await expect(
			page.getByRole("button", { name: "进入写作台 ›" }),
		).toBeVisible();

		// 打开终验世界：拆章与生成都在这里注入故障。
		await seedByokFixture(page);
		await configureSession(page, { defaultCwd: dir, fault: "none" });
		await openBook(page, `终验五-${profile}`);
		await nav(page, "规划");

		// ② 网络（传输层 rpc_down）：拆章中断 → 指令保留 → 清除故障重试不重复建章。
		await page.getByRole("button", { name: "根据总纲拆分章节" }).click();
		const split = page.getByRole("dialog", { name: "根据总纲拆分章节" });
		await split.getByRole("button", { name: "生成拆章预览" }).click();
		await configureSession(page, { fault: "rpc_down" });
		await split.getByRole("button", { name: "确认拆章" }).click();
		await expect(page.getByRole("alert").first()).toContainText(
			"拆章没有全部完成",
		);
		await expect(split.getByText(/你的拆章指令已保留/)).toBeVisible();
		await configureSession(page, { fault: "none" });
		await split.getByRole("button", { name: "重试拆章" }).click();
		await expect(split.getByText(/拆章完成：2 章已纳入规划/)).toBeVisible();
		await split.getByRole("button", { name: "完成" }).click();
		await page
			.getByRole("dialog", { name: "编辑本章大纲" })
			.getByRole("button", { name: "关闭" })
			.click();

		// ③ 模型不可用（传输层同形注入）：生成失败 → 输入保留 → 重试成功切双稿。
		await nav(page, "写作");
		const rail = page.getByRole("navigation", { name: "章节与场景" });
		await rail.getByRole("button", { name: /雾中来客/ }).click();
		await expect(page.getByText("正典只读")).toBeVisible();
		await page
			.getByRole("banner")
			.getByRole("button", { name: /AI 助手/ })
			.click();
		const panel = drawer(page);
		const instruction = panel.getByRole("textbox", {
			name: /你希望这次推进什么/,
		});
		await instruction.fill("强化雾中相遇的张力。E2E-DUAL-SCORE");
		await configureSession(page, { fault: "rpc_down" });
		await panel.getByRole("button", { name: "生成场景候选" }).click();
		const panelAlert = panel.getByRole("alert");
		await expect(panelAlert).toContainText("无法启动 Novel Weaver 本地核心");
		await expect(instruction).toHaveValue(
			"强化雾中相遇的张力。E2E-DUAL-SCORE",
		);
		await expect(panel.getByRole("button", { name: "重试" })).toBeVisible();
		await configureSession(page, { fault: "none" });
		await panel.getByRole("button", { name: "重试" }).click();
		await expect(panel).toHaveCount(0);
		const dual = dualView(page);
		await expect(dual).toBeVisible();

		// ④ 过期基线（真实版本位移）：采用被暂停并解释，放弃始终可用。
		const current = await coreRequest<{ versionId: string }>(
			page,
			dir,
			"get_canonical_scene",
			{ sceneId: (await coreRequest<Array<{ sceneId: string; title: string }>>(
				page,
				dir,
				"list_canonical_scenes",
				{},
			)).find((scene) => scene.title === "雾中来客")!.sceneId },
		);
		const moved = await coreRequest<{ proposalId: string; sceneVersionId: string }>(
			page,
			dir,
			"create_scene_candidate",
			{
				sceneId: (
					await coreRequest<Array<{ sceneId: string; title: string }>>(
						page,
						dir,
						"list_canonical_scenes",
						{},
					)
				).find((scene) => scene.title === "雾中来客")!.sceneId,
				sourceVersionId: current.versionId,
				title: "雾中来客·外部修订",
				markdown: "雾散了，来人的脸属于苏晚。",
				narrativeMode: "third_person_limited",
				viewpointCharacterId: "CHAR-LIN",
				continuityId: "main",
				storyOrder: 10,
				purposes: ["推进主线"],
			},
		);
		await coreRequest(page, dir, "record_scene_review", {
			proposalId: moved.proposalId,
			candidateVersionId: moved.sceneVersionId,
			findings: [],
		});
		await coreRequest(page, dir, "approve_proposal", {
			proposalId: moved.proposalId,
			expectedRevision: 1,
		});
		await page.getByRole("button", { name: "版本历史" }).first().click();
		await expect(dual.getByText("已暂停采用与全文采用")).toBeVisible();
		await expect(
			dual.getByRole("checkbox", { name: /采用句段/ }).first(),
		).toBeDisabled();
		await expect(
			dual.getByRole("button", { name: "确认为新草稿" }),
		).toBeDisabled();
		await expect(
			dual.getByRole("button", { name: "放弃候选" }),
		).toBeEnabled();
		await dual.getByRole("button", { name: "放弃候选" }).click();
		await expect(dualView(page)).toHaveCount(0);
		await expect(page.getByText("雾散了，来人的脸属于苏晚。")).toBeVisible();
		await expectNoPageHorizontalScroll(page);
	} finally {
		await disposeTempProjectDir(scratch);
		await disposeTempProjectDir(dir);
	}
}

// 双视口驱动：每条场景在 1180×760 与 800×600 各跑一遍。
test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runAuditSuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runAuditSuite("compact");
});

function runAuditSuite(profile: string): void {
	test(`[${profile}] 场景一：新想法建规则/人物/总纲，拆首章并生成首个场景候选`, async ({
		page,
	}, testInfo) => {
		await scenarioOne(page, profile);
		if (profile === "wide") {
			await testInfo.attach("audit-scenario-one", {
				body: Buffer.from("scenario one passed"),
				contentType: "text/plain",
			});
		}
	});

	test(`[${profile}] 场景二：继续拆章，回上次场景，双稿局部采用确认入正典`, async ({
		page,
	}) => {
		await scenarioTwo(page, profile);
	});

	test(`[${profile}] 场景三：硬规则影响投影，修订后候选基准如实过期`, async ({
		page,
	}) => {
		await scenarioThree(page, profile);
	});

	test(`[${profile}] 场景四：两个故事时间的同一人物对，客观/态度/变化/证据`, async ({
		page,
	}) => {
		await scenarioFour(page, profile);
	});

	test(`[${profile}] 场景五：网络/模型/输入校验/过期基线四类错误都可理解、可恢复`, async ({
		page,
	}) => {
		await scenarioFive(page, profile);
	});
}
