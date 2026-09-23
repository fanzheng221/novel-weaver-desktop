import { useCallback, useEffect, useMemo, useState } from "react";
import { queryProject } from "../../../shared/api/rpc";
import { Button, Chip, EmptyState, Panel } from "../../../shared/ui/components";
import { EMPTY } from "../../../shared/ui/copy";
import {
	describeRpcError,
	ErrorState,
	navigateTo,
	SkeletonLines,
	useDelayedFlag,
} from "../../../shared/ui/states";

interface UsageLogEntry {
	id: string;
	createdAt: string;
	taskType: string;
	providerId: string;
	modelId: string;
	promptTokens: number;
	completionTokens: number;
}

interface ModelPrice {
	prompt: number;
	completion: number;
}

/** 价格表：应用层手工维护（元 / 百万 tokens），不落项目库。 */
const PRICES_KEY = "nw-model-prices";

function loadPrices(): Record<string, ModelPrice> {
	try {
		return JSON.parse(localStorage.getItem(PRICES_KEY) ?? "{}");
	} catch {
		return {};
	}
}

function dayKey(iso: string): string {
	return iso.slice(0, 10);
}

/** 近 N 天逐日费用（元）；无价格模型计入未覆盖提示。 */
function dailyCosts(
	entries: UsageLogEntry[],
	prices: Record<string, ModelPrice>,
	days: number,
): {
	series: Array<{ day: string; cost: number }>;
	totalCost: number;
	totalTokens: number;
	unpricedModels: Set<string>;
} {
	const today = new Date();
	const series: Array<{ day: string; cost: number }> = [];
	const index = new Map<string, number>();
	for (let offset = days - 1; offset >= 0; offset -= 1) {
		const date = new Date(today);
		date.setDate(date.getDate() - offset);
		const key = date.toISOString().slice(0, 10);
		index.set(key, series.length);
		series.push({ day: key.slice(5), cost: 0 });
	}
	let totalCost = 0;
	let totalTokens = 0;
	const unpricedModels = new Set<string>();
	for (const entry of entries) {
		totalTokens += entry.promptTokens + entry.completionTokens;
		const price = prices[entry.modelId];
		if (!price || (price.prompt === 0 && price.completion === 0)) {
			if (!price) unpricedModels.add(entry.modelId);
			continue;
		}
		const cost =
			(entry.promptTokens / 1_000_000) * price.prompt +
			(entry.completionTokens / 1_000_000) * price.completion;
		totalCost += cost;
		const slot = index.get(dayKey(entry.createdAt));
		if (slot !== undefined) {
			series[slot].cost += cost;
		}
	}
	return { series, totalCost, totalTokens, unpricedModels };
}

