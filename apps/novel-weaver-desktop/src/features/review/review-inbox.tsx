import { useCallback, useEffect, useMemo, useState } from "react";
import { authorErrorMessage, queryProject } from "../../shared/api/rpc";
import { useAssistant } from "../writing/assistant/assistant-context";
import {
	Button,
	Chip,
	EmptyState,
	PAGE,
	Panel,
	SevBadge,
	type Severity,
	StatusDot,
	TextField,
} from "../../shared/ui/components";
import { EMPTY } from "../../shared/ui/copy";
import { cx } from "../../shared/ui/cx";
import {
	describeRpcError,
	ErrorState,
	navigateTo,
	SkeletonLines,
	useDelayedFlag,
} from "../../shared/ui/states";
import type { ReviewInboxProjection } from "novel-weaver-core/src/domain/review-inbox.ts";
import {
	buildInboxEntries,
	CATEGORY_LABEL,
	filterInboxEntries,
	type InboxCategory,
	type InboxEntry,
	type InboxFilter,
	inboxCounts,
} from "./review-model";

interface Finding {
	findingId: string;
	severity: Severity;
	confidence: number;
	status: "open" | "resolved" | "false_positive";
	code: string;
	message: string;
}

interface ReviewDetail {
	reviewId: string;
	candidateVersionId: string;
	proposalRevision: number;
	createdAt: string;
	findings: Finding[];
}

const SEVERITIES: Severity[] = ["blocking", "warning", "advisory"];
const STATUS_LABEL = {
	open: "待处理",
	resolved: "已解决",
	false_positive: "已判误报",
} as const;

const FILTER_KEYS: Array<"all" | InboxCategory | "other"> = [
	"all",
	"candidate",
	"plan",
	"design",
	"publish",
	"finding",
	"style",
];

/**
 * 统一审校收件箱（WF5-15）：聚合待确认提案、审校问题、过期与影响提醒。
 * 事实全部来自核心投影（list_review_inbox）；场景候选与发现就地处理
 * （送审 / 确认 / 裁决），规划与设定条目深链回原工作区。
 */
