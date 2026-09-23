import { expect, type Locator, type Page } from "@playwright/test";

import {
	configureSession,
	coreRequest,
	createTempProject,
	disposeTempProjectDir,
	expectNoPageHorizontalScroll,
	test,
} from "./helpers/author-app";

/**
 * WF5-13：统一关系工作区全旅程（真实核心进程 + 真实 SQLite）。
 * 时间轴带独占故事时间（直达/键盘/事件下拉）、图谱与列表共享谓词、
 * POV 知识边界、知情者明细、证据场景跳转、修订提案就地批准、
 * 布局与筛选本地恢复、旧深链兼容；1180×760 全旅程 + 800×600 窄窗可用。
 */

interface SeedResult {
	dir: string;
}

/** 经真实核心播种：一个正典场景 + 三人物一势力 + 客观关系/私密边/双向态度。 */
async function seedRelations(page: Page, dir: string): Promise<SeedResult> {
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

	const design = await coreRequest<{ proposalId: string }>(
		page,
		dir,
		"create_design_proposal",
		{
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
					description: "同门师妹。",
					attributes: {},
				},
				{
					id: "CHAR-SHEN",
					type: "character",
					canonicalName: "沈青",
					description: "前朝旧人。",
					attributes: {},
				},
				{
					id: "FAC-BANG",
					type: "faction",
					canonicalName: "漕帮",
					description: "",
					attributes: {},
				},
			],
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
					id: "REL-RIVAL",
					sourceEntityId: "CHAR-SU",
					targetEntityId: "CHAR-SHEN",
					relationshipType: "political_rival_of",
					continuityId: "main",
					validFrom: 1,
					validTo: 4,
				},
				{
					id: "REL-SECRET",
					sourceEntityId: "CHAR-LIN",
					targetEntityId: "CHAR-SHEN",
					relationshipType: "ally_of",
					continuityId: "main",
					validFrom: 2,
					visibility: "private",
					knownByCharacterIds: ["CHAR-LIN"],
					sourceSceneVersionId: candidate.sceneVersionId,
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
			],
		},
	);
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: design.proposalId,
		expectedRevision: 1,
	});
	return { dir };
}

async function openRelations(
	page: Page,
	dir: string,
	name: string,
): Promise<void> {
	await configureSession(page, { defaultCwd: dir, fault: "none" });
	await page.goto("/");
	// 投影就绪前主操作也临时叫「打开书籍」；等它分化成续写目标再点普通打开。
	const card = page.getByRole("article", { name: `书籍：${name}` });
	await expect(card.getByRole("button", { name: "打开书籍" })).toHaveCount(1);
	await card.getByRole("button", { name: "打开书籍" }).click();
	await expect(page.getByRole("banner")).toBeVisible();
	await page
		.getByRole("complementary", { name: "导航侧栏" })
		.getByRole("button", { name: "世界", exact: true })
		.click();
	await page
		.getByRole("navigation", { name: "世界子区" })
		.getByRole("button", { name: "关系" })
		.click();
	await expect(page.getByRole("heading", { name: "关系" })).toBeVisible();
}

const counterOf = (page: Page) =>
	page.getByText(/第 \d+ 章 · 客观 \d+ 条 \/ 态度 \d+ 条/);
const canvasOf = (page: Page) =>
	page.getByRole("img", { name: "人物关系图谱画布" });
const listPanelOf = (page: Page) =>
	page.getByRole("complementary", { name: "关系列表" });

