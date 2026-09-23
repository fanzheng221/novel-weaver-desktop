import type { RouteKey } from "../../../shared/workspace/routes";

/**
 * 跨工作区 AI 动作注册表（WF5-17）：规划/世界/审校页面只在这里声明
 * 「作者意图 + 上下文策略」，生成生命周期、错误语义与取消由 AssistantContext
 * 共享编排——不新增页面专属 Provider 或生成管线。
 *
 * 副作用边界（票面硬约束）：所有跨工作区动作都是讨论推演（零写入）——
 * 只产出建议与分析，不创建候选、不建提案、不改权威设定/规划/正文；
 * 用量照常落台账。规划动作的「总纲上下文」经 core v8 planArtifactIds
 * 进入装配包，与硬规则同一可解释呈现。
 */

export type AssistantSurface = "writing" | "planning" | "world" | "review";

/** 页面注册的当前主体：动作围绕什么展开（选中规则/人物/人物对/收件条目/总纲）。 */
export interface AssistantSubject {
  kind: "rule" | "entity" | "pair" | "entry" | "plan";
  /** 作者可读主体名。 */
  label: string;
  /** 主体补充事实（规则描述、条目 whyNow 等），进问题骨架。 */
  detail?: string;
  /** 相关实体 → build_context_package.relatedEntityIds（作者勾选叠加）。 */
  entityIds?: string[];
  /** 规划工件 → build_context_package.planArtifactIds（core v8）。 */
  planArtifactIds?: string[];
  /** 关系动作的故事时间；缺省＝全书前沿。 */
  storyOrder?: number;
  /** 稳定键：主体变化时触发上下文重装配。 */
  key: string;
}

export interface WorkspaceActionDef {
  id: string;
  /** 动作片标签。 */
  label: string;
  /** 副作用说明（作者语言，先讲清楚不会改什么）。 */
  copy: string;
  placeholder: string;
  primary: string;
  idleStatus: string;
  /** 无主体时禁用主操作。 */
  requiresSubject: boolean;
  /** 禁用时的解释与出路。 */
  subjectHint: string;
  /** 问题骨架：调用时再拼上作者补充指令。 */
  questionOf: (subject: AssistantSubject | null) => string;
}

/** 全书前沿故事序：规划/审校动作要「全部已有上下文」而非某一场景之前。 */
export const FRONTIER_STORY_ORDER = 1_000_000;

function subjectSentence(subject: AssistantSubject | null): string {
  if (!subject) return "";
  return `【当前主体】${subject.label}${subject.detail ? `（${subject.detail}）` : ""}`;
}

function planningQuestion(ask: string) {
  return (subject: AssistantSubject | null) =>
    [subjectSentence(subject), ask].filter(Boolean).join("\n");
}

const PLANNING_ACTIONS: WorkspaceActionDef[] = [
	{
		id: "planning-split",
		label: "拆章候选",
		copy: "基于总纲给出拆章候选方案，只给建议——拆章仍由你在规划区确认执行。",
		placeholder: "可补充期望的章数、节奏或必须保留的情节（可选）",
		primary: "生成拆章候选",
		idleStatus: "建议不会创建章节或提案，由你决定是否采纳。",
		requiresSubject: true,
		subjectHint: "先在规划区创建总纲（大纲），才能让 AI 给出拆章建议。",
		questionOf: planningQuestion(
			"请基于规划上下文中的总纲目标与分幕，给出三个不同的拆章候选：每个候选列出各章标题与一句话目的，并说明三个候选的取舍差异。不要输出正文。",
		),
	},
	{
		id: "planning-alternatives",
		label: "多方案推演",
		copy: "推演不同的主线推进方案，只给分析——不改任何规划内容。",
		placeholder: "可指定想比较的方案维度（可选）",
		primary: "推演主线方案",
		idleStatus: "推演只给分析与选项，由你决定走向。",
		requiresSubject: true,
		subjectHint: "先在规划区创建总纲（大纲），才能推演主线方案。",
		questionOf: planningQuestion(
			"围绕总纲目标推演 2–3 条不同的主线推进方案：每条方案说明关键转折、风险与代价，最后把选择权留给作者。",
		),
	},
	{
		id: "planning-pacing",
		label: "节奏检查",
		copy: "检查章节规划的节奏，只指出问题与方向——不修改章节计划。",
		placeholder: "可指定重点检查的卷或章（可选）",
		primary: "检查规划节奏",
		idleStatus: "检查结果只是建议，是否调整由你决定。",
		requiresSubject: true,
		subjectHint: "先在规划区创建总纲（大纲），才能检查规划节奏。",
		questionOf: planningQuestion(
			"检查规划上下文中章节规划的节奏：指出连续同类章节、缺乏钩子或蓄力-兑现失衡的具体位置，并给出调整方向；没有问题时明确说明节奏正常。",
		),
	},
];

