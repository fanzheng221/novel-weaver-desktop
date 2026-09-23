import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { expect } from "@playwright/test";

import {
	configureSession,
	coreRequest,
	createTempProject,
	disposeTempProjectDir,
	expectNoPageHorizontalScroll,
	test,
} from "./helpers/author-app";

/**
 * 封面真实上传（WF6-06）：对话框由会话配置代答并返回真实存在的图片文件，
 * 核心进程按 magic bytes 校验后重写到项目资产目录（ADR-0067），
 * 书卡以 base64 data URL 直接渲染——fixture 无法伪造第二条读回链路。
 */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const byte of bytes) {
		const index = (c ^ byte) & 0xff;
		c = (CRC_TABLE[index] ?? 0) ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([length, body, crc]);
}

function makePngBytes(width: number, height: number): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const stride = width * 3 + 1;
	const raw = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const offset = y * stride + 1 + x * 3;
			raw[offset] = (x * 61) % 256;
			raw[offset + 1] = (y * 61) % 256;
			raw[offset + 2] = 128;
		}
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(raw)),
		pngChunk("IEND", new Uint8Array()),
	]);
}

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runCoverSuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runCoverSuite("compact");
});

function runCoverSuite(profile: string): void {
	test(`[${profile}] 书卡上传真实封面→读回资产→移除回落占位`, async ({
		page,
	}, testInfo) => {
		const bookName = `封面验收稿-${profile}`;
		const dir = await createTempProject(page, { name: bookName });
		const scratch = await mkdtemp(path.join(os.tmpdir(), "nw-cover-fixture-"));
		try {
			const coverFile = path.join(scratch, "封面.png");
			await writeFile(coverFile, makePngBytes(6, 4));
			await configureSession(page, { defaultCwd: dir, dialogPath: coverFile });

			// 启动页自动登记默认项目；书卡就绪后暴露封面入口。
			await page.goto("/");
			const card = page.getByRole("article", { name: `书籍：${bookName}` });
			await expect(card).toBeVisible();
			const setButton = card.getByRole("button", { name: "设置封面" });
			await expect(setButton).toBeVisible();
			await expectNoPageHorizontalScroll(page);

			// 真实上传：对话框代答真实文件路径，核心读盘校验并落资产目录。
			await setButton.click();
			// alt="" 的装饰图不进 img role，断言走元素定位。
			const coverImage = card.locator("img");
			await expect(coverImage).toBeVisible();
			await expect(coverImage).toHaveAttribute("src", /^data:image\/png;base64,/);
			await expect(
				card.getByRole("button", { name: "更换封面" }),
				"有封面后入口分化为更换",
			).toBeVisible();
			await expect(
				card.getByRole("button", { name: "移除封面" }),
			).toBeVisible();
			await expect(card.getByRole("button", { name: "设置封面" })).toHaveCount(0);
			await testInfo.attach("launcher-cover-uploaded", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});

			// 独立读回：核心侧元数据 + base64 与 UI 展示同源。
			const cover = await coreRequest<{
				mime: string;
				width: number | null;
				height: number | null;
				base64: string;
			}>(page, dir, "get_project_cover");
			expect(cover.mime).toBe("image/png");
			expect(cover.width).toBe(6);
			expect(cover.height).toBe(4);
			expect(cover.base64.length).toBeGreaterThan(0);

			// 移除路径完整：回落占位，核心侧元数据清空。
			await card.getByRole("button", { name: "移除封面" }).click();
			await expect(card.getByRole("img")).toHaveCount(0);
			await expect(card.getByRole("button", { name: "设置封面" })).toBeVisible();
			const removed = await coreRequest<null>(page, dir, "get_project_cover");
			expect(removed).toBeNull();
			await expectNoPageHorizontalScroll(page);
		} finally {
			await configureSession(page, { dialogPath: null });
			await disposeTempProjectDir(scratch);
			await disposeTempProjectDir(dir);
		}
	});
}
