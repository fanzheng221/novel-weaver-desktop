import { useCallback, useEffect, useMemo, useState } from "react";
import { queryProject } from "../../../shared/api/rpc";
import { Button, Chip, EmptyState, PAGE, Panel } from "../../../shared/ui/components";
import { EMPTY } from "../../../shared/ui/copy";
import { cx } from "../../../shared/ui/cx";
import {
	describeRpcError,
	ErrorState,
	SkeletonLines,
	useDelayedFlag,
} from "../../../shared/ui/states";

interface PlanningGraphNode {
	id: string;
	kind: string;
	title: string;
	content: Record<string, unknown>;
}

interface PlanningGraph {
	nodes: PlanningGraphNode[];
}

interface ChapterReleaseRow {
	chapterArtifactId: string;
	title: string;
	plannedAt: string | null;
	publishedAt: string | null;
}

interface SceneRef {
	sceneId: string;
	title: string;
	storyOrder: number;
}

type PromiseStatus = "open" | "paid_off" | "reframed" | "abandoned";
const STATUS_LABEL: Record<PromiseStatus, string> = {
	open: "待回收",
	paid_off: "已兑现",
	reframed: "已反转",
	abandoned: "已弃置",
};
const STATUS_TONE: Record<PromiseStatus, "accent" | "default"> = {
	open: "accent",
	paid_off: "default",
	reframed: "default",
	abandoned: "default",
};

interface PromiseRow {
	artifactId: string;
	title: string;
	setup: string;
	payoff: string;
	status: PromiseStatus;
	setupRef?: SceneRef;
	payoffRef?: SceneRef;
	setupChapterTitle: string | null;
	payoffChapterTitle: string | null;
	/** 逾期未回收：承诺仍 open，而计划回收章节已发布或计划日期已过（对照更新计划）。 */
	overdue: boolean;
}

