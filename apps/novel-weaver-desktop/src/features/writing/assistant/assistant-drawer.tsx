import { X } from "lucide-react";
import { IconButton } from "../../../shared/ui/icons";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useWorkspace } from "../../../shared/workspace/context";
import { Button, Chip, InlineNote, TextField } from "../../../shared/ui/components";
import { HINTS } from "../../../shared/ui/copy";
import { cx } from "../../../shared/ui/cx";
import { useModalFocus } from "../../../shared/ui/focus";
import { sidePanelTransitionIn, sidePanelTransitionOut } from "../../../shared/ui/motion";
import { useDelayedFlag } from "../../../shared/ui/states";
import { useAssistant } from "./assistant-context";
import { AssistantResults } from "./assistant-results";
import {
  densitySuffix,
  INTENT_CONFIG,
  QUICK_PROMPTS,
  STYLE_PRESETS,
} from "./intents";
import { type AssistantIntent, phaseAnnouncement } from "./machine";
import { presentContext } from "./presenter";
import { SURFACE_LABEL } from "./workspace-actions";

/**
 * 覆盖式 AI 助手抽屉（WF5-07）：确认基线为 A 覆盖式侧滑＋三类作者意图。
 * 覆盖层不改变纸面宽度；Esc/关闭后焦点经 useModalFocus 归还入口。
 */

const INTENT_ORDER: AssistantIntent[] = ["generate", "discuss", "inspect"];

function ByokInlineCard() {
  const assistant = useAssistant();
  const [keyDraft, setKeyDraft] = useState("");
  if (!assistant.byokCardOpen || !assistant.activeProvider) return null;
  const provider = assistant.activeProvider;
  return (
    <div
      className="grid place-items-center bg-[rgba(10,10,12,0.6)]"
      style={{ position: "fixed", inset: 0, zIndex: 85 }}
    >
      <div className="w-100 max-w-[92vw] bg-rail border border-line rounded-lg p-6">
        <h2 className="m-0 mb-1 font-wenkai text-[16px]">
          连接 {provider.name}
        </h2>
        <p className="mt-0 text-[11.5px] text-ink-mid leading-[1.8]">
          Key 将存入系统钥匙串（界面只显示尾四位），保存后自动续上刚才的动作。
        </p>
        <TextField
          label="API Key"
          value={keyDraft}
          onChange={setKeyDraft}
          placeholder="sk-…"
        />
        <div className="flex gap-1 mt-3">
          <Button
            variant="primary"
            onClick={() => void assistant.saveKeyAndContinue(keyDraft)}
          >
            保存并继续
          </Button>
          <Button onClick={assistant.closeByokCard}>取消</Button>
        </div>
      </div>
    </div>
  );
}

