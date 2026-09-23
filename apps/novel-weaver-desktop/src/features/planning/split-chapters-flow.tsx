import { X } from "lucide-react";
import { IconButton } from "../../shared/ui/icons";
import { motion } from "motion/react";
import { useEffect, useReducer, useRef, useState } from "react";
import { queryProject } from "../../shared/api/rpc";
import { Button, InlineNote } from "../../shared/ui/components";
import { useModalFocus } from "../../shared/ui/focus";
import {
	drawerPanelTransitionIn,
	drawerPanelTransitionOut,
	overlayBackdropMotion,
} from "../../shared/ui/motion";
import { describeRpcError } from "../../shared/ui/states";
import { approveProposalRobust } from "./confirm-model";
import {
	SPLIT_ADJUST,
	SPLIT_CLOSE,
	SPLIT_PREVIEW,
	SPLIT_PRIMARY_ACTION,
	SPLIT_RETRY,
	SPLIT_RUN,
} from "./outline-summary";
import { type PlanningNode, parseSplitInstruction } from "./planning-model";
import {
	createInitialSplitState,
	matchPendingToDrafts,
	type PendingPreview,
	splitReducer,
} from "./split-machine";

const STATUS_LABEL: Record<string, string> = {
	pending: "待创建",
	creating: "创建中…",
	created: "待纳入",
	approving: "纳入中…",
	done: "已纳入",
	failed: "失败",
};

interface PendingRow {
	proposalId: string;
	kind: string;
	subjectId: string;
	revision: number;
}

/**
 * 拆章垂直切片（WF5-10 用例 6）：编辑指令→预览可改→确认后逐章
 * create_artifact_proposal + approve_proposal 纳入；失败保留指令与进度，
 * 重试前先对账待审提案防重复建章；成功后由父级选中新建第一章。
 */
