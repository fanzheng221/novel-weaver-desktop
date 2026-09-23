import { useCallback, useEffect, useMemo, useState } from "react";
import { authorErrorMessage, queryProject } from "../../shared/api/rpc";
import { useWorkspace } from "../../shared/workspace/context";
import { Button, Chip, EmptyState } from "../../shared/ui/components";
import { EMPTY } from "../../shared/ui/copy";
import { cx } from "../../shared/ui/cx";
import {
	describeRpcError,
	ErrorState,
	navigateTo,
	SkeletonLines,
	useDelayedFlag,
} from "../../shared/ui/states";
import { useAssistant } from "./assistant/assistant-context";
import { countWords, lineDiff } from "./prose";

interface SceneVersionSummary {
	versionId: string;
	sceneId: string;
	sceneTitle: string;
	storyOrder: number;
	sourceVersionId: string | null;
	isCanonical: boolean;
	markdown: string;
	createdAt: string;
}

function formatTime(iso: string): string {
	const at = new Date(iso);
	const mm = String(at.getMonth() + 1).padStart(2, "0");
	const dd = String(at.getDate()).padStart(2, "0");
	const hh = String(at.getHours()).padStart(2, "0");
	const mi = String(at.getMinutes()).padStart(2, "0");
	return `${mm}-${dd} ${hh}:${mi}`;
}

