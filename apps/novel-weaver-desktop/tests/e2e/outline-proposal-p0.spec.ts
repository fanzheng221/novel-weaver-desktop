import { expect } from "@playwright/test";

import {
	configureSession,
	coreRequest,
	createTempProject,
	disposeTempProjectDir,
	expectNoPageHorizontalScroll,
	rpcLog,
	test,
} from "./helpers/author-app";

test.describe("1180×760", () => {
	test.use({ viewport: { width: 1180, height: 760 } });
	runOutlineProposalSuite("wide");
});

test.describe("800×600", () => {
	test.use({ viewport: { width: 800, height: 600 } });
	runOutlineProposalSuite("compact");
});

function runOutlineProposalSuite(profile: string): void {
	/**
	 * WF5-02 全旅程 + WF5-10 连续确认流：空标题就地校验（不发 RPC）→
	 * 注入 rpc_down 后提交保留输入并可重试 → 清除注入重试成功 →
	 * 原位「预览影响→稍后再说」（不跳页）→ 待审面板批准纳入 →
	 * 有纲零章第一态：总纲摘要 + 唯一主操作「根据总纲拆分章节」，绝无四空列。
	 * 全部经真实核心进程。
	 */
	test(`[${profile}] 大纲提案：校验/失败恢复/确认纳入/零章总纲态`, async ({
		page,
	}, testInfo) => {
		const dir = await createTempProject(page, { name: `大纲-${profile}` });
		try {
			await configureSession(page, { defaultCwd: dir, fault: "none" });
			await page.goto("/");
			await page
				.getByRole("article", { name: `书籍：大纲-${profile}` })
				.getByRole("button", { name: "打开书籍" })
				.click();
			await expect(page.getByRole("banner")).toBeVisible();

			// hash 即路由源（AppShell）；折叠侧栏与窄窗下同样成立。
			await page.evaluate(() => {
				window.location.hash = "#/outline";
			});
			await expect(
				page.getByRole("heading", { name: "大纲工作区" }),
			).toBeVisible();

			// 零工件第一态：EmptyState 引导，绝无四空列。
			await expect(
				page.getByText("卷章结构 · 0 章", { exact: true }),
			).toBeVisible();
			await expect(page.getByText("未写", { exact: true })).toHaveCount(0);
			await expect(
				page.getByRole("heading", { name: "大纲还是空的" }),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);

			// ① 空标题：就地报错＋聚焦，绝不发 RPC。
			await page.getByRole("button", { name: "创建提案（待批准）" }).click();
			await expect(page.getByRole("alert").first()).toContainText("请输入标题");
			const titleBox = page.getByLabel("标题");
			await expect(titleBox).toBeFocused();
			expect(
				(await rpcLog(page)).some(
					(entry) => entry.args?.request?.method === "create_artifact_proposal",
				),
				"空标题不得发出 create_artifact_proposal",
			).toBe(false);

			// ② 注入 rpc_down：提交保留输入，人话原因＋重试。
			await configureSession(page, { fault: "rpc_down" });
			await titleBox.fill(`第一卷大纲-${profile}`);
			await page.getByLabel("目标").fill("主角身世揭开一角");
			await page.getByRole("button", { name: "创建提案（待批准）" }).click();
			await expect(page.getByRole("alert").first()).toContainText(
				"提案没有创建成功",
			);
			await expect(titleBox).toHaveValue(`第一卷大纲-${profile}`);
			await expect(page.getByLabel("目标")).toHaveValue("主角身世揭开一角");
			await expect(
				page.getByRole("button", { name: "重试提交" }),
			).toBeVisible();
			await expectNoPageHorizontalScroll(page);
			await testInfo.attach("outline-recoverable-error", {
				body: await page.screenshot({ fullPage: true }),
				contentType: "image/png",
			});

			// ③ 清除注入后原表单重试成功 → 原位「预览影响→确认纳入」段出现。
			await configureSession(page, { fault: "none" });
			await page.getByRole("button", { name: "重试提交" }).click();
			const confirm = page.getByTestId("proposal-confirm");
			await expect(confirm).toContainText(`待纳入：第一卷大纲-${profile}`);
			await expect(confirm).toContainText("目标: （新增） → 主角身世揭开一角");

			// ④ 「稍后再说」：无需跳页，提案进入右侧待审面板。
			await page.getByRole("button", { name: "稍后再说" }).click();
			await expect(page.getByText(/提案已创建，正在等待批准/)).toContainText(
				`第一卷大纲-${profile}`,
			);
			await expect(
				page.getByText(/在右侧「待审工件提案」里展开核对/),
			).toBeVisible();
			await expect(
				page.getByText("待审工件提案 · 1", { exact: true }),
			).toBeVisible();

			// 纳入规划：面板批准后大纲工件进入 graph（提案门禁语义）。
			// 成功后表单原位保留（WF5-18 连续流），「批准」需 exact 避让「创建提案（待批准）」。
			await page.getByRole("button", { name: "预览并批准", exact: true }).click();
			await page.getByRole("button", { name: "确认纳入", exact: true }).click();

			// ⑤ WF5-10 用例 1：有纲零章 → 总纲摘要 + 唯一主操作，不渲染四空列。
			await expect(page.getByText("未写", { exact: true })).toHaveCount(0);
			await expect(page.getByTestId("outline-summary")).toBeVisible();
			await expect(page.getByTestId("outline-summary")).toContainText(
				"主角身世揭开一角",
			);
			await expect(
				page.getByRole("button", { name: "根据总纲拆分章节" }),
			).toBeVisible();
			await expect(page.getByRole("button", { name: "看板" })).toHaveCount(0);
			await expectNoPageHorizontalScroll(page);

			// ⑥ 进程外读回：批准后大纲工件已正式进入规划图（独立第二信封）。
			const graph = await coreRequest<{
				nodes: { kind: string; title: string }[];
			}>(page, dir, "planning_graph_query");
			expect(
				graph.nodes.some(
					(node) =>
						node.kind === "outline" && node.title === `第一卷大纲-${profile}`,
				),
			).toBe(true);
		} finally {
			await disposeTempProjectDir(dir);
		}
	});
}
