import { expect, test } from "@playwright/test";

import { contrastRatio } from "./helpers/color";

interface NavigationStyles {
	navigationBackground: string;
	normalButtonBackground: string;
	normalForeground: string;
	activeForeground: string;
	activeSurfaceBackground: string;
}

const VIEWPORTS = [
	{ name: "wide 1180×760", viewport: { width: 1180, height: 760 } },
	{ name: "compact 800×600", viewport: { width: 800, height: 600 } },
] as const;

for (const profile of VIEWPORTS) {
	test.describe(profile.name, () => {
		test.use({ viewport: profile.viewport });

		test("deep navigation uses product surfaces and AA text contrast", async ({
			page,
		}, testInfo) => {
			await page.goto("/ui-fixtures/nav.html");

			const navigation = page.getByTestId("dark-navigation");
			const normalItem = page.getByRole("button", { name: "普通导航" });
			const activeItem = page.getByRole("button", { name: "当前章节" });
			const activeSurface = activeItem.locator(".bg-rail-active");

			await expect(navigation).toBeVisible();
			await expect(activeSurface).toBeVisible();

			const styles = await page.evaluate(
				({ navigationSelector, normalLabel, activeLabel }) => {
					const navigationElement =
						document.querySelector<HTMLElement>(navigationSelector);
					const itemByLabel = (label: string) =>
						[...document.querySelectorAll<HTMLButtonElement>("button")].find(
							(button) => button.textContent?.trim() === label,
						);
					const normalItem = itemByLabel(normalLabel);
					const activeItem = itemByLabel(activeLabel);
					const activeSurface =
						activeItem?.querySelector<HTMLElement>(".bg-rail-active");

					if (
						!navigationElement ||
						!normalItem ||
						!activeItem ||
						!activeSurface
					) {
						throw new Error(
							"Dark navigation fixture is missing a required element.",
						);
					}

					return {
						navigationBackground:
							getComputedStyle(navigationElement).backgroundColor,
						normalButtonBackground:
							getComputedStyle(normalItem).backgroundColor,
						normalForeground: getComputedStyle(normalItem).color,
						activeForeground: getComputedStyle(activeItem).color,
						activeSurfaceBackground:
							getComputedStyle(activeSurface).backgroundColor,
					};
				},
				{
					navigationSelector: '[data-testid="dark-navigation"]',
					normalLabel: "普通导航",
					activeLabel: "当前章节",
				},
			);

			const normalContrast = contrastRatio(
				styles.normalForeground,
				styles.navigationBackground,
			);
			const activeContrast = contrastRatio(
				styles.activeForeground,
				styles.activeSurfaceBackground,
			);
			await testInfo.attach("dark-navigation-computed-styles", {
				body: JSON.stringify(
					{ ...styles, normalContrast, activeContrast },
					null,
					2,
				),
				contentType: "application/json",
			});

			// `ui-plain` must leave the native button surface transparent. Chromium resolves
			// product tokens to RGB values, so a system ButtonFace cannot pass unnoticed.
			expect(
				styles.normalButtonBackground,
				"normal nav button must not expose ButtonFace",
			).toBe("rgba(0, 0, 0, 0)");
			expect(
				styles.navigationBackground,
				"navigation must use the rail token",
			).toBe("rgb(29, 32, 35)");
			expect(
				styles.activeSurfaceBackground,
				"selected navigation must use rail-active",
			).toBe("rgb(38, 41, 46)");
			expect(
				normalContrast,
				`normal navigation contrast was ${normalContrast.toFixed(2)}:1`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				activeContrast,
				`selected navigation contrast was ${activeContrast.toFixed(2)}:1`,
			).toBeGreaterThanOrEqual(4.5);
		});
	});
}
