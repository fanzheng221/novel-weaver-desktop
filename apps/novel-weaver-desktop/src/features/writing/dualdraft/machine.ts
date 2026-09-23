import type { DualSegment } from "./segments";

/**
 * 双稿裁决状态机（WF5-09）：只在裁决时存在的临时会话。
 * 三种决策动作的边界在这里锁死——
 *   放弃候选     → discarded，零版本副作用；
 *   作为新草稿   → adopted（mode full），候选全文开手编草稿；
 *   局部采用     → adopted（mode partial），勾选合并稿开手编草稿。
 * adopted → comparing 的「撤销本次采用」保留勾选；基线过期由视图层
 * 禁用勾选与确认（stale 只读投影），不进入 reducer。
 */

export type DualDraftPhase = "comparing" | "adopted" | "discarded";
export type AdoptionMode = "partial" | "full";

export interface DualDraftSource {
	/** 助手候选 id；放弃/转草稿时据此维护候选列表。 */
	candidateId: string;
	candidateTitle: string;
	sceneId: string;
	sceneTitle: string | null;
	storyOrder: number;
	/** 生成时刻左栏来源：正典只读或手编草稿。 */
	baseKind: "canonical" | "draft";
	baseText: string;
	/** 生成时刻的正典版本 id；双稿打开后与当前正典比对得 stale。 */
	baselineVersionId: string | null;
	candidateText: string;
}

export interface DualDraftResult {
	mode: AdoptionMode;
	markdown: string;
	adoptedCount: number;
	draftTitle: string;
}

export interface DualDraftSession {
	source: DualDraftSource;
	segments: DualSegment[];
	checked: ReadonlySet<string>;
	phase: DualDraftPhase;
	result: DualDraftResult | null;
}

export interface DualDraftState {
	session: DualDraftSession | null;
}

export function createInitialDualDraftState(): DualDraftState {
	return { session: null };
}

export type DualDraftAction =
	| { type: "sessionOpened"; source: DualDraftSource; segments: DualSegment[] }
	| { type: "segmentToggled"; segmentId: string; on: boolean }
	| { type: "selectionCleared" }
	| { type: "adoptionConfirmed"; result: DualDraftResult }
	| { type: "adoptionUndone" }
	| { type: "sessionClosed" };

export function dualDraftReducer(
	state: DualDraftState,
	action: DualDraftAction,
): DualDraftState {
	const session = state.session;
	switch (action.type) {
		case "sessionOpened":
			return {
				session: {
					source: action.source,
					segments: action.segments,
					checked: new Set(),
					phase: "comparing",
					result: null,
				},
			};
		case "segmentToggled": {
			if (!session || session.phase !== "comparing") return state;
			const checked = new Set(session.checked);
			if (action.on) checked.add(action.segmentId);
			else checked.delete(action.segmentId);
			return { session: { ...session, checked } };
		}
		case "selectionCleared": {
			if (!session || session.phase !== "comparing") return state;
			return { session: { ...session, checked: new Set() } };
		}
		case "adoptionConfirmed": {
			if (!session || session.phase !== "comparing") return state;
			return {
				session: { ...session, phase: "adopted", result: action.result },
			};
		}
		case "adoptionUndone": {
			if (!session || session.phase !== "adopted") return state;
			return { session: { ...session, phase: "comparing", result: null } };
		}
		case "sessionClosed":
			return { session: null };
	}
}

/** 基线过期判定：双稿打开时的正典版本 ≠ 当前正典版本。 */
export function isStale(
	session: DualDraftSession,
	currentVersionId: string | null,
): boolean {
	const baseline = session.source.baselineVersionId;
	return Boolean(baseline && currentVersionId && baseline !== currentVersionId);
}
