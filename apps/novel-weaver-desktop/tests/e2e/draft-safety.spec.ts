import { expect, type Page } from "@playwright/test";
import { configureSession, coreRequest, createTempProject, disposeTempProjectDir, test } from "./helpers/author-app";

async function seed(page: Page, cwd: string, title: string, storyOrder: number) {
  const candidate = await coreRequest<{ sceneId: string; proposalId: string; sceneVersionId: string }>(page, cwd, "create_scene_candidate", {
    title, markdown: `${title}原文`, narrativeMode: "omniscient", continuityId: "main", storyOrder, purposes: ["推进情节"],
  });
  await coreRequest(page, cwd, "record_scene_review", { proposalId: candidate.proposalId, candidateVersionId: candidate.sceneVersionId, findings: [] });
  await coreRequest(page, cwd, "approve_proposal", { proposalId: candidate.proposalId, expectedRevision: 1 });
  return candidate;
}

async function open(page: Page, cwd: string) {
  await configureSession(page, { defaultCwd: cwd, fault: "none" });
  await page.goto("/");
  await page.getByRole("article", { name: "书籍：草稿保护" }).getByRole("button", { name: "打开书籍", exact: true }).click();
}

async function selectDraft(page: Page, title: string) {
  await page.getByRole("button", { name: new RegExp(title) }).first().click();
  if (await page.getByRole("button", { name: "以此场景为基写新候选" }).isVisible()) {
    await page.getByRole("button", { name: "以此场景为基写新候选" }).click();
  }
  await expect(page.locator("textarea").first()).toBeVisible();
}

test.use({ viewport: { width: 1180, height: 760 } });

test("navigation flushes edits before the autosave debounce expires", async ({ page }) => {
  const cwd = await createTempProject(page, { name: "草稿保护" });
  try {
    const scene = await seed(page, cwd, "场景甲", 1);
    await open(page, cwd);
    await selectDraft(page, "场景甲");
    // Freeze browser timers so navigation must save through the unmount path.
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.locator("textarea").first().fill("立即离开前的最后修改");
    await page.getByRole("button", { name: "规划", exact: true }).click();
    const saved = await page.evaluate(({ cwd, sceneId }) => localStorage.getItem(`nw-draft:${cwd}:${sceneId}`), { cwd, sceneId: scene.sceneId });
    expect(JSON.parse(saved ?? "{}").text).toBe("立即离开前的最后修改");
  } finally { await page.goto("about:blank"); await disposeTempProjectDir(cwd); }
});

for (const action of ["continue", "condense"] as const) {
 for (const switchScene of [true, false]) {
  test(`${action} result targets the original scene (switch=${switchScene})`, async ({ page }) => {
    const cwd = await createTempProject(page, { name: "草稿保护" });
    let release: (() => void) | undefined;
    try {
      const a = await seed(page, cwd, "场景甲", 1);
      const b = await seed(page, cwd, "场景乙", 2);
      await page.addInitScript(({ cwd, a, b }) => {
        localStorage.setItem("nw-byok-providers", JSON.stringify([{ id: "e2e-fixture", name: "Fixture", modelId: "fixture", baseURL: "http://fixture.local/v1", adapter: "anthropic_messages" }]));
        localStorage.setItem("nw-byok-slots", JSON.stringify({ generation: "e2e-fixture" }));
        for (const [scene, text] of [[a, "甲的草稿。\n\n这一天，注定被示例城史册记住。"], [b, "乙的草稿必须保留"]] as const) {
          localStorage.setItem(`nw-draft:${cwd}:${scene.sceneId}`, JSON.stringify({ text, title: "草稿", sourceVersionId: scene.sceneVersionId, savedAt: Date.now() }));
        }
      }, { cwd, a, b });
      let started = false;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/__nw/local-rpc", async (route) => {
        if (route.request().postDataJSON()?.request?.method !== "generate_scene_draft") return route.continue();
        expect(route.request().postDataJSON().request.params.adapter).toBe("anthropic_messages");
        started = true;
        await pending;
        await route.fulfill({ json: { ok: true, data: { markdown: "甲的迟到生成结果", usage: { promptTokens: 1, completionTokens: 1 } } } });
      });
      await open(page, cwd);
      await selectDraft(page, "场景甲");
      if (action === "continue") {
        await page.getByRole("button", { name: /AI 助手/ }).first().click();
        await page.getByRole("button", { name: "从光标续写", exact: true }).click();
      } else {
        await page.getByRole("button", { name: /版本/ }).first().click();
        await page.getByRole("tab", { name: "质量报告" }).click();
        await page.getByRole("button", { name: /一键精简/ }).first().click();
      }
      await expect.poll(() => started).toBe(true);
      const close = page.getByRole("button", { name: "关闭 AI 助手", exact: true });
      if (await close.isVisible()) await close.click();
      if (switchScene) {
        await selectDraft(page, "场景乙");
        await expect(page.locator("textarea").first()).toHaveValue("乙的草稿必须保留");
      }
      const response = page.waitForResponse((res) => res.request().postData()?.includes("generate_scene_draft") ?? false);
      release();
      await response;
      await page.waitForTimeout(1100);
      if (switchScene) {
        await expect(page.locator("textarea").first()).toHaveValue("乙的草稿必须保留");
      } else if (action === "condense") {
        await expect(page.locator("textarea").first()).toHaveValue("甲的迟到生成结果");
      } else {
        await expect(page.locator("textarea").first()).toHaveValue(/甲的草稿[\s\S]*甲的迟到生成结果/);
      }
      const saved = await page.evaluate(({ cwd, sceneId }) => JSON.parse(localStorage.getItem(`nw-draft:${cwd}:${sceneId}`) ?? "{}").text, { cwd, sceneId: b.sceneId });
      expect(saved).toBe("乙的草稿必须保留");
    } finally { release?.(); await page.goto("about:blank"); await disposeTempProjectDir(cwd); }
  });
}
}
