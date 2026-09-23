import { expect } from "@playwright/test";
import {
  configureSession,
  coreRequest,
  createTempProject,
  disposeTempProjectDir,
  expectNoPageHorizontalScroll,
  test,
} from "./helpers/author-app";

for (const viewport of [
  { width: 1180, height: 760 },
  { width: 800, height: 600 },
]) {
  test.describe(`${viewport.width}`, () => {
    test.use({ viewport });
    test("审校和追更始终使用当前打开的书籍", async ({ page }) => {
      const dir = await createTempProject(page, { name: "路径回归" });
      try {
        await configureSession(page, { defaultCwd: dir, fault: "none" });
        await page.goto("/");
        await page
          .getByRole("article", { name: "书籍：路径回归" })
          .getByRole("button", { name: "打开书籍" })
          .click();
        await configureSession(page, { defaultCwd: "/tmp/nw-no-project-default" });
        for (const route of ["#/review", "#/board"]) {
          await page.evaluate((hash) => {
            window.location.hash = hash;
          }, route);
          await expect(page.getByRole("button", { name: "重试", exact: true })).toHaveCount(0);
          await expect(
            page.getByText(route === "#/review" ? "没有需要处理的事" : "还没有章节计划", {
              exact: false,
            }),
          ).toBeVisible();
          await expectNoPageHorizontalScroll(page);
        }
      } finally {
        await disposeTempProjectDir(dir);
      }
    });
    test("本场简报与版本能关闭并重新打开", async ({ page }) => {
      const dir = await createTempProject(page, { name: "面板回归" });
      try {
        const plan = await coreRequest<{ proposalId: string }>(
          page,
          dir,
          "create_artifact_proposal",
          {
            kind: "scene_plan",
            title: "雨夜来客",
            content: { purpose: "钥匙易手", storyOrder: 1 },
          },
        );
        await coreRequest(page, dir, "approve_proposal", {
          proposalId: plan.proposalId,
          expectedRevision: 1,
        });
        await configureSession(page, { defaultCwd: dir, fault: "none" });
        await page.goto("/");
        await page
          .getByRole("article", { name: "书籍：面板回归" })
          .getByRole("button", { name: "打开书籍" })
          .click();
        for (const name of ["本场简报", "版本历史"]) {
          await page.getByRole("button", { name, exact: true }).click();
          const panel = page.getByRole("complementary", { name: "写作工具面板" });
          await expect(panel).toBeVisible();
          await panel.getByRole("button", { name: "关闭写作工具面板" }).click();
          await expect(panel).toHaveCount(0);
          await page.getByRole("button", { name, exact: true }).click();
          await expect(panel).toBeVisible();
          await panel.getByRole("button", { name: "关闭写作工具面板" }).focus();
          await page.keyboard.press("Escape");
          await expect(panel).toHaveCount(0);
          await expectNoPageHorizontalScroll(page);
        }
      } finally {
        await disposeTempProjectDir(dir);
      }
    });
  });
}
