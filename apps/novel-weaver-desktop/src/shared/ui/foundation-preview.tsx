import { Plus } from "lucide-react";
import { Flag, PenLine, Upload } from "lucide-react";
import { useState } from "react";

import {
	Button,
	Chip,
	EmptyState,
	initialTheme,
	NavItem,
	PAGE,
	Panel,
	SevBadge,
	type Severity,
	StatusDot,
	setTheme,
	TextField,
} from "./components";
import "./base.css";

const SEVERITIES: Severity[] = ["blocking", "warning", "advisory"];

function Swatch({ name, token }: { name: string; token: string }) {
	return (
		<div className="grid gap-1 justify-items-center text-[10px] text-ink-low">
			<span
				className="w-11 h-7 rounded-sm border border-line"
				style={{ background: token }}
			/>
			{name}
		</div>
	);
}

export function FoundationPreview() {
	const [theme, setThemeState] = useState(initialTheme());
	const [name, setName] = useState("示例小说");
	const toggle = () => {
		const next = theme === "dark" ? "light" : "dark";
		setTheme(next);
		setThemeState(next);
	};

	return (
		<main className={PAGE}>
			<header className="flex items-center gap-3 mb-6">
				<div>
					<p className="eyebrow">NOVEL WEAVER / FOUNDATION</p>
					<h1 className="font-wenkai text-[22px] mt-0.5 mb-0 mx-0">
						设计系统基座 · 玄窗
					</h1>
				</div>
				<span className="ml-auto">
					<Button variant="primary" onClick={toggle}>
						切换至{theme === "dark" ? "浅色" : "深色"}主题
					</Button>
				</span>
			</header>

			<div className="grid gap-3">
				<Panel title="色彩 TOKEN · 当前主题实际渲染">
					<div className="flex gap-3 flex-wrap">
						<Swatch name="shell-bg" token="var(--shell-bg)" />
						<Swatch name="rail-bg" token="var(--rail-bg)" />
						<Swatch name="line" token="var(--line)" />
						<Swatch name="ink-hi" token="var(--ink-hi)" />
						<Swatch name="ink-mid" token="var(--ink-mid)" />
						<Swatch name="accent" token="var(--accent)" />
						<Swatch name="paper-bg" token="var(--paper-bg)" />
						<Swatch name="ok" token="var(--ok)" />
						<Swatch name="blocking" token="var(--blocking)" />
					</div>
					<p className="text-[11px] text-ink-low mt-2">
						组件只允许引用语义变量；深色为默认，浅色为伴生（琥珀加深保对比度）。
					</p>
				</Panel>

				<Panel title="按钮 / 输入">
					<div className="flex gap-2 items-end flex-wrap">
						<Button variant="primary">送 QC 审校</Button>
						<Button>存为版本</Button>
						<div className="min-w-55">
							<TextField
								label="项目名称"
								value={name}
								onChange={setName}
								placeholder="给小说起个名字"
							/>
						</div>
					</div>
				</Panel>

				<Panel title="状态徽章 / 元信息">
					<div className="flex gap-2 items-center flex-wrap">
						{SEVERITIES.map((severity) => (
							<span key={severity} className="inline-flex gap-1 items-center">
								<SevBadge severity={severity} />
								<span className="text-[11px] text-ink-mid">
									时间线冲突：军报早于战事发端
								</span>
							</span>
						))}
					</div>
					<div className="flex gap-1 mt-2">
						<Chip tone="accent">候选 v2</Chip>
						<Chip>POV 角色甲 · 第三人称限知</Chip>
						<Chip>故事序 10 · 主连续体</Chip>
					</div>
				</Panel>

				<Panel title="场景状态点 / 导航项">
					<div className="flex gap-4">
						<div className="grid gap-2 content-start">
							{(["canonical", "candidate", "review"] as const).map((state) => (
								<span
									key={state}
									className="inline-flex gap-2 items-center text-[12px] text-ink-mid"
								>
									<StatusDot state={state} />
									{state === "canonical"
										? "已入正典"
										: state === "candidate"
											? "候选待审"
											: "QC 审校中"}
								</span>
							))}
						</div>
						<div className="grid gap-0.5 w-57.5">
							<NavItem
								icon={<PenLine size={14} strokeWidth={1.8} />}
								label="写作台"
								active
							/>
							<NavItem
								icon={<Flag size={14} strokeWidth={1.8} />}
								label="伏笔追踪表"
								count={3}
							/>
							<NavItem
								icon={<Upload size={14} strokeWidth={1.8} />}
								label="发布与导出"
							/>
						</div>
					</div>
				</Panel>

				<Panel title="纸感写作面 · 霞鹜文楷">
					<div className="paper rounded-md py-6 px-6 border border-paper-line">
						<h2 className="font-wenkai text-title text-prose-ink m-0">
							场景一 · 庭院练武
						</h2>
						<div className="w-8 h-0.5 bg-accent opacity-[0.85] mx-0 mt-2 mb-4" />
						<div className="prose">
							<p>
								角色甲收势的时候，木剑在晨光里停了半息。汗顺着下颌落进青砖缝里，砸出一个深色的圆点。他没有去擦——剑停，人不许停。
							</p>
							<p>
								院角的更漏刚过卯正二刻，风从西北来。数字对齐示范：1,142 字 ·
								故事序 10 · 卯正二刻。
							</p>
						</div>
					</div>
				</Panel>

				<Panel title="空状态">
					<EmptyState
						as="h2"
						glyph="世"
						title="还没有设定条目"
						hint="从一条硬规则开始，例如「本世界不存在时间旅行」；或者让 AI 根据已有正文提炼设定草稿。"
						actions={
							<>
								<Button variant="primary"><Plus size={14} strokeWidth={1.8} aria-hidden="true" /> 新建硬规则</Button>
								<Button>从正文提炼</Button>
							</>
						}
					/>
				</Panel>
			</div>

			<footer className="mt-8 text-[11px] text-ink-low">
				旧版 RPC 工作台仍可在{" "}
				<a className="text-accent-text" href="#/legacy">
					#/legacy
				</a>{" "}
				访问，模块票迁移完成后移除。
			</footer>
		</main>
	);
}
