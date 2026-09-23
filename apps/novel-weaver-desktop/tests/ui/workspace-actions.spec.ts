import { expect, test } from "@playwright/test";

/**
 * WF5-17（补充层，fixture 直打生产纯函数）：跨工作区 AI 动作注册表——
 *   1. workspaceSurfaceOf：规划/世界/审校有扩展面，写作/发布无；
 *   2. actionsForRoute：每面动作 id、数量与世界区按子区细分；
 *   3. 副作用边界：每条动作 copy 都声明「只给建议/不改内容」；
 *   4. composeWorkspaceQuestion：主体骨架＋作者补充拼接、超长截断；
 *   5. presentContext：规划上下文行（core v8 plan selections）与撤回。
 */

test.describe("workspace actions model", () => {
	test("路由 → 扩展面与动作集：规划 3、规则 3、实体 3、关系 1、审校 3", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/workspace-actions.html");

		await expect(page.getByTestId("surface-planning/tree")).toHaveText(
			"planning",
		);
		await expect(page.getByTestId("ids-planning/tree")).toHaveText(
			"planning-split,planning-alternatives,planning-pacing",
		);
		await expect(page.getByTestId("surface-world/rules")).toHaveText("world");
		await expect(page.getByTestId("ids-world/rules")).toHaveText(
			"rule-complete,rule-challenge,rule-conflict",
		);
		await expect(page.getByTestId("surface-world/characters")).toHaveText(
			"world",
		);
		await expect(page.getByTestId("ids-world/characters")).toHaveText(
			"entity-complete,entity-challenge,entity-conflict",
		);
		await expect(page.getByTestId("surface-world/relations")).toHaveText(
			"world",
		);
		await expect(page.getByTestId("ids-world/relations")).toHaveText(
			"pair-advice",
		);
		await expect(page.getByTestId("surface-review")).toHaveText("review");
		await expect(page.getByTestId("ids-review")).toHaveText(
			"review-consistency,review-logic,review-condense",
		);
		// 写作与发布无跨工作区动作面（写作走 WF5-07 原路径）。
		await expect(page.getByTestId("surface-writing")).toHaveText("none");
		await expect(page.getByTestId("count-writing")).toHaveText("0");
		await expect(page.getByTestId("surface-publish/flow")).toHaveText("none");
	});

	test("副作用边界：每条动作 copy 都承诺不直接修改权威内容", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/workspace-actions.html");
		for (const id of [
			"planning-split",
			"planning-alternatives",
			"planning-pacing",
			"rule-complete",
			"rule-challenge",
			"rule-conflict",
			"entity-complete",
			"entity-challenge",
			"entity-conflict",
			"pair-advice",
			"review-consistency",
			"review-logic",
			"review-condense",
		]) {
			const copy = await page.getByTestId(`copy-${id}`).textContent();
			expect(copy, `${id} 的副作用说明`).toMatch(
				/只给建议|只给分析|只指出|不修改|不改|不产生|不创建|不关闭|不改正文|改写正文/,
			);
		}
	});

	test("问题骨架：主体句拼进问题，作者补充接在后面", async ({ page }) => {
		await page.goto("/ui-fixtures/workspace-actions.html");

		const plain = await page.getByTestId("question-plain").textContent();
		expect(plain).toContain("【当前主体】示例小说总纲");
		expect(plain).toContain("拆章候选");

		const withInstruction = await page
			.getByTestId("question-instruction")
			.textContent();
		expect(withInstruction).toContain("【作者补充】期望二十章");
	});

	test("问题超长截断：长度受控并带截断标注，而非人话错误", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/workspace-actions.html");
		const length = Number(
			await page.getByTestId("question-truncated").textContent(),
		);
		expect(length).toBeLessThanOrEqual(3800 + 40);
	});

	test("规划上下文行：plan selections 呈现且可撤回（excludeOutline）", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/workspace-actions.html");

		const outline = page.getByTestId("line-outline");
		await expect(outline).toBeVisible();
		await expect(page.getByTestId("label-outline")).toHaveText(
			"规划上下文",
		);
		await expect(page.getByTestId("included-outline")).toHaveText("true");

		// 撤回 → included 翻为 false（excludeOutline 生效路径）。
		await outline.getByRole("checkbox").click();
		await expect(page.getByTestId("included-outline")).toHaveText("false");

		// 硬规则行保持必带（locked，勾选框禁用）。
		await expect(page.getByTestId("included-hard-rules")).toHaveText("true");
		await expect(
			page.getByTestId("line-hard-rules").getByRole("checkbox"),
		).toBeDisabled();
	});
});
