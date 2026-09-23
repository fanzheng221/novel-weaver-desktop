import { Plus } from "lucide-react";
import { EntityIcon } from "../../shared/ui/icons";
import { useEffect, useMemo, useState } from "react";
import { queryProject } from "../../shared/api/rpc";
import { useAssistant } from "../writing/assistant/assistant-context";
import {
  Button,
  Chip,
  EmptyState,
  InlineNote,
  PAGE,
  Panel,
} from "../../shared/ui/components";
import { cx } from "../../shared/ui/cx";
import { readFocusTarget, rememberFocusInHash } from "../../shared/ui/deep-link";
import {
  describeRpcError,
  ErrorState,
  navigateTo,
  SkeletonLines,
  useDelayedFlag,
} from "../../shared/ui/states";
import { entityTypeLabel, relationshipTypeLabel } from "../../shared/ui/terms";
import { EntityForm, type EntityFormState } from "./entity-form";
import { DetailSlot, ImpactSlot } from "./impact-slot";
import {
  type EntitySub,
  type EntitySummary,
  entitiesWithTag,
  newEntityId,
  parseTags,
  readProfile,
  readTags,
  relationsOfCharacter,
  tagPoolOf,
  useWorldData,
} from "./lore-model";
import { PendingProposals } from "./pending-proposals";
import { WorldSearch } from "./world-search";

/**
 * 人物/设定共享的列表·详情·表单脚手架（WF5-11）：
 * 两个子区是同一套「左列表 · 右详情/表单」作者任务，只有字段与空态不同；
 * 差异用 kind 参数与文案注入表达，不做更大的布局抽象。
 * 创建/修订走提案流（待批准），影响与缺失投影用插槽如实占位。
 */

const AVATAR =
  "grid place-items-center bg-accent-soft text-accent font-wenkai flex-none";

export function formFromEntity(entity: EntitySummary): EntityFormState {
  const profile =
    entity.type === "character"
      ? readProfile(entity.attributes)
      : {
          personality: "",
          appearance: "",
          abilities: "",
          notes:
            typeof entity.attributes.notes === "string"
              ? (entity.attributes.notes as string)
              : "",
          tags: [],
        };
  return {
    id: entity.id,
    type: entity.type,
    canonicalName: entity.canonicalName,
    description: entity.description,
    personality: profile.personality,
    appearance: profile.appearance,
    abilities: profile.abilities,
    notes: profile.notes,
    tags: readTags(entity.attributes).join("，"),
  };
}

