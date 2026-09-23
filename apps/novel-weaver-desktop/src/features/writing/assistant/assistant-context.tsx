import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useWorkspace } from "../../../shared/workspace/context";
import type { RouteKey } from "../../../shared/workspace/routes";
import { describeRpcError } from "../../../shared/ui/states";
import {
  createInitialDualDraftState,
  type DualDraftResult,
  type DualDraftSource,
  type DualDraftState,
  dualDraftReducer,
} from "../dualdraft/machine";
import { extractSegments } from "../dualdraft/segments";
import {
  type AssistantGateway,
  activeProviderOf,
  type ByokProvider,
  loadByokConfig,
  probeProvider,
  readKeyTail,
  rpcAssistantGateway,
  saveProviderKey,
} from "./gateway";
import {
  type AssistantCandidate,
  type AssistantIntent,
  type AssistantSceneFacts,
  type AssistantState,
  assistantReducer,
  composeInstruction,
  createInitialAssistantState,
  effectiveExcludedSourceIds,
} from "./machine";
import {
  FRONTIER_STORY_ORDER,
  type AssistantSubject,
  type WorkspaceActionDef,
  actionsForRoute,
  composeWorkspaceQuestion,
  workspaceSurfaceOf,
} from "./workspace-actions";

/**
 * 助手运行时（WF5-07 增量 1/2）：状态机之上的异步编排层。
 * UI 组件只声明意图（run/cancel/adopt…），RPC 拼装、runId 守卫、
 * 阶段上报与 BYOK 门禁全部收拢在这里。
 */

export interface ChapterIndexEntry {
  id: string;
  label: string;
  scenes: Array<{ sceneId?: string; title: string; storyOrder: number }>;
}

export interface ContinuationBridge {
  isCurrent?: () => boolean;
  getText: () => string;
  append: (addition: string) => void;
  replaceAll?: (nextText: string) => void;
}

/** 采用桥（WF5-09）：双稿裁决的确认结果经此落到 ProseEditor 手编草稿。 */
export interface AdoptionBridge {
  adopt: (input: { sceneId: string; markdown: string; title: string }) => void;
}

export interface AssistantValue {
  state: AssistantState;
  open: boolean;
  busy: boolean;
  openAssistant: () => void;
  closeAssistant: () => void;
  toggleAssistant: () => void;
  setIntent: (intent: AssistantIntent) => void;
  setInstruction: (value: string) => void;
  setStyle: (toneSuffix: string, densitySuffix: string) => void;
  setScope: (scope: "scene" | "chapter", chapterId: string | null) => void;
  setViewpoint: (characterId: string | null) => void;
  setTitle: (value: string) => void;
  toggleEntity: (characterId: string, on: boolean) => void;
  toggleCategory: (
    category: "evidence" | "knowledge" | "plan" | "outline" | "style",
    on: boolean,
  ) => void;
  run: () => Promise<void>;
  cancel: () => void;
  continueDraft: () => Promise<void>;
  condenseDraft: () => Promise<void>;
  adoptCandidate: (candidate: AssistantCandidate) => Promise<void>;
  reviewCandidate: (candidate: AssistantCandidate) => Promise<void>;
  /** 双稿裁决（WF5-09）：会话状态与三种决策动作。 */
  dualDraft: DualDraftState;
  toggleDualSegment: (segmentId: string, on: boolean) => void;
  clearDualSelection: () => void;
  confirmPartialAdoption: (
    markdown: string,
    adoptedCount: number,
    draftTitle: string,
  ) => void;
  adoptCandidateAsDraft: () => void;
  undoDualAdoption: () => void;
  discardDualCandidate: () => void;
  resumeWriting: () => void;
  reopenAssistantForRegenerate: () => void;
  registerContinuation: (bridge: ContinuationBridge | null) => void;
  /** 正文面是否已挂接续写桥（一键精简/续写的可用前提）。 */
  continuationReady: boolean;
  registerAdoption: (bridge: AdoptionBridge | null) => void;
  registerChapterDirectory: (entries: ChapterIndexEntry[]) => void;
  seedFromVersion: (version: {
    sceneTitle: string;
    storyOrder: number;
    versionId: string;
  }) => void;
  dismiss: () => void;
  clearResponse: () => void;
  /** BYOK 内联贴 Key 卡。 */
  byokCardOpen: boolean;
  closeByokCard: () => void;
  saveKeyAndContinue: (key: string) => Promise<void>;
  activeProvider: ByokProvider | undefined;
  byokProviders: ByokProvider[];
  switchProvider: (providerId: string) => void;
  /** 跨工作区 AI（WF5-17）：当前扩展面；writing＝写作原路径，null＝无动作面。 */
  surface: ReturnType<typeof workspaceSurfaceOf>;
  /** 当前路由可用的动作集（非写作面才非空）。 */
  workspaceActions: WorkspaceActionDef[];
  /** 当前选中动作；写作面为 null。 */
  activeAction: WorkspaceActionDef | null;
  selectAction: (actionId: string) => void;
  /** 页面注册的当前主体（选中规则/人物/人物对/收件条目/总纲）。 */
  subject: AssistantSubject | null;
  registerAssistantSubject: (subject: AssistantSubject | null) => void;
}

