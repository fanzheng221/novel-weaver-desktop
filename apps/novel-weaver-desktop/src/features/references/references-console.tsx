import { open } from "@tauri-apps/plugin-dialog";
import { BookOpen, Check, Inbox, Plus, RefreshCw, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { authorErrorMessage, queryProject } from "../../shared/api/rpc";
import {
	Button,
	Chip,
	EmptyState,
	InlineNote,
	PAGE,
	Panel,
	TextField,
} from "../../shared/ui/components";
import { cx } from "../../shared/ui/cx";
import { useModalFocus } from "../../shared/ui/focus";
import {
	describeRpcError,
	ErrorState,
	SkeletonLines,
	useDelayedFlag,
} from "../../shared/ui/states";
import {
	activeProviderOf,
	type ByokProvider,
	loadByokConfig,
} from "../writing/assistant/gateway";

/**
 * 风格参考控制台（WF6-05，WF6-10 裁决落点 A）：规划区单页形态——
 * 书架横排卡片＋选中书纵向铺开 切分预览 / 分析 / 统计报告 三段。
 * 分析是长任务（ADR-0041）：run 落库在核心，桌面只驱动 step 循环；
 * 切离子区再回由 list_reference_book_analysis_runs 无副作用恢复现场。
 * 参考书永不进正典与生成素材（ADR-0019）；产出经审校收件箱提案链裁决。
 */

interface ReferenceBookSummaryView {
	id: string;
	title: string;
	sourceFilename: string;
	totalChars: number;
	chapterCount: number;
	splitMode: "heading" | "fallback_size";
	createdAt: string;
}

interface ReferenceChapterIndexView {
	chapterIndex: number;
	title: string;
	charCount: number;
}

interface ReferenceBookDetailView extends ReferenceBookSummaryView {
	chapters: ReferenceChapterIndexView[];
}

interface ReferenceImportResult extends ReferenceBookDetailView {
	warnings: string[];
}

interface AnalysisChapterStateView {
	chapterIndex: number;
	title: string;
	status: "ok" | "failed" | "pending";
	error: string | null;
}

interface AnalysisRunView {
	runId: string;
	bookId: string;
	bookTitle: string;
	status: "running" | "analyzed" | "completed";
	chaptersTotal: number;
	chaptersDone: number;
	chaptersFailed: number;
	chapters: AnalysisChapterStateView[];
	createdAt: string;
	updatedAt: string;
	proposalIds: string[];
	warnings: string[];
}

interface StatsChapterView {
	chapterIndex: number;
	title: string;
	charCount: number;
	dialogueRatio: number;
	endsWithHook: boolean;
}

interface StatsView {
	bookId: string;
	title: string;
	chapterCount: number;
	totalChars: number;
	chapterCharCounts: number[];
	dialogueRatio: number;
	sentenceLengthSummary: { min: number; median: number; max: number };
	chapterEndHookRate: number;
	chapters: StatsChapterView[];
}

function basenameOf(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] ?? path;
}

function wanChars(total: number): string {
	return `${(total / 10000).toFixed(1)} 万字`;
}

/** 桌面 step 驱动循环的单批章数：控制单次 RPC 时长（每章一次模型调用）。 */
const STEP_BATCH = 2;

