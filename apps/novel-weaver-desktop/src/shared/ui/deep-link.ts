import { focusOfHash, hashForFocus, type RouteKey } from "../workspace/routes";
import { saveLastSceneId } from "../../features/writing/draft-store";

/**
 * 引用边深链（WF5-14）：影响区里的每条边都能回到目标对象所在的视图。
 * 桌面端不引入核心运行时，这里只镜像 RPC 投影里需要的形状（结构兼容）。
 * 待确认工作（scene_candidate / design_change）不提供深链：它们的处理面
 * 是既有的确认流（写作台双稿 / 各区待审列表），边上的原因与位置已说明去向。
 */

export type ImpactSubjectKind =
	| "rule"
	| "entity"
	| "relationship"
	| "scene"
	| "artifact";

export interface ReferenceEdgeShape {
	kind:
		| "rule"
		| "entity"
		| "relationship"
		| "attitude"
		| "knowledge"
		| "scene"
		| "artifact"
		| "scene_candidate"
		| "design_change"
		| "publication";
	id: string;
	title: string;
	reason: string;
	location: string;
	/** entity 边附带的实体类型（character 与其他落点不同）。 */
	sub?: string;
	stale?: "already" | "on_change";
}

/** 边终点在壳路由里的落点；null＝没有可深链的目标视图。 */
export function routeTargetOf(
	edge: Pick<ReferenceEdgeShape, "kind" | "sub">,
): RouteKey | null {
	switch (edge.kind) {
		case "rule":
			return "world/rules";
		case "entity":
			return edge.sub === "character" ? "world/characters" : "world/lore";
		case "relationship":
		case "attitude":
		case "knowledge":
			return "world/relations";
		case "scene":
			return "writing";
		case "artifact":
			return "planning/outline";
		default:
			return null;
	}
}

/**
 * 跳到边终点对象并聚焦它：场景经「最近选中场景」记忆进写作台
 * （既有跨区跳场景语义）；其余路由用 hash 聚焦参数。
 */
export function navigateToImpactTarget(
	cwd: string,
	edge: Pick<ReferenceEdgeShape, "kind" | "id" | "sub">,
): void {
	const route = routeTargetOf(edge);
	if (route === null) return;
	if (route === "writing") {
		saveLastSceneId(cwd, edge.id);
		window.location.hash = "#/writing";
		return;
	}
	window.location.hash = hashForFocus(route, edge.id);
}

/** 当前 hash 里的聚焦目标（视图挂载时读取一次）。 */
export function readFocusTarget(): string | null {
	return focusOfHash(window.location.hash);
}

/**
 * 把当前选中项同步进 hash（不产生历史记录）：前进/后退据此恢复
 * 「原选中项」上下文；同路由回声不触发 hashchange。
 */
export function rememberFocusInHash(route: RouteKey, id: string | null): void {
	const next = id ? hashForFocus(route, id) : `#/${route}`;
	const current = window.location.hash;
	if (current === next) return;
	window.history.replaceState(null, "", next);
}
