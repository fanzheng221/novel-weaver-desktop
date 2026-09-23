import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../shared/ui/components";
import { cx } from "../../../shared/ui/cx";
import { splitParagraphs } from "../prose";
import type { DualDraftSession } from "./machine";
import { isStale } from "./machine";
import { applySegments } from "./segments";

/**
 * 双稿裁决视图（WF5-09）：生成完成后原位替换纸面，只在裁决时存在。
 * 三栏（我的正文 / AI 候选句段 / 最终草稿预览）各自内部滚动，决策栏 absolute
 * 常驻；窄窗（<1080px）预览列转浮层；键盘等价＝Tab 聚焦句段复选框＋空格切换。
 * 视觉对齐 WF5-08 裁决保留件原型（prototype/dual-draft-partial-adoption.html）。
 */

const PREVIEW_BREAKPOINT = 1080;

export interface DualDraftViewProps {
	session: DualDraftSession;
	/** 当前正典版本 id（stale 判定用）；null 视为无法判定。 */
	currentVersionId: string | null;
	onToggleSegment: (segmentId: string, on: boolean) => void;
	onClearSelection: () => void;
	onConfirmPartial: (
		markdown: string,
		adoptedCount: number,
		draftTitle: string,
	) => void;
	onAdoptAsDraft: () => void;
	onUndoAdoption: () => void;
	onDiscard: () => void;
	/** 结果态退出：关闭会话回到单稿（草稿已就位）。 */
	onResumeWriting: () => void;
	onRegenerate: () => void;
	onReviewContext: () => void;
}

