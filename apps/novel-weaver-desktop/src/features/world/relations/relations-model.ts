/**
 * 统一关系工作区领域模型（WF5-13）：纯函数 + 本地偏好持久化。
 * 事实一律来自核心 `relationship_query` 投影——知识边界（POV/私密可见性）
 * 由核心强制，这里只做故事时间切片与类型筛选；图与列表消费同一谓词。
 * 放射布局、态度弧偏移、变化事件均为纯函数，可被 fixture 直打。
 */

import { attitudeDimensionLabel, relationshipTypeLabel } from "../../../shared/ui/terms";

export interface RelationNode {
	id: string;
	label: string;
	type: string;
	description: string;
}

export interface RelationObjectiveEdge {
	id: string;
	sourceId: string;
	targetId: string;
	relationshipType: string;
	validFrom: number;
	validTo?: number;
	visibility: "public" | "private";
	knownBy: string[];
	sourceSceneVersionId?: string;
}

export interface RelationAttitudeEdge {
	id: string;
	sourceId: string;
	targetId: string;
	dimension: string;
	intensity?: number;
	validFrom: number;
	validTo?: number;
	sourceSceneVersionId?: string;
}

/** 核心 relationship_query 投影（桌面端消费形状）。 */
export interface RelationGraph {
	continuityId: string;
	storyOrder: number;
	knowledgeMode: "author" | "pov";
	viewerCharacterId?: string;
	nodes: RelationNode[];
	objectiveEdges: RelationObjectiveEdge[];
	attitudeEdges: RelationAttitudeEdge[];
	objectiveHistory: RelationObjectiveEdge[];
	attitudeHistory: RelationAttitudeEdge[];
	storyRange: { min: number; max: number };
	textFallback: string;
}

// --- 共享谓词（图/列表同源） ---

export function activeAt(
	edge: { validFrom: number; validTo?: number },
	storyOrder: number,
): boolean {
	return (
		edge.validFrom <= storyOrder &&
		(edge.validTo === undefined || edge.validTo > storyOrder)
	);
}

export function visibleObjective(
	graph: RelationGraph,
	storyOrder: number,
	typeFilter: ReadonlySet<string>,
): RelationObjectiveEdge[] {
	// 切全史而非查询时活跃集：查询章与浏览章解耦（切章不重查），历史切片在客户端完成。
	return graph.objectiveHistory.filter(
		(edge) =>
			activeAt(edge, storyOrder) && typeFilter.has(edge.relationshipType),
	);
}

export function visibleAttitudes(
	graph: RelationGraph,
	storyOrder: number,
): RelationAttitudeEdge[] {
	return graph.attitudeHistory.filter((edge) => activeAt(edge, storyOrder));
}

/** 类型筛选池：按全历史计数（含未生效/已结束），chip 上显示真实条数。 */
export function objectiveTypePool(
	graph: RelationGraph,
): Array<{ type: string; count: number }> {
	const counts = new Map<string, number>();
	for (const edge of graph.objectiveHistory) {
		counts.set(
			edge.relationshipType,
			(counts.get(edge.relationshipType) ?? 0) + 1,
		);
	}
	return [...counts.entries()]
		.map(([type, count]) => ({ type, count }))
		.sort((a, b) => a.type.localeCompare(b.type));
}

// --- 变化事件（时间轴事件标记与下拉的数据源） ---

export interface RelationChangeEvent {
	storyOrder: number;
	/** 人话说明行，如「林舟 → 苏晚 开始 盟友」。 */
	additions: string[];
	endings: string[];
}

export function changeEvents(graph: RelationGraph): RelationChangeEvent[] {
	const labelOf = (id: string) =>
		graph.nodes.find((node) => node.id === id)?.label ?? id;
	// 事件说明面向作者：类型/维度走术语字典，不露原始码。
	const typeLabel = (type: string) => relationshipTypeLabel(type);
	const dimensionLabel = (dimension: string) =>
		attitudeDimensionLabel(dimension);
	const byOrder = new Map<number, RelationChangeEvent>();
	const touch = (storyOrder: number) => {
		let event = byOrder.get(storyOrder);
		if (!event) {
			event = { storyOrder, additions: [], endings: [] };
			byOrder.set(storyOrder, event);
		}
		return event;
	};
	const describe = (
		edge: { sourceId: string; targetId: string },
		what: string,
	) => `${labelOf(edge.sourceId)} → ${labelOf(edge.targetId)} ${what}`;
	for (const edge of graph.objectiveHistory) {
		touch(edge.validFrom).additions.push(
			describe(edge, `开始 ${typeLabel(edge.relationshipType)}`),
		);
		if (edge.validTo !== undefined) {
			touch(edge.validTo).endings.push(
				describe(edge, `结束 ${typeLabel(edge.relationshipType)}`),
			);
		}
	}
	for (const edge of graph.attitudeHistory) {
		touch(edge.validFrom).additions.push(
			describe(edge, `开始流露 ${dimensionLabel(edge.dimension)}`),
		);
		if (edge.validTo !== undefined) {
			touch(edge.validTo).endings.push(
				describe(edge, `不再 ${dimensionLabel(edge.dimension)}`),
			);
		}
	}
	return [...byOrder.values()].sort((a, b) => a.storyOrder - b.storyOrder);
}

