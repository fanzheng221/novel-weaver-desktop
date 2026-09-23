import { formatAuthorValue } from "../../shared/ui/reference-label";
import type { NameOption } from "./name-picker";
import { useState } from "react";
import { ArtifactProposalForm } from "./outline/artifact-proposal-form";
import { X } from "lucide-react";
import { IconButton } from "../../shared/ui/icons";
import { ImpactSlot } from "../world/impact-slot";
import { ARTIFACT_KIND_LABEL } from "./outline/artifact-proposal-form";
import { Button } from "../../shared/ui/components";
import { FIELD_LABEL } from "./confirm-model";
import type { PlanningEdge, PlanningNode } from "./planning-model";

/**
 * 选中节点详情（WF5-10 用例 4）：按 kind 列人话字段；
 * UUID、故事序与 JSON 只出现在「原始数据」折叠详情。
 */

export function NodeDetails({
	cwd,
	node,
	graph,
	idNames,
	onClose,
	onUpdated,
	entityOptions,
	sceneOptions,
}: {
	cwd: string;
	node: PlanningNode;
	graph: { nodes: PlanningNode[]; edges: PlanningEdge[] } | null;
	idNames: Map<string, string>;
	onClose: () => void;
	onUpdated?: () => void;
	entityOptions?: NameOption[];
	sceneOptions?: NameOption[];
}) {
	const [editing, setEditing] = useState(false);
	const dependencies = graph
		? graph.edges
				.filter((edge) => edge.targetId === node.id)
				.map((edge) => {
					const source = graph.nodes.find((item) => item.id === edge.sourceId);
					return source ? source.title : "名称未找到（请核对引用）";
				})
		: [];
	const knownFields = Object.entries(node.content).filter(([key]) => key !== "storyOrder");
	const storyOrder = typeof node.content.storyOrder === "number" ? node.content.storyOrder : null;

	if (editing)
		return (
			<div role="group" aria-label="编辑规划" className="grid gap-2">
				<Button onClick={() => setEditing(false)}>取消编辑</Button>
				<ArtifactProposalForm
					cwd={cwd}
					initialNode={node}
					graph={graph}
					idNames={idNames}
					entityOptions={entityOptions}
					sceneOptions={sceneOptions}
					chapterOptions={(graph?.nodes ?? [])
						.filter((item) => item.kind === "chapter_plan")
						.map((item) => ({ id: item.id, name: item.title }))}
					dependencyOptions={(graph?.nodes ?? [])
						.filter((item) => item.id !== node.id)
						.map((item) => ({ id: item.id, name: item.title }))}
					onSucceeded={() => {
						setEditing(false);
						onUpdated?.();
					}}
				/>
			</div>
		);
	return (
		<div className="grid gap-2" data-testid="node-details">
			<Button onClick={() => setEditing(true)}>编辑这份规划</Button>
			<dl className="grid gap-1.5 m-0">
				{knownFields.map(([key, value]) => {
					const formatted = formatAuthorValue(value, idNames, key, FIELD_LABEL);
					if (!formatted) return null;
					// 场景的 purpose 叫「叙事目的」；章节里才是「本章目的」。
					const label =
						node.kind === "scene_plan" && key === "purpose"
							? "叙事目的"
							: (FIELD_LABEL[key] ?? key);
					return (
						<div key={key} className="grid gap-0.5">
							<dt className="eyebrow m-0">{label}</dt>
							<dd className="m-0 text-[12px] leading-[1.6] text-ink-mid">{formatted}</dd>
						</div>
					);
				})}
				{dependencies.length > 0 ? (
					<div className="grid gap-0.5">
						<dt className="eyebrow m-0">依赖的规划</dt>
						<dd className="m-0 text-[12px] leading-[1.6] text-ink-mid">
							{dependencies.join("、")}
						</dd>
					</div>
				) : null}
			</dl>
			<details>
				<summary className="cursor-pointer text-[10.5px] text-ink-low">
					高级 · 原始数据
					{storyOrder !== null ? `（故事序 ${storyOrder}）` : ""}
				</summary>
				<pre className="num mt-1 p-[8px_10px] text-[10px] leading-[1.6] whitespace-pre-wrap break-all max-h-45 overflow-y-auto bg-shell rounded-sm text-ink-mid">
					{JSON.stringify(node.content, null, 2)}
				</pre>
				<p className="m-0 text-[10px] text-ink-low">
					{ARTIFACT_KIND_LABEL[node.kind] ?? node.kind} · {node.id}
				</p>
			</details>
			<ImpactSlot
				cwd={cwd}
				subject={{ kind: "artifact", id: node.id, title: node.title }}
				embedded
			/>
			<div>
				<IconButton icon={X} label="关闭详情" onClick={onClose} />
			</div>
		</div>
	);
}
