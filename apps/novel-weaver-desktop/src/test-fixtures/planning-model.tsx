import { useReducer, useState } from "react";
import { createRoot } from "react-dom/client";

// fixture 必须导入产品 base.css 而不是自造样式（ui-testing.md 约定）。
import "../shared/ui/base.css";

import {
	describeProposalImpact,
	type ProposalPreviewLite,
} from "../features/planning/confirm-model";
import {
	buildPlanningTree,
	nextActionOf,
	type PlanningEdge,
	type PlanningNode,
	parseSplitInstruction,
	type ReleaseRow,
} from "../features/planning/planning-model";
import {
	createInitialSplitState,
	matchPendingToDrafts,
	type PendingPreview,
	splitReducer,
} from "../features/planning/split-machine";

/**
 * WF5-10（补充层，fixture 直打生产纯函数/reducer）：规划树模型——
 *   · buildPlanningTree：总纲→卷→章→场景只认投影字段，未挂章场景/散章归组；
 *   · nextActionOf：零工件 empty / 有纲零章 split-chapters / 其余 tree；
 *   · parseSplitInstruction：逐行拆章草案，标题取首个标点前片段；
 *   · describeProposalImpact：before/after → 人话 diff + 依赖影响面；
 *   · splitReducer + matchPendingToDrafts：拆章流与对账防重复。
 */

const OUTLINE: PlanningNode = {
	id: "ART-OUTLINE",
	versionId: "AV-1",
	kind: "outline",
	title: "示例小说总纲",
	content: { goal: "揭开示例城城的旧案", acts: ["身世揭开一角", "旧案重启"] },
};
const VOLUME: PlanningNode = {
	id: "ART-VOL1",
	versionId: "AV-2",
	kind: "volume_plan",
	title: "第一卷",
	content: { goal: "立足示例城", chapterIds: ["ART-CH1", "ART-CH2"] },
};
const CH1: PlanningNode = {
	id: "ART-CH1",
	versionId: "AV-3",
	kind: "chapter_plan",
	title: "第一章 · 归城",
	content: {
		purpose: "主角回到示例城",
		targetWords: 3000,
		characterIds: ["ENT-1"],
		sceneIds: ["ART-SC1"],
	},
};
const CH2: PlanningNode = {
	id: "ART-CH2",
	versionId: "AV-4",
	kind: "chapter_plan",
	title: "第二章 · 旧档",
	content: { purpose: "翻出旧案档案" },
};
const SCENE: PlanningNode = {
	id: "ART-SC1",
	versionId: "AV-5",
	kind: "scene_plan",
	title: "城门初见",
	content: { purpose: "与旧识重逢", viewpointCharacterId: "ENT-1" },
};
const ORPHAN_SCENE: PlanningNode = {
	id: "ART-SC2",
	versionId: "AV-6",
	kind: "scene_plan",
	title: "无名场景",
	content: { purpose: "未挂章", viewpointCharacterId: "ENT-1" },
};
const PROMISE: PlanningNode = {
	id: "ART-PROMISE1",
	versionId: "AV-7",
	kind: "story_promise",
	title: "玉佩之谜",
	content: { setup: "玉佩现身", payoff: "身世揭开" },
};

const GRAPH_FULL: PlanningNode[] = [
	OUTLINE,
	VOLUME,
	CH1,
	CH2,
	SCENE,
	ORPHAN_SCENE,
	PROMISE,
];
const EDGES: PlanningEdge[] = [
	{ sourceId: "ART-CH1", targetId: "ART-OUTLINE", type: "depends_on" },
];
const ROWS: ReleaseRow[] = [
	{
		chapterArtifactId: "ART-CH1",
		title: "第一章 · 归城",
		status: "stocked",
		totalScenes: 2,
		confirmedScenes: 1,
		lastConfirmedAt: null,
		plannedAt: null,
		editionId: null,
		publishedAt: null,
	},
];
const ENTITY_NAMES = new Map([["ENT-1", "角色甲"]]);

