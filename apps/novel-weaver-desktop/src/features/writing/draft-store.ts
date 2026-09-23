/**
 * 草稿本地持久化（WF2-12）：应用层按 项目目录+场景 键存手编草稿。
 * 草稿不是正典事实，不走提案关口；崩溃/误关后可无损找回。
 */

const KEY_PREFIX = "nw-draft";

export interface PersistedDraft {
	text: string;
	title: string;
	sourceVersionId: string;
	savedAt: number;
}

function key(cwd: string, sceneId: string): string {
	return `${KEY_PREFIX}:${cwd}:${sceneId}`;
}

export function loadDraft(cwd: string, sceneId: string): PersistedDraft | null {
	try {
		const raw = localStorage.getItem(key(cwd, sceneId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as PersistedDraft;
		if (
			typeof parsed.text === "string" &&
			typeof parsed.savedAt === "number" &&
			parsed.sourceVersionId
		)
			return parsed;
	} catch {
		/* 损坏即视为无草稿 */
	}
	return null;
}

export function saveDraft(
	cwd: string,
	sceneId: string,
	draft: Omit<PersistedDraft, "savedAt">,
): boolean {
	try {
		localStorage.setItem(
			key(cwd, sceneId),
			JSON.stringify({ ...draft, savedAt: Date.now() }),
		);
		return true;
	} catch {
		return false;
	}
}

export function clearDraft(cwd: string, sceneId: string): void {
	try {
		localStorage.removeItem(key(cwd, sceneId));
	} catch {
		/* 无害 */
	}
}

const LAST_SCENE_PREFIX = "nw-last-scene";

/**
 * 最近选中场景（WF5-04）：会话级本地 UI 偏好，只进 sessionStorage，
 * 不是小说事实；WF5-05 起以 localStorage 持久副本兜底跨会话续写，
 * 读时「会话优先、持久兜底」，写时双写。
 */
export function loadLastSceneId(cwd: string): string | null {
	try {
		return (
			sessionStorage.getItem(`${LAST_SCENE_PREFIX}:${cwd}`) ??
			loadResumeSceneId(cwd)
		);
	} catch {
		return loadResumeSceneId(cwd);
	}
}

export function saveLastSceneId(cwd: string, sceneId: string | null): void {
	try {
		if (sceneId) {
			sessionStorage.setItem(`${LAST_SCENE_PREFIX}:${cwd}`, sceneId);
			saveResumeSceneId(cwd, sceneId);
		}
	} catch {
		/* 隐私模式等场景降级为无记忆 */
	}
}

const RESUME_SCENE_PREFIX = "nw-resume-scene";
const RESUME_SCROLL_PREFIX = "nw-resume-scroll";

/**
 * 跨会话续写记忆（WF5-05）：localStorage 持久，仅本地 UI 偏好，非小说事实。
 * 书架打开带场景目标的书时也会写入，编辑器据此恢复选中场景。
 */
export function loadResumeSceneId(cwd: string): string | null {
	try {
		return localStorage.getItem(`${RESUME_SCENE_PREFIX}:${cwd}`);
	} catch {
		return null;
	}
}

export function saveResumeSceneId(cwd: string, sceneId: string): void {
	try {
		localStorage.setItem(`${RESUME_SCENE_PREFIX}:${cwd}`, sceneId);
	} catch {
		/* 存不了就只保留会话级记忆 */
	}
}

/** 写作区跨会话滚动记忆（WF5-05 验收 1）：按项目隔离，随滚动防抖写入。 */
export function loadResumeScroll(cwd: string): number | null {
	try {
		const raw = localStorage.getItem(`${RESUME_SCROLL_PREFIX}:${cwd}`);
		const top = raw === null ? Number.NaN : Number(raw);
		return Number.isFinite(top) ? top : null;
	} catch {
		return null;
	}
}

export function saveResumeScroll(cwd: string, top: number): void {
	try {
		localStorage.setItem(
			`${RESUME_SCROLL_PREFIX}:${cwd}`,
			String(Math.round(top)),
		);
	} catch {
		/* 无害 */
	}
}
