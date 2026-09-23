import { expect, test } from "@playwright/test";

import { contrastRatio } from "./helpers/color";

/**
 * WF5-06 左栏与调宽（补充层，fixture 直打生产组件）：
 * 14px/42px 可读性基线、aria-current 选中态、separator 键盘等价、
 * 拖拽即时反馈且不选中正文、宽度本地偏好持久化、双击/Home 复位。
 */

test.describe("wide 1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });

	test("scene rail readability, selection and contrast", async ({
		page,
	}, testInfo) => {
		await page.goto("/ui-fixtures/scene-rail.html");
		const rail = page.getByRole("navigation", { name: "章节与场景" });
		await expect(rail).toBeVisible();

		// 三层定位：卷 → 章 → 场景（含未分章）。
		await expect(rail.getByText("第一卷 · 战讯入宅")).toBeVisible();
		await expect(rail.getByText("第 1 章 · 庭院")).toBeVisible();
		const activeRow = rail.getByRole("button", { name: /庭院练武/ });
		await expect(activeRow).toHaveAttribute("aria-current", "true");

		// 可读性基线：场景行文字 14px、命中高度 ≥42px（作者确认）。
		const rowBox = await activeRow.boundingBox();
		expect(rowBox?.height).toBeGreaterThanOrEqual(42);
		const rowFont = await activeRow.evaluate(
			(el) => getComputedStyle(el).fontSize,
		);
		expect(Number.parseFloat(rowFont)).toBeGreaterThanOrEqual(14);

		// 选中态视觉：rail-active 表面＋AA 对比度（与既有导航同一令牌基线）。
		const styles = await activeRow.evaluate((el) => ({
			color: getComputedStyle(el).color,
			surface: getComputedStyle(el).backgroundColor,
		}));
		expect(styles.surface, "选中场景行必须使用 rail-active 令牌").toBe(
			"rgb(38, 41, 46)",
		);
		const contrast = contrastRatio(styles.color, styles.surface);
		expect(
			contrast,
			`选中行对比度 ${contrast.toFixed(2)}:1`,
		).toBeGreaterThanOrEqual(4.5);

		// 指针路径：点击切换选中（真实回调）。
		await rail.getByRole("button", { name: /率部突围/ }).click();
		await expect(page.getByTestId("selected-key")).toHaveText("plan:p3");
		await expect(
			rail.getByRole("button", { name: /率部突围/ }),
		).toHaveAttribute("aria-current", "true");
		// 待写行与草稿行的状态标识。
		await expect(rail.getByRole("button", { name: /率部突围/ })).toContainText(
			"待写",
		);
		await expect(rail.getByRole("button", { name: /战讯至门/ })).toContainText(
			"草稿",
		);

		await testInfo.attach("scene-rail", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
	});

	test("resizer: keyboard equivalence, reset and persistence", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/scene-rail.html");
		const resizer = page.getByRole("separator", { name: "调整章节栏宽度" });
		await expect(resizer).toHaveAttribute("aria-valuenow", "232");

		// 键盘微调：→ +12，← -12。
		await resizer.focus();
		await page.keyboard.press("ArrowRight");
		await expect(resizer).toHaveAttribute("aria-valuenow", "244");
		await expect(page.getByTestId("rail-width")).toHaveText("244");
		await page.keyboard.press("ArrowLeft");
		await expect(resizer).toHaveAttribute("aria-valuenow", "232");

		// Home 复位 232；双击同样复位。
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("Home");
		await expect(resizer).toHaveAttribute("aria-valuenow", "232");
		await page.keyboard.press("ArrowRight");
		await resizer.dblclick();
		await expect(resizer).toHaveAttribute("aria-valuenow", "232");

		// 持久化：宽度写入本地偏好，重载后恢复。
		await page.keyboard.press("ArrowRight");
		await expect(page.getByTestId("rail-width")).toHaveText("244");
		await page.reload();
		await expect(
			page.getByRole("separator", { name: "调整章节栏宽度" }),
		).toHaveAttribute("aria-valuenow", "244");
	});

	test("resizer: pointer drag updates instantly without selecting text", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/scene-rail.html");
		const resizer = page.getByRole("separator", { name: "调整章节栏宽度" });
		const box = await resizer.boundingBox();
		expect(box, "分割条必须可见且可测量").not.toBeNull();
		if (!box) return;
		const startY = box.y + box.height / 2;

		await page.mouse.move(box.x + box.width / 2, startY);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 60, startY, { steps: 4 });

		// 拖拽中即时反馈＋正文不可选中（user-select none 生效于容器）。
		await expect(page.getByTestId("rail-width")).toHaveText("292");
		const selecting = await page.evaluate(() => {
			const grid = document.querySelector('[data-testid="rail-grid"]');
			return grid ? getComputedStyle(grid).userSelect : "unknown";
		});
		expect(selecting).toBe("none");

		await page.mouse.up();
		await expect(page.getByTestId("rail-width")).toHaveText("292");
		const released = await page.evaluate(() => {
			const grid = document.querySelector('[data-testid="rail-grid"]');
			return grid ? getComputedStyle(grid).userSelect : "unknown";
		});
		expect(released).not.toBe("none");
	});
});

test.describe("compact 800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });

	test("resizer clamps to 38% viewport ceiling", async ({ page }) => {
		await page.goto("/ui-fixtures/scene-rail.html");
		const resizer = page.getByRole("separator", { name: "调整章节栏宽度" });
		await resizer.focus();
		// 800px 视口上限 = 304（min(360, 800×0.38)）：连按 → 到顶不再增长。
		for (let index = 0; index < 20; index += 1) {
			await page.keyboard.press("ArrowRight");
		}
		await expect(resizer).toHaveAttribute("aria-valuemax", "304");
		await expect(resizer).toHaveAttribute("aria-valuenow", "304");
	});
});
