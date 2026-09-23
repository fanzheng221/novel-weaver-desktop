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
 * WF5-15：统一审校收件箱。全部经真实链路——浏览器 invoke 垫片 →
 * /__nw/local-rpc → 真实 local-core 进程 → SQLite。覆盖：聚合呈现与
 * 作者语言（不暴露内部 ID）、阻断先裁决再确认的就地闭环、发现裁决同步、
 * 规划/设定条目深链回原工作区、设定批准后候选过期提醒、双视口稳定。
 */

async function seedInboxWorld(page: Page, dir: string): Promise<void> {
	await coreRequest(page, dir, "create_design_proposal", {
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
	});
	const design = await coreRequest<
		Array<{ proposalId: string; kind: string; revision: number }>
	>(page, dir, "list_pending_proposals", {}).then((items) =>
		items.find((item) => item.kind === "design_change"),
	);
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: design!.proposalId,
		expectedRevision: design!.revision,
	});

	// 待确认候选：一条阻断 + 一条警告发现。
	const pending = await coreRequest<{
		proposalId: string;
		sceneVersionId: string;
	}>(page, dir, "create_scene_candidate", {
		title: "码头夜雾",
		markdown: "林舟在码头追查钥匙的下落，死人竟站了起来。",
		narrativeMode: "third_person_limited",
		viewpointCharacterId: "CHAR-LIN",
		continuityId: "main",
		storyOrder: 20,
		purposes: ["追查钥匙"],
	});
	await coreRequest(page, dir, "record_scene_review", {
		proposalId: pending.proposalId,
		candidateVersionId: pending.sceneVersionId,
		findings: [
			{
				severity: "blocking",
				confidence: 0.9,
				code: "RULE_VIOLATION",
				message: "死人复生违反硬规则「人死不能复生」。",
				evidence: [],
			},
			{
				severity: "warning",
				confidence: 0.6,
				code: "PACING",
				message: "本场景节奏偏快。",
				evidence: [],
			},
		],
	});

	// 待确认规划变更（场景计划）。
	await coreRequest(page, dir, "create_artifact_proposal", {
		kind: "scene_plan",
		title: "场景计划 · 码头夜雾",
		dependencyIds: [],
		content: { purpose: "追查钥匙", continuityId: "main", storyOrder: 20 },
	});

	// 待确认设定修订（改硬规则）。
	await coreRequest(page, dir, "create_design_proposal", {
		hardRules: [
			{
				id: "RULE-DEATH",
				name: "人死不能复生（修订）",
				description: "死亡即终局，任何道具不能逆转。",
				examples: [],
			},
		],
	});
}

/** 打开项目、播种收件箱世界并进入审校区。 */
async function openReviewArea(page: Page, name: string): Promise<string> {
	const dir = await createTempProject(page, { name });
	try {
		await configureSession(page, { defaultCwd: dir, fault: "none" });
		await page.goto("/");
		const card = page.getByRole("article", { name: `书籍：${name}` });
		await card.getByRole("button", { name: "打开书籍" }).click();
		await expect(page.getByRole("banner")).toBeVisible();
		await seedInboxWorld(page, dir);
		await page
			.getByRole("complementary", { name: "导航侧栏" })
			.getByRole("button", { name: "审校", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "审校收件箱" }),
		).toBeVisible();
		await expect(page.getByText("待处理 · 5")).toBeVisible();
		return dir;
	} catch (error) {
		await disposeTempProjectDir(dir);
		throw error;
	}
}

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runInboxSuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runInboxSuite("compact");
});

