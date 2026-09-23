import {
	ChevronLeft,
	ChevronRight,
	Focus,
	Gem,
	Home,
	type LucideIcon,
	Settings,
	Sun,
	Moon,
} from "lucide-react";
import { AppMark } from "../../shared/ui/icons";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UpdateBoard } from "../../features/publishing/board/update-board";
import { ByokPage } from "../../features/settings/byok/byok-page";
import { CharactersWorkspace } from "../../features/world/characters-workspace";
import { LoreWorkspace } from "../../features/world/lore-workspace";
import { RelationsWorkspace } from "../../features/world/relations-workspace";
import { RulesWorkspace } from "../../features/world/rules-workspace";
import { OutlineBoard } from "../../features/planning/outline/outline-board";
import { PacingLibrary } from "../../features/planning/pacing/pacing-library";
import { StyleTraitsPanel } from "../../features/planning/style/style-traits";
import { ReferencesConsole } from "../../features/references/references-console";
import { PublishFlow } from "../../features/publishing/publish-flow";
import { ReviewInbox } from "../../features/review/review-inbox";
import { queryProject } from "../../shared/api/rpc";
import { AssistantProvider } from "../../features/writing/assistant/assistant-context";
import { AssistantDrawer } from "../../features/writing/assistant/assistant-drawer";
import { workspaceSurfaceOf } from "../../features/writing/assistant/workspace-actions";
import {
	loadResumeScroll,
	saveResumeScroll,
} from "../../features/writing/draft-store";
import { QualityPanel } from "../../features/writing/quality-panel";
import { VersionsPanel } from "../../features/writing/versions-panel";
import { SceneBriefing } from "../../features/writing/writing/scene-briefing";
import { WritingWorkspace } from "../../features/writing/writing/writing-workspace";
import {
	Button,
	initialTheme,
	NavItem,
	PAGE,
	Panel,
	setTheme,
} from "../../shared/ui/components";
import { cx } from "../../shared/ui/cx";
import { FoundationPreview } from "../../shared/ui/foundation-preview";
import { useModalFocus } from "../../shared/ui/focus";
import {
	modalPanelVariants,
	overlayBackdropMotion,
	viewEnterTransition,
	viewEnterVariants,
} from "../../shared/ui/motion";
import { BottomBar } from "./bottom-bar";
import { type PanelTab, RightPanel } from "./right-panel";
import type { ResumeTarget } from "./resume";
import { TopBar } from "./top-bar";
import { WorkspaceTabs } from "./workspace-tabs";
import {
	useWorkspace,
	WorkspaceProvider,
} from "../../shared/workspace/context";
import {
	AREAS,
	type AreaDef,
	type AreaKey,
	areaOf,
	canonicalRouteKey,
	hashFor,
	isToolKey,
	peekScroll,
	type RouteKey,
	rememberSub,
	subLabelOf,
	TOOL_KEYS,
	TOOL_LABELS,
	visibleSubs,
	writeScroll,
} from "../../shared/workspace/routes";

const SIDEBAR_AUTO_FOLD_QUERY = "(max-width: 900px)";

/** 右面板跟随写作台上下文（WF2-01/10）。
 *  WF5-07：AI 生成设置与上下文预览退役——AI 助手改为覆盖式抽屉，
 *  右面板保留按需工具（简报/质量/版本），身份更名「写作工具面板」。 */
const VIEW_PANEL_TABS: Partial<Record<RouteKey, PanelTab[]>> = {
	writing: [
		{ key: "briefing", label: "本场简报" },
		{ key: "quality", label: "质量报告" },
		{ key: "versions", label: "版本历史" },
	],
};

interface PaletteCommand {
	key: string;
	label: string;
	icon?: LucideIcon;
	group: string;
	route?: RouteKey;
}

/** 折叠栏图标导航钮（WF5-04）：窄窗不必先展开侧栏即可切换五区。 */
function FoldedAreaButton({
	area,
	active,
	onClick,
}: {
	area: AreaDef;
	active: boolean;
	onClick: () => void;
}) {
	const Icon = area.icon;
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={area.label}
			title={area.label}
			aria-current={active ? "page" : undefined}
			className={cx(
				"hitpad ui-plain cursor-pointer w-9 h-9 rounded-md grid place-items-center",
				active ? "bg-rail-active text-accent-text" : "text-ink-mid",
			)}
		>
			<Icon size={15} strokeWidth={1.8} aria-hidden />
		</button>
	);
}

