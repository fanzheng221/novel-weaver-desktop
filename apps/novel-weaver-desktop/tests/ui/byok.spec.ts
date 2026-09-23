import { expect, test } from "@playwright/test";

for (const viewport of [
	{ width: 1180, height: 760 },
	{ width: 800, height: 600 },
]) {
	test.describe(`${viewport.width}×${viewport.height}`, () => {
		test.use({ viewport });
		test.beforeEach(async ({ page }) => {
			await page.addInitScript(() => {
				const keys = new Map<string, string>();
				const state = window as unknown as {
					__TAURI_INTERNALS__: unknown;
					byokCalls: Array<{ cmd: string; args: Record<string, unknown> }>;
					failKey: boolean;
				};
				state.byokCalls = [];
				state.failKey = false;
				state.__TAURI_INTERNALS__ = {
					invoke: async (cmd: string, args: Record<string, unknown>) => {
						state.byokCalls.push({ cmd, args });
						if (cmd === "byok_save_key") {
							if (state.failKey)
								throw new Error("保存 API Key 失败：钥匙串不可用");
							keys.set(String(args.providerId), String(args.key));
							return;
						}
						if (cmd === "byok_key_tail")
							return keys.get(String(args.providerId))?.slice(-4) ?? null;
						if (cmd === "byok_delete_key") {
							keys.delete(String(args.providerId));
							return;
						}
						if (cmd === "byok_probe_config")
							return { ok: true, status: 200, hint: "连通成功" };
						if (cmd === "query_project") return { ok: true, data: [] };
						throw new Error(`Unexpected command: ${cmd}`);
					},
				};
			});
			await page.goto("/ui-fixtures/byok.html");
		});

		test("creates and edits one provider with the same nonempty keychain id; secrets never enter localStorage", async ({
			page,
		}) => {
			await page.getByLabel(/API Key（/).fill("fixture-secret-5678");
			await expect(page.getByLabel(/API Key（/)).toHaveAttribute(
				"type",
				"password",
			);
			await page
				.getByRole("button", { name: "添加服务商", exact: true })
				.click();
			await expect(page.getByText("配置已保存")).toBeVisible();
			await expect(page.getByText("已存入钥匙串（尾四位 5678）")).toBeVisible();
			await page.getByLabel("名称", { exact: true }).fill("DeepSeek 备用");
			await page.getByLabel(/API Key（/).fill("second-secret-4321");
			await page.getByRole("button", { name: "保存修改", exact: true }).click();
			await expect(page.getByText("已存入钥匙串（尾四位 4321）")).toBeVisible();
			const result = await page.evaluate(() => ({
				providers: JSON.parse(
					localStorage.getItem("nw-byok-providers") ?? "[]",
				),
				storage: JSON.stringify(localStorage),
				calls: (
					window as unknown as {
						byokCalls: Array<{ cmd: string; args: Record<string, unknown> }>;
					}
				).byokCalls.filter((call) => call.cmd === "byok_save_key"),
			}));
			expect(result.providers).toHaveLength(1);
			expect(result.providers[0].id).toMatch(/^prov-.+/);
			expect(result.providers[0].name).toBe("DeepSeek 备用");
			expect(result.calls.map((call) => call.args.providerId)).toEqual([
				result.providers[0].id,
				result.providers[0].id,
			]);
			expect(result.storage).not.toContain("secret");
			await page.reload();
			await expect(
				page.getByText("DeepSeek 备用", { exact: true }),
			).toBeVisible();
		});

		test("probes unsaved relay settings and persists Responses/auth/parameters", async ({
			page,
		}) => {
			await page
				.getByRole("button", { name: "自定义 / 中转站 模板", exact: true })
				.click();
			await page.getByLabel("接口协议").selectOption("openai_responses");
			await page
				.getByLabel(/接口地址（/)
				.fill("https://relay.example/proxy/v1/responses");
			await page.getByLabel("默认模型 ID").fill("vendor/model-id");
			await page.getByLabel(/API Key（/).fill("relay-key");
			await page
				.getByText("高级设置（中转站 / 推理模型）", { exact: true })
				.click();
			await page.getByLabel("鉴权方式").selectOption("bearer");
			await page.getByLabel("最大输出 Token").fill("8192");
			await page.getByLabel("请求超时（秒）").fill("240");
			await page
				.getByRole("button", { name: "测试当前配置", exact: true })
				.click();
			await expect(page.getByText("[200] 连通成功")).toBeVisible();
			const config = await page.evaluate(
				() =>
					(
						window as unknown as {
							byokCalls: Array<{ cmd: string; args: Record<string, unknown> }>;
						}
					).byokCalls.find((call) => call.cmd === "byok_probe_config")?.args
						.config,
			);
			expect(config).toMatchObject({
				adapter: "openai_responses",
				baseUrl: "https://relay.example/proxy/v1/responses",
				modelId: "vendor/model-id",
				apiKey: "relay-key",
				requestOptions: {
					authMode: "bearer",
					temperature: null,
					maxTokens: 8192,
					timeoutSeconds: 240,
				},
			});
			await page
				.getByRole("button", { name: "添加服务商", exact: true })
				.click();
			await expect(page.getByText("配置已保存")).toBeVisible();
			await page
				.getByLabel("正文生成", { exact: true })
				.selectOption({ label: "自定义 / 中转站 · vendor/model-id" });
			await page.getByRole("button", { name: "移除", exact: true }).click();
			await expect(page.getByLabel("正文生成", { exact: true })).toHaveValue(
				"",
			);
		});

		test("keychain failure retains draft and retries without publishing broken config", async ({
			page,
		}) => {
			await page.evaluate(() => {
				(window as unknown as { failKey: boolean }).failKey = true;
			});
			await page.getByLabel(/API Key（/).fill("fixture-key");
			await page
				.getByRole("button", { name: "添加服务商", exact: true })
				.click();
			await expect(page.getByText(/保存 API Key 失败/)).toBeVisible();
			expect(
				await page.evaluate(() => localStorage.getItem("nw-byok-providers")),
			).toBeNull();
			await expect(page.getByLabel(/API Key（/)).toHaveValue("fixture-key");
			await page.evaluate(() => {
				(window as unknown as { failKey: boolean }).failKey = false;
			});
			await page
				.getByRole("button", { name: "添加服务商", exact: true })
				.click();
			await expect(page.getByText("配置已保存")).toBeVisible();
		});

		test("local model requires no key, malformed URL is rejected, compact layout fits", async ({
			page,
		}) => {
			await page
				.getByRole("button", { name: "Ollama 本地 模板", exact: true })
				.click();
			await page.getByLabel("默认模型 ID").fill("qwen/local");
			await page
				.getByLabel(/接口地址（/)
				.fill("https://user:secret@relay.example/v1");
			await page
				.getByRole("button", { name: "添加服务商", exact: true })
				.click();
			await expect(page.getByText(/请检查接口地址、模型 ID/)).toBeVisible();
			await page.getByLabel(/接口地址（/).fill("http://127.0.0.1:11434/v1");
			await page
				.getByRole("button", { name: "添加服务商", exact: true })
				.click();
			await expect(
				page.getByText("无需 API Key", { exact: true }),
			).toBeVisible();
			const result = await page.evaluate(() => ({
				saved: (
					window as unknown as { byokCalls: Array<{ cmd: string }> }
				).byokCalls.some((call) => call.cmd === "byok_save_key"),
				width: document.documentElement.scrollWidth,
				viewport: innerWidth,
			}));
			expect(result.saved).toBe(false);
			expect(result.width).toBeLessThanOrEqual(result.viewport);
			await page.screenshot({
				path: `/tmp/novel-byok-${viewport.width}.png`,
				fullPage: true,
			});
		});
	});
}