const AssistantContext = createContext<AssistantValue | null>(null);

const DEFAULT_QUESTION = "围绕当前场景的走向、动机与张力，给出分析与可选走向。";

export function AssistantProvider({
  cwd,
  route,
  gateway = rpcAssistantGateway,
  children,
}: {
  cwd: string;
  /** 当前路由（WF5-17）：决定助手扩展面与可用动作集。 */
  route: RouteKey;
  gateway?: AssistantGateway;
  children: ReactNode;
}) {
  const ws = useWorkspace();
  const [state, dispatch] = useReducer(
    assistantReducer,
    undefined,
    createInitialAssistantState,
  );
  const [dualDraft, dispatchDual] = useReducer(
    dualDraftReducer,
    undefined,
    createInitialDualDraftState,
  );
  const dualDraftRef = useRef(dualDraft);
  dualDraftRef.current = dualDraft;
  const stateRef = useRef(state);
  stateRef.current = state;
  const runIdRef = useRef(0);
  const continuationRef = useRef<ContinuationBridge | null>(null);
  const adoptionRef = useRef<AdoptionBridge | null>(null);
  const [chapterDirectory, setChapterDirectory] = useState<ChapterIndexEntry[]>(
    [],
  );
  const [byokCardOpen, setByokCardOpen] = useState(false);
  const [byokConfig, setByokConfig] = useState(() => loadByokConfig());
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [continuationReady, setContinuationReady] = useState(false);

  // ── 跨工作区 AI（WF5-17）：扩展面、动作与页面主体 ─────────────────
  const surface = workspaceSurfaceOf(route);
  const workspaceActions = useMemo(() => actionsForRoute(route), [route]);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const activeAction = useMemo(() => {
    if (workspaceActions.length === 0) return null;
    return (
      workspaceActions.find((action) => action.id === activeActionId) ??
      workspaceActions[0]
    );
  }, [workspaceActions, activeActionId]);
  const [subject, setSubject] = useState<AssistantSubject | null>(null);
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  // 路由切换 = 换页面：主体绑定页面选中，随路由失效。
  useEffect(() => {
    setSubject(null);
  }, [route]);
  const registerAssistantSubject = useCallback(
    (next: AssistantSubject | null) => {
      setSubject(next);
    },
    [],
  );
  const selectAction = useCallback((actionId: string) => {
    setActiveActionId(actionId);
  }, []);
  const activeProvider = useMemo(() => {
    const config = byokConfig;
    const preferred = activeProviderId
      ? config.providers.find((provider) => provider.id === activeProviderId)
      : undefined;
    return (
      preferred ??
      config.providers.find(
        (provider) => provider.id === config.slotProvider,
      ) ??
      config.providers[0]
    );
  }, [byokConfig, activeProviderId]);

  // 场景事实（WF5-06 简报语义）：唯一数据源是壳层快照与场景简报。
  const facts = useMemo<AssistantSceneFacts>(
    () => ({
      sceneId: ws.proseSceneId,
      title: ws.sceneBriefing?.sceneTitle ?? null,
      storyOrder: ws.sceneBriefing?.storyOrder ?? 10,
      planTask: ws.sceneBriefing?.purpose ?? null,
      proseMarkdown: ws.proseText,
    }),
    [ws.proseSceneId, ws.sceneBriefing, ws.proseText],
  );
  const factsRef = useRef(facts);
  factsRef.current = facts;
  useEffect(() => {
    dispatch({ type: "sceneFactsChanged", facts });
  }, [facts]);

  /** BYOK 门禁：无服务商报人话错误；有服务商无 Key 弹内联贴 Key 卡。 */
  const ensureProviderReady = useCallback(async (): Promise<boolean> => {
    const provider = activeProvider;
    if (!provider) {
      dispatch({
        type: "errorRaised",
        error: "尚未配置任何服务商——请先到「项目与设置 › 模型接入」添加。",
      });
      return false;
    }
    if (provider.requestOptions?.authMode === "none") return true;
    const tail = await readKeyTail(provider.id);
    if (tail) return true;
    setByokCardOpen(true);
    return false;
  }, [activeProvider]);

  const modelParams = useCallback(
    () => ({
      providerId: activeProvider?.id ?? "",
      adapter: activeProvider?.adapter ?? "openai_chat",
      requestOptions: activeProvider?.requestOptions,
      baseURL: activeProvider?.baseURL ?? "",
      modelId: activeProvider?.modelId ?? "",
    }),
    [activeProvider],
  );

  /**
   * 当前装配故事序：写作面用场景事实；工作区面用主体声明（关系动作
   * 指定故事时间），缺省＝全书前沿（规划/审校要全部已有上下文）。
   */
  const storyOrderNow = useCallback(() => {
    if (surface === null) return factsRef.current.storyOrder;
    return subjectRef.current?.storyOrder ?? FRONTIER_STORY_ORDER;
  }, [surface]);

  /**
   * 装配参数（WF5-17 扩展）：写作面冻结人物勾选与类别撤回（硬规则由
   * 核心强制必带）；工作区面人物/规划工件来自页面主体声明。
   */
  const assembleParams = useCallback(
    (current: AssistantState) => {
      const wsSubject = surface !== null ? subjectRef.current : null;
      return {
        continuityId: "main",
        storyOrder: wsSubject
          ? (wsSubject.storyOrder ?? FRONTIER_STORY_ORDER)
          : factsRef.current.storyOrder,
        viewpointCharacterId: current.viewpointCharacterId ?? undefined,
        relatedEntityIds: wsSubject
          ? (wsSubject.entityIds ?? [])
          : [...current.includedEntityIds],
        excludeSourceIds: effectiveExcludedSourceIds(current),
        planArtifactIds: wsSubject?.planArtifactIds ?? [],
      };
    },
    [surface],
  );

  /** 预览装配：打开助手或上下文输入变化时拉一次真实包＋关系图。 */
  const assemblePreview = useCallback(async () => {
    const current = stateRef.current;
    if (current.phase === "assembling" || current.phase === "running") return;
    const storyOrder = storyOrderNow();
    try {
      const { pkg, graph } = await gateway.assemble(
        cwd,
        assembleParams(current),
      );
      const applied =
        surface !== null
          ? new Set<string>()
          : current.contextStoryOrder === storyOrder
            ? current.includedEntityIds
            : defaultEntityIds(graph, current.viewpointCharacterId);
      dispatch({
        type: "contextAssembled",
        storyOrder,
        pkg,
        graph,
        defaultEntityIds: applied,
      });
    } catch {
      // 预览失败不打断写作；工作区面给出指引，主操作运行时会再装配并报完整错误。
      if (surface !== null) {
        dispatch({
          type: "noticeRaised",
          notice: "上下文预览暂不可用——运行时会重新装配并说明具体原因。",
        });
      }
    }
  }, [cwd, gateway, assembleParams, storyOrderNow, surface]);

  const open = ws.assistantOpen;
  // 打开抽屉 / 场景或主体变化 → 预览装配（运行中的装配由 run 负责）。
  useEffect(() => {
    if (!open) return;
    const current = stateRef.current;
    if (current.contextPackage && current.contextStoryOrder === storyOrderNow())
      return;
    void assemblePreview();
  }, [open, facts.storyOrder, subject?.key, assemblePreview, storyOrderNow]);

  const runIdGuard = useCallback((runId: number) => {
    return () => stateRef.current.activeRunId === runId;
  }, []);

  /**
   * 工作区运行路径（WF5-17）：全部动作都是讨论推演（零写入）——
   * 装配 → discuss → 结果进 discussion 区。主体缺失时禁点前已由
   * UI 拦截，这里再兜一次人话解释。
   */
  const runWorkspace = useCallback(
    async (action: WorkspaceActionDef) => {
      const subjectNow = subjectRef.current;
      if (action.requiresSubject && !subjectNow) {
        dispatch({ type: "errorRaised", error: action.subjectHint });
        return;
      }
      if (!(await ensureProviderReady())) return;
      const runId = ++runIdRef.current;
      // 工作区动作全部是讨论推演：结果区按 intent 渲染，运行前先切到
      // discuss（intentChanged 只翻 intent 并清 notice，无副作用）。
      dispatch({ type: "intentChanged", intent: "discuss" });
      dispatch({ type: "runStarted", runId });
      ws.reportGeneration("running");
      const live = runIdGuard(runId);
      try {
        const current = stateRef.current;
        const assembly = await gateway.assemble(cwd, assembleParams(current));
        if (!live()) return;
        dispatch({
          type: "contextAssembled",
          storyOrder: storyOrderNow(),
          pkg: assembly.pkg,
          graph: assembly.graph,
          defaultEntityIds: new Set<string>(),
        });
        dispatch({ type: "runPhase", runId, phase: "running" });
        const question = composeWorkspaceQuestion(
          action,
          subjectNow,
          current.instruction,
        );
        const result = await gateway.discuss(cwd, {
          contextId: assembly.pkg.contextId,
          question,
          ...modelParams(),
        });
        if (!live()) return;
        dispatch({
          type: "runSucceeded",
          runId,
          kind: "discussion",
          payload: result,
        });
        ws.reportGeneration("idle");
      } catch (raw) {
        if (!live()) return;
        dispatch({
          type: "runFailed",
          runId,
          error: describeRpcError(raw).message,
        });
        ws.reportGeneration("error");
      }
    },
    [
      cwd,
      gateway,
      assembleParams,
      storyOrderNow,
      modelParams,
      ensureProviderReady,
      runIdGuard,
      ws,
    ],
  );

  /** 单场景运行：装配 → 按意图调用 → runId 守卫下的结果分发。 */
  const runSingle = useCallback(
    async (intent: AssistantIntent) => {
      const runId = ++runIdRef.current;
      dispatch({ type: "runStarted", runId });
      ws.reportGeneration("running");
      const live = runIdGuard(runId);
      try {
        const current = stateRef.current;
        const assembly = await gateway.assemble(cwd, assembleParams(current));
        if (!live()) return;
        dispatch({
          type: "contextAssembled",
          storyOrder: factsRef.current.storyOrder,
          pkg: assembly.pkg,
          graph: assembly.graph,
          defaultEntityIds: current.includedEntityIds,
        });
        dispatch({ type: "runPhase", runId, phase: "running" });

        const factsNow = factsRef.current;
        const composed = composeInstruction(
          stateRef.current,
          factsNow.planTask,
          stateRef.current.includePlan,
        );
        if (intent === "generate") {
          const title = stateRef.current.title.trim() || factsNow.title || "";
          if (!title) {
            dispatch({ type: "runFailed", runId, error: "先给场景起个标题。" });
            ws.reportGeneration("error");
            return;
          }
          const result = await gateway.generateCandidate(cwd, {
            contextId: assembly.pkg.contextId,
            title,
            authorInstruction: composed,
            narrativeMode: "third_person_limited",
            viewpointCharacterId:
              stateRef.current.viewpointCharacterId ?? undefined,
            storyOrder: factsNow.storyOrder,
            ...modelParams(),
          });
          if (!live()) return;
          const candidateId = `draft-${Date.now().toString(36)}-${runId}`;
          dispatch({
            type: "runSucceeded",
            runId,
            kind: "candidate",
            payload: result,
            title,
            candidateId,
          });
          // 双稿裁决（WF5-09 验收 1）：选中正典场景的生成成功 →
          // 助手关闭、写作区原位切双稿；来源与基线随快照锁定。
          const proseKind = ws.proseKind;
          if (
            factsNow.sceneId &&
            ws.proseSceneId === factsNow.sceneId &&
            (proseKind === "draft" || proseKind === "canonical")
          ) {
            const source: DualDraftSource = {
              candidateId,
              candidateTitle: title,
              sceneId: factsNow.sceneId,
              sceneTitle: factsNow.title,
              storyOrder: factsNow.storyOrder,
              baseKind: proseKind,
              baseText: factsNow.proseMarkdown,
              baselineVersionId: ws.proseVersionId,
              candidateText: result.markdown,
            };
            dispatchDual({
              type: "sessionOpened",
              source,
              segments: extractSegments(source.baseText, source.candidateText),
            });
            ws.setAssistantOpen(false);
          }
        } else if (intent === "discuss") {
          const question =
            stateRef.current.instruction.trim() || DEFAULT_QUESTION;
          const result = await gateway.discuss(cwd, {
            contextId: assembly.pkg.contextId,
            question: composed || question,
            ...modelParams(),
          });
          if (!live()) return;
          dispatch({
            type: "runSucceeded",
            runId,
            kind: "discussion",
            payload: result,
          });
        } else {
          const prose = factsNow.proseMarkdown;
          if (!prose.trim()) {
            dispatch({
              type: "runFailed",
              runId,
              error: "当前没有可检查的正文——先选中或写一段正文。",
            });
            ws.reportGeneration("error");
            return;
          }
          const result = await gateway.inspect(cwd, {
            contextId: assembly.pkg.contextId,
            proseMarkdown: prose,
            focus: stateRef.current.instruction.trim() || undefined,
            ...modelParams(),
          });
          if (!live()) return;
          dispatch({
            type: "runSucceeded",
            runId,
            kind: "inspection",
            payload: result,
          });
        }
        ws.reportGeneration("idle");
      } catch (raw) {
        if (!live()) return;
        dispatch({
          type: "runFailed",
          runId,
          error: describeRpcError(raw).message,
        });
        ws.reportGeneration("error");
      }
    },
    [cwd, gateway, assembleParams, modelParams, runIdGuard, ws],
  );

  /** 整章批量：逐场景装配＋生成，每场景独立上下文（WF2-11 语义保持）。 */
  const runChapter = useCallback(
    async (chapterId: string) => {
      const chapter = chapterDirectory.find((entry) => entry.id === chapterId);
      if (!chapter || chapter.scenes.length === 0) {
        dispatch({
          type: "errorRaised",
          error: "该章节还没有挂接场景——先在规划区建场景计划。",
        });
        return;
      }
      const runId = ++runIdRef.current;
      dispatch({ type: "runStarted", runId });
      ws.reportGeneration("running");
      const live = runIdGuard(runId);
      try {
        let produced = 0;
        for (const scene of chapter.scenes) {
          const current = stateRef.current;
          const assembly = await gateway.assemble(cwd, {
            ...assembleParams(current),
            storyOrder: scene.storyOrder,
          });
          if (!live()) return;
          const result = await gateway.generateCandidate(cwd, {
            contextId: assembly.pkg.contextId,
            title: `${chapter.label} · ${scene.title}`,
            authorInstruction: composeInstruction(
              stateRef.current,
              null,
              stateRef.current.includePlan,
            ),
            narrativeMode: "third_person_limited",
            viewpointCharacterId:
              stateRef.current.viewpointCharacterId ?? undefined,
            storyOrder: scene.storyOrder,
            ...modelParams(),
          });
          if (!live()) return;
          produced += 1;
          dispatch({
            type: "candidateAppended",
            runId,
            candidate: {
              id: `draft-${Date.now().toString(36)}-${produced}`,
              title: `${chapter.label} · ${scene.title}`,
              markdown: result.markdown,
              usage: result.usage,
            },
          });
        }
        dispatch({
          type: "runCompleted",
          runId,
          notice: `「${chapter.label}」整章生成完毕，共 ${produced} 个候选。`,
        });
        ws.reportGeneration("idle");
      } catch (raw) {
        if (!live()) return;
        dispatch({
          type: "runFailed",
          runId,
          error: describeRpcError(raw).message,
        });
        ws.reportGeneration("error");
      }
    },
    [
      cwd,
      gateway,
      chapterDirectory,
      assembleParams,
      modelParams,
      runIdGuard,
      ws,
    ],
  );

  const run = useCallback(async () => {
    if (surface !== null) {
      if (activeAction) await runWorkspace(activeAction);
      return;
    }
    if (!(await ensureProviderReady())) return;
    const current = stateRef.current;
    if (current.intent === "generate" && current.scope === "chapter") {
      await runChapter(current.chapterId ?? chapterDirectory[0]?.id ?? "");
      return;
    }
    await runSingle(current.intent);
  }, [
    surface,
    activeAction,
    runWorkspace,
    ensureProviderReady,
    runChapter,
    runSingle,
    chapterDirectory,
  ]);

  const cancel = useCallback(() => {
    const runId = stateRef.current.activeRunId;
    if (runId === 0) return;
    dispatch({ type: "runCancelled", runId });
    ws.reportGeneration("idle");
  }, [ws]);

  /** 光标续写：结果直接追加回当前草稿（不走候选）。 */
  const continueDraft = useCallback(async () => {
    const bridge = continuationRef.current;
    if (!bridge) {
      dispatch({
        type: "errorRaised",
        error: "先在正文面打开一份手编草稿，才能续写。",
      });
      return;
    }
    if (!(await ensureProviderReady())) return;
    const runId = ++runIdRef.current;
    dispatch({ type: "runStarted", runId });
    ws.reportGeneration("running");
    const runLive = runIdGuard(runId);
    const live = () => {
      if (!runLive()) return false;
      if (bridge.isCurrent?.() === false) {
        dispatch({ type: "runCancelled", runId });
        ws.reportGeneration("idle");
        return false;
      }
      return true;
    };
    try {
      const current = stateRef.current;
      const assembly = await gateway.assemble(cwd, assembleParams(current));
      if (!live()) return;
      const seed = bridge.getText().trimEnd().slice(-600);
      const result = await gateway.generateCandidate(cwd, {
        contextId: assembly.pkg.contextId,
        title: "光标续写",
        authorInstruction: composeInstruction(
          stateRef.current,
          null,
          false,
          `不要重复已有内容，直接续写后续正文。接续文本（末尾片段）：\n${seed}`,
        ),
        narrativeMode: "third_person_limited",
        viewpointCharacterId:
          stateRef.current.viewpointCharacterId ?? undefined,
        storyOrder: factsRef.current.storyOrder,
        ...modelParams(),
      });
      if (!live()) return;
      bridge.append(result.markdown);
      dispatch({
        type: "runSucceeded",
        runId,
        kind: "prose-append",
        payload: result,
      });
      ws.reportGeneration("idle");
    } catch (raw) {
      if (!live()) return;
      dispatch({
        type: "runFailed",
        runId,
        error: describeRpcError(raw).message,
      });
      ws.reportGeneration("error");
    }
  }, [
    cwd,
    gateway,
    assembleParams,
    modelParams,
    ensureProviderReady,
    runIdGuard,
    ws,
  ]);

  /** 一键精简（WF2-13 语义保持）：整篇替换回草稿，可来源差异对比/放弃。 */
  const condenseDraft = useCallback(async () => {
    const bridge = continuationRef.current;
    if (!bridge?.replaceAll) {
      dispatch({
        type: "errorRaised",
        error: "一键精简作用于正文面的手编草稿——先打开一份草稿。",
      });
      return;
    }
    if (!(await ensureProviderReady())) return;
    const source = bridge.getText();
    if (!source.trim()) {
      dispatch({
        type: "errorRaised",
        error: "草稿是空的，没有可精简的内容。",
      });
      return;
    }
    const runId = ++runIdRef.current;
    dispatch({ type: "runStarted", runId });
    ws.reportGeneration("running");
    const runLive = runIdGuard(runId);
    const live = () => {
      if (!runLive()) return false;
      if (bridge.isCurrent?.() === false) {
        dispatch({ type: "runCancelled", runId });
        ws.reportGeneration("idle");
        return false;
      }
      return true;
    };
    try {
      const current = stateRef.current;
      const assembly = await gateway.assemble(cwd, assembleParams(current));
      if (!live()) return;
      const result = await gateway.generateCandidate(cwd, {
        contextId: assembly.pkg.contextId,
        title: "一键精简",
        authorInstruction: composeInstruction(
          stateRef.current,
          null,
          false,
          "去掉冗余重复与空泛修饰，保留情节骨架、关键细节与人物声音。只输出精简后的全文。",
        ),
        narrativeMode: "third_person_limited",
        viewpointCharacterId:
          stateRef.current.viewpointCharacterId ?? undefined,
        storyOrder: factsRef.current.storyOrder,
        ...modelParams(),
      });
      if (!live()) return;
      bridge.replaceAll?.(result.markdown);
      ws.reportSaved();
      dispatch({
        type: "runSucceeded",
        runId,
        kind: "prose-replace",
        payload: result,
      });
      ws.reportGeneration("idle");
    } catch (raw) {
      if (!live()) return;
      dispatch({
        type: "runFailed",
        runId,
        error: describeRpcError(raw).message,
      });
      ws.reportGeneration("error");
    }
  }, [
    cwd,
    gateway,
    assembleParams,
    modelParams,
    ensureProviderReady,
    runIdGuard,
    ws,
  ]);

  const adoptCandidate = useCallback(
    async (candidate: AssistantCandidate) => {
      if (candidate.adopted) return;
      try {
        const created = await gateway.adoptCandidate(cwd, {
          title: candidate.title,
          markdown: candidate.markdown,
          viewpointCharacterId:
            stateRef.current.viewpointCharacterId ?? undefined,
          storyOrder: factsRef.current.storyOrder,
          authorInstruction: composeInstruction(
            stateRef.current,
            factsRef.current.planTask,
            stateRef.current.includePlan,
          ),
        });
        dispatch({
          type: "candidateAdopted",
          candidateId: candidate.id,
          sceneId: created.sceneId,
          proposalId: created.proposalId,
        });
        ws.reportSaved();
      } catch (raw) {
        dispatch({ type: "errorRaised", error: describeRpcError(raw).message });
      }
    },
    [cwd, gateway, ws],
  );

  const reviewCandidate = useCallback(
    async (candidate: AssistantCandidate) => {
      if (!candidate.adopted || candidate.reviewed) return;
      try {
        const review = await gateway.sendForReview(cwd, {
          proposalId: candidate.adopted.proposalId,
        });
        const flavorCount = review.findings.filter((finding) =>
          finding.code.startsWith("AI_FLAVOR"),
        ).length;
        dispatch({
          type: "candidateReviewed",
          candidateId: candidate.id,
          flavorCount,
        });
      } catch (raw) {
        dispatch({ type: "errorRaised", error: describeRpcError(raw).message });
      }
    },
    [cwd, gateway],
  );

  const registerContinuation = useCallback(
    (bridge: ContinuationBridge | null) => {
      continuationRef.current = bridge;
      setContinuationReady(bridge !== null);
    },
    [],
  );

  const registerAdoption = useCallback((bridge: AdoptionBridge | null) => {
    adoptionRef.current = bridge;
  }, []);

  // ── 双稿裁决（WF5-09）：三种决策动作的编排边界 ─────────────────
  const toggleDualSegment = useCallback((segmentId: string, on: boolean) => {
    dispatchDual({ type: "segmentToggled", segmentId, on });
  }, []);

  const clearDualSelection = useCallback(() => {
    dispatchDual({ type: "selectionCleared" });
  }, []);

  const confirmPartialAdoption = useCallback(
    (markdown: string, adoptedCount: number, draftTitle: string) => {
      const session = dualDraftRef.current.session;
      if (!session || session.phase !== "comparing") return;
      dispatch({
        type: "candidateConverted",
        candidateId: session.source.candidateId,
      });
      dispatchDual({
        type: "adoptionConfirmed",
        result: { mode: "partial", markdown, adoptedCount, draftTitle },
      });
    },
    [],
  );

  const adoptCandidateAsDraft = useCallback(() => {
    const session = dualDraftRef.current.session;
    if (!session || session.phase !== "comparing") return;
    dispatch({
      type: "candidateConverted",
      candidateId: session.source.candidateId,
    });
    dispatchDual({
      type: "adoptionConfirmed",
      result: {
        mode: "full",
        markdown: session.source.candidateText,
        adoptedCount: 0,
        draftTitle:
          session.source.candidateTitle ||
          session.source.sceneTitle ||
          "未命名",
      },
    });
  }, []);

  const undoDualAdoption = useCallback(() => {
    dispatchDual({ type: "adoptionUndone" });
  }, []);

  const discardDualCandidate = useCallback(() => {
    const session = dualDraftRef.current.session;
    if (!session) return;
    // 放弃＝零版本副作用：仅移除候选并关会话，恢复单稿。
    dispatch({
      type: "candidateDropped",
      candidateId: session.source.candidateId,
    });
    dispatchDual({ type: "sessionClosed" });
  }, []);

  const resumeWriting = useCallback(() => {
    dispatchDual({ type: "sessionClosed" });
  }, []);

  // 采用落地（WF5-09）：确认结果经 adoption bridge 交 ProseEditor 开手编草稿。
  // 以结果对象为幂等键：撤销再确认是新对象，会重新落地；同一结果不重复落地。
  const lastLandedRef = useRef<DualDraftResult | null>(null);
  useEffect(() => {
    const session = dualDraft.session;
    if (session?.phase !== "adopted" || !session.result) return;
    if (lastLandedRef.current === session.result) return;
    lastLandedRef.current = session.result;
    adoptionRef.current?.adopt({
      sceneId: session.source.sceneId,
      markdown: session.result.markdown,
      title: session.result.draftTitle,
    });
  }, [dualDraft]);

  const reopenAssistantForRegenerate = useCallback(() => {
    const session = dualDraftRef.current.session;
    if (session) {
      dispatch({
        type: "instructionChanged",
        value: "基线已过期：正式稿在生成后已更新，请复核上下文后重新生成。",
      });
      dispatch({
        type: "titleChanged",
        value: session.source.candidateTitle || session.source.sceneTitle || "",
      });
      dispatch({ type: "intentChanged", intent: "generate" });
    }
    ws.setAssistantOpen(true);
  }, [ws]);

  const registerChapterDirectory = useCallback(
    (entries: ChapterIndexEntry[]) => {
      setChapterDirectory(entries);
    },
    [],
  );

  const seedFromVersion = useCallback(
    (version: {
      sceneTitle: string;
      storyOrder: number;
      versionId: string;
    }) => {
      dispatch({
        type: "instructionChanged",
        value: `以历史版本 ${version.versionId.slice(0, 12)}… 为基重新生成：保留其骨架，修正不足。`,
      });
      dispatch({
        type: "titleChanged",
        value: `${version.sceneTitle}·重生成`,
      });
      dispatch({ type: "intentChanged", intent: "generate" });
      ws.setAssistantOpen(true);
    },
    [ws],
  );

  const saveKeyAndContinue = useCallback(
    async (key: string) => {
      const provider = activeProvider;
      if (!provider) return;
      try {
        await saveProviderKey(provider.id, key.trim());
        const probe = await probeProvider(provider);
        if (!probe.ok) {
          dispatch({
            type: "errorRaised",
            error: `连通测试未通过（${probe.status}）：${probe.hint}`,
          });
          return;
        }
        setByokCardOpen(false);
        await run();
      } catch (raw) {
        dispatch({ type: "errorRaised", error: describeRpcError(raw).message });
      }
    },
    [activeProvider, run],
  );

  const switchProvider = useCallback((providerId: string) => {
    setActiveProviderId(providerId);
  }, []);

  const value = useMemo<AssistantValue>(() => {
    const setIntent = (intent: AssistantIntent) =>
      dispatch({ type: "intentChanged", intent });
    const setInstruction = (v: string) =>
      dispatch({ type: "instructionChanged", value: v });
    return {
      state,
      open,
      busy: state.phase === "assembling" || state.phase === "running",
      openAssistant: () => ws.setAssistantOpen(true),
      closeAssistant: () => ws.setAssistantOpen(false),
      toggleAssistant: () => ws.setAssistantOpen(!ws.assistantOpen),
      setIntent,
      setInstruction,
      setStyle: (toneSuffix, densitySuffix) =>
        dispatch({ type: "styleChanged", toneSuffix, densitySuffix }),
      setScope: (scope, chapterId) =>
        dispatch({ type: "scopeChanged", scope, chapterId }),
      setViewpoint: (characterId) =>
        dispatch({ type: "viewpointChanged", characterId }),
      setTitle: (v: string) => dispatch({ type: "titleChanged", value: v }),
      toggleEntity: (characterId, on) =>
        dispatch({ type: "entityToggled", characterId, on }),
      toggleCategory: (category, on) =>
        dispatch({ type: "categoryToggled", category, on }),
      run,
      cancel,
      continueDraft,
      condenseDraft,
      adoptCandidate,
      reviewCandidate,
      registerContinuation,
      continuationReady,
      registerAdoption,
      dualDraft,
      toggleDualSegment,
      clearDualSelection,
      confirmPartialAdoption,
      adoptCandidateAsDraft,
      undoDualAdoption,
      discardDualCandidate,
      resumeWriting,
      reopenAssistantForRegenerate,
      registerChapterDirectory,
      seedFromVersion,
      dismiss: () => dispatch({ type: "dismissed" }),
      clearResponse: () => dispatch({ type: "responseCleared" }),
      byokCardOpen,
      closeByokCard: () => setByokCardOpen(false),
      saveKeyAndContinue,
      activeProvider,
      byokProviders: byokConfig.providers,
      switchProvider,
      surface,
      workspaceActions,
      activeAction,
      selectAction,
      subject,
      registerAssistantSubject,
    };
  }, [
    state,
    open,
    ws,
    run,
    cancel,
    continueDraft,
    condenseDraft,
    adoptCandidate,
    reviewCandidate,
    registerContinuation,
    continuationReady,
    registerAdoption,
    dualDraft,
    toggleDualSegment,
    clearDualSelection,
    confirmPartialAdoption,
    adoptCandidateAsDraft,
    undoDualAdoption,
    discardDualCandidate,
    resumeWriting,
    reopenAssistantForRegenerate,
    registerChapterDirectory,
    seedFromVersion,
    byokCardOpen,
    saveKeyAndContinue,
    activeProvider,
    byokConfig.providers,
    switchProvider,
    surface,
    workspaceActions,
    activeAction,
    selectAction,
    subject,
    registerAssistantSubject,
  ]);

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}

/** 确定性默认人物勾选：视点优先；无视点且仅一位人物时选它。 */
function defaultEntityIds(
  graph: { characters: Array<{ id: string }> } | null,
  viewpointCharacterId: string | null,
): ReadonlySet<string> {
  if (!graph || graph.characters.length === 0) return new Set();
  if (
    viewpointCharacterId &&
    graph.characters.some((character) => character.id === viewpointCharacterId)
  ) {
    return new Set([viewpointCharacterId]);
  }
  if (graph.characters.length === 1) {
    return new Set([graph.characters[0]?.id ?? ""]);
  }
  return new Set();
}

export function useAssistant(): AssistantValue {
  const value = useContext(AssistantContext);
  if (!value) throw new Error("useAssistant 必须在 AssistantProvider 内使用");
  return value;
}
