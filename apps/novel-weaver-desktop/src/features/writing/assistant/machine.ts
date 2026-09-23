import type {
	AssistantCharacter,
	ContextPackageView,
	RelationshipGraphView,
} from "./gateway";

/**
 * 上下文 AI 助手状态机（WF5-07 增量 1）：从 GenerationProvider 抽出的
 * 纯 reducer。三类意图的副作用边界在这里锁死——
 *   生成候选   → 唯一允许进入 candidates 的路径；
 *   讨论推演   → 只写 discussion，绝不触碰 candidates / suggestions；
 *   检查正文   → 只写 suggestions，绝不触碰 candidates / discussion、
 *                也不携带任何会改写正文或 findings 的载荷。
 * 取消语义：activeRunId 归零后，迟到结果因 runId 不匹配被整体丢弃，
 * 不会遗留半成品候选。
 */

export type AssistantIntent = "generate" | "discuss" | "inspect";
export type AssistantPhase =
	| "idle"
	| "assembling"
	| "running"
	| "done"
	| "failed"
	| "cancelled";

export interface AssistantCandidate {
	id: string;
	title: string;
	markdown: string;
	usage: { promptTokens: number; completionTokens: number };
	adopted?: { sceneId: string; proposalId: string };
	reviewed?: boolean;
	/** 双稿「作为新草稿/局部采用」已转手编草稿（WF5-09）；候选保留可追溯。 */
	usedAsDraft?: boolean;
}

export interface AssistantSceneFacts {
	/** null = 未选中场景（冷启动可直接生成第一场）。 */
	sceneId: string | null;
	title: string | null;
	storyOrder: number;
	planTask: string | null;
	/** 当前正文快照（检查正文的输入；草稿或正典皆可）。 */
	proseMarkdown: string;
}

export interface AssistantState {
	intent: AssistantIntent;
	phase: AssistantPhase;
	/** 进行中的运行编号；0 = 无进行中运行（取消后立即归零）。 */
	activeRunId: number;
	instruction: string;
	toneSuffix: string;
	densitySuffix: string;
	scope: "scene" | "chapter";
	chapterId: string | null;
	viewpointCharacterId: string | null;
	title: string;
	contextStoryOrder: number | null;
	contextPackage: ContextPackageView | null;
	contextGraph: RelationshipGraphView | null;
	includedEntityIds: ReadonlySet<string>;
	excludeEvidence: boolean;
	excludeKnowledge: boolean;
	/** 规划上下文（WF5-17）：规划动作声明的总纲/章节计划是否撤回。 */
	excludeOutline: boolean;
	/** 文风指导（WF6-02）：启用中的风格特征是否撤回。 */
	excludeStyle: boolean;
	includePlan: boolean;
	excludedSourceIds: ReadonlySet<string>;
	/** 上一次 sceneFacts 上报的场景标题：用于让标题输入跟随场景切换。 */
	lastFactsTitle: string | null;
	candidates: AssistantCandidate[];
	discussion: string | null;
	suggestions: string | null;
	error: string | null;
	notice: string | null;
}

export function createInitialAssistantState(): AssistantState {
	return {
		intent: "generate",
		phase: "idle",
		activeRunId: 0,
		instruction: "",
		toneSuffix: "",
		densitySuffix: "",
		scope: "scene",
		chapterId: null,
		viewpointCharacterId: null,
		title: "",
		contextStoryOrder: null,
		contextPackage: null,
		contextGraph: null,
		includedEntityIds: new Set(),
		excludeEvidence: false,
		excludeKnowledge: false,
		excludeOutline: false,
		excludeStyle: false,
		includePlan: true,
		excludedSourceIds: new Set(),
		lastFactsTitle: null,
		candidates: [],
		discussion: null,
		suggestions: null,
		error: null,
		notice: null,
	};
}

