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
 * WF5-07：覆盖式 AI 助手与三类作者意图。全部经真实本地 RPC（书架 →
 * 写作台 → 助手抽屉）在双视口下验证：覆盖层不改变纸面宽度、意图
 * 文案与副作用说明、可解释上下文（硬规则必带＋人物/前文可撤回）、
 * 无服务商时的人话失败与三条恢复出路。
 */

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
					id: "RULE-ONE-CORE",
					name: "一核一主",
					description: "每枚玉核只能认一位主人。",
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
			characterAttitudes: [
				{
					id: "ATT-TRUST",
					sourceCharacterId: "CHAR-SU",
					targetCharacterId: "CHAR-LIN",
					dimension: "信任",
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
	const seedCanonical = async (
		title: string,
		storyOrder: number,
	): Promise<void> => {
		const candidate = await coreRequest<{
			proposalId: string;
			sceneVersionId: string;
		}>(page, dir, "create_scene_candidate", {
			title,
			markdown: `${title}：林舟在雾中看清了来人的脸。`,
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
	// 更早一场正典＝当前场景（序 10）可引用的正式前文窗口。
	await seedCanonical("雾夜灯塔", 5);
	await seedCanonical("雾中来客", 10);
}

function drawer(page: Page) {
	return page.getByRole("complementary", { name: "AI 助手" });
}

async function openBook(page: Page, name: string): Promise<void> {
	await page.goto("/");
	await page
		.getByRole("article", { name: `书籍：${name}` })
		.getByRole("button", { name: "打开书籍" })
		.click();
	await expect(page.getByRole("banner")).toBeVisible();
}

/** 纸面横向位置：覆盖式抽屉不得挤压正文列（验收 1）。 */
async function paperLeft(page: Page): Promise<number> {
	const paper = page.locator(".prose.paper").first();
	await expect(paper).toBeVisible();
	return (await paper.boundingBox())?.x ?? Number.NaN;
}

async function runAssistantSuite(profile: string): Promise<void> {
	test(`[${profile}] 覆盖式抽屉：纸面不动、焦点归还、意图边界说清楚`, async ({
		page,
	}, testInfo) => {
		const dir = await createTempProject(page, { name: `助手-${profile}` });
		try {
			await seedProject(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await openBook(page, `助手-${profile}`);

			const before = await paperLeft(page);
			await page
				.getByRole("banner")
				.getByRole("button", { name: /AI 助手/ })
				.click();
			const panel = drawer(page);
			await expect(panel).toBeVisible();
			const after = await paperLeft(page);
			expect(
				Math.abs(after - before),
				"抽屉覆盖正文右侧，不得挤压纸面列",
			).toBeLessThan(1);

			if (profile === "wide") {
				await page.screenshot({
					path: "test-results/documentation/wf5-assistant-drawer.png",
					fullPage: true,
				});
				await testInfo.attach("assistant-drawer", {
					path: "test-results/documentation/wf5-assistant-drawer.png",
				});
			}

			// 三类意图：主操作与副作用说明随意图切换。
			const primary = panel.getByRole("button", { name: "生成场景候选" });
			await expect(primary).toBeEnabled();
			await panel.getByRole("tab", { name: "讨论推演" }).click();
			await expect(
				panel.getByRole("button", { name: "开始讨论" }),
			).toBeVisible();
			await expect(panel.getByText(/只给分析和选项，不创建候选/)).toBeVisible();
			await panel.getByRole("tab", { name: "检查正文" }).click();
			await expect(
				panel.getByRole("button", { name: "检查正文" }),
			).toBeVisible();
			await panel.getByRole("tab", { name: "生成候选" }).click();

			// Esc 关闭后焦点归还顶栏入口（验收 1）。
			await page.keyboard.press("Escape");
			await expect(panel).toHaveCount(0);
			await expect(
				page.getByRole("banner").getByRole("button", { name: /AI 助手/ }),
			).toBeFocused();
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test(`[${profile}] 可解释上下文：硬规则必带、人物与前文可撤回`, async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: `上下文-${profile}` });
		try {
			await seedProject(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await openBook(page, `上下文-${profile}`);

			await page
				.getByRole("banner")
				.getByRole("button", { name: /AI 助手/ })
				.click();
			const panel = drawer(page);
			await expect(panel).toBeVisible();

			// 预览装配是真实 RPC：包与关系图都进界面。
			const log = await rpcLog(page);
			const methods = log.map((entry) => entry.args?.request?.method ?? "");
			expect(methods).toContain("build_context_package");
			expect(methods).toContain("relationship_query");

			const contextCard = panel.getByRole("button", { name: /本次上下文/ });
			await contextCard.click();

			// 硬规则行：必带锁——勾选框禁用（验收 3）。
			const hardRuleLine = panel.locator("label, div").filter({
				hasText: "硬规则 2 条",
			});
			await expect(hardRuleLine.first()).toBeVisible();
			await expect(panel.getByText("必带 · 不可移除").first()).toBeVisible();

			// 人物行：来自真实 relationship_query；默认不代入，作者显式勾选。
			await expect(
				panel.getByText(/2 位可选人物，勾选后进入上下文/),
			).toBeVisible();

			// 勾选两位人物 → 行内出现人名与方向态度计数（真实关系数据）。
			await panel
				.locator("label", { hasText: "林舟" })
				.getByRole("checkbox")
				.check();
			await panel
				.locator("label", { hasText: "苏晚" })
				.getByRole("checkbox")
				.check();
			await expect(panel.getByText(/林舟、苏晚/)).toBeVisible();
			await expect(panel.getByText(/1 条方向态度/)).toBeVisible();

			// 正式前文：正典场景 1 项；勾选人物不得清空前文窗口。
			await expect(panel.getByText(/1 项正典场景/)).toBeVisible();

			// 撤回人物：chip 取消勾选 → 摘要变为「已调整」，剩余人物仍可见。
			await panel
				.locator("label", { hasText: "林舟" })
				.getByRole("checkbox")
				.uncheck();
			await expect(panel.getByText(/已调整 ·/)).toBeVisible();
			await expect(panel.getByText(/苏晚/).first()).toBeVisible();

			await expectNoPageHorizontalScroll(page);
			await page.keyboard.press("Escape");
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test(`[${profile}] 无服务商：人话失败、输入保留、三条恢复出路`, async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: `失败-${profile}` });
		try {
			await seedProject(page, dir);
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await openBook(page, `失败-${profile}`);

			await page
				.getByRole("banner")
				.getByRole("button", { name: /AI 助手/ })
				.click();
			const panel = drawer(page);
			await expect(panel).toBeVisible();

			const instruction = panel.getByRole("textbox", {
				name: /你希望这次推进什么/,
			});
			await instruction.fill("强化雾中相遇的张力。");
			await panel.getByRole("button", { name: "生成场景候选" }).click();

			const alert = panel.getByRole("alert");
			await expect(alert).toContainText("尚未配置任何服务商");
			await expect(instruction).toHaveValue("强化雾中相遇的张力。");
			await expect(panel.getByRole("button", { name: "重试" })).toBeVisible();
			await expect(
				panel.getByRole("button", { name: "更换模型" }),
			).toBeVisible();
			await expect(
				panel.getByRole("button", { name: "打开设置" }),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);
			await page.keyboard.press("Escape");
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
}

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runAssistantSuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runAssistantSuite("compact");
});
