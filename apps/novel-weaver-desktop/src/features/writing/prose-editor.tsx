import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { authorErrorMessage, queryProject } from "../../shared/api/rpc";
import { Button, Chip } from "../../shared/ui/components";
import { WRITING } from "../../shared/ui/copy";
import { cx } from "../../shared/ui/cx";
import { SkeletonLines } from "../../shared/ui/states";
import { useWorkspace } from "../../shared/workspace/context";
import { useAssistant } from "./assistant/assistant-context";
import { clearDraft, loadDraft, saveDraft } from "./draft-store";
import { labelOfFinding } from "./finding-label";
import { anchorOf, countWords, lineDiff, splitParagraphs } from "./prose";
import {
	locateSelection,
	type SceneDirectory,
} from "./writing/scene-directory";

interface CanonicalSceneSummary {
	sceneId: string;
	title: string;
	storyOrder: number;
	narrativeMode: string;
	viewpointCharacterId: string | null;
}

interface CanonicalScene extends CanonicalSceneSummary {
	markdown: string;
	versionId: string;
	continuityId: string;
}

const PAPER_CLASS =
	"max-w-180 mx-auto bg-paper border border-paper-line rounded-md pt-8 px-12 pb-12 shadow-nw";

interface ReviewFinding {
	findingId: string;
	severity: "blocking" | "warning" | "advisory";
	confidence: number;
	status: string;
	code: string;
	message: string;
}

const SEVERITY_WAVE: Record<ReviewFinding["severity"], string> = {
	blocking: "var(--blocking)",
	warning: "var(--accent)",
	advisory: "var(--ink-mid)",
};

/** 正典纸面：只读渲染；已入库发现按严重度画波浪线＋悬停详情（WF2-14）。 */
function ProsePaper({
	markdown,
	marks,
}: {
	markdown: string;
	marks?: Map<string, { color: string; title: string }>;
}) {
	const paragraphs = useMemo(() => splitParagraphs(markdown), [markdown]);
	return (
		<div className={cx("prose paper", PAPER_CLASS)}>
			{paragraphs.length === 0 ? (
				<p className="text-ink-low">（空场景）</p>
			) : (
				paragraphs.map((paragraph) => {
					const mark = marks?.get(paragraph.anchor);
					return (
						<p
							key={paragraph.anchor}
							data-p-anchor={paragraph.anchor}
							title={mark?.title}
							style={
								mark
									? {
											textDecoration: `underline wavy ${mark.color}`,
											textDecorationSkipInk: "none",
											textUnderlineOffset: 5,
											cursor: "help",
										}
									: undefined
							}
						>
							{paragraph.text}
						</p>
					);
				})
			)}
		</div>
	);
}

/**
 * 写作台纸面（WF5-06）：专注默认态的中央正文模块。
 * 场景选择由写作区（WritingWorkspace）持有并经 selectedKey 下发；本组件只负责
 * 正典渲染、草稿编辑、自动保存与候选提案关口。选中场景计划（未写成）时正文区
 * 交还 paperSlot（真实下一步卡片），绝不渲染可编辑假纸面。
 */
