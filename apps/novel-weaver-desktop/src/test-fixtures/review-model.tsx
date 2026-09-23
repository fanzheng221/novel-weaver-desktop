import { useState } from "react";
import { createRoot } from "react-dom/client";

// fixture 必须导入产品 base.css 而不是自造样式（ui-testing.md 约定）。
import "../shared/ui/base.css";

import {
	buildInboxEntries,
	CATEGORY_LABEL,
	entryNotes,
	filterInboxEntries,
	inboxCounts,
	type InboxFilter,
} from "../features/review/review-model";
import type {
	ReviewInboxFinding,
	ReviewInboxProposal,
	ReviewInboxProjection,
} from "novel-weaver-core/src/domain/review-inbox.ts";

/**
 * WF5-15（补充层，fixture 直打生产纯函数）：统一审校收件箱模型——
 *   · buildInboxEntries：提案 + 发现 → 作者语言条目，阻断级排前；
 *   · whyNow 逐情境翻译（待审校/可确认/基线过期/正文更新/阻断发现）；
 *   · 冲突与影响提醒、深链落点、标题兜底（不暴露 ID）；
 *   · filterInboxEntries：按类别 + 仅看阻断；inboxCounts 供筛选 chips。
 */

function proposal(overrides: Partial<ReviewInboxProposal>): ReviewInboxProposal {
	return {
		proposalId: "PRP-X",
		kind: "scene_candidate",
		subjectId: "SCV-X",
		revision: 1,
		createdAt: "2026-09-07T10:00:00.000Z",
		subjectTitle: null,
		target: null,
		review: { reviewed: true, openBlocking: 0, openWarning: 0, openAdvisory: 0 },
		staleness: "fresh",
		conflicts: 0,
		pendingCandidatesAffected: 0,
		...overrides,
	};
}

function finding(overrides: Partial<ReviewInboxFinding>): ReviewInboxFinding {
	return {
		findingId: "QF-1",
		proposalId: "PRP-X",
		severity: "blocking",
		confidence: 0.9,
		code: "RULE_VIOLATION",
		message: "死人复生违反硬规则「人死不能复生」。",
		...overrides,
	};
}

const PROJECTION: ReviewInboxProjection = {
	proposals: [
		// 场景候选：有阻断发现，先处理才能确认。
		proposal({
			proposalId: "PRP-READY",
			subjectTitle: "雾中来客",
			createdAt: "2026-09-07T08:00:00.000Z",
			review: { reviewed: true, openBlocking: 1, openWarning: 1, openAdvisory: 0 },
		}),
		// 场景候选：审校完成无遗留，可确认。
		proposal({
			proposalId: "PRP-CLEAN",
			subjectTitle: "钟楼对峙",
		}),
		// 场景候选：基线过期。
		proposal({
			proposalId: "PRP-STALE",
			subjectTitle: "码头夜雾",
			staleness: "baseline_changed",
		}),
		// 场景候选：正文已更新。
		proposal({
			proposalId: "PRP-CANON",
			subjectTitle: "旧稿修订",
			staleness: "canonical_changed",
		}),
		// 规划变更：冲突 + 影响提醒 + 深链。
		proposal({
			proposalId: "PRP-PLAN",
			kind: "artifact_change",
			subjectId: "ART-1",
			subjectTitle: "场景计划 · 码头夜雾",
			target: { kind: "artifact", id: "ART-1" },
			conflicts: 1,
			pendingCandidatesAffected: 2,
		}),
		// 设定修订：深链。
		proposal({
			proposalId: "PRP-DESIGN",
			kind: "design_change",
			subjectId: "RULE-1",
			subjectTitle: "人死不能复生（修订）",
			target: { kind: "rule", id: "RULE-1" },
		}),
		// 发布提案：标题兜底（subjectTitle 为 null）。
		proposal({
			proposalId: "PRP-PUB",
			kind: "publication",
			subjectId: "PUB-1",
		}),
	],
	findings: [
		finding({ findingId: "QF-BLOCK", proposalId: "PRP-READY" }),
		finding({
			findingId: "QF-WARN",
			proposalId: "PRP-READY",
			severity: "warning",
			confidence: 0.6,
			code: "PACING",
			message: "本场景节奏偏快。",
		}),
	],
};

function line(entry: ReturnType<typeof buildInboxEntries>[number]): string {
	return [
		entry.typeLabel,
		entry.title,
		entry.severity,
		entry.whyNow,
		...entryNotes(entry),
		entry.deepLink ? `${entry.deepLink.area}` : "inbox",
	].join("｜");
}

function ModelFixture() {
	const [entries, setEntries] = useState<string[]>([]);
	const [countsOut, setCountsOut] = useState("");
	const [filterOut, setFilterOut] = useState<string[]>([]);
	const [filter, setFilter] = useState<InboxFilter>({
		category: "all",
		onlyBlocking: false,
	});

	const build = () => {
		const built = buildInboxEntries(PROJECTION);
		setEntries(built.map(line));
		const counts = inboxCounts(built);
		setCountsOut(
			`all=${counts.all} blocking=${counts.blocking} ` +
				`candidate=${counts.byCategory.candidate} plan=${counts.byCategory.plan} ` +
				`design=${counts.byCategory.design} publish=${counts.byCategory.publish} ` +
				`finding=${counts.byCategory.finding}`,
		);
		applyFilter(built);
	};

	const applyFilter = (built = buildInboxEntries(PROJECTION)) => {
		setFilterOut(
			filterInboxEntries(built, filter).map(
				(entry) => `${entry.title}:${entry.severity}`,
			),
		);
	};

	const setCategory = (category: InboxFilter["category"]) => {
		setFilter((prev) => {
			const next = { ...prev, category };
			setTimeout(() => {
				setFilterOut(
					filterInboxEntries(buildInboxEntries(PROJECTION), next).map(
						(entry) => `${entry.title}:${entry.severity}`,
					),
				);
			}, 0);
			return next;
		});
	};

	const toggleBlocking = () => {
		setFilter((prev) => {
			const next = { ...prev, onlyBlocking: !prev.onlyBlocking };
			setTimeout(() => {
				setFilterOut(
					filterInboxEntries(buildInboxEntries(PROJECTION), next).map(
						(entry) => `${entry.title}:${entry.severity}`,
					),
				);
			}, 0);
			return next;
		});
	};

	return (
		<div style={{ padding: 16, display: "grid", gap: 12 }}>
			<section style={{ display: "grid", gap: 6 }}>
				<h2>buildInboxEntries</h2>
				<button onClick={build}>构建条目</button>
				<ol data-testid="entries-out">
					{entries.map((text, index) => (
						<li key={index}>{text}</li>
					))}
				</ol>
				<p data-testid="counts-out">{countsOut}</p>
			</section>

			<section style={{ display: "grid", gap: 6 }}>
				<h2>filterInboxEntries</h2>
				<button onClick={() => setCategory("candidate")}>只看候选</button>
				<button onClick={() => setCategory("finding")}>只看问题</button>
				<button onClick={toggleBlocking}>仅看阻断</button>
				<button onClick={() => setCategory("all")}>重置类别</button>
				<p data-testid="filter-label">
					{CATEGORY_LABEL[filter.category]}
					{filter.onlyBlocking ? " · 仅阻断" : ""}
				</p>
				<ol data-testid="filter-out">
					{filterOut.map((text, index) => (
						<li key={index}>{text}</li>
					))}
				</ol>
			</section>
		</div>
	);
}

export default ModelFixture;

const root = document.getElementById("fixture-root");
if (root) createRoot(root).render(<ModelFixture />);
