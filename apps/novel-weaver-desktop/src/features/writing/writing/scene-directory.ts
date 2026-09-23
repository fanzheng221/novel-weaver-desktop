import type { ChapterIndexEntry } from "../assistant/assistant-context";

/**
 * 写作台场景目录（WF5-06）：把规划工件（卷/章/场景计划）与正典场景
 * 合并成左栏「卷 → 章 → 场景」投影。纯函数、无 RPC 依赖，便于 fixture
 * 与单测锁定合并规则：
 * - 正典场景与场景计划按 (continuityId, storyOrder) 自然键对照——已写成的
 *   计划不再单独成行，其目的（purpose）附着在正典行上；
 * - 章节计划的 sceneIds 兼容场景计划 id 与正典场景 id 两种引用；
 * - 卷计划的 chapterIds 兼容章节计划 id；
 * - 没有卷/章挂靠的场景归入「未分章」组；零章节时该组即全部场景。
 */

export interface RailScene {
	/** 选中键：`canonical:<sceneId>` 或 `plan:<planId>`。 */
	key: string;
	kind: "canonical" | "planned";
	sceneId: string | null;
	planId: string | null;
	title: string;
	storyOrder: number;
	/** 正典字数（markdown 字符数）；未写成为 null。 */
	proseChars: number | null;
	/** 存在与正典基线一致的本地草稿（待提交）。 */
	hasFreshDraft: boolean;
	/** 已写成行携带来源计划的目的；纯计划行为计划目的。 */
	planPurpose: string | null;
}

export interface RailChapter {
	id: string | null;
	label: string;
	purpose: string | null;
	targetWords: number | null;
	scenes: RailScene[];
}

export interface RailVolume {
	id: string;
	label: string;
	goal: string | null;
	chapters: RailChapter[];
}

export interface SceneDirectory {
	volumes: RailVolume[];
	/** 不挂在任何卷下的章节计划。 */
	freeChapters: RailChapter[];
	/** 未分章组（零章节项目里承载全部场景）。 */
	loose: RailChapter | null;
	allScenes: RailScene[];
}

export interface DirectoryPlanningNode {
	id: string;
	kind: string;
	title: string;
	content: Record<string, unknown>;
}

export interface DirectorySceneFact {
	sceneId: string;
	title: string;
	storyOrder: number;
	continuityId: string;
	versionId?: string;
	proseChars: number;
}

export interface DirectoryScenePlanFact {
	planId: string;
	title: string;
	storyOrder: number;
	continuityId: string;
	purpose?: string | null;
}

export interface DirectoryDraftFact {
	sceneId: string;
	sourceVersionId: string;
}

const naturalKey = (continuityId: string, storyOrder: number): string =>
	`${continuityId}::${storyOrder}`;

function sceneOfPlan(plan: DirectoryScenePlanFact): RailScene {
	return {
		key: `plan:${plan.planId}`,
		kind: "planned",
		sceneId: null,
		planId: plan.planId,
		title: plan.title,
		storyOrder: plan.storyOrder,
		proseChars: null,
		hasFreshDraft: false,
		planPurpose: plan.purpose ?? null,
	};
}