export function ProseEditor({
	cwd,
	directory,
	selectedKey,
	currentTask,
	paperSlot,
	onContentChanged,
}: {
	cwd: string;
	directory: SceneDirectory;
	selectedKey: string | null;
	/** 本场任务文案（计划目的），由写作区按目录解析。 */
	currentTask: string | null;
	/** 无正典选中时正文区的真实下一步内容。 */
	paperSlot: ReactNode;
	/** 候选提案创建后请写作区刷新目录（正典事实已可能变化）。 */
	onContentChanged: () => void;
}) {
	const ws = useWorkspace();
	const selectedSceneId = selectedKey?.startsWith("canonical:")
		? selectedKey.slice("canonical:".length) || null
		: null;
	const [canonicalCache, setCanonicalCache] = useState<
		Map<string, CanonicalScene>
	>(new Map());
	const [findingsCache, setFindingsCache] = useState<
		Map<string, ReviewFinding[]>
	>(new Map());
	const [error, setError] = useState("");

	const [draftSource, setDraftSource] = useState<CanonicalScene | null>(null);
	const [draftText, setDraftText] = useState("");
	const [draftTitle, setDraftTitle] = useState("");
	const [showDiff, setShowDiff] = useState(false);
	const [showPreview, setShowPreview] = useState(false);
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState("");

	// 懒取正典全文：选中才拉，缓存复用。
	useEffect(() => {
		if (!selectedSceneId || canonicalCache.has(selectedSceneId)) return;
		void (async () => {
			try {
				const scene = await queryProject<CanonicalScene>(
					cwd,
					"get_canonical_scene",
					{ sceneId: selectedSceneId },
				);
				setCanonicalCache((current) =>
					new Map(current).set(selectedSceneId, scene),
				);
			} catch (detail) {
				setError(authorErrorMessage(detail));
			}
		})();
	}, [selectedSceneId, canonicalCache, cwd]);

	// 已入库发现（WF2-14）：随场景版本懒取，供波浪线标记。
	useEffect(() => {
		if (!selectedSceneId || findingsCache.has(selectedSceneId)) return;
		const versionId = canonicalCache.get(selectedSceneId)?.versionId;
		if (!versionId) return;
		void (async () => {
			try {
				const found = await queryProject<ReviewFinding[]>(
					cwd,
					"list_version_findings",
					{ versionId },
				);
				setFindingsCache((current) =>
					new Map(current).set(selectedSceneId, found ?? []),
				);
			} catch {
				setFindingsCache((current) =>
					new Map(current).set(selectedSceneId, []),
				);
			}
		})();
	}, [selectedSceneId, canonicalCache, findingsCache, cwd]);

	// 版本历史打开即重取选中正典（WF5-09）：外部批准可能已位移正典，
	// 双稿 stale 判定依赖 prose 快照版本号保持新鲜；读史是复核的时机。
	const versionsTabOpen = ws.panelOpen && ws.panelActiveTab === "versions";
	useEffect(() => {
		if (!versionsTabOpen || !selectedSceneId) return;
		void (async () => {
			try {
				const scene = await queryProject<CanonicalScene>(
					cwd,
					"get_canonical_scene",
					{ sceneId: selectedSceneId },
				);
				setCanonicalCache((current) =>
					new Map(current).set(selectedSceneId, scene),
				);
			} catch {
				// 重取失败保持旧缓存：只影响 stale 判定的新鲜度，不阻塞作者。
			}
		})();
	}, [versionsTabOpen, selectedSceneId, cwd]);

	/**
	 * 草稿裁决（WF5-05/06）：选中场景的正典全文就位后一次性决定草稿态——
	 * 基线一致的本地草稿直接恢复（崩溃/误关后从原处继续），否则清空进入
	 * 只读正典。裁决以场景为单位记忆，切走再回同样恢复到最近草稿。
	 */
	const draftDecidedRef = useRef<string | null>(null);
	useEffect(() => {
		const decided = draftDecidedRef.current;
		const next = selectedSceneId ?? "";
		if (decided === next) return;
		if (!selectedSceneId) {
			draftDecidedRef.current = "";
			setDraftSource(null);
			setDraftText("");
			setDraftTitle("");
			setNote("");
			setShowDiff(false);
			setShowPreview(false);
			return;
		}
		const canonical = canonicalCache.get(selectedSceneId);
		if (!canonical) return;
		draftDecidedRef.current = selectedSceneId;
		const persisted = loadDraft(cwd, selectedSceneId);
		if (persisted && persisted.sourceVersionId === canonical.versionId) {
			setDraftSource(canonical);
			setDraftText(persisted.text);
			setDraftTitle(persisted.title || `${canonical.title}·重写`);
			const at = new Date(persisted.savedAt);
			setNote(
				`已恢复上次草稿（${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")} 保存）`,
			);
		} else {
			setDraftSource(null);
			setDraftText("");
			setDraftTitle("");
			setNote("");
			setShowDiff(false);
			setShowPreview(false);
		}
	}, [selectedSceneId, canonicalCache, cwd]);

	const selectedCanonical = selectedSceneId
		? (canonicalCache.get(selectedSceneId) ?? null)
		: null;

	// 波浪线标记（WF2-14）：发现→锚点→严重度着色＋悬停详情。
	const canonicalMarks = useMemo(() => {
		if (!selectedCanonical) return undefined;
		const findings = findingsCache.get(selectedCanonical.sceneId) ?? [];
		const marks = new Map<string, { color: string; title: string }>();
		for (const finding of findings) {
			const evidence = [
				...(finding.message.match(/「[^」]+」/g) ?? []),
				...(finding.code === "AI_FLAVOR_PADDING"
					? (finding.message.match(/[\u4e00-\u9fff]{2}×\d+/g) ?? []).map(
							(item) => item.split("×")[0] ?? "",
						)
					: []),
			].filter(Boolean);
			const anchor = anchorOf(
				evidence,
				finding.message,
				selectedCanonical.markdown,
			);
			if (!anchor) continue;
			const title = `${labelOfFinding(finding.code)} · 置信 ${(finding.confidence * 100).toFixed(0)}%\n${finding.message}`;
			const existing = marks.get(anchor);
			marks.set(anchor, {
				color:
					existing && existing.color === "var(--blocking)"
						? existing.color
						: SEVERITY_WAVE[finding.severity],
				title: existing ? `${existing.title}\n——\n${title}` : title,
			});
		}
		return marks.size > 0 ? marks : undefined;
	}, [selectedCanonical, findingsCache]);

	const located = useMemo(
		() => locateSelection(directory, selectedKey),
		[directory, selectedKey],
	);

	const draftDirty = draftText !== (draftSource?.markdown ?? "");
	const mode: "canonical" | "draft" | "none" = draftSource
		? "draft"
		: selectedCanonical
			? "canonical"
			: "none";

	// 实时字数上报：底栏本章字数槽位（WF2-12 消费）。
	useEffect(() => {
		if (mode === "draft") {
			ws.reportChapterProgress(countWords(draftText), null);
		} else if (selectedCanonical) {
			ws.reportChapterProgress(
				countWords(selectedCanonical.markdown),
				located?.chapter?.targetWords ?? null,
			);
		} else {
			ws.reportChapterProgress(0, null);
		}
	}, [mode, draftText, selectedCanonical, located, ws]);

	const assistant = useAssistant();
	const draftTextRef = useRef(draftText);
	draftTextRef.current = draftText;
	const draftSceneId = draftSource?.sceneId ?? null;
	const currentDraftRef = useRef(draftSource);
	currentDraftRef.current = draftSource;
	const mountedRef = useRef(true);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	// 续写桥：光标续写模式把生成结果直接追加回当前草稿（WF2-11）；精简走整篇替换（WF2-13）。
	useEffect(() => {
		if (draftSource) {
			assistant.registerContinuation({
				isCurrent: () =>
					mountedRef.current && currentDraftRef.current === draftSource,
				getText: () => draftTextRef.current,
				append: (addition) =>
					setDraftText(
						(current) => `${current.trimEnd()}\n\n${addition.trim()}`,
					),
				replaceAll: (nextText) => setDraftText(nextText),
			});
		} else {
			assistant.registerContinuation(null);
		}
	}, [draftSource, assistant]);

	// 采用桥（WF5-09）：双稿裁决的确认结果落成手编草稿（与续写桥同模式）。
	// 会话打开期间本组件仅视觉隐藏、保持挂载，桥持续可用。
	const adoptAsDraft = useCallback(
		(input: { sceneId: string; markdown: string; title: string }) => {
			const land = (canonical: CanonicalScene) => {
				draftDecidedRef.current = canonical.sceneId;
				setDraftSource(canonical);
				setDraftText(input.markdown);
				setDraftTitle(input.title);
				setShowDiff(false);
				setShowPreview(false);
				setNote("AI 采用稿已开为手编草稿——可继续编辑，或直接存为候选提案。");
			};
			const canonical = canonicalCache.get(input.sceneId);
			if (canonical) {
				land(canonical);
				return;
			}
			void (async () => {
				try {
					const fetched = await queryProject<CanonicalScene>(
						cwd,
						"get_canonical_scene",
						{ sceneId: input.sceneId },
					);
					setCanonicalCache((current) =>
						new Map(current).set(input.sceneId, fetched),
					);
					land(fetched);
				} catch (detail) {
					setError(authorErrorMessage(detail));
				}
			})();
		},
		[canonicalCache, cwd],
	);

	useEffect(() => {
		assistant.registerAdoption({ adopt: adoptAsDraft });
		return () => assistant.registerAdoption(null);
	}, [assistant, adoptAsDraft]);

	// 正文快照上报：质量报告体检与版本历史的数据源（WF2-13/18）；
	// meta 供双稿 stale 判定（WF5-09），无正文时清空快照防串场。
	useEffect(() => {
		if (mode === "draft") {
			ws.reportProseSnapshot(
				draftText,
				`草稿 · ${draftTitle || "未命名"}`,
				draftSceneId,
				{
					versionId: draftSource?.versionId ?? null,
					kind: "draft",
				},
			);
		} else if (selectedCanonical) {
			ws.reportProseSnapshot(
				selectedCanonical.markdown,
				`正典 · ${selectedCanonical.title}`,
				selectedCanonical.sceneId,
				{
					versionId: selectedCanonical.versionId,
					kind: "canonical",
				},
			);
		} else {
			// 无正文：清空快照防串场（WF5-09 stale 判定）；label 留空，
			// 让助手等消费方维持「零场景/未选中」的既有判断。
			ws.reportProseSnapshot("", "", null, {
				versionId: null,
				kind: null,
			});
		}
	}, [
		mode,
		draftText,
		draftTitle,
		selectedCanonical,
		ws,
		draftSceneId,
		draftSource,
	]);

	// 定位高亮：滚动至目标段落并闪烁标记（WF2-13）。
	const paperWrapRef = useRef<HTMLDivElement>(null);
	const highlight = ws.proseHighlight;
	useEffect(() => {
		if (!highlight) return;
		const el = paperWrapRef.current?.querySelector(
			`[data-p-anchor="${highlight.anchor}"]`,
		);
		if (!el) return;
		el.scrollIntoView({ behavior: "smooth", block: "center" });
		const original = (el as HTMLElement).style.background;
		(el as HTMLElement).style.background = "rgba(208,138,46,0.28)";
		const timer = setTimeout(() => {
			(el as HTMLElement).style.background = original;
		}, 1800);
		return () => clearTimeout(timer);
	}, [highlight]);

	const pendingSaveRef = useRef<(() => void) | null>(null);
	// Flush when leaving the source; ordinary edits retain the debounce.
	useEffect(
		() => () => {
			pendingSaveRef.current?.();
			pendingSaveRef.current = null;
		},
		[cwd, draftSource],
	);

	useEffect(() => {
		if (!draftSource) return;
		ws.reportSaveState("saving");
		const persist = () => {
			const ok = saveDraft(cwd, draftSource.sceneId, {
				text: draftText,
				title: draftTitle,
				sourceVersionId: draftSource.versionId,
			});
			ws.reportSaveState(ok ? "saved" : "error");
			pendingSaveRef.current = null;
		};
		pendingSaveRef.current = persist;
		const timer = setTimeout(persist, 900);
		return () => clearTimeout(timer);
	}, [cwd, draftSource, draftText, draftTitle, ws]);

	const startDraft = (blank: boolean) => {
		if (!selectedCanonical) return;
		// 有本地草稿则无损恢复（WF2-12 自动保存）。
		const persisted = !blank ? loadDraft(cwd, selectedCanonical.sceneId) : null;
		setDraftSource(selectedCanonical);
		draftDecidedRef.current = selectedCanonical.sceneId;
		if (
			!blank &&
			persisted &&
			persisted.sourceVersionId === selectedCanonical.versionId
		) {
			setDraftText(persisted.text);
			setDraftTitle(persisted.title || `${selectedCanonical.title}·重写`);
			const at = new Date(persisted.savedAt);
			setNote(
				`已恢复上次草稿（${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")} 保存）`,
			);
		} else {
			setDraftText(blank ? "" : selectedCanonical.markdown);
			setDraftTitle(`${selectedCanonical.title}·重写`);
			setNote("");
		}
		setShowDiff(false);
		setShowPreview(false);
	};

	const submitDraft = async () => {
		if (!draftSource || !draftText.trim() || !draftTitle.trim()) return;
		setBusy(true);
		try {
			await queryProject(cwd, "create_scene_candidate", {
				// 草稿锚定在既有正典场景上：必须修订同一场景，批准后替换它的正典；
				// 缺 sceneId 会另建新场景，原场景永远收不到修订（WF5-18 终验场景二）。
				sceneId: draftSource.sceneId,
				sourceVersionId: draftSource.versionId,
				title: draftTitle.trim(),
				markdown: draftText,
				narrativeMode: draftSource.narrativeMode || "third_person_limited",
				viewpointCharacterId: draftSource.viewpointCharacterId ?? undefined,
				continuityId: draftSource.continuityId || "main",
				storyOrder: draftSource.storyOrder,
				purposes: ["推进主线"],
				authorInstruction: "写作台手编候选",
			});
			setNote("候选提案已创建——待审批准后入正典。");
			ws.reportSaved();
			pendingSaveRef.current = null;
			clearDraft(cwd, draftSource.sceneId);
			setDraftSource(null);
			setDraftText("");
			onContentChanged();
		} catch (detail) {
			setError(authorErrorMessage(detail));
		} finally {
			setBusy(false);
		}
	};

	const diffParts = useMemo(() => {
		if (!showDiff || !draftSource) return [];
		// 行差分天然按位置标识：给每段记起始行号作为确定性 key/anchor。
		let offset = 0;
		return lineDiff(draftSource.markdown, draftText).map((part) => {
			const entry = { ...part, start: offset };
			offset += 1;
			return entry;
		});
	}, [showDiff, draftSource, draftText]);

	return (
		<div ref={paperWrapRef} className="grid gap-2">
			{/* 任务头：本场任务常驻（WF5-06 验收 1），动作按草稿/正典态切换 */}
			<div className="flex items-center gap-2 flex-wrap min-h-8">
				<span
					className="min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-ink-mid"
					title={currentTask ?? WRITING.taskNone}
				>
					<b className="font-semibold text-ink-hi">{WRITING.taskLabel}</b>　
					{currentTask ?? WRITING.taskNone}
				</span>
				{error ? <Chip tone="accent">{error}</Chip> : null}
				{note ? <Chip tone="accent">{note}</Chip> : null}
				<span className="ml-auto inline-flex gap-1">
					{mode === "canonical" && selectedCanonical ? (
						<>
							<span className="num text-[11.5px] text-ink-mid self-center">
								{countWords(selectedCanonical.markdown).toLocaleString()} 字
							</span>
							<Button onClick={() => startDraft(false)}>
								以此场景为基写新候选
							</Button>
							<Button onClick={() => startDraft(true)}>空白新草稿</Button>
						</>
					) : mode === "draft" ? (
						<>
							<span
								className={cx(
									"num text-[11.5px] self-center",
									draftDirty ? "text-accent-text" : "text-ink-mid",
								)}
							>
								{countWords(draftText).toLocaleString()} 字
								{draftDirty ? " · 未保存改动" : ""}
							</span>
							<Button
								variant={showDiff ? "primary" : "ghost"}
								onClick={() => setShowDiff((value) => !value)}
							>
								来源差异
							</Button>
							<Button
								variant="primary"
								busy={busy}
								disabled={!draftDirty}
								onClick={() => void submitDraft()}
							>
								存为候选提案
							</Button>
							<Button
								onClick={() => {
									if (!draftSource) return;
									pendingSaveRef.current = null;
									clearDraft(cwd, draftSource.sceneId);
									ws.reportSaveState("idle");
									setDraftSource(null);
									setDraftText("");
									setDraftTitle("");
								}}
							>
								放弃草稿
							</Button>
						</>
					) : null}
				</span>
			</div>

			{mode === "canonical" ? (
				selectedCanonical ? (
					<>
						<p className="text-center font-wenkai text-[15px] m-0">
							{selectedCanonical.title}
							<span className="num ml-2 text-[10.5px] text-ink-low">
								序{selectedCanonical.storyOrder} · 正典只读
							</span>
						</p>
						<ProsePaper
							markdown={selectedCanonical.markdown}
							marks={canonicalMarks}
						/>
					</>
				) : (
					/* 正典全文加载中：骨架过渡，不落假内容 */
					<div className={cx(PAPER_CLASS, "grid gap-2.5 py-8")}>
						<SkeletonLines lines={4} />
					</div>
				)
			) : mode === "draft" ? (
				draftSource && (
					<>
						<input
							value={draftTitle}
							onChange={(event) => setDraftTitle(event.target.value)}
							placeholder="草稿标题"
							className="max-w-180 mx-auto w-full block bg-transparent border-0 outline-none text-center font-wenkai text-[15px] text-ink-hi"
						/>
						{showDiff ? (
							<div className={cx("prose paper", PAPER_CLASS, "select-text")}>
								{diffParts.map((part) => (
									<span
										key={part.start}
										data-p-anchor={`l${part.start}`}
										className={cx(
											part.kind === "add"
												? "bg-[rgba(127,168,140,0.25)]"
												: part.kind === "del"
													? "bg-[rgba(140,58,43,0.22)]"
													: undefined,
											part.kind === "del" ? "line-through" : undefined,
										)}
									>
										{part.text}
										{"\n"}
									</span>
								))}
							</div>
						) : (
							<textarea
								value={draftText}
								onChange={(event) => setDraftText(event.target.value)}
								spellCheck={false}
								className={cx(
									PAPER_CLASS,
									"block w-full min-h-105 font-wenkai text-prose leading-[2] text-prose-ink resize-y outline-none text-justify box-border",
								)}
							/>
						)}
						<div className="flex justify-center">
							<Button
								variant={!showDiff && showPreview ? "primary" : "ghost"}
								onClick={() => setShowPreview((value) => !value)}
							>
								排版预览（段落锚点）
							</Button>
						</div>
						{!showDiff && showPreview ? (
							<ProsePaper markdown={draftText} />
						) : null}
					</>
				)
			) : (
				/* 未选正典场景：真实下一步（计划卡/规划起点），绝无假纸面（WF5-06 验收 4） */
				paperSlot
			)}
		</div>
	);
}
