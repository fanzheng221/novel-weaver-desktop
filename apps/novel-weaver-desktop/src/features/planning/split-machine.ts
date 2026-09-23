import type { SplitChapterDraft } from "./planning-model";

/**
 * WF5-10 拆章流状态机：editing（作者指令）→ previewing（可改预览）→
 * running（逐章 create+approve）→ succeeded | failed。
 * 失败保留指令与逐项进度；retry 先对账再续跑，adjust 回预览剔除已完成项。
 */

export type SplitPhase =
	| "closed"
	| "editing"
	| "previewing"
	| "running"
	| "succeeded"
	| "failed";

export type SplitItemStatus =
	| "pending"
	| "creating"
	| "approving"
	| "created"
	| "done"
	| "failed";

export interface SplitItemError {
	message: string;
	detail: string;
}

export interface SplitItem {
	draft: SplitChapterDraft;
	status: SplitItemStatus;
	proposalId: string | null;
	revision: number | null;
	artifactId: string | null;
	error: SplitItemError | null;
}

export interface SplitState {
	phase: SplitPhase;
	outlineId: string | null;
	instruction: string;
	items: SplitItem[];
	/** 任一项失败时的人话总结（用例 6：失败保留指令与恢复出路）。 */
	failure: SplitItemError | null;
	firstCreatedArtifactId: string | null;
}

export function createInitialSplitState(): SplitState {
	return {
		phase: "closed",
		outlineId: null,
		instruction: "",
		items: [],
		failure: null,
		firstCreatedArtifactId: null,
	};
}

function toItems(
	drafts: SplitChapterDraft[],
	previous: SplitItem[],
): SplitItem[] {
	return drafts.map((draft) => {
		const prior = previous.find((item) => item.draft.key === draft.key);
		return prior
			? { ...prior, draft }
			: {
					draft,
					status: "pending" as const,
					proposalId: null,
					revision: null,
					artifactId: null,
					error: null,
				};
	});
}

export type SplitAction =
	| { type: "open"; outlineId: string; instruction: string }
	| { type: "instructionChanged"; value: string }
	| { type: "parsed"; items: SplitChapterDraft[] }
	| { type: "backToEdit" }
	| {
			type: "itemChanged";
			key: string;
			patch: Partial<Pick<SplitChapterDraft, "title" | "purpose">>;
	  }
	| { type: "itemRemoved"; key: string }
	| { type: "runStarted" }
	| { type: "itemCreating"; key: string }
	| {
			type: "itemCreated";
			key: string;
			proposalId: string;
			revision: number;
			artifactId: string;
	  }
	| { type: "itemApproving"; key: string }
	| { type: "itemApproved"; key: string }
	| { type: "itemFailed"; key: string; error: SplitItemError }
	| { type: "runFailed" }
	| { type: "runSucceeded" }
	| { type: "retry" }
	| { type: "adjust" }
	| { type: "closed" };

