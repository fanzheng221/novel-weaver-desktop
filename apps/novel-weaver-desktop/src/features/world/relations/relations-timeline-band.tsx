import { useEffect, useMemo, useState } from "react";
import { cx } from "../../../shared/ui/cx";
import type { RelationChangeEvent } from "./relations-model";

/**
 * 时间轴带（WF5-13，原型 C 裁决）：图/列表共享的故事时间在此独占控制，
 * 控制条不再放第二个滑杆。长篇下精准定位四手段互为备份：
 * 章号直达、键盘步进（←→ ±1 / Shift ±5）、变化事件下拉、事件标记聚簇。
 */

const STEP_BUTTON =
	"hitpad ui-plain cursor-pointer h-6.5 px-1.5 rounded-sm border border-line text-[11.5px] text-ink-mid hover:text-ink-hi";

function step(
	current: number,
	delta: number,
	min: number,
	max: number,
): number {
	return Math.min(max, Math.max(min, current + delta));
}

function eventCaption(event: RelationChangeEvent): string {
	const first = event.additions[0] ?? event.endings[0] ?? "关系变化";
	const total = event.additions.length + event.endings.length;
	return total > 1 ? `${first} 等 ${total} 项` : first;
}

export function RelationsTimelineBand({
	storyOrder,
	onStoryOrder,
	storyRange,
	events,
	objectiveCount,
	attitudeCount,
}: {
	storyOrder: number;
	onStoryOrder: (next: number) => void;
	storyRange: { min: number; max: number };
	events: RelationChangeEvent[];
	objectiveCount: number;
	attitudeCount: number;
}) {
	const min = storyRange.min;
	const max = Math.max(storyRange.max, min);
	const span = Math.max(max - min, 1);
	const [directChapter, setDirectChapter] = useState(String(storyOrder));
	const [openCluster, setOpenCluster] = useState<number | null>(null);

	// 章号直达框是故事时间的视图：步进/事件下拉/滑杆改了时间后，
	// 未提交的旧输入必须作废，否则失焦提交会把时间拽回旧章（踩坑）。
	useEffect(() => {
		setDirectChapter(String(storyOrder));
	}, [storyOrder]);

	// 事件标记聚簇：同一位置 3.2% 内合为一簇，簇点开列出精确事件（防重叠）。
	const clusters = useMemo(() => {
		const list: Array<{ p: number; events: RelationChangeEvent[] }> = [];
		for (const event of events) {
			const p = ((event.storyOrder - min) / span) * 100;
			const last = list[list.length - 1];
			if (last && p - last.p < 3.2) {
				last.events.push(event);
				last.p = (last.p + p) / 2;
			} else {
				list.push({ p, events: [event] });
			}
		}
		return list;
	}, [events, min, span]);

	const applyDirectChapter = () => {
		const raw = directChapter.trim();
		// 空串/非法输入不跳章（Number("") === 0 会误跳最前章），恢复显示当前章。
		if (raw === "" || Number.isNaN(Math.round(Number(raw)))) {
			setDirectChapter(String(storyOrder));
			return;
		}
		onStoryOrder(Math.min(max, Math.max(min, Math.round(Number(raw)))));
	};

	return (
		<section
			aria-label="故事时间轴"
			className="flex-none bg-rail border-b border-line px-4 pt-2 pb-2.5 grid gap-1"
		>
			{/* 精准定位行：步进 / 章号直达 / 变化事件下拉 */}
			<div className="flex flex-wrap items-center gap-1.5">
				<span className="eyebrow mr-1">故事时间</span>
				<button
					type="button"
					className={STEP_BUTTON}
					aria-label="后退 20 章"
					onClick={() => onStoryOrder(step(storyOrder, -20, min, max))}
				>
					≪20
				</button>
				<button
					type="button"
					className={STEP_BUTTON}
					aria-label="后退 5 章"
					onClick={() => onStoryOrder(step(storyOrder, -5, min, max))}
				>
					‹5
				</button>
				<button
					type="button"
					className={STEP_BUTTON}
					aria-label="后退 1 章"
					onClick={() => onStoryOrder(step(storyOrder, -1, min, max))}
				>
					‹
				</button>
				<input
					type="number"
					min={min}
					max={max}
					value={directChapter}
					onChange={(event) => setDirectChapter(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							applyDirectChapter();
						}
					}}
					onBlur={applyDirectChapter}
					aria-label="章号直达"
					className="w-18 h-6.5 rounded-sm border border-line bg-shell text-ink-hi text-[12px] px-1.5 font-[inherit] num"
				/>
				<button
					type="button"
					className={STEP_BUTTON}
					aria-label="前进 1 章"
					onClick={() => onStoryOrder(step(storyOrder, 1, min, max))}
				>
					›
				</button>
				<button
					type="button"
					className={STEP_BUTTON}
					aria-label="前进 5 章"
					onClick={() => onStoryOrder(step(storyOrder, 5, min, max))}
				>
					5›
				</button>
				<button
					type="button"
					className={STEP_BUTTON}
					aria-label="前进 20 章"
					onClick={() => onStoryOrder(step(storyOrder, 20, min, max))}
				>
					20≫
				</button>
				<label className="flex items-center gap-1.5 ml-2">
					<span className="text-[11px] text-ink-low">跳到变化事件</span>
					<select
						aria-label="按关系变化事件跳章"
						value={
							events.some((event) => event.storyOrder === storyOrder)
								? String(storyOrder)
								: ""
						}
						onChange={(event) => {
							if (event.target.value !== "") {
								onStoryOrder(Number(event.target.value));
							}
						}}
						className="h-6.5 rounded-sm border border-line bg-shell text-ink-hi text-[12px] px-1 font-[inherit] max-w-64"
					>
						<option value="">选择事件…</option>
						{events.map((event) => (
							<option key={event.storyOrder} value={String(event.storyOrder)}>
								{`第 ${event.storyOrder} 章 · ${eventCaption(event)}`}
							</option>
						))}
					</select>
				</label>
			</div>

			{/* 时间轴轨道：滑杆 + 聚簇事件标记 + 奇偶错行说明 */}
			<div className="relative h-13.5">
				<input
					type="range"
					min={min}
					max={max}
					value={storyOrder}
					onChange={(event) => onStoryOrder(Number(event.target.value))}
					onKeyDown={(event) => {
						// stopPropagation 防壳级方向键导航冲突（原型踩坑）。
						if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
						event.preventDefault();
						event.stopPropagation();
						const big = event.shiftKey ? 5 : 1;
						onStoryOrder(
							event.key === "ArrowLeft"
								? step(storyOrder, -big, min, max)
								: step(storyOrder, big, min, max),
						);
					}}
					aria-label="故事时间切片"
					aria-valuetext={`第 ${storyOrder} 章`}
					className="absolute top-2 left-0 right-0 w-full accent-accent"
				/>
				{clusters.map((cluster, index) => {
					const single = cluster.events.length === 1;
					const label = single
						? `第 ${cluster.events[0].storyOrder} 章：${eventCaption(cluster.events[0])}`
						: `${cluster.events.length} 个变化 · 第 ${cluster.events[0].storyOrder}–${cluster.events[cluster.events.length - 1].storyOrder} 章`;
					return (
						<div key={index}>
							<button
								type="button"
								className={cx(
									"ui-plain cursor-pointer absolute top-0.5 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-accent border-2 border-shell",
									storyOrder === cluster.events[0].storyOrder &&
										"ring-2 ring-accent-text",
								)}
								style={{ left: `${Math.min(cluster.p, 99)}%` }}
								title={label}
								aria-label={label}
								onClick={() => {
									if (single) {
										onStoryOrder(cluster.events[0].storyOrder);
										setOpenCluster(null);
									} else {
										setOpenCluster(openCluster === index ? null : index);
									}
								}}
							/>
							<span
								aria-hidden
								className={cx(
									"absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-accent-text bg-rail-active border border-line rounded-sm px-1 pointer-events-none",
								)}
								style={{
									left: `${Math.min(cluster.p, 74)}%`,
									bottom: index % 2 === 0 ? 0 : 16,
								}}
							>
								{`第${cluster.events[0].storyOrder}章 ${eventCaption(cluster.events[0])}`}
							</span>
							{openCluster === index && !single ? (
								<div
									role="menu"
									aria-label="簇内事件选择"
									className="absolute bottom-6 z-10 -translate-x-1/2 bg-rail-active border border-line rounded-md p-1.5 grid gap-1 whitespace-nowrap"
									style={{
										left: `${Math.min(Math.max(cluster.p, 8), 88)}%`,
									}}
								>
									{cluster.events.map((event) => (
										<button
											key={event.storyOrder}
											type="button"
											role="menuitem"
											className="ui-plain cursor-pointer text-[11.5px] text-accent-text border border-line rounded-sm px-1.5 py-0.5 text-left"
											onClick={() => {
												onStoryOrder(event.storyOrder);
												setOpenCluster(null);
											}}
										>
											{`第 ${event.storyOrder} 章 · ${eventCaption(event)}`}
										</button>
									))}
								</div>
							) : null}
						</div>
					);
				})}
			</div>
			<div className="flex justify-between text-[10.5px] text-ink-low">
				<span className="num">
					{`第 ${storyOrder} 章 · 客观 ${objectiveCount} 条 / 态度 ${attitudeCount} 条`}
				</span>
				<span>←→ ±1 章 · Shift+←→ ±5 · 输入框直达 · 事件下拉跳变化章</span>
			</div>
		</section>
	);
}