/** 用量与费用曲线（WF2-17）：SVG 手绘柱状图，轻量离线。 */
export function UsagePanel({ cwd }: { cwd: string }) {
	const [entries, setEntries] = useState<UsageLogEntry[]>([]);
	const [prices, setPrices] = useState<Record<string, ModelPrice>>(loadPrices);
	const [error, setError] = useState("");
	const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
	const showSkeleton = useDelayedFlag(phase === "loading");
	const [loadError, setLoadError] = useState<ReturnType<
		typeof describeRpcError
	> | null>(null);

	const retryLoad = useCallback(async () => {
		setLoadError(null);
		try {
			setEntries(
				await queryProject<UsageLogEntry[]>(cwd, "list_usage_log", {}),
			);
			setPhase("ready");
		} catch (raw) {
			setLoadError(describeRpcError(raw));
			setPhase("failed");
		}
	}, [cwd]);

	useEffect(() => {
		void retryLoad();
	}, [retryLoad]);

	const modelIds = useMemo(() => {
		const set = new Set<string>();
		for (const entry of entries) set.add(entry.modelId);
		for (const modelId of Object.keys(prices)) set.add(modelId);
		return [...set].sort();
	}, [entries, prices]);

	const stats = useMemo(
		() => dailyCosts(entries, prices, 14),
		[entries, prices],
	);

	const maxCost = Math.max(...stats.series.map((point) => point.cost), 0.0001);

	const updatePrice = (
		modelId: string,
		field: keyof ModelPrice,
		value: string,
	) => {
		const next = {
			...prices,
			[modelId]: { ...prices[modelId], [field]: Number(value) || 0 },
		};
		setPrices(next);
	};

	const persistPrices = () => {
		try {
			localStorage.setItem(PRICES_KEY, JSON.stringify(prices));
			setNote("价格表已保存到本机。");
		} catch {
			setError("价格表保存失败（存储不可用）。");
		}
	};

	const [note, setNote] = useState("");

	return (
		<Panel title="用量与费用">
			{error ? <Chip tone="accent">{error}</Chip> : null}
			{note ? <Chip tone="accent">{note}</Chip> : null}

			{phase === "failed" && loadError ? (
				<ErrorState
					compact
					message={loadError.message}
					detail={loadError.detail}
					onRetry={() => void retryLoad()}
				/>
			) : null}
			{phase === "loading" && showSkeleton ? <SkeletonLines lines={3} /> : null}
			{phase === "ready" && entries.length === 0 ? (
				<EmptyState glyph="usage"
					as="h2"
					title={EMPTY.usage.title}
					hint={EMPTY.usage.hint}
					actions={
						<Button onClick={() => navigateTo("studio")}>
							{EMPTY.usage.actionLabel}
						</Button>
					}
				/>
			) : null}
			<p className="text-[11.5px] text-ink-mid mt-1 mb-2 leading-[1.8]">
				台账按项目落库：每本书各自统计。近 14 天共{" "}
				<b className="num text-ink-hi">{stats.totalTokens.toLocaleString()}</b>{" "}
				tokens · 约{" "}
				<b className="num text-accent-text">¥{stats.totalCost.toFixed(2)}</b>
				{stats.unpricedModels.size > 0
					? `；未填价格的模型不计费：${[...stats.unpricedModels].join("、")}`
					: ""}
			</p>

			{/* 费用曲线：近 14 天 */}
			<div className="border border-line rounded-md pt-2 px-2 pb-1 mb-3">
				<svg
					viewBox="0 0 560 150"
					role="img"
					aria-label="近十四天费用曲线"
					className="block w-full"
				>
					{stats.series.map((point, index) => {
						const barWidth = 18;
						const gap = (560 - 14 * barWidth) / 15;
						const x = gap + index * (barWidth + gap);
						const height = Math.max(1, (point.cost / maxCost) * 110);
						return (
							<g key={point.day}>
								<rect
									x={x}
									y={128 - height}
									width={barWidth}
									height={height}
									rx={3}
									fill={point.cost > 0 ? "var(--accent)" : "var(--line)"}
									opacity={point.cost > 0 ? 0.85 : 0.6}
								/>
								<title>{`${point.day}：¥${point.cost.toFixed(3)}`}</title>
								<text
									x={x + barWidth / 2}
									y={144}
									textAnchor="middle"
									fontSize={8.5}
									fill="var(--ink-low)"
								>
									{index % 2 === 0 ? point.day : ""}
								</text>
							</g>
						);
					})}
				</svg>
			</div>

			{/* 价格表（可编辑） */}
			<p className="eyebrow mt-0 mb-1">价格表（元 / 百万 tokens）</p>
			{modelIds.length === 0 ? (
				<p className="m-0 text-[11.5px] text-ink-low">
					还没有用量记录——生成第一个场景后这里会出现模型与曲线。
				</p>
			) : (
				<div className="grid gap-1">
					{modelIds.map((modelId) => (
						<div
							key={modelId}
							className="grid grid-cols-[1fr_90px_90px] gap-2 items-center"
						>
							<span
								className="num text-[11px] text-ink-mid overflow-hidden text-ellipsis whitespace-nowrap"
								title={modelId}
							>
								{modelId}
							</span>
							<input
								type="number"
								step="0.01"
								min="0"
								value={prices[modelId]?.prompt ?? 0}
								onChange={(event) =>
									updatePrice(modelId, "prompt", event.target.value)
								}
								placeholder="输入价"
								className="bg-shell border border-line rounded-sm text-ink-hi text-[11.5px] px-2 py-1"
							/>
							<input
								type="number"
								step="0.01"
								min="0"
								value={prices[modelId]?.completion ?? 0}
								onChange={(event) =>
									updatePrice(modelId, "completion", event.target.value)
								}
								placeholder="输出价"
								className="bg-shell border border-line rounded-sm text-ink-hi text-[11.5px] px-2 py-1"
							/>
						</div>
					))}
					<div>
						<Button onClick={persistPrices}>保存价格表</Button>
					</div>
				</div>
			)}
		</Panel>
	);
}