export function ReferencesConsole({
	cwd,
	onNavigate,
}: {
	cwd: string;
	onNavigate: (route: "review" | "byok") => void;
}) {
	const [books, setBooks] = useState<ReferenceBookSummaryView[]>([]);
	const [runs, setRuns] = useState<AnalysisRunView[]>([]);
	const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
	const showSkeleton = useDelayedFlag(phase === "loading");
	const [loadError, setLoadError] = useState<ReturnType<
		typeof describeRpcError
	> | null>(null);
	const [note, setNote] = useState<{
		tone: "danger" | "success";
		text: string;
	} | null>(null);

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detail, setDetail] = useState<ReferenceBookDetailView | null>(null);
	const [stats, setStats] = useState<StatsView | null>(null);
	const [detailBusy, setDetailBusy] = useState(false);
	const detailEpoch = useRef(0);

	// BYOK 服务商（与写作助手同源：localStorage 配置＋钥匙串 Key）。
	const provider = useMemo<ByokProvider | null>(
		() => activeProviderOf(loadByokConfig()) ?? null,
		[],
	);

	// step 驱动停摆集合：一批零进展（如 Key 失效）即停，等作者显式重试。
	const [stalled, setStalled] = useState<ReadonlySet<string>>(new Set());
	const steppingRef = useRef(false);

	const [importOpen, setImportOpen] = useState(false);
	const importPanelRef = useModalFocus<HTMLDivElement>(importOpen);
	const [importPath, setImportPath] = useState("");
	const [importTitle, setImportTitle] = useState("");
	const [importing, setImporting] = useState(false);
	const [resplitting, setResplitting] = useState(false);
	const [starting, setStarting] = useState(false);
	const [summarizing, setSummarizing] = useState(false);

	const loadAll = async () => {
		setLoadError(null);
		try {
			const [bookRows, runRows] = await Promise.all([
				queryProject<ReferenceBookSummaryView[]>(
					cwd,
					"list_reference_books",
					{},
				),
				queryProject<AnalysisRunView[]>(
					cwd,
					"list_reference_book_analysis_runs",
					{},
				),
			]);
			setBooks(bookRows);
			setRuns(runRows);
			setPhase("ready");
		} catch (raw) {
			setLoadError(describeRpcError(raw));
			setPhase("failed");
		}
	};

	useEffect(() => {
		void loadAll();
		// biome-ignore lint/correctness/useExhaustiveDependencies: loadAll 只依赖 cwd，挂载时执行一次
	}, [loadAll]);

	// 选中书：详情（章切分索引）与统计（纯读现算）并行拉取；换书作废旧响应。
	useEffect(() => {
		const epoch = detailEpoch.current + 1;
		detailEpoch.current = epoch;
		setDetail(null);
		setStats(null);
		if (!selectedId) return;
		setDetailBusy(true);
		Promise.all([
			queryProject<ReferenceBookDetailView>(cwd, "get_reference_book", {
				bookId: selectedId,
			}),
			queryProject<StatsView>(cwd, "get_reference_book_stats", {
				bookId: selectedId,
			}),
		])
			.then(([detailView, statsView]) => {
				if (detailEpoch.current !== epoch) return;
				setDetail(detailView);
				setStats(statsView);
			})
			.catch((raw) => {
				if (detailEpoch.current !== epoch) return;
				setNote({ tone: "danger", text: authorErrorMessage(raw) });
			})
			.finally(() => {
				if (detailEpoch.current === epoch) setDetailBusy(false);
			});
	}, [selectedId, cwd]);

	const activeRunOf = (bookId: string): AnalysisRunView | null =>
		runs.find((run) => run.bookId === bookId && run.status !== "completed") ??
		runs.find((run) => run.bookId === bookId && run.status === "completed") ??
		null;

	const selectedBook = books.find((book) => book.id === selectedId) ?? null;
	const selectedRun = selectedId ? activeRunOf(selectedId) : null;

	// step 驱动循环（ADR-0041 桌面半）：有 running 且未停摆的 run 就推进一批；
	// 批内零进展（坏 Key/网络断）即停摆，作者点「继续重试」恢复。
	useEffect(() => {
		const target = runs.find(
			(run) => run.status === "running" && !stalled.has(run.runId),
		);
		if (!target || steppingRef.current || !provider) return;
		steppingRef.current = true;
		queryProject<AnalysisRunView>(cwd, "step_reference_book_analysis", {
			runId: target.runId,
			maxChapters: STEP_BATCH,
			providerId: provider.id,
			adapter: provider.adapter ?? "openai_chat",
			requestOptions: provider.requestOptions,
			baseURL: provider.baseURL,
			modelId: provider.modelId,
		})
			.then((view) => {
				setRuns((previous) =>
					previous.map((run) => (run.runId === view.runId ? view : run)),
				);
				if (view.chaptersDone <= target.chaptersDone) {
					setStalled((previous) => new Set(previous).add(view.runId));
				} else if (view.status === "analyzed") {
					setNote({
						tone: "success",
						text: `《${view.bookTitle}》各章分析完成，可以汇总送审。`,
					});
				}
			})
			.catch((raw) => {
				setStalled((previous) => new Set(previous).add(target.runId));
				setNote({ tone: "danger", text: authorErrorMessage(raw) });
			})
			.finally(() => {
				steppingRef.current = false;
			});
	}, [runs, stalled, provider, cwd]);

	const resumeStalled = (runId: string) => {
		setStalled((previous) => {
			const next = new Set(previous);
			next.delete(runId);
			return next;
		});
	};

	const startAnalysis = async (book: ReferenceBookSummaryView) => {
		if (!provider) {
			setNote({
				tone: "danger",
				text: "还没有可用的模型接入——先配置 BYOK 再发起分析。",
			});
			return;
		}
		setStarting(true);
		setNote(null);
		try {
			const view = await queryProject<AnalysisRunView>(
				cwd,
				"start_reference_book_analysis",
				{ bookId: book.id },
			);
			setRuns((previous) => [
				view,
				...previous.filter((run) => run.runId !== view.runId),
			]);
		} catch (raw) {
			setNote({ tone: "danger", text: authorErrorMessage(raw) });
		} finally {
			setStarting(false);
		}
	};

	const cancelAnalysis = async (runId: string) => {
		try {
			await queryProject(cwd, "cancel_reference_book_analysis", { runId });
			setRuns((previous) => previous.filter((run) => run.runId !== runId));
			setStalled((previous) => {
				const next = new Set(previous);
				next.delete(runId);
				return next;
			});
			setNote({ tone: "success", text: "分析已取消，运行与章结果一并丢弃。" });
		} catch (raw) {
			setNote({ tone: "danger", text: authorErrorMessage(raw) });
		}
	};

	const summarize = async (run: AnalysisRunView) => {
		if (!provider) return;
		setSummarizing(true);
		setNote(null);
		try {
			const view = await queryProject<AnalysisRunView>(
				cwd,
				"summarize_reference_book_analysis",
				{
					runId: run.runId,
					providerId: provider.id,
					adapter: provider.adapter ?? "openai_chat",
					requestOptions: provider.requestOptions,
					baseURL: provider.baseURL,
					modelId: provider.modelId,
				},
			);
			setRuns((previous) =>
				previous.map((entry) => (entry.runId === view.runId ? view : entry)),
			);
			const traits = Math.max(view.proposalIds.length - 1, 0);
			setNote({
				tone: "success",
				text: `汇总完成：${traits} 条风格特征＋1 条节奏范本提案已送审校收件箱。`,
			});
		} catch (raw) {
			setNote({ tone: "danger", text: authorErrorMessage(raw) });
		} finally {
			setSummarizing(false);
		}
	};

	const resplit = async (mode: "heading" | "fallback_size") => {
		if (!selectedId) return;
		setResplitting(true);
		setNote(null);
		try {
			const view = await queryProject<ReferenceBookDetailView>(
				cwd,
				"resplit_reference_book",
				mode === "fallback_size"
					? { bookId: selectedId, mode, targetChars: 6000 }
					: { bookId: selectedId, mode },
			);
			setDetail(view);
			setBooks((previous) =>
				previous.map((book) =>
					book.id === view.id
						? {
								...book,
								chapterCount: view.chapterCount,
								totalChars: view.totalChars,
								splitMode: view.splitMode,
							}
						: book,
				),
			);
			setStats(null);
			void queryProject<StatsView>(cwd, "get_reference_book_stats", {
				bookId: view.id,
			})
				.then((statsView) => setStats(statsView))
				.catch(() => undefined);
			setNote({ tone: "success", text: `已重切为 ${view.chapterCount} 章。` });
		} catch (raw) {
			setNote({ tone: "danger", text: authorErrorMessage(raw) });
		} finally {
			setResplitting(false);
		}
	};

	const pickImportFile = async () => {
		const picked = await open({
			multiple: false,
			directory: false,
			title: "选择参考书文本文件",
			filters: [{ name: "文本文档", extensions: ["txt", "md", "markdown"] }],
		});
		if (typeof picked === "string" && picked) {
			setImportPath(picked);
			const name = basenameOf(picked).replace(/\.(txt|md|markdown)$/i, "");
			setImportTitle((current) => current || name);
		}
	};

	const submitImport = async () => {
		if (!importPath || !importTitle.trim()) return;
		setImporting(true);
		setNote(null);
		try {
			const imported = await queryProject<ReferenceImportResult>(
				cwd,
				"import_reference_book",
				{
					title: importTitle.trim(),
					sourceFilename: basenameOf(importPath),
					sourcePath: importPath,
				},
			);
			setBooks((previous) => [
				{
					id: imported.id,
					title: imported.title,
					sourceFilename: imported.sourceFilename,
					totalChars: imported.totalChars,
					chapterCount: imported.chapterCount,
					splitMode: imported.splitMode,
					createdAt: imported.createdAt,
				},
				...previous,
			]);
			setSelectedId(imported.id);
			setImportOpen(false);
			setImportPath("");
			setImportTitle("");
			setNote({
				tone: "success",
				text:
					imported.warnings.length > 0
						? `导入完成（${imported.warnings[0]}）`
						: `导入完成：${imported.chapterCount} 章 · ${wanChars(imported.totalChars)}。`,
			});
		} catch (raw) {
			setNote({ tone: "danger", text: authorErrorMessage(raw) });
		} finally {
			setImporting(false);
		}
	};

	const deleteBook = async (book: ReferenceBookSummaryView) => {
		if (activeRunOf(book.id)?.status !== "completed" && activeRunOf(book.id)) {
			setNote({
				tone: "danger",
				text: "这本书还有未完成的运行，先取消分析再删除。",
			});
			return;
		}
		try {
			await queryProject(cwd, "delete_reference_book", { bookId: book.id });
			setBooks((previous) => previous.filter((entry) => entry.id !== book.id));
			setRuns((previous) => previous.filter((run) => run.bookId !== book.id));
			if (selectedId === book.id) {
				setSelectedId(null);
				setDetail(null);
				setStats(null);
			}
			setNote({
				tone: "success",
				text: `《${book.title}》已删除（原文与运行一并清理）。`,
			});
		} catch (raw) {
			setNote({ tone: "danger", text: authorErrorMessage(raw) });
		}
	};

	if (phase === "failed" && loadError) {
		return (
			<main className={PAGE}>
				<header>
					<p className="eyebrow">NOVEL WEAVER / REFERENCES</p>
					<h1 className="font-wenkai text-[22px] mt-0.5 mb-0">风格参考</h1>
				</header>
				<ErrorState
					message={loadError.message}
					detail={loadError.detail}
					onRetry={() => void loadAll()}
				/>
			</main>
		);
	}

	return (
		<main className={PAGE}>
			<header>
				<p className="eyebrow">NOVEL WEAVER / REFERENCES</p>
				<h1 className="font-wenkai text-[22px] mt-0.5 mb-0">风格参考</h1>
				<p className="m-0 text-[12px] leading-[1.75] text-ink-mid">
					导入参考作品，跑双轨分析（本地统计＋分章理解），产出的提案在审校收件箱裁决后沉淀为风格特征与节奏范本；参考书只作分析源，永不进正典（ADR-0019）。
				</p>
			</header>

			{note ? <InlineNote tone={note.tone}>{note.text}</InlineNote> : null}

			{phase === "loading" && showSkeleton ? <SkeletonLines lines={4} /> : null}

			{phase === "ready" ? (
				<>
					<section aria-label="书架">
						<div className="eyebrow text-ink-low mb-2">书架</div>
						{books.length === 0 ? (
							<EmptyState
								glyph="book"
								title="还没有参考书"
								hint="导入一本 TXT/MD 参考作品开始喂书分析；分析源永不进正典与生成素材。"
								actions={
									<Button variant="primary" onClick={() => setImportOpen(true)}>
										导入 TXT / MD
									</Button>
								}
							/>
						) : (
							<div className="flex flex-wrap gap-2">
								{books.map((book) => (
									<BookCard
										key={book.id}
										book={book}
										run={activeRunOf(book.id)}
										selected={book.id === selectedId}
										onSelect={() => setSelectedId(book.id)}
									/>
								))}
								<button
									type="button"
									onClick={() => setImportOpen(true)}
									className="ui-plain cursor-pointer rounded-sm border border-dashed border-line px-3 py-2.5 grid place-items-center gap-1 min-w-44 text-ink-low hover:text-ink-mid"
								>
									<Plus size={14} strokeWidth={2} aria-hidden />
									<span className="text-[11.5px]">导入 TXT / MD</span>
								</button>
							</div>
						)}
					</section>

					{selectedBook ? (
						<div className="grid gap-3">
							<SplitSection
								detail={detail}
								busy={detailBusy}
								resplitting={resplitting}
								locked={
									selectedRun?.status === "running" ||
									selectedRun?.status === "analyzed"
								}
								onResplit={(mode) => void resplit(mode)}
								onDelete={() => void deleteBook(selectedBook)}
							/>
							<AnalysisSection
								book={selectedBook}
								run={selectedRun}
								stalled={selectedRun ? stalled.has(selectedRun.runId) : false}
								providerReady={provider !== null}
								starting={starting}
								summarizing={summarizing}
								onStart={() => void startAnalysis(selectedBook)}
								onCancel={(runId) => void cancelAnalysis(runId)}
								onSummarize={(run) => void summarize(run)}
								onResume={resumeStalled}
								onOpenByok={() => onNavigate("byok")}
								onGoReview={() => onNavigate("review")}
							/>
							<StatsSection
								stats={stats}
								busy={detailBusy}
								run={selectedRun}
								onGoReview={() => onNavigate("review")}
							/>
						</div>
					) : (
						<Panel title="风格参考">
							<p className="m-0 text-[12px] leading-[1.7] text-ink-low">
								从书架选择一本书查看切分、分析与统计报告，或导入新的 TXT/MD
								参考作品。
							</p>
						</Panel>
					)}
				</>
			) : null}

			{importOpen ? (
				<>
					<button
						type="button"
						aria-label="关闭导入"
						onClick={() => setImportOpen(false)}
						className="ui-plain fixed inset-0 bg-[rgba(10,10,12,0.55)] cursor-default z-90"
					/>
					<div
						ref={importPanelRef}
						role="dialog"
						aria-modal="true"
						aria-label="导入参考书"
						className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-105 max-w-[calc(100vw-24px)] bg-rail border border-line rounded-lg overflow-hidden shadow-nw z-91 p-4 grid gap-3"
					>
						<h2 className="m-0 font-wenkai text-[15px]">导入参考书</h2>
						<div className="flex items-center gap-2">
							<Button onClick={() => void pickImportFile()}>
								选择 TXT / MD 文件
							</Button>
							<span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-low">
								{importPath || "尚未选择文件"}
							</span>
						</div>
						<TextField
							label="书名"
							value={importTitle}
							onChange={setImportTitle}
							placeholder="如：长夜灯"
							hint="原文规范化后存入项目资产目录；SQLite 只记元数据与章切分索引。"
						/>
						<div className="flex items-center gap-2">
							<Button
								variant="primary"
								disabled={!importPath || !importTitle.trim()}
								busy={importing}
								onClick={() => void submitImport()}
							>
								{importing ? "导入中…" : "导入"}
							</Button>
							<Button onClick={() => setImportOpen(false)}>取消</Button>
						</div>
					</div>
				</>
			) : null}
		</main>
	);
}

