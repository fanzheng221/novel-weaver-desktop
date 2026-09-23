import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode, Ref } from "react";
import { useId } from "react";
import { cx } from "./cx";
import { GlyphIcon } from "./icons";
import { navIndicatorTransition } from "./motion";

export type Theme = "dark" | "light";

/**
 * 页面容器统一规范（WF3-12）：所有整页视图的 <main> 一律用本常量——
 * 流式铺满中栏（不再 max-w/mx-auto 定宽），内边距统一 24/24/64，间距 12。
 * 正文纸面仍按自身阅读宽度约束（720px），不受此容器影响。
 */
export const PAGE = "grid gap-3 px-6 pt-6 pb-16";

/** 原生窗口底色与主题一致，杜绝系统层白闪（WF3-01）。 */
const WINDOW_BACKGROUND: Record<Theme, string> = {
	dark: "#17181a",
	light: "#f4f2ed",
};

export function setTheme(theme: Theme): void {
	document.documentElement.dataset.theme = theme;
	try {
		localStorage.setItem("nw-theme", theme);
	} catch {
		/* 隐私模式等场景下静默降级为会话内主题 */
	}
	getCurrentWindow()
		.setBackgroundColor(WINDOW_BACKGROUND[theme])
		.catch(() => {
			/* 浏览器环境或旧版 Tauri：静默降级 */
		});
}

export function initialTheme(): Theme {
	try {
		const stored = localStorage.getItem("nw-theme");
		if (stored === "light" || stored === "dark") return stored;
	} catch {
		/* 同上 */
	}
	return "dark";
}

type ButtonVariant = "primary" | "ghost";
type ButtonSize = "compact" | "default" | "primary";

const BUTTON_BASE =
	"ui-plain t-fast inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-sm font-[inherit]";
const BUTTON_SIZE: Record<ButtonSize, string> = {
	compact: "min-h-7 px-2 py-1 text-[11.5px] leading-4",
	default: "min-h-8 px-3 py-1.5 text-[12px] leading-4",
	primary: "min-h-9 px-4 py-2 text-[13px] leading-5",
};
const BUTTON_TONE: Record<ButtonVariant, string> = {
	primary: "bg-accent border border-accent text-accent-contrast font-semibold",
	ghost: "bg-transparent border border-line text-ink-mid",
};

export function Button({
	variant = "ghost",
	size,
	onClick,
	children,
	disabled,
	busy,
}: {
	variant?: ButtonVariant;
	/** WF4-04：颜色与尺寸独立；同排默认按钮使用相同尺寸，大按钮需显式指定。 */
	size?: ButtonSize;
	onClick?: () => void;
	children: ReactNode;
	disabled?: boolean;
	/** busy 统一表达（WF3-09）：禁用＋aria-busy＋progress 光标；文案由调用方给「…中」。 */
	busy?: boolean;
}) {
	return (
		<button
			type="button"
			className={cx(
				BUTTON_BASE,
				BUTTON_SIZE[size ?? "default"],
				BUTTON_TONE[variant],
				disabled && ["cursor-not-allowed", "opacity-[0.48]"],
				busy && ["cursor-progress", "opacity-[0.72]"],
			)}
			onClick={onClick}
			disabled={disabled || busy}
			aria-busy={busy || undefined}
		>
			{children}
		</button>
	);
}

export function TextField({
	label,
	value,
	onChange,
	placeholder,
	hint,
	fieldRef,
	invalid,
}: {
	label: string;
	value: string;
	onChange: (next: string) => void;
	placeholder?: string;
	/** 字段复杂时提供常驻说明；placeholder 仅用于示例值。 */
	hint?: string;
	/** WF5-02：失败后程序化聚焦恢复点需要拿到真实 input 元素。 */
	fieldRef?: Ref<HTMLInputElement>;
	invalid?: boolean;
}) {
	const id = useId();
	const hintId = hint ? `${id}-hint` : undefined;
	return (
		<div className="grid gap-1">
			<label htmlFor={id} className="eyebrow">
				{label}
			</label>
			<input
				id={id}
				ref={fieldRef}
				value={value}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
				aria-describedby={hintId}
				aria-invalid={invalid || undefined}
				className="bg-shell border border-line rounded-sm text-ink-hi text-body px-2 py-1 outline-none"
			/>
			{hint ? (
				<p id={hintId} className="m-0 text-[11.5px] leading-[1.6] text-ink-low">
					{hint}
				</p>
			) : null}
		</div>
	);
}

export function Panel({
	title,
	action,
	children,
}: {
	title: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="bg-panel border border-line rounded-md py-3 px-3">
			<header className="flex items-center mb-2">
				<span className="eyebrow">{title}</span>
				{action ? <span className="ml-auto">{action}</span> : null}
			</header>
			{children}
		</section>
	);
}

export function Chip({
	tone = "default",
	children,
}: {
	tone?: "default" | "accent";
	children: ReactNode;
}) {
	const CHIP_TONE: Record<"default" | "accent", string> = {
		default: "border-line text-ink-mid",
		// 现存写死 rgba 迁移保真（MASTER 禁入清单欠账，规整另行提案）
		accent:
			"border-[rgba(208,138,46,0.4)] text-accent-text font-semibold bg-accent-soft",
	};
	return (
		<span
			className={cx(
				"text-[10px] tracking-[0.05em] px-2 py-0.5 rounded-full border",
				CHIP_TONE[tone],
			)}
		>
			{children}
		</span>
	);
}

export type Severity = "blocking" | "warning" | "advisory";
const SEVERITY_LABEL: Record<Severity, string> = {
	blocking: "阻断",
	warning: "警告",
	advisory: "提示",
};

