import { useCallback, useRef, useState } from "react";
import { type NameOption, NamePicker } from "../name-picker";
import { ProposalConfirm } from "../proposal-confirm";
import type { PlanningEdge, PlanningNode } from "../planning-model";
import { queryProject } from "../../../shared/api/rpc";
import { Button, InlineNote, TextField } from "../../../shared/ui/components";
import { describeRpcError, type ErrorParts } from "../../../shared/ui/states";

export type FieldType = "text" | "lines" | "int";

export interface ProposalField {
	name: string;
	label: string;
	type: FieldType;
	/** 内部定位/排序字段不会阻断首次创作路径。 */
	advanced?: boolean;
}

/** 工件提案类型词汇（WF5-02 自 OutlineBoard 切出；树渲染标签亦复用）。 */
export const ARTIFACT_KIND_LABEL: Record<string, string> = {
	outline: "大纲",
	volume_plan: "卷计划",
	chapter_plan: "章节计划",
	scene_plan: "场景计划",
	plotline: "情节线",
	story_promise: "故事承诺",
	character_arc: "人物弧光",
	style_guide: "文风配置",
	rolling_summary: "滚动摘要",
	policy_pack: "规则包",
	publication_schedule: "更新计划",
	reader_feedback: "读者反馈",
	revision_change_set: "修订变更集",
};

export const ARTIFACT_KIND_ORDER = Object.keys(ARTIFACT_KIND_LABEL);

const KIND_FIELDS: Record<string, ProposalField[]> = {
	outline: [
		{ name: "goal", label: "目标", type: "text" },
		{ name: "acts", label: "幕（每行一条）", type: "lines" },
	],
	volume_plan: [
		{ name: "goal", label: "目标", type: "text" },
		{
			name: "chapterIds",
			label: "章节 ID（每行一个）",
			type: "lines",
			advanced: true,
		},
	],
	chapter_plan: [
		{ name: "purpose", label: "本章目的（核心事件一句话）", type: "text" },
		{ name: "targetWords", label: "目标字数", type: "int" },
		{
			name: "characterIds",
			label: "涉及人物",
			type: "lines",
			advanced: true,
		},
		{
			name: "sceneIds",
			label: "场景 ID（每行一个）",
			type: "lines",
			advanced: true,
		},
		{
			name: "plotlineIds",
			label: "情节线 ID（每行一个）",
			type: "lines",
			advanced: true,
		},
		{ name: "storyOrder", label: "故事序", type: "int", advanced: true },
	],
	scene_plan: [
		{ name: "purpose", label: "叙事目的", type: "text" },
		{ name: "storyOrder", label: "故事序", type: "int", advanced: true },
	],
	plotline: [{ name: "goal", label: "目标", type: "text" }],
	story_promise: [
		{ name: "setup", label: "埋设", type: "text" },
		{ name: "payoff", label: "回收", type: "text" },
		{
			name: "setupChapterId",
			label: "埋点章节（可空）",
			type: "text",
			advanced: true,
		},
		{
			name: "payoffChapterId",
			label: "计划回收章节（可空）",
			type: "text",
			advanced: true,
		},
	],
	character_arc: [
		{ name: "characterId", label: "角色 ID", type: "text", advanced: true },
		{ name: "startState", label: "起始状态", type: "text" },
		{ name: "endState", label: "目标状态", type: "text" },
		{ name: "milestones", label: "里程碑（每行一条）", type: "lines" },
	],
	style_guide: [
		{ name: "tone", label: "语气", type: "text" },
		{ name: "bannedTerms", label: "禁用词（每行一个）", type: "lines" },
	],
	rolling_summary: [
		{ name: "continuityId", label: "连续体 ID", type: "text", advanced: true },
		{
			name: "throughStoryOrder",
			label: "覆盖至故事序",
			type: "int",
			advanced: true,
		},
		{ name: "text", label: "摘要正文", type: "text" },
	],
	policy_pack: [
		{ name: "platform", label: "平台", type: "text" },
		{ name: "rating", label: "内容分级", type: "text" },
		{ name: "bannedTerms", label: "敏感词（每行一个）", type: "lines" },
		{ name: "rules", label: "规则（每行一条）", type: "lines" },
	],
	publication_schedule: [],
	reader_feedback: [
		{ name: "source", label: "来源", type: "text" },
		{ name: "summary", label: "主题摘要", type: "text" },
		{ name: "implications", label: "启示（每行一条）", type: "lines" },
	],
	revision_change_set: [
		{ name: "targetId", label: "目标工件 ID", type: "text", advanced: true },
		{ name: "instruction", label: "修订指令", type: "text" },
		{ name: "changes", label: "变更清单（每行一条）", type: "lines" },
		{
			name: "downstreamArtifactIds",
			label: "下游工件 ID（每行一个）",
			type: "lines",
			advanced: true,
		},
	],
};

