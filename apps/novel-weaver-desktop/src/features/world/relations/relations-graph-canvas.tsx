import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "../../../shared/ui/cx";
import { entityTypeLabel, relationshipTypeLabel } from "../../../shared/ui/terms";
import {
	autoCenterId,
	clampPosition,
	GRAPH_VIEW,
	type Pos,
	pairKey,
	type RelationGraph,
	type RelationObjectiveEdge,
	type RelationSelection,
	radialLayout,
} from "./relations-model";

/**
 * 焦点放射关系图谱（WF5-13，原型 C 裁决移植）：焦点人物/势力居中，
 * 一度/二度/外环三层；客观关系实线（私密点线+「私」前缀），方向态度只留
 * 计数徽章（明细在列表子行）；节点可拖拽理线、双击复位、Alt/右键钉共同焦点。
 * 布局细节遵守原型踩坑记录：未移动的 pointerup 不重渲染；拖拽坐标换算取
 * 宿主中当前在册 SVG 的 getScreenCTM。
 */

const NODE_RADIUS = 26;

interface EdgeGeometry {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	ux: number;
	uy: number;
}

function edgeGeometry(
	source: Pos,
	target: Pos,
	pad = NODE_RADIUS,
): EdgeGeometry {
	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const length = Math.hypot(dx, dy) || 1;
	const ux = dx / length;
	const uy = dy / length;
	return {
		x1: source.x + ux * pad,
		y1: source.y + uy * pad,
		x2: target.x - ux * (pad + 6),
		y2: target.y - uy * (pad + 6),
		ux,
		uy,
	};
}

function svgPoint(
	svg: SVGSVGElement,
	clientX: number,
	clientY: number,
): Pos | null {
	const matrix = svg.getScreenCTM();
	if (!matrix) return null;
	const point = new DOMPoint(clientX, clientY).matrixTransform(
		matrix.inverse(),
	);
	return { x: point.x, y: point.y };
}

function nodeFill(type: string): string {
	return type === "character" ? "var(--accent-soft)" : "var(--rail-active)";
}

function nodeStroke(type: string): string {
	return type === "character" ? "var(--accent)" : "var(--line-strong)";
}

export interface RelationsGraphCanvasProps {
	graph: RelationGraph;
	visibleObjective: RelationObjectiveEdge[];
	visibleAttitudes: Array<{ id: string; sourceId: string; targetId: string }>;
	focus: string;
	pins: ReadonlySet<string>;
	onFocusChange: (next: string) => void;
	onPinsChange: (next: Set<string>) => void;
	selected: RelationSelection | null;
	onSelect: (next: RelationSelection | null) => void;
	manualPositions: Record<string, Pos>;
	onManualPositionsChange: (next: Record<string, Pos>) => void;
}

