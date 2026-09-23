import { queryProject } from "../../shared/api/rpc";
import { loadResumeSceneId } from "../../features/writing/draft-store";
import type { RouteKey } from "../../shared/workspace/routes";

/**
 * 续写目标（WF5-05）：启动页与写作入口对「接下来写什么」的确定性回答。
 * 世界事实来自 get_resume_target 投影（SQLite 唯一事实源）；上次编辑
 * 位置是本地 UI 偏好（draftStore），只叠加在投影之上，不入小说事实。
 *
 * 确定性选择序（逐级兜底，任何项目都有结果）：
 * 1. 本地上次编辑场景仍在正典 → 继续写作（验收 1）；
 * 2. 有章节计划且存在未写成场景 → 开始写作该场景（验收 3）；
 * 3. 有正典内容 → 从故事前沿（最大 storyOrder）继续（验收 5 兜底）；
 * 4. 有总纲零章 → 去规划章节，不落空编辑器（验收 2）；
 * 5. 完全空项目 → 规划起点并解释第一步（验收 4）。
 */

export interface ResumeProjection {
	scenes: Array<{
		sceneId: string;
		title: string;
		storyOrder: number;
		continuityId: string;
		proseChars: number;
	}>;
	scenePlans: Array<{
		planId: string;
		title: string;
		storyOrder: number;
		continuityId: string;
	}>;
	chapterPlanCount: number;
	outlineCount: number;
	latestConfirmedAt: string | null;
}

export type ResumeTargetKind =
	| "resume-edit"
	| "start-writing"
	| "plan-chapters"
	| "project-start";

export interface ResumeTarget {
	kind: ResumeTargetKind;
	/** 打开项目后的落点路由。 */
	route: RouteKey;
	/** 继续写作时选中的正典场景 id。 */
	sceneId: string | null;
	/** 目标场景名（正典场景或场景计划），用于作者语言文案。 */
	sceneTitle: string | null;
	/** 项目卡主操作文案。 */
	actionLabel: string;
	/** 项目卡次行解释；仅无正典目标时提供（如空项目第一步）。 */
	cardNote: string | null;
}

function continueEditing(scene: {
	sceneId: string;
	title: string;
}): ResumeTarget {
	return {
		kind: "resume-edit",
		route: "writing",
		sceneId: scene.sceneId,
		sceneTitle: scene.title,
		actionLabel: `继续写作：${scene.title}`,
		cardNote: null,
	};
}

export function resolveResumeTarget(
	projection: ResumeProjection,
	lastSceneId: string | null,
): ResumeTarget {
	const scenes = projection.scenes;
	const remembered = lastSceneId
		? scenes.find((scene) => scene.sceneId === lastSceneId)
		: undefined;
	if (remembered) return continueEditing(remembered);

	if (projection.chapterPlanCount > 0) {
		// 场景候选不引用计划 id，已写成与否由 continuityId+storyOrder 自然键对照。
		const written = new Set(
			scenes.map((scene) => `${scene.continuityId}::${scene.storyOrder}`),
		);
		const next = projection.scenePlans.find(
			(plan) => !written.has(`${plan.continuityId}::${plan.storyOrder}`),
		);
		if (next) {
			return {
				kind: "start-writing",
				route: "writing",
				sceneId: null,
				sceneTitle: next.title,
				actionLabel: `开始写作：${next.title}`,
				cardNote: null,
			};
		}
	}

	const frontier = scenes.length > 0 ? scenes[scenes.length - 1] : undefined;
	if (frontier) return continueEditing(frontier);

	if (projection.outlineCount > 0) {
		return {
			kind: "plan-chapters",
			route: "planning/outline",
			sceneId: null,
			sceneTitle: null,
			actionLabel: "根据总纲规划章节",
			cardNote: null,
		};
	}

	return {
		kind: "project-start",
		route: "planning/outline",
		sceneId: null,
		sceneTitle: null,
		actionLabel: "从总纲开始规划",
		cardNote: "从规划起步：先立总纲，再分幕排章节。",
	};
}

/** 组合投影与本地偏好，得到这本书的续写目标；失败由调用方按不可达处理。 */
export async function fetchResumeTarget(cwd: string): Promise<ResumeTarget> {
	const projection = await queryProject<ResumeProjection>(
		cwd,
		"get_resume_target",
		{},
	);
	return resolveResumeTarget(projection, loadResumeSceneId(cwd));
}
