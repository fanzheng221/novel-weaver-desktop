import { expect, type Locator, type Page } from "@playwright/test";

import {
	configureSession,
	coreRequest,
	createTempProject,
	disposeTempProjectDir,
	expectNoPageHorizontalScroll,
	test,
} from "./helpers/author-app";

/**
 * WF5-16：发布检查、版本与导出线性流程。全部经真实链路——
 * 浏览器 invoke 垫片 → /__nw/local-rpc → 真实 local-core 进程 → SQLite。
 * 覆盖：检查步一次回答三件事（定稿了吗/有阻断吗/能导出什么）、空态与
 * 阻断逐条深链回修复位置、四格式线性全流程（键盘操作）、同目录重复导出
 * 不覆盖且失败保留输入可重试、发布版本不可变（正文更新后旧版本如实标注）。
 */

interface SceneSeed {
	sceneId: string;
	sceneVersionId: string;
	proposalId: string;
}

async function seedCanonicalScene(
	page: Page,
	dir: string,
	options: {
		title: string;
		markdown: string;
		storyOrder: number;
		sceneId?: string;
		sourceVersionId?: string;
	},
): Promise<SceneSeed> {
	const candidate = await coreRequest<SceneSeed>(page, dir, "create_scene_candidate", {
		...(options.sceneId ? { sceneId: options.sceneId } : {}),
		...(options.sourceVersionId ? { sourceVersionId: options.sourceVersionId } : {}),
		title: options.title,
		markdown: options.markdown,
		narrativeMode: "third_person_limited",
		viewpointCharacterId: "CHAR-LIN",
		continuityId: "main",
		storyOrder: options.storyOrder,
		purposes: ["推进主线"],
	});
	await coreRequest(page, dir, "record_scene_review", {
		proposalId: candidate.proposalId,
		candidateVersionId: candidate.sceneVersionId,
		findings: [],
	});
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: candidate.proposalId,
		expectedRevision: 1,
	});
	return candidate;
}

/** 播种一条未回收伏笔（发布检查步的阻断来源，与核心定版门同判定）。 */
async function seedOpenPromise(page: Page, dir: string, title: string): Promise<void> {
	const proposal = await coreRequest<{ proposalId: string; revision: number }>(
		page,
		dir,
		"create_artifact_proposal",
		{
			kind: "story_promise",
			title,
			content: { setup: "雨夜里转手的钥匙", payoff: "钥匙最终打开钟楼暗门", status: "open" },
		},
	);
	await coreRequest(page, dir, "approve_proposal", {
		proposalId: proposal.proposalId,
		expectedRevision: proposal.revision,
	});
}

async function openPublishArea(page: Page, name: string): Promise<string> {
	const dir = await createTempProject(page, { name });
	try {
		await configureSession(page, { defaultCwd: dir, fault: "none" });
		await page.goto("/");
		const card = page.getByRole("article", { name: `书籍：${name}` });
		await card.getByRole("button", { name: "打开书籍" }).click();
		await expect(page.getByRole("banner")).toBeVisible();
		await navTo(page, "发布");
		await expect(page.getByTestId("publish-steps")).toBeVisible();
		return dir;
	} catch (error) {
		await disposeTempProjectDir(dir);
		throw error;
	}
}

async function navTo(page: Page, label: string): Promise<void> {
	await page
		.getByRole("complementary", { name: "导航侧栏" })
		.getByRole("button", { name: label, exact: true })
		.click();
}

function stepButton(page: Page, label: string) {
	return page
		.getByRole("navigation", { name: "发布流程步骤" })
		.getByRole("button", { name: label });
}

/** 键盘操作原生控件：聚焦后回车，验证主路径全程键盘可达成。 */
async function pressEnter(page: Page, locator: Locator): Promise<void> {
	await locator.focus();
	await page.keyboard.press("Enter");
}

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runPublishSuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runPublishSuite("compact");
});