function toContent(
	kind: string,
	values: Record<string, string>,
	extraJson: string,
	base: Record<string, unknown> = {},
): Record<string, unknown> {
	const content: Record<string, unknown> = { ...base };
	for (const field of KIND_FIELDS[kind] ?? []) {
		const raw = (values[field.name] ?? "").trim();
		if (!raw) { delete content[field.name]; continue; }
		if (field.type === "lines")
			content[field.name] = raw
				.split(/\r?\n|,/)
				.map((part) => part.trim())
				.filter(Boolean);
		else if (field.type === "int") content[field.name] = Number(raw);
		else content[field.name] = raw;
	}
	if (extraJson.trim())
		Object.assign(content, JSON.parse(extraJson) as Record<string, unknown>);
	return content;
}

/**
 * 提交状态机（WF5-02）：任何时刻作者都知道「现在在哪、稿子还在不在」。
 * 前置条件不足是字段/页面级错误而非静默 return；可恢复失败保留全部输入。
 * WF5-10：提交成功后原位进入「预览影响→确认纳入」，不必跳到待审面板。
 */
type SubmitState =
	| "idle"
	| "submitting"
	| "confirming"
	| "succeeded"
	| "failed";

/**
 * 新建工件提案表单（WF5-02 深模块切分，源自 OutlineBoard）。
 * cwd 运行时缺失时整单禁用并解释去哪重新选择项目——绝不无反馈点击。
 */
