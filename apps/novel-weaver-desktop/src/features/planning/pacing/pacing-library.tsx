import { Plus, ChevronUp } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { authorErrorMessage, queryProject } from "../../../shared/api/rpc";
import {
	Button,
	Chip,
	EmptyState,
	PAGE,
	Panel,
	TextField,
} from "../../../shared/ui/components";
import { EMPTY } from "../../../shared/ui/copy";
import { cx } from "../../../shared/ui/cx";
import { cardWallContainerVariants, cardWallItemVariants } from "../../../shared/ui/motion";
import {
	describeRpcError,
	ErrorState,
	SkeletonLines,
	useDelayedFlag,
} from "../../../shared/ui/states";
import {
	BEAT_KIND_LABEL,
	GENRE_FILTERS,
	OFFICIAL_TEMPLATES,
	type PacingBeat,
	type PacingTemplate,
} from "./templates";

interface PlanningGraphNode {
	id: string;
	versionId: string;
	kind: string;
	title: string;
	content: Record<string, unknown>;
}

function beatsOf(content: Record<string, unknown>): PacingBeat[] {
	const raw = content.beats;
	if (!Array.isArray(raw)) return [];
	return raw
		.map((item) => {
			const beat = item as Partial<PacingBeat>;
			if (
				(beat.kind === "hook" ||
					beat.kind === "build" ||
					beat.kind === "payoff") &&
				typeof beat.position === "number" &&
				typeof beat.intensity === "number"
			)
				return {
					kind: beat.kind,
					position: beat.position,
					intensity: beat.intensity,
				};
			return null;
		})
		.filter((beat): beat is PacingBeat => beat !== null);
}

function BeatChips({ beats }: { beats: PacingBeat[] }) {
	return (
		<div className="flex flex-wrap gap-1 mt-2">
			{beats.map((beat) => (
				<Chip key={`${beat.kind}-${beat.position}-${beat.intensity}`}>
					{`${BEAT_KIND_LABEL[beat.kind]}@${beat.position}% · 强度${beat.intensity}`}
				</Chip>
			))}
			{beats.length === 0 ? (
				<span className="text-[10px] text-ink-low">未标注节拍</span>
			) : null}
		</div>
	);
}

