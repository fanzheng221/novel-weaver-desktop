import { motion } from "motion/react";
import { useState } from "react";

import { authorErrorMessage } from "../../../shared/api/rpc";

import { Button, InlineNote, TextField } from "../../../shared/ui/components";
import { WIZARD } from "../../../shared/ui/copy";
import { cx } from "../../../shared/ui/cx";
import { useModalFocus } from "../../../shared/ui/focus";
import { modalPanelVariants, overlayBackdropMotion } from "../../../shared/ui/motion";

const GENRES = [
	{
		id: "urban",
		name: "都市",
		milestones: ["身份反差亮相", "首次小兑现", "核心对手入场", "卷末大兑现"],
	},
	{
		id: "xuanhuan",
		name: "玄幻",
		milestones: ["资质觉醒", "初入宗门", "首战成名", "秘境夺机"],
	},
	{
		id: "system",
		name: "系统流",
		milestones: ["系统激活", "新手任务达成", "首个隐藏奖励", "权限升级"],
	},
];

/** 首启三步向导（WF-010 决议）：新建项目 → 题材预设 → 进入写作台。 */
export function FirstRunWizard({
	cwd,
	onFinished,
}: {
	cwd: string;
	onFinished: () => void;
}) {
	const [step, setStep] = useState(0);
	const [name, setName] = useState("");
	const [language, setLanguage] = useState("zh-CN");
	const [genre, setGenre] = useState(GENRES[0]?.id ?? "urban");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const dialogRef = useModalFocus<HTMLDivElement>();

	const createProject = async () => {
		if (!name.trim() || busy) return;
		setBusy(true);
		try {
			await import("../../../shared/api/rpc").then(({ queryProject }) =>
				queryProject(cwd, "initialize_project", {
					name,
					primaryLanguage: language,
				}),
			);
			try {
				localStorage.setItem("nw-genre-preset", genre);
			} catch {
				/* 预设持久化降级为会话内 */
			}
			setError("");
			setStep(2);
		} catch (detail) {
			setError(authorErrorMessage(detail));
		} finally {
			setBusy(false);
		}
	};

	return (
		<motion.div
			initial="initial"
			animate="animate"
			exit="exit"
			variants={overlayBackdropMotion}
			style={{
				position: "fixed",
				inset: 0,
				background: "rgba(10,10,12,0.72)",
				display: "grid",
				placeItems: "center",
				zIndex: 80,
			}}
		>
			<motion.div
				ref={dialogRef}
				variants={modalPanelVariants}
				role="dialog"
				aria-modal="true"
				aria-label="首启向导"
				className="w-115 bg-rail border border-line rounded-lg p-6"
			>
				<h3 className="font-wenkai text-[18px] m-0">{WIZARD.title}</h3>
				<div className="flex gap-2 mt-3 mb-4">
					{WIZARD.steps.map((labelText, index) => (
						<div
							key={labelText}
							className={cx(
								"flex-1 text-center text-[10px]",
								index === step ? "text-accent-text" : "text-ink-low",
							)}
						>
							<span
								className={cx(
									"grid place-items-center w-5.5 h-5.5 rounded-full border-[1.5px] mx-auto mb-1 font-bold",
									index <= step ? "border-accent" : "border-line",
									index < step
										? "bg-accent text-accent-contrast"
										: "bg-transparent",
								)}
							>
								{index < step ? "✓" : index + 1}
							</span>
							{labelText}
						</div>
					))}
				</div>

				{step === 0 ? (
					<div className="grid gap-3">
						<TextField
							label={WIZARD.createNameLabel}
							value={name}
							onChange={setName}
							placeholder={WIZARD.createNamePlaceholder}
						/>
						<TextField
							label={WIZARD.createLanguageLabel}
							value={language}
							onChange={setLanguage}
						/>
						{error ? <InlineNote tone="danger">{error}</InlineNote> : null}
						<Button variant="primary" onClick={() => void createProject()}>
							创建项目
						</Button>
					</div>
				) : null}

				{step === 1 ? (
					<div className="grid gap-2">
						{GENRES.map((preset) => (
							<button
								key={preset.id}
								type="button"
								onClick={() => setGenre(preset.id)}
								className={cx(
									"ui-plain block w-full text-left cursor-pointer rounded-md px-3 py-2",
									genre === preset.id
										? "border border-accent bg-accent-soft"
										: "border border-line bg-transparent",
								)}
							>
								<b
									className={cx(
										"text-[13px]",
										genre === preset.id ? "text-accent-text" : "text-ink-hi",
									)}
								>
									{preset.name}
								</b>
								<p className="m-0 mt-1 text-[10px] text-ink-low">
									里程碑：{preset.milestones.join(" → ")}
								</p>
							</button>
						))}
						<p className="text-[10px] text-ink-low m-0">{WIZARD.presetHint}</p>
						<Button variant="primary" onClick={() => setStep(2)}>
							使用该预设
						</Button>
					</div>
				) : null}

				{step === 2 ? (
					<div className="grid gap-3">
						<p className="text-[12px] text-ink-mid leading-[1.9] m-0 whitespace-pre-line">
							{WIZARD.doneBody}
						</p>
						<Button variant="primary" onClick={onFinished}>
							{WIZARD.doneAction}
						</Button>
					</div>
				) : null}
			</motion.div>
		</motion.div>
	);
}
