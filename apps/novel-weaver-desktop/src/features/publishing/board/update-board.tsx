import { useCallback, useEffect, useMemo, useState } from "react";
import { queryProject } from "../../../shared/api/rpc";
import { Button, Chip, EmptyState, PAGE, Panel } from "../../../shared/ui/components";
import { EMPTY } from "../../../shared/ui/copy";
import {
	describeRpcError,
	ErrorState,
	SkeletonLines,
	useDelayedFlag,
} from "../../../shared/ui/states";

interface ChapterReleaseState {
	chapterArtifactId: string;
	title: string;
	status: "draft" | "stocked" | "published";
	totalScenes: number;
	confirmedScenes: number;
	lastConfirmedAt: string | null;
	plannedAt: string | null;
	editionId: string | null;
	publishedAt: string | null;
}

const STATUS_LABEL = {
	draft: "存稿中",
	stocked: "已排期",
	published: "已发布",
} as const;

/* 滞后文案的语义色类（WF3-07）：静态字面量，Tailwind 可扫描；不可写死色值。 */
const LAG_TONE = {
	ok: "text-ink-low",
	warn: "text-accent",
	block: "text-blocking",
} as const;
type LagTone = keyof typeof LAG_TONE;

function dayDiff(fromIso: string, today: Date): number {
	return Math.floor(
		(today.getTime() - new Date(fromIso).getTime()) / 86_400_000,
	);
}

export function UpdateBoard({ cwd }: { cwd: string }) {
	const [rows, setRows] = useState<ChapterReleaseState[]>([]);
	const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
	const showSkeleton = useDelayedFlag(phase === "loading");
	const [loadError, setLoadError] = useState<ReturnType<
		typeof describeRpcError
	> | null>(null);

	const refresh = useCallback(async (projectCwd: string) => {
		setRows(
			await queryProject<ChapterReleaseState[]>(
				projectCwd,
				"list_chapter_release_state",
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

	const view = useMemo(() => {
		const today = new Date();
		const stocked = rows.filter((row) => row.status !== "published");
		const publishedThisMonth = rows.filter(
			(row) =>
				row.publishedAt &&
				row.publishedAt.slice(0, 7) === today.toISOString().slice(0, 7),
		).length;
		const lapses = rows.filter(
			(row): row is ChapterReleaseState & { plannedAt: string } =>
				row.plannedAt !== null &&
				row.status !== "published" &&
				dayDiff(row.plannedAt, today) > 0,
		);
		const maxLapse = lapses.reduce(
			(max, row) => Math.max(max, dayDiff(row.plannedAt as string, today)),
			0,
		);
		const withPlan = rows.filter((row) => row.plannedAt);
		const completion =
			withPlan.length === 0
				? null
				: Math.round(
						(withPlan.filter((row) => row.status === "published").length /
							withPlan.length) *
							100,
					);
		return {
			stockedCount: stocked.length,
			publishedThisMonth,
			lapseCount: lapses.length,
			maxLapse,
			completion,
		};
	}, [rows]);

	return (
		<main className={PAGE}>
			<header className="flex items-center">
				<div>
					<p className="eyebrow">NOVEL WEAVER / UPDATE BOARD</p>
					<h1 className="font-wenkai text-[22px] mt-0.5 mb-0">追更看板</h1>
				</div>
				<span className="ml-auto">
					<Button
						onClick={() => {
							window.location.hash = "#/publish";
						}}
					>
						去发布与导出 ›
					</Button>
				</span>
			</header>

			{loadError ? (
				<ErrorState
					message={loadError.message}
					detail={loadError.detail}
					onRetry={() => void retryLoad()}
				/>
			) : null}
			{phase === "loading" && showSkeleton ? <SkeletonLines lines={4} /> : null}

			{phase === "ready" ? (
				<>
					{view.lapseCount > 0 ? (
						<Chip tone="accent">
							已断更 {view.lapseCount} 章 · 最长滞后 {view.maxLapse} 天
						</Chip>
					) : null}

					<Panel title={`发布对账 · ${rows.length} 章`}>
						{rows.length === 0 ? (
							<EmptyState
								as="h2"
								glyph={EMPTY.board.glyph}
								title={EMPTY.board.title}
								hint={EMPTY.board.hint}
								actions={
									<Button
										variant="primary"
										onClick={() => {
											window.location.hash = "#/outline";
										}}
									>
										去大纲创建章节
									</Button>
								}
							/>
						) : (
							<>
								<div className="num flex gap-6 text-[11.5px] text-ink-mid mb-3">
									<span>
										存稿 <b className="text-ink-hi">{view.stockedCount}</b> 章
									</span>
									<span>
										本月已发{" "}
										<b className="text-ink-hi">{view.publishedThisMonth}</b> 章
									</span>
									<span>
										连续断更{" "}
										<b
											className={
												view.lapseCount > 0 ? "text-blocking" : "text-ink-hi"
											}
										>
											{view.lapseCount > 0 ? `${view.maxLapse} 天` : "0 天"}
										</b>
									</span>
									<span>
										计划完成率{" "}
										<b className="text-ink-hi">
											{view.completion === null ? "—" : `${view.completion}%`}
										</b>
									</span>
								</div>
								<div className="grid grid-cols-[2fr_1fr_1fr_1.4fr_1fr_auto] gap-2">
									<span className="eyebrow">章节</span>
									<span className="eyebrow">状态</span>
									<span className="eyebrow">计划日期</span>
									<span className="eyebrow">实际发布</span>
									<span className="eyebrow">滞后</span>
									<span />
									{rows.map((row) => {
										let lagTone: LagTone = "ok";
										let lagText: string;
										if (row.status === "published") {
											lagText =
												row.publishedAt &&
												row.plannedAt &&
												row.publishedAt <= row.plannedAt
													? "按期交付"
													: "逾期交付";
										} else if (row.plannedAt) {
											const days = dayDiff(row.plannedAt, new Date());
											if (days > 0) {
												lagTone = days > 7 ? "block" : "warn";
												lagText = `滞后 ${days} 天`;
											} else {
												lagText = "未到期";
											}
										} else {
											lagText = "—";
										}
										return (
											<div key={row.chapterArtifactId} className="contents">
												<span className="text-[12.5px] text-ink-hi">
													{row.title}
												</span>
												<span className="text-[11.5px]">
													<Chip
														tone={
															row.status === "stocked" ? "accent" : "default"
														}
													>
														{STATUS_LABEL[row.status]}
													</Chip>
												</span>
												<span className="num text-[11px]">
													{row.plannedAt ? row.plannedAt.slice(0, 10) : "—"}
												</span>
												<span className="num text-[11px]">
													{row.editionId
														? `已定版 · ${row.publishedAt?.slice(0, 10) ?? "日期待确认"}`
														: "—"}
												</span>
												<span
													className={`num text-[11px] ${LAG_TONE[lagTone]}`}
												>
													{lagText}
												</span>
												<Button
													onClick={() => {
														window.location.hash = "#/publish";
													}}
												>
													发布
												</Button>
											</div>
										);
									})}
								</div>
							</>
						)}
					</Panel>
					<footer className="text-[11px] text-ink-low">
						存稿箱与滞后均为打开时的派生计算（WF-007），不落库、不推送。
					</footer>
				</>
			) : null}
		</main>
	);
}
