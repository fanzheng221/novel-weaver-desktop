import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

/**
 * 工作区全局状态（WF2-01）：顶栏/底栏槽位、右侧面板开合与宽度、专注模式。
 * 页面经 useWorkspace 把局部事实上报给壳（编辑器报章节字数、工作台报生成灯），
 * 壳只渲染槽位，不拥有业务数据；真实数据源由 WF2-09/WF2-10/WF2-12 接管。
 */

export type GenerationPhase = "idle" | "running" | "error";
export type SaveState = "idle" | "saving" | "saved" | "error";

export interface ChapterRef {
	id: string;
	title: string;
}

/** 本场简报（WF5-06）：写作区选中场景的规划事实摘要，仅供右面板投影。 */
export interface SceneBriefingInfo {
	sceneTitle: string;
	storyOrder: number;
	/** canonical=已成正文；planned=仅有计划待写。 */
	state: "canonical" | "planned";
	/** 正典场景 id；纯计划行（未写成）为 null——影响投影只对正典事实生效。 */
	sceneId: string | null;
	/** 计划目的（本场任务）；未挂计划为 null。 */
	purpose: string | null;
	chapterLabel: string | null;
	volumeLabel: string | null;
	/** 存在与基线一致的本地草稿待提交。 */
	draftPending: boolean;
}

interface WorkspaceValue {
	projectName: string;
	currentChapter: ChapterRef | null;
	chapterWords: number | null;
	chapterTarget: number | null;
	projectWords: number | null;
	savedAt: number | null;
	saveState: SaveState;
	generation: GenerationPhase;
	/** 正文面当前快照：质量报告体检与定位的数据源。 */
	proseText: string;
	proseLabel: string;
	proseSceneId: string | null;
	/** 正文快照的正典基线版本与来源（WF5-09 双稿 stale 判定）；无正文为 null。 */
	proseVersionId: string | null;
	proseKind: "draft" | "canonical" | null;
	/** 正典场景总数（WF5-03）：null=尚未盘点；0=零场景冷启动，AI 主操作不设场景门禁。 */
	sceneCount: number | null;
	/** 本场简报（WF5-06）：写作区上报的选中场景规划事实；未选中为 null。 */
	sceneBriefing: SceneBriefingInfo | null;
	/** 右面板活动 Tab（可跨组件切换，如版本历史→生成设置）。 */
	panelActiveTab: string | null;
	/** 定位高亮请求：ProseEditor 监听并滚动+闪烁对应段落锚点。 */
	proseHighlight: { anchor: string; nonce: number } | null;
	panelOpen: boolean;
	panelWidth: number;
	/** 覆盖式 AI 助手抽屉（WF5-07）：写作态经顶栏窄入口开合。 */
	assistantOpen: boolean;
	focusMode: boolean;
	setProjectName: (name: string) => void;
	setCurrentChapter: (chapter: ChapterRef | null) => void;
	reportChapterProgress: (words: number, target: number | null) => void;
	reportProjectWords: (words: number | null) => void;
	reportSaved: () => void;
	reportSaveState: (state: SaveState) => void;
	reportProseSnapshot: (
		text: string,
		label: string,
		sceneId: string | null,
		meta?: { versionId: string | null; kind: "draft" | "canonical" | null },
	) => void;
	reportSceneInventory: (count: number) => void;
	reportSceneBriefing: (info: SceneBriefingInfo | null) => void;
	requestProseHighlight: (anchor: string) => void;
	setPanelActiveTab: (key: string | null) => void;
	reportGeneration: (phase: GenerationPhase) => void;
	togglePanel: () => void;
	setPanelWidth: (width: number) => void;
	setAssistantOpen: (open: boolean) => void;
	toggleFocus: () => void;
}

const PANEL_WIDTH_KEY = "nw-right-panel-w";
export const PANEL_WIDTH_MIN = 280;
export const PANEL_WIDTH_MAX = 520;

export function clampPanelWidth(width: number): number {
	return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, width));
}