export function EntityWorkspace({
  cwd,
  kind,
  title,
  hint,
  empty,
}: {
  cwd: string;
  kind: EntitySub;
  title: string;
  hint: string;
  empty: { glyph: string; title: string; hint: string; actionLabel: string };
}) {
  const { data, phase, loadError, reload } = useWorldData(cwd);
  const showSkeleton = useDelayedFlag(phase === "loading");
  const [filterTag, setFilterTag] = useState<string | null>(null);
  // 深链聚焦（WF5-14）：`#/world/characters?focus=…` 直达选中条目；
  // 本视图内的选中同步回 hash（replaceState），前进/后退即恢复原选中。
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    readFocusTarget(),
  );
  const [form, setForm] = useState<EntityFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectEntity = (id: string | null) => {
    setSelectedId(id);
    setForm(null);
    rememberFocusInHash(
      kind === "characters" ? "world/characters" : "world/lore",
      id,
    );
  };

  const subEntities = useMemo(
    () =>
      (data?.overview.entities ?? []).filter(
        (entity) => (kind === "characters") === (entity.type === "character"),
      ),
    [data, kind],
  );
  const tagPool = useMemo(() => tagPoolOf(subEntities), [subEntities]);
  const visible = useMemo(
    () => entitiesWithTag(subEntities, filterTag),
    [subEntities, filterTag],
  );
  const existingIds = useMemo(
    () => new Set((data?.overview.entities ?? []).map((entity) => entity.id)),
    [data],
  );
  const selected = useMemo(
    () =>
      data?.overview.entities.find((entity) => entity.id === selectedId) ??
      null,
    [data, selectedId],
  );

  // 主体注册（WF5-17）：设定动作围绕选中实体展开；未选中时清空主体。
  const assistant = useAssistant();
  const entitySubject = useMemo(
    () =>
      selected
        ? {
            kind: "entity" as const,
            label: selected.canonicalName,
            detail: selected.description || undefined,
            entityIds: [selected.id],
            key: `entity:${selected.id}`,
          }
        : null,
    [selected],
  );
  useEffect(() => {
    assistant.registerAssistantSubject(entitySubject);
  }, [assistant, entitySubject]);

  const startNew = () => {
    const prefix = kind === "characters" ? "CHAR" : "ENT";
    selectEntity(null);
    setFilterTag(null);
    setFormError(null);
    setForm({
      id: newEntityId(prefix, existingIds),
      type: kind === "characters" ? "character" : "location",
      canonicalName: "",
      description: "",
      personality: "",
      appearance: "",
      abilities: "",
      notes: "",
      tags: "",
    });
  };

  const submitForm = async () => {
    if (!form) return;
    if (!form.canonicalName.trim()) {
      setFormError(
        kind === "characters" ? "先给人物起个名字。" : "先给条目起个名字。",
      );
      return;
    }
    setSubmitting(true);
    const attributes: Record<string, unknown> = {};
    if (kind === "characters") {
      if (form.personality.trim())
        attributes.personality = form.personality.trim();
      if (form.appearance.trim())
        attributes.appearance = form.appearance.trim();
      if (form.abilities.trim()) attributes.abilities = form.abilities.trim();
    }
    if (form.notes.trim()) attributes.notes = form.notes.trim();
    const tags = parseTags(form.tags);
    if (tags.length > 0) attributes.tags = tags;
    try {
      await queryProject(cwd, "create_design_proposal", {
        entities: [
          {
            id: form.id.trim(),
            type:
              form.type.trim() ||
              (kind === "characters" ? "character" : "location"),
            canonicalName: form.canonicalName.trim(),
            description: form.description.trim(),
            attributes,
          },
        ],
      });
      setNote(
        existingIds.has(form.id.trim())
          ? `修订提案已创建（${form.canonicalName.trim()}），批准后覆盖原条目。`
          : "提案已创建，在待审列表批准后生效。",
      );
      setForm(null);
      setFormError(null);
      selectEntity(form.id.trim());
      await reload();
    } catch (raw) {
      setFormError(describeRpcError(raw).message);
    } finally {
      setSubmitting(false);
    }
  };

  const approve = async (proposalId: string, revision: number) => {
    setPendingError(null);
    try {
      await queryProject(cwd, "approve_proposal", {
        proposalId,
        expectedRevision: revision,
      });
      await reload();
    } catch (raw) {
      setPendingError(describeRpcError(raw).message);
    }
  };

  const profile = selected ? readProfile(selected.attributes) : null;
  const detailRows: Array<[string, string]> = profile
    ? (
        [
          ["性格", profile.personality],
          ["外貌", profile.appearance],
          ["能力", profile.abilities],
          ["备注", profile.notes],
        ] as Array<[string, string]>
      ).filter(([, value]) => value)
    : [];
  const characterRelations =
    kind === "characters" && selected
      ? relationsOfCharacter(data?.graph ?? null, selected.id)
      : [];

  return (
    <main className={PAGE}>
      <header>
        <p className="eyebrow">
          NOVEL WEAVER / WORLD ·{" "}
          {kind === "characters" ? "CHARACTERS" : "SETTINGS"}
        </p>
        <h1 className="font-wenkai text-[22px] mt-0.5 mb-0 mx-0">{title}</h1>
        <p className="text-[11.5px] text-ink-low mt-0.5 mb-0">{hint}</p>
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
        <div className="grid grid-cols-[300px_1fr] gap-3">
          <SkeletonLines lines={6} />
          <SkeletonLines lines={5} />
        </div>
      ) : null}

      {phase === "ready" && data ? (
        <>
          <WorldSearch overview={data.overview} graph={data.graph} />

          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[12px] text-ink-mid num">
              共 {visible.length} 条
            </span>
            <span className="ml-auto inline-flex gap-1 flex-wrap">
              {tagPool.map((tag) => (
                <Chip key={tag} tone={filterTag === tag ? "accent" : "default"}>
                  <button
                    type="button"
                    onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                    className="ui-plain inline-flex min-h-7 items-center cursor-pointer"
                  >
                    #{tag}
                  </button>
                </Chip>
              ))}
            </span>
          </div>

          <div className="grid grid-cols-[300px_1fr] gap-3 items-start">
            <Panel
              title={`条目 · ${visible.length}${filterTag ? ` · #${filterTag}` : ""}`}
            >
              {visible.length === 0 ? (
                subEntities.length > 0 ? (
                  <p className="text-[12px] text-ink-mid">
                    没有带 #{filterTag} 标签的条目。
                  </p>
                ) : (
                  <EmptyState
                    as="h2"
                    glyph={empty.glyph}
                    title={empty.title}
                    hint={empty.hint}
                    actions={
                      <Button variant="primary" onClick={startNew}>
                        <Plus size={14} strokeWidth={1.8} aria-hidden="true" /> {empty.actionLabel}
                      </Button>
                    }
                  />
                )
              ) : (
                <div className="grid gap-1">
                  <Button onClick={startNew}><Plus size={14} strokeWidth={1.8} aria-hidden="true" /> 新建</Button>
                  {visible.map((entity) => {
                    const active = entity.id === selectedId;
                    const tags = readTags(entity.attributes);
                    return (
                      <button
                        key={entity.id}
                        type="button"
                        onClick={() => selectEntity(entity.id)}
                        className={cx(
                          "flex gap-2 items-center text-left w-full border-0 border-t border-line px-1 py-2 rounded-md cursor-pointer text-inherit font-[inherit]",
                          active ? "bg-accent-soft" : "bg-transparent",
                        )}
                      >
                        <span
                          className={cx(
                            AVATAR,
                            "w-11 h-11 rounded-md",
                            kind === "characters"
                              ? "text-[21px]"
                              : "text-[17px]",
                          )}
                        >
                          <EntityIcon type={entity.type} />
                        </span>
                        <span className="min-w-0">
                          <b className="block text-[13px] whitespace-nowrap overflow-hidden text-ellipsis">
                            {entity.canonicalName}
                          </b>
                          <span className="num text-[10px] text-ink-low">
                            {kind === "lore"
                              ? `${entityTypeLabel(entity.type)} · `
                              : ""}
                            {tags.map((tag) => `#${tag}`).join(" ")}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Panel>

            <div className="grid gap-3">
              {form ? (
                <EntityForm
                  kind={kind}
                  form={form}
                  onChange={setForm}
                  onCancel={() => setForm(null)}
                  onSubmit={() => void submitForm()}
                  submitting={submitting}
                  error={formError}
                  isRevision={existingIds.has(form.id.trim())}
                />
              ) : selected ? (
                <Panel
                  title={selected.canonicalName}
                  action={
                    <Button onClick={() => setForm(formFromEntity(selected))}>
                      修订此条目
                    </Button>
                  }
                >
                  <div className="grid gap-3">
                    <div className="flex gap-3 items-start">
                      <span
                        className={cx(
                          AVATAR,
                          "w-14 h-14 rounded-md text-[26px]",
                        )}
                      >
                        <EntityIcon type={selected.type} size={28} />
                      </span>
                      <div className="grid gap-1">
                        <b className="font-wenkai text-[17px]">
                          {selected.canonicalName}
                        </b>
                        <span className="num text-[10.5px] text-ink-low">
                          {kind === "lore"
                            ? entityTypeLabel(selected.type)
                            : "人物"}
                          {readTags(selected.attributes).length > 0
                            ? ` · ${readTags(selected.attributes)
                                .map((tag) => `#${tag}`)
                                .join(" ")}`
                            : ""}
                        </span>
                      </div>
                    </div>
                    {selected.description ? (
                      <p className="m-0 text-[12.5px] leading-[1.8] text-ink-mid">
                        {selected.description}
                      </p>
                    ) : null}
                    {detailRows.length > 0 ? (
                      <div className="grid gap-2">
                        {detailRows.map(([label, value]) => (
                          <div
                            key={label}
                            className="grid grid-cols-[52px_1fr] gap-2"
                          >
                            <span className="pt-0.5 text-[10.5px] tracking-[0.16em] text-ink-low font-semibold">
                              {label}
                            </span>
                            <span className="text-[12.5px] leading-[1.7] text-ink-mid">
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {kind === "lore" ? (
                      <DetailSlot
                        label="出现位置"
                        hint="这条设定在哪些章节被用到还没有接入投影；接通后在这里列出，并直达对应场景。"
                      />
                    ) : null}
                    {kind === "characters" ? (
                      <>
                        <DetailSlot
                          label="弧光"
                          hint="人物跨章节的变化轨迹还没有接入投影；接通后在这里按章节列出他的关键转变。"
                        />
                        <DetailSlot
                          label="认知边界"
                          hint="他知道什么、误以为什么、不该知道什么——认知清单还没有接入投影；接通后在这里按故事时间列出。"
                        />
                        <DetailSlot
                          label="参与场景"
                          hint="他出场的章节与场景还没有接入投影；接通后在这里直达对应场景。"
                        />
                        <div className="grid gap-1 border-t border-line pt-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10.5px] tracking-[0.16em] text-ink-low font-semibold">
                              客观关系 · {characterRelations.length}
                            </span>
                            <Button
                              size="compact"
                              onClick={() => navigateTo("world/relations")}
                            >
                              去关系里查看
                            </Button>
                          </div>
                          {characterRelations.length === 0 ? (
                            <p className="m-0 text-[12px] leading-[1.8] text-ink-low">
                              还没有批准涉及{selected.canonicalName}的客观关系；
                              关系提案批准后会在这里列出。
                            </p>
                          ) : (
                            <div className="grid gap-1">
                              {characterRelations.map((edge) => {
                                const label = (id: string) =>
                                  data.graph?.nodes.find(
                                    (node) => node.id === id,
                                  )?.label ?? id;
                                return (
                                  <div
                                    key={`${edge.sourceId}-${edge.targetId}-${edge.relationshipType}`}
                                    className="text-[12px] text-ink-mid"
                                  >
                                    <b className="text-ink-hi">
                                      {label(edge.sourceId)}
                                    </b>{" "}
                                    —{" "}
                                    {relationshipTypeLabel(
                                      edge.relationshipType,
                                    )}{" "}
                                    →{" "}
                                    <b className="text-ink-hi">
                                      {label(edge.targetId)}
                                    </b>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                </Panel>
              ) : (
                <Panel title="详情">
                  <div className="grid place-items-center py-8 px-4 text-center">
                    <p className="m-0 text-[12px] text-ink-low leading-[1.9]">
                      从左侧选一条{kind === "characters" ? "人物" : "设定"}
                      查看详情；
                      <br />
                      或新建一条——表单只问名字和几笔描述，编号我们替你生成。
                    </p>
                  </div>
                </Panel>
              )}

              {selected ? (
                <ImpactSlot
                  cwd={cwd}
                  subject={{
                    kind: "entity",
                    id: selected.id,
                    title: selected.canonicalName,
                  }}
                />
              ) : null}

              <PendingProposals
                pending={data.pending}
                error={pendingError}
                onApprove={(proposal) =>
                  void approve(proposal.proposalId, proposal.revision)
                }
              />
            </div>
          </div>
        </>
      ) : null}
    </main>
  );
}
