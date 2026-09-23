import { WRITING } from "../../../shared/ui/copy";
import { cx } from "../../../shared/ui/cx";
import type { RailChapter, RailScene, SceneDirectory } from "./scene-directory";

/**
 * 写作台左栏（WF5-06）：卷 → 章 → 场景三层定位。
 * 可读性基线（作者已确认）：场景行文字 14px、行高/命中高度 42px；
 * 宽度由 NavResizer 调整，本组件只按 width 渲染。
 * 状态点语义：绿=已成正文、琥珀=有本地草稿待提交、空心环=待写计划。
 */

function SceneRow({
	scene,
	active,
	onSelect,
}: {
	scene: RailScene;
	active: boolean;
	onSelect: (key: string) => void;
}) {
	const planned = scene.kind === "planned";
	return (
		<button
			type="button"
			onClick={() => onSelect(scene.key)}
			aria-current={active ? "true" : undefined}
			className={cx(
				"ui-plain relative grid w-full cursor-pointer grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 font-[inherit]",
				"min-h-10.5 box-border rounded-sm py-1.5 pr-2 pl-2.5",
				"text-[14px] leading-[1.45] text-left whitespace-nowrap",
				active
					? "bg-rail-active font-semibold text-ink-hi"
					: "text-ink-mid hover:text-ink-hi",
			)}
		>
			{active ? (
				<span
					aria-hidden
					className="absolute left-0 top-2 bottom-2 w-0.5 rounded-[2px] bg-accent"
				/>
			) : null}
			<span
				aria-hidden
				className={cx(
					"block h-1.75 w-1.75 justify-self-center rounded-full",
					planned
						? "border-[1.5px] border-solid border-ink-low"
						: scene.hasFreshDraft
							? "bg-accent opacity-70"
							: "bg-ok",
				)}
			/>
			<span className="min-w-0 overflow-hidden text-ellipsis">
				{scene.title}
			</span>
			<span className="num text-[11px] text-ink-low">
				{planned
					? "待写"
					: scene.hasFreshDraft
						? "草稿"
						: `序${scene.storyOrder}`}
			</span>
		</button>
	);
}

function ChapterBlock({
	chapter,
	selectedKey,
	onSelect,
}: {
	chapter: RailChapter;
	selectedKey: string | null;
	onSelect: (key: string) => void;
}) {
	return (
		<div>
			<p
				className={cx(
					"m-0 flex min-h-9.5 items-center gap-2 rounded-sm px-2",
					"text-[13px] font-semibold text-ink-hi",
				)}
			>
				<span className="min-w-0 overflow-hidden text-ellipsis">
					{chapter.label}
				</span>
				<span className="num ml-auto text-[10.5px] font-normal text-ink-low">
					{chapter.scenes.length} 场
				</span>
			</p>
			{chapter.scenes.map((scene) => (
				<SceneRow
					key={scene.key}
					scene={scene}
					active={scene.key === selectedKey}
					onSelect={onSelect}
				/>
			))}
		</div>
	);
}

function VolumeGroup({
	volume,
	selectedKey,
	onSelect,
}: {
	volume: {
		id: string;
		label: string;
		goal: string | null;
		chapters: RailChapter[];
	};
	selectedKey: string | null;
	onSelect: (key: string) => void;
}) {
	return (
		<section aria-label={volume.label}>
			<p className="eyebrow m-0 truncate px-2 pt-1.5 pb-0.5">{volume.label}</p>
			{volume.chapters.map((chapter) => (
				<ChapterBlock
					key={chapter.id ?? chapter.label}
					chapter={chapter}
					selectedKey={selectedKey}
					onSelect={onSelect}
				/>
			))}
		</section>
	);
}

export function SceneRail({
	directory,
	selectedKey,
	onSelect,
}: {
	directory: SceneDirectory;
	selectedKey: string | null;
	onSelect: (key: string) => void;
}) {
	const sceneCount = directory.allScenes.length;
	return (
		<nav
			aria-label={WRITING.railTitle}
			className="sticky top-2 grid content-start gap-0.5 overflow-y-auto bg-rail py-2.5 px-2 max-h-[calc(100dvh-190px)]"
		>
			<p className="m-0 flex min-h-8.5 items-center gap-2 px-2">
				<b className="text-[14px] text-ink-hi">{WRITING.railTitle}</b>
				<span className="num ml-auto text-[11px] text-ink-low">
					{sceneCount} 个场景
				</span>
			</p>
			{sceneCount === 0 ? (
				<p className="m-0 px-2 text-[12px] leading-[1.7] text-ink-mid">
					还没有正典场景——在右侧生成并批准第一个候选。
				</p>
			) : null}
			{directory.volumes.map((volume) => (
				<VolumeGroup
					key={volume.id}
					volume={volume}
					selectedKey={selectedKey}
					onSelect={onSelect}
				/>
			))}
			{directory.freeChapters.map((chapter) => (
				<ChapterBlock
					key={chapter.id ?? chapter.label}
					chapter={chapter}
					selectedKey={selectedKey}
					onSelect={onSelect}
				/>
			))}
			{directory.loose ? (
				<ChapterBlock
					chapter={directory.loose}
					selectedKey={selectedKey}
					onSelect={onSelect}
				/>
			) : null}
		</nav>
	);
}