// ---------- 书架卡片 ----------

function BookCard({
	book,
	run,
	selected,
	onSelect,
}: {
	book: ReferenceBookSummaryView;
	run: AnalysisRunView | null;
	selected: boolean;
	onSelect: () => void;
}) {
	const status =
		run?.status === "running"
			? `分析中 ${run.chaptersDone}/${run.chaptersTotal}`
			: run?.status === "analyzed"
				? "待汇总"
				: run?.status === "completed"
					? "已分析"
					: "未分析";
	return (
		<div className={cx("relative")}>
			<button
				type="button"
				onClick={onSelect}
				aria-current={selected ? "true" : undefined}
				className={cx(
					"ui-plain cursor-pointer text-left rounded-sm border px-3 py-2.5 grid gap-1 min-w-44",
					selected
						? "border-accent bg-accent-soft"
						: "border-line hover:bg-rail-active",
				)}
			>
				<span className="flex items-center gap-2">
					<BookOpen
						size={13}
						strokeWidth={1.8}
						aria-hidden
						className="flex-none text-ink-mid"
					/>
					<span className="text-[12.5px] font-semibold truncate">
						{book.title}
					</span>
				</span>
				<span className="flex items-center gap-1.5 text-[10.5px] text-ink-low">
					{book.chapterCount} 章 · {wanChars(book.totalChars)}
					<StatusChip
						tone={run?.status === "running" ? "running" : run ? "done" : "idle"}
					>
						{status}
					</StatusChip>
				</span>
			</button>
		</div>
	);
}