export function ReviewInbox({ cwd }: { cwd: string }) {
	const [error, setError] = useState("");
	const [projection, setProjection] = useState<ReviewInboxProjection | null>(
		null,
	);
	const [filter, setFilter] = useState<InboxFilter>({
		category: "all",
		onlyBlocking: false,
	});
	const [selected, setSelected] = useState<InboxEntry | null>(null);
	const [review, setReview] = useState<ReviewDetail | null>(null);
	const [ruling, setRuling] = useState<{
		findingId: string;
		resolution: "false_positive" | "resolved";
		rationale: string;
	} | null>(null);
	const [note, setNote] = useState("");
	const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
	const showSkeleton = useDelayedFlag(phase === "loading");
	const [loadError, setLoadError] = useState<ReturnType<
		typeof describeRpcError
	> | null>(null);

	// 主体注册（WF5-17）：审校动作围绕选中收件条目展开，whyNow 进问题骨架。
	const assistant = useAssistant();
	const entrySubject = useMemo(
		() =>
			selected
				? {
						kind: "entry" as const,
						label: selected.title,
						detail: selected.whyNow || undefined,
						key: `entry:${selected.key}`,
					}
				: null,
		[selected],
	);
	useEffect(() => {
		assistant.registerAssistantSubject(entrySubject);
	}, [assistant, entrySubject]);

	const refresh = useCallback(async (projectCwd: string) => {
		setProjection(
			await queryProject<ReviewInboxProjection>(
				projectCwd,
				"list_review_inbox",
				{},
			),
		);
	}, []);

	const retryLoad = useCallback(async () => {
		setLoadError(null);
		try {
			await refresh(cwd);
			setPhase("ready");
		} catch (raw) {
			setLoadError(describeRpcError(raw));
			setPhase("failed");
		}
	}, [cwd, refresh]);

	useEffect(() => {
		void retryLoad();
	}, [retryLoad]);

	/** 选中条目：候选详情（发现条目落在其归属候选上）。 */
	const openEntry = useCallback(
		async (projectCwd: string, entry: InboxEntry) => {
			setSelected(entry);
			setReview(null);
			setRuling(null);
			setNote("");
			try {
				setReview(
					await queryProject<ReviewDetail>(projectCwd, "get_scene_review", {
						proposalId: entry.proposalId,
					}),
				);
			} catch (detail) {
				setError(authorErrorMessage(detail));
			}
		},
		[],
	);

	const submitReview = async () => {
		if (!selected || !cwd) return;
		try {
			const preview = await queryProject<{ subjectId: string }>(
				cwd,
				"get_proposal",
				{ proposalId: selected.proposalId },
			);
			await queryProject(cwd, "record_scene_review", {
				proposalId: selected.proposalId,
				candidateVersionId: preview.subjectId,
				findings: [],
			});
			await openEntry(cwd, selected);
			await refresh(cwd);
		} catch (detail) {
			setError(authorErrorMessage(detail));
		}
	};

	const approveCandidate = async () => {
		if (!selected || !cwd || !projection) return;
		try {
			const revision =
				projection.proposals.find(
					(item) => item.proposalId === selected.proposalId,
				)?.revision ?? 1;
			await queryProject(cwd, "approve_proposal", {
				proposalId: selected.proposalId,
				expectedRevision: revision,
			});
			setNote("已确认入正典。");
			await refresh(cwd);
			setSelected(null);
			setReview(null);
		} catch (detail) {
			const message = authorErrorMessage(detail);
			// 批准门如实拒绝时给出人话与下一步，不灌英文原文。
			setError(
				/stale/i.test(message)
					? "这份稿子基于旧基准，无法直接确认：先重新生成，或确认了解新旧差异后再继续。"
					: /independent review/i.test(message)
						? "这份稿子还没送独立审校：审校通过后才能确认入正典。"
						: message,
			);
		}
	};

	const submitRuling = async () => {
		if (!selected || !cwd || !ruling || !ruling.rationale.trim()) return;
		try {
			const resolution = await queryProject<{ proposalId: string }>(
				cwd,
				"create_finding_resolution_proposal",
				{
					findingId: ruling.findingId,
					resolution: ruling.resolution,
					rationale: ruling.rationale,
				},
			);
			await queryProject(cwd, "approve_proposal", {
				proposalId: resolution.proposalId,
				expectedRevision: 1,
			});
			setRuling(null);
			await openEntry(cwd, selected);
			await refresh(cwd);
		} catch (detail) {
			setError(authorErrorMessage(detail));
		}
	};

	// WF6-05：喂书分析提案（风格特征/节奏范本）在收件箱内就地裁决。
	const approveStyleProposal = async () => {
		if (!selected || !cwd || !projection) return;
		try {
			const revision =
				projection.proposals.find(
					(item) => item.proposalId === selected.proposalId,
				)?.revision ?? 1;
			await queryProject(cwd, "approve_proposal", {
				proposalId: selected.proposalId,
				expectedRevision: revision,
			});
			setNote(
				selected.category === "style" && selected.typeLabel === "节奏范本"
					? "已采纳：节奏范本入库，可在节奏范本区选用。"
					: "已采纳：风格特征入库并默认启用，可在风格特征区启停。",
			);
			await refresh(cwd);
			setSelected(null);
		} catch (detail) {
			setError(authorErrorMessage(detail));
		}
	};

	const entries = projection ? buildInboxEntries(projection) : [];
	const counts = inboxCounts(entries);
	const visible = filterInboxEntries(entries, filter);
	const blockingOpen =
		review?.findings.some(
			(finding) => finding.severity === "blocking" && finding.status === "open",
		) ?? false;

	return (
		<main className={PAGE}>
			<header>
				<p className="eyebrow">NOVEL WEAVER / REVIEW</p>
				<h1 className="font-wenkai text-[22px] mt-0.5 mb-0">审校收件箱</h1>
			</header>

			{error ? <Chip tone="accent">{error}</Chip> : null}
			{note ? <Chip tone="accent">{note}</Chip> : null}

			{phase === "failed" && loadError ? (
				<ErrorState
					message={loadError.message}
					detail={loadError.detail}
					onRetry={() => void retryLoad()}
				/>
			) : null}
			{phase === "loading" && showSkeleton ? <SkeletonLines lines={5} /> : null}

			{phase === "ready" ? (
				<>
					<Panel
						title={`待处理 · ${counts.all}`}
						action={
							counts.blocking > 0 ? (
								<Button
									variant={filter.onlyBlocking ? "primary" : "ghost"}
									onClick={() =>
										setFilter((prev) => ({
											...prev,
											onlyBlocking: !prev.onlyBlocking,
										}))
									}
								>
									仅看必须处理的（{counts.blocking}）
								</Button>
							) : null
						}
					>
						<div className="flex flex-wrap gap-1 mb-2">
							{FILTER_KEYS.map((key) => {
								const active = filter.category === key;
								const count =
									key === "all"
										? counts.all
										: key === "other"
											? counts.byCategory.other
											: counts.byCategory[key];
								if (key === "other" && count === 0) return null;
								return (
									<button
										key={key}
										type="button"
										onClick={() =>
											setFilter((prev) => ({ ...prev, category: key }))
										}
										className={cx(
											"ui-plain cursor-pointer px-2 py-0.5 rounded-sm text-[11px]",
											active
												? "bg-accent-soft text-accent"
												: "bg-transparent text-ink-mid",
										)}
									>
										{CATEGORY_LABEL[key]} {count}
									</button>
								);
							})}
						</div>
						{visible.length === 0 ? (
							<EmptyState
								as="h2"
								glyph={EMPTY.reviewInbox.glyph}
								title={EMPTY.reviewInbox.title}
								hint={EMPTY.reviewInbox.hint}
								actions={
									<Button
										variant="primary"
										onClick={() => navigateTo("studio")}
									>
										{EMPTY.reviewInbox.actionLabel}
									</Button>
								}
							/>
						) : (
							<div className="grid gap-0.5">
								{visible.map((entry) => {
									const active = selected?.key === entry.key;
									return (
										<div
											key={entry.key}
											className={cx(
												"border-t border-line first:border-t-0 px-0.5 py-2",
												active && "bg-accent-soft/40 rounded-sm",
											)}
										>
											<button
												type="button"
												onClick={() =>
													!active ? void openEntry(cwd, entry) : undefined
												}
												className="ui-plain flex items-start gap-2 text-left w-full cursor-pointer"
											>
												<span className="mt-0.5">
													{entry.severity === "none" ? (
														<StatusDot state="candidate" />
													) : (
														<SevBadge severity={entry.severity} />
													)}
												</span>
												<span className="flex-1 min-w-0">
													<span className="flex items-baseline gap-2">
														<span className="text-[12px] font-medium">
															{entry.title}
														</span>
														<span className="eyebrow">{entry.typeLabel}</span>
														<span className="num ml-auto text-[10px] text-ink-low">
															{entry.meta}
														</span>
													</span>
													<span className="block text-[12px] text-ink-mid mt-0.5">
														{entry.whyNow}
													</span>
													{entry.warnings.map((warning) => (
														<span
															key={warning}
															className="block text-[11px] text-accent-text mt-0.5"
														>
															{warning}
														</span>
													))}
												</span>
											</button>
											{entry.deepLink ? (
												<div className="mt-1.5 ml-6">
													<Button
														onClick={() => navigateTo(entry.deepLink!.area)}
													>
														{entry.deepLink.label}
													</Button>
												</div>
											) : null}
										</div>
									);
								})}
							</div>
						)}
					</Panel>

					{selected && selected.canReview ? (
						<Panel
							title={`处理 · ${selected.title}`}
							action={
								<span className="inline-flex gap-2">
									{!review ? (
										<Button onClick={() => void submitReview()}>
											送独立审校（无新增发现）
										</Button>
									) : null}
									{selected.staleness &&
									selected.staleness !== "fresh" ? null : (
										<Button
											variant="primary"
											onClick={() => void approveCandidate()}
										>
											确认入正典
										</Button>
									)}
								</span>
							}
						>
							{selected.staleness && selected.staleness !== "fresh" ? (
								<p className="text-[12px] text-accent-text mb-2">
									这份稿子基于旧基准，无法直接确认。回写作台重新生成，或先看完新旧差异再决定。
								</p>
							) : null}
							{blockingOpen ? (
								<p className="text-[12px] text-accent-text mb-2">
									存在未裁决的阻断问题——先对每条阻断作出裁决，才能确认入正典。
								</p>
							) : null}
							{review ? (
								<div className="grid gap-3">
									{SEVERITIES.map((severity) => {
										const group = review.findings.filter(
											(finding) => finding.severity === severity,
										);
										if (group.length === 0) return null;
										return (
											<div key={severity}>
												<div className="flex items-center gap-2 mb-2">
													<SevBadge severity={severity} />
													<span className="eyebrow">{group.length} 条</span>
												</div>
												<div className="grid gap-1">
													{group.map((finding) => (
														<div
															key={finding.findingId}
															className="border-t border-line py-2 px-0.5"
														>
															<div className="flex items-baseline gap-2 text-[12px]">
																<span>{finding.message}</span>
																<i className="num not-italic ml-auto text-[10px] text-ink-low">
																	置信度 {finding.confidence.toFixed(2)}
																</i>
																{finding.status !== "open" ? (
																	<Chip>{STATUS_LABEL[finding.status]}</Chip>
																) : null}
															</div>
															{finding.status === "open" ? (
																ruling?.findingId === finding.findingId ? (
																	<div className="grid gap-2 mt-2">
																		<div className="flex gap-2">
																			<Button
																				variant={
																					ruling.resolution === "false_positive"
																						? "primary"
																						: "ghost"
																				}
																				onClick={() =>
																					setRuling({
																						...ruling,
																						resolution: "false_positive",
																					})
																				}
																			>
																				判为误报
																			</Button>
																			<Button
																				variant={
																					ruling.resolution === "resolved"
																						? "primary"
																						: "ghost"
																				}
																				onClick={() =>
																					setRuling({
																						...ruling,
																						resolution: "resolved",
																					})
																				}
																			>
																				标记已解决
																			</Button>
																		</div>
																		<TextField
																			label="裁决理由（必填）"
																			value={ruling.rationale}
																			onChange={(rationale) =>
																				setRuling({ ...ruling, rationale })
																			}
																			placeholder="说明作者判断依据"
																		/>
																		<div className="flex gap-2">
																			<Button
																				variant="primary"
																				onClick={() => void submitRuling()}
																			>
																				提交裁决并生效
																			</Button>
																			<Button onClick={() => setRuling(null)}>
																				取消
																			</Button>
																		</div>
																	</div>
																) : (
																	<div className="mt-2">
																		<Button
																			onClick={() =>
																				setRuling({
																					findingId: finding.findingId,
																					resolution: "false_positive",
																					rationale: "",
																				})
																			}
																		>
																			裁决此问题
																		</Button>
																	</div>
																)
															) : null}
														</div>
													))}
												</div>
											</div>
										);
									})}
								</div>
							) : (
								<p className="text-[12px] text-ink-mid">
									尚未送独立审校。审校通过后即可确认入正典。
								</p>
							)}
						</Panel>
					) : null}

					{selected && selected.category === "style" ? (
						<Panel
							title={`裁决 · ${selected.title}`}
							action={
								<Button
									variant="primary"
									onClick={() => void approveStyleProposal()}
								>
									采纳
								</Button>
							}
						>
							<p className="text-[12px] leading-[1.7] text-ink-mid m-0">
								{selected.whyNow}
							</p>
							<p className="text-[11px] leading-[1.7] text-ink-low m-0 mt-2">
								来源：参考书喂书分析（只作分析源，原文永不进正典）。不采纳可直接忽略，提案留在收件箱不影响其他工作。
							</p>
						</Panel>
					) : null}
				</>
			) : null}
		</main>
	);
}