export type AssistantAction =
	| { type: "intentChanged"; intent: AssistantIntent }
	| { type: "instructionChanged"; value: string }
	| { type: "styleChanged"; toneSuffix: string; densitySuffix: string }
	| {
			type: "scopeChanged";
			scope: "scene" | "chapter";
			chapterId: string | null;
	  }
	| { type: "viewpointChanged"; characterId: string | null }
	| { type: "titleChanged"; value: string }
	| { type: "sceneFactsChanged"; facts: AssistantSceneFacts }
	| {
			type: "contextAssembled";
			storyOrder: number;
			pkg: ContextPackageView;
			graph: RelationshipGraphView;
			defaultEntityIds: ReadonlySet<string>;
	  }
	| { type: "entityToggled"; characterId: string; on: boolean }
	| {
			type: "categoryToggled";
			category: "evidence" | "knowledge" | "plan" | "outline" | "style";
			on: boolean;
	  }
	| { type: "runStarted"; runId: number }
	| { type: "runPhase"; runId: number; phase: "assembling" | "running" }
	| {
			type: "runSucceeded";
			runId: number;
			kind:
				| "candidate"
				| "discussion"
				| "inspection"
				| "prose-append"
				| "prose-replace";
			payload: {
				markdown: string;
				usage: { promptTokens: number; completionTokens: number };
			};
			title?: string;
			/** 编排层预生成的候选 id（WF5-09 双稿会话据此关联候选）。 */
			candidateId?: string;
	  }
	| { type: "runFailed"; runId: number; error: string }
	| { type: "runCancelled"; runId: number }
	| {
			type: "candidateAdopted";
			candidateId: string;
			sceneId: string;
			proposalId: string;
	  }
	| { type: "candidateReviewed"; candidateId: string; flavorCount: number }
	/** 双稿裁决（WF5-09）：候选已转手编草稿，标记保留可追溯。 */
	| { type: "candidateConverted"; candidateId: string }
	/** 双稿裁决（WF5-09）：作者明确放弃，候选整体移除。 */
	| { type: "candidateDropped"; candidateId: string }
	| { type: "dismissed" }
	| { type: "noticeRaised"; notice: string }
	| { type: "errorRaised"; error: string }
	| { type: "responseCleared" }
	/** 整章批量（WF2-11）：逐场景追加候选，最后统一完成。 */
	| { type: "candidateAppended"; runId: number; candidate: AssistantCandidate }
	| { type: "runCompleted"; runId: number; notice: string };

/** 生成参数之外、随指令一起可见的作者风格后缀。 */
export function composeInstruction(
	state: Pick<AssistantState, "instruction" | "toneSuffix" | "densitySuffix">,
	planTask: string | null,
	includePlan: boolean,
	extra?: string,
): string {
	return [
		state.instruction,
		state.toneSuffix,
		state.densitySuffix,
		includePlan && planTask ? `本场任务：${planTask}` : "",
		extra,
	]
		.filter((part) => part && part.trim().length > 0)
		.join("\n");
}

/** 撤回的可选项 → 核心排除参数（硬规则永不进入）。 */
export function effectiveExcludedSourceIds(state: AssistantState): string[] {
	const excluded = new Set(state.excludedSourceIds);
	const pkg = state.contextPackage;
	if (!pkg) return [...excluded];
	if (state.excludeEvidence) {
		for (const item of pkg.selections) {
			if (
				item.sourceType === "canonical_scene" ||
				item.sourceType === "rolling_summary"
			) {
				excluded.add(item.sourceId);
			}
		}
	}
	if (state.excludeKnowledge) {
		for (const item of pkg.selections) {
			if (item.sourceType === "knowledge") excluded.add(item.sourceId);
		}
	}
	// 规划上下文（WF5-17）：撤回即从装配包剔除声明的规划工件。
	if (state.excludeOutline) {
		for (const item of pkg.selections) {
			if (item.sourceType === "plan") excluded.add(item.sourceId);
		}
	}
	// 文风指导（WF6-02）：撤回即本次装配不带启用中的风格特征。
	if (state.excludeStyle) {
		for (const item of pkg.selections) {
			if (item.sourceType === "style_trait") excluded.add(item.sourceId);
		}
	}
	return [...excluded];
}

