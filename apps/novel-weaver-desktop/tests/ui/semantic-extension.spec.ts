import { expect, test } from "@playwright/test";

for (const width of [1180, 800]) {
	test.describe(`semantic extension ${width}`, () => {
		test.use({ viewport: { width, height: 760 } });
		test.beforeEach(async ({ page }) => {
			await page.addInitScript(() => {
				const state = window as unknown as {
					__TAURI_INTERNALS__: unknown;
					extensionBlocked: boolean;
					cancelInstall?: () => void;
					calls: string[];
				};
				state.extensionBlocked = false;
				state.calls = [];
				let enabled = false;
				let installed = false;
				let operation: unknown = null;
				const status = () => ({
					enabled,
					installed,
					available: installed,
					dismissed: false,
					source: "managed",
					model: "qwen3-embedding:0.6b",
					message: enabled ? "语义检索已启用" : "当前使用关键词检索",
					operation,
					capabilities: {
						supported: !state.extensionBlocked,
						blockers: state.extensionBlocked
							? ["扩展目录所在磁盘需至少 4 GiB 可用空间。"]
							: [],
						warnings: [],
						totalMemoryGiB: 16,
						availableMemoryGiB: 5,
						freeDiskGiB: 20,
						platform: "darwin/arm64",
					},
				});
				state.__TAURI_INTERNALS__ = {
					invoke: async (
						cmd: string,
						args: {
							request?: { method: string; params: { enabled: boolean } };
						},
					) => {
						if (cmd === "byok_key_tail") return null;
						if (cmd !== "query_project")
							throw new Error(`Unexpected command ${cmd}`);
						const method = args.request?.method ?? "";
						state.calls.push(method);
						if (method === "semantic_extension_status")
							return { ok: true, data: status() };
						if (method === "semantic_extension_install") {
							operation = {
								id: "one",
								pid: 100,
								stage: "model",
								message: "正在下载并校验检索模型",
								completed: 50,
								total: 100,
							};
							await new Promise<void>((resolve) => {
								state.cancelInstall = resolve;
							});
							operation = { stage: "cancelled", message: "安装已取消" };
							throw new Error("扩展安装已取消。");
						}
						if (method === "semantic_extension_set_enabled") {
							enabled = args.request?.params.enabled ?? false;
							if (!enabled) state.cancelInstall?.();
							return { ok: true, data: status() };
						}
						if (method === "semantic_extension_existing") {
							installed = true;
							enabled = true;
							return { ok: true, data: status() };
						}
						return { ok: true, data: [] };
					},
				};
			});
			await page.goto("/ui-fixtures/byok.html");
		});

		test("hardware blockers disable install and show a recoverable reason", async ({
			page,
		}) => {
			await page.evaluate(() => {
				(window as unknown as { extensionBlocked: boolean }).extensionBlocked =
					true;
			});
			await page.getByRole("button", { name: "重新检查", exact: true }).click();
			await expect(
				page.getByRole("button", { name: "安装并启用语义检索" }),
			).toBeDisabled();
			await expect(
				page.getByText("扩展目录所在磁盘需至少 4 GiB 可用空间。", {
					exact: true,
				}),
			).toBeVisible();
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(width);
		});

		test("installation progress remains responsive and can be cancelled", async ({
			page,
		}) => {
			await page.getByRole("button", { name: "安装并启用语义检索" }).click();
			await expect(
				page.getByRole("progressbar", { name: "扩展安装进度" }),
			).toHaveAttribute("value", "50");
			await page.getByRole("button", { name: "取消安装" }).click();
			await expect(
				page.getByText("扩展安装已取消。", { exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "安装并启用语义检索" }),
			).toBeEnabled();
		});

		test("existing model can be enabled, disabled and re-enabled without reinstalling", async ({
			page,
		}) => {
			await page.getByText("已安装 Ollama？", { exact: true }).click();
			await page.getByRole("button", { name: "检查并使用已有 Ollama" }).click();
			await expect(
				page.getByRole("button", { name: "更新本书语义索引" }),
			).toBeVisible();
			await page
				.getByRole("button", { name: "关闭语义检索", exact: true })
				.click();
			await expect(
				page.getByText("当前使用关键词检索", { exact: true }),
			).toBeVisible();
			await page
				.getByRole("button", { name: "启用语义检索", exact: true })
				.click();
			await expect(
				page.getByText("语义检索已启用", { exact: true }),
			).toBeVisible();
			expect(
				(
					await page.evaluate(
						() => (window as unknown as { calls: string[] }).calls,
					)
				).includes("semantic_extension_install"),
			).toBe(false);
			await page.screenshot({
				path: `/tmp/novel-semantic-${width}.png`,
				fullPage: true,
			});
		});
	});
}
