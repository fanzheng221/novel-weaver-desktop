import { open } from "@tauri-apps/plugin-dialog";
import { BookOpen, FolderOpen, Plus, Search } from "lucide-react";
import { AppMark } from "../../shared/ui/icons";
import { LicenseButton } from "../../shared/ui/LicenseButton";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { authorErrorMessage, defaultProjectPath, queryProject } from "../../shared/api/rpc";
import { loadResumeSceneId, saveResumeSceneId } from "../../features/writing/draft-store";
import { Button, Chip, EmptyState } from "../../shared/ui/components";
import { EMPTY, LAUNCHER } from "../../shared/ui/copy";
import { cx } from "../../shared/ui/cx";
import { useModalFocus } from "../../shared/ui/focus";
import {
	cardWallContainerVariants,
	cardWallItemVariants,
	viewEnterTransition,
	viewEnterVariants,
} from "../../shared/ui/motion";
import { FirstRunWizard } from "../../features/settings/wizard/first-run-wizard";
import { SemanticExtensionPanel } from "../../features/settings/SemanticExtensionPanel";
import {
	addToRegistry,
	getRegistry,
	markOpened,
	type RegistryEntry,
	removeFromRegistry,
} from "./project-registry";
import {
	type ResumeProjection,
	type ResumeTarget,
	resolveResumeTarget,
} from "./resume";

interface ProjectStatusLite {
	name: string;
	primaryLanguage: string;
	canonicalSceneCount: number;
}

/** 项目封面完整视图（WF6-06）：与 core 的 ProjectCoverView 同形。 */
interface CoverView {
	mime: string;
	width: number | null;
	height: number | null;
	updatedAt: string;
	base64: string;
}

interface CardStats {
	state: "loading" | "ready" | "unreachable";
	name: string;
	language: string;
	chapters: number | null;
	scenes: number | null;
	lastEditedAt: number | null;
	target: ResumeTarget | null;
	cover: CoverView | null;
}

const LOADING_STATS: CardStats = {
	state: "loading",
	name: "",
	language: "",
	chapters: null,
	scenes: null,
	lastEditedAt: null,
	target: null,
	cover: null,
};

function relativeTime(timestamp: number): string {
	const diff = Date.now() - timestamp;
	const minute = 60_000;
	const hour = 3_600_000;
	const day = 86_400_000;
	if (diff < minute) return "刚刚";
	if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
	if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
	if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
	const at = new Date(timestamp);
	return `${at.getMonth() + 1} 月 ${at.getDate()} 日`;
}