export function buildSceneDirectory(
	planningNodes: DirectoryPlanningNode[],
	scenes: DirectorySceneFact[],
	scenePlans: DirectoryScenePlanFact[],
	drafts: DirectoryDraftFact[],
): SceneDirectory {
	const volumes = planningNodes.filter((node) => node.kind === "volume_plan");
	const chapters = planningNodes.filter((node) => node.kind === "chapter_plan");
	const draftVersionIds = new Map(
		drafts.map((draft) => [draft.sceneId, draft.sourceVersionId]),
	);

	// 合并正典场景与场景计划：正典行吸收同自然键计划的目的。
	const planByNaturalKey = new Map(
		scenePlans.map((plan) => [
			naturalKey(plan.continuityId, plan.storyOrder),
			plan,
		]),
	);
	const consumedPlanIds = new Set<string>();
	const merged = new Map<string, RailScene>();
	for (const scene of scenes) {
		const plan = planByNaturalKey.get(
			naturalKey(scene.continuityId, scene.storyOrder),
		);
		if (plan) consumedPlanIds.add(plan.planId);
		merged.set(scene.sceneId, {
			key: `canonical:${scene.sceneId}`,
			kind: "canonical",
			sceneId: scene.sceneId,
			planId: plan?.planId ?? null,
			title: scene.title,
			storyOrder: scene.storyOrder,
			proseChars: scene.proseChars,
			hasFreshDraft:
				scene.versionId !== undefined &&
				draftVersionIds.get(scene.sceneId) === scene.versionId,
			planPurpose: plan?.purpose ?? null,
		});
	}
	const plannedRows = scenePlans
		.filter((plan) => !consumedPlanIds.has(plan.planId))
		.map(sceneOfPlan);
	const allScenes = [...merged.values(), ...plannedRows].sort(
		(a, b) => a.storyOrder - b.storyOrder || a.key.localeCompare(b.key),
	);
	const sceneByKey = new Map(allScenes.map((scene) => [scene.key, scene]));

	// 章节分组：sceneIds 兼容计划 id 与正典场景 id（按 key 兜底转换）。
	// 已写成的计划被正典行吸收（key 换成 canonical:*），故再按 planId 反查一次。
	const canonicalKeyByPlanId = new Map<string, string>();
	for (const scene of merged.values()) {
		if (scene.planId) canonicalKeyByPlanId.set(scene.planId, scene.key);
	}
	const keyForRef = (ref: string): string | null => {
		if (sceneByKey.has(`plan:${ref}`)) return `plan:${ref}`;
		if (sceneByKey.has(`canonical:${ref}`)) return `canonical:${ref}`;
		return canonicalKeyByPlanId.get(ref) ?? null;
	};
	const assigned = new Set<string>();
	const chapterOf = chapters.map((chapter) => {
		const refs = Array.isArray(chapter.content.sceneIds)
			? chapter.content.sceneIds.map(String)
			: [];
		const owned = refs
			.map(keyForRef)
			.filter((key): key is string => key !== null)
			.map((key) => sceneByKey.get(key))
			.filter((scene): scene is RailScene => scene !== undefined);
		for (const scene of owned) assigned.add(scene.key);
		return {
			chapter,
			group: {
				id: chapter.id,
				label: chapter.title,
				purpose:
					typeof chapter.content.purpose === "string"
						? chapter.content.purpose
						: null,
				targetWords:
					typeof chapter.content.targetWords === "number"
						? chapter.content.targetWords
						: null,
				scenes: owned,
			} satisfies RailChapter,
		};
	});
	const chapterById = new Map(
		chapterOf.map((entry) => [entry.chapter.id, entry.group]),
	);

	// 卷分组：chapterIds 兼容章节计划 id。
	const consumedChapters = new Set<string>();
	const volumeGroups = volumes.map((volume) => {
		const refs = Array.isArray(volume.content.chapterIds)
			? volume.content.chapterIds.map(String)
			: [];
		const ownedChapters = refs
			.map((ref) => chapterById.get(ref))
			.filter((group) => group !== undefined);
		for (const group of ownedChapters) consumedChapters.add(group.id ?? "");
		return {
			id: volume.id,
			label: volume.title,
			goal:
				typeof volume.content.goal === "string" ? volume.content.goal : null,
			chapters: ownedChapters,
		} satisfies RailVolume;
	});

	const freeChapters = chapterOf
		.filter((entry) => !consumedChapters.has(entry.chapter.id))
		.map((entry) => entry.group);
	const looseScenes = allScenes.filter((scene) => !assigned.has(scene.key));
	const loose: RailChapter | null =
		looseScenes.length > 0
			? {
					id: null,
					label: chapters.length > 0 ? "未分章" : "场景",
					purpose: null,
					targetWords: null,
					scenes: looseScenes,
				}
			: null;

	return { volumes: volumeGroups, freeChapters, loose, allScenes };
}

/** 生成设置「生成本章」循环所需的章节目录（WF2-11 兼容形状）。 */
export function chapterIndexEntries(
	directory: SceneDirectory,
): ChapterIndexEntry[] {
	const chapters = [
		...directory.volumes.flatMap((volume) => volume.chapters),
		...directory.freeChapters,
		...(directory.loose ? [directory.loose] : []),
	].filter((chapter) => chapter.id !== null);
	return chapters.map((chapter) => ({
		id: chapter.id ?? "",
		label: chapter.label,
		scenes: chapter.scenes
			.filter((scene) => scene.kind === "canonical")
			.map((scene) => ({
				sceneId: scene.sceneId ?? "",
				title: scene.title,
				storyOrder: scene.storyOrder,
			})),
	}));
}

/** 选中键所属的章（含未分章）与卷，供任务头与简报定位归属。 */
export function locateSelection(
	directory: SceneDirectory,
	selectedKey: string | null,
): {
	scene: RailScene;
	chapter: RailChapter | null;
	volume: RailVolume | null;
} | null {
	if (!selectedKey) return null;
	const scene = directory.allScenes.find((entry) => entry.key === selectedKey);
	if (!scene) return null;
	const inChapter = (chapter: RailChapter): boolean =>
		chapter.scenes.some((entry) => entry.key === selectedKey);
	for (const volume of directory.volumes) {
		const chapter = volume.chapters.find(inChapter);
		if (chapter) return { scene, chapter, volume };
	}
	const freeChapter = directory.freeChapters.find(inChapter);
	if (freeChapter) return { scene, chapter: freeChapter, volume: null };
	if (directory.loose && inChapter(directory.loose))
		return { scene, chapter: directory.loose, volume: null };
	return { scene, chapter: null, volume: null };
}
