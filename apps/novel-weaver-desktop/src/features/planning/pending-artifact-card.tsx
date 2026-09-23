import type { ReviewInboxProposal } from "novel-weaver-core/src/domain/review-inbox.ts";
import { useState } from "react";
import { authorErrorMessage, queryProject } from "../../shared/api/rpc";
import { Button, InlineNote } from "../../shared/ui/components";
import { describeProposalImpact, type ProposalPreviewLite } from "./confirm-model";
import type { PlanningEdge, PlanningNode } from "./planning-model";
import { ProposalConfirm } from "./proposal-confirm";

/** A stale proposal is never silently approved against a different baseline. */
export function PendingArtifactCard({
  cwd,
  proposal,
  graph,
  idNames,
  onApproved,
}: {
  cwd: string;
  proposal: ReviewInboxProposal;
  graph: { nodes: PlanningNode[]; edges: PlanningEdge[] } | null;
  idNames: Map<string, string>;
  onApproved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [comparison, setComparison] = useState<{
    preview: ProposalPreviewLite;
    current: PlanningNode;
    graph: NonNullable<typeof graph>;
  } | null>(null);
  const [replacement, setReplacement] = useState<{ proposalId: string; revision: number } | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const stale = proposal.staleness === "canonical_changed";
  const inspect = async () => {
    setBusy(true);
    setError("");
    try {
      const [preview, freshGraph] = await Promise.all([
        queryProject<ProposalPreviewLite>(cwd, "get_proposal", { proposalId: proposal.proposalId }),
        queryProject<NonNullable<typeof graph>>(cwd, "planning_graph_query", {}),
      ]);
      const current = freshGraph.nodes.find((node) => node.id === proposal.target?.id);
      if (!current) throw new Error("未找到当前正式规划，请刷新规划区后重试。");
      setComparison({ preview, current, graph: freshGraph });
    } catch (raw) {
      setError(authorErrorMessage(raw));
    } finally {
      setBusy(false);
    }
  };
  const resubmit = async () => {
    if (!comparison) return;
    setBusy(true);
    setError("");
    try {
      const after = comparison.preview.after as { title: string; content: Record<string, unknown> };
      const result = await queryProject<{ proposalId: string; revision: number }>(
        cwd,
        "create_artifact_proposal",
        {
          artifactId: comparison.current.id,
          supersedesProposalId: proposal.proposalId,
          sourceVersionId: comparison.current.versionId,
          kind: comparison.current.kind,
          title: after.title,
          content: after.content,
          dependencyIds: comparison.graph.edges
            .filter((edge) => edge.targetId === comparison.current.id)
            .map((edge) => edge.sourceId),
        },
      );
      setReplacement(result);
    } catch (raw) {
      setError(authorErrorMessage(raw));
    } finally {
      setBusy(false);
    }
  };
  const changes = comparison
    ? describeProposalImpact({
        preview: {
          ...comparison.preview,
          before: { title: comparison.current.title, content: comparison.current.content },
        },
        graph: comparison.graph,
        idNames,
      }).fieldDiffs
    : [];
  return (
    <div className="grid gap-2 border border-line rounded-sm p-2 min-w-0">
      <p className="m-0 text-[12px] text-ink-hi wrap-break-word">
        {proposal.subjectTitle ?? "规划变更"}
      </p>
      <p className="m-0 text-[11px] text-ink-low">
        第 {proposal.revision} 次提交 · {proposal.createdAt.slice(0, 16).replace("T", " ")}
      </p>
      {stale && !replacement ? (
        <>
          <InlineNote tone="danger">
            正式规划已更新。这份提案基于旧版本，核对差异后可重新提交。
          </InlineNote>
          <Button busy={busy} onClick={() => void inspect()}>
            核对最新内容
          </Button>
          {comparison ? (
            <div className="grid gap-2">
              <p className="m-0 text-[12px] text-ink-mid">
                左侧为当前正式内容，右侧为原提案。重新提交会保留当前依赖关系，并以右侧内容创建新提案；原提案保留供追溯。
              </p>
              {changes.length ? (
                changes.map((diff) => (
                  <p key={diff.label} className="m-0 text-[12px] wrap-break-word">
                    {diff.label}: {diff.before || "（空）"} → {diff.after || "（清空）"}
                  </p>
                ))
              ) : (
                <p>内容与当前版本相同，无需重复纳入。</p>
              )}
              <Button disabled={!changes.length} busy={busy} onClick={() => void resubmit()}>
                基于最新版本重新提交
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {replacement || expanded ? (
        <ProposalConfirm
          cwd={cwd}
          proposalId={replacement?.proposalId ?? proposal.proposalId}
          revision={replacement?.revision ?? proposal.revision}
          graph={comparison?.graph ?? graph}
          idNames={idNames}
          onApproved={onApproved}
          onDeferred={() => {
            setExpanded(false);
            if (replacement) onApproved();
          }}
        />
      ) : !stale ? (
        <Button onClick={() => setExpanded(true)}>预览并批准</Button>
      ) : null}
      {error ? <InlineNote>{error}</InlineNote> : null}
      <details>
        <summary className="cursor-pointer text-[10.5px] text-ink-low">高级 · 提案编号</summary>
        <p className="text-[11px] break-all">{proposal.proposalId}</p>
      </details>
    </div>
  );
}
