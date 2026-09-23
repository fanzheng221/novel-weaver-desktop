import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

// fixture 必须导入产品 base.css 而不是自造样式（ui-testing.md 约定）。
import "../shared/ui/base.css";

import type {
	ContextPackageView,
	RelationshipGraphView,
} from "../features/writing/assistant/gateway";
import {
	type AssistantState,
	assistantReducer,
	createInitialAssistantState,
	phaseAnnouncement,
} from "../features/writing/assistant/machine";

/**
 * WF5-07（补充层）：助手状态机的副作用边界——
 *   · 只有 kind=candidate 的成功会进入候选带；
 *   · 讨论推演 / 检查正文的结果互不越界；
 *   · 取消后 activeRunId 归零，迟到结果被丢弃，不遗留半成品。
 * 真实 RPC 的零写入边界由 core 集成测试与 e2e 覆盖。
 */

const PKG: ContextPackageView = {
	contextId: "CTX-TEST",
	truncated: false,
	renderedCharacters: 900,
	budgetCharacters: 40_000,
	selections: [
		{ sourceType: "hard_rule", sourceId: "RULE-A", reason: "硬规则" },
		{ sourceType: "canonical_scene", sourceId: "SV-1", reason: "前文" },
	],
	hardRuleCount: 1,
};

const GRAPH: RelationshipGraphView = {
	characters: [{ id: "CHAR-LIN", label: "林舟", description: "" }],
	attitudeEdges: [],
};

function action(name: string, payload: unknown): void {
	window.dispatchEvent(
		new CustomEvent("assistant-fixture-action", { detail: { name, payload } }),
	);
}

function MachineFixture() {
	const [state, setState] = useState<AssistantState>(
		createInitialAssistantState,
	);

	useEffect(() => {
		let runId = 0;
		const reduce = (name: string, payload: unknown) => {
			setState((current) => {
				switch (name) {
					case "assemble":
						runId += 1;
						return assistantReducer(current, { type: "runStarted", runId });
					case "phase-running":
						return assistantReducer(current, {
							type: "runPhase",
							runId,
							phase: "running",
						});
					case "context":
						return assistantReducer(current, {
							type: "contextAssembled",
							storyOrder: 10,
							pkg: PKG,
							graph: GRAPH,
							defaultEntityIds: new Set(),
						});
					case "candidate-ok":
						return assistantReducer(current, {
							type: "runSucceeded",
							runId,
							kind: "candidate",
							payload: {
								markdown: "候选正文",
								usage: { promptTokens: 10, completionTokens: 5 },
							},
							title: "雾中来客",
						});
					case "discussion-ok":
						return assistantReducer(current, {
							type: "runSucceeded",
							runId,
							kind: "discussion",
							payload: {
								markdown: "推演回应",
								usage: { promptTokens: 10, completionTokens: 5 },
							},
						});
					case "inspection-ok":
						return assistantReducer(current, {
							type: "runSucceeded",
							runId,
							kind: "inspection",
							payload: {
								markdown: "检查建议",
								usage: { promptTokens: 10, completionTokens: 5 },
							},
						});
					case "cancel":
						return assistantReducer(current, { type: "runCancelled", runId });
					case "late-candidate":
						return assistantReducer(current, {
							type: "runSucceeded",
							runId,
							kind: "candidate",
							payload: {
								markdown: "迟到候选",
								usage: { promptTokens: 1, completionTokens: 1 },
							},
							title: "迟到",
						});
					default:
						return current;
				}
			});
		};
		const listener = (event: Event) => {
			const detail = (event as CustomEvent).detail as {
				name: string;
				payload: unknown;
			};
			reduce(detail.name, detail.payload);
		};
		window.addEventListener("assistant-fixture-action", listener);
		return () =>
			window.removeEventListener("assistant-fixture-action", listener);
	}, []);

	return (
		<main className="min-h-dvh bg-shell p-6 grid gap-2">
			<section aria-label="助手状态机边界夹具" className="grid gap-1.5">
				<p data-testid="phase">{state.phase}</p>
				<p data-testid="active-run">{state.activeRunId}</p>
				<p data-testid="candidates">{state.candidates.length}</p>
				<p data-testid="discussion">{state.discussion ?? "∅"}</p>
				<p data-testid="suggestions">{state.suggestions ?? "∅"}</p>
				<p data-testid="announcement">{phaseAnnouncement(state)}</p>
				<p data-testid="latest-candidate">
					{state.candidates[0]?.title ?? "∅"}
				</p>
			</section>
			<section aria-label="动作" className="grid gap-1">
				<button type="button" onClick={() => action("assemble", null)}>
					开始运行
				</button>
				<button type="button" onClick={() => action("phase-running", null)}>
					进入生成
				</button>
				<button type="button" onClick={() => action("context", null)}>
					装配上下文
				</button>
				<button type="button" onClick={() => action("candidate-ok", null)}>
					候选成功
				</button>
				<button type="button" onClick={() => action("discussion-ok", null)}>
					讨论成功
				</button>
				<button type="button" onClick={() => action("inspection-ok", null)}>
					检查成功
				</button>
				<button type="button" onClick={() => action("cancel", null)}>
					取消
				</button>
				<button type="button" onClick={() => action("late-candidate", null)}>
					迟到候选
				</button>
			</section>
		</main>
	);
}

const root = document.getElementById("fixture-root");
if (root) {
	createRoot(root).render(<MachineFixture />);
}