/** 版本历史 Tab（WF2-18 / WF-024 决议）：倒序列表＋正典点标＋只读预览＋回退确认。 */
export function VersionsPanel({ cwd }: { cwd: string }) {
	const ws = useWorkspace();
	const assistant = useAssistant();
	const sceneId = ws.proseSceneId;
	const [versions, setVersions] = useState<SceneVersionSummary[]>([]);
	const [previewId, setPreviewId] = useState<string | null>(null);
	const [revertTarget, setRevertTarget] = useState<SceneVersionSummary | null>(
		null,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [note, setNote] = useState("");
	const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
	const showSkeleton = useDelayedFlag(phase === "loading");
	const [loadError, setLoadError] = useState<ReturnType<
		typeof describeRpcError
	> | null>(null);

	const retryLoad = useCallback(async () => {
		if (!sceneId) return;
		setLoadError(null);
		try {
			setVersions(
				await queryProject<SceneVersionSummary[]>(cwd, "list_scene_versions", {
					sceneId,
				}),
			);
			setPhase("ready");
		} catch (raw) {
			setLoadError(describeRpcError(raw));
			setPhase("failed");
		}
	}, [cwd, sceneId]);

	useEffect(() => {
		void retryLoad();
	}, [retryLoad]);

	const canonical = useMemo(
		() => versions.find((version) => version.isCanonical) ?? null,
		[versions],
	);

	const preview =
		versions.find((version) => version.versionId === previewId) ?? null;

	const diffSummary = useMemo(() => {
		if (!revertTarget || !canonical) return null;
		const parts = lineDiff(revertTarget.markdown, canonical.markdown);
		let added = 0;
		let removed = 0;
		for (const part of parts) {
			if (part.kind === "add") added += 1;
			else if (part.kind === "del") removed += 1;
		}
		return { added, removed };
	}, [revertTarget, canonical]);

	const submitRevert = async () => {
		if (!revertTarget || !canonical) return;
		setBusy(true);
		try {
			await queryProject(cwd, "create_scene_candidate", {
				title: `${canonical.sceneTitle}·回退自${formatTime(revertTarget.createdAt)}`,
				markdown: revertTarget.markdown,
				narrativeMode: "third_person_limited",
				continuityId: "main",
				storyOrder: revertTarget.storyOrder,
				purposes: ["推进主线"],
				authorInstruction: `版本回退：恢复到 ${formatTime(revertTarget.createdAt)} 的内容。`,
			});
			setNote("回退候选已创建——走批准链，批准后即成新正典。");
			ws.reportSaved();
			setRevertTarget(null);
			await retryLoad();
		} catch (detail) {
			setError(authorErrorMessage(detail));
		} finally {
			setBusy(false);
		}
	};

	if (!sceneId) {
		return (
			<p className="m-0 text-[11.5px] leading-[1.9] text-ink-low">
				在正文面选中一个正典场景后，这里按时间倒序展示它的全部版本。
			</p>
		);
	}

	return (
		<div className="grid gap-2">
			{error ? <Chip tone="accent">{error}</Chip> : null}
			{note ? <Chip tone="accent">{note}</Chip> : null}

			{phase === "failed" && loadError ? (
				<ErrorState
					compact
					message={loadError.message}
					detail={loadError.detail}
					onRetry={() => void retryLoad()}
				/>
			) : null}
			{phase === "loading" && showSkeleton ? <SkeletonLines lines={3} /> : null}

			{phase === "ready" ? (
				<>
					<div className="grid gap-1">
						{versions.map((version, index) => {
							const active = version.versionId === previewId;
							return (
								<div
									key={version.versionId}
									className={cx(
										"rounded-md py-2 px-2 grid gap-1",
										active ? "border border-accent" : "border border-line",
									)}
								>
									<button
										type="button"
										onClick={() =>
											setPreviewId(active ? null : version.versionId)
										}
										className="ui-plain flex items-center gap-2 w-full cursor-pointer font-[inherit]"
									>
										<b className="num text-[12px]">
											v{versions.length - index}
										</b>
										{version.isCanonical ? (
											<Chip tone="accent">正典</Chip>
										) : null}
										<span className="num ml-auto text-[10.5px] text-ink-low">
											{formatTime(version.createdAt)}
										</span>
										<span className="num text-[10px] text-ink-low">
											{countWords(version.markdown)}字
										</span>
									</button>
								</div>
							);
						})}
						{versions.length === 0 ? (
							<EmptyState glyph="versions"
								as="h2"
								title={EMPTY.versions.title}
								hint={EMPTY.versions.hint}
								actions={
									<Button onClick={() => navigateTo("studio")}>
										{EMPTY.versions.actionLabel}
									</Button>
								}
							/>
						) : null}
					</div>

					{/* 只读预览层 */}
					{preview ? (
						<div className="grid gap-1">
							<p className="eyebrow m-0">
								只读预览 · v 对应 {formatTime(preview.createdAt)}
							</p>
							<pre className="prose paper m-0 max-h-65 overflow-y-auto py-4 px-4 whitespace-pre-wrap text-justify select-text">
								{preview.markdown}
							</pre>
							<div className="flex gap-1 flex-wrap">
								{!preview.isCanonical ? (
									<Button
										variant="primary"
										onClick={() => setRevertTarget(preview)}
									>
										以此版回退…
									</Button>
								) : null}
								<Button
									onClick={() => {
										assistant.seedFromVersion({
											sceneTitle: preview.sceneTitle,
											storyOrder: preview.storyOrder,
											versionId: preview.versionId,
										});
									}}
								>
									以此版为基重新生成 → AI 助手
								</Button>
							</div>
						</div>
					) : (
						<p className="m-0 text-[11px] text-ink-low leading-[1.8]">
							点任意版本查看只读预览；非正典版本可发起回退或以它为基重新生成。
						</p>
					)}

					{/* 回退确认弹层：v4→v2 差异摘要→新候选链；遮罩与面板兄弟层（WF3-10） */}
					{revertTarget && diffSummary && canonical ? (
						<>
							<button
								type="button"
								aria-label="关闭回退确认"
								onClick={() => setRevertTarget(null)}
								style={{
									position: "fixed",
									inset: 0,
									zIndex: 86,
									background: "rgba(10,10,12,.6)",
									border: "none",
									padding: 0,
									cursor: "default",
								}}
							/>
							<div
								className="bg-rail border border-line rounded-lg p-6"
								style={{
									position: "fixed",
									left: "50%",
									top: "50%",
									transform: "translate(-50%, -50%)",
									zIndex: 87,
									width: 430,
									maxWidth: "92vw",
								}}
							>
								<h2 className="m-0 mb-2 font-wenkai text-[16px]">确认回退？</h2>
								<p className="m-0 text-[12px] leading-[1.9] text-ink-mid">
									当前正典相对所选版本{" "}
									<b className="num text-[rgba(127,168,140,1)]">
										多 {diffSummary.added} 行
									</b>
									／
									<b className="num text-blocking">
										少 {diffSummary.removed} 行
									</b>
									。回退不会覆盖历史：将以旧版内容创建新候选，送审批准后才成为新正典。
								</p>
								<div className="flex gap-2 mt-3">
									<Button
										variant="primary"
										busy={busy}
										onClick={() => void submitRevert()}
									>
										{busy ? "提交中…" : "创建回退候选"}
									</Button>
									<Button onClick={() => setRevertTarget(null)}>再想想</Button>
								</div>
							</div>
						</>
					) : null}
				</>
			) : null}
		</div>
	);
}
