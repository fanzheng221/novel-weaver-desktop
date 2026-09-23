import { X } from "lucide-react";
import { IconButton } from "../../../shared/ui/icons";
import { useState } from "react";
import { Button, Chip, InlineNote } from "../../../shared/ui/components";
import { cx } from "../../../shared/ui/cx";
import { useAssistant } from "./assistant-context";
import { lineDiff } from "./intents";
import type { AssistantCandidate } from "./machine";

/**
 * 助手结果区（WF5-07）：三类意图各自的产出展示。
 * 候选卡只提供采用/送审/对比——双稿精细裁决由 WF5-09 交付。
 */

function CandidateCard({
	candidate,
	index,
}: {
	candidate: AssistantCandidate;
	index: number;
}) {
	const assistant = useAssistant();
	const [selected, setSelected] = useState<string | null>(null);
	const busy = assistant.busy;
	return (
		<div className="border border-line rounded-md p-2 grid gap-1.5">
			<div className="flex gap-1 items-center">
				<Chip tone="accent">候选 {index + 1}</Chip>
				<span className="num text-[10px] text-ink-low">
					{candidate.usage.promptTokens}/{candidate.usage.completionTokens}{" "}
					tokens
				</span>
				<span className="ml-auto inline-flex gap-1">
					{!candidate.adopted ? (
						candidate.usedAsDraft ? (
							// WF5-09：双稿裁决已转手编草稿；候选保留可追溯，不再提供采用。
							<Chip tone="accent">已转草稿</Chip>
						) : (
							<Button
								variant="primary"
								size="compact"
								disabled={busy}
								onClick={() => void assistant.adoptCandidate(candidate)}
							>
								采用
							</Button>
						)
					) : (
						<>
							<Chip tone="accent">已入待审</Chip>
							<Button
								size="compact"
								disabled={busy || candidate.reviewed}
								onClick={() => void assistant.reviewCandidate(candidate)}
							>
								送审
							</Button>
						</>
					)}
				</span>
			</div>
			<textarea
				readOnly
				value={candidate.markdown}
				onMouseUp={(event) => {
					void event;
					const text = window.getSelection()?.toString().trim() ?? "";
					if (text.length > 8 && !candidate.adopted) setSelected(text);
					else setSelected(null);
				}}
				className="font-wenkai text-[13px] leading-[1.9] text-prose-ink max-h-50 overflow-auto select-text w-full bg-transparent border-0 resize-y m-0"
			/>
			{selected ? (
				<p className="m-0 text-[10.5px] text-ink-low">
					已选中 {selected.length}{" "}
					字——候选级选区重写将随双稿裁决（WF5-09）一并交付。
				</p>
			) : null}
		</div>
	);
}

function DiffOverlay({
	ids,
	onClose,
}: {
	ids: [string, string];
	onClose: () => void;
}) {
	const assistant = useAssistant();
	const [a, b] = ids;
	const first = assistant.state.candidates.find(
		(candidate) => candidate.id === a,
	);
	const second = assistant.state.candidates.find(
		(candidate) => candidate.id === b,
	);
	return (
		<>
			<button
				type="button"
				aria-label="关闭双稿对比"
				onClick={onClose}
				style={{
					position: "fixed",
					inset: 0,
					zIndex: 88,
					background: "rgba(10,10,12,.6)",
					border: "none",
					padding: 0,
					cursor: "default",
				}}
			/>
			<div
				className="bg-rail border border-line rounded-lg p-3 max-h-[80vh] overflow-y-auto"
				style={{
					position: "fixed",
					left: "50%",
					top: "50%",
					transform: "translate(-50%, -50%)",
					zIndex: 89,
					width: 760,
					maxWidth: "94vw",
				}}
			>
				<div className="flex mb-2">
					<b>双稿对比</b>
					<IconButton icon={X} label="关闭" onClick={onClose} />
				</div>
				<div className="grid grid-cols-[1fr_1fr] gap-2">
					{[first, second].map((candidate, position) => (
						<div
							key={candidate?.id ?? position}
							className="border border-line rounded-md p-2 max-h-80 overflow-auto"
						>
							<Chip tone="accent">{candidate?.title ?? "—"}</Chip>
							<pre className="whitespace-pre-wrap font-wenkai text-[12.5px] leading-[1.9] m-0 mt-2">
								{lineDiff(
									position === 0
										? (second?.markdown ?? "")
										: (first?.markdown ?? ""),
									candidate?.markdown ?? "",
								).map((part, partIndex) => (
									<span
										key={`${part.kind}-${partIndex}`}
										className={cx(
											part.kind === "add"
												? "bg-[rgba(127,168,140,0.25)]"
												: part.kind === "del"
													? "bg-[rgba(140,58,43,0.22)]"
													: undefined,
										)}
									>
										{part.text}
										{"\n"}
									</span>
								))}
							</pre>
						</div>
					))}
				</div>
			</div>
		</>
	);
}

export function AssistantResults() {
	const assistant = useAssistant();
	const { state } = assistant;
	const [compareIds, setCompareIds] = useState<[string, string] | null>(null);

	if (state.intent === "generate" && state.candidates.length > 0) {
		return (
			<div className="grid gap-2">
				<div className="flex items-center gap-1.5">
					<p className="eyebrow m-0">候选 · {state.candidates.length}</p>
					{state.candidates.length >= 2 ? (
						<Button
							size="compact"
							onClick={() =>
								setCompareIds([
									state.candidates[0]?.id ?? "",
									state.candidates[1]?.id ?? "",
								])
							}
						>
							对比最近两稿
						</Button>
					) : null}
				</div>
				{state.candidates.map((candidate, index) => (
					<CandidateCard
						key={candidate.id}
						candidate={candidate}
						index={index}
					/>
				))}
				{compareIds ? (
					<DiffOverlay ids={compareIds} onClose={() => setCompareIds(null)} />
				) : null}
			</div>
		);
	}
	if (state.intent === "discuss" && state.discussion) {
		return (
			<div className="border border-line rounded-md p-2.5 grid gap-1.5">
				<p className="eyebrow m-0">推演回应</p>
				<div className="whitespace-pre-wrap text-[12.5px] leading-[1.9] text-ink-hi">
					{state.discussion}
				</div>
				<div className="flex gap-1">
					<Button size="compact" onClick={assistant.clearResponse}>
						清空回应
					</Button>
				</div>
			</div>
		);
	}
	if (state.intent === "inspect" && state.suggestions) {
		return (
			<div className="border border-line rounded-md p-2.5 grid gap-1.5">
				<p className="eyebrow m-0">检查建议（由你决定是否修订）</p>
				<div className="whitespace-pre-wrap text-[12.5px] leading-[1.9] text-ink-hi">
					{state.suggestions}
				</div>
				<InlineNote tone="success">
					建议不会自动改正文，也不会关闭任何审校问题。
				</InlineNote>
			</div>
		);
	}
	return null;
}
