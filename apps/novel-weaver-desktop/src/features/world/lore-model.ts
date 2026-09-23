import type { ReviewInboxProjection } from "novel-weaver-core/src/domain/review-inbox.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { queryProject } from "../../shared/api/rpc";
import { describeRpcError } from "../../shared/ui/states";
import { relationshipTypeLabel } from "../../shared/ui/terms";

/**
 * 世界区共享领域模型（WF5-11）：类型、纯选择器与数据加载。
 * 规则/人物/设定/关系四个子区从这里取同一份真实读模型
 * （get_design_overview / relationship_query / list_pending_proposals），
 * 子区切分、标签池、过滤与搜索命中都是纯函数，可被 fixture 直接验证。
 */

export interface RuleSummary {
	id: string;
	name: string;
	description: string;
	examples: string[];
}

export interface EntitySummary {
	id: string;
	type: string;
	canonicalName: string;
	description: string;
	attributes: Record<string, unknown>;
}

export interface DesignOverview {
	hardRules: RuleSummary[];
	softRules: RuleSummary[];
	entities: EntitySummary[];
	entityCount: number;
	relationshipCount: number;
	attitudeCount: number;
}

export interface RelationshipNode {
	id: string;
	label: string;
	type: string;
}

export interface RelationshipGraph {
	nodes: RelationshipNode[];
	objectiveEdges: Array<{
		id?: string;
		sourceId: string;
		targetId: string;
		relationshipType: string;
	}>;
}

export interface PendingProposal {
	subjectTitle?: string | null;
	createdAt?: string;
	proposalId: string;
	kind: string;
	revision: number;
}

/** 人物卡结构化扩展字段（WF2-03）：全部落在实体 attributes，不新增表。 */
export interface CharacterProfile {
	personality: string;
	appearance: string;
	abilities: string;
	notes: string;
	tags: string[];
}

/** 实体子区切分：人物之外的一切（地点/势力/物品/词条/自定义）都归设定。 */
export type EntitySub = "characters" | "lore";

export function subOfEntity(type: string): EntitySub {
	return type === "character" ? "characters" : "lore";
}

export function readTags(attributes: Record<string, unknown>): string[] {
	const raw = attributes.tags;
	return Array.isArray(raw) ? raw.map((item) => String(item)) : [];
}

export function readProfile(
	attributes: Record<string, unknown>,
): CharacterProfile {
	const text = (key: string) =>
		typeof attributes[key] === "string" ? (attributes[key] as string) : "";
	return {
		personality: text("personality"),
		appearance: text("appearance"),
		abilities: text("abilities"),
		notes: text("notes"),
		tags: readTags(attributes),
	};
}

export function parseTags(raw: string): string[] {
	return raw
		.split(/[,，]/)
		.map((part) => part.trim())
		.filter(Boolean);
}

