import { expect, test } from "@playwright/test";

/**
 * WF5-07（补充层，fixture 直打生产 reducer）：
 * 助手状态机的三类副作用边界与取消语义——
 *   1. 只有「候选成功」进入候选带；讨论/检查各自独立、互不越界；
 *   2. 取消后运行编号归零，迟到结果整体丢弃，不遗留半成品候选；
 *   3. 屏幕阅读器播报是唯一整句阶段状态（fixture 内不出现 token 数字）。
 */

async function clickButton(
	page: import("@playwright/test").Page,
	name: string,
) {
	await page.getByRole("button", { name }).click();
}

test.describe("wide 1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });

	test("candidate success is the only path into the candidate band", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/assistant-machine.html");

		// 讨论 → 只写讨论区；候选带保持为空。
		await clickButton(page, "开始运行");
		await clickButton(page, "讨论成功");
		await expect(page.getByTestId("discussion")).toHaveText("推演回应");
		await expect(page.getByTestId("candidates")).toHaveText("0");

		// 候选 → 只进候选带；讨论不被清掉。
		await clickButton(page, "开始运行");
		await clickButton(page, "候选成功");
		await expect(page.getByTestId("candidates")).toHaveText("1");
		await expect(page.getByTestId("latest-candidate")).toHaveText("雾中来客");
		await expect(page.getByTestId("discussion")).toHaveText("推演回应");

		// 检查 → 只写建议区；候选带不受影响。
		await clickButton(page, "开始运行");
		await clickButton(page, "检查成功");
		await expect(page.getByTestId("suggestions")).toHaveText("检查建议");
		await expect(page.getByTestId("candidates")).toHaveText("1");
	});

	test("cancel invalidates the run; late results are dropped", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/assistant-machine.html");

		await clickButton(page, "开始运行");
		await clickButton(page, "进入生成");
		await expect(page.getByTestId("phase")).toHaveText("running");

		await clickButton(page, "取消");
		await expect(page.getByTestId("phase")).toHaveText("cancelled");
		await expect(page.getByTestId("active-run")).toHaveText("0");

		// 迟到的候选结果按 runId 丢弃：不产生候选、不进入完成态。
		await clickButton(page, "迟到候选");
		await expect(page.getByTestId("candidates")).toHaveText("0");
		await expect(page.getByTestId("phase")).toHaveText("cancelled");
	});
});
