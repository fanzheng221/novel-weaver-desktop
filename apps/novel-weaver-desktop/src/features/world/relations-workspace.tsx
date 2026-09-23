import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryProject } from "../../shared/api/rpc";
import { useAssistant } from "../writing/assistant/assistant-context";
import { saveLastSceneId } from "../writing/draft-store";
import { Button, EmptyState, InlineNote } from "../../shared/ui/components";
import { EMPTY } from "../../shared/ui/copy";
import { cx } from "../../shared/ui/cx";
import { readFocusTarget } from "../../shared/ui/deep-link";
import {
  describeRpcError,
  ErrorState,
  navigateTo,
  SkeletonLines,
  useDelayedFlag,
} from "../../shared/ui/states";
import { relationshipTypeLabel } from "../../shared/ui/terms";
import { ImpactSlot } from "./impact-slot";
import {
  type RelationFormState,
  RelationRevisionForm,
  relationFormFromEdge,
} from "./relations/relation-revision-form";
import { RelationsGraphCanvas } from "./relations/relations-graph-canvas";
import { RelationsList, type SceneRefShape } from "./relations/relations-list";
import { RelationsTimelineBand } from "./relations/relations-timeline-band";
import {
  changeEvents,
  clampStoryOrder,
  loadManualPositions,
  loadRelationsPrefs,
  objectiveTypePool,
  type Pos,
  type RelationGraph,
  type RelationSelection,
  type RelationsViewPrefs,
  saveManualPositions,
  saveRelationsPrefs,
  visibleAttitudes as sliceAttitudes,
  visibleObjective as sliceObjective,
  storyRangeOf,
} from "./relations/relations-model";

/**
 * 统一关系工作区（WF5-13，WF5-12 裁决 C）：时间轴带独占故事时间控制，
 * 下方双栏同步——左图谱（焦点放射+拖拽理线）右列表（368px 主导权给图谱）。
 * 图与列表消费同一可见性谓词（时间切片 ∪ 知识范围 ∪ 类型筛选）；
 * 知识边界（POV/私密）由核心 relationship_query 强制，前端不自行猜测。
 * 所有修改走提案→就地批准；视图偏好与手动布局只进 localStorage。
 */

const CHIP_ON =
  "ui-plain cursor-pointer text-[11px] border rounded-full px-2 py-0.5 border-accent text-accent-text bg-accent-soft";
const CHIP_OFF =
  "ui-plain cursor-pointer text-[11px] border rounded-full px-2 py-0.5 border-line text-ink-mid";

