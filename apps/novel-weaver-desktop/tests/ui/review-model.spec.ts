import { expect, test } from "@playwright/test";

/**
 * WF5-15（补充层，fixture 直打生产纯函数）：统一审校收件箱模型——
 *   1. buildInboxEntries：提案 + 发现聚合成作者语言条目，阻断级排前。
 *   2. whyNow 逐情境翻译：可确认 / 基线过期 / 正文更新 / 阻断发现待裁决。
 *   3. 冲突与影响提醒来自核心投影，深链落点按种类分流，标题不暴露 ID。
 *   4. filterInboxEntries：类别筛选 + 仅看阻断；inboxCounts 供筛选 chips。
 */

test.describe("review inbox model", () => {
	test("聚合与排序：提案+发现统一条目，阻断级在前，种类与深链正确", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/review-model.html");
		await page.getByRole("button", { name: "构建条目" }).click();
		const lines = page.getByTestId("entries-out").locator("li");
		await expect(lines).toHaveCount(9);
		// 阻断级排最前：候选的阻断概况与阻断问题条目。
		await expect(lines.nth(0)).toContainText("场景候选｜雾中来客｜blocking｜");
		await expect(lines.nth(0)).toContainText(
			"审校发现 1 条必须先处理的问题",
		);
		await expect(lines.nth(1)).toContainText(
			"审校问题｜死人复生违反硬规则「人死不能复生」。｜blocking｜这条问题不处理，对应的候选无法确认入正典。｜inbox",
		);
		// 可确认候选：留在收件箱内处理。
		await expect(lines.nth(5)).toContainText("场景候选｜钟楼对峙｜none｜");
		await expect(lines.nth(5)).toContainText(
			"审校已完成，没有遗留问题，可以确认入正典。｜inbox",
		);
		// 规划变更：冲突 + 影响提醒 + 规划区深链。
		await expect(lines.nth(6)).toContainText("规划变更｜场景计划 · 码头夜雾｜");
		await expect(lines.nth(6)).toContainText(
			"另有 1 份待确认修订在改同一个对象",
		);
		await expect(lines.nth(6)).toContainText(
			"确认后，2 份还在等确认的稿子会随之过期。",
		);
		await expect(lines.nth(6)).toContainText("planning/outline");
		// 设定修订 → 设定区；发布 → 发布区（WF5-16 起落线性发布流程）。
		await expect(lines.nth(7)).toContainText("设定修订｜人死不能复生（修订）｜");
		await expect(lines.nth(7)).toContainText("world/rules");
		await expect(lines.nth(8)).toContainText("发布提案｜发布提案｜");
		await expect(lines.nth(8)).toContainText("publish/flow");
	});

	test("whyNow 逐情境翻译：过期与正文更新用作者语言呈现", async ({ page }) => {
		await page.goto("/ui-fixtures/review-model.html");
		await page.getByRole("button", { name: "构建条目" }).click();
		const lines = page.getByTestId("entries-out").locator("li");
		await expect(lines.nth(2)).toContainText(
			"场景候选｜码头夜雾｜warning｜它依赖的创作基准（规则、设定或已确认正文）变了",
		);
		await expect(lines.nth(3)).toContainText(
			"场景候选｜旧稿修订｜warning｜它修订的那份正文已有更新的确认版本",
		);
	});

	test("计数与筛选：类别 chips 计数准确，仅看阻断过滤非阻断", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/review-model.html");
		await page.getByRole("button", { name: "构建条目" }).click();
		await expect(page.getByTestId("counts-out")).toHaveText(
			"all=9 blocking=2 candidate=4 plan=1 design=1 publish=1 finding=2",
		);

		const filtered = page.getByTestId("filter-out").locator("li");
		await page.getByRole("button", { name: "只看候选" }).click();
		await expect(filtered).toHaveCount(4);
		await expect(filtered.nth(0)).toHaveText("雾中来客:blocking");
		await expect(filtered.nth(1)).toHaveText("码头夜雾:warning");
		await expect(filtered.nth(2)).toHaveText("旧稿修订:warning");
		await expect(filtered.nth(3)).toHaveText("钟楼对峙:none");

		await page.getByRole("button", { name: "只看问题" }).click();
		await expect(filtered).toHaveCount(2);
		await expect(filtered.nth(1)).toHaveText("本场景节奏偏快。:warning");

		await page.getByRole("button", { name: "重置类别" }).click();
		await page.getByRole("button", { name: "仅看阻断" }).click();
		await expect(filtered).toHaveCount(2);
		await expect(page.getByTestId("filter-label")).toHaveText("全部 · 仅阻断");
	});
});