/** 爽点模板库（WF2-16）：官方精编＋用户自建（pacing_template 工件），应用到章节走提案链。 */
export function PacingLibrary({ cwd }: { cwd: string }) {
	const [error, setError] = useState("");
	const [note, setNote] = useState("");
	const [genre, setGenre] = useState<string>("全部");
	const [graphNodes, setGraphNodes] = useState<PlanningGraphNode[]>([]);
	const [applyTarget, setApplyTarget] = useState<{
		templateId: string;
		chapterId: string;
	} | null>(null);
	const [creating, setCreating] = useState(false);
	const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
	const showSkeleton = useDelayedFlag(phase === "loading");
	const [loadError, setLoadError] = useState<ReturnType<
		typeof describeRpcError
	> | null>(null);
	const [form, setForm] = useState({
		name: "",
		genre: "通用",
		applicable: "",
		beatsText: "hook@10x2\nbuild@45x3\npayoff@80x5",
	});

	const retryLoad = useCallback(async () => {
		setLoadError(null);
		try {
			const graph = await queryProject<{ nodes: PlanningGraphNode[] }>(
				cwd,
				"planning_graph_query",
				{},
			);
			setGraphNodes(graph.nodes);
			setPhase("ready");
		} catch (raw) {
			setLoadError(describeRpcError(raw));
			setPhase("failed");
		}
	}, [cwd]);

	useEffect(() => {
		void retryLoad();
	}, [retryLoad]);

	const userTemplates = useMemo(
		() =>
			graphNodes
				.filter((node) => node.kind === "pacing_template")
				.map((node) => ({
					id: node.id,
					name: node.title,
					genre:
						typeof node.content.genre === "string"
							? node.content.genre
							: "通用",
					applicable:
						typeof node.content.applicable === "string"
							? node.content.applicable
							: "",
					beats: beatsOf(node.content),
				})),
		[graphNodes],
	);

	const chapters = useMemo(
		() => graphNodes.filter((node) => node.kind === "chapter_plan"),
		[graphNodes],
	);

	const genres = useMemo(() => {
		const pool = new Set<string>(GENRE_FILTERS);
		for (const template of userTemplates) pool.add(template.genre);
		return [...pool];
	}, [userTemplates]);

	const matches = (templateGenre: string) =>
		genre === "全部" || templateGenre === genre || templateGenre === "通用";

	const parseBeats = (text: string): PacingBeat[] =>
		text
			.split(/\n+/)
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const match = line.match(/^(hook|build|payoff)@(\d{1,3})x([1-5])$/i);
				if (!match) return null;
				return {
					kind: match[1].toLowerCase() as PacingBeat["kind"],
					position: Number(match[2]),
					intensity: Number(match[3]),
				};
			})
			.filter((beat): beat is PacingBeat => beat !== null);

	const applyTemplate = async (template: PacingTemplate, chapterId: string) => {
		const chapter = chapters.find((node) => node.id === chapterId);
		if (!chapter) return;
		try {
			await queryProject(cwd, "create_artifact_proposal", {
				artifactId: chapter.id,
				sourceVersionId: chapter.versionId,
				kind: "chapter_plan",
				title: chapter.title,
				dependencyIds: [],
				content: {
					...chapter.content,
					pacingIntents: template.beats,
				},
			});
			setNote(
				`「${template.name}」已挂到《${chapter.title}》的修订提案——批准后按此节拍生成与校验。`,
			);
			setApplyTarget(null);
			setError("");
		} catch (detail) {
			setError(authorErrorMessage(detail));
		}
	};

	const createTemplate = async () => {
		if (!form.name.trim()) {
			setError("先给模板起个套路名。");
			return;
		}
		const beats = parseBeats(form.beatsText);
		try {
			await queryProject(cwd, "create_artifact_proposal", {
				kind: "pacing_template",
				title: form.name.trim(),
				dependencyIds: [],
				content: {
					genre: form.genre,
					applicable: form.applicable.trim(),
					beats,
				},
			});
			setNote("模板提案已创建，批准后进入「我的模板」。");
			setCreating(false);
			setForm({ ...form, name: "", applicable: "" });
			await retryLoad();
		} catch (detail) {
			setError(authorErrorMessage(detail));
		}
	};

	const renderCard = (template: PacingTemplate, official: boolean) => {
		const applying = applyTarget?.templateId === template.id;
		return (
			<motion.div
				key={template.id}
				variants={cardWallItemVariants}
				whileHover={applying ? undefined : { y: -1 }}
				className={cx(
					"t-fast lift-bordered grid gap-2 content-start rounded-lg px-3 py-3 border border-line",
					official ? "bg-panel" : "bg-paper",
				)}
			>
				<div className="flex items-center gap-2">
					<b className="font-wenkai text-[14px]">{template.name}</b>
					<Chip>{template.genre}</Chip>
					{official ? <Chip tone="accent">官方精编</Chip> : null}
				</div>
				<p className="m-0 text-[12px] leading-[1.75] text-ink-mid">
					{template.applicable || "（未填写适用场景）"}
				</p>
				<BeatChips beats={template.beats} />
				{applying && chapters.length > 0 ? (
					<div className="grid gap-2 mt-1">
						<select
							value={applyTarget.chapterId}
							onChange={(event) =>
								setApplyTarget({
									templateId: template.id,
									chapterId: event.target.value,
								})
							}
							className="bg-shell border border-line rounded-sm text-ink-hi text-[12px] px-2 py-1"
						>
							{chapters.map((chapter) => (
								<option key={chapter.id} value={chapter.id}>
									{chapter.title}
								</option>
							))}
						</select>
						<div className="flex gap-1">
							<Button
								variant="primary"
								onClick={() =>
									void applyTemplate(template, applyTarget.chapterId)
								}
							>
								提交应用提案
							</Button>
							<Button onClick={() => setApplyTarget(null)}>取消</Button>
						</div>
					</div>
				) : chapters.length > 0 ? (
					<div className="mt-1">
						<Button
							onClick={() =>
								setApplyTarget({
									templateId: template.id,
									chapterId: chapters[0]?.id ?? "",
								})
							}
						>
							应用到当前章节…
						</Button>
					</div>
				) : (
					<p className="m-0 text-[10px] text-ink-low">
						先在大纲里建章节计划，再应用节拍。
					</p>
				)}
			</motion.div>
		);
	};

	const officialList = OFFICIAL_TEMPLATES.filter((template) =>
		matches(template.genre),
	);
	const userList = userTemplates.filter((template) => matches(template.genre));

	return (
		<main className={PAGE}>
			<header className="flex items-center gap-3">
				<div>
					<p className="eyebrow">NOVEL WEAVER / PACING</p>
					<h1 className="font-wenkai text-[22px] mt-0.5 mb-0">爽点模板库</h1>
				</div>
				<span className="ml-auto">
					<Button
						variant="primary"
						onClick={() => setCreating((value) => !value)}
					>
						{creating ? <ChevronUp size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
						{creating ? "收起表单" : "新建模板"}
					</Button>
				</span>
			</header>

			{error ? <Chip tone="accent">{error}</Chip> : null}
			{note ? <Chip tone="accent">{note}</Chip> : null}

			{phase === "failed" && loadError ? (
				<ErrorState
					message={loadError.message}
					detail={loadError.detail}
					onRetry={() => void retryLoad()}
				/>
			) : null}

			{phase === "loading" && showSkeleton ? (
				<div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
					<SkeletonLines lines={4} />
					<SkeletonLines lines={4} />
					<SkeletonLines lines={3} />
				</div>
			) : null}

			{phase === "ready" ? (
				<>
					{/* 题材筛选 */}
					<div className="flex flex-wrap gap-1">
						{genres.map((item) => (
							<Chip key={item} tone={genre === item ? "accent" : "default"}>
								<button
									type="button"
									onClick={() => setGenre(item)}
									className="ui-plain inline-flex min-h-7 items-center cursor-pointer text-inherit [font:inherit] tracking-[inherit]"
								>
									{item}
								</button>
							</Chip>
						))}
					</div>

					{creating ? (
						<Panel title="新建节奏范本">
							<div className="grid gap-2">
								<div className="grid grid-cols-[1fr_160px] gap-2">
									<TextField
										label="套路名"
										value={form.name}
										onChange={(next) => setForm({ ...form, name: next })}
										placeholder="如：退婚流开局"
									/>
									<label className="grid gap-1">
										<span className="eyebrow">题材</span>
										<select
											value={form.genre}
											onChange={(event) =>
												setForm({ ...form, genre: event.target.value })
											}
											className="bg-shell border border-line rounded-sm text-ink-hi text-[12px] px-2 py-2"
										>
											{GENRE_FILTERS.filter((item) => item !== "全部").map(
												(item) => (
													<option key={item} value={item}>
														{item}
													</option>
												),
											)}
										</select>
									</label>
								</div>
								<TextField
									label="适用场景描述"
									value={form.applicable}
									onChange={(next) => setForm({ ...form, applicable: next })}
									placeholder="什么时候用这套节拍"
								/>
								<TextField
									label="节拍序列（每行：hook|build|payoff@位置x强度，如 build@45x3）"
									value={form.beatsText}
									onChange={(next) => setForm({ ...form, beatsText: next })}
								/>
								<Button variant="primary" onClick={() => void createTemplate()}>
									提交模板提案（待批准）
								</Button>
							</div>
						</Panel>
					) : null}

					<section className="grid gap-2">
						<p className="eyebrow m-0">官方精编 · {officialList.length}</p>
						<motion.div
							variants={cardWallContainerVariants}
							initial="hidden"
							animate="show"
							className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3"
						>
							{officialList.map((template) => renderCard(template, true))}
						</motion.div>
					</section>

					<section className="grid gap-2">
						<p className="eyebrow m-0">我的模板 · {userList.length}</p>
						{userList.length === 0 ? (
							<EmptyState glyph="pacing"
								as="h2"
								title={EMPTY.pacing.title}
								hint={EMPTY.pacing.hint}
								actions={
									creating ? null : (
										<Button variant="primary" onClick={() => setCreating(true)}>
											<Plus size={14} strokeWidth={1.8} aria-hidden="true" /> {EMPTY.pacing.actionLabel}
										</Button>
									)
								}
							/>
						) : (
							<motion.div
								variants={cardWallContainerVariants}
								initial="hidden"
								animate="show"
								className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3"
							>
								{userList.map((template) => renderCard(template, false))}
							</motion.div>
						)}
					</section>
				</>
			) : null}
		</main>
	);
}