function ShellChrome({
	cwd,
	initialTarget,
	onHome,
}: {
	cwd: string;
	initialTarget: ResumeTarget | null;
	onHome: () => void;
}) {
	const ws = useWorkspace();
	const { setProjectName: pushProjectName, toggleFocus } = ws;
	// 打开书即定落点（WF5-05）：启动页的续写目标优先生效；
	// 无目标（普通打开/深链）沿用既有 hash 语义，未指明时默认写作区。
	const [routeKey, setRouteKey] = useState<RouteKey>(() =>
		initialTarget
			? canonicalRouteKey(hashFor(initialTarget.route))
			: canonicalRouteKey(window.location.hash),
	);
	/** routeRef 与 state 同步，供 hashchange/导航在内容切换前保存滚动。 */
	const routeRef = useRef<RouteKey>(routeKey);
	const scrollRef = useRef<HTMLElement>(null);
	const [narrowViewport, setNarrowViewport] = useState(
		() => window.matchMedia(SIDEBAR_AUTO_FOLD_QUERY).matches,
	);
	/** null 代表跟随窗口；作者手动选择仅在当前会话覆盖自动行为。 */
	const [sidebarManualFolded, setSidebarManualFolded] = useState<
		boolean | null
	>(null);
	const sidebarFolded = sidebarManualFolded ?? narrowViewport;
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [paletteQuery, setPaletteQuery] = useState("");
	const [paletteIndex, setPaletteIndex] = useState(0);
	const palettePanelRef = useModalFocus<HTMLDivElement>(paletteOpen);
	const [projectMenuOpen, setProjectMenuOpen] = useState(false);
	const projectMenuRef = useModalFocus<HTMLDivElement>(projectMenuOpen);
	const [theme, setThemeState] = useState(() => initialTheme());
	const commandRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const sidebarRef = useRef<HTMLElement>(null);
	const sidebarHomeButtonRef = useRef<HTMLButtonElement>(null);
	const [sidebarFocusRestoreEpoch, setSidebarFocusRestoreEpoch] = useState(0);

	const panelTabs = VIEW_PANEL_TABS[routeKey] ?? [];

	/** 写作台工具面板内容分发（WF5-07 起不再承载 AI 生成面）。 */
	const renderStudioPanelContent = useCallback(
		(activeKey: string) => {
			switch (activeKey) {
				case "briefing":
					return <SceneBriefing cwd={cwd} />;
				case "quality":
					return <QualityPanel cwd={cwd} />;
				case "versions":
					return <VersionsPanel cwd={cwd} />;
				default:
					return null;
			}
		},
		[cwd],
	);

	useEffect(() => {
		if (paletteOpen) setPaletteIndex(0);
	}, [paletteOpen]);

	// 子区激活即记忆：跨工作区切换后由 canonicalRouteKey 复原（WF5-04 用例 3）。
	useEffect(() => {
		if (subLabelOf(routeKey) === null) return;
		const [head, sub] = routeKey.split("/");
		rememberSub(head as AreaKey, sub);
	}, [routeKey]);

	/** 离开路由时的滚动保存：会话级一律记；写作区额外持久化（WF5-05）。 */
	const leaveRouteSaveScroll = useCallback(
		(key: RouteKey, top: number) => {
			writeScroll(key, top);
			if (key === "writing") saveResumeScroll(cwd, top);
		},
		[cwd],
	);

	// 打开书即把目标落点写进 hash：地址栏、深链与路由一致；
	// 同键回声被 hashchange 守卫忽略，不产生二次切换。
	const targetRoute = initialTarget?.route ?? null;
	useEffect(() => {
		if (!targetRoute) return;
		window.location.hash = hashFor(targetRoute);
	}, [targetRoute]);

	// 浏览器前进/后退、深链与页面内 location.hash 写入都走这里；
	// navigate() 主动导航的 hash 回声（同一路由键）直接忽略，避免覆盖滚动记忆。
	useEffect(() => {
		const onHashChange = () => {
			const next = canonicalRouteKey(window.location.hash);
			if (next === routeRef.current) return;
			leaveRouteSaveScroll(routeRef.current, scrollRef.current?.scrollTop ?? 0);
			routeRef.current = next;
			setRouteKey(next);
		};
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, [leaveRouteSaveScroll]);

	// 路由切换后恢复主区滚动位置：会话记忆优先，写作区再以跨会话
	// 持久记忆兜底（WF5-05 验收 1——重开应用回到上次写作位置）。
	// 正文/面板异步加载会逐步撑高主区，短窗重试直到目标位置贴得住。
	useEffect(() => {
		const main = scrollRef.current;
		if (!main) return;
		const sessionTop = peekScroll(routeKey);
		const target =
			sessionTop ??
			(routeKey === "writing" ? loadResumeScroll(cwd) : null) ??
			0;
		main.scrollTop = target;
		if (target <= 0) return;
		let elapsed = 0;
		const timer = window.setInterval(() => {
			elapsed += 60;
			if (main.scrollTop >= target || elapsed > 3000) {
				window.clearInterval(timer);
				return;
			}
			main.scrollTop = target;
		}, 60);
		return () => window.clearInterval(timer);
	}, [routeKey, cwd]);

	// 写作区滚动持久化（WF5-05）：防抖写 localStorage，直接关应用也不丢。
	useEffect(() => {
		if (routeKey !== "writing") return;
		const main = scrollRef.current;
		if (!main) return;
		let timer = 0;
		const onScroll = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(
				() => saveResumeScroll(cwd, main.scrollTop),
				250,
			);
		};
		main.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			main.removeEventListener("scroll", onScroll);
			window.clearTimeout(timer);
		};
	}, [routeKey, cwd]);

	const requestSidebarFocusRestore = useCallback(() => {
		if (sidebarRef.current?.contains(document.activeElement)) {
			setSidebarFocusRestoreEpoch((epoch) => epoch + 1);
		}
	}, []);

	useEffect(() => {
		const media = window.matchMedia(SIDEBAR_AUTO_FOLD_QUERY);
		const onChange = (event: MediaQueryListEvent) => {
			if (sidebarManualFolded === null) requestSidebarFocusRestore();
			setNarrowViewport(event.matches);
		};
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [requestSidebarFocusRestore, sidebarManualFolded]);

	useEffect(() => {
		if (sidebarFocusRestoreEpoch === 0) return;
		const frame = window.requestAnimationFrame(() => {
			sidebarHomeButtonRef.current?.focus();
		});
		return () => window.cancelAnimationFrame(frame);
	}, [sidebarFocusRestoreEpoch]);

	// cwd 由启动页选定（WF2-02）；这里只取项目名进顶栏。
	useEffect(() => {
		void queryProject<{ name: string }>(cwd, "project_status", {})
			.then((status) => pushProjectName(status.name))
			.catch(() => pushProjectName(""));
	}, [cwd, pushProjectName]);

	const openPalette = useCallback(() => {
		setPaletteOpen(true);
		setPaletteQuery("");
		setPaletteIndex(0);
	}, []);

	const navigate = useCallback(
		(key: RouteKey) => {
			// 内容还在旧路由时先存滚动；hash 回声由上面的同键守卫忽略。
			leaveRouteSaveScroll(routeRef.current, scrollRef.current?.scrollTop ?? 0);
			window.location.hash = hashFor(key);
			const next = canonicalRouteKey(hashFor(key));
			routeRef.current = next;
			setRouteKey(next);
			setPaletteOpen(false);
			setProjectMenuOpen(false);
		},
		[leaveRouteSaveScroll],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setPaletteOpen((open) => {
					if (!open) setPaletteQuery("");
					return !open;
				});
				setPaletteIndex(0);
			}
			if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
				event.preventDefault();
				toggleFocus();
			}
			if (event.key === "Escape") {
				setPaletteOpen(false);
				setProjectMenuOpen(false);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [toggleFocus]);

	const toggleSidebar = useCallback(() => {
		requestSidebarFocusRestore();
		setSidebarManualFolded(!sidebarFolded);
	}, [requestSidebarFocusRestore, sidebarFolded]);

	const navigateToArea = useCallback(
		(areaKey: AreaKey) => navigate(areaKey),
		[navigate],
	);

	const commands = useMemo<PaletteCommand[]>(
		() => [
			...AREAS.flatMap((area) => [
				{
					key: area.key,
					label: area.label,
					icon: area.icon,
					group: "工作区",
					route: area.key,
				},
				...visibleSubs(area).map((sub) => ({
					key: `${area.key}/${sub.key}`,
					label: `${area.label} › ${sub.label}`,
					icon: area.icon,
					group: area.label,
					route: `${area.key}/${sub.key}` as RouteKey,
				})),
			]),
			...TOOL_KEYS.map((tool) => ({
				key: tool,
				label: TOOL_LABELS[tool],
				icon: tool === "byok" ? Settings : Gem,
				group: "项目",
				route: tool,
			})),
			{
				key: "__home",
				label: "回到启动页 · 换书或新建",
				icon: Home,
				group: "命令",
			},
			{
				key: "__focus",
				label: "专注模式（隐藏两侧）",
				icon: Focus,
				group: "命令",
			},
		],
		[],
	);
	const filteredCommands = commands.filter((command) =>
		`${command.group} ${command.label}`
			.toLowerCase()
			.includes(paletteQuery.toLowerCase()),
	);
	const activeIndex = Math.min(
		paletteIndex,
		Math.max(filteredCommands.length - 1, 0),
	);

	function runCommand(command: PaletteCommand) {
		if (command.key === "__home") {
			onHome();
		} else if (command.key === "__focus") {
			toggleFocus();
			setPaletteOpen(false);
		} else if (command.route) {
			navigate(command.route);
		}
	}

	useEffect(() => {
		commandRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);

	const activeArea = areaOf(routeKey);
	const activeSub = activeArea?.subAreas.length
		? (routeKey.split("/")[1] ?? null)
		: null;
	const toolActive = isToolKey(routeKey);

	const page = (() => {
		switch (routeKey) {
			case "writing":
				return <WritingWorkspace cwd={cwd} onNavigate={navigate} />;
			case "planning/outline":
				return <OutlineBoard cwd={cwd} subTabsExternal />;
			case "planning/foreshadow":
				return (
					<OutlineBoard cwd={cwd} initialSubTab="foreshadow" subTabsExternal />
				);
			case "planning/timeline":
				return (
					<OutlineBoard cwd={cwd} initialSubTab="timeline" subTabsExternal />
				);
			case "planning/pacing":
				return <PacingLibrary cwd={cwd} />;
			case "planning/references":
				// WF6-05 喂书分析控制台：紧邻风格特征（WF6-10 裁决落点）。
				return <ReferencesConsole cwd={cwd} onNavigate={navigate} />;
			case "planning/style":
				// WF6-02 最小管理面：特征列表与启停；完整喂书 UI 归 WF6-05。
				return <StyleTraitsPanel cwd={cwd} />;
			case "world/rules":
				return <RulesWorkspace cwd={cwd} />;
			case "world/characters":
				return <CharactersWorkspace cwd={cwd} />;
			case "world/lore":
				return <LoreWorkspace cwd={cwd} />;
			case "world/relations":
			case "world/relations-timeline":
			case "world/relations-graph":
				// WF5-13 统一关系工作区：时间轴带+双栏同步，旧深链收敛到同一路由。
				return <RelationsWorkspace cwd={cwd} />;
			case "review":
				// WF5-15 统一审校收件箱：替代旧 QC 面板，聚合待确认与审校问题。
				return <ReviewInbox cwd={cwd} />;
			case "publish/flow":
			case "publish/checklist":
			case "publish/export":
				// WF5-16 线性发布流程：旧「发布检查/导出」子区并入同一条流程页。
				return <PublishFlow cwd={cwd} />;
			case "publish/board":
				return <UpdateBoard cwd={cwd} />;
			case "byok":
				return <ByokPage cwd={cwd} />;
			case "foundation":
				return <FoundationPreview />;
			default:
				return <Panel title="未实现">该分区在后续票据中落地。</Panel>;
		}
	})();

	const projectMenuButton = sidebarFolded ? (
		<button
			type="button"
			onClick={() => setProjectMenuOpen((open) => !open)}
			aria-label="项目与设置"
			title="项目与设置"
			aria-expanded={projectMenuOpen}
			aria-haspopup="dialog"
			className={cx(
				"hitpad ui-plain cursor-pointer w-8 h-8 rounded-md grid place-items-center",
				toolActive ? "bg-rail-active text-accent-text" : "text-ink-mid",
			)}
		>
			<Settings size={14} strokeWidth={1.8} aria-hidden />
		</button>
	) : (
		<button
			type="button"
			onClick={() => setProjectMenuOpen((open) => !open)}
			aria-expanded={projectMenuOpen}
			aria-haspopup="dialog"
			className={cx(
				"ui-plain hitpad cursor-pointer w-full flex items-center gap-2 text-left text-[12.5px] font-[inherit] py-2 px-2 rounded-sm",
				toolActive
					? "text-accent-text font-semibold bg-rail-active"
					: "text-ink-mid",
			)}
		>
			<Settings size={14} strokeWidth={1.8} aria-hidden />
			项目与设置
		</button>
	);

	return (
		<AssistantProvider cwd={cwd} route={routeKey}>
			<div className="flex flex-col h-screen bg-shell text-ink-hi overflow-hidden">
				<TopBar
					panelAvailable={panelTabs.length > 0}
					aiOnDrawer={
						routeKey === "writing" || workspaceSurfaceOf(routeKey) !== null
					}
					aiScope={
						workspaceSurfaceOf(routeKey) !== null ? "workspace" : "writing"
					}
					onOpenPalette={openPalette}
				/>

				{/* 三栏主体：左导航 | 中主区（子区条＋滚动区） | 右面板 */}
				<div className="flex-1 min-h-0 flex">
					{!ws.focusMode ? (
						<aside
							ref={sidebarRef}
							aria-label="导航侧栏"
							className="flex-none bg-rail border-r border-line flex flex-col overflow-hidden py-3 px-2"
							// 折叠/展开宽度过渡为 WF3-03 已关闭决议的例外：transition 短写
							// （width .2s ease）保留原内联，避免与工具类 duration/ease 语义打架。
							style={{
								width: sidebarFolded ? 44 : 204,
								transition: "width .2s ease",
							}}
						>
							{sidebarFolded ? (
								/* Collapsed rail: brand mark, workspaces, project menu and expand control（WF5-04） */
								<>
									<button
										ref={sidebarHomeButtonRef}
										type="button"
										onClick={onHome}
										title={`回到启动页 · ${ws.projectName || "尚未建项目"}`}
										aria-label={`回到启动页 · ${ws.projectName || "项目"}`}
										className="hitpad ui-plain w-9 h-9 cursor-pointer grid place-items-center mb-2"
									>
										<AppMark size={28} />
									</button>
									<div className="grid gap-1 justify-items-center">
										{AREAS.map((area) => (
											<FoldedAreaButton
												key={area.key}
												area={area}
												active={activeArea?.key === area.key}
												onClick={() => navigateToArea(area.key)}
											/>
										))}
									</div>
									<div className="mt-auto grid gap-1 justify-items-center">
										{projectMenuButton}
										<button
											type="button"
											onClick={toggleSidebar}
											title="展开侧栏"
											aria-label="展开侧栏"
											aria-expanded={false}
											className="hitpad ui-plain cursor-pointer w-8 h-8 rounded-md grid place-items-center text-ink-mid text-body"
										>
											<ChevronRight size={14} strokeWidth={2} />
										</button>
									</div>
								</>
							) : (
								<div className="w-46.5 min-h-0 flex-1 flex-col flex">
									{/* WF5-03：导航区自身可滚动——600px 高度下入口增多仍全部可达；
									    底部动作固定在滚动区外。 */}
									<div className="min-h-0 flex-1 overflow-y-auto">
										<button
											ref={sidebarHomeButtonRef}
											type="button"
											onClick={onHome}
											title="回到启动页"
											className="ui-plain cursor-pointer flex items-center gap-2 pt-1 pb-3 w-full"
										>
											<AppMark size={28} />
											<span className="min-w-0">
												<b className="text-[13px] block whitespace-nowrap text-ellipsis overflow-hidden">
													{ws.projectName || "尚未建项目"}
												</b>
												<span className="text-[9.5px] text-ink-low tracking-[0.08em]">
													切换项目
												</span>
											</span>
										</button>
										{/* 五作者工作区（WF5-04）：写作 / 规划 / 世界 / 审校 / 发布 */}
										<div className="grid gap-0.5">
											{AREAS.map((area) => (
												<NavItem
													key={area.key}
													icon={
														<area.icon
															size={14}
															strokeWidth={1.8}
															aria-hidden
														/>
													}
													label={area.label}
													active={activeArea?.key === area.key}
													navIndicatorKey="nav-active"
													onClick={() => navigateToArea(area.key)}
												/>
											))}
										</div>
									</div>
									<div className="pt-2 border-t border-line grid gap-1">
										{projectMenuButton}
										<Button onClick={toggleSidebar}>
											<span className="inline-flex items-center gap-1">
												<ChevronLeft size={12} strokeWidth={2} />
												收起侧栏
											</span>
										</Button>
									</div>
								</div>
							)}
						</aside>
					) : null}

					<div className="flex-1 min-w-0 flex flex-col">
						{activeArea && activeArea.subAreas.length > 0 ? (
							<WorkspaceTabs
								area={activeArea}
								activeSub={activeSub}
								onSelect={(subKey) =>
									navigate(`${activeArea.key}/${subKey}` as RouteKey)
								}
							/>
						) : null}
						<main
							ref={scrollRef}
							className="flex-1 min-w-0 overflow-y-auto flex flex-col"
						>
							{/* 视图切换淡入＋8px 上移（WF3-06①）：key 换向即重挂入场，退场即时 */}
							<motion.div
								key={routeKey}
								initial="initial"
								animate="animate"
								variants={viewEnterVariants}
								transition={viewEnterTransition}
								className="flex-1"
							>
								{page}
							</motion.div>
						</main>
					</div>

					{!ws.focusMode ? (
						<RightPanel
							tabs={panelTabs}
							renderContent={
								routeKey === "writing" ? renderStudioPanelContent : undefined
							}
						/>
					) : null}
				</div>

				<BottomBar />

				{/* 覆盖式 AI 助手（WF5-07）：写作态经顶栏窄入口开合；打开设置跳模型接入。 */}
				<AssistantDrawer onOpenSettings={() => navigate("byok")} />

				{/* ⌘K 命令面板：遮罩与面板为兄弟层——button 内不得嵌套输入控件（WF3-10）；
				    进出场走 AnimatePresence（WF3-06④），Esc 全局可退（上方监听） */}
				<AnimatePresence>
					{paletteOpen ? (
						<motion.button
							key="palette-backdrop"
							type="button"
							aria-label="关闭命令面板"
							onClick={() => setPaletteOpen(false)}
							initial="initial"
							animate="animate"
							exit="exit"
							variants={overlayBackdropMotion}
							className="ui-plain fixed inset-0 bg-[rgba(10,10,12,0.55)] cursor-default z-90"
						/>
					) : null}
					{/* 圈闭容器（WF3-11）：Tab 循环在内，焦点归还触发者 */}
					{paletteOpen ? (
						<motion.div
							key="palette-panel"
							ref={palettePanelRef}
							role="dialog"
							aria-modal="true"
							aria-label="命令面板"
							initial="initial"
							animate="animate"
							exit="exit"
							variants={{
								initial: { ...modalPanelVariants.initial, x: "-50%" },
								animate: { ...modalPanelVariants.animate, x: "-50%" },
								exit: { ...modalPanelVariants.exit, x: "-50%" },
							}}
							className="fixed top-22.5 left-1/2 w-105 bg-rail border border-line rounded-lg overflow-hidden shadow-nw z-91"
						>
							<input
								value={paletteQuery}
								onChange={(event) => {
									setPaletteQuery(event.target.value);
									setPaletteIndex(0);
								}}
								onKeyDown={(event) => {
									if (event.key === "ArrowDown") {
										event.preventDefault();
										if (filteredCommands.length > 0)
											setPaletteIndex((index) =>
												Math.min(index + 1, filteredCommands.length - 1),
											);
									} else if (event.key === "ArrowUp") {
										event.preventDefault();
										setPaletteIndex((index) => Math.max(index - 1, 0));
									} else if (event.key === "Enter") {
										event.preventDefault();
										const command = filteredCommands[activeIndex];
										if (command) runCommand(command);
									}
								}}
								placeholder="跳转到…"
								className="w-full bg-transparent border-0 outline-none text-ink-hi text-[13.5px] py-3 px-4 border-b border-line font-[inherit]"
							/>
							<div
								role="listbox"
								aria-label="命令列表"
								className="max-h-80 overflow-y-auto pt-1 pb-1"
							>
								{filteredCommands.map((command, index) => {
									const isCurrent =
										command.route !== undefined && command.route === routeKey;
									return (
										<button
											key={command.key}
											type="button"
											ref={(el) => {
												commandRefs.current[index] = el;
											}}
											role="option"
											aria-selected={index === activeIndex}
											aria-current={isCurrent ? "true" : undefined}
											onMouseEnter={() => setPaletteIndex(index)}
											onClick={() => runCommand(command)}
											className={cx(
												"ui-plain cursor-pointer flex gap-2 w-full py-2 px-4 text-[12.5px]",
												index === activeIndex
													? "bg-accent-soft text-ink-hi"
													: "text-ink-mid",
											)}
										>
											{command.icon ? (
												<span aria-hidden className="flex-none w-4 text-center">
													<command.icon size={13} strokeWidth={1.8} />
												</span>
											) : null}
											{command.label}
											{isCurrent ? (
												<span className="text-[10px] text-accent-text">
													当前
												</span>
											) : null}
											<span className="ml-auto text-[10px] text-ink-low">
												{command.group}
											</span>
										</button>
									);
								})}
							</div>
						</motion.div>
					) : null}

					{/* 项目与设置菜单（WF5-04）：BYOK/用量、设计基座、主题收编于此。
					    遮罩＋圈闭沿用命令面板模式；锚定侧栏左下。 */}
					{projectMenuOpen ? (
						<motion.button
							key="project-menu-backdrop"
							type="button"
							aria-label="关闭项目与设置"
							onClick={() => setProjectMenuOpen(false)}
							initial="initial"
							animate="animate"
							exit="exit"
							variants={overlayBackdropMotion}
							className="ui-plain fixed inset-0 bg-[rgba(10,10,12,0.55)] cursor-default z-90"
						/>
					) : null}
					{projectMenuOpen ? (
						<motion.div
							key="project-menu-panel"
							ref={projectMenuRef}
							role="dialog"
							aria-modal="true"
							aria-label="项目与设置"
							initial="initial"
							animate="animate"
							exit="exit"
							variants={modalPanelVariants}
							className="fixed bottom-12 left-3 w-60 bg-rail border border-line rounded-lg overflow-hidden shadow-nw z-91 py-1.5"
						>
							{TOOL_KEYS.map((tool) => {
								const Icon = tool === "byok" ? Settings : Gem;
								const current = routeKey === tool;
								return (
									<button
										key={tool}
										type="button"
										aria-current={current ? "page" : undefined}
										onClick={() => navigate(tool)}
										className={cx(
											"ui-plain cursor-pointer flex items-center gap-2 w-full py-2 px-3.5 text-[12.5px] font-[inherit]",
											current
												? "text-accent-text font-semibold"
												: "text-ink-mid",
										)}
									>
										<Icon size={14} strokeWidth={1.8} aria-hidden />
										{TOOL_LABELS[tool]}
									</button>
								);
							})}
							<div className="my-1 border-t border-line" aria-hidden />
							<button
								type="button"
								onClick={() => {
									const next = theme === "dark" ? "light" : "dark";
									setTheme(next);
									setThemeState(next);
								}}
								className="ui-plain cursor-pointer flex items-center gap-2 w-full py-2 px-3.5 text-[12.5px] text-ink-mid font-[inherit]"
							>
								<span aria-hidden className="w-3.5 text-center">
									{theme === "dark" ? (
										<Sun size={14} aria-hidden="true" />
									) : (
										<Moon size={14} aria-hidden="true" />
									)}
								</span>
								{theme === "dark" ? "切换浅色主题" : "切换深色主题"}
							</button>
						</motion.div>
					) : null}
				</AnimatePresence>
			</div>
		</AssistantProvider>
	);
}

/** IDE 式工作区壳（WF2-01/02）：顶栏 / 左导航·中主区·右面板 / 底栏；cwd 由启动页选定。
 *  initialTarget（WF5-05）：启动页续写目标决定打开项目后的落点路由。 */
export function AppShell({
	cwd,
	initialTarget,
	onHome,
}: {
	cwd: string;
	initialTarget?: ResumeTarget | null;
	onHome: () => void;
}) {
	return (
		<WorkspaceProvider>
			<ShellChrome
				cwd={cwd}
				initialTarget={initialTarget ?? null}
				onHome={onHome}
			/>
		</WorkspaceProvider>
	);
}
