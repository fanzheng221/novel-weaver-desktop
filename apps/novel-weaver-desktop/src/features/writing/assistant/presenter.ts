import type {
	AssistantAttitude,
	AssistantCharacter,
	ContextPackageView,
	RelationshipGraphView,
} from "./gateway";

/**
 * 上下文呈现器（WF5-07 验收 3）：把冻结的上下文包、关系图与当前场景
 * 计划翻译成作者可读、可撤回的分类行。纯函数——同样的输入永远得到
 * 同样的行，测试可直接断言锁定与撤回语义。
 */

export type ContextCategory =
	| "hard_rule"
	| "characters"
	| "plan"
	| "outline"
	| "style"
	| "evidence"
	| "knowledge"
	| "author";

export interface ContextLineView {
	key: string;
	category: ContextCategory;
	label: string;
	detail: string | null;
	/** 必带项：勾选框禁用，不能被作者静默排除。 */
	locked: boolean;
	/** 纯展示行（作者指令/文风）：在表单里编辑，而非勾选。 */
	editable: boolean;
	included: boolean;
}

export interface ContextSummaryView {
	lines: ContextLineView[];
	totalCount: number;
	includedCount: number;
	truncated: boolean;
	budgetPct: number;
}

export interface PresentContextInput {
	pkg: ContextPackageView | null;
	graph: RelationshipGraphView | null;
	scene: {
		title: string | null;
		storyOrder: number;
		planTask: string | null;
	} | null;
	/** 作者勾选参与本次生成的人物。 */
	includedEntityIds: ReadonlySet<string>;
	/** 作者撤回的类别：正式前文 / 认知设定 / 规划上下文 / 文风指导。 */
	excludeEvidence: boolean;
	excludeKnowledge: boolean;
	excludeOutline: boolean;
	excludeStyle: boolean;
	/** 本场计划是否随指令参与生成。 */
	includePlan: boolean;
	instruction: string;
}

function attitudesOf(
	attitudes: AssistantAttitude[],
	characterIds: ReadonlySet<string>,
): string[] {
	const labels: string[] = [];
	for (const edge of attitudes) {
		if (characterIds.has(edge.sourceId) && characterIds.has(edge.targetId)) {
			labels.push(edge.dimension);
		}
	}
	return labels;
}

function characterLines(
	graph: RelationshipGraphView | null,
	included: ReadonlySet<string>,
): ContextLineView[] {
	if (!graph || graph.characters.length === 0) return [];
	const includedChars: AssistantCharacter[] = graph.characters.filter(
		(character) => included.has(character.id),
	);
	const attitudes = attitudesOf(
		graph.attitudeEdges,
		new Set(includedChars.map((character) => character.id)),
	);
	const detailParts: string[] = [];
	if (includedChars.length > 0) {
		detailParts.push(
			`${includedChars.map((character) => character.label).join("、")}`,
		);
	}
	if (attitudes.length > 0) {
		detailParts.push(`${attitudes.length} 条方向态度`);
	}
	return [
		{
			key: "characters",
			category: "characters",
			label: "人物与态度",
			detail:
				detailParts.length > 0
					? detailParts.join(" · ")
					: `${graph.characters.length} 位可选人物，勾选后进入上下文`,
			locked: false,
			editable: false,
			included: includedChars.length > 0,
		},
	];
}

export function presentContext(input: PresentContextInput): ContextSummaryView {
	const { pkg, graph, scene } = input;
	const lines: ContextLineView[] = [];

	if (pkg && pkg.hardRuleCount > 0) {
		lines.push({
			key: "hard-rules",
			category: "hard_rule",
			label: `硬规则 ${pkg.hardRuleCount} 条`,
			detail: "必带 · 不可移除",
			locked: true,
			editable: false,
			included: true,
		});
	}
	lines.push(...characterLines(graph, input.includedEntityIds));
	if (scene?.planTask) {
		lines.push({
			key: "scene-plan",
			category: "plan",
			label: "本场计划",
			detail: scene.planTask,
			locked: false,
			editable: false,
			included: input.includePlan,
		});
	}
	if (pkg) {
		const planCount = pkg.selections.filter(
			(item) => item.sourceType === "plan",
		).length;
		if (planCount > 0) {
			lines.push({
				key: "outline",
				category: "outline",
				label: "规划上下文",
				detail: `${planCount} 项总纲与章节计划（规划动作声明）`,
				locked: false,
				editable: false,
				included: !input.excludeOutline,
			});
		}
		// 文风指导（WF6-02）：启用中的风格特征，启停在规划区「风格特征」页管理。
		const styleTraitCount = pkg.selections.filter(
			(item) => item.sourceType === "style_trait",
		).length;
		if (styleTraitCount > 0) {
			lines.push({
				key: "style-traits",
				category: "style",
				label: "文风指导",
				detail: `${styleTraitCount} 条启用中的风格特征（逐条启停见规划区）`,
				locked: false,
				editable: false,
				included: !input.excludeStyle,
			});
		}
		const evidenceCount = pkg.selections.filter(
			(item) =>
				item.sourceType === "canonical_scene" ||
				item.sourceType === "rolling_summary",
		).length;
		if (evidenceCount > 0) {
			lines.push({
				key: "evidence",
				category: "evidence",
				label: "正式前文",
				detail: `${evidenceCount} 项正典场景与滚动摘要`,
				locked: false,
				editable: false,
				included: !input.excludeEvidence,
			});
		}
		const knowledgeCount = pkg.selections.filter(
			(item) => item.sourceType === "knowledge",
		).length;
		if (knowledgeCount > 0) {
			lines.push({
				key: "knowledge",
				category: "knowledge",
				label: "认知设定",
				detail: `${knowledgeCount} 条当前视点可知的事实`,
				locked: false,
				editable: false,
				included: !input.excludeKnowledge,
			});
		}
	}
	lines.push({
		key: "author",
		category: "author",
		label: "作者指令与文风",
		detail:
			input.instruction.trim() ||
			"（未填写——在上方输入框写什么，这里就带什么）",
		locked: false,
		editable: true,
		included: input.instruction.trim().length > 0,
	});

	const budgetPct = pkg
		? Math.min(
				100,
				Math.round((pkg.renderedCharacters / pkg.budgetCharacters) * 100),
			)
		: 0;
	return {
		lines,
		totalCount: lines.length,
		includedCount: lines.filter((line) => line.included).length,
		truncated: pkg?.truncated ?? false,
		budgetPct,
	};
}
