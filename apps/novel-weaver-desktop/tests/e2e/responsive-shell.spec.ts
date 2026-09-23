import { expect } from "@playwright/test";

import {
	configureSession,
	createTempProject,
	disposeTempProjectDir,
	expectNoPageHorizontalScroll,
	test,
} from "./helpers/author-app";

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runResponsiveSuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runResponsiveSuite("compact");
});

function runResponsiveSuite(profile: string): void {
	/**
	 * WF5-01 用例 #2：两个基准视口都能执行真实任务流程、截图，
	 * 且启动页与写作台都不得出现页面级横向滚动。
	 */
	test(`[${profile}] 启动页与写作台双视口无横向滚动`, async ({
		page,
	}, testInfo) => {
		const dir = await createTempProject(page, { name: `视口-${profile}` });
		try {
			await configureSession(page, { defaultCwd: dir, fault: "none" });

			await page.goto("/");
			const shelfCard = page.getByRole("article", {
				name: `书籍：视口-${profile}`,
			});
			await expect(shelfCard).toBeVisible();
			await expectNoPageHorizontalScroll(page);
			await testInfo.attach("viewport-launcher", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});

			await shelfCard.getByRole("button", { name: "打开书籍" }).click();
			await expect(page.getByRole("banner")).toBeVisible();
			await expect(
				page.getByRole("banner").getByText(`视口-${profile}`),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);
			await testInfo.attach("viewport-workspace", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
}
