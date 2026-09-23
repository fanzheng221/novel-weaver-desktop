import { useState } from "react";
import { createRoot } from "react-dom/client";

// fixture 必须导入产品 base.css 而不是自造样式（ui-testing.md 约定）。
import "../shared/ui/base.css";

import type { PublicationEditionSummary } from "novel-weaver-core/src/domain/publication.ts";
import type { ReviewInboxFinding, ReviewInboxProjection } from "novel-weaver-core/src/domain/review-inbox.ts";
import {
	buildPublishSnapshot,
	canConfirm,
	editionNotes,
	findingDeepLink,
	initialPublishFlowState,
	publishFlowReducer,
	resolveScopeSceneIds,
	scopeHasScenes,
	scopeLabel,
	type NewVersionDraft,
	type PlanningNode,
	type PublishFlowState,
	type Scope,
} from "../features/publishing/publish-model";

/**
 * WF5-16（fixture 直打生产纯函数）：发布线性流程模型——
 *   · buildPublishSnapshot：三情境（空项目 / 健康可定版 / 阻断混合）；
 *   · editionNotes：正文已更新的版本注记；
 *   · scope 系列：全书/卷/章范围解析与可发布判定；
 *   · publishFlowReducer：步骤守卫与导出失败恢复（目录保留、重试清错）；
 *   · findingDeepLink / canConfirm：终审深链与定版门。
 */

function finding(overrides: Partial<ReviewInboxFinding>): ReviewInboxFinding {
	return {
		findingId: "QF-1",
		proposalId: "PRP-X",
		severity: "blocking",
		confidence: 0.9,
		code: "RULE_VIOLATION",
		message: "死人复生违反硬规则「人死不能复生」。",
		...overrides,
	};
}

const EMPTY_INBOX: ReviewInboxProjection = { proposals: [], findings: [] };

function findingInbox(findings: ReviewInboxFinding[]): ReviewInboxProjection {
	return { proposals: [], findings };
}

const PROMISE_OPEN: PlanningNode = {
	id: "ART-P1",
	kind: "story_promise",
	title: "钟楼的钥匙",
	content: { status: "open" },
};

const PROMISE_PAID: PlanningNode = {
	id: "ART-P2",
	kind: "story_promise",
	title: "已回收伏笔",
	content: { status: "paid_off" },
};

function edition(overrides: Partial<PublicationEditionSummary>): PublicationEditionSummary {
	return {
		editionId: "EDT-1",
		title: "雾城来信",
		formats: ["txt"],
		sceneCount: 3,
		createdAt: "2026-09-07T08:00:00.000Z",
		scenesChanged: 0,
		...overrides,
	};
}

function issueLine(issue: {
	severity: string;
	title: string;
	deepLink: { hash: string; label: string } | null;
}): string {
	return [issue.severity, issue.title, issue.deepLink ? issue.deepLink.hash : "无深链"].join("｜");
}

function planNode(id: string, kind: string, title: string, content: Record<string, unknown>): PlanningNode {
	return { id, kind, title, content };
}

const SCOPE_NODES: PlanningNode[] = [
	planNode("VOL-1", "volume_plan", "第一卷 雾城", { chapterIds: ["CH-1", "CH-2"] }),
	planNode("CH-1", "chapter_plan", "第 1 章 雨夜", { sceneIds: ["SC-A", "SC-B"] }),
	planNode("CH-2", "chapter_plan", "第 2 章 旧塔", { sceneIds: ["SC-B", "SC-C"] }),
];

function runReducer(
	state: PublishFlowState,
	actions: Parameters<typeof publishFlowReducer>[1][],
): string[] {
	let current = state;
	const trace: string[] = [`初始 step=${current.step} 目录=${current.export.directory}`];
	for (const action of actions) {
		current = publishFlowReducer(current, action);
		trace.push(
			[
				action.type,
				`step=${current.step}`,
				`phase=${current.export.phase}`,
				current.export.error ? `err=${current.export.error}` : "无错误",
				current.edition ? `版=${current.edition.title}` : "无版本",
			].join(" "),
		);
	}
	return trace;
}