export function ArtifactProposalForm({
	cwd,
	initialNode,
	outlineNodeId,
	graph,
	idNames,
	entityOptions,
	sceneOptions,
	dependencyOptions,
	chapterOptions,
	onSucceeded,
}: {
	/** 项目根目录；空串代表「当前没有已选项目」。 */
	cwd?: string;
	initialNode?: PlanningNode;
	/** 当前大纲节点 ID：场景计划缺省依赖，避免孤立节点。 */
	outlineNodeId?: string;
	/** WF5-10：传入后提交成功可原位预览影响并确认纳入。 */
	graph?: { nodes: PlanningNode[]; edges: PlanningEdge[] } | null;
	idNames?: Map<string, string>;
	/** 名称选择选项（人物 / 依赖 / 章节）；缺省退化为手填 ID 字段。 */
	entityOptions?: NameOption[];
	sceneOptions?: NameOption[];
	dependencyOptions?: NameOption[];
	chapterOptions?: NameOption[];
	onSucceeded?: (
		title: string,
		kindLabel: string,
		mode?: "approved" | "deferred",
	) => void;
}) {
	const projectReady = Boolean(cwd);
	const [state, setState] = useState<SubmitState>("idle");
	const [kind, setKind] = useState(initialNode?.kind ?? "outline");
	const [title, setTitle] = useState(initialNode?.title ?? "");
	const [dependencies, setDependencies] = useState(() => initialNode ? (graph?.edges ?? []).filter((edge) => edge.targetId === initialNode.id).map((edge) => edge.sourceId).join("\n") : "");
	const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initialNode?.content ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value.join("\n") : typeof value === "object" ? "" : String(value)])));
	const [extraJson, setExtraJson] = useState("");
	const [titleError, setTitleError] = useState("");
	const [goalError, setGoalError] = useState("");
	const [failure, setFailure] = useState<ErrorParts | null>(null);
	const [created, setCreated] = useState<{
		proposalId: string;
		revision: number;
		title: string;
		kindLabel: string;
	} | null>(null);
	const [successMessage, setSuccessMessage] = useState("");
	const titleFieldRef = useRef<HTMLInputElement | null>(null);

	const submit = useCallback(async () => {
		if (!projectReady || state === "submitting") return;
		const trimmedTitle = title.trim();
		if (!trimmedTitle) {
			setTitleError("请输入标题");
			titleFieldRef.current?.focus();
			return;
		}
		setTitleError("");
		if (kind === "outline" && !values.goal?.trim()) { setGoalError("请输入总纲的创作目标。"); return; }
		setGoalError("");
		setFailure(null);
		setState("submitting");
		try {
			let dependencyIds = dependencies
				.split(/\n|,/)
				.map((part) => part.trim())
				.filter(Boolean);
			// 场景计划默认挂在当前大纲之下，避免孤立节点。
			if (
				dependencyIds.length === 0 &&
				kind === "scene_plan" &&
				outlineNodeId
			) {
				dependencyIds = [outlineNodeId];
			}
			const result = await queryProject<{
				proposalId: string;
				revision: number;
			}>(cwd as string, "create_artifact_proposal", {
				kind,
				...(initialNode ? { artifactId: initialNode.id, sourceVersionId: initialNode.versionId } : {}),
				title: trimmedTitle,
				dependencyIds,
				content: toContent(kind, values, extraJson, initialNode?.content),
			});
			if (graph && idNames) {
				setCreated({
					proposalId: result.proposalId,
					revision: result.revision,
					title: trimmedTitle,
					kindLabel: ARTIFACT_KIND_LABEL[kind] ?? kind,
				});
				setState("confirming");
			} else {
				setSuccessMessage("提案已纳入待审列表。");
				setState("succeeded");
				onSucceeded?.(trimmedTitle, ARTIFACT_KIND_LABEL[kind] ?? kind);
			}
			setTitle("");
			setValues({});
			setExtraJson("");
			setDependencies("");
		} catch (raw) {
			setFailure(describeRpcError(raw));
			setState("failed");
		}
	}, [
		cwd,
		initialNode,
		dependencies,
		extraJson,
		graph,
		idNames,
		kind,
		onSucceeded,
		outlineNodeId,
		projectReady,
		state,
		title,
		values,
	]);

	if (!projectReady) {
		return (
			<div className="grid gap-2" aria-disabled>
				<p className="m-0 text-[12px] leading-[1.65] text-ink-mid">
					当前没有已选项目，无法创建提案。回到启动页重新选择一本书，或新建一本书后继续。
				</p>
				<Button disabled>创建提案（待批准）</Button>
			</div>
		);
	}

	if (state === "confirming" && created && cwd) {
		return (
			<ProposalConfirm
				cwd={cwd}
				proposalId={created.proposalId}
				revision={created.revision}
				graph={graph ?? null}
				idNames={idNames ?? new Map()}
				onApproved={() => {
					setSuccessMessage(
						`「${created.title}」已纳入规划。下一步：在左侧树里继续细化。`,
					);
					onSucceeded?.(created.title, created.kindLabel, "approved");
					setState("succeeded");
				}}
				onDeferred={() => {
					setSuccessMessage(
						`「${created.title}」提案已进入待审列表，可稍后在右侧批准。`,
					);
					onSucceeded?.(created.title, created.kindLabel, "deferred");
					setState("succeeded");
				}}
			/>
		);
	}

	const fields = KIND_FIELDS[kind] ?? [];

	const renderFieldValue = (field: ProposalField) => {
		// WF5-10 用例 4：多选字段给名称选择器；UUID 走其内置高级折叠。
		const referenceOptions: Record<string, NameOption[] | undefined> = {
			characterIds: entityOptions ?? [], characterId: entityOptions ?? [],
			chapterIds: chapterOptions ?? [], setupChapterId: chapterOptions ?? [], payoffChapterId: chapterOptions ?? [],
			sceneIds: sceneOptions ?? (graph?.nodes ?? []).filter((node) => node.kind === "scene_plan").map((node) => ({ id: node.id, name: node.title })),
			plotlineIds: (graph?.nodes ?? []).filter((node) => node.kind === "plotline").map((node) => ({ id: node.id, name: node.title })),
			targetId: dependencyOptions ?? [], downstreamArtifactIds: dependencyOptions ?? [],
		};
		const options = referenceOptions[field.name];
		if (options) {
			const label = field.label.replace(/ ID.*$/, "");
			const selectedIds = (values[field.name] ?? "").split(/\n|,/).map((part) => part.trim()).filter(Boolean);
			if (field.type === "lines") return <NamePicker label={label} options={options} selectedIds={selectedIds}
				onChange={(next) => setValues({ ...values, [field.name]: next.join("\n") })}
				emptyHint={field.name === "characterIds" ? "还没有已批准的人物；请先去世界区创建人物并批准提案。" : "还没有可关联的内容，可先留空，创建并批准后再回来选择。"} />;
			return <label className="grid gap-1"><span className="eyebrow">{label}</span>
				<select value={values[field.name] ?? ""} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
					className="bg-shell border border-line rounded-sm text-ink-hi text-[12.5px] px-2 py-1">
					<option value="">请选择{label}</option>
					{selectedIds.filter((id) => !options.some((option) => option.id === id)).map((id) => <option key={id} value={id}>名称未找到（请重新选择）</option>)}
					{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
				</select>
			</label>;
		}
		if (field.type === "lines") {
			// 「每行一条」字段必须用多行文本域：单行 input 会吞换行，
			// 多条目被静默合并成一条（WF5-18 终验场景一暴露）。
			return (
				<label className="grid gap-1">
					<span className="eyebrow">{field.label}</span>
					<textarea
						rows={3}
						value={values[field.name] ?? ""}
						onChange={(event) =>
							setValues({ ...values, [field.name]: event.target.value })
						}
						className="bg-shell border border-line rounded-sm text-ink-hi text-body px-2 py-1 outline-none resize-y font-[inherit]"
					/>
				</label>
			);
		}
		return (
			<TextField
				label={`${field.label}${field.type === "int" ? "（整数）" : ""}`}
				value={values[field.name] ?? ""}
				onChange={(next) => setValues({ ...values, [field.name]: next })}
			/>
		);
	};

	return (
		<div className="grid gap-3">
			{/* 成功后表单原位保留（字段已清空）：作者能连续创建第二个工件，
			    整单只剩提示会堵死「建总纲→继续建场景计划」的连续流（WF5-18 终验）。 */}
			{state === "succeeded" ? (
				<p
					role="status"
					className="m-0 text-[12px] leading-[1.65] text-accent-text"
				>
					{successMessage || "提案已纳入待审列表。"}
				</p>
			) : null}
			<p className="m-0 text-[12px] leading-[1.65] text-ink-mid">
				先确定提案的创作意图；关联已有工件或补充原始数据时，再打开高级设置。
			</p>
			<label className="grid gap-1">
				<span className="eyebrow">工件类型</span>
				<select
					disabled={Boolean(initialNode)}
					value={kind}
					onChange={(event) => setKind(event.target.value)}
					aria-describedby="proposal-kind-help"
					className="bg-shell border border-line rounded-sm text-ink-hi text-[12.5px] px-2 py-1"
				>
					{ARTIFACT_KIND_ORDER.map((item) => (
						<option key={item} value={item}>
							{ARTIFACT_KIND_LABEL[item]}
						</option>
					))}
				</select>
				<p
					id="proposal-kind-help"
					className="m-0 text-[11.5px] leading-[1.6] text-ink-low"
				>
					类型会决定需要填写的创作信息，之后仍可通过修订提案调整。
				</p>
			</label>
			<div className="grid gap-1">
				<TextField
					label="标题"
					value={title}
					onChange={(next) => {
						setTitle(next);
						if (titleError && next.trim()) setTitleError("");
					}}
					placeholder="例如：第一卷大纲"
					hint="用于在待审列表中识别这项规划。"
					fieldRef={titleFieldRef}
					invalid={Boolean(titleError)}
				/>
				{titleError ? (
					<InlineNote tone="danger">{titleError}</InlineNote>
				) : null}
			</div>
			{fields
				.filter((field) => !field.advanced)
				.map((field) => (
					<div key={field.name}>{renderFieldValue(field)}{field.name === "goal" && goalError ? <InlineNote>{goalError}</InlineNote> : null}</div>
				))}
			<details className="border border-line rounded-sm px-2 py-1">
				<summary className="cursor-pointer min-h-8 flex items-center text-[12px] text-ink-mid">
					高级设置 · 依赖、排序与 JSON
				</summary>
				<div className="grid gap-2 pt-2">
					<p className="m-0 text-[11.5px] leading-[1.6] text-ink-low">
						这些字段用于精确关联既有工件或录入尚未结构化的数据；一般创作提案可留空。
					</p>
					{dependencyOptions ? (
						<NamePicker
							label="依赖工件"
							options={dependencyOptions}
							selectedIds={dependencies
								.split(/\n|,/)
								.map((part) => part.trim())
								.filter(Boolean)}
							onChange={(next) => setDependencies(next.join("\n"))}
							emptyHint="还没有可关联的规划工件；可留空。"
						/>
					) : (
						<TextField
							label="依赖工件 ID（可空，逗号分隔）"
							value={dependencies}
							onChange={setDependencies}
							hint="填写后，提案会明确依赖这些已存在的工件。"
						/>
					)}
					{fields
						.filter((field) => field.advanced)
						.map((field) => (
							<div key={field.name}>{renderFieldValue(field)}{field.name === "goal" && goalError ? <InlineNote>{goalError}</InlineNote> : null}</div>
						))}
					<TextField
						label="扩展内容（JSON，可空）"
						value={extraJson}
						onChange={setExtraJson}
						placeholder='{"entries":[…]}'
						hint="仅在该类型没有专用字段时填写；内容会与上方字段合并。"
					/>
				</div>
			</details>
			<div className="flex gap-2">
				<Button
					variant="primary"
					busy={state === "submitting"}
					onClick={() => void submit()}
				>
					{initialNode ? "提交修订提案" : "创建提案（待批准）"}
				</Button>
			</div>
			{failure ? (
				<div role="alert" className="grid gap-2">
					<InlineNote tone="danger">
						提案没有创建成功：{failure.message}
					</InlineNote>
					<Button variant="primary" onClick={() => void submit()}>
						重试提交
					</Button>
					{failure.detail ? (
						<details>
							<summary className="cursor-pointer text-[10.5px] text-ink-low">
								技术详情
							</summary>
							<pre className="num mt-1 p-[8px_10px] text-[10px] leading-[1.6] whitespace-pre-wrap break-all max-h-35 overflow-y-auto bg-shell rounded-sm text-ink-mid">
								{failure.detail}
							</pre>
						</details>
					) : null}
				</div>
			) : null}
		</div>
	);
}