function initialPanelWidth(): number {
	try {
		const raw = localStorage.getItem(PANEL_WIDTH_KEY);
		if (raw) return clampPanelWidth(Number(raw));
	} catch {
		/* 隐私模式等场景降级为默认宽 */
	}
	return 336;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
	const [projectName, setProjectName] = useState("");
	const [currentChapter, setCurrentChapter] = useState<ChapterRef | null>(null);
	const [chapterWords, setChapterWords] = useState<number | null>(null);
	const [chapterTarget, setChapterTarget] = useState<number | null>(null);
	const [projectWords, setProjectWords] = useState<number | null>(null);
	const [savedAt, setSavedAt] = useState<number | null>(null);
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [proseText, setProseText] = useState("");
	const [proseLabel, setProseLabel] = useState("");
	const [proseSceneId, setProseSceneId] = useState<string | null>(null);
	const [proseVersionId, setProseVersionId] = useState<string | null>(null);
	const [proseKind, setProseKind] = useState<"draft" | "canonical" | null>(
		null,
	);
	const [sceneCount, setSceneCount] = useState<number | null>(null);
	const [sceneBriefing, setSceneBriefing] = useState<SceneBriefingInfo | null>(
		null,
	);
	const [panelActiveTab, setPanelActiveTab] = useState<string | null>(null);
	const [proseHighlight, setProseHighlight] = useState<{
		anchor: string;
		nonce: number;
	} | null>(null);
	const [generation, setGeneration] = useState<GenerationPhase>("idle");
	const [panelOpen, setPanelOpen] = useState(false);
	const [panelWidth, setPanelWidthState] = useState(initialPanelWidth);
	const [assistantOpen, setAssistantOpenState] = useState(false);
	const [focusMode, setFocusMode] = useState(false);

	const setAssistantOpen = useCallback((open: boolean) => {
		setAssistantOpenState(open);
	}, []);

	const setPanelWidth = useCallback((width: number) => {
		const next = clampPanelWidth(width);
		setPanelWidthState(next);
		try {
			localStorage.setItem(PANEL_WIDTH_KEY, String(next));
		} catch {
			/* 宽度仅会话内生效 */
		}
	}, []);

	const togglePanel = useCallback(() => setPanelOpen((open) => !open), []);
	const toggleFocus = useCallback(() => setFocusMode((on) => !on), []);
	const reportSaved = useCallback(() => {
		setSavedAt(Date.now());
		setSaveState("saved");
	}, []);
	const reportSaveState = useCallback((state: SaveState) => {
		setSaveState(state);
		if (state === "saved") setSavedAt(Date.now());
	}, []);
	const reportProseSnapshot = useCallback(
		(
			text: string,
			label: string,
			sceneId: string | null,
			meta?: { versionId: string | null; kind: "draft" | "canonical" | null },
		) => {
			setProseText(text);
			setProseLabel(label);
			setProseSceneId(sceneId);
			setProseVersionId(meta?.versionId ?? null);
			setProseKind(meta?.kind ?? null);
		},
		[],
	);
	const requestProseHighlight = useCallback((anchor: string) => {
		setProseHighlight({ anchor, nonce: Date.now() });
	}, []);
	const reportSceneInventory = useCallback(
		(count: number) => setSceneCount(count),
		[],
	);
	const reportSceneBriefing = useCallback(
		(info: SceneBriefingInfo | null) => setSceneBriefing(info),
		[],
	);
	const reportChapterProgress = useCallback(
		(words: number, target: number | null) => {
			setChapterWords(words);
			setChapterTarget(target);
		},
		[],
	);
	const reportProjectWords = useCallback(
		(words: number | null) => setProjectWords(words),
		[],
	);

	const value = useMemo<WorkspaceValue>(
		() => ({
			projectName,
			currentChapter,
			chapterWords,
			chapterTarget,
			projectWords,
			savedAt,
			saveState,
			generation,
			proseText,
			proseLabel,
			proseSceneId,
			proseVersionId,
			proseKind,
			sceneCount,
			sceneBriefing,
			panelActiveTab,
			proseHighlight,
			panelOpen,
			panelWidth,
			assistantOpen,
			focusMode,
			setProjectName,
			setCurrentChapter,
			reportChapterProgress,
			reportProjectWords,
			reportSaved,
			reportSaveState,
			reportProseSnapshot,
			reportSceneInventory,
			reportSceneBriefing,
			requestProseHighlight,
			setPanelActiveTab,
			reportGeneration: setGeneration,
			togglePanel,
			setPanelWidth,
			setAssistantOpen,
			toggleFocus,
		}),
		[
			projectName,
			currentChapter,
			chapterWords,
			chapterTarget,
			projectWords,
			savedAt,
			saveState,
			generation,
			proseText,
			proseLabel,
			proseSceneId,
			proseVersionId,
			proseKind,
			sceneCount,
			sceneBriefing,
			panelActiveTab,
			proseHighlight,
			panelOpen,
			panelWidth,
			assistantOpen,
			focusMode,
			reportChapterProgress,
			reportProjectWords,
			reportSaved,
			reportSaveState,
			reportProseSnapshot,
			reportSceneInventory,
			reportSceneBriefing,
			requestProseHighlight,
			setPanelWidth,
			setAssistantOpen,
			togglePanel,
			toggleFocus,
		],
	);

	return (
		<WorkspaceContext.Provider value={value}>
			{children}
		</WorkspaceContext.Provider>
	);
}

export function useWorkspace(): WorkspaceValue {
	const value = useContext(WorkspaceContext);
	if (!value) throw new Error("useWorkspace 必须在 WorkspaceProvider 内使用");
	return value;
}
