import { expect, type Page } from "@playwright/test";

import {
        configureSession,
        coreRequest,
        createTempProject,
        disposeTempProjectDir,
        expectNoPageHorizontalScroll,
        rpcLog,
        test,
} from "./helpers/author-app";

/**
 * WF5-17：规划、世界与审校的上下文 AI 动作。全部经真实链路——
 * 浏览器 invoke 垫片 → /__nw/local-rpc → 真实 local-core 进程 → SQLite；
 * 补全内容由 NW_COMPLETION_FIXTURE 按 userPrompt 标记串脚本化（真实装配，
 * 只替换模型调用层）。覆盖：规划拆章候选成功（含 core v8 规划上下文）、
 * 模型失败可恢复重试、世界区规则门禁与冲突检查、关系人物对建议、
 * 审校条目门禁与一致性解释；每个动作面只产建议、零写入。
 */

type ArtifactResult = { proposalId: string; revision: number; artifactId: string };

function drawer(page: Page) {
        return page.getByRole("complementary", { name: "AI 助手" });
}

async function seedByokFixture(page: Page): Promise<void> {
        await page.addInitScript(() => {
                window.localStorage.setItem(
                        "nw-byok-providers",
                        JSON.stringify([
                                {
                                        id: "e2e-fixture",
                                        name: "E2E 补全夹具",
                                        modelId: "fixture-model",
                                        baseURL: "http://fixture.local/v1",
                                },
                        ]),
                );
                window.localStorage.setItem(
                        "nw-byok-slots",
                        JSON.stringify({ generation: "e2e-fixture" }),
                );
        });
}

async function openBook(page: Page, name: string): Promise<void> {
        // e2e 补全服务商（WF5-09 同款）：恒有 Key（垫片 byok_key_tail），
        // 补全走 NW_COMPLETION_FIXTURE——没有它 runWorkspace 会在装配前报
        // 「尚未配置任何服务商」，成功路径全部无法触达。
        await seedByokFixture(page);
        await page.goto("/");
        await page
                .getByRole("article", { name: `书籍：${name}` })
                .getByRole("button", { name: "打开书籍" })
                .click();
        await expect(page.getByRole("banner")).toBeVisible();
}

async function openWorkspace(page: Page, name: string, sub?: string): Promise<void> {
        await page
                .getByRole("complementary", { name: "导航侧栏" })
                .getByRole("button", { name: name, exact: true })
                .click();
        if (sub) {
                await page
                        .getByRole("navigation", { name: "世界子区" })
                        .getByRole("button", { name: sub })
                        .click();
        }
}

/** 规划世界：总纲 + 卷/章/场景计划（真实 create_artifact_proposal + approve）。 */
async function seedArtifact(
        page: Page,
        dir: string,
        input: Record<string, unknown>,
): Promise<string> {
        const result = await coreRequest<ArtifactResult>(
                page,
                dir,
                "create_artifact_proposal",
                input,
        );
        await coreRequest(page, dir, "approve_proposal", {
                proposalId: result.proposalId,
                expectedRevision: result.revision,
        });
        return result.artifactId;
}

/** 返回总纲工件 id：装配断言用它核对 planArtifactIds 真实进参。 */
async function seedPlanningWorld(page: Page, dir: string): Promise<string> {
        const outlineId = await seedArtifact(page, dir, {
                kind: "outline",
                title: "示例城总纲",
                content: { goal: "揭开示例城旧案", acts: ["身世揭开一角"] },
        });
        await seedArtifact(page, dir, {
                kind: "chapter_plan",
                title: "第一章 · 归城",
                content: { purpose: "主角回到示例城" },
        });
        await seedArtifact(page, dir, {
                kind: "chapter_plan",
                title: "第二章 · 旧档",
                content: { purpose: "翻出旧案档案" },
        });
        await seedArtifact(page, dir, {
                kind: "volume_plan",
                title: "第一卷",
                content: { goal: "立足示例城" },
        });
        return outlineId;
}