export function ForeshadowTable({
	cwd,
	embedded,
}: {
	cwd: string;
	embedded?: boolean;
}) {
	const [rows, setRows] = useState<PromiseRow[]>([]);
	const [filter, setFilter] = useState<"all" | PromiseStatus>("all");
	const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
	const showSkeleton = useDelayedFlag(phase === "loading");
	const [loadError, setLoadError] = useState<ReturnType<
		typeof describeRpcError
	> | null>(null);

	const retryLoad = useCallback(async () => {
		setLoadError(null);
		try {
			const graph = await queryProject<PlanningGraph>(
				cwd,
				"planning_graph_query",
				{},
			);
			const promises = graph.nodes.filter(
				(node) => node.kind === "story_promise",
			);
			const releases = await queryProject<ChapterReleaseRow[]>(
				cwd,
				"list_chapter_release_state",
				{},
			);
			const releaseByChapter = new Map(
				releases.map((row) => [row.chapterArtifactId, row]),
			);
			// 反查埋设/回收场景，供跳转与展示。
			const versionIds = new Set<string>();
			for (const node of promises) {
				if (typeof node.content.setupSceneVersionId === "string")
					versionIds.add(node.content.setupSceneVersionId);
				if (typeof node.content.payoffSceneVersionId === "string")
					versionIds.add(node.content.payoffSceneVersionId);
			}
			const refMap = new Map<string, SceneRef>();
			await Promise.all(
				[...versionIds].map(async (versionId) => {
					try {
						refMap.set(
							versionId,
							await queryProject<SceneRef>(cwd, "get_scene_ref", {
								versionId,
							}),
						);
					} catch {
						/* 版本缺失时该行留空 */
					}
				}),
			);
			const now = Date.now();
			setRows(
				promises.map((node) => {
					const status =
						(node.content.status as PromiseStatus | undefined) ?? "open";
					const payoffChapterId =
						typeof node.content.payoffChapterId === "string"
							? node.content.payoffChapterId
							: "";
					const payoffRelease = payoffChapterId
						? releaseByChapter.get(payoffChapterId)
						: undefined;
					const plannedOverdue = Boolean(
						payoffRelease?.plannedAt &&
							Date.parse(payoffRelease.plannedAt) < now,
					);
					return {
						artifactId: node.id,
						title: node.title,
						setup: String(node.content.setup ?? ""),
						payoff: String(node.content.payoff ?? ""),
						status,
						setupRef:
							typeof node.content.setupSceneVersionId === "string"
								? refMap.get(node.content.setupSceneVersionId)
								: undefined,
						payoffRef:
							typeof node.content.payoffSceneVersionId === "string"
								? refMap.get(node.content.payoffSceneVersionId)
								: undefined,
						setupChapterTitle:
							typeof node.content.setupChapterId === "string"
								? (releaseByChapter.get(node.content.setupChapterId)?.title ??
									node.content.setupChapterId)
								: null,
						payoffChapterTitle: payoffChapterId
							? (payoffRelease?.title ?? "回收章节名称未找到")
							: null,
						overdue:
							status === "open" &&
							Boolean(
								payoffRelease?.publishedAt || (plannedOverdue && payoffRelease),
							),
					};
				}),
			);
			setPhase("ready");
		} catch (raw) {
			setLoadError(describeRpcError(raw));
			setPhase("failed");
		}
	}, [cwd]);

	useEffect(() => {
		void retryLoad();
	}, [retryLoad]);

	const counts = useMemo(() => {
		const base: Record<string, number> = { all: rows.length };
		for (const row of rows) base[row.status] = (base[row.status] ?? 0) + 1;
		return base;
	}, [rows]);

	const visible =
		filter === "all" ? rows : rows.filter((row) => row.status === filter);

	const body = (
		<Panel
			title={`故事承诺 · ${rows.length}`}
			action={
				<span className="inline-flex gap-1">
					{(["all", "open", "paid_off", "reframed", "abandoned"] as const).map(
						(key) => (
							<Button
								key={key}
								variant={filter === key ? "primary" : "ghost"}
								onClick={() => setFilter(key)}
							>
								{key === "all"
									? `全部 ${counts.all ?? 0}`
									: `${STATUS_LABEL[key]} ${counts[key] ?? 0}`}
							</Button>
						),
					)}
				</span>
			}
		>
			{visible.length === 0 ? (
				<EmptyState
					as="h2"
					glyph={EMPTY.foreshadow.glyph}
					title={
						rows.length === 0 ? EMPTY.foreshadow.title : "当前筛选下没有条目"
					}
					hint={
						rows.length === 0
							? EMPTY.foreshadow.hint
							: "切换状态筛选查看其他伏笔。"
					}
					actions={
						rows.length === 0 ? (
							<Button
								variant="primary"
								onClick={() => {
									window.location.hash = "#/outline";
								}}
							>
								去大纲登记承诺
							</Button>
						) : (
							<Button onClick={() => setFilter("all")}>清除筛选</Button>
						)
					}
				/>
			) : (
				<div className="grid gap-2">
					<div className="eyebrow grid grid-cols-[1.1fr_1fr_0.8fr_0.8fr_0.9fr_auto] gap-2">
						<span>埋设</span>
						<span>回收</span>
						<span>埋点章节</span>
						<span>计划回收章节</span>
						<span>支撑场景</span>
						<span>状态</span>
					</div>
					{visible.map((row) => (
						<div
							key={row.artifactId}
							className={cx(
								"grid grid-cols-[1.1fr_1fr_0.8fr_0.8fr_0.9fr_auto] gap-2 items-baseline border-t border-line py-2 text-[12px] text-ink-mid",
								row.overdue
									? "pl-2 pr-0.5 [box-shadow:inset_3px_0_0_var(--blocking)]"
									: "pl-0.5 pr-0.5",
							)}
						>
							<span>
								<b className="text-ink-hi">{row.setup || row.title}</b>
								{row.setupRef ? (
									<span className="num block text-[10px] text-ink-low mt-1">
										↳ {row.setupRef.title} · 序{row.setupRef.storyOrder}
									</span>
								) : null}
							</span>
							<span>{row.payoff || "—"}</span>
							<span className="num text-[11px]">
								{row.setupChapterTitle ?? "—"}
							</span>
							<span
								className={cx(
									"text-[11px]",
									row.overdue && "text-blocking font-semibold",
								)}
							>
								{row.payoffChapterTitle ?? "—"}
								{row.overdue ? " · 已逾期" : ""}
							</span>
							<span className="text-[11px]">
								{[
									row.setupRef &&
										`${row.setupRef.title}(序${row.setupRef.storyOrder})`,
									row.payoffRef &&
										`${row.payoffRef.title}(序${row.payoffRef.storyOrder})`,
								]
									.filter(Boolean)
									.join(" / ") || "—"}
							</span>
							<Chip tone={STATUS_TONE[row.status]}>
								{STATUS_LABEL[row.status]}
							</Chip>
						</div>
					))}
				</div>
			)}
		</Panel>
	);

	if (embedded) {
		return (
			<div className="grid gap-3">
				{phase === "failed" && loadError ? (
					<ErrorState
						message={loadError.message}
						detail={loadError.detail}
						onRetry={() => void retryLoad()}
					/>
				) : null}
				{phase === "loading" && showSkeleton ? (
					<SkeletonLines lines={4} />
				) : null}
				{phase === "ready" ? body : null}
				<footer className="text-[11px] text-ink-low">
					「计划回收章节」对照更新计划派生逾期标红；章节在大纲的章节计划里登记。
				</footer>
			</div>
		);
	}

	return (
		<main className={PAGE}>
			<header>
				<p className="eyebrow">NOVEL WEAVER / PROMISES</p>
				<h1 className="font-wenkai text-[22px] mt-0.5 mb-0">伏笔追踪表</h1>
			</header>
			{phase === "failed" && loadError ? (
				<ErrorState
					message={loadError.message}
					detail={loadError.detail}
					onRetry={() => void retryLoad()}
				/>
			) : null}
			{phase === "loading" && showSkeleton ? <SkeletonLines lines={5} /> : null}
			{phase === "ready" ? body : null}
		</main>
	);
}
