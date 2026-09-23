/**
 * 写作台左栏宽度偏好（WF5-06）：190–360px，上限受视口 38% 约束；
 * 沿用项目本地 UI 偏好约定——localStorage 单键持久化（同右面板宽度），
 * 隐私模式等场景静默降级为默认宽。
 */

export const NAV_WIDTH_MIN = 190;
export const NAV_WIDTH_MAX = 360;
export const NAV_WIDTH_DEFAULT = 232;

const NAV_WIDTH_KEY = "nw-writing-nav-w";

export function navWidthMaxFor(viewportWidth: number): number {
	return Math.round(
		Math.max(NAV_WIDTH_MIN, Math.min(NAV_WIDTH_MAX, viewportWidth * 0.38)),
	);
}

export function clampNavWidth(value: number, viewportWidth: number): number {
	return Math.round(
		Math.min(navWidthMaxFor(viewportWidth), Math.max(NAV_WIDTH_MIN, value)),
	);
}

export function loadNavWidth(viewportWidth: number): number {
	try {
		const raw = localStorage.getItem(NAV_WIDTH_KEY);
		if (raw) {
			const parsed = Number(raw);
			if (Number.isFinite(parsed)) return clampNavWidth(parsed, viewportWidth);
		}
	} catch {
		/* 隐私模式等场景降级为默认宽 */
	}
	return NAV_WIDTH_DEFAULT;
}

export function saveNavWidth(value: number): void {
	try {
		localStorage.setItem(NAV_WIDTH_KEY, String(Math.round(value)));
	} catch {
		/* 宽度仅会话内生效 */
	}
}
