import { Button } from "../../../shared/ui/components";
import { cx } from "../../../shared/ui/cx";
import { attitudeDimensionLabel, relationshipTypeLabel } from "../../../shared/ui/terms";
import {
	pairKey,
	type RelationAttitudeEdge,
	type RelationGraph,
	type RelationObjectiveEdge,
	type RelationSelection,
	sameSpanHistory,
	validityLabel,
} from "./relations-model";

/**
 * 关系列表（WF5-13，原型 C 裁决）：客观关系为主行，同对方向态度缩进为子行；
 * 选中行展开有效期、知情者、历史与证据场景。向读屏提供等价的完整行语义。
 */

export interface SceneRefShape {
	sceneId: string;
	title: string;
	storyOrder: number;
}

function intensityDots(intensity?: number): { on: number; off: number } | null {
	if (typeof intensity !== "number" || Number.isNaN(intensity)) return null;
	const on = Math.min(5, Math.max(0, Math.round(intensity * 5)));
	return { on, off: 5 - on };
}

const BADGE =
	"flex-none text-[10px] leading-[1.7] border rounded-full px-1.5 whitespace-nowrap";
const BADGE_ATT = cx(BADGE, "border-accent text-accent-text");
const BADGE_PRIV = cx(BADGE, "border-warning text-warning");
const BADGE_NEW = cx(BADGE, "border-success text-success");
const BADGE_GONE = cx(BADGE, "border-danger text-danger");

