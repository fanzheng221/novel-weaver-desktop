import { MotionConfig } from "motion/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { NavResizer } from "../features/writing/writing/nav-resizer";
import {
	clampNavWidth,
	loadNavWidth,
	saveNavWidth,
} from "../features/writing/writing/nav-width";
import { SceneRail } from "../features/writing/writing/scene-rail";
import type { SceneDirectory } from "../features/writing/writing/scene-directory";
// `base.css` imports the product token sheet and Tailwind utilities. Fixtures must
// import this production entry rather than reproduce styles with test-only CSS.
import "../shared/ui/base.css";

const VOLUME_SCENE_ROWS: SceneDirectory["allScenes"] = [
	{
		key: "canonical:s1",
		kind: "canonical",
		sceneId: "s1",
		planId: "p1",
		title: "庭院练武",
		storyOrder: 10,
		proseChars: 812,
		hasFreshDraft: false,
		planPurpose: "建立父子训练张力",
	},
	{
		key: "canonical:s2",
		kind: "canonical",
		sceneId: "s2",
		planId: null,
		title: "战讯至门",
		storyOrder: 20,
		proseChars: 1204,
		hasFreshDraft: true,
		planPurpose: null,
	},
	{
		key: "plan:p3",
		kind: "planned",
		sceneId: null,
		planId: "p3",
		title: "率部突围",
		storyOrder: 40,
		proseChars: null,
		hasFreshDraft: false,
		planPurpose: "突围与代价",
	},
];

const LOOSE_SCENE_ROWS: SceneDirectory["allScenes"] = [
	{
		key: "canonical:s9",
		kind: "canonical",
		sceneId: "s9",
		planId: null,
		title: "雾中来客",
		storyOrder: 5,
		proseChars: 96,
		hasFreshDraft: false,
		planPurpose: null,
	},
];

const DIRECTORY: SceneDirectory = {
	volumes: [
		{
			id: "vol-1",
			label: "第一卷 · 战讯入宅",
			goal: "战讯入宅，暗流涌动",
			chapters: [
				{
					id: "chap-1",
					label: "第 1 章 · 庭院",
					purpose: "训练张力",
					targetWords: 3000,
					scenes: VOLUME_SCENE_ROWS,
				},
			],
		},
	],
	freeChapters: [],
	loose: {
		id: null,
		label: "未分章",
		purpose: null,
		targetWords: null,
		scenes: LOOSE_SCENE_ROWS,
	},
	allScenes: [...VOLUME_SCENE_ROWS, ...LOOSE_SCENE_ROWS],
};

function SceneRailFixture() {
	const [selectedKey, setSelectedKey] = useState<string | null>("canonical:s1");
	const [width, setWidth] = useState(() => loadNavWidth(window.innerWidth));
	const [dragging, setDragging] = useState(false);
	const changeWidth = (next: number) => {
		const clamped = clampNavWidth(next, window.innerWidth);
		setWidth(clamped);
		saveNavWidth(clamped);
	};
	return (
		<main className="min-h-dvh bg-shell p-4">
			<div
				data-testid="rail-grid"
				className={`grid items-start ${dragging ? "select-none" : ""}`}
				style={{ gridTemplateColumns: `${width}px 6px minmax(0,1fr)` }}
			>
				<SceneRail
					directory={DIRECTORY}
					selectedKey={selectedKey}
					onSelect={setSelectedKey}
				/>
				<NavResizer
					width={width}
					viewportWidth={window.innerWidth}
					onChange={changeWidth}
					onDraggingChange={setDragging}
				/>
				<section aria-label="纸面占位" className="pl-3">
					<p data-testid="selected-key" className="m-0 text-[12px]">
						{selectedKey ?? "none"}
					</p>
					<p data-testid="rail-width" className="num m-0 text-[12px]">
						{width}
					</p>
					<p className="select-text m-0 text-[12px]">可选中正文占位</p>
				</section>
			</div>
		</main>
	);
}

const root = document.getElementById("fixture-root");
if (!root) throw new Error("Fixture mount point is missing.");

createRoot(root).render(
	<MotionConfig reducedMotion="always">
		<SceneRailFixture />
	</MotionConfig>,
);