// --- 选中态（图/列/详情三处同步） ---

export type RelationSelection =
	| { kind: "node"; id: string }
	| { kind: "edge"; id: string }
	| { kind: "att"; id: string }
	| { kind: "pair"; id: string };

// --- 焦点放射布局（WF5-12 裁决 C 的原型算法移植，纯函数） ---

export interface Pos {
	x: number;
	y: number;
}

export const GRAPH_VIEW = { width: 760, height: 560 };
export const GRAPH_CENTER = {
	x: GRAPH_VIEW.width / 2,
	y: GRAPH_VIEW.height / 2,
};
/** 纵向压缩：保证外环节点不溢出画布（原型踩坑：缺兜底环会掉出画布）。 */
const Y_COMPRESS = 0.72;
const MULTIFOCUS_RING_RADIUS = 64;
const MULTIFOCUS_RING_GAP = 18;

/** 自动焦点：度数最高者优先人物；平局取人物，再按 id 稳定序。 */
export function autoCenterId(
	nodes: RelationNode[],
	objective: Array<{ sourceId: string; targetId: string }>,
	attitudes: Array<{ sourceId: string; targetId: string }>,
): string {
	const degree = new Map<string, number>();
	const characters = new Set(
		nodes.filter((node) => node.type === "character").map((node) => node.id),
	);
	const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
	for (const edge of objective) {
		bump(edge.sourceId);
		bump(edge.targetId);
	}
	for (const edge of attitudes) {
		bump(edge.sourceId);
		bump(edge.targetId);
	}
	return (
		[...degree.entries()]
			.sort(
				([idA, countA], [idB, countB]) =>
					countB - countA ||
					(characters.has(idB) ? 1 : 0) - (characters.has(idA) ? 1 : 0) ||
					idA.localeCompare(idB),
			)
			.map(([id]) => id)[0] ?? ""
	);
}

/**
 * 焦点集放射布局：单一焦点居中；多焦点中心小环并列；
 * 一度/二度/其余三层环自焦点全集 BFS 展开，二环起按已放置邻居锚点角排序。
 * 「其余进外环」兜底必须存在——三度以外节点也要落在画布内。
 */
export function radialLayout(
	nodes: RelationNode[],
	objective: Array<{ sourceId: string; targetId: string }>,
	attitudes: Array<{ sourceId: string; targetId: string }>,
	centers: string[],
	manual: Readonly<Record<string, Pos>> = {},
): { positions: Record<string, Pos>; centers: Set<string> } {
	const adjacency = new Map<string, Set<string>>();
	const addEdge = (a: string, b: string) => {
		if (a === b) return;
		if (!adjacency.has(a)) adjacency.set(a, new Set());
		if (!adjacency.has(b)) adjacency.set(b, new Set());
		adjacency.get(a)?.add(b);
		adjacency.get(b)?.add(a);
	};
	for (const edge of objective) addEdge(edge.sourceId, edge.targetId);
	for (const edge of attitudes) addEdge(edge.sourceId, edge.targetId);

	const cx = GRAPH_CENTER.x;
	const cy = GRAPH_CENTER.y;
	const positions: Record<string, Pos> = {};
	const validCenters = centers.filter((id) =>
		nodes.some((node) => node.id === id),
	);
	if (validCenters.length === 1) {
		positions[validCenters[0]] = { x: cx, y: cy };
	} else {
		validCenters.forEach((id, index) => {
			const angle = -Math.PI / 2 + (index * 2 * Math.PI) / validCenters.length;
			positions[id] = {
				x: cx + Math.cos(angle) * MULTIFOCUS_RING_RADIUS,
				y: cy + Math.sin(angle) * MULTIFOCUS_RING_RADIUS * Y_COMPRESS * 1.6,
			};
		});
	}

	const all = nodes.map((node) => node.id).filter((id) => !positions[id]);
	const neighborsOf = (id: string) => adjacency.get(id) ?? new Set<string>();
	const ring1 = all.filter((id) =>
		[...neighborsOf(id)].some((mate) => positions[mate]),
	);
	const rings: string[][] = [ring1];
	const placed = new Set([...validCenters, ...ring1]);
	const frontier = all.filter(
		(id) =>
			!placed.has(id) && [...neighborsOf(id)].some((mate) => placed.has(mate)),
	);
	rings.push(frontier);
	frontier.forEach((id) => placed.add(id));
	// 外环兜底：与焦点集不连通的节点也要有位置。
	rings.push(all.filter((id) => !placed.has(id)));

	const base = Math.min(172, 96 + ring1.length * 8);
	const radii = [0, base, base + 92, Math.min(base + 168, 348)];
	const angleOf = (id: string) => {
		const pos = positions[id];
		return Math.atan2((pos.y - cy) / Y_COMPRESS, pos.x - cx);
	};
	rings.forEach((ring, ringIndex) => {
		if (ring.length === 0) return;
		const radius =
			radii[ringIndex + 1] +
			(validCenters.length > 1 && ringIndex === 0 ? MULTIFOCUS_RING_GAP : 0);
		const ordered = ring
			.map((id) => {
				let sum = 0;
				let count = 0;
				for (const mate of neighborsOf(id)) {
					if (placed.has(mate) && mate !== id && positions[mate]) {
						sum += angleOf(mate);
						count += 1;
					}
				}
				return { id, angle: count > 0 ? sum / count : 0 };
			})
			.sort((a, b) => a.angle - b.angle);
		ordered.forEach((item, index) => {
			const angle =
				-Math.PI / 2 + ((index + 0.5) * 2 * Math.PI) / ordered.length;
			positions[item.id] = {
				x: cx + Math.cos(angle) * radius,
				y: cy + Math.sin(angle) * radius * Y_COMPRESS,
			};
		});
	});

	// 作者手动拖拽位置覆盖算法位（已在界内的才采纳）。
	for (const [id, pos] of Object.entries(manual)) {
		if (positions[id]) positions[id] = pos;
	}
	return { positions, centers: new Set(validCenters) };
}

