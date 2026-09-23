import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

// fixture 必须导入产品 base.css 而不是自造样式（ui-testing.md 约定）。
import "../shared/ui/base.css";

import { RelationsGraphCanvas } from "../features/world/relations/relations-graph-canvas";
import { RelationsList } from "../features/world/relations/relations-list";
import { RelationsTimelineBand } from "../features/world/relations/relations-timeline-band";
import {
	attitudeBadgeCounts,
	attitudeOffsets,
	autoCenterId,
	changeEvents,
	clampStoryOrder,
	objectiveTypePool,
	pairKey,
	type RelationGraph,
	type RelationSelection,
	radialLayout,
	sameSpanHistory,
	storyRangeOf,
	validityLabel,
	visibleAttitudes,
	visibleObjective,
} from "../features/world/relations/relations-model";

/**
 * WF5-13（补充层，fixture 直打生产纯函数与呈现组件）：统一关系工作区——
 *   · 共享谓词：activeAt/visibleObjective/visibleAttitudes 时间切片+类型筛选；
 *   · storyRangeOf/clampStoryOrder 稳定时间范围；changeEvents 变化事件；
 *   · radialLayout 焦点放射布局（含界内约束）；attitudeOffsets 双向态度分侧；
 *   · sameSpanHistory/validityLabel 有效期与历史；
 *   · 时间轴带/图谱/列表组件在 fixture 数据下的真实渲染与交互。
 */

const GRAPH: RelationGraph = {
	continuityId: "main",
	storyOrder: 4,
	knowledgeMode: "author",
	nodes: [
		{
			id: "CHAR-LIN",
			label: "林舟",
			type: "character",
			description: "漕帮少主。",
		},
		{
			id: "CHAR-SU",
			label: "苏晚",
			type: "character",
			description: "同门师妹。",
		},
		{
			id: "CHAR-SHEN",
			label: "沈青",
			type: "character",
			description: "前朝旧人。",
		},
		{ id: "FAC-BANG", label: "漕帮", type: "faction", description: "" },
		{ id: "FAC-SI", label: "漕运司", type: "faction", description: "" },
	],
	objectiveEdges: [
		{
			id: "REL-ALLY",
			sourceId: "CHAR-LIN",
			targetId: "CHAR-SU",
			relationshipType: "ally_of",
			validFrom: 0,
			visibility: "public",
			knownBy: [],
		},
		{
			id: "REL-MEMBER",
			sourceId: "CHAR-LIN",
			targetId: "FAC-BANG",
			relationshipType: "member_of",
			validFrom: 0,
			visibility: "public",
			knownBy: [],
		},
		{
			id: "REL-CTRL",
			sourceId: "FAC-BANG",
			targetId: "FAC-SI",
			relationshipType: "contests_control_of",
			validFrom: 1,
			visibility: "public",
			knownBy: [],
		},
		{
			id: "REL-RIVAL-1",
			sourceId: "CHAR-SU",
			targetId: "CHAR-SHEN",
			relationshipType: "political_rival_of",
			validFrom: 2,
			validTo: 6,
			visibility: "public",
			knownBy: [],
			sourceSceneVersionId: "VER-RIVAL",
		},
		{
			id: "REL-RIVAL-2",
			sourceId: "CHAR-SU",
			targetId: "CHAR-SHEN",
			relationshipType: "political_rival_of",
			validFrom: 8,
			visibility: "public",
			knownBy: [],
		},
		{
			id: "REL-SECRET",
			sourceId: "CHAR-LIN",
			targetId: "CHAR-SHEN",
			relationshipType: "ally_of",
			validFrom: 3,
			visibility: "private",
			knownBy: ["CHAR-LIN"],
		},
	],
	attitudeEdges: [
		{
			id: "ATT-A",
			sourceId: "CHAR-SU",
			targetId: "CHAR-LIN",
			dimension: "affection",
			intensity: 0.9,
			validFrom: 0,
		},
		{
			id: "ATT-B",
			sourceId: "CHAR-LIN",
			targetId: "CHAR-SU",
			dimension: "trust",
			intensity: 0.6,
			validFrom: 1,
		},
		{
			id: "ATT-C",
			sourceId: "CHAR-SU",
			targetId: "CHAR-LIN",
			dimension: "fear",
			intensity: 0.4,
			validFrom: 2,
			validTo: 5,
		},
	],
	objectiveHistory: [],
	attitudeHistory: [],
	storyRange: { min: 0, max: 8 },
	textFallback: "",
};
GRAPH.objectiveHistory = GRAPH.objectiveEdges;
GRAPH.attitudeHistory = GRAPH.attitudeEdges;

const SCENE_REFS = {
	"VER-RIVAL": { sceneId: "SC-RIVAL", title: "码头对峙", storyOrder: 2 },
};

