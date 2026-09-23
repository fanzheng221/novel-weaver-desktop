import { Plus } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { queryProject } from "../../shared/api/rpc";
import { useAssistant } from "../writing/assistant/assistant-context";
import { Button, EmptyState, InlineNote, PAGE, Panel } from "../../shared/ui/components";
import { EMPTY, HINTS } from "../../shared/ui/copy";
import { cx } from "../../shared/ui/cx";
import { readFocusTarget, rememberFocusInHash } from "../../shared/ui/deep-link";
import {
  describeRpcError,
  ErrorState,
  SkeletonLines,
  useDelayedFlag,
} from "../../shared/ui/states";
import { DetailSlot, ImpactSlot } from "./impact-slot";
import {
  type DesignOverview,
  type RuleSummary,
  useWorldData,
  type WorldData,
} from "./lore-model";
import { PendingProposals } from "./pending-proposals";
import { WorldSearch } from "./world-search";

/**
 * 规则子区（WF5-11 用例 2）：硬规则、软规则、动态状态分栏展示并各自计数；
 * 支持新建与修订（提案→就地批准的连续确认流）与逐条查看影响。
 * 硬规则用「硬」徽标＋accent 边强调，绝不与普通描述混淆。
 */

const HARD_BADGE =
  "flex-none grid place-items-center bg-accent text-accent-contrast rounded-sm w-5 h-5 text-[11px] font-wenkai";
const SOFT_BADGE =
  "flex-none grid place-items-center bg-shell border border-line text-ink-mid rounded-sm w-5 h-5 text-[11px] font-wenkai";

interface RuleFormState {
  id: string;
  kind: "hard" | "soft";
  name: string;
  description: string;
  examples: string;
}

