import { narrativeModeLabel } from "../../../shared/ui/terms";
import { referenceLabel } from "../../../shared/ui/reference-label";
import { X } from "lucide-react";
import { IconButton } from "../../../shared/ui/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { queryProject } from "../../../shared/api/rpc";
import { Button, Chip, EmptyState, PAGE, Panel } from "../../../shared/ui/components";
import { EMPTY } from "../../../shared/ui/copy";
import { cx } from "../../../shared/ui/cx";
import {
	describeRpcError,
	ErrorState,
	navigateTo,
	SkeletonLines,
	useDelayedFlag,
} from "../../../shared/ui/states";
import { relationshipTypeLabel } from "../../../shared/ui/terms";

interface CanonicalSceneSummary {
	sceneId: string;
	title: string;
	storyOrder: number;
	continuityId: string;
	narrativeMode: string;
	viewpointCharacterId: string | null;
}

interface RelationshipEvent {
	id: string;
	sourceId: string;
	targetId: string;
	relationshipType: string;
	validFrom: number;
}

interface RelationshipGraph {
	nodes: Array<{ id: string; label: string }>;
	objectiveHistory: RelationshipEvent[];
}

export function TimelineView({
	cwd,
	embedded,
}: {
	cwd: string;
	embedded?: boolean;
}) {
	const [loadError, setLoadError] = useState<ReturnType<
		typeof describeRpcError
	> | null>(null);
	const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
	const showSkeleton = useDelayedFlag(phase === "loading");
	const [scenes, setScenes] = useState<CanonicalSceneSummary[]>([]);
	const [events, setEvents] = useState<RelationshipEvent[]>([]);
	const [labels, setLabels] = useState<Map<string, string>>(new Map());
	const [pov, setPov] = useState<string>("all");
	const [selected, setSelected] = useState<CanonicalSceneSummary | null>(null);

	const retryLoad = useCallback(async () => {
		setLoadError(null);
		try {
			setScenes(
				await queryProject<CanonicalSceneSummary[]>(
					cwd,
					"list_canonical_scenes",
					{},
				),
			);
			const graph = await queryProject<RelationshipGraph>(
				cwd,
				"relationship_query",
				{
					continuityId: "main",
					storyOrder: 0,
				},
			);
			setEvents(graph.objectiveHistory ?? []);
			setLabels(new Map(graph.nodes.map((node) => [node.id, node.label])));
			setPhase("ready");
		} catch (raw) {
			setLoadError(describeRpcError(raw));
			setPhase("failed");
		}
	}, [cwd]);

	useEffect(() => {
		void retryLoad();
	}, [retryLoad]);

	const povs = useMemo(
		() =>
			[
				...new Set(
					scenes.map((scene) => scene.viewpointCharacterId).filter(Boolean),
				),
			] as string[],
		[scenes],
	);
	const visibleScenes =
		pov === "all"
			? scenes
			: scenes.filter((scene) => scene.viewpointCharacterId === pov);

	const bounds = useMemo(() => {
		const orders = [
			...visibleScenes.map((scene) => scene.storyOrder),
			...events.map((event) => event.validFrom),
			0,
		];
		return { min: Math.min(...orders), max: Math.max(...orders, 10) };
	}, [visibleScenes, events]);

	const pct = (order: number) =>
		bounds.max === bounds.min
			? 50
			: ((order - bounds.min) / (bounds.max - bounds.min)) * 100;

	const povFilter = (
		<span className="inline-flex items-center gap-1">
			<label className="eyebrow" htmlFor="pov-filter">
				视点角色
			</label>
			<select
				id="pov-filter"
				value={pov}
				onChange={(event) => setPov(event.target.value)}
				className="bg-shell border border-line rounded-sm text-ink-hi text-[12.5px] px-2 py-1"
			>
				<option value="all">全部</option>
				{povs.map((id) => (
					<option key={id} value={id}>
						{labels.get(id) ?? id}
					</option>
				))}
			</select>
		</span>
	);

	const body = (
		<div className="grid gap-3">
			{embedded && phase === "ready" ? (
				<div className="flex justify-end">{povFilter}</div>
			) : null}

			{phase === "failed" && loadError ? (
				<ErrorState
					message={loadError.message}
					detail={loadError.detail}
					onRetry={() => void retryLoad()}
				/>
			) : null}
			{phase === "loading" && showSkeleton ? <SkeletonLines lines={4} /> : null}

			{phase === "ready" ? (
				<>
					<Panel title={`故事时间 ${bounds.min} – ${bounds.max} · 主连续体`}>
						{visibleScenes.length === 0 && events.length === 0 ? (
							<EmptyState
								as="h2"
								glyph={EMPTY.timeline.glyph}
								title={EMPTY.timeline.title}
								hint={EMPTY.timeline.hint}
								actions={
									<Button
										variant="primary"
										onClick={() => navigateTo("studio")}
									>
										{EMPTY.timeline.actionLabel}
									</Button>
								}
							/>
						) : (
							<div className="grid gap-1 min-w-0">
								{/* 轴 */}
								<div className="relative h-0.5 bg-line mx-2 my-1" />
								{/* 场景道 */}
								<div className="relative h-16 mx-2">
									<span className="eyebrow absolute left-0 -top-4.5">场景</span>
									{visibleScenes.map((scene) => (
										<button
											key={scene.sceneId}
											type="button"
											onClick={() => setSelected(scene)}
											title={`${scene.title}（序${scene.storyOrder}）`}
											className={cx(
												"hitpad absolute top-3 -translate-x-1/2 w-4.5 h-4.5 rounded-[50%_50%_50%_4px] bg-accent cursor-pointer",
												selected?.sceneId === scene.sceneId
													? "border-2 border-solid border-ink-hi"
													: "border border-accent-contrast",
											)}
											style={{ left: `${pct(scene.storyOrder)}%` }}
										/>
									))}
									{visibleScenes.length > 0 && visibleScenes[0] ? (
										<span
											className="num absolute top-8.5 text-[10px] text-ink-low whitespace-nowrap"
											style={{ left: `${pct(visibleScenes[0].storyOrder)}%` }}
										>
											{visibleScenes[0].title}
										</span>
									) : null}
								</div>
								{/* 关系事件道 */}
								<div className="relative h-14 mx-2">
									<span className="eyebrow absolute left-0 -top-4">
										关系事件
									</span>
									{events.map((event, index) => (
										<span
											key={event.id}
											title={`序${event.validFrom}：${referenceLabel(event.sourceId, labels)} → ${relationshipTypeLabel(event.relationshipType)} → ${referenceLabel(event.targetId, labels)}`}
											className="absolute -translate-x-1/2 rotate-45 w-2 h-2 bg-ok cursor-help"
											style={{
												left: `${pct(event.validFrom)}%`,
												top: 12 + (index % 3) * 12,
											}}
										/>
									))}
								</div>
							</div>
						)}
					</Panel>

					{selected ? (
						<Panel
							title={`场景详情 · ${selected.title}`}
							action={<IconButton icon={X} label="关闭" onClick={() => setSelected(null)} />}
						>
							<div className="flex flex-wrap gap-1">
								<Chip tone="accent">故事序 {selected.storyOrder}</Chip>
								<Chip>{selected.continuityId === "main" ? "主连续体" : "其他连续体"}</Chip>
								<Chip>{narrativeModeLabel(selected.narrativeMode)}</Chip>
								{selected.viewpointCharacterId ? (
									<Chip>
										视点人物：
										{referenceLabel(selected.viewpointCharacterId, labels)}
									</Chip>
								) : null}
							</div>
						</Panel>
					) : null}
				</>
			) : null}
		</div>
	);

	if (embedded) return body;

	return (
		<main className={PAGE}>
			<header className="flex items-center">
				<div>
					<p className="eyebrow">NOVEL WEAVER / TIMELINE</p>
					<h1 className="font-wenkai text-[22px] mt-0.5 mb-0">时间线视图</h1>
				</div>
				<span className="ml-auto">{povFilter}</span>
			</header>
			{body}
		</main>
	);
}
