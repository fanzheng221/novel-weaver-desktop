import { ImpactSlot } from "../../world/impact-slot";
import { useWorkspace } from "../../../shared/workspace/context";
import { WRITING } from "../../../shared/ui/copy";

/**
 * 本场简报（WF5-06）：右面板按需打开的场景信息投影。
 * 只读呈现写作区上报的规划事实，不是独立事实源。
 * WF5-14：正典场景附带「被引用 · 会影响」区域——规划编排、关系证据
 * 与发布收录都可在这里回跳；纯计划行（未写成）没有投影，如实省略。
 */
export function SceneBriefing({ cwd }: { cwd: string }) {
	const ws = useWorkspace();
	const info = ws.sceneBriefing;
	if (!info) {
		return (
			<p className="m-0 text-[11.5px] leading-[1.9] text-ink-low">
				{WRITING.briefingIdle}
			</p>
		);
	}
	const ownership =
		[info.volumeLabel, info.chapterLabel].filter(Boolean).join(" › ") ||
		"未分章";
	return (
		<dl className="grid gap-2.5 m-0 text-[12px] leading-[1.7]">
			<div>
				<dt className="eyebrow">{WRITING.taskLabel}</dt>
				<dd className="m-0 text-ink-hi">{info.purpose ?? WRITING.taskNone}</dd>
			</div>
			<div>
				<dt className="eyebrow">归属</dt>
				<dd className="m-0 text-ink-mid num-none">{ownership}</dd>
			</div>
			<div>
				<dt className="eyebrow">场景</dt>
				<dd className="m-0 text-ink-mid">
					{info.sceneTitle}
					<span className="num ml-1.5 text-[10.5px] text-ink-low">
						序{info.storyOrder}
					</span>
				</dd>
			</div>
			<div>
				<dt className="eyebrow">状态</dt>
				<dd className="m-0 text-ink-mid">
					{info.state === "canonical"
						? WRITING.briefingStateCanonical
						: WRITING.briefingStatePlanned}
					{info.draftPending ? WRITING.briefingDraftPending : ""}
				</dd>
			</div>
			{info.sceneId ? (
				<div className="border-t border-line pt-2">
					<ImpactSlot
						cwd={cwd}
						subject={{
							kind: "scene",
							id: info.sceneId,
							title: info.sceneTitle,
						}}
						embedded
					/>
				</div>
			) : null}
		</dl>
	);
}