function emptyRuleForm(
  kind: "hard" | "soft",
  overview: DesignOverview,
): RuleFormState {
  const taken = new Set(
    [...overview.hardRules, ...overview.softRules].map((rule) => rule.id),
  );
  let id = "";
  do {
    id = `RULE-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  } while (taken.has(id));
  return { id, kind, name: "", description: "", examples: "" };
}

function ruleFormFrom(rule: RuleSummary, kind: "hard" | "soft"): RuleFormState {
  return {
    id: rule.id,
    kind,
    name: rule.name,
    description: rule.description,
    examples: rule.examples.join("\n"),
  };
}

function RuleCard({
  cwd,
  rule,
  kind,
  embeddedImpact,
  focused,
  onRevise,
  onFocus,
}: {
  cwd: string;
  rule: RuleSummary;
  kind: "hard" | "soft";
  embeddedImpact: boolean;
  focused: boolean;
  onRevise: (rule: RuleSummary) => void;
  /** 展开/收起「查看影响」＝聚焦/取消聚焦该规则（同步进 hash，前进后退可复原）。 */
  onFocus: (ruleId: string | null) => void;
}) {
  const hard = kind === "hard";
  // 影响投影按需查询（WF5-14）：<details> 折叠时不挂载组件不发起查询；
  // 首次展开后保持挂载，避免反复开关重复拉取。深链聚焦挂载（含后退
  // 恢复）时同步展开，?focus= 回到的卡立即重查影响面。
  const [impactOpened, setImpactOpened] = useState(focused);
  return (
    <div
      data-rule-id={rule.id}
      className={cx(
        "rounded-md px-2.5 py-2 grid gap-1",
        hard
          ? "border-l-[3px] border-accent bg-accent-soft"
          : "border border-line bg-shell",
        focused && "ring-2 ring-accent",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={hard ? HARD_BADGE : SOFT_BADGE} aria-hidden>
          {hard ? "硬" : "软"}
        </span>
        <b
          className={cx(
            "text-[13px]",
            hard ? "text-accent-text" : "text-ink-hi",
          )}
        >
          {rule.name}
        </b>
        <details className="ml-auto text-[10px] text-ink-low"><summary className="cursor-pointer">规则编号</summary><span className="break-all">{rule.id}</span></details>
        <Button size="compact" onClick={() => onRevise(rule)}>
          修订
        </Button>
      </div>
      <p className="m-0 text-[12.5px] leading-[1.7] text-ink-mid">
        {rule.description}
      </p>
      {rule.examples.length > 0 ? (
        <ul className="m-0 pl-4.5 text-[11.5px] leading-[1.7] text-ink-low">
          {rule.examples.map((example, index) => (
            <li key={index}>{example}</li>
          ))}
        </ul>
      ) : null}
      {embeddedImpact ? (
        <details className="mt-0.5" open={focused}>
          <summary
            // biome-ignore lint/a11y/noStaticElementInteractions: summary 本身就是可交互语义元素，这里拦截默认翻转做完全受控
            className="cursor-pointer text-[11px] text-ink-low"
            onClick={(event) => {
              // 完全受控：拦截 summary 的默认翻转，展开/收起只由
              // focused 驱动。受控 details 的 toggle 对程序性 open
              // 变化也会触发，互斥聚焦时会把刚展开的卡弹回收起。
              event.preventDefault();
              if (!focused) setImpactOpened(true);
              onFocus(focused ? null : rule.id);
            }}
          >
            查看影响
          </summary>
          {impactOpened ? (
            <div className="mt-1.5">
              <ImpactSlot
                cwd={cwd}
                subject={{ kind: "rule", id: rule.id, title: rule.name }}
                embedded
              />
            </div>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

export function RulesWorkspace({ cwd }: { cwd: string }) {
  const { data, phase, loadError, reload } = useWorldData(cwd);
  const showSkeleton = useDelayedFlag(phase === "loading");
  const [form, setForm] = useState<RuleFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 深链聚焦（WF5-14）：`#/world/rules?focus=RULE-xxxx` 直达并展开该规则卡；
  // 展开/收起同步回 hash（replaceState），前进/后退即恢复原聚焦与影响展开。
  const [focusedRuleId, setFocusedRuleId] = useState<string | null>(() =>
    readFocusTarget(),
  );
  const focusRule = (ruleId: string | null) => {
    setFocusedRuleId(ruleId);
    rememberFocusInHash("world/rules", ruleId);
  };

  useEffect(() => {
    if (!focusedRuleId || phase !== "ready") return;
    const card = document.querySelector(
      `[data-rule-id="${CSS.escape(focusedRuleId)}"]`,
    );
    card?.scrollIntoView({ block: "center" });
  }, [focusedRuleId, phase]);

  const overview = data?.overview ?? null;

  // 主体注册（WF5-17）：规则动作围绕聚焦规则展开；未聚焦时清空主体。
  const assistant = useAssistant();
  const ruleSubject = useMemo(() => {
    if (!overview || !focusedRuleId) return null;
    const rule =
      overview.hardRules.find((item) => item.id === focusedRuleId) ??
      overview.softRules.find((item) => item.id === focusedRuleId);
    if (!rule) return null;
    return {
      kind: "rule" as const,
      label: rule.name,
      detail: rule.description || undefined,
      key: `rule:${rule.id}`,
    };
  }, [overview, focusedRuleId]);
  useEffect(() => {
    assistant.registerAssistantSubject(ruleSubject);
  }, [assistant, ruleSubject]);

  const startRevise = (rule: RuleSummary) => {
    if (!overview) return;
    const kind = overview.hardRules.some((item) => item.id === rule.id)
      ? "hard"
      : "soft";
    setFormError(null);
    setForm(ruleFormFrom(rule, kind));
  };

  const submitForm = async () => {
    if (!form || !overview) return;
    if (!form.name.trim()) {
      setFormError("先给规则起个名字，比如「人死不能复生」。");
      return;
    }
    if (!form.description.trim()) {
      setFormError("用一句话说清这条规则约束什么。");
      return;
    }
    setSubmitting(true);
    const payload = {
      id: form.id,
      name: form.name.trim(),
      description: form.description.trim(),
      examples: form.examples
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    };
    try {
      await queryProject(
        cwd,
        "create_design_proposal",
        form.kind === "hard"
          ? { hardRules: [payload] }
          : { softRules: [payload] },
      );
      const revised = [...overview.hardRules, ...overview.softRules].some(
        (rule) => rule.id === form.id,
      );
      setNote(
        revised
          ? `修订提案已创建（${form.name}），批准后覆盖原规则。`
          : "规则提案已创建，在下方待审列表批准后生效。",
      );
      setForm(null);
      setFormError(null);
      await reload();
    } catch (raw) {
      setFormError(describeRpcError(raw).message);
    } finally {
      setSubmitting(false);
    }
  };

  const approve = async (proposal: WorldData["pending"][number]) => {
    if (!data) return;
    setPendingError(null);
    try {
      await queryProject(cwd, "approve_proposal", {
        proposalId: proposal.proposalId,
        expectedRevision: proposal.revision,
      });
      await reload();
    } catch (raw) {
      setPendingError(describeRpcError(raw).message);
    }
  };

  const nameId = useId();

  return (
    <main className={PAGE}>
      <header>
        <p className="eyebrow">NOVEL WEAVER / WORLD · RULES</p>
        <h1 className="font-wenkai text-[22px] mt-0.5 mb-0 mx-0">规则</h1>
        <p className="text-[11.5px] text-ink-low mt-0.5 mb-0">
          硬规则是这个世界推不翻的底线；软规则是可有意打破的倾向。生成与审校都按这里的规则执行。
        </p>
      </header>

      {note ? <InlineNote tone="success">{note}</InlineNote> : null}

      {phase === "failed" && loadError ? (
        <ErrorState
          message={loadError.message}
          detail={loadError.detail}
          onRetry={() => void reload()}
        />
      ) : null}
      {phase === "loading" && showSkeleton ? (
        <div className="grid grid-cols-[1fr_1.6fr] gap-3">
          <SkeletonLines lines={6} />
          <SkeletonLines lines={5} />
        </div>
      ) : null}

      {phase === "ready" && data && overview ? (
        <>
          <WorldSearch overview={overview} graph={data.graph} />

          <div className="grid grid-cols-[1fr_280px] gap-3 items-start">
            <div className="grid gap-3">
              <Panel
                title={`硬规则 · ${overview.hardRules.length}`}
                action={
                  <Button
                    variant="primary"
                    size="compact"
                    onClick={() => {
                      setFormError(null);
                      setForm(emptyRuleForm("hard", overview));
                    }}
                  >
                    <Plus size={14} strokeWidth={1.8} aria-hidden="true" /> 新建硬规则
                  </Button>
                }
              >
                {overview.hardRules.length === 0 ? (
                  <EmptyState
                    as="h2"
                    glyph={EMPTY.loreRules.glyph}
                    title={EMPTY.loreRules.title}
                    hint={EMPTY.loreRules.hint}
                    actions={
                      <Button
                        variant="primary"
                        onClick={() => {
                          setFormError(null);
                          setForm(emptyRuleForm("hard", overview));
                        }}
                      >
                        <Plus size={14} strokeWidth={1.8} aria-hidden="true" /> {EMPTY.loreRules.actionLabel}
                      </Button>
                    }
                  />
                ) : (
                  <div className="grid gap-2">
                    {overview.hardRules.map((rule) => (
                      <RuleCard
                        key={rule.id}
                        cwd={cwd}
                        rule={rule}
                        kind="hard"
                        embeddedImpact
                        focused={rule.id === focusedRuleId}
                        onRevise={startRevise}
                        onFocus={focusRule}
                      />
                    ))}
                  </div>
                )}
              </Panel>

              <Panel
                title={`软规则 · ${overview.softRules.length}`}
                action={
                  <Button
                    size="compact"
                    onClick={() => {
                      setFormError(null);
                      setForm(emptyRuleForm("soft", overview));
                    }}
                  >
                    <Plus size={14} strokeWidth={1.8} aria-hidden="true" /> 新建软规则
                  </Button>
                }
              >
                {overview.softRules.length === 0 ? (
                  <p className="text-[12px] text-ink-mid m-0">
                    软规则是可被有意打破的创作倾向，可选。
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {overview.softRules.map((rule) => (
                      <RuleCard
                        key={rule.id}
                        cwd={cwd}
                        rule={rule}
                        kind="soft"
                        embeddedImpact
                        focused={rule.id === focusedRuleId}
                        onRevise={startRevise}
                        onFocus={focusRule}
                      />
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="动态状态">
                <DetailSlot
                  label="随故事推进变化的世界状态"
                  hint="这类「某事已发生 / 某物已易主」的动态状态还没有接入投影；接通后在这里按故事时间列出，并标注改变它的场景。"
                />
              </Panel>
            </div>

            <div className="grid gap-3">
              {form ? (
                <Panel
                  title={
                    [...overview.hardRules, ...overview.softRules].some(
                      (rule) => rule.id === form.id,
                    )
                      ? `修订 · ${form.name || form.id}`
                      : "新建规则"
                  }
                  action={<Button onClick={() => setForm(null)}>取消</Button>}
                >
                  <div className="grid gap-2">
                    <div className="grid grid-cols-[1fr_1fr] gap-2">
                      <label
                        htmlFor={`${nameId}-kind`}
                        className="grid gap-1 text-[10.5px] tracking-[0.16em] text-ink-low font-semibold"
                      >
                        规则强度
                        <select
                          id={`${nameId}-kind`}
                          value={form.kind}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              kind: event.target.value as "hard" | "soft",
                            })
                          }
                          className="h-9 rounded-sm border border-line bg-shell text-ink-hi text-[12.5px] px-2 font-[inherit]"
                        >
                          <option value="hard">硬规则 · 底线</option>
                          <option value="soft">软规则 · 倾向</option>
                        </select>
                      </label>
                      <label
                        htmlFor={`${nameId}-name`}
                        className="grid gap-1 text-[10.5px] tracking-[0.16em] text-ink-low font-semibold"
                      >
                        名称
                        <input
                          id={`${nameId}-name`}
                          value={form.name}
                          onChange={(event) =>
                            setForm({ ...form, name: event.target.value })
                          }
                          placeholder="人死不能复生"
                          className="h-9 rounded-sm border border-line bg-shell text-ink-hi text-[12.5px] px-2 font-[inherit]"
                        />
                      </label>
                    </div>
                    <label
                      htmlFor={`${nameId}-desc`}
                      className="grid gap-1 text-[10.5px] tracking-[0.16em] text-ink-low font-semibold"
                    >
                      这条规则约束什么
                      <textarea
                        id={`${nameId}-desc`}
                        value={form.description}
                        onChange={(event) =>
                          setForm({ ...form, description: event.target.value })
                        }
                        placeholder="本世界没有复活手段，死亡即终局。"
                        className="min-h-13 rounded-sm border border-line bg-shell text-ink-hi text-[12.5px] px-2 py-2 resize-y leading-[1.7] font-[inherit]"
                      />
                    </label>
                    <label
                      htmlFor={`${nameId}-examples`}
                      className="grid gap-1 text-[10.5px] tracking-[0.16em] text-ink-low font-semibold"
                    >
                      例子（每行一条，可空）
                      <textarea
                        id={`${nameId}-examples`}
                        value={form.examples}
                        onChange={(event) =>
                          setForm({ ...form, examples: event.target.value })
                        }
                        placeholder={"主角不能死而复生\n魂体分离不可逆"}
                        className="min-h-12 rounded-sm border border-line bg-shell text-ink-hi text-[12.5px] px-2 py-2 resize-y leading-[1.7] font-[inherit]"
                      />
                    </label>
                    {formError ? (
                      <InlineNote tone="danger">{formError}</InlineNote>
                    ) : null}
                    <div className="flex gap-2 items-center">
                      <Button
                        variant="primary"
                        disabled={submitting}
                        onClick={() => void submitForm()}
                      >
                        {submitting ? "提交中…" : "提交提案（待批准）"}
                      </Button>
                      <span className="text-[10.5px] text-ink-low">
                        {HINTS.loreEditNote}
                      </span>
                    </div>
                  </div>
                </Panel>
              ) : null}

              <PendingProposals
                pending={data.pending}
                error={pendingError}
                onApprove={(proposal) => void approve(proposal)}
              />
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