const RULE_ACTIONS: WorkspaceActionDef[] = [
	{
		id: "rule-complete",
		label: "补全建议",
		copy: "给出规则可补充的方向，只给建议——修订仍走你的确认流程。",
		placeholder: "可指定想补全的方向（可选）",
		primary: "生成补全建议",
		idleStatus: "建议不会修改规则；采纳请走「修订规则」。",
		requiresSubject: true,
		subjectHint: "先选中一条规则，再使用 AI 规则动作。",
		questionOf: planningQuestion(
			"针对当前规则，给出 2–3 条可补充或细化的方向（适用边界、例外情形、与其他规则的衔接），只给建议，不输出修订后的规则全文。",
		),
	},
	{
		id: "rule-challenge",
		label: "质疑推演",
		copy: "从反派与极端剧情视角质疑规则，只给分析——不改动任何设定。",
		placeholder: "可指定想考验的情节（可选）",
		primary: "开始质疑推演",
		idleStatus: "质疑只是推演，规则不会因此改变。",
		requiresSubject: true,
		subjectHint: "先选中一条规则，再使用 AI 规则动作。",
		questionOf: planningQuestion(
			"从反派视角与极端剧情出发，质疑当前规则是否自洽、是否留下漏洞，并说明每个漏洞可能造成的剧情后果。",
		),
	},
	{
		id: "rule-conflict",
		label: "冲突检查",
		copy: "检查规则与设定、前文是否冲突，逐条引用证据——不产生任何审校记录。",
		placeholder: "可指定怀疑冲突的对象（可选）",
		primary: "检查规则冲突",
		idleStatus: "检查结果只是建议；是否修订由你决定。",
		requiresSubject: true,
		subjectHint: "先选中一条规则，再使用 AI 规则动作。",
		questionOf: planningQuestion(
			"检查当前规则与上下文中的其他硬规则、人物设定和前文事实是否冲突：逐条引用证据说明冲突位置；没有冲突时明确说明检查通过。",
		),
	},
];

const ENTITY_ACTIONS: WorkspaceActionDef[] = [
	{
		id: "entity-complete",
		label: "补全建议",
		copy: "给出设定可填补的方向，只给建议——修订仍走你的确认流程。",
		placeholder: "可指定想补全的侧面（可选）",
		primary: "生成补全建议",
		idleStatus: "建议不会修改人物或设定；采纳请走「修订」。",
		requiresSubject: true,
		subjectHint: "先选中一位人物或一条设定，再使用 AI 设定动作。",
		questionOf: planningQuestion(
			"针对当前人物或设定，指出描述中的空白与模糊处，给出 2–3 条可补全的方向（背景、动机、与他人关系），只给建议，不输出修订后的设定全文。",
		),
	},
	{
		id: "entity-challenge",
		label: "质疑推演",
		copy: "考验动机与设定的合理性，只给分析——不改动任何设定。",
		placeholder: "可指定想考验的情节（可选）",
		primary: "开始质疑推演",
		idleStatus: "质疑只是推演，设定不会因此改变。",
		requiresSubject: true,
		subjectHint: "先选中一位人物或一条设定，再使用 AI 设定动作。",
		questionOf: planningQuestion(
			"考验当前人物或设定的合理性：动机是否成立、行为与设定是否自洽、在极端情境下会不会崩坏，并说明每个问题的剧情后果。",
		),
	},
	{
		id: "entity-conflict",
		label: "冲突检查",
		copy: "检查设定与规则、前文是否冲突，逐条引用证据——不产生任何审校记录。",
		placeholder: "可指定怀疑冲突的对象（可选）",
		primary: "检查设定冲突",
		idleStatus: "检查结果只是建议；是否修订由你决定。",
		requiresSubject: true,
		subjectHint: "先选中一位人物或一条设定，再使用 AI 设定动作。",
		questionOf: planningQuestion(
			"检查当前人物或设定与上下文中的硬规则、其他设定和前文事实是否冲突：逐条引用证据说明冲突位置；没有冲突时明确说明检查通过。",
		),
	},
];