/** 规则世界：硬规则 + 人物（规则冲突检查的装配输入）。 */
async function seedRulesWorld(page: Page, dir: string): Promise<void> {
        const design = await coreRequest<{ proposalId: string; revision: number }>(
                page,
                dir,
                "create_design_proposal",
                {
                        hardRules: [
                                {
                                        id: "RULE-DEATH",
                                        name: "人死不能复生",
                                        description: "本世界没有复活手段，死亡即终局。",
                                        examples: [],
                                },
                        ],
                        entities: [
                                {
                                        id: "CHAR-LIN",
                                        type: "character",
                                        canonicalName: "林舟",
                                        description: "漕帮少主。",
                                        attributes: {},
                                },
                                {
                                        id: "CHAR-SU",
                                        type: "character",
                                        canonicalName: "苏晚",
                                        description: "同门师妹。",
                                        attributes: {},
                                },
                        ],
                        characterAttitudes: [
                                {
                                        id: "ATT-TRUST",
                                        sourceCharacterId: "CHAR-SU",
                                        targetCharacterId: "CHAR-LIN",
                                        dimension: "信任",
                                        continuityId: "main",
                                        validFrom: 0,
                                },
                        ],
                        objectiveRelationships: [
                                {
                                        id: "REL-ALLY",
                                        sourceEntityId: "CHAR-LIN",
                                        targetEntityId: "CHAR-SU",
                                        relationshipType: "ally_of",
                                        continuityId: "main",
                                        validFrom: 0,
                                },
                        ],
                },
        );
        await coreRequest(page, dir, "approve_proposal", {
                proposalId: design.proposalId,
                expectedRevision: design.revision,
        });
}

/** 审校世界：一条带阻断发现的待确认候选（收件箱条目来源）。 */
async function seedReviewWorld(page: Page, dir: string): Promise<void> {
        const design = await coreRequest<{ proposalId: string; revision: number }>(
                page,
                dir,
                "create_design_proposal",
                {
                        hardRules: [
                                {
                                        id: "RULE-DEATH",
                                        name: "人死不能复生",
                                        description: "本世界没有复活手段，死亡即终局。",
                                        examples: [],
                                },
                        ],
                        entities: [
                                {
                                        id: "CHAR-LIN",
                                        type: "character",
                                        canonicalName: "林舟",
                                        description: "漕帮少主。",
                                        attributes: {},
                                },
                        ],
                },
        );
        await coreRequest(page, dir, "approve_proposal", {
                proposalId: design.proposalId,
                expectedRevision: design.revision,
        });
        await coreRequest<{ proposalId: string; sceneVersionId: string }>(
                page,
                dir,
                "create_scene_candidate",
                {
                        title: "码头夜雾",
                        markdown: "林舟在码头追查钥匙的下落，死人竟站了起来。",
                        narrativeMode: "third_person_limited",
                        viewpointCharacterId: "CHAR-LIN",
                        continuityId: "main",
                        storyOrder: 20,
                        purposes: ["追查钥匙"],
                },
        ).then((candidate) =>
                coreRequest(page, dir, "record_scene_review", {
                        proposalId: candidate.proposalId,
                        candidateVersionId: candidate.sceneVersionId,
                        findings: [
                                {
                                        severity: "blocking",
                                        confidence: 0.9,
                                        code: "RULE_VIOLATION",
                                        message: "死人复生违反硬规则「人死不能复生」。",
                                        evidence: [],
                                },
                        ],
                }),
        );
}

/** 零写入断言：本会话 RPC 方法不允许出现任何写方法。 */
async function expectNoWriteMethods(page: Page): Promise<void> {
        const log = await rpcLog(page);
        const methods = log.map((entry) => entry.args?.request?.method ?? "");
        const forbidden = methods.filter((method) =>
                /^(create_|approve_|record_|insert_|update_|delete_|revise_)/.test(method),
        );
        expect(forbidden, "跨工作区 AI 动作不得触发任何写方法").toEqual([]);
}

test.describe("1180×760", () => {
        test.use({ viewport: { width: 1180, height: 760 } });
        runCrossWorkspaceSuite("wide");
});

test.describe("800×600", () => {
        test.use({ viewport: { width: 800, height: 600 } });
        runCrossWorkspaceSuite("compact");
});