function BookCard({
	entry,
	stats,
	onOpen,
	onRemove,
	onCoverChange,
}: {
	entry: RegistryEntry;
	stats: CardStats;
	onOpen: (target: ResumeTarget | null) => void;
	onRemove: () => void;
	onCoverChange: (cover: CoverView | null) => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const [coverBroken, setCoverBroken] = useState(false);
	const [coverError, setCoverError] = useState<string | null>(null);
	const unreachable = stats.state === "unreachable";
	const confirmDialogRef = useModalFocus<HTMLDivElement>(confirming);
	// 主操作即续写目标（WF5-05）；投影未就绪时确定性回落普通打开。
	const primaryLabel = stats.target?.actionLabel ?? LAUNCHER.openAction;
	const coverUsable = stats.cover !== null && !coverBroken;

	// 封面更新（上传/替换）后复位坏图回落，换封面重新接受 onError 检验。
	useEffect(() => {
		setCoverBroken(false);
	}, [stats.cover?.updatedAt]);

	const pickCover = async () => {
		const picked = await open({
			multiple: false,
			title: LAUNCHER.coverPickTitle,
			filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
		});
		if (typeof picked !== "string" || !picked) return;
		try {
			const view = await queryProject<CoverView>(entry.path, "set_project_cover", {
				sourcePath: picked,
			});
			onCoverChange(view);
			setCoverError(null);
		} catch (error) {
			setCoverError(authorErrorMessage(error));
		}
	};

	const removeCover = async () => {
		try {
			await queryProject(entry.path, "remove_project_cover", {});
			onCoverChange(null);
			setCoverError(null);
		} catch (error) {
			setCoverError(authorErrorMessage(error));
		}
	};

	useEffect(() => {
		if (!confirming) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			setConfirming(false);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [confirming]);

	return (
		<motion.article
			className={cx(
				"book-card t-fast lift-bordered",
				"relative flex flex-col overflow-hidden rounded-lg border border-line bg-panel",
				unreachable && "opacity-[0.55]",
			)}
			variants={cardWallItemVariants}
			whileHover={unreachable || confirming ? undefined : { y: -1 }}
			aria-busy={stats.state === "loading" || undefined}
			aria-label={`书籍：${stats.name || entry.path}`}
		>
			{/* A quiet book motif keeps untitled covers independent of font glyphs.
			    自定义封面（WF6-06）：object-cover 适配固定比例，坏图/无图回落占位。 */}
			<div className="paper relative grid place-items-center h-24 border-b border-paper-line bg-accent-soft">
				{coverUsable ? (
					<img
						src={`data:${stats.cover?.mime};base64,${stats.cover?.base64}`}
						alt=""
						onError={() => setCoverBroken(true)}
						className="absolute inset-0 h-full w-full object-cover"
					/>
				) : (
					<BookOpen size={44} strokeWidth={1.4} className="text-accent" aria-hidden="true" />
				)}
				{stats.state === "ready" ? (
					<div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 p-1">
						{coverError ? (
							<span
								title={coverError}
								className="mr-auto max-w-40 truncate text-[10px] text-ink-low"
							>
								{coverError}
							</span>
						) : null}
						<button
							type="button"
							onClick={() => void pickCover()}
							className="rounded-sm border border-line bg-panel/80 px-1.5 py-0.5 text-[10px] text-ink-mid hover:bg-accent-soft hover:text-ink-hi"
						>
							{coverUsable ? LAUNCHER.coverReplaceAction : LAUNCHER.coverSetAction}
						</button>
						{coverUsable ? (
							<button
								type="button"
								onClick={() => void removeCover()}
								className="rounded-sm border border-line bg-panel/80 px-1.5 py-0.5 text-[10px] text-ink-mid hover:bg-accent-soft hover:text-ink-hi"
							>
								{LAUNCHER.coverRemoveAction}
							</button>
						) : null}
					</div>
				) : null}
			</div>

			<div className="grid gap-1 px-3 pt-2 pb-3">
				{stats.state === "loading" ? (
					<>
						<span className="sk" style={{ height: 13, width: "62%" }} />
						<span className="sk" style={{ height: 12, width: "45%" }} />
						<span className="sk" style={{ height: 10, width: "38%" }} />
					</>
				) : (
					<>
						<b
							title={stats.name || entry.path}
							className="font-wenkai text-[15px] font-semibold text-ink-hi whitespace-nowrap overflow-hidden text-ellipsis"
						>
							{unreachable
								? entry.path.split("/").pop() || entry.path
								: stats.name}
						</b>
						{unreachable ? (
							<span className="text-[10.5px] text-ink-low leading-[1.6]">
								{LAUNCHER.unreachable}
							</span>
						) : (
							<div className="flex gap-1 items-center flex-wrap">
								{stats.language ? <Chip>{stats.language}</Chip> : null}
								<span className="num text-[11px] text-ink-mid">
									{stats.chapters ?? "—"} 章 · {stats.scenes ?? "—"} 场景
								</span>
							</div>
						)}
						<span
							title={entry.path}
							className="text-[10px] text-ink-low whitespace-nowrap overflow-hidden text-ellipsis"
						>
							{stats.target?.cardNote ??
								(stats.lastEditedAt
									? `${relativeTime(stats.lastEditedAt)}编辑`
									: entry.lastOpenedAt > 0
										? "尚无确认章节"
										: entry.path)}
						</span>
					</>
				)}
			</div>

			<div className="grid gap-2 px-3 pb-3 mt-auto">
				<Button
					variant="primary"
					onClick={() => onOpen(stats.target)}
					disabled={unreachable}
				>
					<span
						className="block max-w-47.5 whitespace-nowrap overflow-hidden text-ellipsis"
						title={primaryLabel}
					>
						{primaryLabel}
					</span>
				</Button>
				<div className="flex items-center gap-2">
					<Button onClick={() => onOpen(null)}><FolderOpen size={16} aria-hidden="true" />{LAUNCHER.openAction}</Button>
					<Button onClick={() => setConfirming(true)}>
						{LAUNCHER.removeLabel}
					</Button>
				</div>
			</div>

			{confirming ? (
				/* 确认层与卡片操作区分离；焦点圈闭并于关闭时归还移除按钮（WF3-11）。 */
				<div className="absolute inset-0 grid place-items-center bg-[rgba(23,24,26,0.92)] p-3">
					<div
						ref={confirmDialogRef}
						role="dialog"
						aria-modal="true"
						aria-label={LAUNCHER.removeConfirmTitle}
						className="text-center"
					>
						<p className="m-0 mb-0.5 text-[12.5px] text-ink-hi">
							{LAUNCHER.removeConfirmTitle}
						</p>
						<p className="m-0 mb-2 text-[10.5px] text-ink-low">
							{LAUNCHER.removeConfirmBody}
						</p>
						<div className="flex gap-1 justify-center">
							<Button variant="primary" onClick={onRemove}>
								{LAUNCHER.removeLabel}
							</Button>
							<Button onClick={() => setConfirming(false)}>留下</Button>
						</div>
					</div>
				</div>
			) : null}
		</motion.article>
	);
}

/** 启动页与多书卡片墙（WF2-02）：注册表驱动，core 零改动。
 *  WF5-05：卡片主操作即续写目标，落点路由与场景由目标决定。 */
export function Launcher({
	onOpen,
}: {
	onOpen: (cwd: string, target: ResumeTarget | null) => void;
}) {
	const [entries, setEntries] = useState<RegistryEntry[]>(() => getRegistry());
	const [stats, setStats] = useState<Record<string, CardStats>>({});
	const [query, setQuery] = useState("");
	const [wizardCwd, setWizardCwd] = useState<string | null>(null);

	const refresh = useCallback(() => setEntries(getRegistry()), []);

	// 首启把检测到的默认项目静默登记进书架（延续旧版直进体验）。
	// 已在书架的书由卡片统计自行拉取，此处跳过探测——每次 RPC 都会 spawn 核心进程（WF3-01）。
	useEffect(() => {
		void (async () => {
			try {
				const detected = await defaultProjectPath();
				if (getRegistry().some((entry) => entry.path === detected)) return;
				await queryProject<ProjectStatusLite>(detected, "project_status", {});
				const before = getRegistry().length;
				addToRegistry(detected);
				if (getRegistry().length !== before) setEntries(getRegistry());
			} catch {
				/* 默认目录没有项目：书架保持现状 */
			}
		})();
	}, []);

	// 卡片实时数据：每本书只读调用并行拉取，失败即不可达态。
	// 续写目标（WF5-05）与统计同源：投影失败时卡面退回普通打开，不挡作者进门。
	// 封面（WF6-06）单独失败只回落占位，不连坐可达性。
	useEffect(() => {
		let cancelled = false;
		for (const entry of entries) {
			setStats((prev) =>
				prev[entry.path]?.state === "loading" || prev[entry.path] === undefined
					? { ...prev, [entry.path]: prev[entry.path] ?? LOADING_STATS }
					: prev,
			);
			void (async () => {
				try {
					const [status, projection, cover] = await Promise.all([
						queryProject<ProjectStatusLite>(entry.path, "project_status", {}),
						queryProject<ResumeProjection>(
							entry.path,
							"get_resume_target",
							{},
						).catch(() => null),
						queryProject<CoverView | null>(
							entry.path,
							"get_project_cover",
							{},
						).catch(() => null),
					]);
					if (cancelled) return;
					setStats((prev) => ({
						...prev,
						[entry.path]: {
							state: "ready",
							name: status.name,
							language: status.primaryLanguage,
							scenes: status.canonicalSceneCount,
							chapters: projection ? projection.chapterPlanCount : null,
							lastEditedAt: projection?.latestConfirmedAt
								? Date.parse(projection.latestConfirmedAt)
								: null,
							target: projection
								? resolveResumeTarget(projection, loadResumeSceneId(entry.path))
								: null,
							cover: cover ?? null,
						},
					}));
				} catch {
					if (!cancelled) {
						setStats((prev) => ({
							...prev,
							[entry.path]: { ...LOADING_STATS, state: "unreachable" },
						}));
					}
				}
			})();
		}
		return () => {
			cancelled = true;
		};
	}, [entries]);

	const openBook = (path: string, target: ResumeTarget | null = null) => {
		addToRegistry(path);
		markOpened(path);
		// 续写目标点名场景时先落持久记忆：写作台挂载据此恢复选中（WF5-05）。
		if (target?.sceneId) saveResumeSceneId(path, target.sceneId);
		setEntries(getRegistry());
		onOpen(path, target);
	};

	const createNew = async () => {
		const picked = await open({
			directory: true,
			multiple: false,
			title: LAUNCHER.pickDirectoryTitle,
		});
		if (typeof picked !== "string" || !picked) return;
		const alreadyProject = await queryProject(picked, "project_status", {})
			.then(() => true)
			.catch(() => false);
		if (alreadyProject) {
			openBook(picked);
			return;
		}
		setWizardCwd(picked);
	};

	const removeBook = (path: string) => {
		removeFromRegistry(path);
		refresh();
	};

	const finishWizard = (path: string) => {
		setWizardCwd(null);
		openBook(path);
	};

	const searching = query.trim().length > 0;
	const needle = query.trim().toLowerCase();
	const filtered = entries.filter(
		(entry) =>
			!searching ||
			(stats[entry.path]?.name ?? "").toLowerCase().includes(needle) ||
			entry.path.toLowerCase().includes(needle),
	);
	const recents = searching
		? []
		: [...filtered]
				.filter((entry) => entry.lastOpenedAt > 0)
				.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
				.slice(0, 3);
	const rest = searching
		? filtered
		: filtered.filter((entry) => !recents.includes(entry));

	const renderGrid = (list: RegistryEntry[]) => (
		/* 卡片墙入场 stagger（WF3-06②）：仅启动页/模板库/看板使用 */
		<motion.div
			variants={cardWallContainerVariants}
			initial="hidden"
			animate="show"
			className="grid grid-cols-[repeat(auto-fill,minmax(216px,1fr))] gap-3"
		>
			{list.map((entry) => (
				<BookCard
					key={entry.path}
					entry={entry}
					stats={stats[entry.path] ?? LOADING_STATS}
					onOpen={(target) => openBook(entry.path, target)}
					onRemove={() => removeBook(entry.path)}
					onCoverChange={(cover) =>
						setStats((prev) => {
							const current = prev[entry.path];
							if (!current) return prev;
							return { ...prev, [entry.path]: { ...current, cover } };
						})
					}
				/>
			))}
		</motion.div>
	);

	return (
		<div className="min-h-screen bg-shell text-ink-hi pt-12 px-8 pb-16">
			{/* 启动页入场淡入＋上移（WF3-06①）；卡片墙 stagger 见 renderGrid */}
			<motion.div
				initial="initial"
				animate="animate"
				variants={viewEnterVariants}
				transition={viewEnterTransition}
				className="mx-auto max-w-255 grid gap-6"
			>
				{/* 品牌行 */}
				<header className="flex items-center gap-3">
					<AppMark size={44} />
					<div>
						<h1 className="font-wenkai text-title font-semibold m-0">
							{LAUNCHER.brand}
						</h1>
						<p className="eyebrow mx-0 mt-1 mb-0">NOVEL WEAVER</p>
					</div>
					<Button variant="primary" onClick={() => void createNew()}>
						<Plus size={16} aria-hidden="true" /> {LAUNCHER.newAction}
					</Button>
					<LicenseButton />
				</header>

				<SemanticExtensionPanel firstRun />
				{/* 搜索 */}
				<div className="relative">
				<Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-3 text-ink-low" />
				<input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={LAUNCHER.searchPlaceholder}
					aria-label="搜索书架"
					className="w-full h-9.5 rounded-md border border-line bg-rail text-ink-hi text-body pl-9 pr-3 py-0 outline-none font-[inherit]"
				/>
				</div>

				{entries.length === 0 ? (
					<EmptyState
						as="h2"
						glyph={EMPTY.launcher.glyph}
						title={EMPTY.launcher.title}
						hint={EMPTY.launcher.hint}
						actions={
							<Button variant="primary" onClick={() => void createNew()}>
								<Plus size={16} aria-hidden="true" /> {LAUNCHER.newAction}
							</Button>
						}
					/>
				) : filtered.length === 0 ? (
					<p className="text-[12px] text-ink-low text-center">
						没有匹配「{query}」的书。
					</p>
				) : (
					<>
						{recents.length > 0 ? (
							<section className="grid gap-2">
								<p className="eyebrow m-0">{LAUNCHER.recentSection}</p>
								{renderGrid(recents)}
							</section>
						) : null}
						{rest.length > 0 ? (
							<section className="grid gap-2">
								{recents.length > 0 ? (
									<p className="eyebrow m-0">{LAUNCHER.allSection}</p>
								) : null}
								{renderGrid(rest)}
							</section>
						) : null}
					</>
				)}
			</motion.div>

			{/* 首启向导进出场（WF3-06④）：display:contents 壳承载 AnimatePresence 退场 */}
			<AnimatePresence>
				{wizardCwd ? (
					<motion.div key={`wizard-${wizardCwd}`} className="contents">
						<FirstRunWizard
							cwd={wizardCwd}
							onFinished={() => finishWizard(wizardCwd)}
						/>
					</motion.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}