export function SplitChaptersFlow({
	cwd,
	outline,
	onClose,
	onSucceeded,
}: {
	cwd: string;
	outline: PlanningNode;
	onClose: () => void;
	/** 全部纳入后回调；参数为新建的第一章工件 ID（可能为 null）。 */
	onSucceeded: (firstArtifactId: string | null) => void;
}) {
	const [state, dispatch] = useReducer(
		splitReducer,
		undefined,
		createInitialSplitState,
	);
	const [parseError, setParseError] = useState("");
	const [reconciling, setReconciling] = useState(false);
	const panelRef = useModalFocus<HTMLElement>();
	const runningRef = useRef<string | null>(null);
	const mountedRef = useRef(true);

	// 打开即用总纲 acts 预填拆章指令（作者可整体改写）。
	useEffect(() => {
		dispatch({
			type: "open",
			outlineId: outline.id,
			instruction: instructionFromOutline(outline),
		});
		return () => {
			mountedRef.current = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [outline.id]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	// 运行器：从首个待处理项串行执行 create → approve。
	useEffect(() => {
		if (state.phase !== "running") return;
		const next = state.items.find(
			(item) => item.status === "pending" || item.status === "created",
		);
		if (!next) {
			if (
				state.items.length > 0 &&
				state.items.every((item) => item.status === "done")
			) {
				dispatch({ type: "runSucceeded" });
			}
			return;
		}
		if (runningRef.current === next.draft.key) return;
		runningRef.current = next.draft.key;
		const run = async () => {
			try {
				if (next.status === "pending") {
					dispatch({ type: "itemCreating", key: next.draft.key });
					const result = await queryProject<{
						artifactId: string;
						proposalId: string;
						revision: number;
					}>(cwd, "create_artifact_proposal", {
						kind: "chapter_plan",
						title: next.draft.title,
						dependencyIds: [state.outlineId ?? outline.id],
						content: {
							purpose: next.draft.purpose,
							storyOrder: next.draft.storyOrder,
						},
					});
					if (!mountedRef.current) return;
					runningRef.current = null;
					dispatch({
						type: "itemCreated",
						key: next.draft.key,
						proposalId: result.proposalId,
						revision: result.revision,
						artifactId: result.artifactId,
					});
					return;
				}
				// status === "created"：纳入正典。
				dispatch({ type: "itemApproving", key: next.draft.key });
				await approveProposalRobust(
					{ query: queryProject, cwd },
					next.proposalId as string,
					next.revision as number,
				);
				if (!mountedRef.current) return;
				runningRef.current = null;
				dispatch({ type: "itemApproved", key: next.draft.key });
			} catch (raw) {
				if (!mountedRef.current) return;
				runningRef.current = null;
				const parts = describeRpcError(raw);
				dispatch({
					type: "itemFailed",
					key: next.draft.key,
					error: { message: parts.message, detail: parts.detail ?? "" },
				});
				dispatch({ type: "runFailed" });
			}
		};
		void run();
	}, [state.phase, state.items, state.outlineId, cwd, outline.id]);

	// 重试＝先对账再续跑：待审中的同内容提案直接接续批准，不重复创建。
	const reconcileAndRetry = async () => {
		setReconciling(true);
		try {
			const queue = await queryProject<PendingRow[]>(
				cwd,
				"list_pending_proposals",
				{},
			);
			const previews: PendingPreview[] = [];
			for (const row of queue.filter(
				(item) => item.kind === "artifact_change",
			)) {
				try {
					const preview = await queryProject<PendingPreview>(
						cwd,
						"get_proposal",
						{
							proposalId: row.proposalId,
						},
					);
					previews.push(preview);
				} catch {
					// 单条预览失败不阻断对账；该条按未命中处理。
				}
			}
			const matched = matchPendingToDrafts(previews, state.items);
			for (const [key, hit] of matched) {
				dispatch({
					type: "itemCreated",
					key,
					proposalId: hit.proposalId,
					revision: hit.revision,
					artifactId: hit.artifactId,
				});
			}
			dispatch({ type: "retry" });
		} catch {
			// 对账失败也继续续跑；未对账到的已建提案由作者在待审面板处置。
			dispatch({ type: "retry" });
		} finally {
			setReconciling(false);
		}
	};

	const generatePreview = () => {
		const drafts = parseSplitInstruction(state.instruction);
		if (drafts.length === 0) {
			setParseError("请输入拆章指令：每行一章，一行写这一章要发生什么。");
			return;
		}
		setParseError("");
		dispatch({ type: "parsed", items: drafts });
	};

	const { phase, items, instruction } = state;

	return (
		<>
			<motion.button
				type="button"
				aria-label="关闭拆章流程"
				onClick={onClose}
				initial="initial"
				animate="animate"
				exit="exit"
				variants={overlayBackdropMotion}
				className="fixed inset-0 z-70 border-0 p-0 cursor-default [background:rgba(10,10,12,0.45)]"
			/>
			<motion.aside
				ref={panelRef}
				role="dialog"
				aria-modal="true"
				aria-label={SPLIT_PRIMARY_ACTION}
				initial={{ x: "100%" }}
				animate={{ x: 0, transition: drawerPanelTransitionIn }}
				exit={{ x: "100%", transition: drawerPanelTransitionOut }}
				className="fixed inset-y-0 right-0 z-71 w-110 max-w-[92vw] bg-rail border-l border-line shadow-nw flex flex-col"
			>
				<header className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-line">
					<div>
						<p className="eyebrow m-0">OUTLINE · SPLIT</p>
						<h3 className="font-wenkai text-[17px] mt-1 mb-0">
							{SPLIT_PRIMARY_ACTION}
						</h3>
					</div>
					<IconButton icon={X} label="关闭" onClick={onClose} />
				</header>

				<div className="grid content-start gap-3 flex-1 overflow-y-auto px-4 pt-3 pb-3">
					{phase === "editing" ? (
						<>
							<label className="grid gap-1">
								<span className="eyebrow">拆章指令（每行一章）</span>
								<textarea
									value={instruction}
									onChange={(event) =>
										dispatch({
											type: "instructionChanged",
											value: event.target.value,
										})
									}
									rows={10}
									className="bg-shell border border-line rounded-sm text-ink-hi text-[12.5px] px-2 py-2 resize-y leading-[1.7] font-[inherit]"
								/>
							</label>
							{parseError ? (
								<InlineNote tone="danger">{parseError}</InlineNote>
							) : null}
							<div>
								<Button variant="primary" onClick={generatePreview}>
									{SPLIT_PREVIEW}
								</Button>
							</div>
							<p className="m-0 text-[11px] leading-[1.6] text-ink-low">
								已按总纲分幕预填；可整体改写。下一步会先给你可调整的章节预览，
								确认后才会写入规划。
							</p>
						</>
					) : null}

					{phase === "previewing" ? (
						<>
							<p className="m-0 text-[12px] leading-[1.6] text-ink-mid">
								以下是拆章预览：标题与本章目的都可改，确认后逐条纳入规划。
							</p>
							<div className="grid gap-2">
								{items.map((item) => (
									<div
										key={item.draft.key}
										className="border border-line rounded-sm px-2 py-1.5 grid gap-1"
									>
										<label className="grid gap-0.5">
											<span className="eyebrow">章节标题</span>
											<input
												value={item.draft.title}
												onChange={(event) =>
													dispatch({
														type: "itemChanged",
														key: item.draft.key,
														patch: { title: event.target.value },
													})
												}
												className="bg-shell border border-line rounded-sm text-ink-hi text-[12.5px] px-2 py-1"
											/>
										</label>
										<label className="grid gap-0.5">
											<span className="eyebrow">本章目的</span>
											<textarea
												value={item.draft.purpose}
												onChange={(event) =>
													dispatch({
														type: "itemChanged",
														key: item.draft.key,
														patch: { purpose: event.target.value },
													})
												}
												rows={2}
												className="bg-shell border border-line rounded-sm text-ink-hi text-[12px] px-2 py-1 resize-y leading-[1.6] font-[inherit]"
											/>
										</label>
										<div className="flex justify-end">
											<Button
												onClick={() =>
													dispatch({
														type: "itemRemoved",
														key: item.draft.key,
													})
												}
											>
												移除此章
											</Button>
										</div>
									</div>
								))}
							</div>
							<div className="flex gap-2">
								<Button
									variant="primary"
									disabled={items.length === 0}
									onClick={() => dispatch({ type: "runStarted" })}
								>
									{SPLIT_RUN}
								</Button>
								<Button onClick={() => dispatch({ type: "backToEdit" })}>
									返回修改指令
								</Button>
							</div>
						</>
					) : null}

					{phase === "running" ? (
						<ul className="grid gap-1 m-0 pl-0 list-none" aria-busy>
							{items.map((item) => (
								<li
									key={item.draft.key}
									className="flex items-center gap-2 text-[12px] text-ink-mid"
								>
									<span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
										{item.draft.title}
									</span>
									<span className="ml-auto text-[10.5px] text-ink-low flex-none">
										{STATUS_LABEL[item.status]}
									</span>
								</li>
							))}
						</ul>
					) : null}

					{phase === "succeeded" ? (
						<>
							<InlineNote tone="success">
								拆章完成：
								{items.filter((item) => item.status === "done").length}{" "}
								章已纳入规划。
							</InlineNote>
							<div>
								<Button
									variant="primary"
									onClick={() => onSucceeded(state.firstCreatedArtifactId)}
								>
									{SPLIT_CLOSE}
								</Button>
							</div>
						</>
					) : null}

					{phase === "failed" ? (
						<>
							<div role="alert" className="grid gap-2">
								<InlineNote tone="danger">
									拆章没有全部完成：{state.failure?.message ?? "部分章节失败"}
								</InlineNote>
								<ul className="grid gap-1 m-0 pl-0 list-none">
									{items.map((item) => (
										<li
											key={item.draft.key}
											className="flex items-center gap-2 text-[12px] text-ink-mid"
										>
											<span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
												{item.draft.title}
											</span>
											<span
												className={
													item.status === "failed"
														? "ml-auto text-[10.5px] text-danger flex-none"
														: "ml-auto text-[10.5px] text-ink-low flex-none"
												}
											>
												{STATUS_LABEL[item.status]}
											</span>
										</li>
									))}
								</ul>
								<p className="m-0 text-[11.5px] leading-[1.6] text-ink-low">
									你的拆章指令已保留。重试会先核对已创建的提案，避免重复建章；
									也可以回到预览调整后继续。
								</p>
								{state.items.find((item) => item.error)?.error?.detail ? (
									<details>
										<summary className="cursor-pointer text-[10.5px] text-ink-low">
											技术详情
										</summary>
										<pre className="num mt-1 p-[8px_10px] text-[10px] leading-[1.6] whitespace-pre-wrap break-all max-h-35 overflow-y-auto bg-shell rounded-sm text-ink-mid">
											{state.items.find((item) => item.error)?.error?.detail}
										</pre>
									</details>
								) : null}
							</div>
							<div className="flex gap-2">
								<Button
									variant="primary"
									busy={reconciling}
									onClick={() => void reconcileAndRetry()}
								>
									{SPLIT_RETRY}
								</Button>
								<Button onClick={() => dispatch({ type: "adjust" })}>
									{SPLIT_ADJUST}
								</Button>
							</div>
						</>
					) : null}
				</div>
			</motion.aside>
		</>
	);
}

function instructionFromOutline(outline: PlanningNode): string {
	const acts = Array.isArray(outline.content.acts)
		? outline.content.acts.map(String)
		: [];
	return acts.join("\n");
}
