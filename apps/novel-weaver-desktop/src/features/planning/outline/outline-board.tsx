import { useState } from "react";
import { ForeshadowTable } from "../foreshadow/foreshadow-table";
import { PlanningWorkspace } from "../planning-workspace";
import { TimelineView } from "../timeline/timeline-view";
import { PAGE } from "../../../shared/ui/components";
import { cx } from "../../../shared/ui/cx";

type SubTab = "board" | "foreshadow" | "timeline";

const SUB_TAB_LABEL: Record<SubTab, string> = {
	board: "章节大纲",
	foreshadow: "伏笔追踪",
	timeline: "时间线",
};

/**
 * 大纲工作区路由壳（WF5-10）：规划主体位于 `src/features/planning/` 深模块；
 * 这里只保留标题头、伏笔/时间线子区委派与子 Tab 兼容渲染。
 */
export function OutlineBoard({
	cwd,
	initialSubTab,
	subTabsExternal,
}: {
	cwd: string;
	initialSubTab?: SubTab;
	/**
	 * WF5-04：壳级「规划子区」条接管子区切换时隐藏页内 Tab，避免双排开关；
	 * 子区经路由 remount 传入 initialSubTab，行为等价。
	 */
	subTabsExternal?: boolean;
}) {
	const [subTab, setSubTab] = useState<SubTab>(initialSubTab ?? "board");

	return (
		<main className={PAGE}>
			<header className="flex items-center gap-3">
				<div>
					<p className="eyebrow">NOVEL WEAVER / OUTLINE</p>
					<h1 className="font-wenkai text-[22px] mt-0.5 mb-0">大纲工作区</h1>
				</div>
				{/* 工作区子 Tab（WF2-08）：伏笔表与时间线并入；壳级子区条接管时隐藏（WF5-04） */}
				{subTabsExternal ? null : (
					<div className="inline-flex border border-line rounded-md overflow-hidden">
						{(Object.keys(SUB_TAB_LABEL) as SubTab[]).map((key) => (
							<button
								key={key}
								type="button"
								onClick={() => setSubTab(key)}
								className={cx(
									"ui-plain inline-flex min-h-7 items-center cursor-pointer text-[12.5px] font-[inherit] px-3 py-1",
									subTab === key
										? "text-accent-text bg-accent-soft font-semibold"
										: "text-ink-mid bg-transparent",
								)}
							>
								{SUB_TAB_LABEL[key]}
							</button>
						))}
					</div>
				)}
			</header>

			{subTab === "foreshadow" ? (
				<ForeshadowTable cwd={cwd} embedded />
			) : subTab === "timeline" ? (
				<TimelineView cwd={cwd} embedded />
			) : (
				<PlanningWorkspace cwd={cwd} />
			)}
		</main>
	);
}
