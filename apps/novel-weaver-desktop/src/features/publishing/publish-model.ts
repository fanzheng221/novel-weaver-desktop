import type {
  ExportedArtifact,
  PublicationEditionSummary,
  PublicationReviewFinding,
} from "novel-weaver-core/src/domain/publication.ts";
import type { ReviewInboxProjection } from "novel-weaver-core/src/domain/review-inbox.ts";

/**
 * WF5-16「发布检查、版本与导出线性流程」纯模型：
 *   · 主流程 发布检查 → 创建/选择发布版本 → 作者确认 → 导出，每步一个主动作；
 *   · 检查概览一次回答三件事——是否定稿、是否仍有阻断、可导出哪些格式；
 *   · 阻断/可继续条件全部来自核心事实（收件箱投影、规划图、已定稿版本），
 *     前端只翻译作者语言与深链落点，不自行猜测一致性结论；
 *   · 发布版本不可变：定稿后正文再更新，旧版本如实标注「正文已更新」。
 * 组件负责 RPC 与焦点；状态迁移、条件派生、文案都在这里，fixture 直打。
 */

export type PublishFormat = "txt" | "markdown" | "html" | "epub";

export const PUBLISH_FORMATS: PublishFormat[] = [
  "txt",
  "markdown",
  "html",
  "epub",
];

export const FORMAT_LABEL: Record<PublishFormat, string> = {
  txt: "TXT",
  markdown: "MD",
  html: "HTML",
  epub: "EPUB",
};

export const FORMAT_HINT: Record<PublishFormat, string> = {
  txt: "平台投稿通用",
  markdown: "存档与二次编辑",
  html: "自站网页阅读",
  epub: "电子书阅读器",
};

/** 主流程四步；每步只暴露一个清晰主动作。 */
export type PublishStep = "check" | "version" | "confirm" | "export";

export const STEP_LABEL: Record<PublishStep, string> = {
  check: "发布检查",
  version: "发布版本",
  confirm: "确认定版",
  export: "导出",
};

export const STEP_ORDER: PublishStep[] = [
  "check",
  "version",
  "confirm",
  "export",
];

export type Scope =
  | { mode: "book" }
  | { mode: "volume"; id: string }
  | { mode: "chapter"; id: string };

/** 规划图节点的最小形状（planning_graph_query）。 */
export interface PlanningNode {
  id: string;
  kind: string;
  title: string;
  content: Record<string, unknown>;
}

export interface PendingPublicationSummary {
  proposalId: string;
  revision: number;
}

/** 检查步的一次只读输入（全部来自核心投影，零写入）。 */
export interface PublishCheckInputs {
  inbox: ReviewInboxProjection | null;
  planningNodes: PlanningNode[];
  editions: PublicationEditionSummary[];
  canonicalSceneCount: number;
  pendingPublications: PendingPublicationSummary[];
}

export interface CheckIssue {
  key: string;
  severity: "blocking" | "warning";
  /** 作者语言主文案；实现词只进可展开详情。 */
  title: string;
  deepLink: { hash: string; label: string } | null;
}

export interface PublishSnapshot {
  /** 无阻断项即可继续定版。 */
  readyToPublish: boolean;
  blockingCount: number;
  /** 阻断在前，其后是警告；供检查步逐条深链处理。 */
  issues: CheckIssue[];
  editions: PublicationEditionSummary[];
  /** 已定稿版本里「正文已更新」的个数。 */
  staleEditionCount: number;
  canCreateVersion: boolean;
  canonicalSceneCount: number;
  /** 待确认的发布提案：恢复「创建过但没定完版」的流程。 */
  pendingPublications: PendingPublicationSummary[];
  /** 一句话回答：定稿了吗 / 还有阻断吗 / 能导出什么格式。 */
  summary: string;
}

/** 检查步阻断来源之一：未回收伏笔（与核心定版门同一判定）。 */
function promiseIssues(nodes: PlanningNode[]): CheckIssue[] {
  return nodes
    .filter((node) => node.kind === "story_promise")
    .filter((node) => (node.content.status ?? "open") !== "paid_off")
    .map((node) => ({
      key: `promise:${node.id}`,
      severity: "blocking" as const,
      title: `未回收的伏笔：${node.title}`,
      deepLink: { hash: "#/planning/foreshadow", label: "去伏笔追踪表" },
    }));
}

