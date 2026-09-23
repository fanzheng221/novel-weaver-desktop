import { expect, test } from "@playwright/test";

/**
 * WF5-10（补充层，fixture 直打生产纯函数/reducer）：规划树模型——
 *   1. buildPlanningTree：卷章归属只认 chapterIds 投影；散章、未挂章场景、
 *      其他工件归组；POV 经实体名解析；phase 由 release 行派生。
 *   2. nextActionOf：零工件 empty / 有纲零章 split-chapters / 其余 tree。
 *   3. parseSplitInstruction：逐行草案、空行跳过、标题取标点前片段。
 *   4. describeProposalImpact：修订 diff 人话化（id 换名）、新建列 after、
 *      dependents 来自依赖边。
 *   5. splitReducer：previewing 可改可删、失败保留指令、retry/adjust、
 *      对账 matchPendingToDrafts 按 title+purpose 命中。
 */

test.describe("planning tree model", () => {
	test("树归属：卷内章、散章、未挂章场景、其他工件与 POV 解析", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/planning-model.html");
		await page.getByRole("button", { name: "完整树" }).click();
		const treeLines = page.getByTestId("tree-out").locator("li");
		await expect(treeLines).toHaveText([
			"outline=ART-OUTLINE",
			"volumes=ART-VOL1[ART-CH1,ART-CH2]",
			"loose=",
			"unfiledScenes=ART-SC2@角色甲",
			"others=场景计划:2|故事承诺:1",
			"chapterCount=2",
		]);
		await expect(page.getByTestId("next-action")).toHaveText("tree");
	});

	test("零章 next-action：有纲零章给拆章主操作，零工件留空态", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/planning-model.html");
		await page.getByRole("button", { name: "有纲零章", exact: true }).click();
		await expect(page.getByTestId("next-action")).toHaveText("split-chapters");
		await page.getByRole("button", { name: "零工件", exact: true }).click();
		await expect(page.getByTestId("next-action")).toHaveText("empty");
	});

	test("拆章指令解析：逐行草案、空行跳过、标题取标点前片段", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/planning-model.html");
		await page.getByRole("button", { name: "解析两行指令" }).click();
		await expect(page.getByTestId("draft-out").locator("li")).toHaveText([
			"第1章 · 身世揭开一角｜身世揭开一角，旧友重逢。｜1",
			"第2章 · 旧案重启｜旧案重启，档案失踪。｜2",
		]);
		await page.getByRole("button", { name: "解析空指令" }).click();
		await expect(page.getByTestId("draft-out").locator("li")).toHaveCount(0);
	});

	test("影响预览：修订 diff 换人话、新建列 after、依赖影响面", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/planning-model.html");
		await page.getByRole("button", { name: "修订预览" }).click();
		await expect(page.getByTestId("impact-out")).toContainText(
			"工件提案｜第一章 · 归城｜isNew=false",
		);
		await expect(page.getByTestId("impact-out")).toContainText(
			"本章目的: 主角回到示例城 → 主角深夜回到示例城",
		);
		await expect(page.getByTestId("impact-out")).toContainText(
			"目标字数: 3000 → 3200",
		);
		await expect(page.getByTestId("impact-out")).toContainText(
			"涉及人物: （新增） → 角色甲",
		);
		await expect(page.getByTestId("impact-out")).toContainText("dependents=");
		await page.getByRole("button", { name: "新建预览" }).click();
		await expect(page.getByTestId("impact-out")).toContainText("isNew=true");
		await expect(page.getByTestId("impact-out")).toContainText(
			"本章目的: （新增） → 突围出城",
		);
	});

	test("拆章状态机：预览可改可删、失败保留指令、retry 与 adjust", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/planning-model.html");
		await page.getByRole("button", { name: "打开拆章流" }).click();
		await expect(page.getByTestId("split-phase")).toHaveText("editing");

		await page.getByRole("button", { name: "生成预览" }).click();
		await expect(page.getByTestId("split-phase")).toHaveText("previewing");
		await expect(page.getByTestId("split-items")).toHaveText(
			"draft-1:第1章 · 第一章内容:pending|draft-2:第2章 · 第二章内容:pending",
		);

		// 预览可编辑可删。
		await page.getByRole("button", { name: "改第一条标题" }).click();
		await page.getByRole("button", { name: "删除第二条" }).click();
		await expect(page.getByTestId("split-items")).toHaveText(
			"draft-1:改后的第一章:pending",
		);
		await page.getByRole("button", { name: "关闭" }).click();
		await page.getByRole("button", { name: "打开拆章流" }).click();
		await page.getByRole("button", { name: "生成预览" }).click();
		await page.getByRole("button", { name: "开始执行" }).click();
		await expect(page.getByTestId("split-phase")).toHaveText("running");

		// 第一条完成、第二条失败 → failed，指令与进度保留。
		await page.getByRole("button", { name: "第一条完成" }).click();
		await page.getByRole("button", { name: "第二条失败" }).click();
		await expect(page.getByTestId("split-phase")).toHaveText("failed");
		await expect(page.getByTestId("split-items")).toHaveText(
			"draft-1:第1章 · 第一章内容:done|draft-2:第2章 · 第二章内容:failed",
		);
		await expect(page.getByTestId("split-failure")).toHaveText(
			"本地核心不可达",
		);
		await expect(page.getByTestId("split-first")).toHaveText("ART-NEW1");

		// 对账：待审提案按 title+purpose 命中剩余草稿。
		await page.getByRole("button", { name: "对账匹配" }).click();
		await expect(page.getByTestId("split-reconciled")).toHaveText(
			"draft-2=PR-9",
		);

		// retry 复位失败项续跑；adjust 回预览并剔除已完成项。
		await page.getByRole("button", { name: "重试" }).click();
		await expect(page.getByTestId("split-phase")).toHaveText("running");
		await expect(page.getByTestId("split-items")).toHaveText(
			"draft-1:第1章 · 第一章内容:done|draft-2:第2章 · 第二章内容:pending",
		);
		await page.getByRole("button", { name: "第二条失败" }).click();
		await expect(page.getByTestId("split-phase")).toHaveText("failed");
		await page.getByRole("button", { name: "调整指令" }).click();
		await expect(page.getByTestId("split-phase")).toHaveText("previewing");
		await expect(page.getByTestId("split-items")).toHaveText(
			"draft-2:第2章 · 第二章内容:pending",
		);

		await page.getByRole("button", { name: "开始执行" }).click();
		await page.getByRole("button", { name: "全部成功" }).click();
		await expect(page.getByTestId("split-phase")).toHaveText("succeeded");
	});
});