/** boundingBox 的 null 安全包装：元素不可定时直接失败并给出可读报错。 */
async function boxOf(locator: Locator) {
	const box = await locator.boundingBox();
	if (!box) throw new Error("节点 boundingBox 为空（元素不可见或未渲染）");
	return box;
}

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });

	test("统一关系工作区全旅程：时间轴/图谱/列表/知识边界/提案/持久化", async ({
		page,
	}, testInfo) => {
		const dir = await createTempProject(page, { name: "关系工作区-wide" });
		try {
			await seedRelations(page, dir);
			await openRelations(page, dir, "关系工作区-wide");

			// 第 0 章：只有盟友（公开）与苏晚对林舟的疼爱。
			await expect(counterOf(page)).toHaveText(
				"第 0 章 · 客观 1 条 / 态度 1 条",
			);
			await expect(canvasOf(page)).toBeVisible();
			await expect(
				listPanelOf(page).getByText("客观关系 · 1", { exact: true }),
			).toBeVisible();
			const allyRow = listPanelOf(page).getByRole("button", {
				name: "林舟 → 苏晚，盟友，第 0 章起，尚未结束",
			});
			await expect(allyRow).toBeVisible();
			await expect(
				listPanelOf(page).getByRole("button", {
					name: "苏晚对林舟的疼爱态度，强度 0.9",
				}),
			).toBeVisible();

			// 章号直达 1：政敌出现并带「本章新出现」。
			await page.getByLabel("章号直达").fill("1");
			await page.getByLabel("章号直达").press("Enter");
			await expect(counterOf(page)).toHaveText(
				"第 1 章 · 客观 2 条 / 态度 2 条",
			);
			await expect(
				listPanelOf(page).getByRole("button", {
					name: "苏晚 → 沈青，政敌，第 1 章至第 4 章",
				}),
			).toBeVisible();
			await expect(
				listPanelOf(page).getByText("本章新出现", { exact: true }),
			).toBeVisible();

			// 键盘步进到 2：私密盟友边出现（点线 + 「私」前缀不只靠颜色）。
			const slider = page.getByRole("slider", { name: "故事时间切片" });
			await slider.focus();
			await page.keyboard.press("ArrowRight");
			await expect(counterOf(page)).toHaveText(
				"第 2 章 · 客观 3 条 / 态度 2 条",
			);
			await expect(
				canvasOf(page).getByText("私 盟友", { exact: true }),
			).toBeVisible();
			const secretRow = listPanelOf(page).getByRole("button", {
				name: "林舟 → 沈青，盟友，私密，第 2 章起，尚未结束",
			});
			await expect(secretRow).toBeVisible();

			// 变化事件下拉跳「结束」章：政敌恰在第 4 章失效。
			await page
				.getByLabel("按关系变化事件跳章")
				.selectOption({ label: "第 4 章 · 苏晚 → 沈青 结束 政敌" });
			await expect(counterOf(page)).toHaveText(
				"第 4 章 · 客观 2 条 / 态度 2 条",
			);
			await expect(
				listPanelOf(page).getByRole("button", {
					name: "苏晚 → 沈青，政敌，第 1 章至第 4 章",
				}),
			).toHaveCount(0);

			// 键盘 Shift 步进带回 0 章（4−5 钳到界内）。
			await slider.focus();
			await page.keyboard.press("Shift+ArrowLeft");
			await expect(counterOf(page)).toHaveText(
				"第 0 章 · 客观 1 条 / 态度 1 条",
			);

			// POV 知识边界（核心强制）：苏晚看不到私密边也听不到林舟的态度；
			// 林舟（知情者）看得到私密边；作者全知全见。
			await page.getByLabel("章号直达").fill("2");
			await page.getByLabel("章号直达").press("Enter");
			await expect(counterOf(page)).toHaveText(
				"第 2 章 · 客观 3 条 / 态度 2 条",
			);
			const knowledge = page.getByLabel("知识范围");
			await knowledge.selectOption({ label: "POV · 苏晚" });
			await expect(counterOf(page)).toHaveText(
				"第 2 章 · 客观 2 条 / 态度 1 条",
			);
			await expect(secretRow).toHaveCount(0);
			await expect(
				canvasOf(page).getByText("私 盟友", { exact: true }),
			).toHaveCount(0);
			await expect(
				listPanelOf(page).getByRole("button", {
					name: "苏晚对林舟的疼爱态度，强度 0.9",
				}),
			).toBeVisible();
			await knowledge.selectOption({ label: "POV · 林舟" });
			await expect(counterOf(page)).toHaveText(
				"第 2 章 · 客观 3 条 / 态度 1 条",
			);
			await expect(secretRow).toBeVisible();
			await expect(
				listPanelOf(page).getByRole("button", {
					name: "林舟对苏晚的信任态度，强度 0.6",
				}),
			).toBeVisible();
			await knowledge.selectOption({ label: "作者全知" });
			await expect(counterOf(page)).toHaveText(
				"第 2 章 · 客观 3 条 / 态度 2 条",
			);

			// 选中同步与明细：私密边展开知情者与证据场景，跳场景落写作台。
			await secretRow.click();
			await expect(
				listPanelOf(page).getByText("可见性：私密 · 知情者 林舟"),
			).toBeVisible();
			await expect(
				listPanelOf(page).getByText("第 11 场《雾中来客》"),
			).toBeVisible();
			await listPanelOf(page).getByRole("button", { name: "跳到场景" }).click();
			await expect(page.getByText("雾中来客序10 · 正典只读")).toBeVisible();
			await testInfo.attach("evidence-jump", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});
			await page
				.getByRole("complementary", { name: "导航侧栏" })
				.getByRole("button", { name: "世界", exact: true })
				.click();
			await page
				.getByRole("navigation", { name: "世界子区" })
				.getByRole("button", { name: "关系" })
				.click();
			await expect(counterOf(page)).toHaveText(
				"第 2 章 · 客观 3 条 / 态度 2 条",
			);

			// 修订提案：预填原事实 → 关闭盟友有效期 → 就地批准后第 2 章失效；
			// 该人物对只剩双向态度，列表仍完整呈现（孤儿态度组）。
			await allyRow.click();
			await listPanelOf(page).getByRole("button", { name: "发起修订" }).click();
			const typeInput = page.getByLabel("这是什么关系");
			await expect(typeInput).toHaveValue("ally_of");
			await page.getByLabel("到第几章（可空＝尚未结束）").fill("2");
			await page.getByRole("button", { name: "提交提案（待批准）" }).click();
			const approval = page.getByRole("region", {
				name: "待批准的关系提案",
			});
			await expect(approval).toBeVisible();
			await approval.getByRole("button", { name: "批准生效" }).click();
			await expect(page.getByText("提案已批准，关系已生效。")).toBeVisible();
			await expect(counterOf(page)).toHaveText(
				"第 2 章 · 客观 2 条 / 态度 2 条",
			);
			await expect(allyRow).toHaveCount(0);
			await expect(
				listPanelOf(page).getByRole("button", {
					name: "苏晚对林舟的疼爱态度，强度 0.9",
				}),
			).toBeVisible();

			// 拖拽理线：节点跟随指针，手动位置进 localStorage。
			const node = canvasOf(page).getByRole("button", {
				name: "林舟（人物，焦点）",
			});
			await expect(node).toBeVisible();
			const before = await boxOf(node);
			await page.mouse.move(
				before.x + before.width / 2,
				before.y + before.height / 2,
			);
			await page.mouse.down();
			await page.mouse.move(
				before.x + before.width / 2 + 44,
				before.y + before.height / 2 + 26,
				{ steps: 6 },
			);
			await page.mouse.up();
			const after = await boxOf(node);
			expect(after.x - before.x).toBeGreaterThan(15);
			expect(after.y - before.y).toBeGreaterThan(8);

			// 筛选排除：政敌类型收起后行与画布同步消失。
			await page.getByRole("button", { name: "筛选关系类型：政敌" }).click();
			await expect(counterOf(page)).toHaveText(
				"第 2 章 · 客观 1 条 / 态度 2 条",
			);

			// 刷新恢复：重开书籍后章号、筛选与手动布局全部来自 localStorage。
			// 页面滚动会整体平移 boundingBox（视口坐标），位置比较取相对画布原点。
			const posInCanvas = async () => {
				const [nodeBox, canvasBox] = await Promise.all([
					boxOf(
						canvasOf(page).getByRole("button", {
							name: "林舟（人物，焦点）",
						}),
					),
					boxOf(canvasOf(page)),
				]);
				return { x: nodeBox.x - canvasBox.x, y: nodeBox.y - canvasBox.y };
			};
			const afterRelative = await posInCanvas();
			await page.reload();
			await openRelations(page, dir, "关系工作区-wide");
			await expect(counterOf(page)).toHaveText(
				"第 2 章 · 客观 1 条 / 态度 2 条",
			);
			await expect(
				page.getByRole("button", { name: "筛选关系类型：政敌" }),
			).toHaveAttribute("aria-pressed", "false");
			const restoredRelative = await posInCanvas();
			expect(
				Math.abs(restoredRelative.x - afterRelative.x),
			).toBeLessThanOrEqual(3);
			expect(
				Math.abs(restoredRelative.y - afterRelative.y),
			).toBeLessThanOrEqual(3);

			// 旧深链兼容：隐藏子区路由与旧一级 #/graph 都落统一工作区。
			await page.goto("/#/world/relations-timeline");
			await expect(page.getByRole("heading", { name: "关系" })).toBeVisible();
			await page.goto("/#/world/relations-graph");
			await expect(page.getByRole("heading", { name: "关系" })).toBeVisible();
			await expect(canvasOf(page)).toBeVisible();
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });

	test("窄窗：统一工作区时间与知识控制可用，无遮挡死角", async ({ page }) => {
		const dir = await createTempProject(page, { name: "关系工作区-compact" });
		try {
			await seedRelations(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await page.goto("/");
			// 投影就绪前主操作也临时叫「打开书籍」；等它分化成续写目标再点普通打开。
			const compactCard = page.getByRole("article", {
				name: "书籍：关系工作区-compact",
			});
			await expect(
				compactCard.getByRole("button", { name: "打开书籍" }),
			).toHaveCount(1);
			await compactCard.getByRole("button", { name: "打开书籍" }).click();
			await expect(page.getByRole("banner")).toBeVisible();

			// 窄窗折叠栏：经图标进世界区，子区条进关系。
			await page
				.getByRole("complementary", { name: "导航侧栏" })
				.getByRole("button", { name: "世界", exact: true })
				.click();
			await page
				.getByRole("navigation", { name: "世界子区" })
				.getByRole("button", { name: "关系" })
				.click();
			await expect(page.getByRole("heading", { name: "关系" })).toBeVisible();
			await expect(counterOf(page)).toHaveText(
				"第 0 章 · 客观 1 条 / 态度 1 条",
			);
			await expect(canvasOf(page)).toBeVisible();
			await expectNoPageHorizontalScroll(page);

			// 直达 + 键盘 + POV 切换在窄窗同样完整可用。
			await page.getByLabel("章号直达").fill("2");
			await page.getByLabel("章号直达").press("Enter");
			await expect(counterOf(page)).toHaveText(
				"第 2 章 · 客观 3 条 / 态度 2 条",
			);
			const slider = page.getByRole("slider", { name: "故事时间切片" });
			await slider.focus();
			await page.keyboard.press("ArrowRight");
			await expect(counterOf(page)).toHaveText(
				"第 3 章 · 客观 3 条 / 态度 2 条",
			);
			await page.getByLabel("知识范围").selectOption({ label: "POV · 苏晚" });
			await expect(counterOf(page)).toHaveText(
				"第 3 章 · 客观 2 条 / 态度 1 条",
			);
			await expectNoPageHorizontalScroll(page);

			// 列表明细在窄窗可展开（知情者 + 发起修订可达）。
			await page.getByLabel("知识范围").selectOption({ label: "作者全知" });
			const secretRow = listPanelOf(page).getByRole("button", {
				name: "林舟 → 沈青，盟友，私密，第 2 章起，尚未结束",
			});
			await secretRow.click();
			await expect(
				listPanelOf(page).getByText("可见性：私密 · 知情者 林舟"),
			).toBeVisible();
			await expect(
				listPanelOf(page).getByRole("button", { name: "发起修订" }),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
});
