import { X } from "lucide-react";
import { IconButton } from "../../../shared/ui/icons";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { NameOption } from "../name-picker";
import { NamePicker } from "../name-picker";
import { ProposalConfirm } from "../proposal-confirm";
import type { PlanningEdge, PlanningNode } from "../planning-model";
import { authorErrorMessage, queryProject } from "../../../shared/api/rpc";
import { Button, InlineNote } from "../../../shared/ui/components";
import { useModalFocus } from "../../../shared/ui/focus";
import {
	drawerPanelTransitionIn,
	drawerPanelTransitionOut,
	overlayBackdropMotion,
} from "../../../shared/ui/motion";

/**
 * 章节大纲抽屉（WF2-07）：树/看板点章节就地编辑，保存走工件提案修订链
 * （artifactId + sourceVersionId 乐观锁，批准后 canonical 指针前移）。
 * WF5-10：提交后原位「预览影响→确认纳入」，人物改用名称选择。
 */
export function ChapterDrawer({
	cwd,
	node,
	graph,
	entityOptions,
	sceneOptions,
	dependencyIds,
	onClose,
	onSubmitted,
}: {
	cwd: string;
	node: PlanningNode;
	/** WF5-10：用于影响预览（谁依赖本章）与名称选择。 */
	graph: { nodes: PlanningNode[]; edges: PlanningEdge[] } | null;
	entityOptions: NameOption[];
	sceneOptions: Array<{ id: string; title: string; hint?: string }>;
	dependencyIds: string[];
	onClose: () => void;
	onSubmitted: (note: string) => void;
}) {
	const content = node.content;
	const [title, setTitle] = useState(node.title);
	const [purpose, setPurpose] = useState(
		typeof content.purpose === "string" ? content.purpose : "",
	);
	const [targetWords, setTargetWords] = useState(
		typeof content.targetWords === "number" ? String(content.targetWords) : "",
	);
	const [checkedSceneIds, setCheckedSceneIds] = useState<Set<string>>(() => {
		const ids = Array.isArray(content.sceneIds)
			? content.sceneIds.map(String)
			: [];
		return new Set(
			ids.filter((id) => sceneOptions.some((option) => option.id === id)),
		);
	});
	const [extraIds, setExtraIds] = useState(() => {
		const ids = Array.isArray(content.sceneIds)
			? content.sceneIds.map(String)
			: [];
		return ids
			.filter((id) => !sceneOptions.some((option) => option.id === id))
			.join("\n");
	});
	const [characterIds, setCharacterIds] = useState<string[]>(() =>
		Array.isArray(content.characterIds) ? content.characterIds.map(String) : [],
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [confirming, setConfirming] = useState<{
		proposalId: string;
		revision: number;
	} | null>(null);
	const drawerRef = useModalFocus<HTMLElement>();

	const _optionIds = useMemo(
		() => new Set(sceneOptions.map((item) => item.id)),
		[sceneOptions],
	);

	const submit = async () => {
		if (!title.trim()) {
			setError("标题不能为空。");
			return;
		}
		if (!purpose.trim()) {
			setError("核心事件一句话不能为空。");
			return;
		}
		setBusy(true);
		try {
			const manualIds = extraIds
				.split(/\n|,/)
				.map((part) => part.trim())
				.filter(Boolean);
			const nextContent: Record<string, unknown> = { ...content };
			nextContent.purpose = purpose.trim();
			if (targetWords.trim()) nextContent.targetWords = Number(targetWords);
			else delete nextContent.targetWords;
			nextContent.sceneIds = [
				...sceneOptions
					.filter((option) => checkedSceneIds.has(option.id))
					.map((option) => option.id),
				...manualIds,
			];
			nextContent.characterIds = characterIds;
			const result = await queryProject<{
				proposalId: string;
				revision: number;
			}>(cwd, "create_artifact_proposal", {
				artifactId: node.id,
				sourceVersionId: node.versionId,
				kind: "chapter_plan",
				title: title.trim(),
				dependencyIds,
				content: nextContent,
			});
			setBusy(false);
			// 连续流：不关抽屉，原位预览影响→确认纳入。
			setConfirming({
				proposalId: result.proposalId,
				revision: result.revision,
			});
		} catch (detail) {
			setError(authorErrorMessage(detail));
			setBusy(false);
		}
	};

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<>
			{/* 遮罩与抽屉为兄弟层——button 内不得嵌套输入控件（WF3-10）；
			    Esc 改全局监听：焦点在何处均可退出；焦点圈闭与归还见 WF3-11；
			    进出场动画见 WF3-06④（滑入 slow 档、出场快于入场） */}
			<motion.button
				type="button"
				aria-label="关闭章节抽屉"
				onClick={onClose}
				initial="initial"
				animate="animate"
				exit="exit"
				variants={overlayBackdropMotion}
				className="fixed inset-0 z-70 border-0 p-0 cursor-default [background:rgba(10,10,12,0.45)]"
			/>
			<motion.aside
				ref={drawerRef}
				role="dialog"
				aria-modal="true"
				aria-label="编辑本章大纲"
				initial={{ x: "100%" }}
				animate={{ x: 0, transition: drawerPanelTransitionIn }}
				exit={{ x: "100%", transition: drawerPanelTransitionOut }}
				className="fixed inset-y-0 right-0 z-71 w-105 max-w-[92vw] bg-rail border-l border-line shadow-nw flex flex-col"
			>
				<header className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-line">
					<div>
						<p className="eyebrow m-0">章节 · {node.title}</p>
						<h3 className="font-wenkai text-[17px] mt-1 mb-0">编辑本章大纲</h3>
					</div>
					<IconButton icon={X} label="关闭" onClick={onClose} />
				</header>

				<div className="grid content-start gap-3 flex-1 overflow-y-auto px-4 pt-3 pb-3">
					{confirming ? (
						<ProposalConfirm
							cwd={cwd}
							proposalId={confirming.proposalId}
							revision={confirming.revision}
							graph={graph}
							idNames={
								new Map([...entityOptions.map((option): [string, string] => [option.id, option.name]), ...(graph?.nodes ?? []).map((item): [string, string] => [item.id, item.title])])
							}
							onApproved={() =>
								onSubmitted(
									`「${title.trim()}」的修订已纳入规划。下一步：回树里看本章场景。`,
								)
							}
							onDeferred={() =>
								onSubmitted(
									`「${title.trim()}」的修订提案已进入待审列表，可稍后在右侧批准。`,
								)
							}
						/>
					) : (
						<>
							<label className="grid gap-1">
								<span className="eyebrow">章节标题</span>
								<input
									value={title}
									onChange={(event) => setTitle(event.target.value)}
									className="bg-shell border border-line rounded-sm text-ink-hi text-[13px] px-2 py-2"
								/>
							</label>

							<label className="grid gap-1">
								<span className="eyebrow">核心事件一句话</span>
								<textarea
									value={purpose}
									onChange={(event) => setPurpose(event.target.value)}
									placeholder="这一章发生什么、改变什么"
									className="bg-shell border border-line rounded-sm text-ink-hi text-[12.5px] px-2 py-2 resize-y min-h-16 leading-[1.7] font-[inherit]"
								/>
							</label>

							<label className="grid gap-1">
								<span className="eyebrow">目标字数</span>
								<input
									value={targetWords}
									onChange={(event) =>
										setTargetWords(event.target.value.replace(/[^\d]/g, ""))
									}
									placeholder="如 3000"
									inputMode="numeric"
									className="bg-shell border border-line rounded-sm text-ink-hi text-[13px] px-2 py-2 w-40"
								/>
							</label>

							<div className="grid gap-1">
								<span className="eyebrow">关联场景</span>
								{sceneOptions.length === 0 ? (
									<p className="m-0 text-[11.5px] text-ink-low">
										还没有场景计划——可先保存章节，再在大纲下创建场景计划并按名称关联。
									</p>
								) : (
									<div className="grid gap-1">
										{sceneOptions.map((option) => (
											<label
												key={option.id}
												className="flex items-center gap-2 text-[12px] text-ink-mid cursor-pointer px-0.5 py-1"
											>
												<input
													type="checkbox"
													checked={checkedSceneIds.has(option.id)}
													onChange={(event) =>
														setCheckedSceneIds((current) => {
															const next = new Set(current);
															if (event.target.checked) next.add(option.id);
															else next.delete(option.id);
															return next;
														})
													}
												/>
												<span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
													{option.title}{option.hint ? ` · ${option.hint}` : ""}
												</span>
											</label>
										))}
									</div>
								)}
								<details>
									<summary className="cursor-pointer text-[10.5px] text-ink-low">
										高级 · 直接输入场景 ID
									</summary>
									<textarea
										value={extraIds}
										onChange={(event) => setExtraIds(event.target.value)}
										placeholder={"其他场景 ID（每行一个，可空）"}
										className="bg-shell border border-line rounded-sm text-ink-hi text-[11.5px] px-2 py-1 resize-y min-h-11 leading-[1.6] font-[inherit] mt-1 w-full"
									/>
								</details>
							</div>

							<NamePicker
								label="涉及人物"
								options={entityOptions}
								selectedIds={characterIds}
								onChange={setCharacterIds}
								emptyHint="设定库还没有人物——先在世界区创建人物并批准设定提案。"
							/>

							<p className="m-0 text-[10.5px] leading-[1.7] text-ink-low">
								情节线、故事序等未列出字段将原样保留；提交后先预览影响，
								确认纳入才生效。
							</p>
							{error ? <InlineNote tone="danger">{error}</InlineNote> : null}
						</>
					)}
				</div>

				{confirming ? null : (
					<footer className="flex items-center gap-2 px-4 pt-3 pb-4 border-t border-line">
						<Button variant="primary" busy={busy} onClick={() => void submit()}>
							{busy ? "提交中…" : "提交修订提案"}
						</Button>
						<Button onClick={onClose}>放弃</Button>
					</footer>
				)}
			</motion.aside>
		</>
	);
}
