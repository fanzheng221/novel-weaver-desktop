import { WorkspaceIcon } from "../../shared/ui/icons";
import { cx } from "../../shared/ui/cx";
import { type AreaDef, visibleSubs } from "../../shared/workspace/routes";

/**
 * 工作区子区切换条（WF5-04）：壳级组件，位于顶栏与主区之间。
 * 活动态与右面板 Tab / NavItem 同一视觉语言（rail-active 底 + accent 下划线），
 * 选中态用 aria-current 表达，不只依赖颜色。
 */
export function WorkspaceTabs({
	area,
	activeSub,
	onSelect,
}: {
	area: AreaDef;
	activeSub: string | null;
	onSelect: (subKey: string) => void;
}) {
	const subs = visibleSubs(area);
	if (subs.length === 0) return null;
	return (
		<nav
			aria-label={`${area.label}子区`}
			className="flex-none flex items-stretch gap-0.5 px-3 bg-rail border-b border-line"
		>
			{subs.map((sub) => {
				const active = sub.key === activeSub;
				return (
					<button
						key={sub.key}
						type="button"
						aria-current={active ? "page" : undefined}
						onClick={() => onSelect(sub.key)}
						className={cx(
							"ui-plain inline-flex items-center gap-1.5 cursor-pointer text-[11.5px] font-[inherit] py-2 px-3 rounded-t-[5px]",
							active
								? "text-accent-text font-semibold bg-rail-active shadow-[inset_0_-2px_0_var(--accent)]"
								: "text-ink-low hover:text-ink-mid",
						)}
					>
						<WorkspaceIcon name={sub.key} />{sub.label}
					</button>
				);
			})}
		</nav>
	);
}