function StatusChip({
	tone,
	children,
}: {
	tone: "idle" | "running" | "done" | "failed" | "info";
	children: ReactNode;
}) {
	const toneClass: Record<string, string> = {
		idle: "text-ink-low border-line",
		running: "text-accent-text border-accent",
		done: "text-ink-mid border-line",
		failed: "text-danger border-[rgba(208,138,46,0.4)]",
		info: "text-ink-low border-line",
	};
	return (
		<span
			className={cx(
				"inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10.5px] whitespace-nowrap",
				toneClass[tone],
			)}
		>
			{children}
		</span>
	);
}

// ---------- 切分预览 ----------

function SplitSection({
	detail,
	busy,
	resplitting,
	locked,
	onResplit,
	onDelete,
}: {
	detail: ReferenceBookDetailView | null;
	busy: boolean;
	resplitting: boolean;
	locked: boolean;
	onResplit: (mode: "heading" | "fallback_size") => void;
	onDelete: () => void;
}) {
	return (
		<Panel
			title="切分预览"
			action={
				locked ? (
					<span className="inline-flex items-center gap-2">
						<span className="text-[10.5px] text-ink-low">
							分析进行中，不可重切
						</span>
						<Button size="compact" onClick={onDelete}>
							删除本书
						</Button>
					</span>
				) : (
					<span className="inline-flex items-center gap-1">
						<Button size="compact" onClick={onDelete}>
							删除本书
						</Button>
						<Button
							size="compact"
							disabled={!detail || resplitting}
							busy={resplitting}
							onClick={() => onResplit("heading")}
						>
							<span className="inline-flex items-center gap-1">
								<RefreshCw size={12} strokeWidth={2} />
								按标题重切
							</span>
						</Button>
						<Button
							size="compact"
							disabled={!detail || resplitting}
							busy={resplitting}
							onClick={() => onResplit("fallback_size")}
						>
							按字数重切（约 6000）
						</Button>
					</span>
				)
			}
		>
			{busy || !detail ? (
				<SkeletonLines lines={3} />
			) : (
				<div className="grid gap-2">
					<p className="m-0 text-[11.5px] leading-[1.7] text-ink-low">
						共 {detail.chapterCount} 章 · 合计 {wanChars(detail.totalChars)}
						；切分模式：
						{detail.splitMode === "heading" ? "章节标题" : "按字数兜底"}。
					</p>
					<div className="max-h-56 overflow-y-auto rounded-sm border border-line">
						{detail.chapters.map((chapter) => (
							<div
								key={chapter.chapterIndex}
								className="flex items-center gap-2 px-3 py-1.5 text-[12px] border-b border-line last:border-b-0"
							>
								<span className="w-6 flex-none text-ink-low text-[10.5px] text-right">
									{chapter.chapterIndex}
								</span>
								<span className="min-w-0 flex-1 truncate">{chapter.title}</span>
								<span className="flex-none text-ink-low text-[11px]">
									{chapter.charCount.toLocaleString()} 字
								</span>
							</div>
						))}
					</div>
				</div>
			)}
		</Panel>
	);
}

