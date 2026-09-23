import { Button, InlineNote, Panel } from "../../shared/ui/components";
import type { PendingProposal } from "./lore-model";

/**
 * 待审设定提案（WF5-11）：连续确认流的批准端——表单提交提案后
 * 就近批准生效，不要求作者跨工作区跑一趟。错误就近呈现且保留队列。
 */
export function PendingProposals({
	pending,
	error,
	onApprove,
}: {
	pending: PendingProposal[];
	error: string | null;
	onApprove: (proposal: PendingProposal) => void;
}) {
	return (
		<Panel title={`待审设定提案 · ${pending.length}`}>
			{error ? (
				<div className="mb-2">
					<InlineNote tone="danger">{error}</InlineNote>
				</div>
			) : null}
			{pending.length === 0 ? (
				<p className="text-[12px] text-ink-mid">没有待审的设定提案。</p>
			) : (
				<div className="grid gap-1">
					{pending.map((proposal) => (
						<div key={proposal.proposalId} className="flex flex-wrap items-center gap-2">
							<span className="num text-[10.5px] text-ink-low">
								{proposal.subjectTitle ?? "设定变更"} · 第 {proposal.revision} 次提交
							</span>
							<Button variant="primary" onClick={() => onApprove(proposal)}>
								批准
							</Button>
						</div>
					))}
				</div>
			)}
		</Panel>
	);
}
