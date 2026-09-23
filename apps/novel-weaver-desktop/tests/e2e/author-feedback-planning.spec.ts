import { expect } from "@playwright/test";
import {
  configureSession,
  coreRequest,
  createTempProject,
  disposeTempProjectDir,
  expectNoPageHorizontalScroll,
  test,
} from "./helpers/author-app";

for (const width of [1180, 800]) {
  test.describe(`${width}`, () => {
    test.use({ viewport: { width, height: 760 } });
    test("总纲修订、名称确认、并行冲突恢复与按钮一致性", async ({ page }, testInfo) => {
      const dir = await createTempProject(page, { name: "修订旅程" });
      try {
        const first = await coreRequest<{
          artifactId: string;
          artifactVersionId: string;
          proposalId: string;
        }>(page, dir, "create_artifact_proposal", {
          kind: "outline",
          title: "雾城总纲",
          content: { goal: "寻找父亲", acts: ["旧港来信"] },
        });
        await coreRequest(page, dir, "approve_proposal", {
          proposalId: first.proposalId,
          expectedRevision: 1,
        });
        const competing = await coreRequest<{ proposalId: string }>(
          page,
          dir,
          "create_artifact_proposal",
          {
            kind: "outline",
            artifactId: first.artifactId,
            sourceVersionId: first.artifactVersionId,
            title: "另一份总纲修订",
            content: { goal: "寻找母亲", acts: ["旧港来信"] },
          },
        );
        await configureSession(page, { defaultCwd: dir, fault: "none" });
        await page.goto("/");
        await page
          .getByRole("article", { name: "书籍：修订旅程" })
          .getByRole("button", { name: "打开书籍" })
          .click();
        await page.evaluate(() => {
          window.location.hash = "#/outline";
        });
        await expect(page.getByText("开始创作 · 从设定到正文", { exact: true })).toBeVisible();
        await expect(page.getByText("另一份总纲修订", { exact: true })).toBeVisible();
        const primary = await page
          .getByRole("button", { name: "创建提案（待批准）", exact: true })
          .boundingBox();
        const normal = await page
          .getByRole("button", { name: "准备人物", exact: true })
          .boundingBox();
        expect(primary).not.toBeNull();
        expect(normal).not.toBeNull();
        expect(primary!.height).toBeCloseTo(normal!.height, 2);
        await page.getByRole("button", { name: "编辑总纲", exact: true }).click();
        await page.getByRole("button", { name: "编辑这份规划", exact: true }).click();
        const form = page.getByRole("group", { name: "编辑规划" });
        await form.getByLabel("目标", { exact: true }).fill("查明父亲失踪真相");
        await form.getByRole("button", { name: "提交修订提案" }).click();
        await expect(form.getByTestId("proposal-confirm")).toContainText(
          "寻找父亲 → 查明父亲失踪真相",
        );
        await form.getByRole("button", { name: "确认纳入", exact: true }).click();
        await expect(page.getByTestId("outline-summary")).toContainText("查明父亲失踪真相");
        await expect(
          page.getByText("正式规划已更新。这份提案基于旧版本，核对差异后可重新提交。"),
        ).toBeVisible();
        await page.getByRole("button", { name: "核对最新内容" }).click();
        await expect(
          page.getByText("目标: 查明父亲失踪真相 → 寻找母亲", { exact: true }),
        ).toBeVisible();
        await page.getByRole("button", { name: "基于最新版本重新提交" }).click();
        await page.getByRole("button", { name: "确认纳入", exact: true }).click();
        await expect(page.getByText("没有待审的工件提案。")).toBeVisible();
        const old = await coreRequest<{ status: string }>(page, dir, "get_proposal", {
          proposalId: competing.proposalId,
        });
        expect(old.status).toBe("stale");
        await expect(page.getByTestId("outline-summary")).toContainText("寻找母亲");
        await expectNoPageHorizontalScroll(page);
        await page.getByText("开始创作 · 从设定到正文", { exact: true }).scrollIntoViewIfNeeded();
        await testInfo.attach("planning-revision", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      } finally {
        await disposeTempProjectDir(dir);
      }
    });
    test("embedding说明与真实正式正文检索", async ({ page }, testInfo) => {
      const dir = await createTempProject(page, { name: "检索旅程" });
      try {
        const scene = await coreRequest<{ proposalId: string; sceneVersionId: string }>(
          page,
          dir,
          "create_scene_candidate",
          {
            title: "旧港钥匙交接",
            markdown: "林舟在旧港接过铜钥匙，随即赶往钟楼。",
            narrativeMode: "third_person_limited",
            viewpointCharacterId: "CHAR-LIN",
            continuityId: "main",
            storyOrder: 10,
            purposes: ["交接线索"],
          },
        );
        await coreRequest(page, dir, "record_scene_review", {
          proposalId: scene.proposalId,
          candidateVersionId: scene.sceneVersionId,
          findings: [],
        });
        await coreRequest(page, dir, "approve_proposal", {
          proposalId: scene.proposalId,
          expectedRevision: 1,
        });
        await configureSession(page, { defaultCwd: dir, fault: "none" });
        await page.goto("/");
        await page
          .getByRole("article", { name: "书籍：检索旅程" })
          .getByRole("button", { name: "打开书籍" })
          .click();
        await page.evaluate(() => {
          window.location.hash = "#/byok";
        });
        const search = page.getByRole("region", { name: "检索本书正文" });
        await expect(search).toBeVisible();
        await expect(page.getByText(/使用顺序：安装并启用/)).toBeVisible();
        await search.getByLabel("想找什么", { exact: true }).fill("铜钥匙");
        await search.getByRole("button", { name: "检索正文" }).click();
        await expect(search.getByRole("heading", { name: "旧港钥匙交接" })).toBeVisible();
        await expect(search.getByText(/本次使用：/)).toContainText("找到 1 条");
        await search.getByLabel("只查此故事序之前（可空）").fill("10");
        await search.getByRole("button", { name: "检索正文" }).click();
        await expect(search.getByText(/本次使用：/)).toContainText("找到 0 条");
        await expectNoPageHorizontalScroll(page);
        await search.scrollIntoViewIfNeeded();
        await testInfo.attach("evidence-search", {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      } finally {
        await disposeTempProjectDir(dir);
      }
    });
  });
}
