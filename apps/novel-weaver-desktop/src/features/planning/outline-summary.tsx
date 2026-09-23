import { Button } from "../../shared/ui/components";
import type { PlanningNode } from "./planning-model";
import { outlineSummaryOf } from "./planning-model";

/** WF5-10 文案常量：e2e 按字面量断言。 */
export const SPLIT_PRIMARY_ACTION = "根据总纲拆分章节";
export const SPLIT_PREVIEW = "生成拆章预览";
export const SPLIT_RUN = "确认拆章";
export const SPLIT_RETRY = "重试拆章";
export const SPLIT_ADJUST = "调整指令";
export const SPLIT_CLOSE = "完成";

/**
 * 零章第一态（WF5-10 用例 1）：总纲摘要 + 唯一主操作，
 * 不渲染看板四列，也不显示树/看板切换。
 */
export function OutlineSummary({
	outline,
	onSplit,
	onEdit,
}: {
	outline: PlanningNode;
	onSplit: () => void;
	onEdit?: () => void;
}) {
	const summary = outlineSummaryOf(outline);
	return (
		<div
			className="border-[1.5px] border-dashed border-line rounded-md px-4 py-5 grid gap-2.5"
			data-testid="outline-summary"
		>
			<p className="eyebrow m-0">总纲摘要</p>
			{summary.goal ? (
				<p className="m-0 text-[13px] leading-[1.7] text-ink-hi">
					{summary.goal}
				</p>
			) : null}
			{summary.acts.length > 0 ? (
				<ol className="m-0 pl-5 grid gap-1 text-[12px] leading-[1.7] text-ink-mid">
					{summary.acts.map((act, index) => (
						<li key={index}>{act}</li>
					))}
				</ol>
			) : (
				<p className="m-0 text-[11.5px] leading-[1.7] text-ink-low">
					总纲还没有分幕内容；仍可在下一步逐行输入章节划分。
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				{onEdit ? <Button onClick={onEdit}>编辑总纲</Button> : null}
				<Button variant="primary" onClick={onSplit}>
					{SPLIT_PRIMARY_ACTION}
				</Button>
			</div>
			<p className="m-0 text-[11px] leading-[1.6] text-ink-low">
				拆分会按行生成章节计划并逐条纳入规划；之后随时可在章节抽屉里修订。
			</p>
		</div>
	);
}
