import { expect, test } from "@playwright/test";

import { contrastRatio } from "./helpers/color";

const VIEWPORTS = [
	{ name: "wide 1180×760", viewport: { width: 1180, height: 760 } },
	{ name: "compact 800×600", viewport: { width: 800, height: 600 } },
] as const;

for (const profile of VIEWPORTS) {
	test.describe(profile.name, () => {
		test.use({ viewport: profile.viewport });

		/**
		 * WF5-04 子区切换条（补充层）：选中态用 aria-current 表达、回调真实触发、
		 * 键盘可完成切换，活动项文字与 rail-active 表面对比度达 AA。
		 */
		test("workspace tabs expose current state and keyboard operation", async ({
			page,
		}, testInfo) => {
			await page.goto("/ui-fixtures/workspace-tabs.html");

			const strip = page.getByRole("navigation", { name: "规划子区" });
			await expect(strip).toBeVisible();

			const activeButton = strip.getByRole("button", { name: "伏笔追踪" });
			await expect(activeButton).toHaveAttribute("aria-current", "page");
			await expect(page.getByTestId("workspace-tabs-status")).toHaveText(
				"当前子区：foreshadow",
			);

			// 指针路径：点击切换子区。
			await strip.getByRole("button", { name: "章节大纲" }).click();
			await expect(page.getByTestId("workspace-tabs-status")).toHaveText(
				"当前子区：outline",
			);
			await expect(
				strip.getByRole("button", { name: "章节大纲" }),
			).toHaveAttribute("aria-current", "page");

			// 键盘路径：Tab 聚焦下一子区 → Enter 切换。
			await strip.getByRole("button", { name: "章节大纲" }).focus();
			await page.keyboard.press("Tab");
			await expect(
				strip.getByRole("button", { name: "伏笔追踪" }),
			).toBeFocused();
			await page.keyboard.press("Enter");
			await expect(page.getByTestId("workspace-tabs-status")).toHaveText(
				"当前子区：foreshadow",
			);

			// 活动态视觉：rail-active 表面 + AA 文字对比度（与深色导航同一令牌基线）。
			const styles = await page.evaluate(() => {
				const current = [
					...document.querySelectorAll<HTMLButtonElement>("button"),
				].find((button) => button.getAttribute("aria-current") === "page");
				if (!current) throw new Error("No aria-current tab found.");
				const surface = getComputedStyle(current).backgroundColor;
				return { color: getComputedStyle(current).color, surface };
			});
			expect(styles.surface, "选中子区必须使用 rail-active 令牌").toBe(
				"rgb(38, 41, 46)",
			);
			const contrast = contrastRatio(styles.color, styles.surface);
			expect(
				contrast,
				`选中子区文字对比度 ${contrast.toFixed(2)}:1`,
			).toBeGreaterThanOrEqual(4.5);

			await testInfo.attach("workspace-tabs-styles", {
				body: JSON.stringify({ ...styles, contrast }, null, 2),
				contentType: "application/json",
			});
		});
	});
}
