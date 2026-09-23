import { expect, type Page } from "@playwright/test";

import {
	configureSession,
	coreRequest,
	createTempProject,
	disposeTempProjectDir,
	expectNoPageHorizontalScroll,
	test,
} from "./helpers/author-app";

/** 经真实核心把一个临时项目播种成「有规则/有关系/有一个正典场景」的完整世界。 */
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
				{
					id: "RULE-NO-FLY",
					name: "凡人不能飞行",
					description: "没有御空法宝，移动依靠车马与船只。",
					examples: [],
				},
				{
					id: "RULE-ONE-CORE",
					name: "一核一主",
					description: "每枚玉核只能认一位主人。",
					examples: [],
				},
			],
			softRules: [
				{
					id: "SOFT-DIALECT",
					name: "北地口音",
					description: "北境人物对白偏短句，可有意打破。",
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
					description: "账房先生之女。",
					attributes: {},
				},
			],
			objectiveRelationships: [
				{
					id: "REL-LIN-SU",
					sourceEntityId: "CHAR-LIN",
					targetEntityId: "CHAR-SU",
					relationshipType: "ally_of",
					continuityId: "main",
					validFrom: 0,
				},
			],
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

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runCapabilitySuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runCapabilitySuite("compact");
});

function runCapabilitySuite(profile: string): void {
	/**
	 * WF5-03 全旅程（全部经真实核心进程；③④已随 WF5-11 世界区结构调整）：
	 * ① 写作台始终有「AI 助手」文字入口，开合右面板；
	 * ② 有场景未选→主操作禁用＋解释，选中后可用；
	 * ③ 世界区子区条固定为规则/人物/设定/关系，#/characters 落人物、
	 *    关系子区内部切图谱；
	 * ④ 规则子区一等可见硬/软规则计数与规则名；
	 * ⑤ 双视口无页面级横向滚动，导航键盘可聚焦。
	 */
	test(`[${profile}] AI 入口/关系入口/规则摘要全可发现`, async ({
		page,
	}, testInfo) => {
		const dir = await createTempProject(page, { name: `再发现-${profile}` });
		try {
			await seedProject(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await page.goto("/");
			await page
				.getByRole("article", { name: `书籍：再发现-${profile}` })
				.getByRole("button", { name: "打开书籍" })
				.click();
			await expect(page.getByRole("banner")).toBeVisible();

			// ① AI 助手文字窄入口：默认可见，点击打开覆盖式抽屉（WF5-07）。
			const aiEntry = page
				.getByRole("banner")
				.getByRole("button", { name: /AI 助手/ });
			await expect(aiEntry).toBeVisible();
			await expect(
				page.getByRole("complementary", { name: "AI 助手" }),
			).toHaveCount(0);
			await aiEntry.click();
			const aiPanel = page.getByRole("complementary", { name: "AI 助手" });
			await expect(aiPanel).toBeVisible();

			// ② 打开书即默认选中 resume target（WF5-06 验收 1）：唯一正典场景
			// 自动成为当前场景，AI 主操作可用——「有场景未选」的禁用门禁退为
			// 防御路径，默认态不再出现。
			const generateButton = page.getByRole("button", {
				name: "生成场景候选",
			});
			await expect(generateButton).toBeEnabled();
			await expect(page.getByText(/当前场景：正典 · 雾中来客/)).toBeVisible();
			await testInfo.attach("ai-assistant-gate", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});
			await expectNoPageHorizontalScroll(page);
			// 覆盖式抽屉是模态的：作者用 Esc 收起后再继续主区导航（WF3-11 键盘路径）。
			await page.keyboard.press("Escape");
			await expect(aiPanel).toHaveCount(0);

			// ③ 人物子区：#characters 深链落地人物列表（WF5-11 新世界结构）。
			await page.evaluate(() => {
				window.location.hash = "#/characters";
			});
			await expect(page.getByRole("heading", { name: "人物" })).toBeVisible();
			await expect(page.getByText("林舟").first()).toBeVisible();
			await expectNoPageHorizontalScroll(page);

			// 关系子区：唯一一级入口；统一工作区图谱与列表同屏共享同一时间切片（WF5-13 方案 C）。
			const strip = page.getByRole("navigation", { name: "世界子区" });
			await strip.getByRole("button", { name: "关系" }).click();
			await expect(page.getByRole("heading", { name: "关系" })).toBeVisible();
			const canvas = page.getByRole("img", { name: "人物关系图谱画布" });
			await expect(canvas).toBeVisible();
			await expect(
				page.getByText("第 0 章 · 客观 1 条 / 态度 0 条"),
			).toBeVisible();
			await testInfo.attach("relationship-entries", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});

			// ④ 规则子区：硬/软规则计数与真实规则名一等可见（WF5-11）。
			await strip.getByRole("button", { name: "规则" }).click();
			await expect(page.getByText("硬规则 · 3", { exact: true })).toBeVisible();
			await expect(
				page.getByText("人死不能复生", { exact: true }),
			).toBeVisible();
			await expect(page.getByText("软规则 · 1", { exact: true })).toBeVisible();
			await expectNoPageHorizontalScroll(page);

			// ⑤ 键盘路径：导航按钮可聚焦、可回车触发。800×600 下侧栏按设计自动折叠，
			// 先用键盘展开侧栏，再经子区条进规则——窄窗的真实键盘路径。
			const navWorld = page
				.getByRole("complementary", { name: "导航侧栏" })
				.getByRole("button", { name: "世界", exact: true });
			if ((await navWorld.count()) === 0) {
				await page.getByRole("button", { name: "展开侧栏" }).focus();
				await page.keyboard.press("Enter");
			}
			await navWorld.first().focus();
			await page.keyboard.press("Enter");
			await page
				.getByRole("navigation", { name: "世界子区" })
				.getByRole("button", { name: "规则" })
				.focus();
			await page.keyboard.press("Enter");
			await expect(page.getByText("硬规则 · 3", { exact: true })).toBeVisible();
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	/**
	 * WF5-03 用例 1 边界：零场景新书——主操作不得被场景门禁堵死（冷启动不死路），
	 * 提示改为「直接生成第一个开场」。
	 */
	test(`[${profile}] 零场景新书：AI 主操作可用并引导第一场`, async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: `首场-${profile}` });
		try {
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await page.goto("/");
			await page
				.getByRole("article", { name: `书籍：首场-${profile}` })
				.getByRole("button", { name: "打开书籍" })
				.click();
			await expect(page.getByRole("banner")).toBeVisible();

			await page
				.getByRole("banner")
				.getByRole("button", { name: /AI 助手/ })
				.click();
			const generateButton = page.getByRole("button", {
				name: "生成场景候选",
			});
			await expect(generateButton).toBeEnabled();
			await expect(page.getByText("这本书还没有场景")).toBeVisible();
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
}