// ---------- 分析段 ----------

function AnalysisSection({
	book,
	run,
	stalled,
	providerReady,
	starting,
	summarizing,
	onStart,
	onCancel,
	onSummarize,
	onResume,
	onOpenByok,
	onGoReview,
}: {
	book: ReferenceBookSummaryView;
	run: AnalysisRunView | null;
	stalled: boolean;
	providerReady: boolean;
	starting: boolean;
	summarizing: boolean;
	onStart: () => void;
	onCancel: (runId: string) => void;
	onSummarize: (run: AnalysisRunView) => void;
	onResume: (runId: string) => void;
	onOpenByok: () => void;
	onGoReview: () => void;
}) {
	if (run?.status === "running") {
		const total = run.chaptersTotal;
		const done = run.chaptersDone;
		const pct = total > 0 ? Math.round((done / total) * 100) : 0;
		const current = run.chapters.find(
			(chapter) => chapter.status === "pending",
		);
		const failed = run.chapters.filter(
			(chapter) => chapter.status === "failed",
		);
		return (
			<Panel title="分析进行中">
				<div className="grid gap-3">
					<div className="flex items-center gap-2 flex-wrap">
						<StatusChip tone="running">分批推进中</StatusChip>
						<span className="text-[12.5px] font-semibold">
							章 {done}/{total}
						</span>
						{current ? (
							<span className="text-[11.5px] text-ink-low truncate">
								当前：{current.title}
							</span>
						) : null}
						<span className="ml-auto">
							<Button size="compact" onClick={() => onCancel(run.runId)}>
								<span className="inline-flex items-center gap-1">
									<X size={12} strokeWidth={2} />
									取消分析
								</span>
							</Button>
						</span>
					</div>
					<div
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={total}
						aria-valuenow={done}
						aria-label="分析进度"
						className="h-1.5 rounded-sm overflow-hidden bg-rail-active"
					>
						<div className="h-full bg-accent" style={{ width: `${pct}%` }} />
					</div>
					{failed.length > 0 ? (
						<div className="rounded-sm border border-accent px-3 py-2 text-[11.5px] leading-[1.7] grid gap-1">
							{failed.map((chapter) => (
								<div
									key={chapter.chapterIndex}
									className="flex items-start gap-2"
								>
									<StatusChip tone="failed">{chapter.title}</StatusChip>
									<span className="min-w-0 text-ink-mid">
										{chapter.error ?? "模型调用失败"}
									</span>
								</div>
							))}
							{stalled ? (
								<div className="flex items-center gap-2">
									<span className="text-ink-low">
										自动推进已暂停（同一批未取得新进展）；批内其余章不受影响。
									</span>
									<Button size="compact" onClick={() => onResume(run.runId)}>
										继续重试
									</Button>
								</div>
							) : (
								<span className="text-ink-low">
									失败章会在后续批次自动重试；单章失败不中断批内其余章。
								</span>
							)}
						</div>
					) : null}
					<p className="m-0 text-[11px] leading-[1.7] text-ink-low">
						分析以运行为单位落库推进：切到别的子区再回来，进度仍在。
					</p>
				</div>
			</Panel>
		);
	}
	if (run?.status === "analyzed") {
		return (
			<Panel title="分析">
				<div className="grid gap-2">
					<div className="flex items-center gap-2 flex-wrap">
						<StatusChip tone="done">
							<Check size={10} strokeWidth={2.4} />
							各章分析完成
						</StatusChip>
						<span className="text-[11.5px] text-ink-low">
							汇总轮会聚合各章结果与确定性统计报告，生成风格特征与节奏范本提案送审。
						</span>
						<span className="ml-auto">
							<Button
								variant="primary"
								busy={summarizing}
								onClick={() => onSummarize(run)}
							>
								{summarizing ? "汇总中…" : "汇总送审"}
							</Button>
						</span>
					</div>
					{run.warnings.length > 0 ? (
						<ul className="m-0 pl-4 text-[11px] leading-[1.7] text-ink-low">
							{run.warnings.map((warning) => (
								<li key={warning}>{warning}</li>
							))}
						</ul>
					) : null}
				</div>
			</Panel>
		);
	}
	if (run?.status === "completed") {
		const traits = Math.max(run.proposalIds.length - 1, 0);
		return (
			<Panel title="分析">
				<div className="rounded-sm border border-line bg-rail px-3 py-2 flex items-center gap-2 flex-wrap">
					<Inbox
						size={13}
						strokeWidth={1.8}
						aria-hidden
						className="text-accent-text"
					/>
					<span className="text-[12px] leading-[1.7]">
						已送审校收件箱：{traits} 条风格特征提案＋1
						条节奏范本提案，等待你裁决。
					</span>
					<span className="ml-auto">
						<Button
							size="compact"
							variant="primary"
							onClick={() => onGoReview()}
						>
							去裁决
						</Button>
					</span>
				</div>
				<p className="m-0 mt-2 text-[11px] leading-[1.7] text-ink-low">
					参考书只作分析源（ADR-0019）；提案确认后才会入库并在装配包以「文风指导」段生效。
				</p>
			</Panel>
		);
	}
	return (
		<Panel title="分析">
			<div className="grid gap-2">
				{providerReady ? (
					<p className="m-0 text-[12px] leading-[1.7] text-ink-mid">
						对《{book.title}
						》发起双轨分析：本地统计（无需模型）＋分章理解（每章一次模型调用，每批至多
						{STEP_BATCH} 章）。完成后汇总为提案送审校收件箱。
					</p>
				) : (
					<p className="m-0 text-[12px] leading-[1.7] text-ink-mid">
						发起分章理解前需要可用的模型接入：本地统计轨不受影响，随时可看下方报告。
					</p>
				)}
				<div className="flex items-center gap-2">
					<Button
						variant="primary"
						disabled={!providerReady}
						busy={starting}
						onClick={onStart}
					>
						发起分析
					</Button>
					{!providerReady ? (
						<Button onClick={onOpenByok}>去模型接入</Button>
					) : null}
				</div>
				{!providerReady ? (
					<InlineNote tone="danger">
						还没有可用的模型接入——在「项目与设置 → 模型接入」配置服务商并保存
						Key 后回来发起。
					</InlineNote>
				) : null}
			</div>
		</Panel>
	);
}

