import {
	Globe2,
	ListTree,
	type LucideIcon,
	PenLine,
	Scale,
	Upload,
} from "lucide-react";

/**
 * 五作者工作区路由 schema（WF5-04）：写作 / 规划 / 世界 / 审校 / 发布。
 * hash 仍是路由源（既有 e2e 与 EmptyState 深链依赖）；旧一级路由经别名表
 * 映射进新工作区/子区，永不落空页。子区选择与滚动位置是本地 UI 偏好，
 * 只进 sessionStorage，不写小说事实。
 */

export type AreaKey = "writing" | "planning" | "world" | "review" | "publish";

export interface SubAreaDef {
	key: string;
	label: string;
	/**
	 * 兼容路由（WF5-11）：不出现在子区条与命令面板，但保持路由合法，
	 * 让 WF5-03 时代的旧深链不落空页。作者入口一律走可见子区。
	 */
	hidden?: boolean;
}

export interface AreaDef {
	key: AreaKey;
	label: string;
	icon: LucideIcon;
	subAreas: SubAreaDef[];
	/** 无子区时为 null。 */
	defaultSub: string | null;
}

export const AREAS: AreaDef[] = [
	{
		key: "writing",
		label: "写作",
		icon: PenLine,
		subAreas: [],
		defaultSub: null,
	},
	{
		key: "planning",
		label: "规划",
		icon: ListTree,
		defaultSub: "outline",
		subAreas: [
			{ key: "outline", label: "章节大纲" },
			{ key: "foreshadow", label: "伏笔追踪" },
			{ key: "timeline", label: "时间线" },
			{ key: "pacing", label: "节奏范本" },
			// WF6-05 喂书分析控制台：紧邻风格特征（WF6-10 裁决落点）。
			{ key: "references", label: "风格参考" },
			{ key: "style", label: "风格特征" },
		],
	},
	{
		key: "world",
		label: "世界",
		icon: Globe2,
		defaultSub: "lore",
		// WF5-11：一级子区固定为规则/人物/设定/关系；隐藏路由只承接旧深链。
		subAreas: [
			{ key: "rules", label: "规则" },
			{ key: "characters", label: "人物" },
			{ key: "lore", label: "设定" },
			{ key: "relations", label: "关系" },
			{ key: "relations-timeline", label: "关系时间线", hidden: true },
			{ key: "relations-graph", label: "关系图谱", hidden: true },
		],
	},
	{ key: "review", label: "审校", icon: Scale, subAreas: [], defaultSub: null },
	{
		key: "publish",
		label: "发布",
		icon: Upload,
		defaultSub: "flow",
		// WF5-16：检查/版本/确认/导出合并为一条线性流程；旧子区是隐藏兼容路由。
		subAreas: [
			{ key: "flow", label: "发布流程" },
			{ key: "board", label: "更新追踪" },
			{ key: "checklist", label: "发布检查", hidden: true },
			{ key: "export", label: "导出", hidden: true },
		],
	},
];

/** 工作区之外的项目级工具路由：从「项目与设置」菜单进入，不占主导航。 */
export const TOOL_KEYS = ["byok", "foundation"] as const;
export type ToolKey = (typeof TOOL_KEYS)[number];

export const TOOL_LABELS: Record<ToolKey, string> = {
	byok: "模型接入 · BYOK（含用量）",
	foundation: "设计基座",
};

/** 全部合法路由键（工作区子区 + 工具）。 */
export type RouteKey = AreaKey | `${AreaKey}/${string}` | ToolKey;

const AREA_BY_KEY = new Map<string, AreaDef>(
	AREAS.map((area) => [area.key, area]),
);
const SUB_BY_AREA = new Map<string, Set<string>>(
	AREAS.map((area) => [area.key, new Set(area.subAreas.map((sub) => sub.key))]),
);
const TOOL_KEY_SET = new Set<string>(TOOL_KEYS);

/** 子区条/命令面板只吃可见子区；隐藏兼容路由不进作者入口。 */
export function visibleSubs(area: AreaDef): SubAreaDef[] {
	return area.subAreas.filter((sub) => !sub.hidden);
}

/**
 * 旧一级 hash → 新路由。别名保持作者既有深链不死（WF5-04 用例 2）；
 * WF5-16 起 `#/publish` 落到线性发布流程（原「发布与导出」的兼容落点）。
 */
const LEGACY_ALIASES: Record<string, RouteKey> = {
	studio: "writing",
	outline: "planning/outline",
	foreshadow: "planning/foreshadow",
	"outline-foreshadow": "planning/foreshadow",
	timeline: "planning/timeline",
	"outline-timeline": "planning/timeline",
	pacing: "planning/pacing",
	lore: "world/lore",
	// WF5-11：人物升为一级子区后，旧「人物关系」深链回归人物本义；
	// 关系列表/图谱经「关系」子区与隐藏兼容路由承接。
	characters: "world/characters",
	graph: "world/relations-graph",
	qc: "review",
	// WF5-16：旧「发布检查/发布与导出」深链并入线性发布流程。
	checklist: "publish/flow",
	publish: "publish/flow",
	board: "publish/board",
};