/** 检查步阻断来源之二：待确认候选上的开放审校问题（来自收件箱投影）。 */
function findingIssues(inbox: ReviewInboxProjection | null): CheckIssue[] {
  if (!inbox) return [];
  const rank = { blocking: 0, warning: 1, advisory: 2 } as const;
  return [...inbox.findings]
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .map((finding) => ({
      key: `finding:${finding.findingId}`,
      severity:
        finding.severity === "blocking" ? ("blocking" as const) : ("warning" as const),
      title: finding.message,
      deepLink:
        finding.severity === "blocking"
          ? { hash: "#/review", label: "去审校收件箱处理" }
          : null,
    }));
}

/** 定稿后正文又更新过的版本条目注记（作者语言）。 */
export function editionNotes(edition: PublicationEditionSummary): string[] {
  if (edition.scenesChanged <= 0) return [];
  return [
    `这版定稿后，有 ${edition.scenesChanged} 个场景的正文又更新过。内容以最新正文为准时，建议创建新版本。`,
  ];
}

export function buildPublishSnapshot(inputs: PublishCheckInputs): PublishSnapshot {
  const issues = [...promiseIssues(inputs.planningNodes), ...findingIssues(inputs.inbox)];
  const contentIssue =
    inputs.canonicalSceneCount === 0
      ? {
          key: "content:empty",
          severity: "blocking" as const,
          title: "还没有已确认入正典的正文，先写出并确认第一章。",
          deepLink: { hash: "#/writing", label: "去写作台" },
        }
      : null;
  const allIssues = contentIssue ? [contentIssue, ...issues] : issues;
  const finalBlocking = allIssues.filter((issue) => issue.severity === "blocking").length;
  const staleEditionCount = inputs.editions.filter(
    (edition) => edition.scenesChanged > 0,
  ).length;
  const finalized = inputs.editions.length;
  const summary = [
    finalized > 0
      ? `已有 ${finalized} 个发布版本定稿${staleEditionCount > 0 ? `（其中 ${staleEditionCount} 个的正文已更新）` : ""}。`
      : "还没有定稿的发布版本。",
    finalBlocking > 0
      ? `有 ${finalBlocking} 项必须先处理的问题。`
      : "没有阻断项，可以定版。",
    "可导出 TXT / MD / HTML / EPUB 四种格式。",
  ].join("");
  return {
    readyToPublish: finalBlocking === 0,
    blockingCount: finalBlocking,
    issues: allIssues,
    editions: inputs.editions,
    staleEditionCount,
    canCreateVersion: inputs.canonicalSceneCount > 0,
    canonicalSceneCount: inputs.canonicalSceneCount,
    pendingPublications: inputs.pendingPublications,
    summary,
  };
}

/* ── 发布版本范围（从导出向导迁移为纯函数） ─────────────────────────── */

export function scopeLabel(nodes: PlanningNode[], scope: Scope): string {
  if (scope.mode === "book") return "全书";
  if (scope.mode === "volume") {
    const volume = nodes.find((node) => node.id === scope.id);
    return `卷 · ${volume?.title ?? ""}`;
  }
  const chapter = nodes.find((node) => node.id === scope.id);
  return `章 · ${chapter?.title ?? ""}`;
}

function chapterSceneIds(nodes: PlanningNode[], chapterId: string): string[] {
  const chapter = nodes.find((node) => node.id === chapterId);
  return Array.isArray(chapter?.content.sceneIds)
    ? (chapter?.content.sceneIds as string[])
    : [];
}

/**
 * 范围 → 场景 id 列表；全书返回 null 表示交由核心取全部正典场景。
 * 卷经 volume_plan 的 chapterIds 解析到章，再取各章的 sceneIds——
 * 与发布提案核心侧的范围语义一致。
 */
export function resolveScopeSceneIds(
  nodes: PlanningNode[],
  scope: Scope,
): string[] | null {
  if (scope.mode === "book") return null;
  const chapterIds =
    scope.mode === "chapter"
      ? [scope.id]
      : (() => {
          const volume = nodes.find((node) => node.id === scope.id);
          return Array.isArray(volume?.content.chapterIds)
            ? (volume?.content.chapterIds as string[])
            : [];
        })();
  const ids = [
    ...new Set(chapterIds.flatMap((chapterId) => chapterSceneIds(nodes, chapterId))),
  ];
  return ids;
}

export function scopeHasScenes(nodes: PlanningNode[], scope: Scope): boolean {
  return scope.mode === "book" || resolveScopeSceneIds(nodes, scope)!.length > 0;
}

/* ── 流程状态机：步骤推进、确认条件、导出失败恢复 ──────────────────── */

