import { expect, test } from "@playwright/test";

/**
 * WF5-02 用例 2（补充层）：缺失项目路径时表单禁用、有指引、无静默可点击面。
 * 真实 RPC 链路断言在 tests/e2e（outline-proposal-p0）完成。
 */
for (const viewport of [
	{ name: "wide 1180×760", viewport: { width: 1180, height: 760 } },
	{ name: "compact 800×600", viewport: { width: 800, height: 600 } },
]) {
	test.describe(viewport.name, () => {
		test.use({ viewport: viewport.viewport });

		test("无项目路径：提案表单禁用并解释如何重新选择项目", async ({ page }) => {
			await page.goto("/ui-fixtures/proposal-form-no-cwd.html");

			const form = page.getByRole("main");
			await expect(form).toBeVisible();
			await expect(
				form.getByText("当前没有已选项目，无法创建提案"),
			).toBeVisible();
			await expect(form.getByText(/回到启动页重新选择一本书/)).toBeVisible();

			const submit = form.getByRole("button", { name: "创建提案（待批准）" });
			await expect(submit).toBeDisabled();
			// 表单容器整体呈现不可用语义。
			await expect(
				form.locator("[aria-disabled='true']").first(),
			).toBeVisible();
			// 无标题字段、无任何可触发 RPC 的输入面。
			await expect(form.getByLabel("标题")).toHaveCount(0);
		});
	});
}