export function isRouteKey(key: string): key is RouteKey {
	const [head, sub] = key.split("/");
	if (TOOL_KEY_SET.has(key)) return true;
	const area = AREA_BY_KEY.get(head);
	if (!area) return false;
	if (sub === undefined) return area.subAreas.length === 0;
	return SUB_BY_AREA.get(head)?.has(sub) ?? false;
}

/**
 * 深链聚焦参数（WF5-14）：`#/world/characters?focus=CHAR-xxxx`。
 * 聚焦目标是视图内的选中/高亮，不是路由本身——解析路由时剥离查询串，
 * hash 前进/后退因此天然携带「选中项」上下文。
 */
export function stripFocusQuery(raw: string): string {
	const queryAt = raw.indexOf("?");
	return queryAt === -1 ? raw : raw.slice(0, queryAt);
}

export function focusOfHash(hash: string): string | null {
	const queryAt = hash.indexOf("?");
	if (queryAt === -1) return null;
	const params = new URLSearchParams(hash.slice(queryAt + 1));
	return params.get("focus");
}

export function hashForFocus(key: RouteKey, focusId: string): string {
	return `#/${key}?focus=${encodeURIComponent(focusId)}`;
}

function sessionGet(key: string): string | null {
	try {
		return sessionStorage.getItem(key);
	} catch {
		return null;
	}
}

function sessionSet(key: string, value: string): void {
	try {
		sessionStorage.setItem(key, value);
	} catch {
		/* 隐私模式等场景降级为会话内记忆 */
	}
}

function lastSubOf(areaKey: string): string | null {
	const saved = sessionGet(`nw-sub:${areaKey}`);
	const subs = AREA_BY_KEY.get(areaKey)?.subAreas ?? [];
	// 隐藏兼容路由不作为记忆落点：经旧深链到达后，下次点导航回可见子区。
	if (saved && subs.some((sub) => sub.key === saved && !sub.hidden))
		return saved;
	const fallback = subs.find((sub) => !sub.hidden);
	return fallback?.key ?? null;
}

/**
 * 任意 hash → 规范路由键。规则：
 * - 旧一级别名映射进新工作区/子区；
 * - 无子区的工作区 hash（`#/planning`）解析为「上次使用的子区，否则默认子区」；
 * - 未知路由回落写作区（既有语义，永不落空页）。
 */
export function canonicalRouteKey(hash: string): RouteKey {
	const raw = stripFocusQuery(hash.replace(/^#\/?/, ""));
	const aliased = LEGACY_ALIASES[raw];
	if (aliased) return aliased;
	if (TOOL_KEY_SET.has(raw)) return raw as ToolKey;
	const [head, sub] = raw.split("/");
	if (sub === undefined || sub === "") {
		const area = AREA_BY_KEY.get(head);
		if (area) {
			const resolved = lastSubOf(area.key);
			return (resolved ? `${area.key}/${resolved}` : area.key) as RouteKey;
		}
		return "writing";
	}
	if (isRouteKey(raw)) return raw;
	return "writing";
}

export function hashFor(key: RouteKey): string {
	return `#/${key}`;
}

export function areaOf(key: RouteKey): AreaDef | null {
	return AREA_BY_KEY.get(key.split("/")[0]) ?? null;
}

export function subLabelOf(key: RouteKey): string | null {
	const [head, sub] = key.split("/");
	if (!sub) return null;
	return (
		AREA_BY_KEY.get(head)?.subAreas.find((entry) => entry.key === sub)?.label ??
		null
	);
}

export function isToolKey(key: RouteKey): key is ToolKey {
	return TOOL_KEY_SET.has(key);
}

/** 导航点击工作区时写「干净」hash；子区由解析时的记忆决定，切走再回即恢复。 */
export function areaHash(areaKey: AreaKey): string {
	return `#/${areaKey}`;
}

/** 子区激活时记录记忆（跨工作区切换后由 canonicalRouteKey 复原）。 */
export function rememberSub(areaKey: AreaKey, subKey: string): void {
	sessionSet(`nw-sub:${areaKey}`, subKey);
}

/** 主区滚动位置按路由键记忆（会话级）。 */
export function readScroll(key: RouteKey): number {
	const raw = sessionGet(`nw-scroll:${key}`);
	const top = raw === null ? Number.NaN : Number(raw);
	return Number.isFinite(top) ? top : 0;
}

/** 会话级滚动记忆的原始读取：无记录时返回 null，供跨会话兜底判断（WF5-05）。 */
export function peekScroll(key: RouteKey): number | null {
	const raw = sessionGet(`nw-scroll:${key}`);
	if (raw === null) return null;
	const top = Number(raw);
	return Number.isFinite(top) ? top : null;
}

export function writeScroll(key: RouteKey, top: number): void {
	sessionSet(`nw-scroll:${key}`, String(Math.round(top)));
}