function runPublishSuite(profile: string): void {
	test(`[${profile}] 空项目：检查步三问、空态指引与键盘步骤守卫`, async ({
		page,
	}) => {
		const dir = await openPublishArea(page, `发布空-${profile}`);
		try {
			// 三问的一句话回答：还没定稿 / 有阻断 / 四格式。
			await expect(page.getByTestId("publish-summary")).toContainText(
				"还没有定稿的发布版本。有 1 项必须先处理的问题。可导出 TXT / MD / HTML / EPUB 四种格式。",
			);
			// 空态：没有正文时给出下一步（去写作台）。
			await expect(page.getByText("还没有可以发布的内容")).toBeVisible();
			// 步骤条守卫：确认/导出无前置时不可达（禁用态对键盘同样可感知）。
			await expect(stepButton(page, "确认定版")).toBeDisabled();
			await expect(stepButton(page, "导出")).toBeDisabled();
			// 键盘：发布检查 ↔ 发布版本自由往返。
			await pressEnter(page, stepButton(page, "发布版本"));
			await expect(page.getByText("创建新发布版本")).toBeVisible();
			await pressEnter(page, stepButton(page, "发布检查"));
			await expect(page.getByText("还没有可以发布的内容")).toBeVisible();
			// 空态深链：带作者去写作台完成第一章。
			// （阻断条目与空态各有一个「去写作台」：前者是条目深链，后者是空态主动作。）
			await page.getByRole("button", { name: "去写作台" }).last().click();
			const nav = page.getByRole("complementary", { name: "导航侧栏" });
			await expect(nav.getByRole("button", { name: "写作", exact: true })).toHaveAttribute(
				"aria-current",
				"page",
			);
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test(`[${profile}] 阻断深链：伏笔逐条列出，深链落伏笔追踪表，处理前不消失`, async ({
		page,
	}) => {
		const dir = await createTempProject(page, { name: `发布阻断-${profile}` });
		try {
			// 先有一条正典场景（避免落到「无正文」空态），再留一个未回收伏笔。
			await seedCanonicalScene(page, dir, {
				title: "雨夜来客",
				markdown: "林舟在雨夜迎来第一位客人。",
				storyOrder: 10,
			});
			await seedOpenPromise(page, dir, "钟楼的钥匙");
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await page.goto("/");
			const card = page.getByRole("article", { name: `书籍：发布阻断-${profile}` });
			await card.getByRole("button", { name: "打开书籍" }).click();
			await expect(page.getByRole("banner")).toBeVisible();
			await navTo(page, "发布");
			await expect(page.getByTestId("publish-steps")).toBeVisible();

			// 阻断条目用作者语言点名具体问题，附可去处理的深链。
			const issue = page.getByTestId("publish-issues");
			await expect(issue).toContainText("未回收的伏笔：钟楼的钥匙");
			// 有阻断时主动作是重新检查，不是继续定版。
			await expect(page.getByRole("button", { name: "重新检查" })).toBeVisible();
			await expect(
				page.getByRole("button", { name: /继续：选择或创建发布版本/ }),
			).toHaveCount(0);

			await page.getByRole("button", { name: "去伏笔追踪表" }).click();
			await expect(page.getByRole("heading", { name: "大纲工作区" })).toBeVisible();
			const strip = page
				.getByRole("navigation", { name: "规划子区" })
				.getByRole("button", { name: "伏笔追踪" });
			await expect(strip).toHaveAttribute("aria-current", "page");
			// 伏笔表主列显示埋设文本，状态列如实标注待回收。
			await expect(page.getByText("故事承诺 · 1")).toBeVisible();
			await expect(page.getByText("雨夜里转手的钥匙").first()).toBeVisible();
			await expect(page.getByText("待回收").first()).toBeVisible();

			// 回发布：条目仍在（未回收就是未回收，不撒谎）。
			await navTo(page, "发布");
			await expect(page.getByTestId("publish-issues")).toContainText(
				"未回收的伏笔：钟楼的钥匙",
			);
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test(`[${profile}] 键盘全流程：检查→版本→确认→导出成功（TXT+MD）`, async ({
		page,
	}) => {
		const dir = await openPublishArea(page, `发布全流程-${profile}`);
		try {
			await seedCanonicalScene(page, dir, {
				title: "雨夜来客",
				markdown: "林舟在雨夜迎来第一位客人。",
				storyOrder: 10,
			});
			// 播种后切区重挂载，拉到新投影。
			const nav = page.getByRole("complementary", { name: "导航侧栏" });
			await nav.getByRole("button", { name: "写作", exact: true }).click();
			await nav.getByRole("button", { name: "发布", exact: true }).click();

			// 检查步：没有阻断项，可继续定版。
			await expect(page.getByTestId("publish-summary")).toContainText(
				"没有阻断项，可以定版。",
			);
			await expect(page.getByText("✓ 没有发现阻断项——可以创建发布版本。")).toBeVisible();

			await pressEnter(
				page,
				page.getByRole("button", { name: "继续：选择或创建发布版本" }),
			);
			await expect(page.getByText("创建新发布版本")).toBeVisible();

			// 版本步（键盘）：标题 + 勾选 MD 格式（aria-pressed 翻转）。
			await page.getByRole("textbox", { name: "发布版本标题" }).fill("雾城来信");
			const mdToggle = page.getByRole("button", { name: /MD 存档与二次编辑/ });
			await pressEnter(page, mdToggle);
			await expect(mdToggle).toHaveAttribute("aria-pressed", "true");
			await page.getByRole("button", { name: "创建并检查" }).click();

			// 确认步：内容、范围、格式一目了然，终审通过。
			await expect(page.getByText(/《雾城来信》 · 1 个场景 · TXT \/ MD/)).toBeVisible();
			await expect(page.getByText("✓ 终审通过，没有阻断项。")).toBeVisible();
			const confirmRegion = page.getByRole("region", { name: "确认定版" });
			await pressEnter(
				page,
				confirmRegion.getByRole("button", { name: "确认定版" }),
			);

			// 导出步：目录可改，产物列出真实文件路径与校验值。
			await expect(page.getByText(/《雾城来信》 · TXT \/ MD/)).toBeVisible();
			const exportDir = `${dir}/exports`;
			await page.getByRole("textbox", { name: "导出目录（绝对路径）" }).fill(exportDir);
			await pressEnter(page, page.getByRole("button", { name: "导出到目录" }));
			const artifacts = page.getByTestId("publish-artifacts");
			await expect(artifacts).toBeVisible();
			await expect(artifacts).toContainText("TXT");
			await expect(artifacts).toContainText("MD");
			await expect(artifacts).toContainText(".txt");
			await expect(artifacts).toContainText(".md");
			await expect(artifacts).toContainText("sha256");
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test(`[${profile}] 失败恢复：同目录重复导出不覆盖，换目录重试成功`, async ({
		page,
	}) => {
		const dir = await openPublishArea(page, `发布重试-${profile}`);
		try {
			await seedCanonicalScene(page, dir, {
				title: "雨夜来客",
				markdown: "林舟在雨夜迎来第一位客人。",
				storyOrder: 10,
			});
			const nav = page.getByRole("complementary", { name: "导航侧栏" });
			await nav.getByRole("button", { name: "写作", exact: true }).click();
			await nav.getByRole("button", { name: "发布", exact: true }).click();
			await page
				.getByRole("button", { name: "继续：选择或创建发布版本" })
				.click();
			await page.getByRole("textbox", { name: "发布版本标题" }).fill("雾城来信");
			await page.getByRole("button", { name: "创建并检查" }).click();
			await page
				.getByRole("region", { name: "确认定版" })
				.getByRole("button", { name: "确认定版" })
				.click();

			const exportDir = `${dir}/exports`;
			const directoryField = page.getByRole("textbox", {
				name: "导出目录（绝对路径）",
			});
			await directoryField.fill(exportDir);
			await page.getByRole("button", { name: "导出到目录" }).click();
			await expect(page.getByTestId("publish-artifacts")).toBeVisible();

			// 同目录重复导出：核心拒绝覆盖，错误就地呈现，不说堆栈话。
			await page.getByRole("button", { name: "导出到目录" }).click();
			const failure = page.getByTestId("publish-export-error");
			await expect(failure).toContainText("导出目标已存在");
			await expect(failure).toContainText("不会被自动覆盖");
			await expect(failure).toContainText("更换目录或删除同名文件");
			// 失败不回退步骤，目录与版本选择原样保留。
			await expect(directoryField).toHaveValue(exportDir);
			await expect(page.getByText(/《雾城来信》 · TXT/)).toBeVisible();

			// 换目录重试：按钮文案转为「重试导出」，成功后错误消失。
			await directoryField.fill(`${dir}/exports-2`);
			await page.getByRole("button", { name: "重试导出" }).click();
			await expect(page.getByTestId("publish-artifacts")).toBeVisible();
			await expect(page.getByTestId("publish-export-error")).toHaveCount(0);
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});

	test(`[${profile}] 版本不可变：正文更新后旧版本如实标注「正文已更新」`, async ({
		page,
	}) => {
		const dir = await openPublishArea(page, `发布留痕-${profile}`);
		try {
			const first = await seedCanonicalScene(page, dir, {
				title: "雨夜来客",
				markdown: "林舟在雨夜迎来第一位客人。",
				storyOrder: 10,
			});
			const nav = page.getByRole("complementary", { name: "导航侧栏" });
			await nav.getByRole("button", { name: "写作", exact: true }).click();
			await nav.getByRole("button", { name: "发布", exact: true }).click();
			await page
				.getByRole("button", { name: "继续：选择或创建发布版本" })
				.click();
			await page.getByRole("textbox", { name: "发布版本标题" }).fill("雾城来信");
			await page.getByRole("button", { name: "创建并检查" }).click();
			await page
				.getByRole("region", { name: "确认定版" })
				.getByRole("button", { name: "确认定版" })
				.click();
			await expect(page.getByText(/《雾城来信》 · TXT/)).toBeVisible();

			// 同一场景出第二个正典版本：定版不可变，旧版本只做标注。
			await seedCanonicalScene(page, dir, {
				sceneId: first.sceneId,
				sourceVersionId: first.sceneVersionId,
				title: "雨夜来客",
				markdown: "林舟在雨夜迎来第一位客人，钥匙换了主人。",
				storyOrder: 10,
			});
			await nav.getByRole("button", { name: "写作", exact: true }).click();
			await nav.getByRole("button", { name: "发布", exact: true }).click();

			// 检查步概览先如实报告：定稿 1 版，其中 1 个的正文已更新。
			await expect(page.getByTestId("publish-summary")).toContainText(
				"已有 1 个发布版本定稿（其中 1 个的正文已更新）。",
			);
			await page
				.getByRole("button", { name: "继续：选择或创建发布版本" })
				.click();
			const editions = page.getByTestId("publish-editions");
			await expect(editions).toContainText("《雾城来信》");
			await expect(editions.getByText("正文已更新", { exact: true })).toBeVisible();
			await expect(editions).toContainText(
				"这版定稿后，有 1 个场景的正文又更新过。内容以最新正文为准时，建议创建新版本。",
			);
			await expectNoPageHorizontalScroll(page);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
}
