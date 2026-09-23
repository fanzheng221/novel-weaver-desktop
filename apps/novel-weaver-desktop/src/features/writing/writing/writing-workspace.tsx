import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { queryProject } from "../../../shared/api/rpc";
import { type SceneBriefingInfo, useWorkspace } from "../../../shared/workspace/context";
import type { RouteKey } from "../../../shared/workspace/routes";
import { Button, EmptyState, InlineNote, PAGE } from "../../../shared/ui/components";
import { EMPTY, WRITING } from "../../../shared/ui/copy";
import { cx } from "../../../shared/ui/cx";
import {
	describeRpcError,
	ErrorState,
	SkeletonLines,
	useDelayedFlag,
} from "../../../shared/ui/states";
import { useAssistant } from "../assistant/assistant-context";
import { loadDraft, loadLastSceneId, saveLastSceneId } from "../draft-store";
import { DualDraftView } from "../dualdraft/dual-draft-view";
import { ProseEditor } from "../prose-editor";
import { NavResizer } from "./nav-resizer";
import { clampNavWidth, loadNavWidth, saveNavWidth } from "./nav-width";
import { SceneRail } from "./scene-rail";
import {
	buildSceneDirectory,
	chapterIndexEntries,
	type DirectoryPlanningNode,
	locateSelection,
	type RailChapter,
	type RailScene,
	type RailVolume,
	type SceneDirectory,
} from "./scene-directory";

interface ResumeProjectionShape {
	scenes: Array<{
		sceneId: string;
		title: string;
		storyOrder: number;
		continuityId: string;
		versionId?: string;
		proseChars: number;
	}>;
	scenePlans: Array<{
		planId: string;
		title: string;
		storyOrder: number;
		continuityId: string;
	}>;
}

/**
 * 打开写作台时的默认落点（WF5-06 验收 1）：resume target 即选中态。
 * 与 resume.ts 同一确定性选择序；差异仅在于这里需要计划身份（planId）
 * 以便点中「待写」行，启动页则只需要文案。
 */
function resolveDefaultSelectionKey(
	cwd: string,
	projection: ResumeProjectionShape,
): string | null {
	const remembered = loadLastSceneId(cwd);
	if (remembered && projection.scenes.some((s) => s.sceneId === remembered)) {
		return `canonical:${remembered}`;
	}
	const written = new Set(
		projection.scenes.map((s) => `${s.continuityId}::${s.storyOrder}`),
	);
	const nextPlan = projection.scenePlans.find(
		(plan) => !written.has(`${plan.continuityId}::${plan.storyOrder}`),
	);
	if (nextPlan) return `plan:${nextPlan.planId}`;
	const frontier = projection.scenes[projection.scenes.length - 1];
	if (frontier) return `canonical:${frontier.sceneId}`;
	return null;
}

/** 未写成场景的真实下一步卡（WF5-06 验收 4）：计划事实＋两个真实动作。 */
function NextStepCard({
	scene,
	chapter,
	volume,
	onGenerate,
	onOpenOutline,
}: {
	scene: RailScene;
	chapter: RailChapter | null;
	volume: RailVolume | null;
	onGenerate: (scene: RailScene) => void;
	onOpenOutline: () => void;
}) {
	const assistant = useAssistant();
	const [note, setNote] = useState("");
	const ownership =
		[volume?.label, chapter?.label].filter(Boolean).join(" › ") || "未分章";
	const task = scene.planPurpose ?? chapter?.purpose ?? null;
	return (
		<section
			aria-label="下一步"
			className="max-w-180 mx-auto w-full border border-line rounded-lg bg-panel py-6 px-7 grid gap-2.5"
		>
			<p className="eyebrow m-0">下一步 · 待写场景</p>
			<h2 className="m-0 font-wenkai text-[21px] text-ink-hi">{scene.title}</h2>
			<dl className="grid gap-1.5 m-0 text-[12.5px] leading-[1.8]">
				<div className="flex gap-2.5">
					<dt className="text-ink-low flex-none">{WRITING.taskLabel}</dt>
					<dd className="m-0 min-w-0 text-ink-hi">
						{task ?? WRITING.taskNone}
					</dd>
				</div>
				<div className="flex gap-2.5">
					<dt className="text-ink-low flex-none">归属</dt>
					<dd className="m-0 text-ink-mid">{ownership}</dd>
				</div>
			</dl>
			<p className="m-0 text-[11.5px] leading-[1.8] text-ink-low">
				{WRITING.nextStepPlannedHint}
			</p>
			<div className="flex gap-2 flex-wrap mt-1">
				<Button
					variant="primary"
					onClick={() => {
						onGenerate(scene);
						setNote(WRITING.nextStepGenerateDone);
					}}
				>
					{WRITING.nextStepGenerate}
				</Button>
				<Button onClick={onOpenOutline}>{WRITING.nextStepPlanLink}</Button>
			</div>
			{note ? <InlineNote tone="success">{note}</InlineNote> : null}
			{assistant.state.notice && note ? (
				<p className="m-0 text-[10.5px] text-ink-low">
					{assistant.state.notice}
				</p>
			) : null}
		</section>
	);
}

