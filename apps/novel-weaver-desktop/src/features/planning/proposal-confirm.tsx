import { useEffect, useRef, useState } from "react";
import { queryProject } from "../../shared/api/rpc";
import { Button, InlineNote } from "../../shared/ui/components";
import { describeRpcError } from "../../shared/ui/states";
import {
	approveProposalRobust,
	describeProposalImpact,
	type ProposalImpact,
	type ProposalPreviewLite,
} from "./confirm-model";
import type { PlanningEdge, PlanningNode } from "./planning-model";

/**
 * WF5-10「预览影响→确认纳入」共用段：创建/编辑提案后原位预览影响，
 * 「确认纳入」当场批准（无需跳页），「稍后再说」留在右侧待审面板。
 */

export const CONFIRM_APPROVE = "确认纳入";
export const CONFIRM_DEFER = "稍后再说";

type ConfirmState =
	| { step: "loading" }
	| { step: "ready"; impact: ProposalImpact }
	| { step: "approving"; impact: ProposalImpact }
	| { step: "failed"; message: string; detail: string };

export function ProposalConfirm({
	cwd,
	proposalId,
	revision,
	graph,
	idNames,
	onApproved,
	onDeferred,
}: {
	cwd: string;
	proposalId: string;
	revision: number;
	graph: { nodes: PlanningNode[]; edges: PlanningEdge[] } | null;
	idNames: Map<string, string>;
	onApproved: () => void;
	onDeferred: () => void;
}) {
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<ConfirmState>({ step: "loading" });
	const confirmRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		if (state.step === "ready") confirmRef.current?.focus();
	}, [state.step]);

	useEffect(() => {
		let cancelled = false;
		setState({ step: "loading" });
		const load = async () => {
			try {
				const preview = await queryProject<ProposalPreviewLite>(
					cwd,
					"get_proposal",
					{ proposalId },
				);
				if (!cancelled) {
					setState({
						step: "ready",
						impact: describeProposalImpact({ preview, graph, idNames }),
					});
				}
			} catch (raw) {
				if (!cancelled) {
					const parts = describeRpcError(raw);
					setState({
						step: "failed",
						message: parts.message,
						detail: parts.detail ?? "",
					});
				}
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [cwd, proposalId, attempt, graph, idNames]);

	const approve = async (impact: ProposalImpact) => {
		setState({ step: "approving", impact });
		try {
			await approveProposalRobust(
				{ query: queryProject, cwd },
				proposalId,
				revision,
			);
			onApproved();
		} catch (raw) {
			const parts = describeRpcError(raw);
			setState({
				step: "failed",
				message: parts.message,
				detail: parts.detail ?? "",
			});
		}
	};

	if (state.step === "loading") {
		return <p className="m-0 text-[12px] text-ink-mid">正在读取提案影响…</p>;
	}

	if (state.step === "failed") {
		return (
			<div role="alert" className="grid gap-2">
				<InlineNote tone="danger">操作没有完成：{state.message}</InlineNote>
				<Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
					重试
				</Button>
				{state.detail ? (
					<details>
						<summary className="cursor-pointer text-[10.5px] text-ink-low">
							技术详情
						</summary>
						<pre className="num mt-1 p-[8px_10px] text-[10px] leading-[1.6] whitespace-pre-wrap break-all max-h-35 overflow-y-auto bg-shell rounded-sm text-ink-mid">
							{state.detail}
						</pre>
					</details>
				) : null}
			</div>
		);
	}

	const { impact } = state;

	return (
		<div
			className="grid gap-2"
			data-testid="proposal-confirm"
			aria-busy={state.step === "approving"}
		>
			<p className="m-0 text-[12px] font-semibold text-ink-hi">
				{impact.isNew ? "待纳入：" : "待确认更改："}
				{impact.title}
				<span className="ml-1.5 text-[10.5px] text-ink-low font-normal">
					{impact.kindLabel}
				</span>
			</p>
			{state.step === "approving" ? (
				<p className="m-0 text-[12px] text-ink-mid">
					正在纳入「{impact.title}」…
				</p>
			) : (
				<>
					<dl className="grid gap-1 m-0">
						{impact.fieldDiffs.map((diff, index) => (
							<div key={index} className="grid gap-0.5">
								{/* 扁平读出来是「目标: （新增） → 值」的一行话差异。 */}
								<dt className="eyebrow m-0">{diff.label}: </dt>
								<dd className="m-0 text-[12px] leading-[1.6] text-ink-mid">
									{diff.before !== null ? (
										<span className="text-ink-low line-through mr-1.5">
											{diff.before}
										</span>
									) : (
										<span>（新增）</span>
									)}
									<span
										className={diff.before !== null ? "text-accent-text" : ""}
									>
										{" → "}
										{diff.after}
									</span>
								</dd>
							</div>
						))}
					</dl>
					{impact.dependents.length > 0 ? (
						<p className="m-0 text-[11.5px] leading-[1.6] text-ink-low">
							依赖此工件的规划：{impact.dependents.join("、")}
						</p>
					) : null}
					<div className="flex gap-2">
						<Button variant="primary" onClick={() => void approve(impact)}>
							{CONFIRM_APPROVE}
						</Button>
						<Button onClick={onDeferred}>{CONFIRM_DEFER}</Button>
					</div>
					{/* 确认纳入是恢复点：就绪即聚焦（Button 不透传 ref，用原生查询）。 */}
					<button
						ref={confirmRef}
						data-testid="confirm-approve-anchor"
						className="sr-only"
						tabIndex={-1}
						aria-hidden
						type="button"
					/>
				</>
			)}
		</div>
	);
}
