import type {
	ReviewInboxFinding,
	ReviewInboxProposal,
	ReviewInboxProjection,
	ReviewStaleness,
} from "novel-weaver-core/src/domain/review-inbox.ts";

/**
 * WF5-15「统一审校收件箱」纯视图模型：把核心投影翻译成作者语言——
 *   · 每个条目回答「为什么现在需要处理」（whyNow），不暴露内部状态名或 ID；
 *   · 过期、冲突、影响等一致性结论一律来自核心投影，这里只做翻译，
 *     不在前端猜测；原始字段只留在条目上供详情使用。
 */

export type InboxCategory =
	| "candidate"
	| "plan"
	| "design"
	| "publish"
	| "finding"
	| "style";

export type InboxSeverity = "blocking" | "warning" | "advisory" | "none";

/** 条目种类 → 作者语言；`other` 是尚未归类的提案种类兜底。 */
const KIND_LABEL: Record<string, string> = {
	scene_candidate: "场景候选",
	design_change: "设定修订",
	artifact_change: "规划变更",
	publication: "发布提案",
	finding_resolution: "审校修复",
	manuscript_import: "导入稿",
	style_trait: "风格特征",
	pacing_template: "节奏范本",
};

const KIND_CATEGORY: Record<string, InboxCategory | "other"> = {
	scene_candidate: "candidate",
	design_change: "design",
	artifact_change: "plan",
	publication: "publish",
	finding_resolution: "finding",
	manuscript_import: "other",
	style_trait: "style",
	pacing_template: "style",
};

/**
 * WF6-05：artifact_change 提案的工件子类型（核心投影 target.artifactKind）。
 * 风格特征/节奏范本提案走 artifact 提案链，kind 都是 artifact_change，
 * 作者语言的分派以子类型为准。
 */
function artifactKindOf(proposal: ReviewInboxProposal): string | null {
	return proposal.kind === "artifact_change" &&
		proposal.target?.kind === "artifact"
		? (proposal.target.artifactKind ?? null)
		: null;
}

/** 条目翻译用的有效种类：artifact 提案展开为工件子类型，其余原样。 */
function effectiveKindOf(proposal: ReviewInboxProposal): string {
	return artifactKindOf(proposal) ?? proposal.kind;
}

export const CATEGORY_LABEL: Record<"all" | InboxCategory | "other", string> = {
	all: "全部",
	candidate: "场景候选",
	plan: "规划变更",
	design: "设定修订",
	publish: "发布",
	finding: "审校问题",
	style: "风格沉淀",
	other: "其他",
};

const STALENESS_LABEL: Record<ReviewStaleness, string> = {
	fresh: "基准新鲜",
	baseline_changed: "创作基准已变化",
	canonical_changed: "正文已更新",
};

/** 「为什么现在需要处理」：逐条目一句话，作者语言，不含实现词。 */
function whyNowOfProposal(proposal: ReviewInboxProposal): string {
	if (proposal.kind === "scene_candidate") {
		const staleness = proposal.staleness;
		if (staleness === "baseline_changed") {
			return "它依赖的创作基准（规则、设定或已确认正文）变了，确认前需要重新生成，或明确按旧基准继续。";
		}
		if (staleness === "canonical_changed") {
			return "它修订的那份正文已有更新的确认版本，先看看是否还有必要保留这份修订。";
		}
		const review = proposal.review;
		if (!review) return "等待处理。";
		if (review.openBlocking > 0) {
			return `审校发现 ${review.openBlocking} 条必须先处理的问题，处理后才能确认入正典。`;
		}
		if (!review.reviewed) return "还没送独立审校，审校通过后即可确认。";
		return "审校已完成，没有遗留问题，可以确认入正典。";
	}
	if (proposal.kind === "design_change")
		return "设定修订等你确认，确认后立即生效。";
	if (proposal.kind === "publication")
		return "发布提案待终审，通过后版本定稿。";
	const kind = effectiveKindOf(proposal);
	if (kind === "style_trait")
		return "来自参考书分析的风格特征提案，确认后默认启用并进入生成装配包。";
	if (kind === "pacing_template")
		return "来自参考书分析的节奏范本提案，确认后可在节奏区选用。";
	if (proposal.kind === "artifact_change")
		return "规划变更等你确认，确认后进入正典。";
	return "等待处理。";
}

function whyNowOfFinding(finding: ReviewInboxFinding): string {
	if (finding.severity === "blocking") {
		return "这条问题不处理，对应的候选无法确认入正典。";
	}
	if (finding.severity === "warning") return "审校提醒，处理与否由你判断。";
	return "供参考，一般无需处理。";
}

/** 提案条目的严重级：阻断来自开放阻断发现；过期候选批准会被拒，至少按警告呈现。 */
function severityOfProposal(proposal: ReviewInboxProposal): InboxSeverity {
	if (
		proposal.kind === "artifact_change" &&
		proposal.staleness === "canonical_changed"
	)
		return "warning";
	if (proposal.kind !== "scene_candidate") return "none";
	const review = proposal.review;
	if (review && review.openBlocking > 0) return "blocking";
	if (
		proposal.staleness === "baseline_changed" ||
		proposal.staleness === "canonical_changed"
	) {
		return "warning";
	}
	if (review && review.openWarning > 0) return "warning";
	return "none";
}

/** 冲突 / 影响提醒（事实来自核心投影，这里只翻译）。 */
function warningsOf(proposal: ReviewInboxProposal): string[] {
	const warnings: string[] = [];
	if (
		proposal.kind === "artifact_change" &&
		proposal.staleness === "canonical_changed"
	)
		warnings.push("正式规划已更新：请回规划区核对最新内容并重新提交。");
	if (proposal.conflicts > 0) {
		warnings.push(
			`另有 ${proposal.conflicts} 份待确认修订在改同一个对象，先处理哪份要想清楚。`,
		);
	}
	if (proposal.pendingCandidatesAffected > 0) {
		warnings.push(
			`确认后，${proposal.pendingCandidatesAffected} 份还在等确认的稿子会随之过期。`,
		);
	}
	return warnings;
}