export function newEntityId(prefix: string, existing: Set<string>): string {
	let id = "";
	do {
		id = `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
	} while (existing.has(id));
	return id;
}

export function attributeText(attributes: Record<string, unknown>): string {
	return Object.entries(attributes)
		.map(([key, value]) =>
			Array.isArray(value)
				? `${key}:${value.join(" ")}`
				: typeof value === "string"
					? `${key}:${value}`
					: "",
		)
		.filter(Boolean)
		.join(" · ");
}

/** 子区内某标签下的实体（纯函数，fixture 可验）。 */
export function entitiesWithTag(
	entities: EntitySummary[],
	tag: string | null,
): EntitySummary[] {
	return tag
		? entities.filter((entity) => readTags(entity.attributes).includes(tag))
		: entities;
}

/** 子区实体聚合出的标签池（纯函数，fixture 可验）。 */
export function tagPoolOf(entities: EntitySummary[]): string[] {
	const pool = new Set<string>();
	for (const entity of entities) {
		for (const tag of readTags(entity.attributes)) pool.add(tag);
	}
	return [...pool].sort();
}

// --- 全文检索（WF2-04 语义保留，WF5-11 迁入共享模型） ---

interface HighlightPart {
	text: string;
	hit: boolean;
	start: number;
}

function highlightParts(text: string, needle: string): HighlightPart[] {
	const lowerText = text.toLowerCase();
	const lowerNeedle = needle.toLowerCase();
	if (!needle) return [{ text, hit: false, start: 0 }];
	const parts: HighlightPart[] = [];
	let cursor = 0;
	let found = lowerText.indexOf(lowerNeedle);
	while (found !== -1) {
		if (found > cursor)
			parts.push({
				text: text.slice(cursor, found),
				hit: false,
				start: cursor,
			});
		parts.push({
			text: text.slice(found, found + needle.length),
			hit: true,
			start: found,
		});
		cursor = found + needle.length;
		found = lowerText.indexOf(lowerNeedle, cursor);
	}
	if (cursor < text.length)
		parts.push({ text: text.slice(cursor), hit: false, start: cursor });
	return parts.filter((part) => part.text);
}

/** 命中片段：截取首次命中的前后窗口，避免长文刷屏。 */
export function snippet(text: string, needle: string, radius = 26): string {
	const index = text.toLowerCase().indexOf(needle);
	if (index === -1) return text.slice(0, radius * 2);
	const start = Math.max(0, index - radius);
	const end = Math.min(text.length, index + needle.length + radius);
	return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** 搜索命中：jump 由呈现层给（跳子区路由），模型层只判命中与摘要。 */
export interface SearchHit {
	key: string;
	glyph: string;
	title: string;
	sub: string;
	text: string;
}

export function searchWorld(
	needle: string,
	overview: DesignOverview,
	graph: RelationshipGraph | null,
): SearchHit[] {
	const hits: SearchHit[] = [];
	for (const rule of [...overview.hardRules, ...overview.softRules]) {
		const text = [rule.description, ...rule.examples].join(" ");
		if (`${rule.name} ${rule.id} ${text}`.toLowerCase().includes(needle)) {
			hits.push({
				key: `rule-${rule.id}`,
				glyph: "律",
				title: rule.name,
				sub: rule.id,
				text,
			});
		}
	}
	for (const entity of overview.entities) {
		const text = `${entity.description} ${attributeText(entity.attributes)}`;
		if (
			`${entity.canonicalName} ${entity.type} ${entity.id} ${text}`
				.toLowerCase()
				.includes(needle)
		) {
			hits.push({
				key: `entity-${entity.id}`,
				glyph:
					subOfEntity(entity.type) === "characters"
						? (entity.canonicalName[0] ?? "人")
						: "设",
				title: entity.canonicalName,
				sub: entity.id,
				text,
			});
		}
	}
	if (graph) {
		for (const edge of graph.objectiveEdges) {
			const label = (id: string) =>
				graph.nodes.find((node) => node.id === id)?.label ?? id;
			const title = `${label(edge.sourceId)} — ${relationshipTypeLabel(edge.relationshipType)} → ${label(edge.targetId)}`;
			if (title.toLowerCase().includes(needle)) {
				hits.push({
					key: `rel-${edge.sourceId}-${edge.targetId}-${edge.relationshipType}`,
					glyph: "系",
					title,
					sub: "客观关系",
					text: "",
				});
			}
		}
	}
	return hits;
}

export { highlightParts, snippet as clipSnippet };

// --- 共享数据加载 ---

export interface WorldData {
	overview: DesignOverview;
	graph: RelationshipGraph | null;
	pending: PendingProposal[];
}

/**
 * 世界区四子区共用的真实数据加载：同 envelope 直连 local RPC，
 * 每个子区页挂载即取一份（本地核心开销可忽略），错误带重试。
 */
export function useWorldData(cwd: string): {
	data: WorldData | null;
	phase: "loading" | "ready" | "failed";
	loadError: ReturnType<typeof describeRpcError> | null;
	reload: () => Promise<void>;
} {
	const [data, setData] = useState<WorldData | null>(null);
	const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
	const [loadError, setLoadError] = useState<ReturnType<
		typeof describeRpcError
	> | null>(null);

	const reload = useCallback(async () => {
		setLoadError(null);
		try {
			const overview = await queryProject<DesignOverview>(
				cwd,
				"get_design_overview",
				{},
			);
			const graph = await queryProject<RelationshipGraph>(
				cwd,
				"relationship_query",
				{ continuityId: "main", storyOrder: 0 },
			);
			const queue = await queryProject<ReviewInboxProjection>(
				cwd,
				"list_review_inbox",
				{},
			);
			setData({
				overview,
				graph,
				pending: queue.proposals.filter((item) => item.kind === "design_change"),
			});
			setPhase("ready");
		} catch (raw) {
			setLoadError(describeRpcError(raw));
			setPhase("failed");
		}
	}, [cwd]);

	useEffect(() => {
		void reload();
	}, [reload]);

	return { data, phase, loadError, reload };
}

/** 某个人物的客观关系边（纯函数）：图谱里触及该人物的所有客观关系。 */
export function relationsOfCharacter(
	graph: RelationshipGraph | null,
	characterId: string,
): Array<{ sourceId: string; targetId: string; relationshipType: string }> {
	if (!graph) return [];
	return graph.objectiveEdges.filter(
		(edge) => edge.sourceId === characterId || edge.targetId === characterId,
	);
}

/** 共享 useMemo 便捷：子区实体切片。 */
export function useSubEntities(
	entities: EntitySummary[],
	sub: EntitySub,
): EntitySummary[] {
	return useMemo(
		() => entities.filter((entity) => subOfEntity(entity.type) === sub),
		[entities, sub],
	);
}
