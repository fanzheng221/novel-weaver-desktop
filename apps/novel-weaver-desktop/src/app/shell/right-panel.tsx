import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { IconButton } from "../../shared/ui/icons";
import { type ReactNode, useEffect, useRef } from "react";
import { HINTS } from "../../shared/ui/copy";
import { cx } from "../../shared/ui/cx";
import { sidePanelTransitionIn, sidePanelTransitionOut } from "../../shared/ui/motion";
import {
	clampPanelWidth,
	PANEL_WIDTH_MAX,
	PANEL_WIDTH_MIN,
	useWorkspace,
} from "../../shared/workspace/context";

export interface PanelTab {
	key: string;
	label: string;
}

/**
 * 右侧面板容器（WF2-01/10）：Tab 化、默认收起、顶栏按钮唤出、左缘可拖宽。
 * renderContent 由壳按当前视图注入；未提供时显示占位文案。
 */
export function RightPanel({
	tabs,
	renderContent,
}: {
	tabs: PanelTab[];
	renderContent?: (activeKey: string) => ReactNode;
}) {
	const ws = useWorkspace();
	const activeKey = tabs.some((tab) => tab.key === ws.panelActiveTab)
		? (ws.panelActiveTab as string)
		: (tabs[0]?.key ?? "");
	const setActiveKey = (key: string) => ws.setPanelActiveTab(key);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const open = ws.panelOpen && tabs.length > 0;

	const triggerRef = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (!open) return;
		triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"]')) {
				ws.togglePanel();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
		};
	}, [open, ws.togglePanel]);

	return (
		/* 右面板贴边滑入滑出，出场快于入场（WF3-06④）；宽度拖拽不受影响 */
		<AnimatePresence>
			{open ? (
				<motion.div
					key="right-panel"
					initial={{ opacity: 0, x: 18 }}
					animate={{ opacity: 1, x: 0, transition: sidePanelTransitionIn }}
					exit={{ opacity: 0, x: 18, transition: sidePanelTransitionOut }}
					className="flex flex-none items-stretch"
				>
					<aside
						/* WF5-07：右面板更名「写作工具面板」——AI 助手指认让位给覆盖式抽屉。 */
						aria-label="写作工具面板"
						className="flex-none min-h-0 flex flex-col bg-rail border-l border-line"
						style={{ width: ws.panelWidth }}
					>
						<div className="flex justify-end px-2 pt-2">
							<IconButton icon={X} label="关闭写作工具面板" onClick={() => ws.togglePanel()} />
						</div>
						<div
							role="tablist"
							className="flex-none flex gap-0.5 px-2 pt-1 pb-0 border-b border-line"
						>
							{tabs.map((tab) => {
								const active = tab.key === activeKey;
								return (
									<button
										key={tab.key}
										type="button"
										role="tab"
										aria-selected={active}
										onClick={() => setActiveKey(tab.key)}
										className={cx(
											"ui-plain cursor-pointer text-[11.5px] font-[inherit] py-2 px-3 rounded-t-[5px]",
											active
												? "text-accent-text font-semibold shadow-[inset_0_-2px_0_var(--accent)]"
												: "text-ink-low",
										)}
									>
										{tab.label}
									</button>
								);
							})}
						</div>
						<div className="flex-1 min-h-0 overflow-y-auto p-3">
							{renderContent ? (
								renderContent(activeKey)
							) : (
								<p className="m-0 max-w-[30ch] text-center text-[11.5px] leading-[1.9] text-ink-low">
									{HINTS.rightPanelAiIdle}
								</p>
							)}
						</div>
					</aside>
					{/* biome-ignore lint/a11y/useSemanticElements: 可键盘调宽的分割条是交互式 separator 部件，<hr> 无法承载 aria-valuenow */}
					<div
						role="separator"
						aria-orientation="vertical"
						aria-label="调整右侧面板宽度"
						aria-valuemin={PANEL_WIDTH_MIN}
						aria-valuemax={PANEL_WIDTH_MAX}
						aria-valuenow={ws.panelWidth}
						tabIndex={0}
						onKeyDown={(event) => {
							if (event.key === "ArrowLeft") {
								event.preventDefault();
								ws.setPanelWidth(ws.panelWidth + 16);
							}
							if (event.key === "ArrowRight") {
								event.preventDefault();
								ws.setPanelWidth(ws.panelWidth - 16);
							}
						}}
						onPointerDown={(event) => {
							dragRef.current = {
								startX: event.clientX,
								startWidth: ws.panelWidth,
							};
							event.currentTarget.setPointerCapture(event.pointerId);
						}}
						onPointerMove={(event) => {
							const drag = dragRef.current;
							if (!drag) return;
							ws.setPanelWidth(
								clampPanelWidth(
									drag.startWidth - (event.clientX - drag.startX),
								),
							);
						}}
						onPointerUp={() => {
							dragRef.current = null;
						}}
						onPointerCancel={() => {
							dragRef.current = null;
						}}
						title="拖拽调整宽度"
						className="w-1.25 -ml-0.75 flex-none cursor-col-resize flex justify-center touch-none"
					>
						<span
							className="w-px h-full bg-line"
							style={{ transition: "background .15s ease, width .15s ease" }}
							onPointerEnter={(event) => {
								event.currentTarget.style.background = "var(--accent)";
								event.currentTarget.style.width = "2px";
							}}
							onPointerLeave={(event) => {
								event.currentTarget.style.background = "var(--line)";
								event.currentTarget.style.width = "1px";
							}}
						/>
					</div>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