export interface NewVersionDraft {
  scope: Scope;
  title: string;
  formats: PublishFormat[];
}

export interface ConfirmedProposal {
  proposalId: string;
  revision: number;
  title: string;
  formats: PublishFormat[];
  sceneCount: number;
  findings: PublicationReviewFinding[];
  canPublish: boolean;
}

export interface ExportAttempt {
  /** 目标目录；失败后原样保留，作者改完原地重试。 */
  directory: string;
  phase: "idle" | "exporting" | "done" | "failed";
  artifacts: ExportedArtifact[] | null;
  error: string | null;
}

export interface PublishFlowState {
  step: PublishStep;
  draft: NewVersionDraft;
  /** 确认步的发布提案（创建或从待确认列表继续）。 */
  proposal: ConfirmedProposal | null;
  /** 已定稿待导出的版本；确认步产物或来自已定稿列表。 */
  edition: { editionId: string; title: string; formats: PublishFormat[] } | null;
  export: ExportAttempt;
}

export function initialPublishFlowState(defaultDirectory: string): PublishFlowState {
  return {
    step: "check",
    draft: { scope: { mode: "book" }, title: "全书导出", formats: ["txt"] },
    proposal: null,
    edition: null,
    export: { directory: defaultDirectory, phase: "idle", artifacts: null, error: null },
  };
}

/** 确认门：与核心批准门同义——有阻断即不可定版。 */
export function canConfirm(proposal: ConfirmedProposal): boolean {
  return proposal.canPublish;
}

export function findingDeepLink(
  finding: PublicationReviewFinding,
): { hash: string; label: string } | null {
  if (finding.code === "OPEN_SCENE_BLOCKER") {
    return { hash: "#/review", label: "去审校收件箱处理" };
  }
  if (finding.code === "UNRESOLVED_STORY_PROMISE") {
    return { hash: "#/planning/foreshadow", label: "去伏笔追踪表" };
  }
  return null;
}

export type PublishFlowAction =
  | { type: "goToStep"; step: PublishStep }
  | { type: "editDraft"; patch: Partial<NewVersionDraft> }
  | { type: "proposalReviewed"; proposal: ConfirmedProposal }
  | { type: "continueProposal"; proposal: ConfirmedProposal }
  | { type: "confirmAccepted"; editionId: string }
  | { type: "selectEdition"; edition: PublicationEditionSummary }
  | { type: "setExportDirectory"; directory: string }
  | { type: "exportStarted" }
  | { type: "exportSucceeded"; artifacts: ExportedArtifact[] }
  | { type: "exportFailed"; error: string };

/**
 * 步骤推进守卫：确认步必须先有通过检查的提案；导出步必须有已定稿版本。
 * 失败不回退步骤——错误就地呈现，目录、格式与版本选择全部保留。
 */
export function publishFlowReducer(
  state: PublishFlowState,
  action: PublishFlowAction,
): PublishFlowState {
  switch (action.type) {
    case "goToStep": {
      if (action.step === "confirm" && !state.proposal) return state;
      if (action.step === "export" && !state.edition) return state;
      return { ...state, step: action.step };
    }
    case "editDraft":
      return { ...state, draft: { ...state.draft, ...action.patch } };
    case "proposalReviewed":
    case "continueProposal":
      return {
        ...state,
        step: "confirm",
        proposal: action.proposal,
      };
    case "confirmAccepted":
      return {
        ...state,
        step: "export",
        edition: {
          editionId: action.editionId,
          title: state.proposal?.title ?? "发布版本",
          formats: state.proposal?.formats ?? ["txt"],
        },
        export: {
          ...state.export,
          phase: "idle",
          artifacts: null,
          error: null,
        },
      };
    case "selectEdition":
      return {
        ...state,
        step: "export",
        edition: {
          editionId: action.edition.editionId,
          title: action.edition.title,
          formats: action.edition.formats,
        },
        export: {
          ...state.export,
          phase: "idle",
          artifacts: null,
          error: null,
        },
      };
    case "setExportDirectory":
      return {
        ...state,
        export: { ...state.export, directory: action.directory },
      };
    case "exportStarted":
      return {
        ...state,
        export: { ...state.export, phase: "exporting", error: null },
      };
    case "exportSucceeded":
      return {
        ...state,
        export: {
          ...state.export,
          phase: "done",
          artifacts: action.artifacts,
          error: null,
        },
      };
    case "exportFailed":
      return {
        ...state,
        export: { ...state.export, phase: "failed", error: action.error },
      };
  }
}
