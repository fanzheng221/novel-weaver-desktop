import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { CoreRpcError, authorErrorMessage } from "../api/rpc";
import { Button } from "./components";
import { cx } from "./cx";

export interface ErrorParts {
	message: string;
	detail: string;
}

/** 错误统一拆解：message 永远是人话，rawDetail 承接 WF3-02 的原始细节。 */
export function describeRpcError(raw: unknown): ErrorParts {
	if (raw instanceof CoreRpcError) {
		return { message: raw.message, detail: raw.rawDetail };
	}
	const message = authorErrorMessage(raw);
	return { message, detail: "" };
}

/**
 * 150ms 延迟闸门（MASTER §5）：近瞬时任务不闪烁加载态。
 * active 为 true 且持续超过阈值才返回 true。
 */
export function useDelayedFlag(active: boolean, thresholdMs = 150): boolean {
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (!active) {
			setVisible(false);
			return;
		}
		const timer = window.setTimeout(() => setVisible(true), thresholdMs);
		return () => window.clearTimeout(timer);
	}, [active, thresholdMs]);
	return visible;
}

/** 骨架块：复用 .sk 扫光（transform 实现，reduced-motion 自动呈静态）。 */
export function Skeleton({
	width = "100%",
	height = 12,
	radius,
}: {
	width?: number | string;
	height?: number;
	radius?: number;
}) {
	return (
		<span
			className="sk block"
			style={{ width, height, borderRadius: radius }}
		/>
	);
}

/** 段落式骨架：宽度递减的若干扫光行，用于列表/文本区域的初载（最多 6 行）。 */
const ROW_NAMES = ["first", "second", "third", "fourth", "fifth", "sixth"];

export function SkeletonLines({
	lines = 3,
	gap = 8,
	lastWidth = "58%",
}: {
	lines?: number;
	gap?: number;
	lastWidth?: number | string;
}) {
	const count = Math.max(1, Math.min(lines, ROW_NAMES.length));
	return (
		<div className="grid" style={{ gap }} aria-busy>
			{ROW_NAMES.slice(0, count).map((name, index) => {
				const last = index === count - 1;
				return (
					<Skeleton
						key={name}
						width={last ? lastWidth : "100%"}
						height={last ? 10 : 12}
					/>
				);
			})}
		</div>
	);
}

const BLOCK_BASE =
	"border border-danger rounded-md grid gap-2 bg-panel py-3 px-3";
const BLOCK_COMPACT = "rounded-md py-2 px-3";

/** 数据区域加载失败：人话标题＋行动＋可展开技术详情（MASTER §5 / WF3-02）。 */
export function ErrorState({
	title = "这次没有加载出来",
	message,
	detail,
	onRetry,
	retryLabel = "重试",
	extraActions,
	compact = false,
}: {
	title?: string;
	message: string;
	detail?: string;
	onRetry?: () => void;
	retryLabel?: string;
	extraActions?: ReactNode;
	compact?: boolean;
}) {
	const technical =
		detail && detail.trim() !== "" && detail !== message ? detail : "";
	return (
		<div
			role="alert"
			className={compact ? `${BLOCK_BASE} ${BLOCK_COMPACT}` : BLOCK_BASE}
		>
			<b className={cx("text-danger", compact ? "text-[12px]" : "text-[13px]")}>
				{title}
			</b>
			<p className="m-0 text-[11.5px] leading-[1.7] text-ink-mid">{message}</p>
			{technical ? (
				<details>
					<summary className="cursor-pointer text-[10.5px] text-ink-low">
						技术详情
					</summary>
					<pre className="num mt-1 p-[8px_10px] text-[10px] leading-[1.6] whitespace-pre-wrap break-all max-h-35 overflow-y-auto bg-shell rounded-sm text-ink-mid">
						{technical}
					</pre>
				</details>
			) : null}
			{onRetry || extraActions ? (
				<div className="flex gap-2">
					{onRetry ? (
						<Button variant="primary" onClick={onRetry}>
							{retryLabel}
						</Button>
					) : null}
					{extraActions}
				</div>
			) : null}
		</div>
	);
}

/** 跳转到工作区路由（EmptyState 下一步动作用；AppShell 以 hash 为路由源）。 */
export function navigateTo(route: string): void {
	window.location.hash = `#/${route}`;
}