const PREVIEW_EDIT: ProposalPreviewLite = {
	proposalId: "PR-1",
	kind: "artifact_change",
	status: "pending",
	revision: 2,
	subjectId: "ART-CH1",
	before: {
		title: "第一章 · 归城",
		content: { purpose: "主角回到示例城", targetWords: 3000 },
	},
	after: {
		title: "第一章 · 归城",
		content: {
			purpose: "主角深夜回到示例城",
			targetWords: 3200,
			characterIds: ["ENT-1"],
		},
	},
};

const PREVIEW_NEW: ProposalPreviewLite = {
	proposalId: "PR-2",
	kind: "artifact_change",
	status: "pending",
	revision: 1,
	subjectId: "ART-CH2",
	before: null,
	after: {
		title: "第三章 · 突围",
		content: { purpose: "突围出城", storyOrder: 3 },
	},
};

function ModelFixture() {
	const [treeOut, setTreeOut] = useState<string[]>([]);
	const [nextAction, setNextAction] = useState("");
	const [drafts, setDrafts] = useState<string[]>([]);
	const [impact, setImpact] = useState("");
	const [state, dispatch] = useReducer(
		splitReducer,
		undefined,
		createInitialSplitState,
	);
	const [reconciled, setReconciled] = useState("");

	const showTree = (nodes: PlanningNode[], rows: ReleaseRow[]) => {
		const model = buildPlanningTree({
			graph: { nodes, edges: EDGES },
			releaseRows: rows,
			entityNames: ENTITY_NAMES,
		});
		setTreeOut([
			`outline=${model.outline?.id ?? "none"}`,
			`volumes=${model.volumes
				.map(
					(volume) =>
						`${volume.node.id}[${volume.chapters.map((chapter) => chapter.node.id).join(",")}]`,
				)
				.join("|")}`,
			`loose=${model.looseChapters.map((chapter) => chapter.node.id).join(",")}`,
			`unfiledScenes=${model.unfiledScenes.map((scene) => `${scene.node.id}${scene.povName ? `@${scene.povName}` : ""}`).join(",")}`,
			`others=${model.others.map((group) => `${group.label}:${group.nodes.length}`).join("|")}`,
			`chapterCount=${model.chapterCount}`,
		]);
		const action = nextActionOf(model);
		setNextAction(action.kind === "split-chapters" ? action.kind : action.kind);
	};

	const parse = (instruction: string) => {
		setDrafts(
			parseSplitInstruction(instruction).map(
				(draft) => `${draft.title}｜${draft.purpose}｜${draft.storyOrder}`,
			),
		);
	};

	const showImpact = (preview: ProposalPreviewLite) => {
		const result = describeProposalImpact({
			preview,
			graph: { nodes: GRAPH_FULL, edges: EDGES },
			idNames: ENTITY_NAMES,
		});
		setImpact(
			[
				`${result.kindLabel}｜${result.title}｜isNew=${result.isNew}`,
				...result.fieldDiffs.map(
					(diff) =>
						`${diff.label}: ${diff.before ?? "（新增）"} → ${diff.after}`,
				),
				`dependents=${result.dependents.join(",")}`,
			].join("\n"),
		);
	};

	const reconcile = () => {
		const previews: PendingPreview[] = [
			{
				proposalId: "PR-9",
				revision: 1,
				subjectId: "ART-NEW2",
				after: {
					title: "第2章 · 第二章内容",
					content: { purpose: "第二章内容。" },
				},
			},
		];
		const matched = matchPendingToDrafts(previews, state.items);
		setReconciled(
			[...matched.entries()]
				.map(([key, hit]) => `${key}=${hit.proposalId}`)
				.join(","),
		);
	};

	const phase = state.phase;
	const items = state.items;

	return (
		<div style={{ padding: 16, display: "grid", gap: 12 }}>
			<section style={{ display: "grid", gap: 6 }}>
				<h2>buildPlanningTree / nextActionOf</h2>
				<button onClick={() => showTree(GRAPH_FULL, ROWS)}>完整树</button>
				<button onClick={() => showTree([OUTLINE], [])}>有纲零章</button>
				<button onClick={() => showTree([], [])}>零工件</button>
				<ol data-testid="tree-out">
					{treeOut.map((line, index) => (
						<li key={index}>{line}</li>
					))}
				</ol>
				<p data-testid="next-action">{nextAction}</p>
			</section>

			<section style={{ display: "grid", gap: 6 }}>
				<h2>parseSplitInstruction</h2>
				<button
					onClick={() =>
						parse("身世揭开一角，旧友重逢。\n\n旧案重启，档案失踪。")
					}
				>
					解析两行指令
				</button>
				<button onClick={() => parse("\n \n")}>解析空指令</button>
				<ol data-testid="draft-out">
					{drafts.map((line, index) => (
						<li key={index}>{line}</li>
					))}
				</ol>
			</section>

			<section style={{ display: "grid", gap: 6 }}>
				<h2>describeProposalImpact</h2>
				<button onClick={() => showImpact(PREVIEW_EDIT)}>修订预览</button>
				<button onClick={() => showImpact(PREVIEW_NEW)}>新建预览</button>
				<pre data-testid="impact-out" style={{ whiteSpace: "pre-wrap" }}>
					{impact}
				</pre>
			</section>

			<section style={{ display: "grid", gap: 6 }}>
				<h2>splitReducer</h2>
				<button
					onClick={() =>
						dispatch({
							type: "open",
							outlineId: "ART-OUTLINE",
							instruction: "第一章内容。\n第二章内容。",
						})
					}
				>
					打开拆章流
				</button>
				<button
					disabled={phase !== "editing"}
					onClick={() =>
						dispatch({
							type: "parsed",
							items: parseSplitInstruction(state.instruction),
						})
					}
				>
					生成预览
				</button>
				<button
					disabled={phase !== "previewing"}
					onClick={() =>
						dispatch({
							type: "itemChanged",
							key: "draft-1",
							patch: { title: "改后的第一章" },
						})
					}
				>
					改第一条标题
				</button>
				<button
					disabled={phase !== "previewing"}
					onClick={() => dispatch({ type: "itemRemoved", key: "draft-2" })}
				>
					删除第二条
				</button>
				<button
					disabled={phase !== "previewing"}
					onClick={() => dispatch({ type: "runStarted" })}
				>
					开始执行
				</button>
				<button
					disabled={phase !== "running"}
					onClick={() => {
						dispatch({
							type: "itemCreated",
							key: "draft-1",
							proposalId: "PR-A",
							revision: 1,
							artifactId: "ART-NEW1",
						});
						dispatch({ type: "itemApproved", key: "draft-1" });
					}}
				>
					第一条完成
				</button>
				<button
					disabled={phase !== "running"}
					onClick={() => {
						dispatch({
							type: "itemFailed",
							key: "draft-2",
							error: { message: "本地核心不可达", detail: "rpc_down" },
						});
						dispatch({ type: "runFailed" });
					}}
				>
					第二条失败
				</button>
				<button
					disabled={phase !== "running"}
					onClick={() => dispatch({ type: "runSucceeded" })}
				>
					全部成功
				</button>
				<button
					disabled={phase !== "failed"}
					onClick={() => dispatch({ type: "retry" })}
				>
					重试
				</button>
				<button
					disabled={phase !== "failed"}
					onClick={() => dispatch({ type: "adjust" })}
				>
					调整指令
				</button>
				<button onClick={() => dispatch({ type: "closed" })}>关闭</button>
				<button onClick={reconcile}>对账匹配</button>
				<p data-testid="split-phase">{phase}</p>
				<p data-testid="split-instruction">{state.instruction}</p>
				<p data-testid="split-items">
					{items
						.map(
							(item) => `${item.draft.key}:${item.draft.title}:${item.status}`,
						)
						.join("|")}
				</p>
				<p data-testid="split-failure">{state.failure?.message ?? "—"}</p>
				<p data-testid="split-first">{state.firstCreatedArtifactId ?? "—"}</p>
				<p data-testid="split-reconciled">{reconciled || "—"}</p>
			</section>
		</div>
	);
}

export default ModelFixture;

const root = document.getElementById("fixture-root");
if (root) createRoot(root).render(<ModelFixture />);
