import { expect, type Page } from "@playwright/test";
import {
	configureSession,
	coreRequest,
	createTempProject,
	disposeTempProjectDir,
	test,
} from "./helpers/author-app";

/** 三征正例：末段总结性收尾＋跨段重复＋空泛修饰密集。 */
const FLAVOR_PROSE = [
	"他忽然停住，忽然回头，忽然笑出声，忽然又沉默；场面忽然安静，忽然喧哗，忽然散开。",
	"他忽然停住，忽然回头，忽然笑出声，忽然又沉默；场面忽然安静，忽然喧哗，忽然散开。",
	"这一天，注定被示例城史册记住。",
].join("\n\n");

const CLEAN_PROSE = [
	"角色甲收势的时候，木剑在晨光里停了半息。汗顺着下颌落进青砖缝里。",
	"「手腕沉三分。」角色乙立在廊下，「你护的是自己，不是剑。」",
	"角色甲应了一声，重新起势。他看见父亲靴上沾着北门的黄泥，没有问。",
].join("\n\n");

async function seed(
	page: Page,
	cwd: string,
	title: string,
	markdown: string,
	storyOrder: number,
) {
	const candidate = await coreRequest<{
		sceneId: string;
		proposalId: string;
		sceneVersionId: string;
	}>(page, cwd, "create_scene_candidate", {
		title,
		markdown,
		narrativeMode: "omniscient",
		continuityId: "main",
		storyOrder,
		purposes: ["推进情节"],
	});
	// 送审时本地三征检测自动并挂 advisory（ADR-0077 双轨的确定性一轨）。
	await coreRequest(page, cwd, "record_scene_review", {
		proposalId: candidate.proposalId,
		candidateVersionId: candidate.sceneVersionId,
		findings: [],
	});
	await coreRequest(page, cwd, "approve_proposal", {
		proposalId: candidate.proposalId,
		expectedRevision: 1,
	});
	return candidate;
}

async function open(page: Page, cwd: string) {
	await configureSession(page, { defaultCwd: cwd, fault: "none" });
	await page.goto("/");
	await page
		.getByRole("article", { name: "书籍：AI味体检" })
		.getByRole("button", { name: "打开书籍", exact: true })
		.click();
}

async function selectScene(page: Page, title: string) {
	await page
		.getByRole("button", { name: new RegExp(title) })
		.first()
		.click();
	await expect(page.locator("div.prose.paper")).toBeVisible();
}

test.use({ viewport: { width: 1180, height: 760 } });

test("canonical paper waves stored flavor findings in author language", async ({
	page,
}) => {
	const cwd = await createTempProject(page, { name: "AI味体检" });
	try {
		const scene = await seed(page, cwd, "场景甲", FLAVOR_PROSE, 1);
		const stored = await coreRequest<Array<{ code: string; message: string }>>(
			page,
			cwd,
			"list_version_findings",
			{ versionId: scene.sceneVersionId },
		);
		expect(stored.map((finding) => finding.code)).toContain(
			"AI_FLAVOR_SUMMARY_ENDING",
		);
		await open(page, cwd);
		await selectScene(page, "场景甲");
		await expect(page.locator("div.prose.paper")).toContainText(
			"这一天，注定被示例城史册记住",
		);
		// 波浪线悬停详情：作者语言标签，绝不泄漏技术 ID（WF6-09）。
		const waved = page.locator("p[data-p-anchor][title*='总结性收尾']");
		await expect(waved).toHaveCount(1);
		const paper = await page.locator("div.prose.paper").innerHTML();
		expect(paper).not.toContain("AI_FLAVOR_");
	} finally {
		await page.goto("about:blank");
		await disposeTempProjectDir(cwd);
	}
});

test("quality panel detects flavor signals in the working draft without blocking", async ({
	page,
}) => {
	const cwd = await createTempProject(page, { name: "AI味体检" });
	try {
		await seed(page, cwd, "场景甲", CLEAN_PROSE, 1);
		await open(page, cwd);
		await selectScene(page, "场景甲");
		await page.getByRole("button", { name: "以此场景为基写新候选" }).click();
		await page.locator("textarea").first().fill(FLAVOR_PROSE);
		await page.getByRole("button", { name: /版本/ }).first().click();
		await page.getByRole("tab", { name: "质量报告" }).click();
		// A 区实时体检：三征命中以作者语言呈现（提示级，不阻断）。
		await expect(page.getByText(/检出 3 条疑似 AI味信号/)).toBeVisible();
		await expect(page.getByText("总结性收尾", { exact: true })).toBeVisible();
		await expect(page.getByText("空泛修饰堆砌", { exact: true })).toBeVisible();
		await expect(page.getByText("同义反复", { exact: true })).toBeVisible();
		// 定位正文可恢复：advisory 引导修改而非阻断。
		await page.getByRole("button", { name: "定位正文" }).first().click();
		await expect(page.getByText("未能定位到具体段落")).toHaveCount(0);
	} finally {
		await page.goto("about:blank");
		await disposeTempProjectDir(cwd);
	}
});
