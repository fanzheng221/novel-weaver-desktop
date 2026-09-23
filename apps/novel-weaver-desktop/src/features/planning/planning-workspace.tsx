import type { CanonicalSceneSummary } from "novel-weaver-core/src/domain/scene.ts";
import type { ReviewInboxProjection, ReviewInboxProposal } from "novel-weaver-core/src/domain/review-inbox.ts";
import { entityTypeLabel } from "../../shared/ui/terms";
import { PendingArtifactCard } from "./pending-artifact-card";
import { X } from "lucide-react";
import { IconButton } from "../../shared/ui/icons";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ARTIFACT_KIND_LABEL,
  ArtifactProposalForm,
} from "./outline/artifact-proposal-form";
import { ChapterDrawer } from "./outline/chapter-drawer";
import { authorErrorMessage, queryProject } from "../../shared/api/rpc";
import { useAssistant } from "../writing/assistant/assistant-context";
import { Button, Chip, EmptyState, InlineNote, Panel } from "../../shared/ui/components";
import { EMPTY } from "../../shared/ui/copy";
import { cx } from "../../shared/ui/cx";
import { readFocusTarget } from "../../shared/ui/deep-link";
import { cardWallContainerVariants, cardWallItemVariants } from "../../shared/ui/motion";
import {
  describeRpcError,
  ErrorState,
  SkeletonLines,
  useDelayedFlag,
} from "../../shared/ui/states";
import { NodeDetails } from "./node-details";
import { OutlineSummary } from "./outline-summary";
import { PhaseDot, PlanningTree } from "./planning-tree";
import {
  buildPlanningTree,
  nextActionOf,
  PHASE_LABEL,
  type PhaseKey,
  type PlanningEdge,
  type PlanningNode,
  type ReleaseRow,
} from "./planning-model";
import { SplitChaptersFlow } from "./split-chapters-flow";

interface EntityLite {
  id: string;
  type: string;
  canonicalName: string;
}

type PendingProposal = ReviewInboxProposal;

type ViewMode = "tree" | "kanban";

