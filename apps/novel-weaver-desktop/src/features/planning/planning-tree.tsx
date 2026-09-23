import type { ReactNode } from "react";
import { Chip } from "../../shared/ui/components";
import { cx } from "../../shared/ui/cx";
import {
	PHASE_LABEL,
	type PhaseKey,
	type PlanningNode,
	type PlanningTreeModel,
	type TreeChapter,
	type TreeScene,
} from "./planning-model";

/** 阶段色点：动态色值 → 静态类映射（WF3-07），从 OutlineBoard 迁入。 */
const PHASE_DOT_TONE: Record<PhaseKey, string> = {
	unwritten: "border-[1.5px] border-solid border-ink-low",
	generating: "bg-accent",
	review: "bg-accent border-[1.5px] border-solid border-accent",
	final: "bg-ok",
};

export function PhaseDot({ phase }: { phase: PhaseKey }) {
	return (
		<span
			title={PHASE_LABEL[phase]}
			className={cx(
				"w-2 h-2 rounded-full flex-none inline-block",
				PHASE_DOT_TONE[phase],
			)}
		/>
	);
}

function TreeRow({
	node,
	indent,
	active,
	marker,
	meta,
	onClick,
}: {
	node: PlanningNode;
	indent: number;
	active: boolean;
	marker?: ReactNode;
	meta?: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-current={active ? "true" : undefined}
			className={cx(
				"ui-plain cursor-pointer flex min-h-7 items-center gap-2 w-full px-2 py-1 rounded-sm text-[12.5px] text-left font-[inherit]",
				active
					? "text-accent-text bg-accent-soft font-semibold"
					: "text-ink-mid bg-transparent",
			)}
			style={{ paddingLeft: 8 + indent * 16 }}
		>
			{marker}
			<span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
				{node.title}
			</span>
			{meta ? (
				<span className="ml-auto flex items-center gap-1.5 flex-none min-w-0">
					{meta}
				</span>
			) : null}
		</button>
	);
}

function SceneRow({
	scene,
	indent,
	active,
	onOpen,
}: {
	scene: TreeScene;
	indent: number;
	active: boolean;
	onOpen: (node: PlanningNode) => void;
}) {
	return (
		<TreeRow
			node={scene.node}
			indent={indent}
			active={active}
			marker={<span aria-hidden>场</span>}
			meta={
				<>
					{scene.povName ? (
						<span
							title={`视点人物：${scene.povName}`}
							className="text-[10.5px] text-ink-low max-w-18 overflow-hidden text-ellipsis whitespace-nowrap"
						>
							POV · {scene.povName}
						</span>
					) : null}
					{scene.purpose ? (
						<span className="text-[10.5px] text-ink-low max-w-40 overflow-hidden text-ellipsis whitespace-nowrap hidden md:inline">
							{scene.purpose}
						</span>
					) : null}
				</>
			}
			onClick={() => onOpen(scene.node)}
		/>
	);
}

function ChapterMeta({ chapter }: { chapter: TreeChapter }) {
	return (
		<>
			<PhaseDot phase={chapter.phase} />
			<span className="num text-[10.5px] text-ink-low">
				{chapter.row
					? `${chapter.row.confirmedScenes}/${chapter.row.totalScenes} 场景`
					: "无场景"}
			</span>
			{chapter.targetWords !== null ? (
				<span className="num text-[10.5px] text-ink-low hidden md:inline">
					· 目标 {chapter.targetWords.toLocaleString()} 字
				</span>
			) : null}
			{chapter.row?.status === "published" ? (
				<Chip tone="default">已发布</Chip>
			) : null}
		</>
	);
}

/**
 * 树优先规划区（WF5-10）：总纲→卷→章→场景只按投影字段组织；
 * 章＝抽屉编辑，其余节点＝详情面板。
 */
export function PlanningTree({
	model,
	selectedId,
	onOpen,
}: {
	model: PlanningTreeModel;
	selectedId: string | null;
	onOpen: (node: PlanningNode) => void;
}) {
	const scenesOfChapter = (chapter: TreeChapter): TreeScene[] => {
		const ids = new Set(
			Array.isArray(chapter.node.content.sceneIds)
				? chapter.node.content.sceneIds.map(String)
				: [],
		);
		return model.scenes.filter((scene) => ids.has(scene.node.id));
	};

	const renderChapter = (chapter: TreeChapter, indent: number) => (
		<div key={chapter.node.id}>
			<TreeRow
				node={chapter.node}
				indent={indent}
				active={selectedId === chapter.node.id}
				marker={<ChapterMeta chapter={chapter} />}
				onClick={() => onOpen(chapter.node)}
			/>
			{scenesOfChapter(chapter).map((scene) => (
				<SceneRow
					key={scene.node.id}
					scene={scene}
					indent={indent + 1}
					active={selectedId === scene.node.id}
					onOpen={onOpen}
				/>
			))}
		</div>
	);

	return (
		<div className="grid gap-3">
			<div>
				{model.outline ? (
					<div>
						<TreeRow
							node={model.outline}
							indent={0}
							active={selectedId === model.outline.id}
							marker={<span aria-hidden>纲</span>}
							onClick={() => onOpen(model.outline as PlanningNode)}
						/>
					</div>
				) : null}
				{model.volumes.map((volume) => (
					<div key={volume.node.id}>
						<TreeRow
							node={volume.node}
							indent={1}
							active={selectedId === volume.node.id}
							marker={<span aria-hidden>卷</span>}
							meta={
								volume.goal ? (
									<span className="text-[10.5px] text-ink-low max-w-45 overflow-hidden text-ellipsis whitespace-nowrap hidden md:inline">
										{volume.goal}
									</span>
								) : null
							}
							onClick={() => onOpen(volume.node)}
						/>
						{volume.chapters.map((chapter) => renderChapter(chapter, 2))}
					</div>
				))}
				{model.looseChapters.length > 0 ? (
					<>
						<p className="eyebrow mt-2 mb-1 pl-4">未分卷</p>
						{model.looseChapters.map((chapter) => renderChapter(chapter, 1))}
					</>
				) : null}
				{model.unfiledScenes.length > 0 ? (
					<>
						<p className="eyebrow mt-2 mb-1 pl-4">未挂章场景</p>
						{model.unfiledScenes.map((scene) => (
							<SceneRow
								key={scene.node.id}
								scene={scene}
								indent={1}
								active={selectedId === scene.node.id}
								onOpen={onOpen}
							/>
						))}
					</>
				) : null}
			</div>
			{model.others.length > 0 ? (
				<div className="border-t border-line pt-2 grid gap-2">
					<p className="eyebrow m-0">其他规划工件</p>
					{model.others.map((group) => (
						<div key={group.kind}>
							<p className="eyebrow m-0 mb-1">{group.label}</p>
							{group.nodes.map((node) => (
								<TreeRow
									key={node.id}
									node={node}
									indent={0}
									active={selectedId === node.id}
									onClick={() => onOpen(node)}
								/>
							))}
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}