export function AssistantDrawer({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const assistant = useAssistant();
  const ws = useWorkspace();
  const drawerRef = useModalFocus<HTMLDivElement>(assistant.open);
  const showPhase = useDelayedFlag(assistant.busy);
  const [contextOpen, setContextOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const [toneKey, setToneKey] = useState("none");
  const [density, setDensity] = useState(50);

  // Esc 全局可退（WF3-11 同款键盘路径）：关闭抽屉并把焦点归还入口。
  const closeAssistant = assistant.closeAssistant;
  useEffect(() => {
    if (!assistant.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeAssistant();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [assistant.open, closeAssistant]);

  const { state } = assistant;
  const config = INTENT_CONFIG[state.intent];
  // 跨工作区 AI（WF5-17）：非写作面渲染工作区动作变体，共享骨架与状态机。
  const surface = assistant.surface;
  const isWorkspace = surface !== null;
  const action = assistant.activeAction;
  const workspaceSubject = isWorkspace ? assistant.subject : null;
  const subjectMissing = Boolean(
    isWorkspace && action?.requiresSubject && !workspaceSubject,
  );
  const summary = presentContext({
    pkg: state.contextPackage,
    graph: state.contextGraph,
    scene: {
      title: ws.sceneBriefing?.sceneTitle ?? null,
      storyOrder: ws.sceneBriefing?.storyOrder ?? 10,
      planTask: ws.sceneBriefing?.purpose ?? null,
    },
    includedEntityIds:
      workspaceSubject?.entityIds != null
        ? new Set(workspaceSubject.entityIds)
        : state.includedEntityIds,
    excludeEvidence: state.excludeEvidence,
    excludeKnowledge: state.excludeKnowledge,
    excludeOutline: state.excludeOutline,
    excludeStyle: state.excludeStyle,
    includePlan: state.includePlan,
    instruction: state.instruction,
  });
  /** 场景门禁（WF5-03 语义）：有场景未选 → 禁用并解释；零场景冷启动可用。 */
  const needsScene =
    ws.sceneCount !== null && ws.sceneCount > 0 && ws.proseSceneId === null;
  const characters = state.contextGraph?.characters ?? [];
  const chapterDirectory = assistant.state.scope === "chapter";
  const currentSceneLabel = ws.proseLabel
    ? `当前场景：${ws.proseLabel}`
    : ws.sceneCount === 0
      ? HINTS.aiFirstScene
      : needsScene
        ? HINTS.aiNeedsScene
        : null;

  return (
    <AnimatePresence>
      {assistant.open ? (
        <>
          <motion.button
            key="assistant-backdrop"
            type="button"
            aria-label="关闭 AI 助手"
            onClick={assistant.closeAssistant}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="ui-plain fixed inset-0 bg-[rgba(10,10,12,0.45)] cursor-default z-80"
          />
          <motion.aside
            key="assistant-drawer"
            ref={drawerRef}
            aria-label="AI 助手"
            initial={{ opacity: 0, x: 26 }}
            animate={{ opacity: 1, x: 0, transition: sidePanelTransitionIn }}
            exit={{ opacity: 0, x: 26, transition: sidePanelTransitionOut }}
            className="fixed top-10 right-0 bottom-0 bg-rail border-l border-line shadow-nw flex flex-col z-81"
            style={{ width: "min(390px, 62vw)" }}
          >
            {/* 头部：身份＋作用域说明 */}
            <div className="flex-none flex items-center gap-2 py-2 px-3.5 border-b border-line">
              <div className="min-w-0">
                <b className="font-wenkai text-[14px] block">AI 助手</b>
                <span className="block text-[10.5px] text-ink-low">
                  {surface !== null
                    ? `${SURFACE_LABEL[surface]}工作区 · 只出建议，不改内容`
                    : "只基于当前场景工作"}
                </span>
              </div>
              <span className="ml-auto">
                <IconButton icon={X} label="关闭" onClick={assistant.closeAssistant} />
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-2.5 grid gap-2.5 content-start">
              {/* 工作区动作片 / 写作三类意图 */}
              {isWorkspace ? (
                <div
                  role="tablist"
                  aria-label="AI 动作"
                  className={cx(
                    "grid border border-line rounded-md overflow-hidden",
                    assistant.workspaceActions.length <= 1
                      ? "grid-cols-1"
                      : "grid-cols-3",
                  )}
                >
                  {assistant.workspaceActions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={action?.id === item.id}
                      onClick={() => assistant.selectAction(item.id)}
                      className={cx(
                        "ui-plain cursor-pointer text-[11.5px] font-[inherit] py-1.5 px-1",
                        action?.id === item.id
                          ? "text-accent bg-accent-soft font-semibold"
                          : "text-ink-mid bg-transparent",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div
                  role="tablist"
                  aria-label="AI 工作方式"
                  className="grid grid-cols-3 border border-line rounded-md overflow-hidden"
                >
                  {INTENT_ORDER.map((intent) => (
                    <button
                      key={intent}
                      type="button"
                      role="tab"
                      aria-selected={state.intent === intent}
                      onClick={() => assistant.setIntent(intent)}
                      className={cx(
                        "ui-plain cursor-pointer text-[11.5px] font-[inherit] py-1.5 px-1",
                        state.intent === intent
                          ? "text-accent bg-accent-soft font-semibold"
                          : "text-ink-mid bg-transparent",
                      )}
                    >
                      {INTENT_CONFIG[intent].label}
                    </button>
                  ))}
                </div>
              )}
              <p className="m-0 text-[11px] leading-[1.7] text-ink-mid">
                {isWorkspace ? (action?.copy ?? "") : config.copy}
              </p>

              {/* 作者指令（工作区面＝动作的补充要求，可选） */}
              <div className="grid gap-1.5">
                <label
                  htmlFor="assistant-instruction"
                  className="text-[12px] text-ink-hi"
                >
                  {isWorkspace ? "补充要求" : "你希望这次推进什么？"}
                  <span className="ml-1.5 text-[10.5px] text-ink-low">
                    自然语言即可
                  </span>
                </label>
                <textarea
                  id="assistant-instruction"
                  value={state.instruction}
                  onChange={(event) =>
                    assistant.setInstruction(event.target.value)
                  }
                  placeholder={
                    isWorkspace
                      ? (action?.placeholder ?? "")
                      : config.placeholder
                  }
                  rows={3}
                  className="w-full bg-transparent border border-line rounded-[6px] text-[12.5px] leading-[1.8] text-ink-hi py-1.5 px-2 resize-y font-[inherit]"
                />
                {!isWorkspace ? (
                  <fieldset className="border-0 p-0 m-0">
                    <legend className="eyebrow p-0" id="assistant-quick-label">
                      快捷指令
                    </legend>
                    <div className="flex gap-1 flex-wrap">
                      {QUICK_PROMPTS.map((quick) => (
                        <Button
                          key={quick.label}
                          size="compact"
                          onClick={() => {
                            if (quick.prompt) {
                              assistant.setInstruction(quick.prompt);
                            } else {
                              void assistant.continueDraft();
                            }
                          }}
                        >
                          {quick.label}
                        </Button>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
              </div>

              {/* 冷启动标题（无场景可挂时才出现；工作区面不适用） */}
              {!isWorkspace && ws.sceneCount === 0 ? (
                <TextField
                  label="场景标题"
                  value={state.title}
                  onChange={assistant.setTitle}
                  placeholder="例如：庭院练武"
                />
              ) : null}

              {/* 可解释上下文 */}
              <div className="border border-line rounded-md">
                <button
                  type="button"
                  aria-expanded={contextOpen}
                  onClick={() => setContextOpen((open) => !open)}
                  className="ui-plain w-full cursor-pointer flex items-center gap-1.5 py-2 px-2.5 font-[inherit]"
                >
                  <b className="text-[12px]">本次上下文</b>
                  <span className="num text-[10.5px] text-ink-low">
                    {summary.includedCount === summary.totalCount
                      ? `完整 · ${summary.totalCount} 项`
                      : `已调整 · ${summary.includedCount}/${summary.totalCount} 项`}
                  </span>
                </button>
                {contextOpen ? (
                  <div className="grid gap-1.5 px-2.5 pb-2.5">
                    {summary.lines.map((line) => (
                      <div
                        key={line.key}
                        className="grid gap-1 text-[11px] leading-[1.6]"
                      >
                        <div className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={line.included}
                            disabled={
                              line.locked ||
                              line.editable ||
                              (isWorkspace && line.category === "characters")
                            }
                            onChange={(event) => {
                              if (line.category === "characters") {
                                // 人物行整体开关：全选/清空可选人物。
                                for (const character of characters) {
                                  assistant.toggleEntity(
                                    character.id,
                                    event.target.checked,
                                  );
                                }
                                return;
                              }
                              if (line.category === "plan") {
                                assistant.toggleCategory(
                                  "plan",
                                  event.target.checked,
                                );
                                return;
                              }
                              if (line.category === "outline") {
                                // 规划上下文（WF5-17）：撤回声明的规划工件。
                                assistant.toggleCategory(
                                  "outline",
                                  event.target.checked,
                                );
                                return;
                              }
                              if (line.category === "style") {
                                // 文风指导（WF6-02）：撤回启用中的风格特征。
                                assistant.toggleCategory(
                                  "style",
                                  event.target.checked,
                                );
                                return;
                              }
                              if (line.category === "evidence") {
                                assistant.toggleCategory(
                                  "evidence",
                                  event.target.checked,
                                );
                                return;
                              }
                              if (line.category === "knowledge") {
                                assistant.toggleCategory(
                                  "knowledge",
                                  event.target.checked,
                                );
                              }
                            }}
                          />
                          <b className="text-ink-hi">{line.label}</b>
                          {line.locked ? <Chip tone="accent">必带</Chip> : null}
                        </div>
                        {line.detail ? (
                          <p className="m-0 pl-5 text-ink-mid">{line.detail}</p>
                        ) : null}
                        {line.category === "characters" &&
                        !isWorkspace &&
                        characters.length > 0 ? (
                          <div className="flex gap-1 flex-wrap pl-5">
                            {characters.map((character) => (
                              <label
                                key={character.id}
                                className="inline-flex items-center gap-0.75 border border-line rounded-full py-px px-1.75 text-[10.5px] cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={state.includedEntityIds.has(
                                    character.id,
                                  )}
                                  onChange={(event) =>
                                    assistant.toggleEntity(
                                      character.id,
                                      event.target.checked,
                                    )
                                  }
                                />
                                {character.label}
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                    <p className="num m-0 text-[10px] text-ink-low">
                      预算占用 {summary.budgetPct}%
                      {summary.truncated ? " · 已截断" : ""}
                    </p>
                  </div>
                ) : null}
              </div>

              {/* 折叠参数：范围/视点/文风——写作面专属；工作区面不适用 */}
              {!isWorkspace ? (
                <div className="border border-line rounded-md">
                  <button
                    type="button"
                    aria-expanded={advancedOpen}
                    onClick={() => setAdvancedOpen((open) => !open)}
                    className="ui-plain w-full cursor-pointer flex items-center gap-1.5 py-2 px-2.5 font-[inherit]"
                  >
                    <b className="text-[12px]">生成参数</b>
                    <span className="text-[10.5px] text-ink-low">
                      通常无需调整
                    </span>
                  </button>
                  {advancedOpen ? (
                    <div className="grid gap-2.5 px-2.5 pb-2.5">
                      <div className="grid gap-1">
                        <p className="eyebrow m-0">范围</p>
                        <div className="flex gap-1">
                          <Button
                            size="compact"
                            variant={
                              state.scope === "scene" ? "primary" : "ghost"
                            }
                            onClick={() => assistant.setScope("scene", null)}
                          >
                            当前场景
                          </Button>
                          <Button
                            size="compact"
                            variant={chapterDirectory ? "primary" : "ghost"}
                            onClick={() => assistant.setScope("chapter", null)}
                          >
                            整章
                          </Button>
                        </div>
                      </div>
                      {characters.length > 0 ? (
                        <div className="grid gap-1">
                          <label
                            htmlFor="assistant-viewpoint"
                            className="text-[11.5px] text-ink-mid"
                          >
                            视点角色
                          </label>
                          <select
                            id="assistant-viewpoint"
                            value={state.viewpointCharacterId ?? ""}
                            onChange={(event) =>
                              assistant.setViewpoint(event.target.value || null)
                            }
                            className="bg-shell border border-line rounded-sm text-ink-hi text-[12px] py-1 px-2"
                          >
                            <option value="">不指定</option>
                            {characters.map((character) => (
                              <option key={character.id} value={character.id}>
                                {character.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                      <div className="grid gap-1">
                        <p className="eyebrow m-0">文风基调</p>
                        <div className="flex gap-1 flex-wrap">
                          {STYLE_PRESETS.map((preset) => (
                            <Button
                              key={preset.key}
                              size="compact"
                              variant={
                                toneKey === preset.key ? "primary" : "ghost"
                              }
                              onClick={() => {
                                setToneKey(preset.key);
                                assistant.setStyle(
                                  preset.suffix,
                                  densitySuffix(density),
                                );
                              }}
                            >
                              {preset.label}
                            </Button>
                          ))}
                        </div>
                        <label
                          htmlFor="assistant-density"
                          className="text-[11.5px] text-ink-mid"
                        >
                          爽点密度
                          <span className="num ml-1.5 text-accent-text">
                            {density >= 80 ? "高" : density <= 20 ? "低" : "中"}
                          </span>
                        </label>
                        <input
                          id="assistant-density"
                          type="range"
                          min={0}
                          max={100}
                          value={density}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            setDensity(next);
                            assistant.setStyle(
                              STYLE_PRESETS.find(
                                (preset) => preset.key === toneKey,
                              )?.suffix ?? "",
                              densitySuffix(next),
                            );
                          }}
                          className="accent-accent"
                        />
                      </div>
                      <p className="m-0 text-[10.5px] text-ink-low">
                        模型与 Key 在「项目与设置 › 模型接入」配置
                        {assistant.activeProvider
                          ? `；当前：${assistant.activeProvider.name}`
                          : "；尚未配置服务商"}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* 结果区（按意图） */}
              <AssistantResults />

              {/* 失败恢复：保留输入＋三条出路（含未配置服务商的预检失败） */}
              {state.error ? (
                <div className="border border-line rounded-md p-2.5 grid gap-2">
                  <InlineNote tone="danger">{state.error}</InlineNote>
                  <p className="m-0 text-[10.5px] text-ink-low">
                    输入已保留；可重试、更换模型或打开设置。
                  </p>
                  {switchingModel ? (
                    <fieldset className="border-0 p-0 m-0 grid gap-1">
                      <legend className="eyebrow p-0">更换模型</legend>
                      {assistant.byokProviders.length === 0 ? (
                        <p className="m-0 text-[10.5px] text-ink-low">
                          尚未配置任何服务商——先打开设置添加。
                        </p>
                      ) : (
                        assistant.byokProviders.map((provider) => (
                          <label
                            key={provider.id}
                            className="inline-flex items-center gap-1.5 text-[11.5px] cursor-pointer"
                          >
                            <input
                              type="radio"
                              name="assistant-provider"
                              checked={
                                assistant.activeProvider?.id === provider.id
                              }
                              onChange={() =>
                                assistant.switchProvider(provider.id)
                              }
                            />
                            {provider.name}
                            <span className="num text-[10px] text-ink-low">
                              {provider.modelId}
                            </span>
                          </label>
                        ))
                      )}
                    </fieldset>
                  ) : null}
                  <div className="flex gap-1 flex-wrap">
                    <Button
                      variant="primary"
                      size="compact"
                      onClick={() => void assistant.run()}
                    >
                      重试
                    </Button>
                    <Button
                      size="compact"
                      onClick={() => setSwitchingModel((value) => !value)}
                    >
                      更换模型
                    </Button>
                    <Button size="compact" onClick={onOpenSettings}>
                      打开设置
                    </Button>
                    <Button size="compact" onClick={assistant.dismiss}>
                      知道了
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* 底栏：状态行＋主操作 */}
            <div className="flex-none border-t border-line px-3.5 py-2.5 grid gap-2">
              {isWorkspace ? (
                <p className="m-0 text-[10.5px] leading-[1.6] text-ink-low">
                  {workspaceSubject
                    ? `当前主体：${workspaceSubject.label}`
                    : (action?.subjectHint ?? "")}
                </p>
              ) : currentSceneLabel ? (
                <p className="m-0 text-[10.5px] leading-[1.6] text-ink-low">
                  {currentSceneLabel}
                </p>
              ) : null}
              {showPhase ? (
                <p className="m-0 text-[11px] text-ink-mid">
                  {state.phase === "assembling"
                    ? "正在装配上下文……"
                    : "正在生成……"}
                </p>
              ) : (
                <p className="m-0 text-[11px] text-ink-low">
                  {state.error
                    ? "请先处理上方错误。"
                    : (assistant.state.notice ??
                      (isWorkspace
                        ? (action?.idleStatus ?? "")
                        : config.idleStatus))}
                </p>
              )}
              <div className="flex gap-1.5">
                <Button
                  variant="primary"
                  busy={assistant.busy}
                  disabled={
                    assistant.busy ||
                    (isWorkspace ? subjectMissing : needsScene)
                  }
                  onClick={() => void assistant.run()}
                >
                  {isWorkspace ? (action?.primary ?? "运行") : config.primary}
                </Button>
                {assistant.busy ? (
                  <Button onClick={assistant.cancel}>取消</Button>
                ) : null}
              </div>
            </div>

            {/* 唯一屏幕阅读器播报源：整句阶段状态，不逐条播 token 数字 */}
            <output aria-live="polite" className="sr-only">
              {phaseAnnouncement(state)}
            </output>
          </motion.aside>
          <ByokInlineCard />
        </>
      ) : null}
    </AnimatePresence>
  );
}