const SEVERITY_TONE: Record<Severity, string> = {
	blocking: "bg-blocking text-white",
	warning:
		"bg-accent-soft text-accent-text border border-[rgba(208,138,46,0.35)]",
	advisory: "bg-transparent text-ink-low border border-line",
};

export function SevBadge({ severity }: { severity: Severity }) {
	return (
		<span
			className={cx(
				"flex-none text-[9px] font-bold py-0.5 px-1 rounded-sm tracking-[0.06em]",
				SEVERITY_TONE[severity],
			)}
		>
			{SEVERITY_LABEL[severity]}
		</span>
	);
}

export type SceneState = "canonical" | "candidate" | "review";

const STATE_TONE: Record<SceneState, string> = {
	canonical: "bg-ok",
	candidate: "bg-accent opacity-60",
	review: "border-[1.5px] border-solid border-ink-low",
};

export function StatusDot({ state }: { state: SceneState }) {
	return (
		<span
			className={cx(
				"w-1.5 h-1.5 rounded-full flex-none inline-block",
				STATE_TONE[state],
			)}
		/>
	);
}

export function NavItem({
	icon,
	label,
	count,
	active,
	onClick,
	navIndicatorKey,
}: {
	icon?: ReactNode;
	label: string;
	count?: number;
	active?: boolean;
	onClick?: () => void;
	/** 活动指示条共享 layoutId（WF3-06⑥）：传入后活动底色改为跨项滑动的指示条。 */
	navIndicatorKey?: string;
}) {
	return (
		<button
			type="button"
			aria-current={active ? "page" : undefined}
			className={cx(
				"ui-plain relative flex min-h-8 items-center w-full text-left cursor-pointer text-[12.5px] py-2 px-2 rounded-sm font-[inherit] border-none",
				active ? "text-accent-text font-semibold" : "text-ink-mid",
			)}
			onClick={onClick}
		>
			{active && navIndicatorKey ? (
				<motion.span
					aria-hidden
					layoutId={navIndicatorKey}
					transition={navIndicatorTransition}
					className="absolute inset-0 rounded-sm bg-rail-active z-0"
				/>
			) : null}
			{active ? (
				<motion.span
					aria-hidden
					layoutId={`${navIndicatorKey}-bar`}
					transition={navIndicatorTransition}
					className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.75 rounded-r-[2px] bg-accent z-0"
				/>
			) : null}
			<span className="relative z-1 flex items-center gap-2 w-full min-w-0">
				{icon ? (
					<span aria-hidden className="flex-none w-4 text-center">
						{icon}
					</span>
				) : null}
				<span className="min-w-0 overflow-hidden text-ellipsis">{label}</span>
				{count !== undefined ? (
					<span className="num ml-auto text-[10px] text-ink-low">{count}</span>
				) : null}
			</span>
		</button>
	);
}

export function EmptyState({
	as: Heading = "h2",
	glyph,
	title,
	hint,
	actions,
}: {
	/** 默认承接页面 h1；嵌入已有 h2 分区时调用方显式传 h3。 */
	as?: "h2" | "h3";
	/** Legacy semantic key; displayed as a decorative SVG icon. */
	glyph?: string;
	title: string;
	hint: string;
	actions?: ReactNode;
}) {
	return (
		<div className="border-[1.5px] border-dashed border-line rounded-lg py-8 px-6 text-center">
			{glyph ? (
				<div className="mx-auto grid size-14 place-items-center rounded-lg border border-line bg-accent-soft text-accent">
					<GlyphIcon glyph={glyph} />
				</div>
			) : null}
			<Heading
				className={cx("text-[13.5px]", glyph ? "mt-2 mb-1" : "m-0 mb-1")}
			>
				{title}
			</Heading>
			<p className="text-[11.5px] text-ink-low leading-[1.7] max-w-[40ch] mx-auto mb-3">
				{hint}
			</p>
			{actions ? (
				<div className="flex gap-2 justify-center">{actions}</div>
			) : null}
		</div>
	);
}

export function FoldButton({
	direction,
	label,
	onClick,
}: {
	direction: "left" | "right";
	/** 纯图标控件必须有可读名（MASTER §4 / WF3-10）。 */
	label: string;
	onClick?: () => void;
}) {
	const FOLD_SIDE: Record<"left" | "right", string> = {
		left: "border-l-0 rounded-r-[6px]",
		right: "border-r-0 rounded-l-[6px]",
	};
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className={cx(
				"hitpad w-4.5 h-13 bg-rail border border-line text-ink-low cursor-pointer text-[10px] grid place-items-center",
				FOLD_SIDE[direction],
			)}
		>
			{direction === "left" ? (
				<ChevronLeft size={12} strokeWidth={2} />
			) : (
				<ChevronRight size={12} strokeWidth={2} />
			)}
		</button>
	);
}

/**
 * 就近反馈注记（WF3-10 ⑥）：表单/动作错误渲染在触发点附近而非页面顶部；
 * 错误走 role=alert（立即播报），状态类提示走 role=status（礼貌播报）。
 */
export function InlineNote({
	tone = "danger",
	children,
}: {
	tone?: "danger" | "success";
	children: ReactNode;
}) {
	const NOTE_TONE: Record<"danger" | "success", string> = {
		danger: "text-danger font-semibold",
		success: "text-accent-text",
	};
	return (
		<p
			role={tone === "danger" ? "alert" : "status"}
			className={cx("m-0 text-[11.5px] leading-[1.6]", NOTE_TONE[tone])}
		>
			{children}
		</p>
	);
}