// ---------- 统计报告 ----------

function StatsSection({
	stats,
	busy,
	run,
	onGoReview,
}: {
	stats: StatsView | null;
	busy: boolean;
	run: AnalysisRunView | null;
	onGoReview: () => void;
}) {
	if (busy || !stats) {
		return (
			<Panel title="统计报告（客观数据）">
				<SkeletonLines lines={3} />
			</Panel>
		);
	}
	const hooked = stats.chapters.filter(
		(chapter) => chapter.endsWithHook,
	).length;
	const curve = stats.chapterCharCounts;
	const max = curve.length > 0 ? Math.max(...curve) : 0;
	const completed = run?.status === "completed";
	return (
		<Panel title="统计报告（客观数据）">
			<div className="grid gap-3">
				<div className="grid grid-cols-3 gap-2">
					<div className="rounded-sm border border-line px-3 py-2">
						<div className="eyebrow text-ink-low">对话占比</div>
						<div className="text-[15px] font-semibold">
							{Math.round(stats.dialogueRatio * 100)}%
						</div>
					</div>
					<div className="rounded-sm border border-line px-3 py-2">
						<div className="eyebrow text-ink-low">章末钩子</div>
						<div className="text-[15px] font-semibold">
							{hooked}/{stats.chapterCount} 章
						</div>
					</div>
					<div className="rounded-sm border border-line px-3 py-2">
						<div className="eyebrow text-ink-low">句长中位</div>
						<div className="text-[15px] font-semibold">
							{stats.sentenceLengthSummary.median} 字
						</div>
					</div>
				</div>
				<div>
					<div className="eyebrow text-ink-low mb-1">章级字数曲线</div>
					<div className="flex items-end gap-0.5 h-16">
						{curve.map((value, index) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: 曲线是章序静态序列，不重排不增删
								key={index}
								title={`第 ${index + 1} 章 ${value.toLocaleString()} 字`}
								className="flex-1 bg-accent-soft rounded-t-[2px]"
								style={{
									height: `${max > 0 ? Math.max(8, (value / max) * 100) : 8}%`,
								}}
							/>
						))}
					</div>
				</div>
				<p className="m-0 text-[11px] leading-[1.7] text-ink-low">
					报告只陈述客观事实，不评判、不直接产提案；风格结论由理解轨汇总为提案，在审校收件箱裁决。
				</p>
				{completed ? (
					<div className="rounded-sm border border-line bg-rail px-3 py-2 flex items-center gap-2">
						<Chip tone="accent">提案已送审</Chip>
						<span className="ml-auto">
							<Button size="compact" variant="primary" onClick={onGoReview}>
								去裁决
							</Button>
						</span>
					</div>
				) : null}
			</div>
		</Panel>
	);
}
