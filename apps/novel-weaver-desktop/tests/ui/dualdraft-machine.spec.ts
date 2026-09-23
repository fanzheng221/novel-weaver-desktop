import { expect, test } from "@playwright/test";

/**
 * WF5-09（补充层，fixture 直打生产 reducer/纯函数）：双稿裁决——
 *   1. 差异句段提取只列差异：一致段不出卡；续写判 append；改写判 replace；
 *      新段判 insert-after；空正文全 insert；完全一致零卡。
 *   2. 勾选即采用、零勾选与正文一致（applySegments 纯函数）。
 *   3. 状态机：comparing↔adopted（撤销保留勾选）、full 产物、放弃关会话。
 */

test.describe("dual-draft segments", () => {
	test("mixed base extracts replace + append + insert-after, skips identical paragraphs", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/dualdraft-machine.html");
		await page.getByRole("button", { name: "提取差异（混合）" }).click();

		const segments = page.getByTestId("seg-list").locator("li");
		await expect(segments).toHaveText([
			"接在第 2 段末尾｜那一瞬的停顿比训斥更短，也更重。｜目标段2",
			"替换第 3 段｜角色甲重新握剑。他知道父亲看见了。｜目标段3",
			"新增一段（第 3 段之后）｜院墙外，马蹄声碾过青石板。｜目标段3",
		]);
	});

	test("empty base lists every candidate paragraph as a new segment", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/dualdraft-machine.html");
		await page.getByRole("button", { name: "提取差异（空正文）" }).click();
		await expect(page.getByTestId("seg-list").locator("li")).toHaveText([
			"新增一段 · 第 1 段之前｜全新一段正文。｜目标段0",
			"新增一段 · 第 1 段之前｜第二段。｜目标段0",
		]);
	});

	test("identical texts produce zero segments", async ({ page }) => {
		await page.goto("/ui-fixtures/dualdraft-machine.html");
		await page.getByRole("button", { name: "提取差异（完全一致）" }).click();
		await expect(page.getByTestId("seg-list").locator("li")).toHaveCount(0);
	});

	test("applySegments: checked adoption rewrites, zero-check keeps base", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/dualdraft-machine.html");

		await page.getByRole("button", { name: "零勾选应用" }).click();
		await expect(page.getByTestId("adopted-count")).toHaveText("0");
		await expect(page.getByTestId("merged-markdown")).toContainText(
			"角色乙立在廊下。",
		);
		await expect(page.getByTestId("merged-markdown")).not.toContainText(
			"停顿比训斥更短",
		);

		await page.getByRole("button", { name: "应用前两个句段" }).click();
		await expect(page.getByTestId("adopted-count")).toHaveText("2");
		const merged = page.getByTestId("merged-markdown");
		await expect(merged).toContainText(
			"角色乙立在廊下。那一瞬的停顿比训斥更短，也更重。",
		);
		await expect(merged).toContainText("角色甲重新握剑。");
		// 第 3 段被替换；未勾选的新增段不出现
		await expect(merged).not.toContainText("他记得七岁那年");
		await expect(merged).not.toContainText("马蹄声碾过青石板");
	});
});

test.describe("dual-draft machine", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/ui-fixtures/dualdraft-machine.html");
		await page.getByRole("button", { name: "打开会话" }).click();
		await expect(page.getByTestId("phase")).toHaveText("comparing");
		await expect(page.getByTestId("segments-count")).toHaveText("3");
	});

	test("confirm partial adoption and undo keeps selection", async ({
		page,
	}) => {
		await page.getByRole("button", { name: "勾选首句段" }).click();
		await expect(page.getByTestId("checked-count")).toHaveText("1");

		await page.getByRole("button", { name: "确认局部采用" }).click();
		await expect(page.getByTestId("phase")).toHaveText("adopted");
		await expect(page.getByTestId("result-mode")).toHaveText("partial");
		await expect(page.getByTestId("result-adopted")).toHaveText("1");

		await page.getByRole("button", { name: "撤销本次采用" }).click();
		await expect(page.getByTestId("phase")).toHaveText("comparing");
		await expect(page.getByTestId("checked-count")).toHaveText("1");
	});

	test("full adoption marks mode full; discard closes session", async ({
		page,
	}) => {
		await page.getByRole("button", { name: "作为新草稿" }).click();
		await expect(page.getByTestId("phase")).toHaveText("adopted");
		await expect(page.getByTestId("result-mode")).toHaveText("full");

		await page.getByRole("button", { name: "放弃候选（关闭会话）" }).click();
		await expect(page.getByTestId("phase")).toHaveText("none");
	});

	test("selection cleared resets checks", async ({ page }) => {
		await page.getByRole("button", { name: "勾选首句段" }).click();
		await page.getByRole("button", { name: "撤销选择" }).click();
		await expect(page.getByTestId("checked-count")).toHaveText("0");
	});
});
