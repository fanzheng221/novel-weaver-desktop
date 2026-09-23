import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useReducer, useState } from "react";

import { authorErrorMessage, queryProject } from "../../shared/api/rpc";
import {
  Button,
  Chip,
  EmptyState,
  PAGE,
  Panel,
  SevBadge,
  TextField,
} from "../../shared/ui/components";
import { EMPTY } from "../../shared/ui/copy";
import { cx } from "../../shared/ui/cx";
import { describeRpcError, ErrorState, SkeletonLines, useDelayedFlag } from "../../shared/ui/states";
import type {
  ExportedArtifact,
  PublicationEditionSummary,
  PublicationReviewResult,
} from "novel-weaver-core/src/domain/publication.ts";
import type { ProposalPreview } from "novel-weaver-core/src/domain/proposal.ts";
import type { ReviewInboxProjection } from "novel-weaver-core/src/domain/review-inbox.ts";
import {
  buildPublishSnapshot,
  canConfirm,
  editionNotes,
  findingDeepLink,
  FORMAT_HINT,
  FORMAT_LABEL,
  initialPublishFlowState,
  PUBLISH_FORMATS,
  publishFlowReducer,
  resolveScopeSceneIds,
  scopeHasScenes,
  STEP_LABEL,
  STEP_ORDER,
  type CheckIssue,
  type PendingPublicationSummary,
  type PlanningNode,
  type PublishFormat,
  type PublishSnapshot,
} from "./publish-model";

interface PendingProposal {
  proposalId: string;
  kind: string;
  revision: number;
}

interface CanonicalSceneRow {
  sceneId: string;
}

/** 目录偏好的本地记忆键（跨会话恢复上次导出位置）。 */
function exportDirKey(cwd: string): string {
  return `nw-publish-dir:${cwd}`;
}

/**
 * WF5-16：发布检查 → 创建/选择发布版本 → 作者确认 → 导出的线性流程。
 * 取代原「发布检查清单 + 发布提案列表 + 导出中心」三块互不解释的面板；
 * 每一步只有一个清晰主动作，阻断项逐条深链回修复位置，失败保留输入。
 */