function runCrossWorkspaceSuite(profile: string): void {
        test(`[${profile}] 规划：拆章候选成功——规划上下文进装配包且零写入`, async ({
                page,
        }, testInfo) => {
                const dir = await createTempProject(page, { name: `规划AI-${profile}` });
                try {
                        const outlineId = await seedPlanningWorld(page, dir);
                        await configureSession(page, { defaultCwd: dir, fault: "none" });
                        await openBook(page, `规划AI-${profile}`);
                        await openWorkspace(page, "规划");
                        // 树节点与「依赖工件」详情都含书名；用树节点按钮圈定。
                        await expect(
                                page.getByRole("button", { name: "示例城总纲" }),
                        ).toBeVisible();

                        // 顶栏 AI 入口在规划面同样可用（WF5-17 门禁扩展）。
                        await page
                                .getByRole("banner")
                                .getByRole("button", { name: /AI 助手/ })
                                .click();
                        const panel = drawer(page);
                        await expect(panel).toBeVisible();
                        await expect(
                                panel.getByText("规划工作区 · 只出建议，不改内容"),
                        ).toBeVisible();
                        await expect(
                                panel.getByRole("tab", { name: "拆章候选" }),
                        ).toHaveAttribute("aria-selected", "true");
                        await expect(panel.getByText("当前主体：示例城总纲")).toBeVisible();
                        await expect(
                                panel.getByRole("button", { name: "生成拆章候选" }),
                        ).toBeEnabled();

                        // 可解释上下文：真实 core v8 装配把规划工件带进包。
                        await panel.getByRole("button", { name: "本次上下文" }).click();
                        await expect(panel.getByText(/规划上下文/)).toBeVisible();
                        const log: Array<{
                                args?: {
                                        request?: {
                                                method?: string;
                                                params?: { planArtifactIds?: string[] };
                                        };
                                };
                        }> = await page.evaluate(() => window.__NW_RPC_LOG__ ?? []);
                        // 取最近一次装配：主体注册晚于首次打开时会有多次装配。
                        const assemble = [...log]
                                .reverse()
                                .find(
                                        (entry) =>
                                                entry.args?.request?.method ===
                                                "build_context_package",
                                );
                        expect(assemble).toBeTruthy();
                        expect(
                                assemble?.args?.request?.params?.planArtifactIds,
                                "装配参数应声明规划工件",
                        ).toContain(outlineId);

                        // 运行：真实 discuss_with_context（补全夹具命中「拆章候选」）。
                        await panel.getByRole("button", { name: "生成拆章候选" }).click();
                        await expect(
                                panel.getByText("拆章候选一（四幕各一章）"),
                        ).toBeVisible();
                        await expectNoWriteMethods(page);
                        await expectNoPageHorizontalScroll(page);

                        if (profile === "wide") {
                                await page.screenshot({
                                        path: "test-results/documentation/wf5-planning-ai.png",
                                        fullPage: true,
                                });
                                await testInfo.attach("planning-ai", {
                                        path: "test-results/documentation/wf5-planning-ai.png",
                                });
                        }
                } finally {
                        await disposeTempProjectDir(dir);
                }
        });

        test(`[${profile}] 规划：服务失败可恢复——错误保留输入，恢复后重试成功`, async ({
                page,
        }) => {
                const dir = await createTempProject(page, { name: `规划AI败-${profile}` });
                try {
                        await seedPlanningWorld(page, dir);
                        await configureSession(page, { defaultCwd: dir, fault: "none" });
                        await openBook(page, `规划AI败-${profile}`);
                        await openWorkspace(page, "规划");
                        await page
                                .getByRole("banner")
                                .getByRole("button", { name: /AI 助手/ })
                                .click();
                        const panel = drawer(page);
                        await expect(panel).toBeVisible();

                        // 传输层注入 rpc_down（核心不可用＝模型/网络失败同形）：
                        // runWorkspace 装配即失败，抽屉给人话错误并保留输入。
                        // （夹具按「包含标记」选条目，问题骨架必含「拆章候选」，
                        // 因此模型层失败无法经补充指令构造——用传输故障同形替代。）
                        await panel
                                .getByRole("textbox", { name: /补充要求/ })
                                .fill("优先考虑节奏均匀的四幕结构");
                        await configureSession(page, { fault: "rpc_down" });
                        await panel.getByRole("button", { name: "生成拆章候选" }).click();
                        await expect(
                                panel.getByText(/无法启动 Novel Weaver 本地核心/),
                        ).toBeVisible();
                        // 完整句子定位：/输入已保留/ 会同时命中 sr-only 播报区。
                        await expect(
                                panel.getByText("输入已保留；可重试、更换模型或打开设置。"),
                        ).toBeVisible();
                        await expect(
                                panel.getByRole("textbox", { name: /补充要求/ }),
                        ).toHaveValue("优先考虑节奏均匀的四幕结构");

                        // 恢复：故障清除后重试，命中夹具条目成功。
                        await configureSession(page, { fault: "none" });
                        await panel.getByRole("button", { name: "重试" }).click();
                        await expect(
                                panel.getByText("拆章候选一（四幕各一章）"),
                        ).toBeVisible();
                        await expectNoWriteMethods(page);
                } finally {
                        await disposeTempProjectDir(dir);
                }
        });

        test(`[${profile}] 世界：规则未聚焦门禁 + 聚焦后冲突检查成功`, async ({
                page,
        }) => {
                const dir = await createTempProject(page, { name: `规则AI-${profile}` });
                try {
                        await seedRulesWorld(page, dir);
                        await configureSession(page, { defaultCwd: dir, fault: "none" });
                        await openBook(page, `规则AI-${profile}`);
                        await openWorkspace(page, "世界", "规则");

                        // 未聚焦规则：主操作禁用并解释出路（门禁型可恢复失败）。
                        await page
                                .getByRole("banner")
                                .getByRole("button", { name: /AI 助手/ })
                                .click();
                        const panel = drawer(page);
                        await expect(panel).toBeVisible();
                        // 默认片是「补全建议」；本用例聚焦冲突检查动作。
                        await panel.getByRole("tab", { name: "冲突检查" }).click();
                        const primary = panel.getByRole("button", { name: "检查规则冲突" });
                        await expect(primary).toBeDisabled();
                        await expect(
                                panel.getByText("先选中一条规则，再使用 AI 规则动作。"),
                        ).toBeVisible();

                        // 聚焦规则卡 → 主体注册 → 主操作启用并运行成功。
                        await panel.getByRole("button", { name: "关闭" }).click();
                        const ruleCard = page.locator('[data-rule-id="RULE-DEATH"]');
                        await ruleCard.locator("summary").click();
                        await page
                                .getByRole("banner")
                                .getByRole("button", { name: /AI 助手/ })
                                .click();
                        await expect(
                                panel.getByText("当前主体：人死不能复生"),
                        ).toBeVisible();
                        await expect(primary).toBeEnabled();
                        await primary.click();
                        await expect(panel.getByText("检查通过，未发现冲突。")).toBeVisible();
                        await expectNoWriteMethods(page);
                } finally {
                        await disposeTempProjectDir(dir);
                }
        });

        test(`[${profile}] 世界：关系人物对走向建议成功`, async ({ page }) => {
                const dir = await createTempProject(page, { name: `关系AI-${profile}` });
                try {
                        await seedRulesWorld(page, dir);
                        await configureSession(page, { defaultCwd: dir, fault: "none" });
                        await openBook(page, `关系AI-${profile}`);
                        await openWorkspace(page, "世界", "关系");

                        // 关系列表选中人物对（客观边）。
                        await page
                                .getByRole("button", {
                                        name: "林舟 → 苏晚，盟友，第 0 章起，尚未结束",
                                })
                                .click();

                        await page
                                .getByRole("banner")
                                .getByRole("button", { name: /AI 助手/ })
                                .click();
                        const panel = drawer(page);
                        await expect(panel).toBeVisible();
                        await expect(
                                panel.getByText("当前主体：林舟 × 苏晚"),
                        ).toBeVisible();
                        await panel.getByRole("button", { name: "生成关系建议" }).click();
                        await expect(
                                panel.getByText("关系走向推演（林舟 × 苏晚，当前故事时间）"),
                        ).toBeVisible();
                        await expectNoWriteMethods(page);
                } finally {
                        await disposeTempProjectDir(dir);
                }
        });

        test(`[${profile}] 审校：条目未选门禁 + 一致性解释成功`, async ({
                page,
        }) => {
                const dir = await createTempProject(page, { name: `审校AI-${profile}` });
                try {
                        await seedReviewWorld(page, dir);
                        await configureSession(page, { defaultCwd: dir, fault: "none" });
                        await openBook(page, `审校AI-${profile}`);
                        await openWorkspace(page, "审校");
                        await expect(
                                page.getByRole("heading", { name: "审校收件箱" }),
                        ).toBeVisible();

                        // 未选条目：主操作禁用并解释（门禁型可恢复失败）。
                        await page
                                .getByRole("banner")
                                .getByRole("button", { name: /AI 助手/ })
                                .click();
                        const panel = drawer(page);
                        await expect(panel).toBeVisible();
                        const primary = panel.getByRole("button", { name: "解释一致性" });
                        await expect(primary).toBeDisabled();
                        await expect(
                                panel.getByText("先在收件箱选中一个条目，再使用 AI 审校动作。"),
                        ).toBeVisible();

                        // 选中收件条目 → 主体注册 → 运行成功。
                        await panel.getByRole("button", { name: "关闭" }).click();
                        await page.getByRole("button", { name: /码头夜雾/ }).first().click();
                        await page
                                .getByRole("banner")
                                .getByRole("button", { name: /AI 助手/ })
                                .click();
                        await expect(
                                panel.getByText("当前主体："),
                        ).toBeVisible();
                        await expect(primary).toBeEnabled();
                        await primary.click();
                        await expect(
                                panel.getByText("一致性解释（收件条目：码头夜雾）"),
                        ).toBeVisible();
                        await expectNoWriteMethods(page);
                } finally {
                        await disposeTempProjectDir(dir);
                }
        });
}
