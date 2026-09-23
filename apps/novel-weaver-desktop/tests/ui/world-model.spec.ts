import { expect, test } from "@playwright/test";

/**
 * WF5-11（补充层，fixture 直打生产纯函数）：世界区共享领域模型——
 *   1. subOfEntity 人物/设定子区切分；tagPoolOf 标签池；entitiesWithTag 筛选。
 *   2. searchWorld 跨规则/实体/关系命中；无命中为空。
 *   3. relationsOfCharacter 只取触及该人物的客观关系边。
 *   4. readProfile / parseTags / newEntityId / attributeText 基础工具。
 */

test.describe("world model", () => {
	test("子区切分：人物归人物，其余归设定；标签池排序；标签筛选", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/world-model.html");
		await page.getByRole("button", { name: "切片" }).click();
		await expect(page.getByTestId("slice-out").locator("li")).toHaveText([
			"characters=CHAR-LIN",
			"lore=ENT-DOCK,ENT-TERM",
			"pool=主角|漕帮",
			"tagged=CHAR-LIN,ENT-DOCK",
			"taggedAll=3",
		]);
	});

	test("全文检索：规则、人物、关系可命中，无命中为空", async ({ page }) => {
		await page.goto("/ui-fixtures/world-model.html");
		await page.getByRole("button", { name: "搜人物" }).click();
		// 「林舟」同时命中人物实体与其客观关系边。
		await expect(page.getByTestId("search-out").locator("li")).toHaveText([
			"entity-CHAR-LIN:林舟",
			"rel-CHAR-LIN-CHAR-SU-ally_of:林舟 — 盟友 → 苏晚",
		]);
		await page.getByRole("button", { name: "搜硬规则" }).click();
		await expect(page.getByTestId("search-out").locator("li")).toHaveText([
			"rule-RULE-DEATH:人死不能复生",
		]);
		await page.getByRole("button", { name: "搜关系" }).click();
		await expect(
			page.getByTestId("search-out").locator("li").first(),
		).toContainText("rel-CHAR-LIN-CHAR-SU-ally_of");
		await page.getByRole("button", { name: "搜不中" }).click();
		await expect(page.getByTestId("search-out").locator("li")).toHaveCount(0);
	});

	test("关系切片与档案工具：客观关系边、属性文本、标签解析、编号不碰撞", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/world-model.html");
		await page.getByRole("button", { name: "林舟的关系" }).click();
		await expect(page.getByTestId("search-out").locator("li")).toHaveText([
			"CHAR-LIN->CHAR-SU:ally_of",
		]);
		await page.getByRole("button", { name: "档案与工具" }).click();
		await expect(page.getByTestId("search-out").locator("li")).toHaveText([
			"personality=隐忍",
			"tags=主角|漕帮",
			"attrs=tags:漕帮",
			"parsed=主角|漕帮",
			"uniqueId=true",
			"uniqueIdNoCollide=true",
		]);
	});
});