export function PublishFlow({ cwd }: { cwd: string }) {
  const [state, dispatch] = useReducer(
    publishFlowReducer,
    undefined,
    () =>
      initialPublishFlowState(
        readSavedDir(cwd) ?? `${cwd}/exports`,
      ),
  );
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [loadError, setLoadError] = useState<ReturnType<
    typeof describeRpcError
  > | null>(null);
  const [snapshot, setSnapshot] = useState<PublishSnapshot | null>(null);
  const [nodes, setNodes] = useState<PlanningNode[]>([]);
  const [volumes, setVolumes] = useState<PlanningNode[]>([]);
  const [chapters, setChapters] = useState<PlanningNode[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const showSkeleton = useDelayedFlag(phase === "loading");

  const refresh = useCallback(
    async (projectCwd: string) => {
      const [inbox, graph, editions, canonical, pending] = await Promise.all([
        queryProject<ReviewInboxProjection>(projectCwd, "list_review_inbox", {}),
        queryProject<{ nodes: PlanningNode[] }>(projectCwd, "planning_graph_query", {}),
        queryProject<PublicationEditionSummary[]>(
          projectCwd,
          "list_publication_editions",
          {},
        ),
        queryProject<CanonicalSceneRow[]>(projectCwd, "list_canonical_scenes", {}),
        queryProject<PendingProposal[]>(projectCwd, "list_pending_proposals", {}),
      ]);
      const planningNodes = graph.nodes;
      setNodes(planningNodes);
      setVolumes(planningNodes.filter((node) => node.kind === "volume_plan"));
      setChapters(planningNodes.filter((node) => node.kind === "chapter_plan"));
      setSnapshot(
        buildPublishSnapshot({
          inbox,
          planningNodes,
          editions,
          canonicalSceneCount: canonical.length,
          pendingPublications: pending
            .filter((item) => item.kind === "publication")
            .map((item) => ({ proposalId: item.proposalId, revision: item.revision })),
        }),
      );
    },
    [],
  );

  const retryLoad = useCallback(async () => {
    setLoadError(null);
    try {
      await refresh(cwd);
      setPhase("ready");
    } catch (raw) {
      setLoadError(describeRpcError(raw));
      setPhase("failed");
    }
  }, [cwd, refresh]);

  useEffect(() => {
    void retryLoad();
  }, [retryLoad]);

  const jump = (hash: string): void => {
    window.location.hash = hash;
  };

  const saveDir = (directory: string): void => {
    try {
      localStorage.setItem(exportDirKey(cwd), directory);
    } catch {
      /* 隐私模式等场景降级为会话内记忆 */
    }
  };

  const setExportDirectory = (directory: string): void => {
    saveDir(directory);
    dispatch({ type: "setExportDirectory", directory });
  };

  const pickDirectory = async (): Promise<void> => {
    const dir = await open({
      directory: true,
      multiple: false,
      title: "选择导出目录",
    });
    if (typeof dir === "string" && dir) setExportDirectory(dir);
  };

  /** 范围/格式 → 创建提案 → 立即终审；任何一步失败都保留草稿。 */
  const createAndReview = async (): Promise<void> => {
    setActionError("");
    const sceneIds = resolveScopeSceneIds(nodes, state.draft.scope);
    if (!scopeHasScenes(nodes, state.draft.scope)) {
      setActionError("所选范围内还没有挂上场景计划——先在规划区把章节排出来。");
      return;
    }
    setBusy(true);
    try {
      const created = await queryProject<{ proposalId: string; revision: number }>(
        cwd,
        "create_publication_proposal",
        {
          title: state.draft.title.trim() || "发布版本",
          formats: state.draft.formats,
          ...(sceneIds ? { sceneIds } : {}),
        },
      );
      const review = await queryProject<PublicationReviewResult>(
        cwd,
        "review_publication_proposal",
        { proposalId: created.proposalId },
      );
      dispatch({
        type: "proposalReviewed",
        proposal: {
          proposalId: created.proposalId,
          revision: created.revision,
          title: state.draft.title.trim() || "发布版本",
          formats: state.draft.formats,
          sceneCount: sceneIds?.length ?? snapshot?.canonicalSceneCount ?? 0,
          findings: review.findings,
          canPublish: review.canPublish,
        },
      });
    } catch (detail) {
      setActionError(authorErrorMessage(detail));
    } finally {
      setBusy(false);
    }
  };

  /** 继续一个已创建、未定版的发布提案：取回内容并重跑终审。 */
  const continueProposal = async (item: PendingPublicationSummary): Promise<void> => {
    setActionError("");
    setBusy(true);
    try {
      const preview = await queryProject<ProposalPreview>(cwd, "get_proposal", {
        proposalId: item.proposalId,
      });
      const payload = preview.after as {
        title?: string;
        formats?: PublishFormat[];
        scenes?: unknown[];
      };
      const review = await queryProject<PublicationReviewResult>(
        cwd,
        "review_publication_proposal",
        { proposalId: item.proposalId },
      );
      dispatch({
        type: "continueProposal",
        proposal: {
          proposalId: item.proposalId,
          revision: item.revision,
          title: payload.title ?? "发布提案",
          formats: payload.formats ?? ["txt"],
          sceneCount: Array.isArray(payload.scenes) ? payload.scenes.length : 0,
          findings: review.findings,
          canPublish: review.canPublish,
        },
      });
    } catch (detail) {
      setActionError(authorErrorMessage(detail));
    } finally {
      setBusy(false);
    }
  };

  const confirmVersion = async (): Promise<void> => {
    if (!state.proposal) return;
    setActionError("");
    setBusy(true);
    try {
      const accepted = await queryProject<{ editionId?: string }>(cwd, "approve_proposal", {
        proposalId: state.proposal.proposalId,
        expectedRevision: state.proposal.revision,
      });
      if (!accepted.editionId) throw new Error("批准未返回发布版本编号。");
      dispatch({ type: "confirmAccepted", editionId: accepted.editionId });
      void refresh(cwd);
    } catch (detail) {
      setActionError(authorErrorMessage(detail));
    } finally {
      setBusy(false);
    }
  };

  const exportEditionNow = async (): Promise<void> => {
    if (!state.edition || !state.export.directory.trim()) return;
    dispatch({ type: "exportStarted" });
    try {
      const result = await queryProject<{ editionId: string; artifacts: ExportedArtifact[] }>(
        cwd,
        "export_publication",
        {
          editionId: state.edition.editionId,
          outputDirectory: state.export.directory.trim(),
        },
      );
      dispatch({ type: "exportSucceeded", artifacts: result.artifacts });
    } catch (detail) {
      dispatch({ type: "exportFailed", error: authorErrorMessage(detail) });
    }
  };

  const renderIssue = (issue: CheckIssue) => (
    <div
      key={issue.key}
      className="flex items-center gap-2 border-t border-line py-2 px-0.5 text-[12px]"
    >
      <SevBadge severity={issue.severity === "blocking" ? "blocking" : "warning"} />
      <span className="min-w-0 flex-1 text-ink-hi leading-[1.6]">{issue.title}</span>
      {issue.deepLink ? (
        <Button onClick={() => jump(issue.deepLink!.hash)}>{issue.deepLink.label}</Button>
      ) : null}
    </div>
  );

  return (
    <main className={PAGE}>
      <header>
        <p className="eyebrow">NOVEL WEAVER / PUBLISH</p>
        <h1 className="font-wenkai text-[22px] mt-0.5 mb-0">发布</h1>
      </header>

      {actionError ? (
        <div role="alert">
          <Chip tone="accent">{actionError}</Chip>
        </div>
      ) : null}

      {phase === "failed" && loadError ? (
        <ErrorState
          message={loadError.message}
          detail={loadError.detail}
          onRetry={() => void retryLoad()}
        />
      ) : null}
      {phase === "loading" && showSkeleton ? <SkeletonLines lines={3} /> : null}

      {phase === "ready" && snapshot ? (
        <>
          <nav aria-label="发布流程步骤">
            <ol className="flex flex-wrap gap-1 m-0 p-0 list-none" data-testid="publish-steps">
              {STEP_ORDER.map((step, index) => (
                <li key={step} className="flex items-center gap-1">
                  {index > 0 ? (
                    <span aria-hidden className="text-ink-low text-[12px]">
                      →
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-current={state.step === step ? "step" : undefined}
                    disabled={
                      (step === "confirm" && !state.proposal) ||
                      (step === "export" && !state.edition)
                    }
                    onClick={() => dispatch({ type: "goToStep", step })}
                    className={cx(
                      "ui-plain hitpad cursor-pointer rounded-sm px-2 py-1 text-[12px]",
                      state.step === step
                        ? "bg-rail-active text-accent-text font-semibold"
                        : "text-ink-mid",
                    )}
                  >
                    {STEP_LABEL[step]}
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          {state.step === "check" ? (
            <section className="grid gap-2" aria-label="发布检查">
              <Panel title="发布检查">
                <p className="m-0 text-[13px] leading-[1.8] text-ink-hi" data-testid="publish-summary">
                  {snapshot.summary}
                </p>
                {snapshot.issues.length > 0 ? (
                  <div className="grid gap-1 mt-2" data-testid="publish-issues">
                    {snapshot.issues.map(renderIssue)}
                  </div>
                ) : (
                  <p className="m-0 mt-2 text-[12px] text-ok">
                    ✓ 没有发现阻断项——可以创建发布版本。
                  </p>
                )}
                <p className="m-0 mt-2 text-[11px] leading-[1.65] text-ink-low">
                  这里的检查按全书范围聚合；选择单卷或单章发布时，以创建版本后的终审结果为准。
                </p>
                {snapshot.canCreateVersion ? (
                  <div className="flex gap-2 mt-2">
                    {snapshot.readyToPublish ? (
                      <Button
                        variant="primary"
                        onClick={() => dispatch({ type: "goToStep", step: "version" })}
                      >
                        继续：选择或创建发布版本
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        onClick={() => void refresh(cwd).then(() => setActionError(""))}
                      >
                        重新检查
                      </Button>
                    )}
                  </div>
                ) : (
                  <EmptyState
                    as="h2"
                    glyph={EMPTY.publish.glyph}
                    title={EMPTY.publish.title}
                    hint={EMPTY.publish.hint}
                    actions={
                      <Button variant="primary" onClick={() => jump("#/writing")}>
                        {EMPTY.publish.actionLabel}
                      </Button>
                    }
                  />
                )}
              </Panel>
            </section>
          ) : null}

          {state.step === "version" ? (
            <section className="grid gap-2" aria-label="发布版本">
              {snapshot.pendingPublications.length > 0 ? (
                <Panel title={`待确认的发布提案 · ${snapshot.pendingPublications.length}`}>
                  <div className="grid gap-2">
                    {snapshot.pendingPublications.map((item) => (
                      <div
                        key={item.proposalId}
                        className="flex items-center gap-2 border-t border-line py-2 px-0.5 text-[12px]"
                      >
                        <span className="min-w-0 flex-1">
                          上次创建的发布提案还没定版——继续就能完成终审与定版。
                        </span>
                        <Button
                          variant="primary"
                          busy={busy}
                          onClick={() => void continueProposal(item)}
                        >
                          继续确认
                        </Button>
                      </div>
                    ))}
                  </div>
                </Panel>
              ) : null}

              <Panel title="已定稿的发布版本">
                {snapshot.editions.length === 0 ? (
                  <p className="m-0 text-[12px] text-ink-mid">还没有定稿的发布版本。</p>
                ) : (
                  <div className="grid gap-2" data-testid="publish-editions">
                    {snapshot.editions.map((edition) => (
                      <EditionRow key={edition.editionId} edition={edition} onExport={() => {
                        dispatch({ type: "selectEdition", edition });
                      }} />
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="创建新发布版本">
                <div className="grid gap-2">
                  <p className="eyebrow m-0">范围</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={state.draft.scope.mode === "book" ? "primary" : "ghost"}
                      onClick={() => dispatch({ type: "editDraft", patch: { scope: { mode: "book" } } })}
                    >
                      全书 · {chapters.length} 章
                    </Button>
                    {volumes.map((volume) => (
                      <Button
                        key={volume.id}
                        variant={
                          state.draft.scope.mode === "volume" && state.draft.scope.id === volume.id
                            ? "primary"
                            : "ghost"
                        }
                        onClick={() =>
                          dispatch({
                            type: "editDraft",
                            patch: { scope: { mode: "volume", id: volume.id } },
                          })
                        }
                      >
                        {volume.title}
                      </Button>
                    ))}
                  </div>
                  <select
                    aria-label="按单章选择范围"
                    value={state.draft.scope.mode === "chapter" ? state.draft.scope.id : ""}
                    onChange={(event) =>
                      dispatch({
                        type: "editDraft",
                        patch: {
                          scope: event.target.value
                            ? { mode: "chapter", id: event.target.value }
                            : { mode: "book" },
                        },
                      })
                    }
                    className="bg-shell border border-line rounded-sm text-ink-hi text-[13px] px-2 py-2"
                  >
                    <option value="">按单章选择…</option>
                    {chapters.map((chapter) => (
                      <option key={chapter.id} value={chapter.id}>
                        {chapter.title}
                      </option>
                    ))}
                  </select>

                  <TextField
                    label="发布版本标题"
                    value={state.draft.title}
                    onChange={(title) => dispatch({ type: "editDraft", patch: { title } })}
                  />

                  <p className="eyebrow m-0">格式</p>
                  <div className="grid grid-cols-[1fr_1fr] gap-2">
                    {PUBLISH_FORMATS.map((format) => {
                      const selected = state.draft.formats.includes(format);
                      return (
                        <button
                          key={format}
                          type="button"
                          aria-pressed={selected}
                          onClick={() =>
                            dispatch({
                              type: "editDraft",
                              patch: {
                                formats: selected
                                  ? state.draft.formats.filter((item) => item !== format)
                                  : [...state.draft.formats, format],
                              },
                            })
                          }
                          className={cx(
                            "ui-plain block w-full text-left cursor-pointer rounded-md px-3 py-2",
                            selected
                              ? "border border-accent bg-accent-soft"
                              : "border border-line bg-transparent",
                          )}
                        >
                          <b className="text-[13px]">{FORMAT_LABEL[format]}</b>
                          <p className="mt-1 text-[10px] text-ink-low">{FORMAT_HINT[format]}</p>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={() => dispatch({ type: "goToStep", step: "check" })}>
                      上一步
                    </Button>
                    <Button
                      variant="primary"
                      busy={busy}
                      disabled={
                        state.draft.formats.length === 0 ||
                        !scopeHasScenes(nodes, state.draft.scope)
                      }
                      onClick={() => void createAndReview()}
                    >
                      {busy ? "创建并检查中…" : "创建并检查"}
                    </Button>
                  </div>
                  {!scopeHasScenes(nodes, state.draft.scope) ? (
                    <p className="m-0 text-[11.5px] leading-[1.65] text-ink-low">
                      这个范围还没有可发布的内容——先把场景确认入正典，或在规划区排好章节。
                    </p>
                  ) : null}
                </div>
              </Panel>
            </section>
          ) : null}

          {state.step === "confirm" && state.proposal ? (
            <section className="grid gap-2" aria-label="确认定版">
              <Panel title="确认定版">
                <div className="grid gap-2">
                  <p className="m-0 text-[13px] leading-[1.8] text-ink-hi">
                    《{state.proposal.title}》 · {state.proposal.sceneCount} 个场景 ·{" "}
                    {state.proposal.formats.map((format) => FORMAT_LABEL[format]).join(" / ")}
                  </p>
                  <p className="m-0 text-[12px] leading-[1.8] text-ink-mid">
                    定版后这一版不会再改变；之后修改正文会生成新的候选，需要再创建新版本。
                  </p>
                  {state.proposal.findings.length > 0 ? (
                    <div className="grid gap-2">
                      {state.proposal.findings.map((finding) => {
                        const deepLink = findingDeepLink(finding);
                        return (
                          <div
                            key={`${finding.code}:${finding.message}`}
                            className={cx(
                              "grid gap-1 rounded-md px-2 py-2 text-[12px]",
                              finding.severity === "blocking"
                                ? "border border-blocking"
                                : "border border-line",
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <SevBadge
                                severity={
                                  finding.severity === "blocking"
                                    ? "blocking"
                                    : "warning"
                                }
                              />
                              <span className="min-w-0 flex-1 leading-[1.6]">
                                {finding.message}
                              </span>
                              {deepLink ? (
                                <Button onClick={() => jump(deepLink.hash)}>
                                  {deepLink.label}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="m-0 text-[12px] text-ok">✓ 终审通过，没有阻断项。</p>
                  )}
                  <div className="flex gap-2">
                    <Button onClick={() => dispatch({ type: "goToStep", step: "version" })}>
                      上一步
                    </Button>
                    {canConfirm(state.proposal) ? (
                      <Button variant="primary" busy={busy} onClick={() => void confirmVersion()}>
                        {busy ? "定版中…" : "确认定版"}
                      </Button>
                    ) : (
                      <Button variant="primary" disabled>
                        确认定版
                      </Button>
                    )}
                  </div>
                  {!canConfirm(state.proposal) ? (
                    <p className="m-0 text-[11.5px] leading-[1.65] text-blocking">
                      存在阻断项，处理完上面的条目后，回到发布检查重新创建版本。
                    </p>
                  ) : null}
                </div>
              </Panel>
            </section>
          ) : null}

          {state.step === "export" && state.edition ? (
            <section className="grid gap-2" aria-label="导出">
              <Panel title="导出">
                <div className="grid gap-2">
                  <p className="m-0 text-[13px] leading-[1.8] text-ink-hi">
                    《{state.edition.title}》 ·{" "}
                    {state.edition.formats.map((format) => FORMAT_LABEL[format]).join(" / ")}
                  </p>
                  <p className="m-0 text-[12px] leading-[1.8] text-ink-mid">
                    这版已定稿，可以重复导出；导出不会改动已批准的内容。
                  </p>
                  <TextField
                    label="导出目录（绝对路径）"
                    value={state.export.directory}
                    onChange={setExportDirectory}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void pickDirectory()}>浏览…</Button>
                    <Button
                      variant="primary"
                      busy={state.export.phase === "exporting"}
                      disabled={state.export.phase === "exporting" || !state.export.directory.trim()}
                      onClick={() => void exportEditionNow()}
                    >
                      {state.export.phase === "exporting"
                        ? "导出中…"
                        : state.export.phase === "failed"
                          ? "重试导出"
                          : "导出到目录"}
                    </Button>
                  </div>
                  {state.export.phase === "failed" && state.export.error ? (
                    <div
                      className="grid gap-1 border border-blocking rounded-md px-2 py-2 text-[12px]"
                      data-testid="publish-export-error"
                    >
                      <span className="leading-[1.7]">{state.export.error}</span>
                      <span className="text-ink-mid leading-[1.7]">
                        目录、格式与版本都保留着——更换目录或删除同名文件后，点「重试导出」。
                      </span>
                    </div>
                  ) : null}
                  {state.export.phase === "done" && state.export.artifacts ? (
                    <div className="grid gap-2" data-testid="publish-artifacts">
                      <p className="eyebrow m-0">导出完成</p>
                      {state.export.artifacts.map((artifact) => (
                        <div
                          key={artifact.format}
                          className="grid gap-1 border border-line rounded-md px-3 py-2 text-[12px]"
                        >
                          <b>{FORMAT_LABEL[artifact.format as PublishFormat] ?? artifact.format}</b>
                          <span
                            className="num text-ink-mid overflow-hidden text-ellipsis whitespace-nowrap"
                            title={artifact.path}
                          >
                            {artifact.path}
                          </span>
                          <span className="num text-ink-low text-[10px]">
                            {(artifact.bytes / 1024).toFixed(1)} KB · sha256{" "}
                            {artifact.sha256.slice(0, 12)}…
                          </span>
                        </div>
                      ))}
                      <p className="m-0 text-[11.5px] leading-[1.65] text-ink-low">
                        还需要别的格式？回上一步创建新版本时勾选即可。
                      </p>
                    </div>
                  ) : null}
                </div>
              </Panel>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

function EditionRow({
  edition,
  onExport,
}: {
  edition: PublicationEditionSummary;
  onExport: () => void;
}) {
  const notes = editionNotes(edition);
  return (
    <div className="grid gap-1 border-t border-line py-2 px-0.5 text-[12px]">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-ink-hi leading-[1.6]">
          《{edition.title}》 · {edition.sceneCount} 个场景 ·{" "}
          {edition.formats.map((format) => FORMAT_LABEL[format]).join(" / ")}
        </span>
        <Button variant="primary" onClick={onExport}>
          导出这一版
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="num text-[10px] text-ink-low">
          {edition.createdAt.slice(0, 16).replace("T", " ")}
        </span>
        {edition.scenesChanged > 0 ? (
          <Chip tone="accent">正文已更新</Chip>
        ) : (
          <Chip>与最新正文一致</Chip>
        )}
      </div>
      {notes.map((note) => (
        <p key={note} className="m-0 text-[11.5px] leading-[1.65] text-ink-low">
          {note}
        </p>
      ))}
    </div>
  );
}

function readSavedDir(cwd: string): string | null {
  try {
    return localStorage.getItem(exportDirKey(cwd));
  } catch {
    return null;
  }
}
