import { useCallback, useEffect, useState } from "react";
import { queryProject } from "../../shared/api/rpc";
import { Panel } from "../../shared/ui/components";
import { cx } from "../../shared/ui/cx";
import {
	type ImpactSubjectKind,
	navigateToImpactTarget,
	type ReferenceEdgeShape,
} from "../../shared/ui/deep-link";
import {
	describeRpcError,
	ErrorState,
	SkeletonLines,
	useDelayedFlag,
} from "../../shared/ui/states";

/**
 * 引用与影响插槽（WF5-14）：任一详情都提供「被什么引用 / 会影响什么」。
 * 数据来自核心 `reference_impact_query` 投影（RPC v5，只读派生），
 * 组件只在挂载/换主体时查询一次，不在渲染路径里扫全项目。
 * 引用边可深链回目标对象；「会影响」里的过期候选如实标注失效语义。
 */

export interface ImpactSubject {
	kind: ImpactSubjectKind;
	id: string;
	/** 展示用名称；核心报告会回填权威标题，这里只在报错时兜底。 */
	title?: string;
}

interface ImpactReport {
	subject: { kind: string; id: string; title: string };
	referencedBy: ReferenceEdgeShape[];
	affects: ReferenceEdgeShape[];
}

const STALE_BADGE_ALREADY =
	"flex-none text-[10px] leading-[1.7] border rounded-full px-1.5 border-danger text-danger";
const STALE_BADGE_ON_CHANGE =
	"flex-none text-[10px] leading-[1.7] border rounded-full px-1.5 border-warning text-warning";

function EdgeRow({ cwd, edge }: { cwd: string; edge: ReferenceEdgeShape }) {
	const linkable =
		edge.kind !== "scene_candidate" && edge.kind !== "design_change";
	return (
		<li className="grid gap-0.5">
			{linkable ? (
				<button
					type="button"
					className="ui-plain cursor-pointer text-left text-[12px] text-accent-text font-[inherit] hover:underline w-fit"
					onClick={() => navigateToImpactTarget(cwd, edge)}
					title={`前往「${edge.title}」`}
				>
					{edge.title}
				</button>
			) : (
				<span className="text-[12px] text-ink-hi">{edge.title}</span>
			)}
			<span className="text-[11.5px] leading-[1.7] text-ink-mid flex items-center gap-1.5 flex-wrap">
				{edge.stale === "already" ? (
					<span className={STALE_BADGE_ALREADY}>已过期</span>
				) : null}
				{edge.stale === "on_change" ? (
					<span className={STALE_BADGE_ON_CHANGE}>改动后需复核</span>
				) : null}
				{edge.reason}
			</span>
			<span className="text-[10.5px] text-ink-low">{edge.location}</span>
		</li>
	);
}

function EdgeSection({
	cwd,
	label,
	edges,
	emptyHint,
}: {
	cwd: string;
	label: string;
	edges: ReferenceEdgeShape[];
	emptyHint: string;
}) {
	return (
		<div className="grid gap-1">
			<span className="text-[10.5px] tracking-[0.16em] text-ink-low font-semibold">
				{label}
			</span>
			{edges.length === 0 ? (
				<p className="m-0 text-[11.5px] leading-[1.8] text-ink-low">
					{emptyHint}
				</p>
			) : (
				<ul className="m-0 pl-0 grid gap-2 list-none p-0">
					{edges.map((edge) => (
						<EdgeRow key={`${edge.kind}:${edge.id}`} cwd={cwd} edge={edge} />
					))}
				</ul>
			)}
		</div>
	);
}

export function ImpactSlot({
	cwd,
	subject,
	embedded = false,
}: {
	cwd: string;
	subject: ImpactSubject;
	/** true 时以纯内容嵌在已有面板内（如规则卡的「查看影响」展开），不再套 Panel。 */
	embedded?: boolean;
}) {
	const [report, setReport] = useState<ImpactReport | null>(null);
	const [error, setError] = useState<ReturnType<
		typeof describeRpcError
	> | null>(null);
	const showSkeleton = useDelayedFlag(report === null && error === null);

	const load = useCallback(() => {
		const cancelled = false;
		setReport(null);
		setError(null);
		queryProject<ImpactReport>(cwd, "reference_impact_query", {
			kind: subject.kind,
			id: subject.id,
		}).then(
			(next) => {
				if (!cancelled) setReport(next);
			},
			(raw) => {
				if (!cancelled) setError(describeRpcError(raw));
			},
		);
	}, [cwd, subject.kind, subject.id]);

	useEffect(() => load(), [load]);

	const retry = useCallback(() => {
		load();
	}, [load]);
	const subjectLabel = report?.subject.title ?? subject.title ?? "该对象";

	if (error) {
		const errorBody = (
			<ErrorState
				compact
				message={`「${subjectLabel}」的引用梳理没有加载出来。`}
				detail={error.detail}
				onRetry={retry}
			/>
		);
		return embedded ? (
			errorBody
		) : (
			<Panel title="被什么引用 · 会影响什么">{errorBody}</Panel>
		);
	}

	if (!report) {
		const skeleton = showSkeleton ? <SkeletonLines lines={3} /> : null;
		return embedded ? (
			skeleton
		) : (
			<Panel title="被什么引用 · 会影响什么">{skeleton}</Panel>
		);
	}

	const body = (
		<div className={cx("grid gap-3 text-[12px] leading-[1.8]")}>
			<EdgeSection
				cwd={cwd}
				label="被引用 · 既成事实里哪里用到了它"
				edges={report.referencedBy}
				emptyHint="还没有既成事实引用它。"
			/>
			<EdgeSection
				cwd={cwd}
				label="会影响 · 本次改动会波及的待确认工作"
				edges={report.affects}
				emptyHint="没有待确认工作受它影响。"
			/>
		</div>
	);
	if (embedded) return body;
	return (
		<Panel title={`被什么引用 · 会影响什么（${subjectLabel}）`}>{body}</Panel>
	);
}

/**
 * 缺失投影的详情占位（WF5-11）：人物弧光、认知边界等读模型还没接进来；
 * 按字段如实占位，不伪造数据。
 */
export function DetailSlot({ label, hint }: { label: string; hint: string }) {
	return (
		<div className="grid gap-1 border-t border-line pt-2">
			<span className="text-[10.5px] tracking-[0.16em] text-ink-low font-semibold">
				{label}
			</span>
			<p className="m-0 text-[12px] leading-[1.8] text-ink-low">{hint}</p>
		</div>
	);
}