const PAIR_ACTIONS: WorkspaceActionDef[] = [
	{
		id: "pair-advice",
		label: "关系走向建议",
		copy: "围绕当前人物对与故事时间推演关系走向，只给建议——不修改任何关系记录。",
		placeholder: "可指定想探讨的关系侧面（可选）",
		primary: "生成关系建议",
		idleStatus: "建议不会创建或修改关系；由你决定是否采纳。",
		requiresSubject: true,
		subjectHint: "先在关系工作区选择人物对，再使用 AI 关系动作。",
		questionOf: planningQuestion(
			"围绕当前人物对在给定故事时间的客观关系与双向态度，推演接下来可能的关系变化方向与触发事件，并引用时间线中的证据。",
		),
	},
];

const REVIEW_ACTIONS: WorkspaceActionDef[] = [
	{
		id: "review-consistency",
		label: "一致性解释",
		copy: "解释审校条目与规则、认知、前文的一致性，引用证据——不关闭任何问题。",
		placeholder: "可指定想弄清的疑点（可选）",
		primary: "解释一致性",
		idleStatus: "解释只帮你判断；裁决与确认仍由你执行。",
		requiresSubject: true,
		subjectHint: "先在收件箱选中一个条目，再使用 AI 审校动作。",
		questionOf: planningQuestion(
			"解释当前审校条目与硬规则、人物认知和前文事实的一致性结论：逐条引用上下文证据，说明哪些证据支持通过、哪些支持质疑；不下裁决结论。",
		),
	},
	{
		id: "review-logic",
		label: "叙事逻辑检查",
		copy: "检查条目背后的叙事逻辑，逐条给证据与建议——不改正文。",
		placeholder: "可指定重点检查的逻辑面（可选）",
		primary: "检查叙事逻辑",
		idleStatus: "检查结果只是建议，是否修订由你决定。",
		requiresSubject: true,
		subjectHint: "先在收件箱选中一个条目，再使用 AI 审校动作。",
		questionOf: planningQuestion(
			"检查当前审校条目对应的叙事逻辑：因果链是否闭合、时间线是否自洽、人物动机是否成立，逐条给出证据与修改建议。",
		),
	},
	{
		id: "review-condense",
		label: "精简修改策略",
		copy: "给出精简策略而不是改写正文——保留什么、合并什么由你定。",
		placeholder: "可指定精简目标（可选）",
		primary: "生成精简策略",
		idleStatus: "策略不会改动正文；执行仍在写作台。",
		requiresSubject: true,
		subjectHint: "先在收件箱选中一个条目，再使用 AI 审校动作。",
		questionOf: planningQuestion(
			"为当前审校条目给出精简修改策略：哪些内容可合并或删减、必须保留哪些骨架与关键细节，只给策略，不输出改写后的正文。",
		),
	},
];

/** 路由 → 助手扩展面：null＝该页不提供跨工作区 AI 动作（写作区走原路径）。 */
export function workspaceSurfaceOf(route: RouteKey): AssistantSurface | null {
	const head = route.split("/")[0];
	if (head === "planning") return "planning";
	if (head === "world") return "world";
	if (head === "review") return "review";
	return null;
}

/** 路由 → 当前可用的动作集（世界区按子区细分）。 */
export function actionsForRoute(route: RouteKey): WorkspaceActionDef[] {
	if (route.startsWith("planning/")) return PLANNING_ACTIONS;
	if (route === "review") return REVIEW_ACTIONS;
	if (route === "world/rules") return RULE_ACTIONS;
	if (route === "world/characters" || route === "world/lore") {
		return ENTITY_ACTIONS;
	}
	if (route.startsWith("world/relations")) return PAIR_ACTIONS;
	return [];
}

export const SURFACE_LABEL: Record<AssistantSurface, string> = {
	writing: "写作",
	planning: "规划",
	world: "世界",
	review: "审校",
};

/**
 * 最终问题 = 动作问题骨架 + 作者补充指令。
 * 核心 discuss 上限 4000 字：超限截断并标注，保证失败模式是「内容被截」
 * 而不是一次人话错误。
 */
export function composeWorkspaceQuestion(
	action: WorkspaceActionDef,
	subject: AssistantSubject | null,
	authorInstruction: string,
): string {
	const parts = [
		action.questionOf(subject),
		authorInstruction.trim() ? `【作者补充】${authorInstruction.trim()}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
	if (parts.length <= 3800) return parts;
	return `${parts.slice(0, 3800)}\n（问题过长已截断——请把补充要求写短一些。）`;
}
