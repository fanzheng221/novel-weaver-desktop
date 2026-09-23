import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";

const desktopRoot = new URL("../", import.meta.url);

async function source(relativePath) {
	return readFile(new URL(relativePath, desktopRoot), "utf8");
}

const components = await source("src/shared/ui/components.tsx");

assert.match(
	components,
	/const BUTTON_BASE\s*=\s*\n?\s*"ui-plain\b/,
	"Shared Button must retain the ui-plain native-control reset.",
);
assert.match(
	components,
	/"ui-plain relative flex min-h-8\b/,
	"NavItem must retain the ui-plain native-control reset.",
);
assert.doesNotMatch(
	components,
	/as:\s*Heading\s*=\s*"h[456]"/,
	"EmptyState must not restore a skipped h4–h6 default heading.",
);

// 规范类名门禁：与 Tailwind IntelliSense「suggestCanonicalClasses」用同一引擎
// （canonicalizeCandidates，rem=16）。任何会被 IDE 警告「The class `x` can be
// written as `y`」的非规范类名在此直接失败。规则见
// docs/wayfinder/wf3-07-tailwind-migration-spec.md 第 9 节。
async function* walkSources(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules") continue;
			yield* walkSources(full);
		} else if (/\.(tsx|ts)$/.test(entry.name)) {
			yield full;
		}
	}
}

const baseCss = await source("src/shared/ui/base.css");
const designSystem = await __unstable__loadDesignSystem(baseCss, {
	base: path.join(new URL("../src/shared/ui/", import.meta.url).pathname, ""),
});

function* stringLiterals(text) {
	const re = /"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\]*)`/g;
	let match;
	while ((match = re.exec(text))) {
		yield match[1] ?? match[2] ?? match[3] ?? "";
	}
}

const tokenCanonical = new Map();
for await (const file of walkSources(path.join(desktopRoot.pathname, "src"))) {
	const text = await readFile(file, "utf8");
	for (const literal of stringLiterals(text)) {
		for (const token of literal.split(/\s+/)) {
			if (!token || tokenCanonical.has(token)) continue;
			tokenCanonical.set(token, token);
			try {
				const [canonical] = await designSystem.canonicalizeCandidates([token], {
					rem: 16,
				});
				if (canonical && canonical !== token && !/\s/.test(canonical)) {
					tokenCanonical.set(token, canonical);
				}
			} catch {
				// 非法候选（如插值片段、自定义类），保持原样
			}
		}
	}
}

const nonCanonical = [...tokenCanonical.entries()].filter(([token, canonical]) => {
	// canonicalizeCandidates 对非候选返回自身；只有真正被引擎改写的才算违规
	return token !== canonical;
});

// IDE 扩展（自带引擎）比项目引擎多一步：颜色类 var 简写 `(--x)` 在主题存在
// 命名 token `--color-x` 时会建议命名形式（实测 `accent-(--accent)` →
// `accent-accent`，项目 4.3.3 引擎判定保持原样，两边有分歧）。此处按扩展
// 行为补充检查，保证源码不残留 IDE 警告。
const COLOR_UTILITIES = new Set([
	"bg", "text", "border", "accent", "caret", "fill", "stroke",
	"ring", "outline", "decoration", "divide", "from", "via", "to",
]);
const colorNames = new Set(designSystem.theme.keysInNamespaces(["--color"]));
for (const [token] of tokenCanonical) {
	const match = /^(?:[^:\s]+:)*([a-z-]+)-\((--[a-z0-9-]+)\)$/.exec(token);
	if (!match) continue;
	const [, utility, cssVar] = match;
	if (!COLOR_UTILITIES.has(utility) || !colorNames.has(cssVar.slice(2))) continue;
	nonCanonical.push([token, token.replace(`(${cssVar})`, cssVar.slice(2))]);
}

assert.equal(
	nonCanonical.length,
	0,
	`发现 ${nonCanonical.length} 个非规范类名，应改用引擎规范形式（参照 docs/wayfinder/wf3-07-tailwind-migration-spec.md 第 9 节）：\n` +
		nonCanonical.map(([token, canonical]) => `  ${token} → ${canonical}`).join("\n"),
);

console.log("UI static structure checks passed.");