/** WF5-10 树优先规划区：默认树、零章唯一下一步、按需看板、连续确认流。 */
export function PlanningWorkspace({ cwd }: { cwd: string }) {
  const [graph, setGraph] = useState<{
    nodes: PlanningNode[];
    edges: PlanningEdge[];
  } | null>(null);
  const [releaseRows, setReleaseRows] = useState<ReleaseRow[]>([]);
  const [canonicalScenes, setCanonicalScenes] = useState<CanonicalSceneSummary[]>([]);
  const [entities, setEntities] = useState<EntityLite[]>([]);
  const [pending, setPending] = useState<PendingProposal[]>([]);
  const [selectedNode, setSelectedNode] = useState<PlanningNode | null>(null);
  const [drawerNode, setDrawerNode] = useState<PlanningNode | null>(null);
  const [view, setView] = useState<ViewMode>("tree");
  const [note, setNote] = useState("");
  const [loadError, setLoadError] = useState<ReturnType<
    typeof describeRpcError
  > | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [splitOpen, setSplitOpen] = useState(false);
  const showSkeleton = useDelayedFlag(phase === "loading");

  const retryLoad = useCallback(async () => {
    setLoadError(null);
    try {
      const [nextGraph, nextRows, overview, queue, scenes] = await Promise.all([
        queryProject<{ nodes: PlanningNode[]; edges: PlanningEdge[] }>(
          cwd,
          "planning_graph_query",
          {},
        ),
        queryProject<ReleaseRow[]>(cwd, "list_chapter_release_state", {}),
        queryProject<{ entities: EntityLite[] }>(
          cwd,
          "get_design_overview",
          {},
        ),
        queryProject<ReviewInboxProjection>(cwd, "list_review_inbox", {}),
        queryProject<CanonicalSceneSummary[]>(cwd, "list_canonical_scenes", {}),
      ]);
      setCanonicalScenes(scenes);
      setGraph(nextGraph);
      setReleaseRows(nextRows);
      setEntities(overview.entities ?? []);
      setPending(queue.proposals.filter((item) => item.kind === "artifact_change"));
      setPhase("ready");
    } catch (raw) {
      setLoadError(describeRpcError(raw));
      setPhase("failed");
    }
  }, [cwd]);

  useEffect(() => {
    void retryLoad();
  }, [retryLoad]);

  // 深链聚焦（WF5-14）：focus=工件 id → 数据就位后直接选中该节点
  // （章进抽屉，其余进详情面板）。
  const focusTargetRef = useRef<string | null>(readFocusTarget());
  useEffect(() => {
    const focus = focusTargetRef.current;
    if (!focus || !graph) return;
    focusTargetRef.current = null;
    const node = graph.nodes.find((item) => item.id === focus);
    if (!node) return;
    if (node.kind === "chapter_plan") setDrawerNode(node);
    else setSelectedNode(node);
  }, [graph]);

  const model = useMemo(
    () =>
      buildPlanningTree({
        graph: graph ?? { nodes: [], edges: [] },
        releaseRows,
        entityNames: new Map(
          entities.map((entity) => [entity.id, entity.canonicalName]),
        ),
      }),
    [graph, releaseRows, entities],
  );
  const action = nextActionOf(model);

  // 主体注册（WF5-17）：规划动作围绕总纲与全部规划工件展开；
  // 零工件（未建总纲）时清空主体，抽屉主操作禁用并指引先建总纲。
  const assistant = useAssistant();
  const planSubject = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    if (nodes.length === 0) return null;
    const outline = nodes.find((node) => node.kind === "outline");
    return {
      kind: "plan" as const,
      label: outline ? outline.title : "规划工件",
      planArtifactIds: nodes.map((node) => node.id),
      key: `plan:${outline?.id ?? nodes.length}`,
    };
  }, [graph]);
  useEffect(() => {
    assistant.registerAssistantSubject(planSubject);
  }, [assistant, planSubject]);

  const idNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const entity of entities) map.set(entity.id, entity.canonicalName);
    for (const node of graph?.nodes ?? []) map.set(node.id, node.title);
    for (const scene of canonicalScenes) map.set(scene.sceneId, scene.title);
    return map;
  }, [entities, graph, canonicalScenes]);

  const entityOptions = useMemo(
    () =>
      entities.filter((entity) => entity.type === "character").map((entity) => ({
        id: entity.id,
        name: entity.canonicalName,
        hint: entityTypeLabel(entity.type),
      })),
    [entities],
  );

  const sceneOptions = useMemo(() => [
    ...(graph?.nodes ?? []).filter((node) => node.kind === "scene_plan").map((node) => ({ id: node.id, name: node.title, hint: "场景计划" })),
    ...canonicalScenes.map((scene) => ({ id: scene.sceneId, name: scene.title, hint: "已确认正文" })),
  ], [graph, canonicalScenes]);

  const openNode = useCallback((node: PlanningNode) => {
    // 章＝抽屉编辑（WF2-07 语义保持）；其余节点走详情面板。
    if (node.kind === "chapter_plan") setDrawerNode(node);
    else setSelectedNode(node);
  }, []);


  const nodes = graph?.nodes ?? [];
  const cards = model.looseChapters.concat(
    model.volumes.flatMap((volume) => volume.chapters),
  );

  return (
    <div className="grid gap-3">
      {phase === "ready" ? (
        <Panel title="开始创作 · 从设定到正文">
          <p className="m-0 text-[12px] leading-6 text-ink-mid">
            建议先准备人物、地点与势力并批准设定提案，再写总纲 → 批准总纲 → 拆分章节 → 细化场景 → 开始正文。
            总纲只需标题与创作目标，可以先写；地点是世界设定，场景是章节中的一段剧情，不必在总纲前创建。
          </p>
          <p className="my-2 text-[12px] text-ink-mid">
            已批准人物 {entities.filter((item) => item.type === "character").length} 位 ·
            地点 {entities.filter((item) => item.type === "location").length} 处 ·
            势力 {entities.filter((item) => item.type === "faction").length} 个
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { window.location.hash = "#/world/characters"; }}>准备人物</Button>
            <Button onClick={() => { window.location.hash = "#/world/lore"; }}>准备地点与势力</Button>
          </div>
        </Panel>
      ) : null}
      {note ? <InlineNote tone="success">{note}</InlineNote> : null}

      {phase === "failed" && loadError ? (
        <ErrorState
          message={loadError.message}
          detail={loadError.detail}
          onRetry={() => void retryLoad()}
        />
      ) : null}

      {phase === "loading" && showSkeleton ? (
        <div className="grid grid-cols-[1fr_340px] gap-3">
          <SkeletonLines lines={5} />
          <SkeletonLines lines={3} />
        </div>
      ) : null}

      {phase === "ready" ? (
        <div className="grid grid-cols-[1fr_340px] gap-3 items-start">
          <div className="grid gap-3">
            <Panel
              title={
                action.kind === "split-chapters"
                  ? "规划 · 从总纲开始"
                  : `卷章结构 · ${model.chapterCount} 章`
              }
              action={
                action.kind === "tree" && model.chapterCount > 0 ? (
                  <ViewToggle view={view} onChange={setView} />
                ) : null
              }
            >
              {action.kind === "empty" ? (
                <EmptyState
                  as="h2"
                  glyph={EMPTY.outline.glyph}
                  title={EMPTY.outline.title}
                  hint={EMPTY.outline.hint}
                />
              ) : action.kind === "split-chapters" ? (
                <OutlineSummary
                  outline={action.outline}
                  onSplit={() => setSplitOpen(true)}
                  onEdit={() => setSelectedNode(action.outline)}
                />
              ) : view === "kanban" ? (
                <KanbanView
                  cards={cards}
                  selectedId={selectedNode?.id ?? null}
                  onOpen={openNode}
                />
              ) : (
                <PlanningTree
                  model={model}
                  selectedId={selectedNode?.id ?? null}
                  onOpen={openNode}
                />
              )}
            </Panel>

            {selectedNode ? (
              <Panel
                title={`详情 · ${selectedNode.title}`}
                action={
                  <IconButton icon={X} label="关闭" onClick={() => setSelectedNode(null)} />
                }
              >
                <NodeDetails
                  key={selectedNode.versionId}
                  cwd={cwd}
                  node={selectedNode}
                  graph={graph}
                  idNames={idNames}
                  entityOptions={entityOptions}
                  sceneOptions={sceneOptions}
                  onUpdated={() => { setSelectedNode(null); void retryLoad(); }}
                  onClose={() => setSelectedNode(null)}
                />
              </Panel>
            ) : null}
          </div>

          <div className="grid gap-3">
            <Panel title={`待审工件提案 · ${pending.length}`}>
              {pending.length === 0 ? (
                <p className="text-[12px] text-ink-mid">没有待审的工件提案。</p>
              ) : (
                <div className="grid gap-1">
                  {pending.map((proposal) => (
                    <PendingArtifactCard key={proposal.proposalId} cwd={cwd} proposal={proposal}
                      graph={graph} idNames={idNames} onApproved={() => void retryLoad()}
                    />
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="新建工件提案">
              <ArtifactProposalForm
                cwd={cwd}
                outlineNodeId={model.outline?.id}
                graph={graph}
                idNames={idNames}
                entityOptions={entityOptions}
                sceneOptions={sceneOptions}
                dependencyOptions={(graph?.nodes ?? []).map((node) => ({
                  id: node.id,
                  name: node.title,
                  hint: ARTIFACT_KIND_LABEL[node.kind] ?? node.kind,
                }))}
                chapterOptions={nodes
                  .filter((node) => node.kind === "chapter_plan")
                  .map((node) => ({ id: node.id, name: node.title }))}
                onSucceeded={(title, kindLabel, mode) => {
                  setNote(
                    mode === "approved"
                      ? `「${title}」${kindLabel}已纳入规划。下一步：在左侧树里选中它继续细化。`
                      : `「${title}」${kindLabel}提案已创建，正在等待批准。下一步：在右侧「待审工件提案」里展开核对，点「批准」后才会正式纳入规划。`,
                  );
                  void retryLoad();
                }}
              />
            </Panel>
          </div>
        </div>
      ) : null}

      <AnimatePresence>
        {drawerNode ? (
          <motion.div key="chapter-drawer" className="contents">
            <ChapterDrawer
              cwd={cwd}
              node={drawerNode}
              graph={graph}
              entityOptions={entityOptions}
              sceneOptions={sceneOptions.map((item) => ({ id: item.id, title: item.name, hint: item.hint }))}
              dependencyIds={(graph?.edges ?? [])
                .filter((edge) => edge.targetId === drawerNode.id)
                .map((edge) => edge.sourceId)}
              onClose={() => setDrawerNode(null)}
              onSubmitted={(message) => {
                setDrawerNode(null);
                setNote(message);
                void retryLoad();
              }}
            />
          </motion.div>
        ) : null}
        {splitOpen && model.outline ? (
          <motion.div key="split-chapters" className="contents">
            <SplitChaptersFlow
              cwd={cwd}
              outline={model.outline}
              onClose={() => setSplitOpen(false)}
              onSucceeded={async (firstArtifactId) => {
                setSplitOpen(false);
                await retryLoad();
                // 用例 6：成功后直接选中新建第一章并打开抽屉。
                if (!firstArtifactId) return;
                const fresh = await queryProject<{
                  nodes: PlanningNode[];
                }>(cwd, "planning_graph_query", {}).catch(() => null);
                const node = fresh?.nodes.find(
                  (item) => item.id === firstArtifactId,
                );
                if (node) setDrawerNode(node);
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange(next: ViewMode): void;
}) {
  return (
    <div className="inline-flex border border-line rounded-md overflow-hidden">
      {(["tree", "kanban"] as ViewMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={cx(
            "ui-plain inline-flex min-h-7 items-center cursor-pointer text-[12px] font-[inherit] px-3 py-1",
            view === mode
              ? "text-accent-text bg-accent-soft font-semibold"
              : "text-ink-mid bg-transparent",
          )}
        >
          {mode === "kanban" ? "看板" : "树状"}
        </button>
      ))}
    </div>
  );
}

/** 按需看板（用例 5）：只在有真实章节卡时由父级渲染。 */
function KanbanView({
  cards,
  selectedId,
  onOpen,
}: {
  cards: ReturnType<typeof buildPlanningTree>["looseChapters"];
  selectedId: string | null;
  onOpen: (node: PlanningNode) => void;
}) {
  const phases = Object.keys(PHASE_LABEL) as PhaseKey[];
  return (
    <div className="grid grid-cols-[repeat(4,minmax(212px,1fr))] gap-3 overflow-x-auto items-start">
      {phases.map((phase) => {
        const list = cards.filter((card) => card.phase === phase);
        return (
          <motion.div
            key={phase}
            variants={cardWallContainerVariants}
            initial="hidden"
            animate="show"
            className="grid gap-2"
          >
            <p className="eyebrow flex items-center gap-1 m-0">
              <PhaseDot phase={phase} />
              {PHASE_LABEL[phase]}
              <span className="num ml-auto">{list.length}</span>
            </p>
            {list.map((card) => (
              <motion.button
                key={card.node.id}
                type="button"
                onClick={() => onOpen(card.node)}
                variants={cardWallItemVariants}
                className={cx(
                  "ui-plain t-fast lift-bordered block w-full cursor-pointer bg-panel rounded-md px-3 py-2 font-[inherit] border text-left",
                  selectedId === card.node.id ? "border-accent" : "border-line",
                )}
              >
                <b className="text-[13px] block mb-1">{card.node.title}</b>
                {card.purpose ? (
                  <p className="m-0 text-[11.5px] leading-[1.65] text-ink-mid line-clamp-2">
                    {card.purpose}
                  </p>
                ) : null}
                <div className="flex items-center gap-1 mt-2 text-[10.5px] text-ink-low">
                  <PhaseDot phase={card.phase} />
                  <span className="num">
                    {card.row
                      ? `${card.row.confirmedScenes}/${card.row.totalScenes} 场景`
                      : "无场景"}
                  </span>
                  {card.row?.status === "published" ? (
                    <Chip tone="default">已发布</Chip>
                  ) : null}
                </div>
              </motion.button>
            ))}
            {list.length === 0 ? (
              <div className="border-[1.5px] border-dashed border-line rounded-md px-2 py-4 text-center text-[11px] text-ink-low">
                暂无章节
              </div>
            ) : null}
          </motion.div>
        );
      })}
    </div>
  );
}