function RelationsFixture() {
	const [storyOrder, setStoryOrder] = useState(4);
	const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
	const [selected, setSelected] = useState<RelationSelection | null>(null);
	const [focus, setFocus] = useState("auto");
	const [pins, setPins] = useState<ReadonlySet<string>>(new Set());
	const [manual, setManual] = useState<
		Record<string, { x: number; y: number }>
	>({});
	const [out, setOut] = useState<string[]>([]);

	const typeFilter = useMemo(() => {
		const set = new Set(objectiveTypePool(GRAPH).map(({ type }) => type));
		for (const type of excluded) set.delete(type);
		return set;
	}, [excluded]);

	const objective = useMemo(
		() => visibleObjective(GRAPH, storyOrder, typeFilter),
		[storyOrder, typeFilter],
	);
	const attitudes = useMemo(
		() => visibleAttitudes(GRAPH, storyOrder),
		[storyOrder],
	);
	const events = useMemo(() => changeEvents(GRAPH), []);
	const range = useMemo(() => storyRangeOf(GRAPH), []);

	const showSlice = () => {
		setOut([
			`objective=${objective.map((edge) => edge.id).join(",")}`,
			`attitudes=${attitudes.map((edge) => edge.id).join(",")}`,
			`pool=${objectiveTypePool(GRAPH)
				.map(({ type, count }) => `${type}:${count}`)
				.join("|")}`,
			`range=${range.min}-${range.max}`,
			`clamped=${clampStoryOrder(99, range)}`,
			`events=${events.map((event) => event.storyOrder).join(",")}`,
		]);
	};

	const showLayout = () => {
		const centers =
			focus === "auto"
				? pins.size > 0
					? [...pins]
					: [autoCenterId(GRAPH.nodes, objective, attitudes)].filter(Boolean)
				: [focus, ...[...pins].filter((id) => id !== focus)];
		const { positions, centers: centerSet } = radialLayout(
			GRAPH.nodes,
			objective,
			attitudes,
			centers,
			manual,
		);
		const placed = Object.values(positions);
		setOut([
			`placed=${placed.length}/${GRAPH.nodes.length}`,
			`inBounds=${placed.every(
				(pos) => pos.x >= 0 && pos.x <= 760 && pos.y >= 0 && pos.y <= 560,
			)}`,
			`centers=${[...centerSet].sort().join(",")}`,
			`rivalPair=${pairKey("CHAR-SU", "CHAR-SHEN")}`,
		]);
	};

	const showArcs = () => {
		const offsets = attitudeOffsets(GRAPH.attitudeEdges);
		const badges = attitudeBadgeCounts(GRAPH.attitudeEdges);
		setOut([
			`ATT-A=${offsets["ATT-A"]?.offset}:${offsets["ATT-A"]?.side}`,
			`ATT-B=${offsets["ATT-B"]?.offset}:${offsets["ATT-B"]?.side}`,
			`ATT-C=${offsets["ATT-C"]?.offset}:${offsets["ATT-C"]?.side}`,
			`badges=${[...badges.entries()].map(([key, entry]) => `${key}:${entry.count}`).join("|")}`,
		]);
	};

	const showHistory = () => {
		const current = GRAPH.objectiveEdges.find(
			(edge) => edge.id === "REL-RIVAL-2",
		);
		const spans = current
			? sameSpanHistory(GRAPH.objectiveHistory, current)
			: [];
		setOut([
			`spans=${spans
				.map(
					(span) =>
						`${span.validFrom}-${span.validTo ?? "open"}${span.isCurrent ? "*" : ""}`,
				)
				.join("|")}`,
			`validity=${current ? validityLabel(current) : ""}`,
			`secret=${validityLabel(GRAPH.objectiveEdges.find((edge) => edge.id === "REL-SECRET")!)}`,
		]);
	};

	return (
		<div style={{ padding: 16, display: "grid", gap: 12 }}>
			<section style={{ display: "grid", gap: 6 }}>
				<h2>纯函数</h2>
				<button onClick={showSlice}>切片</button>
				<button onClick={showLayout}>布局</button>
				<button onClick={showArcs}>态度弧</button>
				<button onClick={showHistory}>历史</button>
				<ol data-testid="model-out">
					{out.map((line, index) => (
						<li key={index}>{line}</li>
					))}
				</ol>
			</section>

			<section style={{ display: "grid", gap: 6 }}>
				<h2>时间轴带</h2>
				<RelationsTimelineBand
					storyOrder={storyOrder}
					onStoryOrder={setStoryOrder}
					storyRange={range}
					events={events}
					objectiveCount={objective.length}
					attitudeCount={attitudes.length}
				/>
			</section>

			<section style={{ display: "grid", gap: 6 }}>
				<h2>类型筛选</h2>
				<div
					role="group"
					aria-label="关系类型筛选"
					style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
				>
					{objectiveTypePool(GRAPH).map(({ type, count }) => (
						<button
							key={type}
							type="button"
							aria-pressed={!excluded.has(type)}
							onClick={() =>
								setExcluded((prev) => {
									const next = new Set(prev);
									if (next.has(type)) next.delete(type);
									else next.add(type);
									return next;
								})
							}
						>
							{`${type} · ${count}`}
						</button>
					))}
				</div>
			</section>

			<section
				style={{
					display: "grid",
					gap: 6,
					gridTemplateColumns: "minmax(0,1fr) 368px",
				}}
			>
				<div style={{ border: "1px solid var(--line)", minHeight: 480 }}>
					<RelationsGraphCanvas
						graph={GRAPH}
						visibleObjective={objective}
						visibleAttitudes={attitudes}
						focus={focus}
						pins={pins}
						onFocusChange={setFocus}
						onPinsChange={setPins}
						selected={selected}
						onSelect={setSelected}
						manualPositions={manual}
						onManualPositionsChange={setManual}
					/>
				</div>
				<div
					style={{
						border: "1px solid var(--line)",
						display: "flex",
						flexDirection: "column",
						maxHeight: 640,
					}}
				>
					<RelationsList
						graph={GRAPH}
						visibleObjective={objective}
						visibleAttitudes={attitudes}
						storyOrder={storyOrder}
						selected={selected}
						onSelect={setSelected}
						sceneRefs={SCENE_REFS}
						onJumpScene={() => {}}
						onReviseEdge={() => {}}
					/>
				</div>
			</section>
		</div>
	);
}

export default RelationsFixture;

const root = document.getElementById("fixture-root");
if (root) createRoot(root).render(<RelationsFixture />);
