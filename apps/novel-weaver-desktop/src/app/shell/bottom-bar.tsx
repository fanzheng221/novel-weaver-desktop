import { Focus, Minimize, Sun, Moon } from "lucide-react";
import { useState } from "react";
import { initialTheme, setTheme } from "../../shared/ui/components";
import { cx } from "../../shared/ui/cx";
import { useWorkspace } from "../../shared/workspace/context";

function formatSavedAt(savedAt: number | null): string {
	if (savedAt === null) return "—";
	const at = new Date(savedAt);
	const hh = String(at.getHours()).padStart(2, "0");
	const mm = String(at.getMinutes()).padStart(2, "0");
	return `${hh}:${mm}`;
}

/* 快捷按钮：hover 色走 utility（原内联 onPointerEnter/Leave 等价替代）；无过渡（保持原即时切换，零回归）。
   ui-plain（base 层）重置按钮 UA 样式，tools 类随后覆盖。 */
const QUICK_BUTTON =
	"ui-plain inline-flex min-h-7 items-center gap-1.5 cursor-pointer text-[11.5px] leading-4 font-[inherit] py-1 px-2 rounded-sm text-ink-low hover:text-ink-mid";

function Dot({ color, breathe }: { color: string; breathe?: boolean }) {
	return (
		<span
			className={cx(
				"w-1.75 h-1.75 rounded-full inline-block flex-none",
				breathe && "lamp-breathe",
				color,
			)}
		/>
	);
}

/** 底部状态栏（WF2-12）：本章字数/目标 · 自动保存指示 · 生成状态灯 · 快捷操作。 */
export function BottomBar() {
	const ws = useWorkspace();
	const [theme, setThemeState] = useState(() => initialTheme());

	const saveLabel: Record<string, string> = {
		idle: ws.savedAt ? `已保存于 ${formatSavedAt(ws.savedAt)}` : "自动保存于 —",
		saving: "保存中…",
		saved: `已自动保存于 ${formatSavedAt(ws.savedAt)}`,
		error: "保存失败——请手动备份正文",
	};
	const saveColor: Record<string, string> = {
		idle: "bg-ink-low",
		saving: "bg-accent",
		saved: "bg-ok",
		error: "bg-blocking",
	};

	const genLabel =
		ws.generation === "running"
			? "生成中…"
			: ws.generation === "error"
				? "API 失败"
				: "";
	const genColor =
		ws.generation === "running"
			? "bg-accent"
			: ws.generation === "error"
				? "bg-blocking"
				: "bg-ink-low";

	const lampClass = "inline-flex items-center gap-1";
	const errorText =
		ws.saveState === "error" ? "text-blocking font-semibold" : "";

	return (
		<footer className="h-9 flex-none flex items-center gap-3 px-3 border-t border-line bg-rail text-[11.5px] text-ink-low">
			<span>
				本章{" "}
				<b className="num text-ink-mid font-semibold">
					{ws.chapterWords === null ? "—" : ws.chapterWords.toLocaleString()}
				</b>
				{ws.chapterTarget !== null ? (
					<>
						{" / 目标 "}
						<span className="num">{ws.chapterTarget.toLocaleString()}</span>
					</>
				) : null}
			</span>
			<span aria-hidden className="text-line">
				·
			</span>
			<span className={lampClass} title="手编草稿每 0.9 秒自动落盘到本机">
				<Dot
					color={saveColor[ws.saveState]}
					breathe={ws.saveState === "saving"}
				/>
				<span className={cx(errorText)}>{saveLabel[ws.saveState]}</span>
			</span>
			{genLabel ? (
				<span className={lampClass} title={`生成状态：${genLabel}`}>
					<Dot color={genColor} breathe={ws.generation === "running"} />
					<span
						className={cx(
							ws.generation === "error" && "text-blocking font-semibold",
							ws.generation === "running" && "text-accent",
						)}
					>
						{genLabel}
					</span>
				</span>
			) : null}

			<span className="ml-auto inline-flex gap-1">
				<button
					type="button"
					onClick={ws.toggleFocus}
					aria-pressed={ws.focusMode}
					title="专注模式（⌘\\）：隐藏左右两侧"
					className={cx("hitpad", QUICK_BUTTON)}
				>
					{ws.focusMode ? <Minimize size={14} aria-hidden="true" /> : <Focus size={14} aria-hidden="true" />}
					专注模式
				</button>
				<button
					type="button"
					onClick={() => {
						const next = theme === "dark" ? "light" : "dark";
						setTheme(next);
						setThemeState(next);
					}}
					title="切换明暗主题"
					className={cx("hitpad", QUICK_BUTTON)}
				>
					{theme === "dark" ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
					{theme === "dark" ? "浅色" : "深色"}
				</button>
			</span>
		</footer>
	);
}