export function RelationsGraphCanvas({
	graph,
	visibleObjective,
	visibleAttitudes,
	focus,
	pins,
	onFocusChange,
	onPinsChange,
	selected,
	onSelect,
	manualPositions,
	onManualPositionsChange,
}: RelationsGraphCanvasProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{
		id: string;
		grabDX: number;
		grabDY: number;
		moved: boolean;
	} | null>(null);
	const suppressClickRef = useRef(false);
	const lastNodeClickRef = useRef<{ id: string; t: number } | null>(null);
	// 拖拽中的实时位置走本地 state（重渲染快、列表不闪）；结束时才落父级持久化。
	const [liveManual, setLiveManual] =
		useState<Record<string, Pos>>(manualPositions);
	const liveManualRef = useRef(liveManual);
	liveManualRef.current = liveManual;

	// 焦点切换（父级）清空手动位置：与原型语义一致（切焦点即重置布局）。
	useEffect(() => {
		setLiveManual(manualPositions);
		// manualPositions 引用变化（父级重置/加载）时同步。
	}, [manualPositions]);

	const centersKey = focus + [...pins].sort().join(",");
	const layout = useMemo(() => {
		const centers =
			focus === "auto"
				? pins.size > 0
					? [...pins]
					: [
							autoCenterId(graph.nodes, visibleObjective, visibleAttitudes),
						].filter(Boolean)
				: [focus, ...[...pins].filter((id) => id !== focus)];
		return radialLayout(
			graph.nodes,
			visibleObjective,
			visibleAttitudes,
			centers,
			liveManual,
		);
		// centersKey 折叠 pins/focus；拖拽期间的布局重算依赖 liveManual。
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [graph, visibleObjective, visibleAttitudes, centersKey, liveManual]);

	const positions = layout.positions;

	const persistManual = useCallback(
		(next: Record<string, Pos>) => {
			onManualPositionsChange(next);
		},
		[onManualPositionsChange],
	);

	const resetLayout = useCallback(() => {
		const fresh: Record<string, Pos> = {};
		setLiveManual(fresh);
		persistManual(fresh);
	}, [persistManual]);

	const togglePin = useCallback(
		(id: string) => {
			const next = new Set(pins);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			onPinsChange(next);
		},
		[pins, onPinsChange],
	);

	const labelOf = useCallback(
		(id: string) => graph.nodes.find((node) => node.id === id)?.label ?? id,
		[graph.nodes],
	);

	const dimNode = (id: string): boolean => {
		if (!selected) return false;
		if (selected.kind === "node") return selected.id !== id;
		if (selected.kind === "pair") {
			const [source, target] = selected.id.split("|");
			return id !== source && id !== target;
		}
		const touched =
			visibleObjective.some(
				(edge) =>
					edge.id === selected.id &&
					(edge.sourceId === id || edge.targetId === id),
			) ||
			visibleAttitudes.some(
				(edge) =>
					edge.id === selected.id &&
					(edge.sourceId === id || edge.targetId === id),
			);
		return !touched;
	};

	const dimEdge = (sourceId: string, targetId: string): boolean =>
		selected?.kind === "node" &&
		selected.id !== sourceId &&
		selected.id !== targetId;

	const startDrag = useCallback(
		(event: React.PointerEvent<SVGGElement>, id: string) => {
			if (event.altKey) return;
			// 不 preventDefault：会连带吞掉后续 click（原型踩坑）。
			const svg = hostRef.current?.querySelector("svg");
			if (!svg) return;
			const pointer = svgPoint(
				svg as SVGSVGElement,
				event.clientX,
				event.clientY,
			);
			if (!pointer) return;
			const current = liveManualRef.current[id] ?? positions[id];
			if (!current) return;
			dragRef.current = {
				id,
				grabDX: pointer.x - current.x,
				grabDY: pointer.y - current.y,
				moved: false,
			};
			const move = (moveEvent: PointerEvent) => {
				const drag = dragRef.current;
				if (!drag) return;
				// 重渲染会替换 SVG 元素：必须取宿主中当前在册的 SVG 求矩阵。
				const liveSvg = hostRef.current?.querySelector("svg");
				if (!liveSvg) return;
				const pt = svgPoint(
					liveSvg as SVGSVGElement,
					moveEvent.clientX,
					moveEvent.clientY,
				);
				if (!pt) return;
				const next = clampPosition({
					x: pt.x - drag.grabDX,
					y: pt.y - drag.grabDY,
				});
				const old = liveManualRef.current[drag.id];
				if (
					!old ||
					Math.abs(old.x - next.x) > 1.5 ||
					Math.abs(old.y - next.y) > 1.5
				) {
					drag.moved = true;
				}
				setLiveManual((prev) => ({ ...prev, [drag.id]: next }));
			};
			const up = () => {
				window.removeEventListener("pointermove", move);
				window.removeEventListener("pointerup", up);
				const drag = dragRef.current;
				dragRef.current = null;
				if (!drag?.moved) {
					// 未移动：不重渲染——down/up 之间 DOM 替换会让 click 落到
					// svg 背景，点选与双击复位被整体吞掉（原型踩坑②）。
					return;
				}
				suppressClickRef.current = true;
				window.setTimeout(() => {
					suppressClickRef.current = false;
				}, 0);
				setLiveManual((latest) => {
					persistManual(latest);
					return latest;
				});
			};
			window.addEventListener("pointermove", move);
			window.addEventListener("pointerup", up);
		},
		[positions, persistManual],
	);

	const onNodeClick = useCallback(
		(event: React.MouseEvent, id: string) => {
			event.stopPropagation();
			if (suppressClickRef.current) {
				suppressClickRef.current = false;
				return;
			}
			if (event.altKey) {
				// macOS 的 Ctrl+点击会被系统当右键，故用 Alt（原型决议）。
				togglePin(id);
				return;
			}
			// 双击复位该节点：两次点击间会重渲染替换节点，浏览器 dblclick 失效，
			// 自记 400ms 时间窗判定（原型决议）。
			const now = performance.now();
			const last = lastNodeClickRef.current;
			if (last && last.id === id && now - last.t < 400) {
				lastNodeClickRef.current = null;
				setLiveManual((prev) => {
					if (!(id in prev)) return prev;
					const next = { ...prev };
					delete next[id];
					persistManual(next);
					return next;
				});
				return;
			}
			lastNodeClickRef.current = { id, t: now };
			onSelect({ kind: "node", id });
		},
		[onSelect, togglePin, persistManual],
	);

	const badges = useMemo(() => {
		const counts = new Map<
			string,
			{ sourceId: string; targetId: string; count: number }
		>();
		for (const attitude of visibleAttitudes) {
			const key = pairKey(attitude.sourceId, attitude.targetId);
			const entry = counts.get(key);
			if (entry) entry.count += 1;
			else
				counts.set(key, {
					sourceId: attitude.sourceId,
					targetId: attitude.targetId,
					count: 1,
				});
		}
		return [...counts.entries()].map(([key, entry]) => {
			const source = positions[entry.sourceId];
			const target = positions[entry.targetId];
			return {
				key,
				entry,
				mid: source && target ? edgeGeometry(source, target) : null,
			};
		});
	}, [visibleAttitudes, positions]);

	if (graph.nodes.length === 0) return null;

	return (
		<div className="flex-1 min-h-0 flex flex-col">
			<div className="flex items-center gap-2 flex-none px-3 py-1.5 border-b border-line">
				<label className="flex items-center gap-1.5 text-[11px] text-ink-low">
					焦点
					<select
						aria-label="选择焦点人物"
						title="焦点人物居中，一度邻居内环、二度外环；可再用 Alt+点击或右键追加共同焦点"
						value={focus}
						onChange={(event) => onFocusChange(event.target.value)}
						className="h-6.5 rounded-sm border border-line bg-shell text-ink-hi text-[12px] px-1 font-[inherit] max-w-44"
					>
						<option value="auto">自动（关键人物）</option>
						{graph.nodes.map((node) => (
							<option key={node.id} value={node.id}>
								{node.label}
							</option>
						))}
					</select>
				</label>
				<button
					type="button"
					className="hitpad ui-plain cursor-pointer text-[11.5px] text-accent-text border border-line rounded-sm px-1.5 py-0.5"
					aria-label="复位图谱布局"
					title="清除全部手动拖拽位置，恢复算法布局"
					onClick={resetLayout}
				>
					复位布局
				</button>
				<span className="ml-auto text-[10.5px] text-ink-low hidden lg:inline">
					Alt+点节点或右键追加共同焦点 · 拖拽理线 · 双击复位
				</span>
			</div>
			<div
				ref={hostRef}
				className="flex-1 min-h-0 relative overflow-auto bg-rail select-none"
			>
				<svg
					viewBox={`0 0 ${GRAPH_VIEW.width} ${GRAPH_VIEW.height}`}
					preserveAspectRatio="xMidYMid meet"
					role="img"
					aria-label="人物关系图谱画布"
					className="block w-full h-full"
					style={{ touchAction: "none" }}
					onClick={() => {
						if (suppressClickRef.current) {
							suppressClickRef.current = false;
							return;
						}
						onSelect(null);
					}}
				>
					<defs>
						<marker
							id="nw-rel-arrow"
							markerWidth="9"
							markerHeight="9"
							refX="8"
							refY="4.5"
							orient="auto"
						>
							<path d="M0,0 L-9,-4.5 L-9,4.5 Z" fill="var(--line-strong)" />
						</marker>
					</defs>
					{visibleObjective.map((edge) => {
						const source = positions[edge.sourceId];
						const target = positions[edge.targetId];
						if (!source || !target) return null;
						const geometry = edgeGeometry(source, target);
						const isPrivate = edge.visibility === "private";
						const isSelected =
							selected?.kind === "edge" && selected.id === edge.id;
						const midX = (geometry.x1 + geometry.x2) / 2;
						const midY = (geometry.y1 + geometry.y2) / 2;
						return (
							<g
								key={edge.id}
								tabIndex={0}
								role="button"
								aria-label={`${labelOf(edge.sourceId)}对${labelOf(edge.targetId)}的${relationshipTypeLabel(edge.relationshipType)}关系${isPrivate ? "（私密）" : ""}`}
								className={cx("cursor-pointer", isSelected && "outline-none")}
								onClick={(event) => {
									event.stopPropagation();
									if (suppressClickRef.current) {
										suppressClickRef.current = false;
										return;
									}
									onSelect({ kind: "edge", id: edge.id });
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										onSelect({ kind: "edge", id: edge.id });
									}
								}}
							>
								<path
									d={`M${geometry.x1},${geometry.y1} L${geometry.x2},${geometry.y2}`}
									stroke="transparent"
									strokeWidth={14}
									fill="none"
								/>
								<path
									d={`M${geometry.x1},${geometry.y1} L${geometry.x2},${geometry.y2}`}
									stroke={
										isSelected
											? "var(--accent-text)"
											: isPrivate
												? "var(--ink-mid)"
												: "var(--line-strong)"
									}
									strokeWidth={isSelected ? 2.4 : 1.6}
									strokeDasharray={isPrivate ? "3 4" : undefined}
									fill="none"
									markerEnd="url(#nw-rel-arrow)"
									opacity={dimEdge(edge.sourceId, edge.targetId) ? 0.18 : 1}
								/>
								<text
									x={midX}
									y={midY - 6}
									textAnchor="middle"
									fontSize={10.5}
									fill={isSelected ? "var(--accent-text)" : "var(--ink-low)"}
									stroke="var(--rail-bg)"
									strokeWidth={3}
									paintOrder="stroke"
									opacity={dimEdge(edge.sourceId, edge.targetId) ? 0.18 : 1}
								>
									{isPrivate ? "私 " : ""}
									{relationshipTypeLabel(edge.relationshipType)}
								</text>
							</g>
						);
					})}
					{badges.map(({ key, entry, mid }) => {
						if (!mid) return null;
						const midX = (mid.x1 + mid.x2) / 2;
						const midY = (mid.y1 + mid.y2) / 2;
						const label = `态度 ×${entry.count}`;
						const width = label.length * 10.5 + 10;
						const isSelected = selected?.kind === "pair" && selected.id === key;
						return (
							<g
								key={key}
								tabIndex={0}
								role="button"
								aria-label={`${labelOf(entry.sourceId)}与${labelOf(entry.targetId)}之间的 ${entry.count} 条方向态度`}
								className="cursor-pointer"
								onClick={(event) => {
									event.stopPropagation();
									onSelect({ kind: "pair", id: key });
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										onSelect({ kind: "pair", id: key });
									}
								}}
							>
								<rect
									x={midX - width / 2}
									y={midY - 9}
									width={width}
									height={18}
									rx={4}
									fill="var(--accent-soft)"
									stroke={isSelected ? "var(--accent-text)" : "var(--accent)"}
								/>
								<text
									x={midX}
									y={midY + 3.5}
									textAnchor="middle"
									fontSize={10}
									fill="var(--accent-text)"
								>
									{label}
								</text>
							</g>
						);
					})}
					{graph.nodes.map((node) => {
						const pos = positions[node.id];
						if (!pos) return null;
						const isCenter = layout.centers.has(node.id);
						const isPinned = pins.has(node.id);
						const isSelected =
							selected?.kind === "node" && selected.id === node.id;
						const dim = dimNode(node.id);
						return (
							<g
								key={node.id}
								tabIndex={0}
								role="button"
								aria-label={`${node.label}（${entityTypeLabel(node.type)}${isPinned ? "，共同焦点" : isCenter ? "，焦点" : ""}）`}
								className={cx(
									isCenter ? "cursor-default" : "cursor-grab",
									dim && "opacity-25",
								)}
								onClick={(event) => onNodeClick(event, node.id)}
								onContextMenu={(event) => {
									event.preventDefault();
									event.stopPropagation();
									togglePin(node.id);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										onSelect({ kind: "node", id: node.id });
									}
								}}
								onPointerDown={(event) => startDrag(event, node.id)}
							>
								{isCenter ? (
									<circle
										cx={pos.x}
										cy={pos.y}
										r={NODE_RADIUS + 7}
										fill="none"
										stroke="var(--accent)"
										strokeWidth={1.2}
										strokeDasharray="2 3"
										opacity={0.9}
									/>
								) : isPinned ? (
									<circle
										cx={pos.x}
										cy={pos.y}
										r={NODE_RADIUS + 5}
										fill="none"
										stroke="var(--accent-text)"
										strokeWidth={1}
										opacity={0.7}
									/>
								) : null}
								<circle
									cx={pos.x}
									cy={pos.y}
									r={NODE_RADIUS}
									fill={isSelected ? "var(--accent-soft)" : nodeFill(node.type)}
									stroke={
										isSelected || isCenter
											? "var(--accent-text)"
											: nodeStroke(node.type)
									}
									strokeWidth={isSelected || isCenter ? 2.4 : 1.5}
								/>
								<text
									x={pos.x}
									y={pos.y + 4}
									textAnchor="middle"
									fontSize={12}
									fill={isCenter ? "var(--accent-text)" : "var(--ink-hi)"}
									stroke="var(--rail-bg)"
									strokeWidth={3}
									paintOrder="stroke"
								>
									{node.label}
								</text>
								<text
									x={pos.x}
									y={pos.y + NODE_RADIUS + 14}
									textAnchor="middle"
									fontSize={10}
									fill="var(--ink-low)"
									stroke="var(--rail-bg)"
									strokeWidth={3}
									paintOrder="stroke"
								>
									{entityTypeLabel(node.type)}
								</text>
							</g>
						);
					})}
				</svg>
				<div
					aria-hidden
					className="absolute left-3 bottom-2.5 pointer-events-none bg-[rgba(29,32,35,0.92)] border border-line rounded-md px-2.5 py-1.5 text-[11px] text-ink-mid flex gap-3"
				>
					<span>
						<span className="inline-block w-4.5 border-t-2 border-line-strong align-middle mr-1" />
						客观关系
					</span>
					<span>
						<span className="inline-block w-4.5 border-t-2 border-dashed border-accent align-middle mr-1" />
						态度（列表明细）
					</span>
					<span>
						<span className="inline-block w-4.5 border-t-2 border-dotted border-ink-mid align-middle mr-1" />
						私密
					</span>
				</div>
			</div>
		</div>
	);
}