/**
 * 专注写作台（WF5-06）：左栏定位、当前任务与正文常驻；
 * 台账/规划摘要/关系切片/常驻 QC 全部移出默认态。
 * 状态边界：目录与选中在这里，纸面与草稿在 ProseEditor，右面板投影经壳。
 */
export function WritingWorkspace({
	cwd,
	onNavigate,
}: {
	cwd: string;
	onNavigate: (route: RouteKey) => void;
}) {
	const ws = useWorkspace();
	const assistant = useAssistant();
	const [projection, setProjection] = useState<ResumeProjectionShape | null>(
		null,
	);
	const [planningNodes, setPlanningNodes] = useState<DirectoryPlanningNode[]>(
		[],
	);
	const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
	const [loadError, setLoadError] = useState<ReturnType<
		typeof describeRpcError
	> | null>(null);
	const showSkeleton = useDelayedFlag(phase === "loading");
	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [navWidth, setNavWidth] = useState(() =>
		loadNavWidth(window.innerWidth),
	);
	const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
	const [dragging, setDragging] = useState(false);
	const bootstrappedRef = useRef(false);

	const refresh = useCallback(async () => {
		setLoadError(null);
		try {
			const [nextProjection, graph] = await Promise.all([
				queryProject<ResumeProjectionShape>(cwd, "get_resume_target", {}),
				queryProject<{ nodes: DirectoryPlanningNode[] }>(
					cwd,
					"planning_graph_query",
					{},
				),
			]);
			setProjection(nextProjection);
			setPlanningNodes(graph.nodes);
			setPhase("ready");
		} catch (raw) {
			setLoadError(describeRpcError(raw));
			setPhase("failed");
		}
	}, [cwd]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// 本地草稿事实：目录合并时比对基线（琥珀点=待提交草稿）。
	const directory = useMemo<SceneDirectory | null>(() => {
		if (!projection) return null;
		const drafts = projection.scenes
			.map((scene) => {
				const persisted = loadDraft(cwd, scene.sceneId);
				return persisted
					? {
							sceneId: scene.sceneId,
							sourceVersionId: persisted.sourceVersionId,
						}
					: null;
			})
			.filter((draft): draft is NonNullable<typeof draft> => draft !== null);
		const scenePlans = planningNodes
			.filter((node) => node.kind === "scene_plan")
			.map((node) => ({
				planId: node.id,
				title: node.title,
				storyOrder:
					typeof node.content.storyOrder === "number"
						? node.content.storyOrder
						: 0,
				continuityId:
					typeof node.content.continuityId === "string"
						? node.content.continuityId
						: "main",
				purpose:
					typeof node.content.purpose === "string"
						? node.content.purpose
						: null,
			}));
		return buildSceneDirectory(
			planningNodes,
			projection.scenes,
			scenePlans,
			drafts,
		);
	}, [projection, planningNodes, cwd]);

	// 打开即落 resume target（验收 1）：仅在首次数据就位时决定一次。
	useEffect(() => {
		if (bootstrappedRef.current || !projection || !directory) return;
		bootstrappedRef.current = true;
		setSelectedKey(resolveDefaultSelectionKey(cwd, projection));
	}, [projection, directory, cwd]);

	// 选中即记忆（WF5-04/05）：会话级＋持久副本，书架「继续写作」据此恢复。
	useEffect(() => {
		if (!selectedKey?.startsWith("canonical:")) return;
		saveLastSceneId(cwd, selectedKey.slice("canonical:".length));
	}, [cwd, selectedKey]);

	// 场景清单上报（WF5-03 门禁语义）：零场景冷启动与有场景的区分数据源。
	useEffect(() => {
		if (projection) ws.reportSceneInventory(projection.scenes.length);
	}, [projection, ws]);

	// 章节目录上报（WF2-11 → WF5-07）：助手抽屉「整章」范围按此循环。
	// 同样经 useMemo 稳定引用，避免上报新数组导致壳状态→effect 重跑死循环。
	const chapterIndex = useMemo(
		() => (directory ? chapterIndexEntries(directory) : []),
		[directory],
	);
	useEffect(() => {
		assistant.registerChapterDirectory(chapterIndex);
	}, [chapterIndex, assistant]);

	// 本场简报上报（WF5-06）：右面板按需打开。对象必须经 useMemo 稳定——
	// 上报会写壳状态，新对象引用会让壳状态变化反过来重跑本 effect（死循环）。
	const located = useMemo(
		() => (directory ? locateSelection(directory, selectedKey) : null),
		[directory, selectedKey],
	);
	const briefing = useMemo<SceneBriefingInfo | null>(() => {
		const scene = located?.scene ?? null;
		if (!scene) return null;
		return {
			sceneTitle: scene.title,
			storyOrder: scene.storyOrder,
			state: scene.kind,
			sceneId: scene.sceneId,
			purpose: scene.planPurpose ?? located?.chapter?.purpose ?? null,
			chapterLabel: located?.chapter?.label ?? null,
			volumeLabel: located?.volume?.label ?? null,
			draftPending: scene.hasFreshDraft,
		};
	}, [located]);
	useEffect(() => {
		ws.reportSceneBriefing(briefing);
	}, [briefing, ws]);

	// 视口变化即时收窄（上限 = 视口 38%）；宽度是本地 UI 偏好（验收 3）。
	useEffect(() => {
		const onResize = () => {
			setViewportWidth(window.innerWidth);
			setNavWidth((current) => clampNavWidth(current, window.innerWidth));
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const changeNavWidth = useCallback((next: number) => {
		setNavWidth(clampNavWidth(next, window.innerWidth));
		saveNavWidth(next);
	}, []);

	const openPanelTab = useCallback(
		(key: string) => {
			ws.setPanelActiveTab(key);
			if (!ws.panelOpen) ws.togglePanel();
		},
		[ws],
	);

	const currentTask = located
		? (located.scene.planPurpose ?? located.chapter?.purpose ?? null)
		: null;

	let paperSlot: ReactNode = null;
	if (directory) {
		const selectedScene = located?.scene ?? null;
		if (selectedScene && selectedScene.kind === "planned") {
			paperSlot = (
				<NextStepCard
					scene={selectedScene}
					chapter={located?.chapter ?? null}
					volume={located?.volume ?? null}
					onGenerate={() => {
						// WF5-07：待写场景 → 打开覆盖式助手抽屉；
						// 标题/故事序/本场计划已随选中场景进入抽屉上下文。
						assistant.openAssistant();
					}}
					onOpenOutline={() => onNavigate("planning/outline")}
				/>
			);
		} else if (!selectedScene) {
			paperSlot = (
				<EmptyState
					as="h2"
					glyph={EMPTY.outline.glyph}
					title={WRITING.nextStepEmptyTitle}
					hint={EMPTY.outline.hint}
					actions={
						<Button
							variant="primary"
							onClick={() => onNavigate("planning/outline")}
						>
							{WRITING.nextStepEmptyAction}
						</Button>
					}
				/>
			);
		}
	}

	return (
		<main className={PAGE}>
			{loadError ? (
				<ErrorState
					message={loadError.message}
					detail={loadError.detail}
					onRetry={() => void refresh()}
				/>
			) : null}
			{showSkeleton && !loadError && !directory ? (
				<SkeletonLines lines={5} />
			) : null}
			{directory ? (
				<div
					className={cx("grid items-start", dragging && "select-none")}
					style={{
						gridTemplateColumns: `${navWidth}px 6px minmax(0,1fr)`,
					}}
				>
					<SceneRail
						directory={directory}
						selectedKey={selectedKey}
						onSelect={setSelectedKey}
					/>
					<NavResizer
						width={navWidth}
						viewportWidth={viewportWidth}
						onChange={changeNavWidth}
						onDraggingChange={setDragging}
					/>
					<div className="min-w-0 grid gap-2 pl-3.5">
						{/* 按需工具（验收 4）：本场简报与版本历史不在默认屏占位 */}
						<div className="flex gap-1 justify-end min-h-7">
							<Button size="compact" onClick={() => openPanelTab("briefing")}>
								{WRITING.briefingTab}
							</Button>
							<Button size="compact" onClick={() => openPanelTab("versions")}>
								版本历史
							</Button>
						</div>
						{/* 双稿裁决（WF5-09）：会话存在时原位替换纸面；ProseEditor
						    仅视觉隐藏、保持挂载——adoption/续写两桥不断线。 */}
						{assistant.dualDraft.session ? (
							<DualDraftView
								session={assistant.dualDraft.session}
								currentVersionId={ws.proseVersionId}
								onToggleSegment={assistant.toggleDualSegment}
								onClearSelection={assistant.clearDualSelection}
								onConfirmPartial={assistant.confirmPartialAdoption}
								onAdoptAsDraft={assistant.adoptCandidateAsDraft}
								onUndoAdoption={assistant.undoDualAdoption}
								onDiscard={assistant.discardDualCandidate}
								onResumeWriting={assistant.resumeWriting}
								onRegenerate={assistant.reopenAssistantForRegenerate}
								// 复核上下文＝版本历史面板（WF5-09 stale 出路之一）：
								// 打开面板的同时 ProseEditor 重取正典，stale 判定随之刷新。
								onReviewContext={() => openPanelTab("versions")}
							/>
						) : null}
						<div className={cx(assistant.dualDraft.session && "hidden")}>
							<ProseEditor
								cwd={cwd}
								directory={directory}
								selectedKey={selectedKey}
								currentTask={currentTask}
								paperSlot={paperSlot}
								onContentChanged={() => void refresh()}
							/>
						</div>
					</div>
				</div>
			) : null}
		</main>
	);
}
