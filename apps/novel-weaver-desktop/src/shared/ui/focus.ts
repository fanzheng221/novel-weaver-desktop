import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
	"a[href], button:not([disabled]), input:not([disabled]), " +
	"select:not([disabled]), textarea:not([disabled]), " +
	'[tabindex]:not([tabindex="-1"])';

/**
 * 模态焦点圈闭与归还（WF3-11）：挂载时把焦点送进容器首控件并记录触发者，
 * Tab / Shift+Tab 在容器内循环、背景不可达；卸载时把焦点归还触发者。
 * 零依赖自实现；active 控制启停，常驻壳层可传状态开关。
 */
export function useModalFocus<T extends HTMLElement = HTMLDivElement>(
	active = true,
): RefObject<T | null> {
	const containerRef = useRef<T>(null);

	useEffect(() => {
		if (!active) return;
		const container = containerRef.current;
		if (!container) return;

		const restoreTo =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const focusables = () =>
			Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
		focusables()[0]?.focus();

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Tab") return;
			const items = focusables();
			if (items.length === 0) return;
			const current = document.activeElement;
			const inside = current instanceof Node && container.contains(current);
			if (event.shiftKey) {
				if (!inside || current === items[0]) {
					event.preventDefault();
					items[items.length - 1].focus();
				}
			} else if (!inside || current === items[items.length - 1]) {
				event.preventDefault();
				items[0].focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			restoreTo?.focus({ preventScroll: true });
		};
	}, [active]);

	return containerRef;
}
