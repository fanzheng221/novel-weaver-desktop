import { useState } from "react";
import { authorErrorMessage, queryProject } from "../../../shared/api/rpc";
import {
	Button,
	Chip,
	EmptyState,
	PAGE,
	Panel,
} from "../../../shared/ui/components";
import { cx } from "../../../shared/ui/cx";
import {
	describeRpcError,
	ErrorState,
	SkeletonLines,
	useDelayedFlag,
} from "../../../shared/ui/states";

interface StyleTraitSourceView {
	label: string;
	locator: string;
}

interface StyleTraitView {
	artifactId: string;
	versionId: string;
	title: string;
	dimension: string;
	description: string;
	sources: StyleTraitSourceView[];
	enabled: boolean;
	updatedAt: string | null;
}

/**
 * 风格特征最小管理面（WF6-02）：看已确认特征、逐条启停、删除。
 * 特征本体经审校收件箱提案链入库（喂书分析提炼归 WF6-03/04）；
 * 启用中的特征以「文风指导」段进入生成上下文（ADR-0025 预算内可解释）。
 * 完整管理面与入口落点归 WF6-05。
 */
export function StyleTraitsPanel({ cwd }: { cwd: string }) {
	const [traits, setTraits] = useState<StyleTraitView[]>([]);
	const [note, setNote] = useState("");
	const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
	const showSkeleton = useDelayedFlag(phase === "loading");
	const [loadError, setLoadError] = useState<ReturnType<
		typeof describeRpcError
	> | null>(null);
	const [actingId, setActingId] = useState<string | null>(null);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

	const retryLoad = async () => {
		setLoadError(null);
		try {
			const rows = await queryProject<StyleTraitView[]>(
				cwd,
				"list_style_traits",
				{},
			);
			setTraits(rows);
			setPhase("ready");
		} catch (raw) {
			setLoadError(describeRpcError(raw));
			setPhase("failed");
		}
	};

	const toggleTrait = async (trait: StyleTraitView) => {
		setActingId(trait.artifactId);
		try {
			await queryProject(cwd, "set_style_trait_enabled", {
				artifactId: trait.artifactId,
				enabled: !trait.enabled,
			});
			setTraits((rows) =>
				rows.map((row) =>
					row.artifactId === trait.artifactId
						? { ...row, enabled: !row.enabled }
						: row,
				),
			);
			setNote(
				trait.enabled
					? `「${trait.title}」已停用，下一次装配不再携带。`
					: `「${trait.title}」已启用，下一次装配以「文风指导」段携带。`,
			);
			setConfirmDeleteId(null);
		} catch (raw) {
			setNote(authorErrorMessage(raw));
		} finally {
			setActingId(null);
		}
	};

	const deleteTrait = async (trait: StyleTraitView) => {
		if (confirmDeleteId !== trait.artifactId) {
			setConfirmDeleteId(trait.artifactId);
			return;
		}
		setActingId(trait.artifactId);
		try {
			await queryProject(cwd, "delete_style_trait", {
				artifactId: trait.artifactId,
			});
			setTraits((rows) =>
				rows.filter((row) => row.artifactId !== trait.artifactId),
			);
			setNote(`「${trait.title}」已删除。`);
			setConfirmDeleteId(null);
		} catch (raw) {
			setNote(authorErrorMessage(raw));
		} finally {
			setActingId(null);
		}
	};

	const enabledCount = traits.filter((trait) => trait.enabled).length;

	return (
		<main className={PAGE}>
			<header>
				<p className="eyebrow">NOVEL WEAVER / STYLE</p>
				<h1 className="font-wenkai text-[22px] mt-0.5 mb-0">风格特征</h1>
				<p className="m-0 text-[12px] leading-[1.75] text-ink-mid">
					{phase === "ready"
						? `${traits.length} 条特征 · 启用 ${enabledCount} 条——启用项以「文风指导」段进入生成上下文。`
						: "确认入库的风格特征在此启停；启用项以「文风指导」段进入生成上下文。"}
				</p>
			</header>

			{note ? <Chip tone="accent">{note}</Chip> : null}

			{phase === "failed" && loadError ? (
				<ErrorState
					message={loadError.message}
					detail={loadError.detail}
					onRetry={() => void retryLoad()}
				/>
			) : null}

			{phase === "loading" && showSkeleton ? <SkeletonLines lines={4} /> : null}

			{phase === "ready" && traits.length === 0 ? (
				<EmptyState
					glyph="style"
					title="还没有风格特征"
					hint="喂书分析与提炼确认后，特征会出现在这里；届时逐条启停即可指导文风。"
				/>
			) : null}

			{phase === "ready" && traits.length > 0 ? (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
					{traits.map((trait) => {
						const deleting = confirmDeleteId === trait.artifactId;
						return (
							<div
								key={trait.artifactId}
								className={cx(
									"lift-bordered grid gap-2 content-start rounded-lg px-3 py-3 border border-line",
									trait.enabled ? "bg-panel" : "bg-paper",
								)}
							>
								<div className="flex items-center gap-2">
									<b className="font-wenkai text-[14px]">{trait.title}</b>
									<Chip>{trait.dimension}</Chip>
									<Chip tone={trait.enabled ? "accent" : "default"}>
										{trait.enabled ? "注入中" : "已停用"}
									</Chip>
								</div>
								<p className="m-0 text-[12px] leading-[1.75] text-ink-mid">
									{trait.description}
								</p>
								{trait.sources.length > 0 ? (
									<details className="text-[11.5px] leading-[1.7] text-ink-low">
										<summary className="cursor-pointer">证据出处</summary>
										<ul className="m-0 pl-4 grid gap-0.5">
											{trait.sources.map((source) => (
												<li key={`${source.label}/${source.locator}`}>
													{source.label} · {source.locator}
												</li>
											))}
										</ul>
									</details>
								) : null}
								<div className="flex gap-1 mt-1">
									<Button
										variant={trait.enabled ? "ghost" : "primary"}
										disabled={actingId === trait.artifactId}
										onClick={() => void toggleTrait(trait)}
									>
										{trait.enabled ? "停用" : "启用"}
									</Button>
									<Button
										variant="ghost"
										disabled={actingId === trait.artifactId}
										onClick={() => void deleteTrait(trait)}
									>
										{deleting ? "确认删除？" : "删除"}
									</Button>
								</div>
							</div>
						);
					})}
				</div>
			) : null}

			{phase === "ready" && traits.length > 0 ? (
				<Panel title="如何新增特征">
					<p className="m-0 text-[12px] leading-[1.75] text-ink-mid">
						导入参考作品并跑分析（规划区后续提供入口），或在审校收件箱批准
						风格特征提案；本页负责批准后的启停与清理。
					</p>
				</Panel>
			) : null}
		</main>
	);
}