export function DualDraftView({
	session,
	currentVersionId,
	onToggleSegment,
	onClearSelection,
	onConfirmPartial,
	onAdoptAsDraft,
	onUndoAdoption,
	onDiscard,
	onResumeWriting,
	onRegenerate,
	onReviewContext,
}: DualDraftViewProps) {
	const { source, segments, checked, phase, result } = session;
	const stale = isStale(session, currentVersionId);
	const comparing = phase === "comparing";
	const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
	const [previewOverlayOpen, setPreviewOverlayOpen] = useState(false);
	const [announcement, setAnnouncement] = useState("");

	useEffect(() => {
		const onResize = () => setViewportWidth(window.innerWidth);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const preview = useMemo(
		() => applySegments(source.baseText, segments, checked),
		[source.baseText, segments, checked],
	);

	const merged = result?.markdown ?? preview.markdown;
	const mergedParts = useMemo(() => {
		if (result) {
			return splitParagraphs(result.markdown).map((p) => ({
				parts: [{ text: p.text, ins: false }],
			}));
		}
		return preview.paragraphs;
	}, [result, preview.paragraphs]);

	const baseLabel = source.baseKind === "draft" ? "手编草稿" : "正式稿";
	const previewTitle = result
		? result.mode === "full"
			? "全文采用 · 新草稿"
			: `局部采用 ${result.adoptedCount} 处 · 新草稿`
		: "最终草稿预览";

	const announce = (message: string) => setAnnouncement(message);

	const toggleSegment = (segmentId: string, on: boolean, opLabel: string) => {
		onToggleSegment(segmentId, on);
		announce(on ? `已勾选：${opLabel}` : `已取消勾选：${opLabel}`);
	};

	const confirmPartial = () => {
		if (checked.size === 0 || stale) return;
		onConfirmPartial(
			preview.markdown,
			preview.adoptedCount,
			`${source.candidateTitle || source.sceneTitle || "未命名"}·采用稿`,
		);
		announce(
			`已确认 ${preview.adoptedCount} 处局部采用，成为新草稿；撤销本次采用可回双稿。`,
		);
	};

	const adoptAsDraft = () => {
		if (stale) return;
		onAdoptAsDraft();
		announce("候选全文已作为新草稿打开，正式稿与 AI 原候选保留可追溯。");
	};

	const discard = () => {
		onDiscard();
		announce("候选已放弃，未产生任何版本或草稿副作用。");
	};

	const narrow = viewportWidth < PREVIEW_BREAKPOINT;

	return (
		<div
			className="relative flex flex-col overflow-hidden rounded-lg border border-line bg-panel"
			style={{ height: "calc(100dvh - 150px)", minHeight: 420 }}
			aria-label={`双稿裁决：${source.sceneTitle ?? "场景"}`}
		>
			{/* 焦点条：任务、来源基线、已选计数、窄窗预览开关 */}
			<div className="flex flex-none items-center gap-2.5 border-b border-line px-3.5 py-2 min-h-10.5">
				<span
					className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-ink-mid"
					title={source.sceneTitle ?? undefined}
				>
					<b className="text-ink-hi">{source.sceneTitle ?? "场景"}</b>
					<span className="ml-2">{stale ? "基线已过期" : "基线未过期"}</span>
				</span>
				<span className="ml-auto inline-flex items-center gap-1.5">
					{comparing ? (
						<span className="num text-[11.5px] text-accent-text whitespace-nowrap">
							已选 {checked.size} 处采用
						</span>
					) : null}
					{narrow ? (
						<Button
							size="compact"
							aria-expanded={previewOverlayOpen}
							onClick={() => setPreviewOverlayOpen((open) => !open)}
						>
							{previewOverlayOpen ? "关闭预览" : "结果预览"}
						</Button>
					) : null}
				</span>
			</div>

			{stale && comparing ? (
				<div className="flex-none border-b border-line bg-[rgba(140,58,43,0.14)] px-3.5 py-2 text-[12px] leading-[1.8] text-ink-hi">
					<b>基线已过期：</b>
					生成后该场景正式稿已更新，为避免覆盖作者新改动，已暂停采用与全文采用。
					<span className="ml-2 inline-flex gap-1.5 align-middle">
						<Button size="compact" onClick={onRegenerate}>
							重新生成
						</Button>
						<Button size="compact" onClick={onReviewContext}>
							复核上下文
						</Button>
					</span>
				</div>
			) : null}

			{comparing ? (
				<div
					className="grid min-h-0 flex-1"
					style={{
						gridTemplateColumns: narrow ? "1fr 1.2fr" : "1fr 1.15fr 0.95fr",
					}}
				>
					{/* 左栏：我的正文 */}
					<section
						className="flex min-w-0 flex-col overflow-hidden border-r border-line"
						aria-label="我的正文"
					>
						<header className="flex h-11 flex-none items-center gap-2 border-b border-line bg-[#1b1d20] px-3">
							<b className="text-[13px] text-ink-hi">我的正文</b>
							<span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-ink-low">
								{baseLabel} · 确认前不会改动
							</span>
						</header>
						<div className="min-h-0 flex-1 overflow-auto bg-paper">
							<div className="prose font-wenkai px-5 py-6 pb-24 text-[15.5px] leading-[2] text-prose-ink">
								{splitParagraphs(source.baseText).map((para, index) => (
									<p
										key={para.anchor}
										data-para={index + 1}
										className="m-0 mb-2"
										style={{ textIndent: "2em" }}
									>
										{para.text || "（本段已空）"}
									</p>
								))}
							</div>
						</div>
					</section>

					{/* 中栏：候选句段勾选 */}
					<section
						className="flex min-w-0 flex-col overflow-hidden border-r border-line"
						aria-label="AI 候选句段"
					>
						<header className="flex h-11 flex-none items-center gap-2 border-b border-line bg-[#1b1d20] px-3">
							<b className="text-[13px] text-ink-hi">AI 候选</b>
							<span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-ink-low">
								候选按句段拆开 · 勾选即采用
							</span>
						</header>
						{segments.length === 0 ? (
							<div className="flex-1 overflow-auto px-3.5 py-4 text-[12px] leading-[1.9] text-ink-low">
								候选与{baseLabel}逐句一致，没有可局部采用的内容；
								可全文采用为新草稿，或放弃候选。
							</div>
						) : (
							<>
								<p className="flex-none border-b border-line px-3.5 py-1.5 text-[11px] text-ink-low">
									勾选要采用的句段；取消勾选即撤回该处。与正文一致的段未列出。
								</p>
								<div
									className="min-h-0 flex-1 overflow-auto bg-paper"
									role="group"
									aria-label="候选句段勾选"
								>
									<div className="flex flex-col gap-2.25 px-3.5 py-3.5 pb-24">
										{segments.map((seg) => {
											const on = checked.has(seg.id);
											return (
												<label
													key={seg.id}
													className={cx(
														"grid cursor-pointer items-start gap-2.5 rounded-md border p-2.75 px-3",
														on
															? "border-accent bg-[rgba(208,138,46,0.12)]"
															: "border-paper-line bg-paper",
													)}
													style={{ gridTemplateColumns: "auto minmax(0,1fr)" }}
												>
													<input
														type="checkbox"
														checked={on}
														disabled={stale}
														onChange={(event) =>
															toggleSegment(
																seg.id,
																event.target.checked,
																seg.opLabel,
															)
														}
														aria-label={`采用句段：${seg.opLabel}`}
														className="mt-1 h-4.25 w-4.25 accent-accent"
													/>
													<span className="min-w-0">
														<span className="font-wenkai text-[14.5px] leading-[1.9] text-prose-ink">
															{seg.text}
														</span>
														<br />
														<span className="mt-1.5 inline-block rounded-full border border-[#55462f] px-2 py-px text-[10.5px] text-accent-text">
															{seg.opLabel}
														</span>
													</span>
												</label>
											);
										})}
									</div>
								</div>
							</>
						)}
					</section>

					{/* 右栏：最终草稿预览（窄窗转浮层） */}
					<section
						className={cx(
							"flex min-w-0 flex-col overflow-hidden",
							narrow && previewOverlayOpen
								? "absolute bottom-16 right-2.5 top-21.5 z-28 w-[min(430px,88%)] rounded-[10px] border border-line-strong bg-panel shadow-nw"
								: "",
							narrow && !previewOverlayOpen ? "hidden" : "",
						)}
						aria-label={previewTitle}
					>
						<header className="flex h-11 flex-none items-center gap-2 border-b border-line bg-[#1b1d20] px-3">
							<b className="text-[13px] text-ink-hi">最终草稿预览</b>
							<span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-ink-low">
								随选择实时更新
							</span>
						</header>
						<div className="min-h-0 flex-1 overflow-auto bg-paper">
							<div className="prose font-wenkai px-5 py-6 pb-24 text-[15.5px] leading-[2] text-prose-ink">
								{mergedParts.map((para, index) => (
									<p
										key={`pv-${index}`}
										data-para={index + 1}
										className="m-0 mb-2"
										style={{ textIndent: "2em" }}
									>
										{para.parts.map((part, partIndex) => (
											<span
												key={partIndex}
												className={cx(
													part.ins &&
														"rounded-[2px] bg-[rgba(208,138,46,0.26)] text-[#f1dfbe]",
												)}
											>
												{part.text}
											</span>
										)) || "（本段已空）"}
									</p>
								))}
							</div>
						</div>
					</section>
				</div>
			) : (
				/* 结果态：裁决完成，展示产物与出路 */
				<div className="flex min-h-0 flex-1 flex-col" aria-label="裁决结果">
					<div
						className={cx(
							"mx-4 mt-3.5 flex flex-none items-center gap-2.5 rounded-md border px-3.5 py-2.5 text-[12.5px]",
							"border-[#4a544d] bg-[rgba(127,168,140,0.14)] text-ink-hi",
						)}
					>
						<b>
							{result?.mode === "full"
								? "候选全文已作为新草稿打开"
								: `已确认 ${result?.adoptedCount ?? 0} 处局部采用`}
						</b>
						<span className="text-ink-mid">
							候选内容并入了新草稿，可继续手编；{baseLabel}与 AI
							原候选均保留可追溯。
						</span>
					</div>
					<div className="min-h-0 flex-1 overflow-auto">
						<div className="prose font-wenkai mx-auto max-w-180 px-6.5 py-5 pb-27.5 text-[15.5px] leading-[2] text-prose-ink">
							<h2 className="font-wenkai text-[19px] text-ink-hi">
								{result?.draftTitle}
							</h2>
							<p className="text-[11.5px] text-ink-low">
								金色为本次采用的候选内容 · 上一稿为{baseLabel}，未改动
							</p>
							{splitParagraphs(merged).map((para, index) => (
								<p
									key={`rs-${index}`}
									data-para={index + 1}
									className="m-0 mb-2"
									style={{ textIndent: "2em" }}
								>
									{para.text || "（本段已空）"}
								</p>
							))}
						</div>
					</div>
				</div>
			)}

			{/* 决策栏：absolute 常驻，任何相位下键盘可达。
			    限宽换行：窄窗下列宽 < 工具栏自然宽，不裁会溢出容器被
			    overflow-hidden 剪掉左端按钮（WF5-18 终验场景五 800×600）。 */}
			<div
				role="toolbar"
				aria-label="双稿裁决"
				className="absolute right-3.5 bottom-3.5 z-25 flex max-w-[calc(100%-1.75rem)] flex-wrap items-center gap-1.75 rounded-md border border-line bg-panel p-1.25 shadow-nw"
			>
				{comparing ? (
					<>
						<span
							className={cx(
								"max-w-85 px-1 text-[11px] text-ink-low",
								narrow && "hidden",
							)}
						>
							{stale
								? "基线已过期：请重新生成或复核上下文；放弃候选始终可用。"
								: checked.size === 0
									? "请先勾选要采用的句段；若不需要候选，可全文采用或放弃。"
									: "确认前原正文不变；确认后产生新草稿，正式稿保留。"}
						</span>
						<Button size="compact" onClick={discard}>
							放弃候选
						</Button>
						<Button
							size="compact"
							disabled={checked.size === 0}
							onClick={onClearSelection}
						>
							撤销选择
						</Button>
						<Button
							size="compact"
							variant="primary"
							disabled={checked.size === 0 || stale}
							onClick={confirmPartial}
						>
							确认为新草稿
						</Button>
						<Button
							size="compact"
							variant="primary"
							disabled={stale}
							onClick={adoptAsDraft}
						>
							全文采用为新草稿
						</Button>
					</>
				) : (
					<>
						<Button size="compact" onClick={onUndoAdoption}>
							撤销本次采用
						</Button>
						<Button size="compact" variant="primary" onClick={onResumeWriting}>
							回到正文继续写
						</Button>
					</>
				)}
			</div>

			{/* 屏幕阅读器唯一播报源 */}
			<div role="status" aria-live="polite" className="sr-only">
				{announcement}
			</div>
		</div>
	);
}
