import { expect, test } from "@playwright/test";

/**
 * WF5-13（补充层，fixture 直打生产纯函数与呈现组件）：统一关系工作区——
 *   1. 共享谓词：时间切片、类型筛选池、稳定时间范围、变化事件。
 *   2. 放射布局：焦点判定、全部节点界内；态度弧双向分侧与徽章计数。
 *   3. 有效期与历史：同对多段有效期归组。
 *   4. 时间轴带：按钮步进、章号直达、事件下拉、键盘步进。
 *   5. 图谱与列表：选中同步、私密点线、知情者明细、历史、证据场景。
 */

test.describe("relations model", () => {
	test("共享谓词：时间切片、类型池、稳定范围、变化事件", async ({ page }) => {
		await page.goto("/ui-fixtures/relations-model.html");
		await page.getByRole("button", { name: "切片" }).click();
		await expect(page.getByTestId("model-out").locator("li")).toHaveText([
			// 第 4 章：RIVAL-1（2–6）仍有效；SECRET 第 3 章起可见。
			"objective=REL-ALLY,REL-MEMBER,REL-CTRL,REL-RIVAL-1,REL-SECRET",
			"attitudes=ATT-A,ATT-B,ATT-C",
			"pool=ally_of:2|contests_control_of:1|member_of:1|political_rival_of:2",
			"range=0-8",
			"clamped=8",
			"events=0,1,2,3,5,6,8",
		]);
	});

	test("放射布局与态度弧：自动焦点、全部界内、双向分侧", async ({ page }) => {
		await page.goto("/ui-fixtures/relations-model.html");
		await page.getByRole("button", { name: "布局", exact: true }).click();
		await expect(page.getByTestId("model-out").locator("li")).toHaveText([
			"placed=5/5",
			"inBounds=true",
			// 度数最高（含态度）且优先人物：林舟。
			"centers=CHAR-LIN",
			"rivalPair=CHAR-SHEN|CHAR-SU",
		]);
		await page.getByRole("button", { name: "态度弧" }).click();
		await expect(page.getByTestId("model-out").locator("li")).toHaveText([
			// 同对双向态度分居法线两侧；同向第二条依次外扩。
			"ATT-A=-34:-1",
			"ATT-B=34:1",
			"ATT-C=-58:-1",
			"badges=CHAR-LIN|CHAR-SU:3",
		]);
	});

	test("有效期与历史：同对多段归组并标记当前段", async ({ page }) => {
		await page.goto("/ui-fixtures/relations-model.html");
		await page.getByRole("button", { name: "历史" }).click();
		await expect(page.getByTestId("model-out").locator("li")).toHaveText([
			"spans=2-6|8-open*",
			"validity=第 8 章起，尚未结束",
			"secret=第 3 章起，尚未结束",
		]);
	});

	test("时间轴带：步进、章号直达、事件下拉、键盘步进", async ({ page }) => {
		await page.goto("/ui-fixtures/relations-model.html");
		const counter = page.getByText(/第 \d+ 章 · 客观 \d+ 条 \/ 态度 \d+ 条/);

		// 第 5 章：ATT-C（2–5）恰在本章结束，不再计入。
		await page.getByRole("button", { name: "前进 1 章" }).click();
		await expect(counter).toHaveText("第 5 章 · 客观 5 条 / 态度 2 条");

		await page.getByLabel("章号直达").fill("2");
		await page.getByLabel("章号直达").press("Enter");
		await expect(counter).toHaveText("第 2 章 · 客观 4 条 / 态度 3 条");

		// SECRET 第 3 章才出现：第 2 章的图谱与列表都不该有它。
		await expect(
			page.getByRole("button", { name: /林舟对沈青的盟友关系（私密）/ }),
		).toHaveCount(0);

		await page
			.getByLabel("按关系变化事件跳章")
			.selectOption({ label: "第 8 章 · 苏晚 → 沈青 开始 政敌" });
		await expect(counter).toHaveText("第 8 章 · 客观 5 条 / 态度 2 条");

		const slider = page.getByRole("slider", { name: "故事时间切片" });
		await slider.focus();
		await page.keyboard.press("Shift+ArrowLeft");
		await expect(counter).toHaveText("第 3 章 · 客观 5 条 / 态度 3 条");
		await page.keyboard.press("ArrowRight");
		await expect(counter).toHaveText("第 4 章 · 客观 5 条 / 态度 3 条");
	});

	test("图谱：私密点线、选中同步列表、Alt 钉共同焦点、复位布局", async ({
		page,
	}) => {
		await page.goto("/ui-fixtures/relations-model.html");
		const canvas = page.getByRole("img", { name: "人物关系图谱画布" });
		await expect(canvas).toBeVisible();

		// 私密边：点线 + 「私」前缀（不只靠颜色）。
		await expect(page.getByText("私 盟友", { exact: true })).toBeVisible();
		await expect(page.getByText("态度 ×3", { exact: true })).toBeVisible();

		// 键盘选中客观边（SVG 边的中点可能被节点标签覆盖，指针路径走列表侧）：
		// 聚焦私密边 → Enter → 列表同名行展开明细，选中双向同步。
		const edge = page.getByRole("button", {
			name: /林舟对沈青的盟友关系（私密）/,
		});
		await edge.focus();
		await page.keyboard.press("Enter");
		const row = page.getByRole("button", {
			name: "林舟 → 沈青，盟友，私密，第 3 章起，尚未结束",
		});
		await expect(row).toHaveAttribute("aria-pressed", "true");
		await expect(page.getByText(/知情者 林舟/)).toBeVisible();
		await expect(page.getByRole("button", { name: "发起修订" })).toBeVisible();

		// Alt+点击节点 → 追加共同焦点（aria 即时反映）。
		await page
			.getByRole("button", { name: "沈青（人物）" })
			.click({ modifiers: ["Alt"] });
		await expect(
			page.getByRole("button", { name: "沈青（人物，共同焦点）" }),
		).toBeVisible();

		// 键盘可达：Tab 聚焦节点后 Enter 选中。
		await page.getByRole("button", { name: "苏晚（人物）" }).focus();
		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("button", { name: /^苏晚（人物(，共同焦点)?）$/ }),
		).toBeFocused();

		// 复位布局按钮可用（拖拽理线的清空路径在真实窗口冒烟复核）。
		await page.getByRole("button", { name: "复位图谱布局" }).click();
		await expect(canvas).toBeVisible();
	});

	test("列表：客观主行+态度子行、历史与证据跳转", async ({ page }) => {
		await page.goto("/ui-fixtures/relations-model.html");
		const list = page.getByLabel("关系列表");
		await expect(list).toBeVisible();
		await expect(list.getByText("客观关系 · 5", { exact: true })).toBeVisible();

		// 同对态度子行：强度点（0.9→5 实心；0.6→3 实心 2 空心）。
		await expect(
			list.getByRole("button", { name: /苏晚对林舟的疼爱态度，强度 0\.9/ }),
		).toBeVisible();
		await expect(
			list.getByRole("button", { name: /林舟对苏晚的信任态度，强度 0\.6/ }),
		).toBeVisible();

		// 第 4 章展开 RIVAL-1：有效期、历史段、证据场景。
		// 当前段是 RIVAL-1 自身（2–6），未来段 8–open 不带（当前）。
		await list
			.getByRole("button", { name: "苏晚 → 沈青，政敌，第 2 章至第 6 章" })
			.click();
		await expect(list.getByText("历史变化")).toBeVisible();
		await expect(
			list.getByText("第 2–6 章（当前）", { exact: true }),
		).toBeVisible();
		await expect(
			list.getByText("第 8 章起，至今", { exact: true }),
		).toBeVisible();
		await expect(list.getByText("第 3 场《码头对峙》")).toBeVisible();
		await expect(list.getByRole("button", { name: "跳到场景" })).toBeVisible();

		// 跳到第 8 章后 RIVAL-1 消失、RIVAL-2 出现并带「本章新出现」徽标。
		await page.getByLabel("章号直达").fill("8");
		await page.getByLabel("章号直达").press("Enter");
		await expect(
			list.getByRole("button", {
				name: "苏晚 → 沈青，政敌，第 8 章起，尚未结束",
			}),
		).toBeVisible();
		await expect(list.getByText("本章新出现", { exact: true })).toBeVisible();
		await expect(
			list.getByRole("button", { name: "苏晚 → 沈青，政敌，第 2 章至第 6 章" }),
		).toHaveCount(0);
	});
});
