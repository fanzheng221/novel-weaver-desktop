import type { PointerEvent as ReactPointerEvent } from "react";
import { useRef, useState } from "react";
import { WRITING } from "../../../shared/ui/copy";
import {
	clampNavWidth,
	NAV_WIDTH_DEFAULT,
	NAV_WIDTH_MIN,
	navWidthMaxFor,
} from "./nav-width";

/**
 * 左栏宽度分割条（WF5-06）：可访问 separator——指针拖拽、←/→ ±12px、
 * Home/双击复位 232。拖拽期间由父级对工作区容器加 select-none，
 * 避免拖动选中正文文本；键盘路径与指针路径等价（验收 3）。
 */
export function NavResizer({
	width,
	viewportWidth,
	onChange,
	onDraggingChange,
}: {
	width: number;
	viewportWidth: number;
	onChange: (next: number) => void;
	onDraggingChange?: (dragging: boolean) => void;
}) {
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const [dragging, setDragging] = useState(false);
	const max = navWidthMaxFor(viewportWidth);

	const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
		dragRef.current = { startX: event.clientX, startWidth: width };
		event.currentTarget.setPointerCapture(event.pointerId);
		setDragging(true);
		onDraggingChange?.(true);
	};
	const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag) return;
		onChange(
			clampNavWidth(
				drag.startWidth + (event.clientX - drag.startX),
				viewportWidth,
			),
		);
	};
	const endDrag = () => {
		if (!dragRef.current) return;
		dragRef.current = null;
		setDragging(false);
		onDraggingChange?.(false);
	};

	return (
		/* biome-ignore lint/a11y/useSemanticElements: 可键盘调宽的交互式 separator 需要 aria-valuenow（同右面板分割条约定） */
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="调整章节栏宽度"
			aria-valuemin={NAV_WIDTH_MIN}
			aria-valuemax={max}
			aria-valuenow={width}
			tabIndex={0}
			onKeyDown={(event) => {
				if (event.key === "ArrowLeft") {
					event.preventDefault();
					onChange(clampNavWidth(width - 12, viewportWidth));
				} else if (event.key === "ArrowRight") {
					event.preventDefault();
					onChange(clampNavWidth(width + 12, viewportWidth));
				} else if (event.key === "Home") {
					event.preventDefault();
					onChange(NAV_WIDTH_DEFAULT);
				}
			}}
			onDoubleClick={() => onChange(NAV_WIDTH_DEFAULT)}
			onPointerDown={beginDrag}
			onPointerMove={moveDrag}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			title={WRITING.resizeHint}
			className={`flex-none w-1.5 cursor-col-resize touch-none self-stretch bg-shell ${
				dragging ? "bg-accent-soft" : ""
			}`}
		>
			<span
				aria-hidden
				className={`mx-auto block h-full w-px ${
					dragging ? "bg-accent" : "bg-line"
				}`}
			/>
		</div>
	);
}
