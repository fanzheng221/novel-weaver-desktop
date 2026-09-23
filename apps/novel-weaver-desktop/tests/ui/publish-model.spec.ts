import { expect, test } from "@playwright/test";

/**
 * WF5-16（补充层，fixture 直打生产纯函数）：发布线性流程模型——
 *   1. buildPublishSnapshot 三情境：空项目 / 健康可定版 / 阻断混合
 *      （伏笔 + 发现按阻断在前排序、过期版本计数、一句话概览）。
 *   2. scope 系列：全书/卷/章范围 → 场景 id 解析（含跨章去重）与可发布判定。
 *   3. publishFlowReducer：步骤守卫、导出失败恢复（步骤/目录保留、重试清错）。
 *   4. canConfirm 定版门与 findingDeepLink 终审深链分流。
 */

test.describe("publish flow model", () => {
	test("快照三情境：空项目阻断、健康可定版、阻断混合排序与概览", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/publish-model.html");
		await page.getByRole("button", { name: "构建快照" }).click();
		const lines = page.getByTestId("snapshot-out").locator("li");

		// 空项目：无正文是唯一阻断，不可创建版本。
		await expect(lines.nth(0)).toContainText(
			"空项目｜ready=false｜blocking=1｜canCreate=false",
		);
		await expect(lines.nth(0)).toContainText(
			"blocking｜还没有已确认入正典的正文，先写出并确认第一章。｜#/writing",
		);
		await expect(lines.nth(0)).toContainText(
			"还没有定稿的发布版本。有 1 项必须先处理的问题。",
		);

		// 健康：已回收伏笔不算阻断；已定稿 1 版，无过期。
		await expect(lines.nth(1)).toContainText(
			"健康｜ready=true｜stale=0｜canCreate=true｜issues=0",
		);
		await expect(lines.nth(1)).toContainText(
			"已有 1 个发布版本定稿。没有阻断项，可以定版。",
		);

		// 阻断混合：伏笔与阻断发现排前（警告殿后）；过期版本如实计数。
		await expect(lines.nth(2)).toContainText(
			"阻断混合｜ready=false｜blocking=2｜stale=1｜pending=1",
		);
		await expect(lines.nth(2)).toContainText(
			"first=blocking｜未回收的伏笔：钟楼的钥匙｜#/planning/foreshadow",
		);
		await expect(lines.nth(2)).toContainText(
			"blocking｜死人复生违反硬规则「人死不能复生」。｜#/review",
		);
		await expect(lines.nth(2)).toContainText(
			"warning｜本场景节奏偏快。｜无深链",
		);
		await expect(lines.nth(2)).toContainText(
			"已有 2 个发布版本定稿（其中 1 个的正文已更新）。有 2 项必须先处理的问题。",
		);

		// 版本注记：过期版有人话提醒，新鲜版无注记。
		await expect(lines.nth(3)).toContainText("notes=这版定稿后，有 2 个场景的正文又更新过");
		await expect(lines.nth(4)).toContainText("notesFresh=无注记");
	});

	test("scope 系列：全书交核心、卷跨章去重、单章直取、空章不可发布", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/publish-model.html");
		await page.getByRole("button", { name: "解析范围" }).click();
		const lines = page.getByTestId("scope-out").locator("li");
		await expect(lines).toHaveCount(4);
		await expect(lines.nth(0)).toContainText(
			"全书｜全书｜ids=null｜hasScenes=true",
		);
		await expect(lines.nth(1)).toContainText(
			"卷｜卷 · 第一卷 雾城｜ids=[\"SC-A\",\"SC-B\",\"SC-C\"]｜hasScenes=true",
		);
		await expect(lines.nth(2)).toContainText(
			"章｜章 · 第 2 章 旧塔｜ids=[\"SC-B\",\"SC-C\"]｜hasScenes=true",
		);
		await expect(lines.nth(3)).toContainText(
			"空章｜章 · ｜ids=[]｜hasScenes=false",
		);
	});

	test("状态机：主线四步推进、失败恢复保留目录、无前置守卫不动", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/publish-model.html");
		await page.getByRole("button", { name: "跑状态机" }).click();
		const lines = page.getByTestId("reducer-out").locator("li");

		// 主线：编辑草稿 → 提案入确认 → 定版出导出步 → 成功收尾。
		await expect(lines.nth(0)).toContainText(
			"主线=初始 step=check 目录=/tmp/exports",
		);
		await expect(lines.nth(0)).toContainText("editDraft step=check");
		await expect(lines.nth(0)).toContainText(
			"proposalReviewed step=confirm phase=idle 无错误 无版本",
		);
		await expect(lines.nth(0)).toContainText(
			"confirmAccepted step=export phase=idle 无错误 版=雾城来信",
		);
		await expect(lines.nth(0)).toContainText(
			"exportStarted step=export phase=exporting",
		);
		await expect(lines.nth(0)).toContainText(
			"exportSucceeded step=export phase=done 无错误 版=雾城来信",
		);

		// 失败恢复：失败不回退步骤与目录；换目录重试后清错成功。
		await expect(lines.nth(1)).toContainText(
			"exportFailed step=export phase=failed err=目标目录已有同名文件，不会被自动覆盖。 版=第一卷试读",
		);
		await expect(lines.nth(1)).toContainText(
			"setExportDirectory step=export phase=failed",
		);
		await expect(lines.nth(1)).toContainText(
			"exportSucceeded step=export phase=done 无错误 版=第一卷试读",
		);

		// 守卫：确认/导出缺前置时 goToStep 原地不动；version 可直达。
		await expect(lines.nth(2)).toContainText(
			"守卫=初始 step=check 目录=/tmp/exports ;; goToStep step=check phase=idle 无错误 无版本 ;; goToStep step=check phase=idle 无错误 无版本 ;; goToStep step=version phase=idle 无错误 无版本",
		);
	});

	test("终审门与深链：阻断禁定版，场景问题回审校、伏笔回规划", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/publish-model.html");
		await page.getByRole("button", { name: "检查终审" }).click();
		const lines = page.getByTestId("misc-out").locator("li");
		await expect(lines.nth(0)).toHaveText("canConfirm=可定版/阻断");
		await expect(lines.nth(1)).toHaveText("sceneBlocker=#/review");
		await expect(lines.nth(2)).toHaveText("promise=#/planning/foreshadow");
		await expect(lines.nth(3)).toHaveText("other=无");
	});
});