export function splitReducer(
	state: SplitState,
	action: SplitAction,
): SplitState {
	switch (action.type) {
		case "open":
			return {
				...createInitialSplitState(),
				phase: "editing",
				outlineId: action.outlineId,
				instruction: action.instruction,
			};
		case "instructionChanged":
			if (state.phase !== "editing") return state;
			return { ...state, instruction: action.value };
		case "parsed":
			if (state.phase !== "editing" && state.phase !== "previewing")
				return state;
			return {
				...state,
				phase: action.items.length > 0 ? "previewing" : "editing",
				items: toItems(action.items, state.items),
			};
		case "backToEdit":
			if (state.phase !== "previewing") return state;
			return { ...state, phase: "editing" };
		case "itemChanged":
			if (state.phase !== "previewing") return state;
			return {
				...state,
				items: state.items.map((item) =>
					item.draft.key === action.key
						? { ...item, draft: { ...item.draft, ...action.patch } }
						: item,
				),
			};
		case "itemRemoved":
			if (state.phase !== "previewing") return state;
			return {
				...state,
				items: state.items.filter((item) => item.draft.key !== action.key),
			};
		case "runStarted":
			if (state.phase !== "previewing" || state.items.length === 0)
				return state;
			return { ...state, phase: "running", failure: null };
		case "itemCreating":
			return {
				...state,
				items: state.items.map((item) =>
					item.draft.key === action.key && item.status !== "done"
						? { ...item, status: "creating", error: null }
						: item,
				),
			};
		case "itemCreated":
			return {
				...state,
				items: state.items.map((item) =>
					item.draft.key === action.key
						? {
								...item,
								status: "created",
								proposalId: action.proposalId,
								revision: action.revision,
								artifactId: action.artifactId,
							}
						: item,
				),
				firstCreatedArtifactId:
					state.firstCreatedArtifactId ?? action.artifactId,
			};
		case "itemApproving":
			return {
				...state,
				items: state.items.map((item) =>
					item.draft.key === action.key
						? { ...item, status: "approving" }
						: item,
				),
			};
		case "itemApproved":
			return {
				...state,
				items: state.items.map((item) =>
					item.draft.key === action.key ? { ...item, status: "done" } : item,
				),
			};
		case "itemFailed":
			return {
				...state,
				items: state.items.map((item) =>
					item.draft.key === action.key
						? { ...item, status: "failed", error: action.error }
						: item,
				),
			};
		case "runFailed": {
			const firstError = state.items.find((item) => item.error)?.error ?? null;
			if (state.phase !== "running") return state;
			return { ...state, phase: "failed", failure: firstError };
		}
		case "runSucceeded":
			if (state.phase !== "running") return state;
			return { ...state, phase: "succeeded" };
		case "retry": {
			if (state.phase !== "failed") return state;
			return {
				...state,
				phase: "running",
				failure: null,
				items: state.items.map((item) =>
					item.status === "failed"
						? { ...item, status: "pending", error: null }
						: item,
				),
			};
		}
		case "adjust": {
			if (state.phase !== "failed") return state;
			return {
				...state,
				phase: "previewing",
				failure: null,
				items: state.items
					.filter((item) => item.status !== "done")
					.map((item) =>
						item.status === "failed"
							? { ...item, status: "pending" as const, error: null }
							: item,
					),
			};
		}
		case "closed":
			return createInitialSplitState();
		default:
			return state;
	}
}

export interface PendingPreview {
	proposalId: string;
	revision: number;
	/** artifact_change 的 subjectId 即目标工件 ID。 */
	subjectId: string;
	/** get_proposal 的 after：{title, content:{purpose…}}。 */
	after: unknown;
}

/**
 * 对账：retry 前把仍在待审的拆章提案与剩余草稿按 title+purpose 匹配，
 * 命中的直接接续批准——create 已落库但响应丢失时不会产生重复章节。
 */
export function matchPendingToDrafts(
	previews: PendingPreview[],
	items: SplitItem[],
): Map<string, { proposalId: string; revision: number; artifactId: string }> {
	const matched = new Map<
		string,
		{ proposalId: string; revision: number; artifactId: string }
	>();
	for (const item of items) {
		if (item.status === "done" || item.proposalId) continue;
		const hit = previews.find((preview) => {
			const snapshot =
				preview.after && typeof preview.after === "object"
					? (preview.after as { title?: unknown; content?: unknown })
					: undefined;
			const content =
				snapshot?.content && typeof snapshot.content === "object"
					? (snapshot.content as Record<string, unknown>)
					: {};
			return (
				snapshot?.title === item.draft.title &&
				content.purpose === item.draft.purpose
			);
		});
		if (hit) {
			matched.set(item.draft.key, {
				proposalId: hit.proposalId,
				revision: hit.revision,
				artifactId: hit.subjectId,
			});
		}
	}
	return matched;
}