export function RelationsList({
	graph,
	visibleObjective,
	visibleAttitudes,
	storyOrder,
	selected,
	onSelect,
	sceneRefs,
	onJumpScene,
	onReviseEdge,
}: {
	graph: RelationGraph;
	visibleObjective: RelationObjectiveEdge[];
	visibleAttitudes: RelationAttitudeEdge[];
	storyOrder: number;
	selected: RelationSelection | null;
	onSelect: (next: RelationSelection | null) => void;
	/** versionId → 场景引用（由父级经 get_scene_ref 解析；null=解析失败）。 */
	sceneRefs: Record<string, SceneRefShape | null>;
	onJumpScene: (sceneRef: SceneRefShape) => void;
	onReviseEdge: (edge: RelationObjectiveEdge) => void;
}) {
	const labelOf = (id: string) =>
		graph.nodes.find((node) => node.id === id)?.label ?? id;

	const rowTouchedBySelection = (
		sourceId: string,
		targetId: string,
	): boolean => {
		if (!selected) return false;
		if (selected.kind === "node")
			return selected.id === sourceId || selected.id === targetId;
		if (selected.kind === "pair") {
			const [a, b] = selected.id.split("|");
			return (
				(sourceId === a && targetId === b) || (sourceId === b && targetId === a)
			);
		}
		return false;
	};

	const evidenceBlock = (versionId?: string) => {
		if (!versionId) {
			return (
				<p className="m-0 text-[11.5px] text-ink-low">
					尚无场景锚点；在写作台提到该关系的场景定稿后，这里可以跳回原文。
				</p>
			);
		}
		const sceneRef = sceneRefs[versionId];
		return (
			<div className="border-l-2 border-accent pl-2.5 py-0.5 flex items-center gap-2 flex-wrap">
				<span className="text-[11.5px] text-ink-mid">
					{sceneRef
						? `第 ${sceneRef.storyOrder + 1} 场《${sceneRef.title}》`
						: "证据场景（解析中…）"}
				</span>
				{sceneRef ? (
					<Button
						size="compact"
						variant="ghost"
						onClick={() => onJumpScene(sceneRef)}
					>
						跳到场景
					</Button>
				) : null}
			</div>
		);
	};

	const attitudeRow = (attitude: RelationAttitudeEdge) => {
		const attSelected = selected?.kind === "att" && selected.id === attitude.id;
		const dots = intensityDots(attitude.intensity);
		return (
			<div
				key={attitude.id}
				className={cx(
					"mx-3.5 mb-2 ml-7 bg-paper border-l-2 border-accent px-2.5 py-1.5 text-[12px] text-ink-mid grid gap-1",
					attSelected && "bg-accent-soft",
				)}
			>
				<button
					type="button"
					className="ui-plain cursor-pointer text-left text-[12px] font-[inherit] flex items-center gap-1.5 flex-wrap"
					aria-label={`${labelOf(attitude.sourceId)}对${labelOf(attitude.targetId)}的${attitudeDimensionLabel(attitude.dimension)}态度${dots ? `，强度 ${attitude.intensity}` : ""}`}
					aria-pressed={attSelected}
					onClick={() =>
						onSelect(attSelected ? null : { kind: "att", id: attitude.id })
					}
				>
					<span className={BADGE_ATT}>态度</span>
					<span className="text-ink-hi">
						{`${labelOf(attitude.sourceId)} → ${labelOf(attitude.targetId)}`}
					</span>
					<span>
						{attitudeDimensionLabel(attitude.dimension)}
						{dots ? (
							<span className="text-accent tracking-[1px] ml-1">
								{"●".repeat(dots.on)}
								<span className="text-line-strong">{"●".repeat(dots.off)}</span>
							</span>
						) : null}
					</span>
				</button>
				{attSelected ? (
					<div className="grid gap-1 text-[11.5px] pl-1">
						<p className="m-0">
							有效期：
							{validityLabel(attitude)}
						</p>
						{evidenceBlock(attitude.sourceSceneVersionId)}
					</div>
				) : null}
			</div>
		);
	};

	// 没有客观边的同对态度单独成组：人物对可以只有主观态度（WF5-13 验收），
	// 修订关闭客观边后态度也不能从列表里消失。
	const orphanAttitudeGroups = (() => {
		const paired = new Set(
			visibleObjective.map((edge) => pairKey(edge.sourceId, edge.targetId)),
		);
		const groups: RelationAttitudeEdge[][] = [];
		const byPair = new Map<string, RelationAttitudeEdge[]>();
		for (const attitude of visibleAttitudes) {
			const key = pairKey(attitude.sourceId, attitude.targetId);
			if (paired.has(key)) continue;
			const list = byPair.get(key);
			if (list) list.push(attitude);
			else byPair.set(key, [attitude]);
		}
		for (const group of byPair.values()) groups.push(group);
		return groups;
	})();

	if (visibleObjective.length === 0 && visibleAttitudes.length === 0) {
		return (
			<p className="p-6 text-[12px] text-ink-low text-center m-0">
				当前时间/范围/筛选下没有可见关系。
			</p>
		);
	}

	return (
		<div className="flex-1 min-h-0 overflow-y-auto" aria-label="关系列表">
			<div className="sticky top-0 z-10 bg-rail px-3.5 pt-2 pb-1 text-[11px] text-ink-low border-b border-line tracking-[0.05em]">
				{`客观关系 · ${visibleObjective.length}`}
			</div>
			<ul className="list-none m-0 p-0">
				{visibleObjective.map((edge) => {
					const isSelected =
						selected?.kind === "edge" && selected.id === edge.id;
					const touched =
						isSelected || rowTouchedBySelection(edge.sourceId, edge.targetId);
					const attitudesOfPair = visibleAttitudes.filter(
						(attitude) =>
							(attitude.sourceId === edge.sourceId &&
								attitude.targetId === edge.targetId) ||
							(attitude.sourceId === edge.targetId &&
								attitude.targetId === edge.sourceId),
					);
					const history = sameSpanHistory(graph.objectiveHistory, edge);
					return (
						<li
							key={edge.id}
							className={cx(
								"border-b border-line",
								isSelected &&
									"bg-rail-active shadow-[inset_3px_0_0_var(--accent)]",
							)}
						>
							<button
								type="button"
								className={cx(
									"ui-plain cursor-pointer w-full text-left flex items-center gap-2 py-1.5 px-3.5 text-[12.5px] font-[inherit] hover:bg-rail-active",
									touched && !isSelected && "bg-rail-active/60",
								)}
								aria-label={`${labelOf(edge.sourceId)} → ${labelOf(edge.targetId)}，${relationshipTypeLabel(edge.relationshipType)}${edge.visibility === "private" ? "，私密" : ""}，${validityLabel(edge)}`}
								aria-pressed={isSelected}
								onClick={() =>
									onSelect(isSelected ? null : { kind: "edge", id: edge.id })
								}
							>
								<span className="text-ink-hi truncate">
									{labelOf(edge.sourceId)}
									<span className="text-ink-low mx-1">→</span>
									{labelOf(edge.targetId)}
								</span>
								<span className="flex-none text-[11px] text-ink-low">
									{relationshipTypeLabel(edge.relationshipType)}
								</span>
								<span className="ml-auto flex gap-1.5 items-center flex-none">
									{edge.visibility === "private" ? (
										<span className={BADGE_PRIV}>私密</span>
									) : null}
									{edge.validFrom === storyOrder ? (
										<span className={BADGE_NEW}>本章新出现</span>
									) : null}
									{edge.validTo !== undefined && edge.validTo === storyOrder ? (
										<span className={BADGE_GONE}>本章结束</span>
									) : null}
								</span>
							</button>
							{attitudesOfPair.map((attitude) => attitudeRow(attitude))}
							{isSelected ? (
								<div className="px-3.5 pb-3 pl-7 text-[12px] text-ink-mid grid gap-1.5">
									<p className="m-0">
										有效期：
										<b className="text-ink-hi font-normal">
											{validityLabel(edge)}
										</b>
									</p>
									<p className="m-0">
										可见性：
										{edge.visibility === "private"
											? `私密 · 知情者 ${
													edge.knownBy.map((id) => labelOf(id)).join("、") ||
													"（无记录）"
												}`
											: "公开"}
									</p>
									{history.length > 1 ? (
										<div>
											<p className="eyebrow mt-1 mb-0.5">历史变化</p>
											<ul className="m-0 pl-4.5 text-[11.5px] grid gap-0.5">
												{history.map((span, index) => (
													<li key={index}>
														{span.validTo !== undefined
															? `第 ${span.validFrom}–${span.validTo} 章`
															: `第 ${span.validFrom} 章起，至今`}
														{span.isCurrent ? "（当前）" : ""}
													</li>
												))}
											</ul>
										</div>
									) : null}
									{evidenceBlock(edge.sourceSceneVersionId)}
									<div className="mt-1">
										<Button size="compact" onClick={() => onReviseEdge(edge)}>
											发起修订
										</Button>
									</div>
								</div>
							) : null}
						</li>
					);
				})}
				{orphanAttitudeGroups.map((group, groupIndex) => (
					<li key={`att-only-${groupIndex}`} className="border-b border-line">
						{group.map((attitude) => attitudeRow(attitude))}
					</li>
				))}
			</ul>
			<div className="sticky bottom-0 bg-rail px-3.5 pt-1 pb-2 text-[11px] text-ink-low border-t border-line tracking-[0.05em]">
				{`方向态度 · ${visibleAttitudes.length}`}
			</div>
		</div>
	);
}