function ModelFixture() {
	const [snapshotOut, setSnapshotOut] = useState<string[]>([]);
	const [scopeOut, setScopeOut] = useState<string[]>([]);
	const [reducerOut, setReducerOut] = useState<string[]>([]);
	const [miscOut, setMiscOut] = useState<string[]>([]);

	const buildSnapshot = (): void => {
		// 情境 A：空项目——还没有正文。
		const empty = buildPublishSnapshot({
			inbox: null,
			planningNodes: [],
			editions: [],
			canonicalSceneCount: 0,
			pendingPublications: [],
		});
		// 情境 B：健康——已有一版定稿，无阻断。
		const healthy = buildPublishSnapshot({
			inbox: EMPTY_INBOX,
			planningNodes: [PROMISE_PAID],
			editions: [edition({})],
			canonicalSceneCount: 3,
			pendingPublications: [],
		});
		// 情境 C：阻断混合——未回收伏笔 + 阻断/警告发现 + 过期版本。
		const mixed = buildPublishSnapshot({
			inbox: findingInbox([
				finding({ findingId: "QF-BLOCK", message: "死人复生违反硬规则「人死不能复生」。" }),
				finding({
					findingId: "QF-WARN",
					severity: "warning",
					confidence: 0.6,
					code: "PACING",
					message: "本场景节奏偏快。",
				}),
			]),
			planningNodes: [PROMISE_OPEN, PROMISE_PAID],
			editions: [edition({ scenesChanged: 2 }), edition({ editionId: "EDT-2", title: "第一卷试读" })],
			canonicalSceneCount: 3,
			pendingPublications: [{ proposalId: "PRP-PUB", revision: 1 }],
		});
		setSnapshotOut([
			[
				"空项目",
				`ready=${empty.readyToPublish}`,
				`blocking=${empty.blockingCount}`,
				`canCreate=${empty.canCreateVersion}`,
				`issues=${empty.issues.map(issueLine).join(" ;; ")}`,
				empty.summary,
			].join("｜"),
			[
				"健康",
				`ready=${healthy.readyToPublish}`,
				`stale=${healthy.staleEditionCount}`,
				`canCreate=${healthy.canCreateVersion}`,
				`issues=${healthy.issues.length}`,
				healthy.summary,
			].join("｜"),
			[
				"阻断混合",
				`ready=${mixed.readyToPublish}`,
				`blocking=${mixed.blockingCount}`,
				`stale=${mixed.staleEditionCount}`,
				`pending=${mixed.pendingPublications.length}`,
				`first=${mixed.issues[0] ? issueLine(mixed.issues[0]) : "无"}`,
				`all=${mixed.issues.map(issueLine).join(" ;; ")}`,
				mixed.summary,
			].join("｜"),
			`notes=${editionNotes(edition({ scenesChanged: 2 })).join("/") || "无注记"}`,
			`notesFresh=${editionNotes(edition({})).join("/") || "无注记"}`,
		]);
	};

	const buildScope = (): void => {
		const cases: Array<[string, Scope]> = [
			["全书", { mode: "book" }],
			["卷", { mode: "volume", id: "VOL-1" }],
			["章", { mode: "chapter", id: "CH-2" }],
			["空章", { mode: "chapter", id: "CH-X" }],
		];
		setScopeOut(
			cases.map(([name, scope]) =>
				[
					name,
					scopeLabel(SCOPE_NODES, scope),
					`ids=${JSON.stringify(resolveScopeSceneIds(SCOPE_NODES, scope))}`,
					`hasScenes=${scopeHasScenes(SCOPE_NODES, scope)}`,
				].join("｜"),
			),
		);
	};

	const buildReducer = (): void => {
		const start = initialPublishFlowState("/tmp/exports");
		// 主线：草稿 → 提案 → 确认 → 导出成功。
		const main = runReducer(start, [
			{ type: "editDraft", patch: { title: "雾城来信" } as Partial<NewVersionDraft> },
			{
				type: "proposalReviewed",
				proposal: {
					proposalId: "PRP-1",
					revision: 1,
					title: "雾城来信",
					formats: ["txt", "markdown"],
					sceneCount: 2,
					findings: [],
					canPublish: true,
				},
			},
			{ type: "confirmAccepted", editionId: "EDT-9" },
			{ type: "exportStarted" },
			{ type: "exportSucceeded", artifacts: [] },
		]);
		// 失败恢复：导出失败不回退步骤、目录保留；改目录后重试清错。
		const recovery = runReducer(start, [
			{
				type: "continueProposal",
				proposal: {
					proposalId: "PRP-2",
					revision: 2,
					title: "第一卷试读",
					formats: ["epub"],
					sceneCount: 1,
					findings: [],
					canPublish: true,
				},
			},
			{ type: "confirmAccepted", editionId: "EDT-8" },
			{ type: "exportStarted" },
			{ type: "exportFailed", error: "目标目录已有同名文件，不会被自动覆盖。" },
			{ type: "setExportDirectory", directory: "/tmp/exports-2" },
			{ type: "exportStarted" },
			{ type: "exportSucceeded", artifacts: [] },
		]);
		// 守卫：confirm/export 无前置条件时 goToStep 不动。
		const guarded = runReducer(start, [
			{ type: "goToStep", step: "confirm" },
			{ type: "goToStep", step: "export" },
			{ type: "goToStep", step: "version" },
		]);
		setReducerOut([
			`主线=${main.join(" ;; ")}`,
			`恢复=${recovery.join(" ;; ")}`,
			`守卫=${guarded.join(" ;; ")}`,
		]);
	};

	const buildMisc = (): void => {
		const canPublish = canConfirm({
			proposalId: "PRP-1",
			revision: 1,
			title: "雾城来信",
			formats: ["txt"],
			sceneCount: 1,
			findings: [],
			canPublish: true,
		});
		const blocked = canConfirm({
			proposalId: "PRP-1",
			revision: 1,
			title: "雾城来信",
			formats: ["txt"],
			sceneCount: 1,
			findings: [],
			canPublish: false,
		});
		setMiscOut([
			`canConfirm=${canPublish ? "可定版" : "阻断"}/${blocked ? "可定版" : "阻断"}`,
			`sceneBlocker=${findingDeepLink({
				severity: "blocking",
				code: "OPEN_SCENE_BLOCKER",
				message: "存在未处理的阻断问题。",
				evidenceIds: [],
			})?.hash ?? "无"}`,
			`promise=${findingDeepLink({
				severity: "blocking",
				code: "UNRESOLVED_STORY_PROMISE",
				message: "还有未回收的伏笔。",
				evidenceIds: [],
			})?.hash ?? "无"}`,
			`other=${findingDeepLink({
				severity: "warning",
				code: "PACING",
				message: "节奏偏快。",
				evidenceIds: [],
			})?.hash ?? "无"}`,
		]);
	};

	return (
		<div style={{ padding: 16, display: "grid", gap: 12 }}>
			<section style={{ display: "grid", gap: 6 }}>
				<h2>buildPublishSnapshot</h2>
				<button onClick={buildSnapshot}>构建快照</button>
				<ol data-testid="snapshot-out">
					{snapshotOut.map((text, index) => (
						<li key={index}>{text}</li>
					))}
				</ol>
			</section>

			<section style={{ display: "grid", gap: 6 }}>
				<h2>scope 系列</h2>
				<button onClick={buildScope}>解析范围</button>
				<ol data-testid="scope-out">
					{scopeOut.map((text, index) => (
						<li key={index}>{text}</li>
					))}
				</ol>
			</section>

			<section style={{ display: "grid", gap: 6 }}>
				<h2>publishFlowReducer</h2>
				<button onClick={buildReducer}>跑状态机</button>
				<ol data-testid="reducer-out">
					{reducerOut.map((text, index) => (
						<li key={index}>{text}</li>
					))}
				</ol>
			</section>

			<section style={{ display: "grid", gap: 6 }}>
				<h2>终审门与深链</h2>
				<button onClick={buildMisc}>检查终审</button>
				<ol data-testid="misc-out">
					{miscOut.map((text, index) => (
						<li key={index}>{text}</li>
					))}
				</ol>
			</section>
		</div>
	);
}

export default ModelFixture;

const root = document.getElementById("fixture-root");
if (root) createRoot(root).render(<ModelFixture />);
