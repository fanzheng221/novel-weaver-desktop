import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:1420";

export default defineConfig({
	testDir: "./tests/ui",
	outputDir: "test-results/ui",
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	reporter: [
		["list"],
		["html", { open: "never", outputFolder: "playwright-report" }],
	],
	use: {
		baseURL,
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
	webServer: {
		command: "pnpm dev --host 127.0.0.1",
		url: `${baseURL}/ui-fixtures/nav.html`,
		reuseExistingServer: !process.env.CI,
		timeout: 30_000,
	},
	projects: [
		{
			name: "chromium",
			use: { browserName: "chromium" },
		},
	],
});