function withExcluded(
	state: AssistantState,
	category: "evidence" | "knowledge" | "outline" | "style",
	on: boolean,
): ReadonlySet<string> {
	const pkg = state.contextPackage;
	if (!pkg) return state.excludedSourceIds;
	const next = new Set(state.excludedSourceIds);
	if (on) {
		for (const item of pkg.selections) {
			if (category === "evidence" && item.sourceType === "canonical_scene")
				next.add(item.sourceId);
			if (category === "evidence" && item.sourceType === "rolling_summary")
				next.add(item.sourceId);
			if (category === "knowledge" && item.sourceType === "knowledge")
				next.add(item.sourceId);
			if (category === "outline" && item.sourceType === "plan")
				next.add(item.sourceId);
			if (category === "style" && item.sourceType === "style_trait")
				next.add(item.sourceId);
		}
		return next;
	}
	for (const item of pkg.selections) {
		if (category === "evidence" && item.sourceType === "canonical_scene")
			next.delete(item.sourceId);
		if (category === "evidence" && item.sourceType === "rolling_summary")
			next.delete(item.sourceId);
		if (category === "knowledge" && item.sourceType === "knowledge")
			next.delete(item.sourceId);
		if (category === "outline" && item.sourceType === "plan")
			next.delete(item.sourceId);
		if (category === "style" && item.sourceType === "style_trait")
			next.delete(item.sourceId);
	}
	return next;
}