export function RelationsWorkspace({ cwd }: { cwd: string }) {
  // 本地偏好一次性载入（视图偏好不是故事事实，只进 localStorage）。
  const [initialPrefs] = useState<Partial<RelationsViewPrefs>>(() =>
    loadRelationsPrefs(cwd),
  );
  const [graph, setGraph] = useState<RelationGraph | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [loadError, setLoadError] = useState<ReturnType<
    typeof describeRpcError
  > | null>(null);
  const showSkeleton = useDelayedFlag(phase === "loading" && graph === null);

  const [storyOrder, setStoryOrder] = useState(
    () => initialPrefs.storyOrder ?? 0,
  );
  const [knowledge, setKnowledge] = useState<{
    mode: "author" | "pov";
    viewer: string | null;
  }>(() => ({
    mode: initialPrefs.knowledgeMode ?? "author",
    viewer: initialPrefs.viewerCharacterId ?? null,
  }));
  const [excludedTypes, setExcludedTypes] = useState<ReadonlySet<string>>(
    () => new Set(initialPrefs.typeFilter ?? []),
  );
  const [focus, setFocus] = useState(() => initialPrefs.focus || "auto");
  const [pins, setPins] = useState<ReadonlySet<string>>(new Set());
  const [manualPositions, setManualPositions] = useState<Record<string, Pos>>(
    () => loadManualPositions(cwd),
  );
  const [selected, setSelected] = useState<RelationSelection | null>(null);
  const [revising, setRevising] = useState<RelationFormState | null>(null);
  const [approval, setApproval] = useState<{
    proposalId: string;
    revision: number;
  } | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sceneRefs, setSceneRefs] = useState<
    Record<string, SceneRefShape | null>
  >({});

  const applyManualPositions = useCallback(
    (next: Record<string, Pos>) => {
      setManualPositions(next);
      saveManualPositions(cwd, next);
    },
    [cwd],
  );

  // 偏好持久化：任一视图控制变化即写入（localStorage 单键，成本低）。
  useEffect(() => {
    saveRelationsPrefs(cwd, {
      storyOrder,
      knowledgeMode: knowledge.mode,
      viewerCharacterId: knowledge.viewer,
      typeFilter: [...excludedTypes],
      focus,
    });
  }, [cwd, storyOrder, knowledge, excludedTypes, focus]);

  // 故事章号只在客户端切片用；查询章号经 ref 传递，切章不触发重新查询。
  const storyOrderRef = useRef(storyOrder);
  storyOrderRef.current = storyOrder;
  const load = useCallback(async () => {
    setPhase("loading");
    setLoadError(null);
    try {
      const next = await queryProject<RelationGraph>(
        cwd,
        "relationship_query",
        {
          continuityId: "main",
          storyOrder: storyOrderRef.current,
          ...(knowledge.mode === "pov" && knowledge.viewer
            ? {
                knowledgeMode: "pov" as const,
                viewerCharacterId: knowledge.viewer,
              }
            : { knowledgeMode: "author" as const }),
        },
      );
      setGraph(next);
      setPhase("ready");
    } catch (raw) {
      setLoadError(describeRpcError(raw));
      setPhase("failed");
    }
  }, [cwd, knowledge]);

  useEffect(() => {
    void load();
  }, [load]);

  // 故事时间范围以「当前章 ∪ 全史边界」在客户端定稳定口径（核心口径随查询章漂移）。
  const range = useMemo(
    () => (graph ? storyRangeOf(graph) : { min: 0, max: 0 }),
    [graph],
  );
  // 数据变化（批准生效/切换知识范围）后章号可能落在范围外，钳回界内。
  useEffect(() => {
    if (phase !== "ready") return;
    const clamped = clampStoryOrder(storyOrder, range);
    if (clamped !== storyOrder) setStoryOrder(clamped);
  }, [phase, storyOrder, range]);

  const events = useMemo(() => (graph ? changeEvents(graph) : []), [graph]);

  const typePool = useMemo(
    () => (graph ? objectiveTypePool(graph) : []),
    [graph],
  );
  // 类型筛选：排除制——新类型默认可见，不被历史池变化顶掉作者的勾选。
  const typeFilter = useMemo(() => {
    const set = new Set(typePool.map(({ type }) => type));
    for (const type of excludedTypes) set.delete(type);
    return set;
  }, [typePool, excludedTypes]);

  const visibleObj = useMemo(
    () => (graph ? sliceObjective(graph, storyOrder, typeFilter) : []),
    [graph, storyOrder, typeFilter],
  );
  const visibleAtt = useMemo(
    () => (graph ? sliceAttitudes(graph, storyOrder) : []),
    [graph, storyOrder],
  );

  const characters = useMemo(
    () => graph?.nodes.filter((node) => node.type === "character") ?? [],
    [graph],
  );

  // 主体注册（WF5-17）：关系动作围绕当前人物对与故事时间展开。
  // 选中节点＝单人视角；选中客观边＝一对人物；都随切章更新 storyOrder。
  const assistant = useAssistant();
  const pairSubject = useMemo(() => {
    if (!graph || !selected) return null;
    const labelOf = (id: string) =>
      graph.nodes.find((node) => node.id === id)?.label ?? id;
    if (selected.kind === "node") {
      const node = graph.nodes.find((item) => item.id === selected.id);
      if (!node) return null;
      return {
        kind: "pair" as const,
        label: node.label,
        entityIds: [node.id],
        storyOrder,
        key: `pair:${node.id}:${storyOrder}`,
      };
    }
    const edge = graph.objectiveHistory.find((item) => item.id === selected.id);
    if (!edge) return null;
    return {
      kind: "pair" as const,
      label: `${labelOf(edge.sourceId)} × ${labelOf(edge.targetId)}`,
      entityIds: [edge.sourceId, edge.targetId],
      storyOrder,
      key: `pair:${edge.id}:${storyOrder}`,
    };
  }, [graph, selected, storyOrder]);
  useEffect(() => {
    assistant.registerAssistantSubject(pairSubject);
  }, [assistant, pairSubject]);

  // POV viewer 被删除等失配时退回作者全知，避免停在查不到数据的知识范围。
  useEffect(() => {
    if (knowledge.mode !== "pov" || !knowledge.viewer) return;
    if (
      graph &&
      characters.length > 0 &&
      !characters.some((node) => node.id === knowledge.viewer)
    ) {
      setKnowledge({ mode: "author", viewer: null });
    }
  }, [knowledge, graph, characters]);

  // 证据场景解析：versionId → 场景引用；失败置 null 不阻塞主视图。
  useEffect(() => {
    if (!graph) return;
    const versionIds = new Set<string>();
    for (const edge of [...visibleObj, ...visibleAtt]) {
      if (edge.sourceSceneVersionId) versionIds.add(edge.sourceSceneVersionId);
    }
    const missing = [...versionIds].filter((id) => !(id in sceneRefs));
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(
      missing.map(async (versionId) => {
        try {
          const ref = await queryProject<SceneRefShape>(cwd, "get_scene_ref", {
            versionId,
          });
          return [versionId, ref] as const;
        } catch {
          return [versionId, null] as const;
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setSceneRefs((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => {
      cancelled = true;
    };
  }, [graph, visibleObj, visibleAtt, cwd, sceneRefs]);

  // 深链聚焦（WF5-14）：focus=边/态度/人物 id → 就地选中；客观边不在当前
  // 时间切片时把故事时间拨到它生效的章，保证作者能看见目标。
  const focusTargetRef = useRef<string | null>(readFocusTarget());
  useEffect(() => {
    const focus = focusTargetRef.current;
    if (!focus || phase !== "ready" || !graph) return;
    focusTargetRef.current = null;
    const objective = graph.objectiveHistory.find((edge) => edge.id === focus);
    if (objective) {
      const inSpan =
        storyOrderRef.current >= objective.validFrom &&
        (objective.validTo === undefined ||
          storyOrderRef.current <= objective.validTo);
      if (!inSpan) setStoryOrder(objective.validFrom);
      setSelected({ kind: "edge", id: focus });
      return;
    }
    if (graph.attitudeHistory.some((att) => att.id === focus)) {
      setSelected({ kind: "att", id: focus });
      return;
    }
    if (graph.nodes.some((node) => node.id === focus)) {
      setSelected({ kind: "node", id: focus });
    }
  }, [phase, graph]);

  // 选中对象的影响面（WF5-14）：客观边→关系投影；图谱人物→实体投影。
  // 态度不是核心投影的主体（随客观关系一并返回），不单独成插槽。
  const impactSubject = useMemo(() => {
    if (!graph || !selected) return null;
    if (selected.kind === "edge") {
      return graph.objectiveHistory.some((edge) => edge.id === selected.id)
        ? { kind: "relationship" as const, id: selected.id }
        : null;
    }
    if (selected.kind === "node") {
      return graph.nodes.some((node) => node.id === selected.id)
        ? { kind: "entity" as const, id: selected.id }
        : null;
    }
    return null;
  }, [graph, selected]);

  const jumpScene = useCallback(
    (sceneRef: SceneRefShape) => {
      // 跨区跳场景：写「最近选中场景」记忆后走写作台路由，编辑器据此恢复。
      saveLastSceneId(cwd, sceneRef.sceneId);
      navigateTo("writing");
    },
    [cwd],
  );

  const toggleType = useCallback((type: string) => {
    setExcludedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // 原型决议：切换焦点即清空共同焦点与手动位置（重新起一张布局）。
  const handleFocusChange = useCallback(
    (next: string) => {
      setFocus(next);
      setPins(new Set());
      applyManualPositions({});
    },
    [applyManualPositions],
  );

  const approve = useCallback(async () => {
    if (!approval) return;
    setApproving(true);
    setApprovalError(null);
    try {
      await queryProject(cwd, "approve_proposal", {
        proposalId: approval.proposalId,
        expectedRevision: approval.revision,
      });
      setApproval(null);
      setNote("提案已批准，关系已生效。");
      setSelected(null);
      await load();
    } catch (raw) {
      setApprovalError(describeRpcError(raw).message);
    } finally {
      setApproving(false);
    }
  }, [approval, cwd, load]);

  const onRevised = useCallback(
    (result: { proposalId: string; revision: number }) => {
      setRevising(null);
      setNote(null);
      setApprovalError(null);
      setApproval(result);
    },
    [],
  );

  const emptyFiltered =
    visibleObj.length === 0 &&
    visibleAtt.length === 0 &&
    graph !== null &&
    graph.objectiveHistory.length + graph.attitudeHistory.length > 0;

  return (
    <main
      className="flex h-full min-h-0 flex-col gap-2.5 px-6 pt-4 pb-4"
      aria-busy={phase === "loading"}
    >
      <header className="flex-none flex items-baseline gap-3 flex-wrap">
        <div>
          <p className="eyebrow">NOVEL WEAVER / WORLD · RELATIONS</p>
          <h1 className="font-wenkai text-[22px] mt-1 mb-0">关系</h1>
        </div>
        <p className="text-[11.5px] text-ink-low mt-0.5 mb-0">
          一条时间轴看关系变化；图谱与列表共享同一时间切片与筛选。
        </p>
      </header>

      {phase === "failed" && loadError ? (
        <ErrorState
          message={loadError.message}
          detail={loadError.detail}
          onRetry={() => void load()}
        />
      ) : null}
      {showSkeleton ? <SkeletonLines lines={5} /> : null}

      {graph ? (
        <>
          {/* 共享控制条：知识范围 + 类型筛选（时间控制归时间轴带独占） */}
          <div className="flex-none flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] text-ink-low">
              知识范围
              <select
                aria-label="知识范围"
                title="作者全知看全部；POV 只看该人物知道的（私密边界由核心强制）"
                value={
                  knowledge.mode === "pov" && knowledge.viewer
                    ? knowledge.viewer
                    : "author"
                }
                onChange={(event) => {
                  const value = event.target.value;
                  setKnowledge(
                    value === "author"
                      ? { mode: "author", viewer: null }
                      : { mode: "pov", viewer: value },
                  );
                }}
                className="h-6.5 rounded-sm border border-line bg-shell text-ink-hi text-[12px] px-1 font-[inherit] max-w-52"
              >
                <option value="author">作者全知</option>
                {characters.map((node) => (
                  <option key={node.id} value={node.id}>
                    {`POV · ${node.label}`}
                  </option>
                ))}
              </select>
            </label>
            <div
              role="group"
              aria-label="关系类型筛选"
              className="flex flex-wrap items-center gap-1.5"
            >
              {typePool.map(({ type, count }) => {
                const pressed = !excludedTypes.has(type);
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={pressed}
                    aria-label={`筛选关系类型：${relationshipTypeLabel(type)}`}
                    className={pressed ? CHIP_ON : CHIP_OFF}
                    onClick={() => toggleType(type)}
                  >
                    {`${relationshipTypeLabel(type)} · ${count}`}
                  </button>
                );
              })}
            </div>
          </div>

          <RelationsTimelineBand
            storyOrder={storyOrder}
            onStoryOrder={setStoryOrder}
            storyRange={range}
            events={events}
            objectiveCount={visibleObj.length}
            attitudeCount={visibleAtt.length}
          />

          {graph.nodes.length === 0 ? (
            <section className="flex-1 min-h-0 bg-panel border border-line rounded-md grid place-items-center p-6">
              <EmptyState
                as="h2"
                glyph={EMPTY.loreGraph.glyph}
                title={EMPTY.loreGraph.title}
                hint={EMPTY.loreGraph.hint}
                actions={
                  <button
                    type="button"
                    className={cx(
                      "ui-plain cursor-pointer text-accent-text",
                      "text-[12.5px] font-semibold font-[inherit]",
                    )}
                    onClick={() => navigateTo("world/characters")}
                  >
                    {EMPTY.loreGraph.actionLabel}
                  </button>
                }
              />
            </section>
          ) : emptyFiltered ? (
            <section className="flex-1 min-h-0 bg-panel border border-line rounded-md grid place-items-center p-6">
              <p className="m-0 text-[12px] text-ink-low">
                当前时间/范围/筛选下没有可见关系。调整章号、知识范围或类型筛选。
              </p>
            </section>
          ) : (
            <div className="flex-1 min-h-0 flex gap-3 items-stretch">
              <section
                aria-label="关系图谱"
                className="flex-1 min-w-0 min-h-0 bg-panel border border-line rounded-md overflow-hidden flex"
              >
                <RelationsGraphCanvas
                  graph={graph}
                  visibleObjective={visibleObj}
                  visibleAttitudes={visibleAtt}
                  focus={focus}
                  pins={pins}
                  onFocusChange={handleFocusChange}
                  onPinsChange={setPins}
                  selected={selected}
                  onSelect={setSelected}
                  manualPositions={manualPositions}
                  onManualPositionsChange={applyManualPositions}
                />
              </section>
              <aside
                aria-label="关系列表"
                className="flex-none basis-92 shrink min-w-74 min-h-0 bg-panel border border-line rounded-md overflow-hidden flex flex-col"
              >
                {revising ? (
                  <div className="flex-1 min-h-0 overflow-y-auto p-2.5">
                    <RelationRevisionForm
                      cwd={cwd}
                      graph={graph}
                      initial={revising}
                      onSubmitted={onRevised}
                      onCancelled={() => setRevising(null)}
                    />
                  </div>
                ) : (
                  <>
                    {approval ? (
                      <section
                        aria-label="待批准的关系提案"
                        className="flex-none border-b border-line bg-rail px-3 py-2 grid gap-1.5"
                      >
                        <p className="m-0 text-[12px] text-ink-hi">
                          关系修订提案已创建，批准后生效。
                        </p>
                        <p className="m-0 text-[10.5px] text-ink-low num">
                          {`关系修订 · 第 ${approval.revision} 次提交`}
                        </p>
                        {approvalError ? (
                          <InlineNote tone="danger">{approvalError}</InlineNote>
                        ) : null}
                        <div className="flex gap-2">
                          <Button
                            variant="primary"
                            size="compact"
                            disabled={approving}
                            onClick={() => void approve()}
                          >
                            {approving ? "批准中…" : "批准生效"}
                          </Button>
                          <Button
                            size="compact"
                            onClick={() => {
                              setApproval(null);
                              setApprovalError(null);
                            }}
                          >
                            稍后再说
                          </Button>
                        </div>
                      </section>
                    ) : null}
                    {note ? (
                      <div className="flex-none px-3 pt-2">
                        <InlineNote tone="success">{note}</InlineNote>
                      </div>
                    ) : null}
                    {impactSubject ? (
                      <div className="flex-none max-h-55 overflow-y-auto border-b border-line px-3.5 py-2.5 bg-paper">
                        <ImpactSlot
                          cwd={cwd}
                          subject={impactSubject}
                          embedded
                        />
                      </div>
                    ) : null}
                    <RelationsList
                      graph={graph}
                      visibleObjective={visibleObj}
                      visibleAttitudes={visibleAtt}
                      storyOrder={storyOrder}
                      selected={selected}
                      onSelect={setSelected}
                      sceneRefs={sceneRefs}
                      onJumpScene={jumpScene}
                      onReviseEdge={(edge) => {
                        setNote(null);
                        setApproval(null);
                        setRevising(relationFormFromEdge(edge));
                      }}
                    />
                  </>
                )}
              </aside>
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}
