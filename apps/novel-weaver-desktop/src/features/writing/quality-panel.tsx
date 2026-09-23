import type { ReviewInboxProjection } from "novel-weaver-core/src/domain/review-inbox.ts";
import { detectFlavorFindings } from "novel-weaver-core/src/qc/flavor-detectors.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { authorErrorMessage, queryProject } from "../../shared/api/rpc";
import { Button, Chip, SevBadge } from "../../shared/ui/components";
import { useWorkspace } from "../../shared/workspace/context";
import { useAssistant } from "./assistant/assistant-context";
import { isFlavorFinding, labelOfFinding } from "./finding-label";
import { anchorOf } from "./prose";

interface ReviewFinding {
	findingId: string;
	severity: "blocking" | "warning" | "advisory";
	confidence: number;
	status: "open" | "resolved" | "false_positive";
	code: string;
	message: string;
}

/**
 * 质量报告 Tab（WF2-13，WF6-09 三组化）：
 * A. 当前正文体检——本地三征确定性复检（与送审并挂同源），定位高亮＋一键精简；
 * B. 审校发现——按 AI味 / 低叙事增量（占位） / 逻辑疑点（占位）三组分桶，
 *    每条可裁决（resolved / false_positive 走提案链）。
 */
export function QualityPanel({ cwd }: { cwd: string }) {
	const ws = useWorkspace();
	const assistant = useAssistant();
	const [error, setError] = useState("");
	const [note, setNote] = useState("");

	// —— A. 实时体检 ——
	const findings = useMemo(
		() => (ws.proseText.trim() ? detectFlavorFindings(ws.proseText) : []),
		[ws.proseText],
	);
	const locate = useCallback(
		(evidence: string[], message: string) => {
			const anchor = anchorOf(evidence, message, ws.proseText);
			if (!anchor) {
				setNote("未能定位到具体段落。");
				return;
			}
			ws.requestProseHighlight(anchor);
		},
		[ws],
	);

	// —— B. 审校发现 ——
	const [reviews, setReviews] = useState<
		Array<{
			proposalId: string;
			subjectTitle: string;
			findings: ReviewFinding[];
		}>
	>([]);
	const [rationaleFor, setRationaleFor] = useState<string | null>(null);
	const [rationaleText, setRationaleText] = useState("");

	const refreshReviews = useCallback(async () => {
		try {
			const queue = await queryProject<ReviewInboxProjection>(
				cwd,
				"list_review_inbox",
				{},
			);
			const sceneIds = queue.proposals
				.filter((item) => item.kind === "scene_candidate")
				.map((item) => item.proposalId);
			const loaded = await Promise.all(
				sceneIds.map(async (proposalId) => {
					try {
						const detail = await queryProject<{
							findings: ReviewFinding[];
						}>(cwd, "get_scene_review", { proposalId });
						return {
							proposalId,
							subjectTitle:
								queue.proposals.find((item) => item.proposalId === proposalId)
									?.subjectTitle ?? "待审场景",
							findings: detail.findings ?? [],
						};
					} catch {
						return {
							proposalId,
							subjectTitle:
								queue.proposals.find((item) => item.proposalId === proposalId)
									?.subjectTitle ?? "待审场景",
							findings: [] as ReviewFinding[],
						};
					}
				}),
			);
			setReviews(loaded.filter((item) => item.findings.length > 0));
			setError("");
		} catch (detail) {
			setError(authorErrorMessage(detail));
		}
	}, [cwd]);

	useEffect(() => {
		void refreshReviews();
	}, [refreshReviews]);

	const adjudicate = async (
		findingId: string,
		resolution: "resolved" | "false_positive",
	) => {
		const rationale =
			rationaleText.trim() ||
			(resolution === "false_positive"
				? "作者判定为误报。"
				: "作者已确认问题处理完毕。");
		try {
			await queryProject(cwd, "create_finding_resolution_proposal", {
				findingId,
				resolution,
				rationale,
			});
			setNote("裁决提案已创建，待批准后生效。");
			setRationaleFor(null);
			setRationaleText("");
			await refreshReviews();
		} catch (detail) {
			setError(authorErrorMessage(detail));
		}
	};

	const openReviews = reviews.map((review) => ({
		...review,
		findings: review.findings.filter((finding) => finding.status === "open"),
	}));
	// B 区三组分桶（WF6-09）：AI味 / 低叙事增量（占位） / 逻辑疑点（占位）＋其他。
	const openEntries = openReviews.flatMap((review) =>
		review.findings.map((finding) => ({
			...finding,
			subjectTitle: review.subjectTitle,
		})),
	);
	const flavorEntries = openEntries.filter((entry) =>
		isFlavorFinding(entry.code),
	);
	const otherEntries = openEntries.filter(
		(entry) => !isFlavorFinding(entry.code),
	);
	const flavorCount = findings.length;

	const renderFindingCard = (finding: (typeof openEntries)[number]) => (
		<div
			key={finding.findingId}
			className="border border-line rounded-md py-2 px-2 grid gap-1 text-[11.5px]"
		>
			<div className="flex gap-1 items-center">
				<SevBadge severity={finding.severity} />
				<b>{labelOfFinding(finding.code)}</b>
				<span className="num ml-auto text-[10px] text-ink-low">
					{finding.subjectTitle}
				</span>
			</div>
			<span className="text-ink-mid leading-[1.7]">{finding.message}</span>
			{rationaleFor === finding.findingId ? (
				<div className="grid gap-1">
					<input
						value={rationaleText}
						onChange={(event) => setRationaleText(event.target.value)}
						placeholder="裁决理由（可留空）"
						className="bg-shell border border-line rounded-sm text-ink-hi text-[11.5px] py-1 px-2 outline-none"
					/>
					<div className="flex gap-1">
						<Button
							variant="primary"
							onClick={() => void adjudicate(finding.findingId, "resolved")}
						>
							确认已解决
						</Button>
						<Button
							onClick={() =>
								void adjudicate(finding.findingId, "false_positive")
							}
						>
							判为误报
						</Button>
						<Button onClick={() => setRationaleFor(null)}>取消</Button>
					</div>
				</div>
			) : (
				<div className="flex gap-1">
					<Button onClick={() => setRationaleFor(finding.findingId)}>
						裁决
					</Button>
				</div>
			)}
		</div>
	);

	return (
		<div className="grid gap-3">
			{error ? <Chip tone="accent">{error}</Chip> : null}
			{note ? <Chip tone="accent">{note}</Chip> : null}

			{/* A. 当前正文体检 */}
			<section className="grid gap-2">
				<p className="eyebrow m-0">
					当前正文体检 · {ws.proseLabel || "未打开正文"}
				</p>
				{!ws.proseText.trim() ? (
					<p className="m-0 text-[11.5px] text-ink-low leading-[1.8]">
						在正文面打开正典场景或手编草稿后，这里实时跑本地三征检查。
					</p>
				) : flavorCount === 0 ? (
					<p className="m-0 text-[11.5px] text-ok">✓ 未检出 AI味信号。</p>
				) : (
					<div className="grid gap-1">
						<p className="num m-0 text-[11px] text-ink-mid">
							检出 {flavorCount} 条疑似 AI味信号：
						</p>
						{findings.map((finding) => (
							<div
								key={finding.code}
								className="border border-line rounded-md py-2 px-2 grid gap-1 text-[11.5px]"
							>
								<div className="flex gap-1 items-center">
									<SevBadge severity={finding.severity} />
									<b>{labelOfFinding(finding.code)}</b>
									<span className="num ml-auto text-[10px] text-ink-low">
										置信 {(finding.confidence * 100).toFixed(0)}%
									</span>
								</div>
								<span className="text-ink-mid leading-[1.7]">
									{finding.message}
								</span>
								<div className="flex gap-1">
									<Button
										onClick={() => locate(finding.evidence, finding.message)}
									>
										定位正文
									</Button>
									<Button
										disabled={assistant.busy || !assistant.continuationReady}
										onClick={() => void assistant.condenseDraft()}
									>
										一键精简全文
									</Button>
								</div>
							</div>
						))}
						<p className="m-0 text-[10.5px] leading-[1.7] text-ink-low">
							一键精简对正文面的手编草稿做缩写改写并整篇替换——可用「来源差异」对比，或放弃草稿回退。
						</p>
					</div>
				)}
			</section>

			{/* B. 审校发现（三组：AI味 / 低叙事增量占位 / 逻辑疑点占位＋其他） */}
			<section className="grid gap-2 border-t border-line pt-3">
				<p className="eyebrow m-0">审校发现 · 待处理</p>
				{openEntries.length === 0 ? (
					<p className="m-0 text-[11.5px] text-ink-low leading-[1.8]">
						候选带「采用→送审」后，未处理的发现在此排队等待裁决。
					</p>
				) : (
					<div className="grid gap-3">
						{flavorEntries.length > 0 ? (
							<div className="grid gap-1">
								<p className="eyebrow m-0 text-ink-mid">AI味信号</p>
								{flavorEntries.map((finding) => renderFindingCard(finding))}
							</div>
						) : null}
						<div className="grid gap-1">
							<p className="eyebrow m-0 text-ink-mid">低叙事增量</p>
							<p className="m-0 text-[10.5px] leading-[1.7] text-ink-low">
								情节推进疑点由语义审校轨产出，该轨尚未上线；上线后此组自动出现发现。
							</p>
						</div>
						<div className="grid gap-1">
							<p className="eyebrow m-0 text-ink-mid">逻辑疑点</p>
							<p className="m-0 text-[10.5px] leading-[1.7] text-ink-low">
								因果与伏笔的语义检查随审校轮次伴生，同样尚未上线。
							</p>
						</div>
						{otherEntries.length > 0 ? (
							<div className="grid gap-1">
								<p className="eyebrow m-0 text-ink-mid">其他发现</p>
								{otherEntries.map((finding) => renderFindingCard(finding))}
							</div>
						) : null}
					</div>
				)}
			</section>
		</div>
	);
}
