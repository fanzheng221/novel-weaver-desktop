import { formatAuthorValue } from "../../shared/ui/reference-label";
import { ARTIFACT_KIND_LABEL } from "./outline/artifact-proposal-form";
import type { PlanningEdge, PlanningNode } from "./planning-model";

/**
 * WF5-10「预览影响→确认纳入」纯模型：把 get_proposal 的 before/after
 * 翻译成人话字段差异 + 依赖影响面；原始 JSON 只留在高级详情。
 */

export interface ProposalPreviewLite {
	proposalId: string;
	kind: string;
	status: string;
	revision: number;
	subjectId: string;
	artifactId?: string;
	/** artifact_change：{title, content} | null（null=新建工件）。 */
	before: unknown;
	after: unknown;
}

/** 提案种类 → 人话（工件提案的种类是操作类别，不是工件 kind）。 */
const PROPOSAL_KIND_LABEL: Record<string, string> = {
	artifact_change: "工件提案",
	scene_candidate: "场景候选",
	finding_resolution: "审校修复",
	publication: "发布提案",
};

export interface FieldDiff {
	label: string;
	before: string | null;
	after: string;
}

export interface ProposalImpact {
	kindLabel: string;
	title: string;
	isNew: boolean;
	fieldDiffs: FieldDiff[];
	dependents: string[];
}

export const FIELD_LABEL: Record<string, string> = {
	goal: "目标",
	characterId: "人物",
	locationId: "地点",
	factionId: "势力",
	title: "标题",
	name: "名称",
	description: "说明",
	status: "状态",
	characters: "人物",
	locations: "地点",
	factions: "势力",
	scenes: "场景",
	chapters: "章节",
	narrativeMode: "叙事视角",
	conflict: "冲突",
	stakes: "代价",
	resolution: "解决方式",
	acts: "幕",
	purpose: "本章目的",
	targetWords: "目标字数",
	characterIds: "涉及人物",
	sceneIds: "关联场景",
	plotlineIds: "情节线",
	storyOrder: "故事序",
	chapterIds: "章节",
	viewpointCharacterId: "视点人物",
	setup: "埋设",
	payoff: "回收",
	setupChapterId: "埋点章节",
	payoffChapterId: "回收章节",
	startState: "起始状态",
	endState: "目标状态",
	milestones: "里程碑",
	tone: "语气",
	bannedTerms: "禁用词",
	platform: "平台",
	rating: "内容分级",
	rules: "规则",
	continuityId: "连续体",
	throughStoryOrder: "覆盖至故事序",
	text: "摘要正文",
	targetId: "目标工件",
	instruction: "修订指令",
	changes: "变更清单",
	downstreamArtifactIds: "下游工件",
	source: "来源",
	summary: "主题摘要",
	implications: "启示",
};

interface ArtifactSnapshot {
	title?: unknown;
	content?: unknown;
}

function readSnapshot(value: unknown): ArtifactSnapshot {
	return value && typeof value === "object" ? (value as ArtifactSnapshot) : {};
}


export function describeProposalImpact(input: {
	preview: ProposalPreviewLite;
	graph: { nodes: PlanningNode[]; edges: PlanningEdge[] } | null;
	idNames: Map<string, string>;
}): ProposalImpact {
	const { preview, graph, idNames } = input;
	const beforeSnapshot = readSnapshot(preview.before);
	const afterSnapshot = readSnapshot(preview.after);
	const beforeContent =
		beforeSnapshot.content && typeof beforeSnapshot.content === "object"
			? (beforeSnapshot.content as Record<string, unknown>)
			: null;
	const afterContent =
		afterSnapshot.content && typeof afterSnapshot.content === "object"
			? (afterSnapshot.content as Record<string, unknown>)
			: {};

	const beforeTitle =
		typeof beforeSnapshot.title === "string" ? beforeSnapshot.title : null;
	const afterTitle =
		typeof afterSnapshot.title === "string" ? afterSnapshot.title : "";

	const diffs: FieldDiff[] = [];
	if (!beforeContent) {
		if (afterTitle) {
			diffs.push({ label: "标题", before: null, after: afterTitle });
		}
		for (const [key, value] of Object.entries(afterContent)) {
			const formatted = formatAuthorValue(value, idNames, key, FIELD_LABEL);
			if (formatted) {
				diffs.push({
					label: FIELD_LABEL[key] ?? key,
					before: null,
					after: formatted,
				});
			}
		}
	} else {
		if (afterTitle && afterTitle !== beforeTitle) {
			diffs.push({
				label: "标题",
				before: beforeTitle,
				after: afterTitle,
			});
		}
		const keys = new Set([
			...Object.keys(beforeContent),
			...Object.keys(afterContent),
		]);
		for (const key of keys) {
			const next = formatAuthorValue(afterContent[key], idNames, key, FIELD_LABEL);
			const prev = formatAuthorValue(beforeContent[key], idNames, key, FIELD_LABEL);
			if (next !== prev) {
				diffs.push({
					label: FIELD_LABEL[key] ?? key,
					before: prev || null,
					after: next,
				});
			}
		}
	}

	const dependents = graph
		? graph.edges
				.filter((edge) => edge.sourceId === (preview.artifactId ?? preview.subjectId))
				.map((edge) => {
					const node = graph.nodes.find((item) => item.id === edge.targetId);
					return node ? node.title : "名称未找到（请核对引用）";
				})
		: [];

	return {
		kindLabel:
			PROPOSAL_KIND_LABEL[preview.kind] ??
			ARTIFACT_KIND_LABEL[preview.kind] ??
			preview.kind,
		title: afterTitle,
		isNew: !beforeContent,
		fieldDiffs: diffs,
		dependents,
	};
}

export interface ApproveDeps {
	query: <T>(cwd: string, method: string, params: unknown) => Promise<T>;
	cwd: string;
}

/**
 * 批准带过期基线自愈：revision 冲突时取最新 revision 重试一次，
 * 仍失败原样抛出（由调用方进入可恢复失败路径）。
 */
export async function approveProposalRobust(
	deps: ApproveDeps,
	proposalId: string,
	expectedRevision: number,
): Promise<void> {
	try {
		await deps.query(deps.cwd, "approve_proposal", {
			proposalId,
			expectedRevision,
		});
	} catch (raw) {
		const preview = await deps
			.query<{ revision: number }>(deps.cwd, "get_proposal", { proposalId })
			.catch(() => null);
		if (!preview || preview.revision === expectedRevision) throw raw;
		await deps.query(deps.cwd, "approve_proposal", {
			proposalId,
			expectedRevision: preview.revision,
		});
	}
}
