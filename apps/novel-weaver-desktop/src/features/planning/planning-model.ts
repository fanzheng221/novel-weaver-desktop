import { ARTIFACT_KIND_LABEL } from "./outline/artifact-proposal-form";

/**
 * WF5-10 规划树纯模型：树结构只认已投影的字段（volume.chapterIds、
 * chapter.sceneIds），依赖边不参与树构建——rich outline JSON 中尚未投影的
 * 依赖不能被 UI 假装为稳定边（票面硬约束）。
 */

export interface PlanningNode {
	id: string;
	versionId: string;
	kind: string;
	title: string;
	content: Record<string, unknown>;
}

export interface PlanningEdge {
	sourceId: string;
	targetId: string;
	type: string;
}

export interface ReleaseRow {
	chapterArtifactId: string;
	title: string;
	status: "draft" | "stocked" | "published";
	totalScenes: number;
	confirmedScenes: number;
	lastConfirmedAt: string | null;
	plannedAt: string | null;
	editionId: string | null;
	publishedAt: string | null;
}

/** ADR-0075：章节四态由场景确认事实派生，作者不能直接拨动。 */
export type PhaseKey = "unwritten" | "generating" | "review" | "final";

export const PHASE_LABEL: Record<PhaseKey, string> = {
	unwritten: "未写",
	generating: "生成中",
	review: "待校对",
	final: "已定稿",
};

export function phaseOf(row: ReleaseRow | null): PhaseKey {
	if (!row || row.totalScenes === 0) return "unwritten";
	if (row.confirmedScenes === 0) return "generating";
	if (row.confirmedScenes < row.totalScenes) return "review";
	return "final";
}

export interface TreeChapter {
	node: PlanningNode;
	phase: PhaseKey;
	row: ReleaseRow | null;
	purpose: string;
	targetWords: number | null;
}

export interface TreeScene {
	node: PlanningNode;
	purpose: string;
	povName: string | null;
}

export interface TreeVolume {
	node: PlanningNode;
	goal: string;
	chapters: TreeChapter[];
}

export interface PlanningTreeModel {
	outline: PlanningNode | null;
	outlineSummary: { goal: string; acts: string[] } | null;
	volumes: TreeVolume[];
	looseChapters: TreeChapter[];
	/** 全部场景计划（含已挂章）：供树在章节下渲染场景行。 */
	scenes: TreeScene[];
	unfiledScenes: TreeScene[];
	others: Array<{ kind: string; label: string; nodes: PlanningNode[] }>;
	chapterCount: number;
}

function readStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.map(String) : [];
}

/** 从大纲 content 提取摘要：goal 与 acts（拆章指令的预填来源）。 */
export function outlineSummaryOf(node: PlanningNode): {
	goal: string;
	acts: string[];
} {
	return {
		goal: typeof node.content.goal === "string" ? node.content.goal : "",
		acts: readStringArray(node.content.acts),
	};
}

export function buildPlanningTree(input: {
	graph: { nodes: PlanningNode[]; edges: PlanningEdge[] };
	releaseRows: ReleaseRow[];
	entityNames: Map<string, string>;
}): PlanningTreeModel {
	const { graph, releaseRows, entityNames } = input;
	const rowsByChapter = new Map(
		releaseRows.map((row) => [row.chapterArtifactId, row]),
	);
	const toChapter = (node: PlanningNode): TreeChapter => {
		const row = rowsByChapter.get(node.id) ?? null;
		return {
			node,
			row,
			phase: phaseOf(row),
			purpose:
				typeof node.content.purpose === "string" ? node.content.purpose : "",
			targetWords:
				typeof node.content.targetWords === "number"
					? node.content.targetWords
					: null,
		};
	};

	const outline = graph.nodes.find((node) => node.kind === "outline") ?? null;
	const chapters = graph.nodes
		.filter((node) => node.kind === "chapter_plan")
		.map(toChapter);

	const volumes: TreeVolume[] = graph.nodes
		.filter((node) => node.kind === "volume_plan")
		.map((node) => {
			const ids = new Set(readStringArray(node.content.chapterIds));
			return {
				node,
				goal: typeof node.content.goal === "string" ? node.content.goal : "",
				chapters: chapters.filter((chapter) => ids.has(chapter.node.id)),
			};
		});
	const filed = new Set(
		volumes.flatMap((volume) =>
			volume.chapters.map((chapter) => chapter.node.id),
		),
	);
	const looseChapters = chapters.filter(
		(chapter) => !filed.has(chapter.node.id),
	);

	const toScene = (node: PlanningNode): TreeScene => {
		const povId =
			typeof node.content.viewpointCharacterId === "string"
				? node.content.viewpointCharacterId
				: null;
		return {
			node,
			purpose:
				typeof node.content.purpose === "string" ? node.content.purpose : "",
			povName: povId ? (entityNames.get(povId) ?? povId) : null,
		};
	};
	const scenes = graph.nodes
		.filter((node) => node.kind === "scene_plan")
		.map(toScene);
	const sceneFiled = new Set(
		chapters.flatMap((chapter) =>
			readStringArray(chapter.node.content.sceneIds),
		),
	);
	const unfiledScenes = scenes.filter(
		(scene) => !sceneFiled.has(scene.node.id),
	);

	const othersByKind = new Map<string, PlanningNode[]>();
	for (const node of graph.nodes) {
		if (
			node.kind === "outline" ||
			node.kind === "volume_plan" ||
			node.kind === "chapter_plan" ||
			// 节奏范本有自己的模板库页（WF2-16）。
			node.kind === "pacing_template"
		) {
			continue;
		}
		othersByKind.set(node.kind, [...(othersByKind.get(node.kind) ?? []), node]);
	}
	const others = [...othersByKind.entries()].map(([kind, nodes]) => ({
		kind,
		label: ARTIFACT_KIND_LABEL[kind] ?? kind,
		nodes,
	}));

	return {
		outline,
		outlineSummary: outline ? outlineSummaryOf(outline) : null,
		volumes,
		looseChapters,
		scenes,
		unfiledScenes,
		others,
		chapterCount: chapters.length,
	};
}

export type NextAction =
	| { kind: "empty" }
	| { kind: "split-chapters"; outline: PlanningNode }
	| { kind: "tree" };

/** 唯一下一步：零工件留空态引导；有总纲零章给拆章主操作；否则进树。 */
export function nextActionOf(model: PlanningTreeModel): NextAction {
	if (model.outline && model.chapterCount === 0) {
		return { kind: "split-chapters", outline: model.outline };
	}
	if (
		model.outline === null &&
		model.chapterCount === 0 &&
		model.volumes.length === 0 &&
		model.unfiledScenes.length === 0 &&
		model.others.length === 0
	) {
		return { kind: "empty" };
	}
	return { kind: "tree" };
}

export interface SplitChapterDraft {
	key: string;
	title: string;
	purpose: string;
	storyOrder: number;
}

const TITLE_SPLIT_MARKS = /[,，。；;．.：:]/;

/** 逐行解析拆章指令：空行跳过；标题取首个标点前的片段（≤14 字）。 */
export function parseSplitInstruction(
	instruction: string,
): SplitChapterDraft[] {
	const drafts: SplitChapterDraft[] = [];
	for (const rawLine of instruction.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const order = drafts.length + 1;
		const head = line.split(TITLE_SPLIT_MARKS)[0]?.trim() ?? "";
		const title = head ? `第${order}章 · ${head.slice(0, 14)}` : `第${order}章`;
		drafts.push({
			key: `draft-${order}`,
			title,
			purpose: line,
			storyOrder: order,
		});
	}
	return drafts;
}
