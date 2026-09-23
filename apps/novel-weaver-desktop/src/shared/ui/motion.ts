import type { Transition, Variants } from "motion/react";

/**
 * 共享动效层（WF3-06）：唯一动效库入口，编排类动效全部经此走 motion，
 * 值与 MASTER §3 动效 token 一一对应；瞬时反馈（hover/边框）仍走 base.css 的
 * token 化 CSS 过渡。reduced-motion 由根节点 MotionConfig reducedMotion="user"
 * 与 base.css 全局闸门双覆盖（transform 类动画直接呈现终态）。
 */

/** --ease-out：入场、位移类 */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
/** --ease-in-out：往复类（呼吸、shimmer——仅 CSS 关键帧使用） */
export const EASE_IN_OUT: [number, number, number, number] = [0.65, 0, 0.35, 1];

const DUR = { fast: 0.15, base: 0.2, slow: 0.3 } as const;

/** 铁律变体：只动画 transform/opacity（MASTER §3），禁 width/height。 */

/** 视图切换淡入＋8px 上移（--dur-base）。无退场：旧视图即时卸载，不阻塞导航。 */
export const viewEnterVariants: Variants = {
	initial: { opacity: 0, y: 8 },
	animate: { opacity: 1, y: 0 },
};

export const viewEnterTransition: Transition = {
	duration: DUR.base,
	ease: EASE_OUT,
};

/** 卡片墙容器：stagger 步进 +60ms（仅启动页／模板库／看板卡片墙使用）。 */
export const cardWallContainerVariants: Variants = {
	hidden: {},
	show: { transition: { staggerChildren: 0.06 } },
};

/** 卡片墙单卡入场：轻弹 back.out。 */
export const cardWallItemVariants: Variants = {
	hidden: { opacity: 0, y: 10, scale: 0.985 },
	show: {
		opacity: 1,
		y: 0,
		scale: 1,
		transition: { duration: 0.26, ease: "backOut" },
	},
};

/** 弹层遮罩：淡入淡出（出场快于入场）。 */
export const overlayBackdropMotion = {
	initial: { opacity: 0 },
	animate: { opacity: 1, transition: { duration: DUR.base, ease: EASE_OUT } },
	exit: { opacity: 0, transition: { duration: 0.12, ease: EASE_IN_OUT } },
};

/** 居中弹层本体：轻微上浮收缩登场（出场 fast 档）；x 由调用方按需叠加居中分量。 */
export const modalPanelVariants: Variants = {
	initial: { opacity: 0, y: -8, scale: 0.99 },
	animate: {
		opacity: 1,
		y: 0,
		scale: 1,
		transition: { duration: DUR.base, ease: EASE_OUT },
	},
	exit: {
		opacity: 0,
		y: -6,
		scale: 0.995,
		transition: { duration: DUR.fast - 0.03, ease: EASE_IN_OUT },
	},
};

/** 抽屉滑入（--dur-slow）／滑出（fast~base，快于入场）。 */
export const drawerPanelTransitionIn: Transition = {
	duration: DUR.slow,
	ease: EASE_OUT,
};
export const drawerPanelTransitionOut: Transition = {
	duration: DUR.fast + 0.05,
	ease: EASE_IN_OUT,
};

/** 右面板贴边滑入（base 档入场，fast 档出场）。 */
export const sidePanelTransitionIn: Transition = {
	duration: DUR.base,
	ease: EASE_OUT,
};
export const sidePanelTransitionOut: Transition = {
	duration: DUR.fast,
	ease: EASE_IN_OUT,
};

/** Nav 活动指示条跨项滑动（WF3-06⑥）：弹簧克制参数，不弹跳过头。 */
export const navIndicatorTransition: Transition = {
	type: "spring",
	stiffness: 520,
	damping: 42,
};