// --- 态度弧偏移（同向多条依次外扩；双向分居法线两侧） ---

export interface AttitudeArc {
	offset: number;
	index: number;
	side: 1 | -1;
}

export function pairKey(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function attitudeOffsets(
	attitudes: Array<{ id: string; sourceId: string; targetId: string }>,
): Record<string, AttitudeArc> {
	const map: Record<
		string,
		{ pos: number; neg: number } & Record<string, AttitudeArc>
	> = {};
	for (const attitude of attitudes) {
		const key = pairKey(attitude.sourceId, attitude.targetId);
		const side: 1 | -1 = attitude.sourceId < attitude.targetId ? 1 : -1;
		const record =
			map[key] ?? (map[key] = { pos: 0, neg: 0 } as (typeof map)[string]);
		const index = side > 0 ? record.pos++ : record.neg++;
		map[key][attitude.id] = {
			offset: side * (34 + index * 24),
			index,
			side,
		};
	}
	const result: Record<string, AttitudeArc> = {};
	for (const record of Object.values(map)) {
		for (const [id, arc] of Object.entries(record)) {
			if (id === "pos" || id === "neg") continue;
			result[id] = arc as AttitudeArc;
		}
	}
	return result;
}

/** 同对态度徽章计数：pairKey → 态度条数（图上只留计数，明细在列表子行）。 */
export function attitudeBadgeCounts(
	attitudes: Array<{ sourceId: string; targetId: string }>,
): Map<string, { sourceId: string; targetId: string; count: number }> {
	const counts = new Map<
		string,
		{ sourceId: string; targetId: string; count: number }
	>();
	for (const attitude of attitudes) {
		const key = pairKey(attitude.sourceId, attitude.targetId);
		const entry = counts.get(key);
		if (entry) entry.count += 1;
		else
			counts.set(key, {
				sourceId: attitude.sourceId,
				targetId: attitude.targetId,
				count: 1,
			});
	}
	return counts;
}

// --- 故事时间范围（客户端统一口径：当前章 ∪ 全史边界） ---

/**
 * 故事时间范围：核心投影的 storyRange 以查询时章号参与计算，切章会漂移；
 * 这里以「当前章 ∪ 全史有效期边界」在客户端定出稳定范围，时间轴带据此渲染。
 */
export function storyRangeOf(graph: RelationGraph): {
	min: number;
	max: number;
} {
	const points = [graph.storyOrder];
	for (const edge of graph.objectiveHistory) {
		points.push(edge.validFrom);
		if (edge.validTo !== undefined) points.push(edge.validTo);
	}
	for (const edge of graph.attitudeHistory) {
		points.push(edge.validFrom);
		if (edge.validTo !== undefined) points.push(edge.validTo);
	}
	return { min: Math.min(...points), max: Math.max(...points) };
}

export function clampStoryOrder(
	storyOrder: number,
	range: { min: number; max: number },
): number {
	return Math.min(range.max, Math.max(range.min, storyOrder));
}

// --- 有效期与历史 ---

export function validityLabel(edge: {
	validFrom: number;
	validTo?: number;
}): string {
	return edge.validTo !== undefined
		? `第 ${edge.validFrom} 章至第 ${edge.validTo} 章`
		: `第 ${edge.validFrom} 章起，尚未结束`;
}

export interface RelationHistorySpan {
	validFrom: number;
	validTo?: number;
	isCurrent: boolean;
}

/** 同一关系的历次有效期（同对同类型/同维度），按开始时间排序。 */
export function sameSpanHistory(
	history: Array<{
		sourceId: string;
		targetId: string;
		relationshipType?: string;
		dimension?: string;
		validFrom: number;
		validTo?: number;
	}>,
	current: {
		id: string;
		sourceId: string;
		targetId: string;
		relationshipType?: string;
		dimension?: string;
		validFrom: number;
		validTo?: number;
	},
): RelationHistorySpan[] {
	const sameId = (row: (typeof history)[number]) =>
		row.sourceId === current.sourceId &&
		row.targetId === current.targetId &&
		(current.relationshipType !== undefined
			? row.relationshipType === current.relationshipType
			: row.dimension === current.dimension);
	return history
		.filter(sameId)
		.map((row) => ({
			validFrom: row.validFrom,
			...(row.validTo === undefined ? {} : { validTo: row.validTo }),
			isCurrent:
				row.validFrom === current.validFrom && row.validTo === current.validTo,
		}))
		.sort((a, b) => a.validFrom - b.validFrom);
}

// --- 本地偏好（布局/筛选不是故事事实，不写 SQLite，只进 localStorage） ---

export interface RelationsViewPrefs {
	storyOrder: number;
	knowledgeMode: "author" | "pov";
	viewerCharacterId: string | null;
	/** 被排除的关系类型（未勾选的筛选 chip）；空数组＝全部可见。 */
	typeFilter: string[];
	focus: string;
}

const VIEW_KEY_PREFIX = "nw-relations-view:";
const POSITIONS_KEY_PREFIX = "nw-relations-positions:";

export function loadRelationsPrefs(cwd: string): Partial<RelationsViewPrefs> {
	try {
		const raw = localStorage.getItem(VIEW_KEY_PREFIX + cwd);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		const prefs = parsed as Record<string, unknown>;
		return {
			...(typeof prefs.storyOrder === "number" &&
			Number.isFinite(prefs.storyOrder)
				? { storyOrder: prefs.storyOrder }
				: {}),
			...(prefs.knowledgeMode === "author" || prefs.knowledgeMode === "pov"
				? { knowledgeMode: prefs.knowledgeMode }
				: {}),
			...(typeof prefs.viewerCharacterId === "string"
				? { viewerCharacterId: prefs.viewerCharacterId }
				: {}),
			...(Array.isArray(prefs.typeFilter)
				? {
						typeFilter: prefs.typeFilter.filter(
							(item): item is string => typeof item === "string",
						),
					}
				: {}),
			...(typeof prefs.focus === "string" ? { focus: prefs.focus } : {}),
		};
	} catch {
		return {};
	}
}

export function saveRelationsPrefs(
	cwd: string,
	prefs: RelationsViewPrefs,
): void {
	try {
		localStorage.setItem(VIEW_KEY_PREFIX + cwd, JSON.stringify(prefs));
	} catch {
		/* 隐私模式等场景降级为会话内生效 */
	}
}

export function loadManualPositions(cwd: string): Record<string, Pos> {
	try {
		const raw = localStorage.getItem(POSITIONS_KEY_PREFIX + cwd);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		const positions: Record<string, Pos> = {};
		for (const [id, value] of Object.entries(
			parsed as Record<string, unknown>,
		)) {
			if (
				typeof value === "object" &&
				value !== null &&
				typeof (value as Pos).x === "number" &&
				typeof (value as Pos).y === "number"
			) {
				positions[id] = value as Pos;
			}
		}
		return positions;
	} catch {
		return {};
	}
}

export function saveManualPositions(
	cwd: string,
	positions: Record<string, Pos>,
): void {
	try {
		localStorage.setItem(POSITIONS_KEY_PREFIX + cwd, JSON.stringify(positions));
	} catch {
		/* 会话内生效 */
	}
}

/** 拖拽边界钳制（节点半径 + 标签余量）。 */
export function clampPosition(pos: Pos): Pos {
	return {
		x: Math.min(GRAPH_VIEW.width - 30, Math.max(30, pos.x)),
		y: Math.min(GRAPH_VIEW.height - 20, Math.max(24, pos.y)),
	};
}