function runInboxSuite(profile: string): void {
	test(`[${profile}] 聚合呈现：作者语言条目、类型计数、阻断在前、无内部 ID`, async ({
		page,
	}) => {
		const dir = await openReviewArea(page, `收件箱-${profile}`);
		try {
			// 类型 chips 计数：候选 1、规划 1、设定 1、问题 2（发现是一等条目）。
			await expect(
				page.getByRole("button", { name: /场景候选 1/ }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: /规划变更 1/ }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: /设定修订 1/ }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: /审校问题 2/ }),
			).toBeVisible();
			// 阻断提醒入口可见：候选概况与阻断发现条目各计一次。
			await expect(
				page.getByRole("button", { name: /仅看必须处理的/ }),
			).toContainText("2");

			// 条目作者语言：为什么现在需要处理，而不是内部状态名。
			const candidateEntry = page.getByText("码头夜雾", { exact: true }).first();
			await expect(candidateEntry).toBeVisible();
			await expect(
				page.getByText(/审校发现 1 条必须先处理的问题/),
			).toBeVisible();
			await expect(
				page.getByText("规划变更等你确认，确认后进入正典。"),
			).toBeVisible();
			// 阻断发现是一等条目。
			await expect(
				page.getByText("死人复生违反硬规则「人死不能复生」。").first(),
			).toBeVisible();

			// 实现词与内部 ID 不得出现在主区。
			const mainText = await page.getByRole("main").first().innerText();
			expect(mainText, "不得暴露内部 ID").not.toMatch(/PRP-|SCV-|ART-|RULE-/);
			expect(mainText, "不得出现实现词 proposal/candidate").not.toMatch(
				/proposal|stale/i,
			);
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test(`[${profile}] 就地闭环：裁决阻断 → 确认入正典 → 收件箱同步清空`, async ({
		page,
	}) => {
		const dir = await openReviewArea(page, `闭环-${profile}`);
		try {
			// 点开候选条目 → 处理面板出现（Panel 标题是 eyebrow 文本）。
			await page.getByRole("button", { name: /码头夜雾/ }).first().click();
			const detail = page.getByText("处理 · 码头夜雾");
			await expect(detail).toBeVisible();

			// 阻断说明：先裁决才能确认。
			await expect(
				page.getByText(/存在未裁决的阻断问题/),
			).toBeVisible();

			// 裁决阻断发现：判为误报 + 理由 → 生效（阻断组排最前）。
			await page.getByRole("button", { name: "裁决此问题" }).first().click();
			await page.getByRole("button", { name: "判为误报" }).click();
			await page
				.getByRole("textbox", { name: /裁决理由/ })
				.fill("本场景是主角的噩梦幻象，并非真实复活，判为误报。");
			await page.getByRole("button", { name: "提交裁决并生效" }).click();

			// 阻断裁决后：提示消失，可确认。
			await expect(page.getByText(/存在未裁决的阻断问题/)).toHaveCount(0);
			await page
				.getByRole("button", { name: "确认入正典", exact: true })
				.click();
			await expect(page.getByText("已确认入正典。")).toBeVisible();

			// 收件箱同步：候选与其发现条目一起消失，剩规划变更与设定修订。
			await expect(page.getByText("待处理 · 2")).toBeVisible();
			await expect(
				page.getByRole("button", { name: /码头夜雾 场景候选/ }),
			).toHaveCount(0);
			await expect(
				page.getByText("死人复生违反硬规则「人死不能复生」。"),
			).toHaveCount(0);
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test(`[${profile}] 深链：规划条目回到规划区处理，返回后条目仍在`, async ({
		page,
	}) => {
		const dir = await openReviewArea(page, `深链-${profile}`);
		try {
			await page.getByRole("button", { name: "去规划区处理" }).click();
			await expect(
				page.getByRole("heading", { name: "大纲工作区" }),
			).toBeVisible();

			// 回审校区：规划变更条目仍在（未就地确认，收件箱不撒谎）。
			await page
				.getByRole("complementary", { name: "导航侧栏" })
				.getByRole("button", { name: "审校", exact: true })
				.click();
			await expect(
				page.getByText("场景计划 · 码头夜雾").first(),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test(`[${profile}] 过期与影响：设定修订批准后候选提醒基准已变化`, async ({
		page,
	}) => {
		const dir = await openReviewArea(page, `过期-${profile}`);
		try {
			// 播种一条新鲜候选（无发现），再批准一条设定修订使其过期。
			// 播种经核心直连（浏览器外），收件箱靠切区重挂载拉到新投影。
			await coreRequest(page, dir, "create_scene_candidate", {
				title: "钟楼对峙",
				markdown: "林舟在钟楼顶与来人对话。",
				narrativeMode: "third_person_limited",
				viewpointCharacterId: "CHAR-LIN",
				continuityId: "main",
				storyOrder: 30,
				purposes: ["日常推进"],
			});
			const nav = page.getByRole("complementary", { name: "导航侧栏" });
			await nav.getByRole("button", { name: "写作", exact: true }).click();
			await nav.getByRole("button", { name: "审校", exact: true }).click();
			await expect(page.getByText("待处理 · 6")).toBeVisible();

			const revision = await coreRequest<
				Array<{ proposalId: string; kind: string; revision: number }>
			>(page, dir, "list_pending_proposals", {}).then((items) =>
				items.find((item) => item.kind === "design_change"),
			);
			await coreRequest(page, dir, "approve_proposal", {
				proposalId: revision!.proposalId,
				expectedRevision: revision!.revision,
			});
			await nav.getByRole("button", { name: "写作", exact: true }).click();
			await nav.getByRole("button", { name: "审校", exact: true }).click();

			// 收件箱同步：设定修订条目消失；两条候选出现「基准已变化」提醒。
			await expect(page.getByText("待处理 · 5")).toBeVisible();
			await expect(
				page.getByText(/它依赖的创作基准（规则、设定或已确认正文）变了/),
			).toHaveCount(2);

			// 批准门如实前置拦截：过期候选不开放确认，给重新生成的下一步。
			await page.getByRole("button", { name: /钟楼对峙/ }).first().click();
			await expect(page.getByText("处理 · 钟楼对峙")).toBeVisible();
			await expect(
				page.getByRole("button", { name: "确认入正典", exact: true }),
			).toHaveCount(0);
			await expect(
				page.getByText(/这份稿子基于旧基准，无法直接确认。回写作台重新生成/),
			).toBeVisible();
			await expect(page.getByText("待处理 · 5")).toBeVisible();
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
}
