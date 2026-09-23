import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

import type { BridgeFault } from "../../harness/local-rpc-bridge";

/** 浏览器端记录的 invoke 调用日志（顺序即实际发出顺序）。 */
export interface RpcLogEntry {
	cmd: string;
	args?: { cwd?: string; request?: { method?: string } };
	at: number;
}

export async function configureSession(
	page: Page,
	patch: {
		defaultCwd?: string;
		dialogPath?: string | null;
		fault?: "none" | BridgeFault;
	},
): Promise<void> {
	const response = await page.request.post("/__nw/session-config", {
		data: patch,
	});
	expect(response.ok()).toBeTruthy();
}

/** 独立直打桥件的 local RPC envelope；与 UI 无关，用于从进程外读回真实结果。 */
export async function coreRequest<T>(
	page: Page,
	cwd: string,
	method: string,
	params: unknown = {},
): Promise<T> {
	const response = await page.request.post("/__nw/local-rpc", {
		data: { cwd, request: { method, params } },
	});
	const body = (await response.json()) as {
		ok?: boolean;
		data?: T;
		message?: string;
	};
	if (body.ok !== true) {
		throw new Error(body.message ?? "本地核心请求失败");
	}
	return body.data as T;
}

export async function createTempProjectDir(): Promise<string> {
	return mkdtemp(path.join(os.tmpdir(), "nw-author-task-"));
}

export async function disposeTempProjectDir(dir: string): Promise<void> {
	// 常驻核心进程可能仍持有刚写入项目的 SQLite WAL 句柄，rm 会撞上瞬态
	// ENOTEMPTY/EBUSY；短退避重试即可，不掩盖任何真实断言失败。
	let lastError: unknown = null;
	for (let attempt = 0; attempt < 5; attempt += 1) {
		try {
			await rm(dir, { recursive: true, force: true });
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 120));
		}
	}
	throw lastError;
}

export async function rpcLog(page: Page): Promise<RpcLogEntry[]> {
	return page.evaluate(() => window.__NW_RPC_LOG__ ?? []);
}

/** 页面级横向滚动禁止（WF5 视觉基线：1180×760 与 800×600 都不得出现）。 */
export async function expectNoPageHorizontalScroll(page: Page): Promise<void> {
	const { scrollWidth, innerWidth } = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		innerWidth: window.innerWidth,
	}));
	expect
		.soft(
			scrollWidth,
			`页面级横向滚动：scrollWidth=${scrollWidth} > innerWidth=${innerWidth}`,
		)
		.toBeLessThanOrEqual(innerWidth);
}

interface TempProjectOptions {
	name: string;
	primaryLanguage?: string;
}

/** 桥件内新建隔离临时项目（真实 SQLite，绝不触碰《示例小说》）。 */
export async function createTempProject(
	page: Page,
	options: TempProjectOptions,
): Promise<string> {
	const dir = await createTempProjectDir();
	try {
		await coreRequest(page, dir, "initialize_project", {
			name: options.name,
			primaryLanguage: options.primaryLanguage ?? "zh-CN",
		});
	} catch (error) {
		await disposeTempProjectDir(dir);
		throw error;
	}
	return dir;
}

/**
 * 断言故障后的人话错误、输入保留与焦点位置：
 * 作者看到错误的节奏是「读得懂 → 稿子还在 → 从原处继续」，缺一不可。
 * 同时守卫 WF5-19 契约：作者可见 alert 不得泄漏技术类名或对象转储。
 */
export async function expectHumanErrorWithPreservedInput(
	page: Page,
	expectedFragment: string,
): Promise<void> {
	const alert = page.getByRole("alert");
	await expect(alert).toContainText(expectedFragment);
	await expect(
		alert,
		"作者可见错误不得含 CoreRpcError 前缀、[object Object] 或 JSON 转储",
	).not.toContainText(/CoreRpcError:|\[object Object\]|\{\s*"/);
	const dialog = page.getByRole("dialog", { name: "首启向导" });
	const dialogBody = await dialog.evaluate((element) => ({
		activeInDialog: element.contains(document.activeElement),
	}));
	expect(dialogBody.activeInDialog).toBe(true);
}

export const test = base.extend<{
	// 每条用例结束恢复中性会话配置，避免故障注入泄漏进下一条。
	autoResetSession: void;
}>({
	autoResetSession: [
		async ({ page }, use) => {
			await use();
			await configureSession(page, { fault: "none" });
		},
		{ auto: true },
	],
});

declare global {
	interface Window {
		__NW_RPC_LOG__?: RpcLogEntry[];
	}
}