export function assistantReducer(
	state: AssistantState,
	action: AssistantAction,
): AssistantState {
	switch (action.type) {
		case "intentChanged":
			return { ...state, intent: action.intent, notice: null };
		case "instructionChanged":
			return { ...state, instruction: action.value };
		case "styleChanged":
			return {
				...state,
				toneSuffix: action.toneSuffix,
				densitySuffix: action.densitySuffix,
			};
		case "scopeChanged":
			return { ...state, scope: action.scope, chapterId: action.chapterId };
		case "viewpointChanged":
			return { ...state, viewpointCharacterId: action.characterId };
		case "titleChanged":
			return { ...state, title: action.value };
		case "sceneFactsChanged": {
			// 场景切换：装配故事序不再可信；标题输入跟随场景切换
			// （作者已手改的标题保留，不被覆盖）。
			const titleFollows =
				state.title === "" || state.title === state.lastFactsTitle;
			return {
				...state,
				contextStoryOrder: null,
				title: titleFollows ? (action.facts.title ?? state.title) : state.title,
				lastFactsTitle: action.facts.title,
			};
		}
		case "contextAssembled":
			return {
				...state,
				contextStoryOrder: action.storyOrder,
				contextPackage: action.pkg,
				contextGraph: action.graph,
				includedEntityIds: action.defaultEntityIds,
			};
		case "entityToggled": {
			const next = new Set(state.includedEntityIds);
			if (action.on) next.add(action.characterId);
			else next.delete(action.characterId);
			return { ...state, includedEntityIds: next };
		}
		case "categoryToggled": {
			if (action.category === "plan") {
				return { ...state, includePlan: action.on };
			}
			if (action.category === "outline") {
				return {
					...state,
					excludeOutline: !action.on,
					excludedSourceIds: withExcluded(state, action.category, action.on),
				};
			}
			if (action.category === "style") {
				return {
					...state,
					excludeStyle: !action.on,
					excludedSourceIds: withExcluded(state, action.category, action.on),
				};
			}
			return {
				...state,
				excludeEvidence:
					action.category === "evidence" ? !action.on : state.excludeEvidence,
				excludeKnowledge:
					action.category === "knowledge" ? !action.on : state.excludeKnowledge,
				excludedSourceIds: withExcluded(state, action.category, action.on),
			};
		}
		case "runStarted":
			return {
				...state,
				phase: "assembling",
				activeRunId: action.runId,
				error: null,
				notice: null,
			};
		case "runPhase":
			if (action.runId !== state.activeRunId) return state;
			return { ...state, phase: action.phase };
		case "runSucceeded": {
			if (action.runId !== state.activeRunId) return state;
			const base = {
				...state,
				phase: "done" as const,
				activeRunId: 0,
				notice: null,
			};
			switch (action.kind) {
				case "candidate":
					// 副作用边界：唯一进入 candidates 的路径。
					return {
						...base,
						candidates: [
							{
								id:
									action.candidateId ??
									`draft-${Date.now().toString(36)}-${action.runId}`,
								title: action.title ?? state.title,
								markdown: action.payload.markdown,
								usage: action.payload.usage,
							},
							...state.candidates,
						],
					};
				case "discussion":
					return { ...base, discussion: action.payload.markdown };
				case "inspection":
					return { ...base, suggestions: action.payload.markdown };
				case "prose-append":
					return {
						...base,
						notice: `续写完成（+${action.payload.markdown.replace(/\s/g, "").length} 字）。`,
					};
				case "prose-replace":
					return { ...base, notice: "精简完成，已在正文面替换草稿。" };
			}
			return base;
		}
		case "runFailed":
			if (action.runId !== state.activeRunId) return state;
			return {
				...state,
				phase: "failed",
				activeRunId: 0,
				error: action.error,
			};
		case "runCancelled":
			if (action.runId !== state.activeRunId) return state;
			return { ...state, phase: "cancelled", activeRunId: 0 };
		case "candidateAppended": {
			if (action.runId !== state.activeRunId) return state;
			return {
				...state,
				candidates: [action.candidate, ...state.candidates],
			};
		}
		case "runCompleted":
			if (action.runId !== state.activeRunId) return state;
			return {
				...state,
				phase: "done",
				activeRunId: 0,
				notice: action.notice,
			};
		case "candidateAdopted":
			return {
				...state,
				candidates: state.candidates.map((candidate) =>
					candidate.id === action.candidateId
						? {
								...candidate,
								adopted: {
									sceneId: action.sceneId,
									proposalId: action.proposalId,
								},
							}
						: candidate,
				),
			};
		case "candidateReviewed":
			return {
				...state,
				candidates: state.candidates.map((candidate) =>
					candidate.id === action.candidateId
						? { ...candidate, reviewed: true }
						: candidate,
				),
				notice:
					action.flavorCount > 0
						? `已送审；本地三征检出 ${action.flavorCount} 条 AI味提示，详见审校区。`
						: "已送审，未检出 AI味信号。",
			};
		case "candidateConverted":
			return {
				...state,
				candidates: state.candidates.map((candidate) =>
					candidate.id === action.candidateId
						? { ...candidate, usedAsDraft: true }
						: candidate,
				),
			};
		case "candidateDropped":
			return {
				...state,
				candidates: state.candidates.filter(
					(candidate) => candidate.id !== action.candidateId,
				),
			};
		case "dismissed":
			return { ...state, error: null, notice: null };
		case "errorRaised":
			return { ...state, error: action.error };
		case "responseCleared":
			return { ...state, discussion: null, suggestions: null };
		case "noticeRaised":
			return { ...state, notice: action.notice };
	}
}

const PHASE_SENTENCE: Record<AssistantPhase, string> = {
	idle: "AI 助手就绪",
	assembling: "正在装配本次上下文：锁定硬规则、人物关系与正式前文",
	running: "上下文已完成，正在生成结果",
	done: "本次 AI 动作已完成",
	failed: "本次 AI 动作失败，输入已保留",
	cancelled: "已取消；不会留下半成品结果",
};

/** 屏幕阅读器的唯一播报源：整句阶段状态，不逐条播 token 数字。 */
export function phaseAnnouncement(state: AssistantState): string {
	return PHASE_SENTENCE[state.phase];
}

/** 底部状态行：作者可读的即时反馈（带阶段与错误详情）。 */
export function footerStatus(state: AssistantState): string | null {
	if (state.error) return null;
	if (state.phase === "assembling") return "正在装配上下文……";
	if (state.phase === "running") return "正在生成……";
	if (state.notice) return state.notice;
	return null;
}
