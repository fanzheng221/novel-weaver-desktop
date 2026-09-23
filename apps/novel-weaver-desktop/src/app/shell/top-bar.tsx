import { Search, Sparkles } from "lucide-react";
import { IconButton } from "../../shared/ui/icons";
import { LicenseButton } from "../../shared/ui/LicenseButton";
import { cx } from "../../shared/ui/cx";
import { type GenerationPhase, useWorkspace } from "../../shared/workspace/context";

/* 生成状态灯语义（WF2-01）：颜色映射到语义 token 类，非写死色值。 */
const LAMP: Record<
	GenerationPhase,
	{ dot: string; label: string; breathe?: boolean }
> = {
	idle: { dot: "bg-ink-low", label: "空闲" },
	running: { dot: "bg-accent", label: "生成中", breathe: true },
	error: { dot: "bg-blocking", label: "失败" },
};

/* 顶栏按钮基线：布局类（无颜色，避免与分支色类同属性冲突）；
   ui-plain（base 层）清掉按钮 UA 样式，tools 类随后正常覆盖。 */
const BAR_BUTTON_LAYOUT =
	"ui-plain inline-flex min-h-7 items-center cursor-pointer text-[11.5px] leading-4 py-1 px-2 rounded-sm border font-[inherit]";

/** 顶栏（WF2-01）：项目名 · 当前章节 · 字数槽位 · 生成状态灯 ＋ AI 入口。 */
export function TopBar({
	panelAvailable,
	aiOnDrawer,
	aiScope = "writing",
	onOpenPalette,
}: {
	panelAvailable: boolean;
	/** 写作态走覆盖式助手抽屉（WF5-07）；其他工作区维持右面板语义。 */
	aiOnDrawer?: boolean;
	/** 抽屉当前覆盖的对象（WF5-17）：写作正文 or 跨工作区动作面。 */
	aiScope?: "writing" | "workspace";
	onOpenPalette: () => void;
}) {
	const ws = useWorkspace();
	const lamp = LAMP[ws.generation];
	const words =
		ws.projectWords === null ? "—" : ws.projectWords.toLocaleString();
	const aiActive = aiOnDrawer
		? ws.assistantOpen
		: ws.panelOpen && panelAvailable;
	const openAi = () => {
		if (aiOnDrawer) ws.setAssistantOpen(!ws.assistantOpen);
		else ws.togglePanel();
	};

	return (
		<header className="h-10 flex-none flex items-center gap-2 px-3 border-b border-line bg-rail">
			<span
				title={ws.projectName || undefined}
				className="font-wenkai text-[13.5px] text-ink-hi max-w-55 overflow-hidden text-ellipsis whitespace-nowrap"
			>
				{ws.projectName || "Novel Weaver"}
			</span>
			<span className="text-line" aria-hidden>
				/
			</span>
			<span
				className={cx(
					"text-[11.5px] overflow-hidden text-ellipsis whitespace-nowrap",
					ws.currentChapter ? "text-ink-mid" : "text-ink-low",
				)}
			>
				{ws.currentChapter ? ws.currentChapter.title : "未选择章节"}
			</span>

			<span className="ml-auto inline-flex items-center gap-3">
				<span
					className="num text-[11.5px] text-ink-mid"
					title="全书累计字数（随正文编辑接入实时更新）"
				>
					{words} 字
				</span>
				<span
					title={`生成状态：${lamp.label}`}
					className="inline-flex items-center gap-1"
				>
					<span
						className={cx(
							"w-1.75 h-1.75 rounded-full inline-block",
							lamp.breathe && "lamp-breathe",
							lamp.dot,
						)}
					/>
					<span className="text-[11.5px] text-ink-low">{lamp.label}</span>
				</span>
				<span className="w-px h-4 bg-line" aria-hidden />
				{panelAvailable || aiOnDrawer ? (
					<button
						type="button"
						onClick={openAi}
						aria-expanded={aiActive}
						className={cx(
							BAR_BUTTON_LAYOUT,
							"hitpad",
							"inline-flex items-center gap-1",
							aiActive
								? "text-accent-text border-[rgba(208,138,46,0.4)]"
								: "text-ink-mid border-line",
						)}
						/* WF5-03：窄入口必须带「AI 助手」文字标识——图标/「面板」字样不再承担指认 AI 的职责。 */
						title={
							aiActive
								? "收起 AI 助手"
								: aiScope === "workspace"
									? "打开 AI 助手（覆盖当前工作区）"
									: aiOnDrawer
										? "打开 AI 助手（覆盖当前正文）"
										: "打开 AI 助手（右侧面板）"
						}
					>
						<Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />
						AI 助手
					</button>
				) : null}
				<IconButton onClick={onOpenPalette} icon={Search} label="⌘K 命令" title="打开命令面板（⌘K）" aria-haspopup="dialog" />
				<LicenseButton />
			</span>
		</header>
	);
}