/** 提案深链：在原工作区就地处理的落点；收件箱内处理的条目为 null。 */
function deepLinkOf(proposal: ReviewInboxProposal): {
	area: string;
	label: string;
} | null {
	if (proposal.kind === "artifact_change") {
		// WF6-05：风格沉淀类提案深链回对应管理面（裁决在收件箱内完成，深链只作回访）。
		const kind = effectiveKindOf(proposal);
		if (kind === "style_trait") {
			return { area: "planning/style", label: "去风格特征" };
		}
		if (kind === "pacing_template") {
			return { area: "planning/pacing", label: "去节奏范本" };
		}
		return { area: "planning/outline", label: "去规划区处理" };
	}
	if (proposal.kind === "design_change") {
		return { area: "world/rules", label: "去设定区处理" };
	}
	if (proposal.kind === "publication") {
		// WF5-16：发布并入线性流程页。
		return { area: "publish/flow", label: "去发布区处理" };
	}
	return null;
}

export interface InboxEntry {
	/** `proposal:${id}` / `finding:${id}`，列表渲染的稳定 key。 */
	key: string;
	entryKind: "proposal" | "finding";
	/** 发现条目也带归属提案 id：详情与裁决都落在其候选上。 */
	proposalId: string;
	findingId: string | null;
	category: InboxCategory | "other";
	typeLabel: string;
	title: string;
	whyNow: string;
	severity: InboxSeverity;
	warnings: string[];
	/** rev 与时间等原信息（次级呈现）。 */
	meta: string;
	/** 场景候选：与批准门同源的过期判定；详情面板据此关闭确认入口。 */
	staleness: ReviewStaleness | null;
	/** 场景候选：收件箱内可送审 / 确认。 */
	canReview: boolean;
	/** 发现：收件箱内可裁决。 */
	canRule: boolean;
	deepLink: { area: string; label: string } | null;
}

function metaOf(proposal: ReviewInboxProposal): string {
	return `rev ${proposal.revision} · ${proposal.createdAt
		.slice(5, 16)
		.replace("T", " ")}`;
}

export function buildInboxEntries(
	projection: ReviewInboxProjection,
): InboxEntry[] {
	const proposalEntries: InboxEntry[] = projection.proposals.map((proposal) => {
		// WF6-05：风格沉淀类提案的 kind 都是 artifact_change，按工件子类型分派。
		const effectiveKind = effectiveKindOf(proposal);
		const category = KIND_CATEGORY[effectiveKind] ?? "other";
		const typeLabel = KIND_LABEL[effectiveKind] ?? effectiveKind;
		return {
			key: `proposal:${proposal.proposalId}`,
			entryKind: "proposal",
			proposalId: proposal.proposalId,
			findingId: null,
			category,
			typeLabel,
			title: proposal.subjectTitle ?? typeLabel,
			whyNow: whyNowOfProposal(proposal),
			severity: severityOfProposal(proposal),
			warnings: warningsOf(proposal),
			meta: metaOf(proposal),
			staleness:
				proposal.kind === "scene_candidate" ? proposal.staleness : null,
			canReview: proposal.kind === "scene_candidate",
			canRule: false,
			deepLink: deepLinkOf(proposal),
		};
	});

	const findingEntries: InboxEntry[] = projection.findings.map((finding) => ({
		key: `finding:${finding.findingId}`,
		entryKind: "finding",
		proposalId: finding.proposalId,
		findingId: finding.findingId,
		category: "finding",
		typeLabel: "审校问题",
		title: finding.message,
		whyNow: whyNowOfFinding(finding),
		severity: finding.severity,
		warnings: [],
		meta: `置信度 ${finding.confidence.toFixed(2)}`,
		staleness: null,
		canReview: false,
		canRule: true,
		deepLink: null,
	}));

	// 阻断级在前，其后按类别原文顺序稳定排列。
	const severityRank: Record<InboxSeverity, number> = {
		blocking: 0,
		warning: 1,
		advisory: 2,
		none: 3,
	};
	return [...proposalEntries, ...findingEntries].sort(
		(a, b) => severityRank[a.severity] - severityRank[b.severity],
	);
}

export interface InboxFilter {
	category: "all" | InboxCategory | "other";
	onlyBlocking: boolean;
}

export function filterInboxEntries(
	entries: InboxEntry[],
	filter: InboxFilter,
): InboxEntry[] {
	return entries.filter((entry) => {
		if (filter.category !== "all" && entry.category !== filter.category) {
			return false;
		}
		if (filter.onlyBlocking && entry.severity !== "blocking") return false;
		return true;
	});
}

export interface InboxCounts {
	all: number;
	blocking: number;
	byCategory: Record<InboxCategory | "other", number>;
}

export function inboxCounts(entries: InboxEntry[]): InboxCounts {
	const byCategory: Record<InboxCategory | "other", number> = {
		candidate: 0,
		plan: 0,
		design: 0,
		publish: 0,
		finding: 0,
		style: 0,
		other: 0,
	};
	let blocking = 0;
	for (const entry of entries) {
		byCategory[entry.category] += 1;
		if (entry.severity === "blocking") blocking += 1;
	}
	return { all: entries.length, blocking, byCategory };
}

/** 条目附注行：过期标签 + 冲突/影响提醒合并成人类可读的小字。 */
export function entryNotes(entry: InboxEntry): string[] {
	return entry.warnings;
}

export { KIND_LABEL, STALENESS_LABEL };
